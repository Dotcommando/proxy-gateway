import { randomUUID } from 'node:crypto';

import {
  ATTEMPT_EXECUTOR_RESULT_KIND,
  GATEWAY_TIMEOUT_MESSAGE,
  PLANNER_RESULT_KIND,
  PROVIDER_SELECTION_RESULT_KIND,
  PROXY_PLAN_KIND,
  RESPONSE_CODE,
  TARGET_ACCESS_RESULT_KIND,
} from '../../constants';
import type { ProxyGateway } from '../../ports/inbound';
import type {
  GatewayExecutionContext,
  GatewayTargetRequest,
  ProxyExecutionPlan,
  ProxyProviderInstance,
  TargetFinalUrlGuardPort,
} from '../../ports/outbound';
import { BodyBufferManager } from '../buffering/body-buffer-manager';
import { ResultClassifier } from '../classification';
import { ProxyFetchEnvelopeBuilder, ProxyFetchEnvelopeParser } from '../envelopes/proxy-fetch-json-envelope';
import { ExecutionPlanner, type ProxyPlanAttemptConfig, type ProxyPlanConfig } from '../planning';
import { RedactionService } from '../redaction';
import { RetryDecider } from '../retry';
import { TargetAccessGuard } from '../security';
import { SESSION_MANAGER_READ_RESULT_KIND, SessionManager } from '../sessions';
import {
  mapTimeoutObservationToOutcome,
  readTimeoutObservation,
  TimeoutController,
  type TimeoutObservation,
  type TimeoutScope,
} from '../timeouts';
import type { ProxyGatewayOptions } from '../types';
import { AttemptExecutor } from './attempt-executor';

export class HandleProxyFetchRequestUseCase implements ProxyGateway {
  readonly #bodyBufferManager: BodyBufferManager;
  readonly #envelopeBuilder = new ProxyFetchEnvelopeBuilder();
  readonly #envelopeParser: ProxyFetchEnvelopeParser;
  readonly #options: ProxyGatewayOptions;
  readonly #resultClassifier: ResultClassifier;
  readonly #targetAccessGuard: TargetAccessGuard;
  readonly #timeoutController = new TimeoutController();

  constructor(options: ProxyGatewayOptions) {
    this.#options = options;
    this.#bodyBufferManager = new BodyBufferManager(options.bodyBuffering);
    this.#envelopeParser = new ProxyFetchEnvelopeParser(options.bodyBuffering);
    this.#resultClassifier = new ResultClassifier(new RedactionService(options.redaction));
    this.#targetAccessGuard = new TargetAccessGuard(options.targetAccess);
  }

  async handle(request: Request): Promise<Response> {
    let totalScope: TimeoutScope | undefined;

    try {
      const parsed = await this.#envelopeParser.parse(request);
      const totalTimeoutMs = parsed.options.timeoutMs ?? this.#options.timeouts?.totalTimeoutMs;

      totalScope = this.#timeoutController.createTotalScope({
        callerSignal: request.signal,
        ...(totalTimeoutMs === undefined ? {} : { timeoutMs: totalTimeoutMs }),
      });
      const target = {
        ...parsed.target,
        body: await this.#bodyBufferManager.bufferRequestBody(parsed.target.body),
      };
      const targetAccess = this.#targetAccessGuard.check({ target });

      if (targetAccess.kind === TARGET_ACCESS_RESULT_KIND.REJECTED) {
        return this.#envelopeBuilder.buildServiceError(targetAccess.status, {
          code: targetAccess.code,
          message: targetAccess.message,
          retryable: false,
        });
      }
      if (!this.#options.transport) {
        return this.#envelopeBuilder.buildServiceError(500, {
          code: RESPONSE_CODE.TRANSPORT_NOT_CONFIGURED,
          message: 'No target transport is configured.',
        });
      }

      const requestId = this.#options.random?.createId() ?? randomUUID();
      const executionPlan = await this.#createExecutionPlan(target, parsed.context);

      if (executionPlan instanceof Response) {
        return executionPlan;
      }

      const attemptExecutor = new AttemptExecutor({
        bodyBufferManager: this.#bodyBufferManager,
        ...(this.#options.exitVerifier !== undefined && { exitVerifier: this.#options.exitVerifier }),
        providers: this.#options.providers,
        resultClassifier: this.#resultClassifier,
        retryDecider: new RetryDecider(
          this.#options.retrySafety === undefined ? {} : { retrySafety: this.#options.retrySafety },
        ),
        timeoutController: this.#timeoutController,
        transport: this.#options.transport,
      });
      const executorResult = await attemptExecutor.execute({
        context: parsed.context,
        finalUrlGuard: this.#createFinalUrlGuard(),
        parentSignal: totalScope.signal,
        plan: executionPlan,
        requestId,
        target,
        ...(this.#options.timeouts?.attemptTimeoutMs === undefined
          ? {}
          : { attemptTimeoutMs: this.#options.timeouts.attemptTimeoutMs }),
      });

      if (executorResult.kind === ATTEMPT_EXECUTOR_RESULT_KIND.COMPLETED) {
        return this.#envelopeBuilder.buildTargetResponse(executorResult.response, request.headers);
      }

      const serviceError = executorResult.classified.serviceError;

      return this.#envelopeBuilder.buildServiceError(serviceError?.status ?? 500, {
        code: serviceError?.code ?? RESPONSE_CODE.GATEWAY_ERROR,
        ...(executorResult.classified.diagnostics !== undefined && {
          details: executorResult.classified.diagnostics,
        }),
        message: serviceError?.message ?? 'Gateway attempt failed.',
        retryable: serviceError?.retryable ?? false,
      });
    } catch (error) {
      const timeoutObservation = readTimeoutObservation(error);

      if (timeoutObservation !== undefined) {
        return buildTimeoutServiceError(this.#envelopeBuilder, this.#resultClassifier, timeoutObservation);
      }

      return this.#envelopeBuilder.buildServiceError(400, {
        code: RESPONSE_CODE.INVALID_PROXY_FETCH_REQUEST,
        message: error instanceof Error ? error.message : 'Invalid proxy-fetch request.',
      });
    } finally {
      totalScope?.dispose();
    }
  }

  async #createExecutionPlan(
    target: GatewayTargetRequest,
    context: GatewayExecutionContext,
  ): Promise<ProxyExecutionPlan | Response> {
    if (this.#options.plan !== undefined) {
      const plan = await this.#applySessionPin(this.#options.plan, target, context);

      if (plan instanceof Response) {
        return plan;
      }

      const plannerResult = await new ExecutionPlanner({
        exitVerifierAvailable: this.#options.exitVerifier !== undefined,
        providers: this.#options.providers,
      }).plan({ plan });

      if (plannerResult.kind === PLANNER_RESULT_KIND.REJECTED) {
        return this.#envelopeBuilder.buildServiceError(500, {
          code: plannerResult.code,
          message: plannerResult.message,
          retryable: false,
        });
      }

      return plannerResult.plan;
    }

    const providerSelection = selectProviderInstance(
      this.#options.providers,
      this.#options.providerSelection?.providerInstanceId,
    );

    if (providerSelection.kind === PROVIDER_SELECTION_RESULT_KIND.NONE_ENABLED) {
      return this.#envelopeBuilder.buildServiceError(500, {
        code: RESPONSE_CODE.NO_PROVIDER_AVAILABLE,
        message: 'No enabled proxy provider is available.',
      });
    }
    if (providerSelection.kind === PROVIDER_SELECTION_RESULT_KIND.NOT_FOUND) {
      return this.#envelopeBuilder.buildServiceError(500, {
        code: RESPONSE_CODE.PROVIDER_INSTANCE_NOT_FOUND,
        message: `Provider instance "${providerSelection.providerInstanceId}" was not found or is disabled.`,
      });
    }

    await providerSelection.provider.adapter.getCapabilities();

    return createSingleAttemptPlan(providerSelection.provider);
  }

  async #applySessionPin(
    plan: ProxyPlanConfig,
    target: GatewayTargetRequest,
    context: GatewayExecutionContext,
  ): Promise<ProxyPlanConfig | Response> {
    const [firstAttempt, ...remainingAttempts] = plan.attempts;
    const identity = firstAttempt?.requirements?.identity;

    if (
      this.#options.sessionStore === undefined
      || firstAttempt === undefined
      || identity === undefined
    ) {
      return plan;
    }

    const sessionResult = await new SessionManager({
      store: this.#options.sessionStore,
    }).read({
      cleanupExpired: true,
      context,
      identity,
      now: new Date(),
      providers: this.#options.providers,
      targetUrl: target.url,
    });

    if (sessionResult.kind !== SESSION_MANAGER_READ_RESULT_KIND.HIT) {
      return plan;
    }
    if (
      sessionResult.providerInstanceId === undefined
      || !attemptAcceptsSessionProvider(firstAttempt, sessionResult.providerInstanceId)
    ) {
      return this.#envelopeBuilder.buildServiceError(500, {
        code: RESPONSE_CODE.NO_PLANNABLE_PROVIDER,
        message: 'Sticky session provider is incompatible with the first plan attempt.',
        retryable: false,
      });
    }

    return {
      ...plan,
      attempts: [
        {
          ...firstAttempt,
          provider: sessionResult.providerInstanceId,
        },
        ...remainingAttempts,
      ],
    };
  }

  #createFinalUrlGuard(): TargetFinalUrlGuardPort {
    return {
      check: (input) => this.#targetAccessGuard.checkRedirectUrl(input.url, input.baseUrl),
    };
  }
}

type ProviderSelectionResult =
  | { kind: PROVIDER_SELECTION_RESULT_KIND.SELECTED; provider: ProxyProviderInstance }
  | { kind: PROVIDER_SELECTION_RESULT_KIND.NOT_FOUND; providerInstanceId: string }
  | { kind: PROVIDER_SELECTION_RESULT_KIND.NONE_ENABLED };

function selectProviderInstance(
  providers: ProxyProviderInstance[],
  providerInstanceId?: string,
): ProviderSelectionResult {
  if (providerInstanceId !== undefined) {
    const provider = providers.find((candidate) => candidate.id === providerInstanceId && candidate.enabled !== false);

    return provider
      ? { kind: PROVIDER_SELECTION_RESULT_KIND.SELECTED, provider }
      : { kind: PROVIDER_SELECTION_RESULT_KIND.NOT_FOUND, providerInstanceId };
  }

  const provider = providers.find((candidate) => candidate.enabled !== false);

  return provider
    ? { kind: PROVIDER_SELECTION_RESULT_KIND.SELECTED, provider }
    : { kind: PROVIDER_SELECTION_RESULT_KIND.NONE_ENABLED };
}

function createSingleAttemptPlan(provider: ProxyProviderInstance): ProxyExecutionPlan {
  return {
    attempts: [
      {
        providerInstanceId: provider.id,
        providerKind: provider.adapter.kind,
        requirements: {},
      },
    ],
    kind: PROXY_PLAN_KIND.FALLBACK,
  };
}

function attemptAcceptsSessionProvider(
  attempt: ProxyPlanAttemptConfig,
  providerInstanceId: string,
): boolean {
  if (attempt.provider !== undefined && attempt.provider !== providerInstanceId) {
    return false;
  }
  if (
    attempt.requirements?.providerInstanceIds !== undefined
    && !attempt.requirements.providerInstanceIds.includes(providerInstanceId)
  ) {
    return false;
  }
  if (attempt.requirements?.excludeProviderInstanceIds?.includes(providerInstanceId) === true) {
    return false;
  }

  return true;
}

function buildTimeoutServiceError(
  envelopeBuilder: ProxyFetchEnvelopeBuilder,
  resultClassifier: ResultClassifier,
  timeoutObservation: TimeoutObservation,
): Response {
  const classified = resultClassifier.classifyFailure({
    outcome: mapTimeoutObservationToOutcome(timeoutObservation),
  });
  const serviceError = classified.serviceError;

  return envelopeBuilder.buildServiceError(serviceError?.status ?? 504, {
    code: serviceError?.code ?? RESPONSE_CODE.GATEWAY_TIMEOUT,
    message: serviceError?.message ?? GATEWAY_TIMEOUT_MESSAGE,
    retryable: serviceError?.retryable ?? false,
  });
}
