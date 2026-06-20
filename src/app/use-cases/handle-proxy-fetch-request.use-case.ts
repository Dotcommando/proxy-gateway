import { randomUUID } from 'node:crypto';

import {
  ATTEMPT_EXECUTOR_RESULT_KIND,
  GATEWAY_TIMEOUT_MESSAGE,
  PROVIDER_SELECTION_RESULT_KIND,
  PROXY_PLAN_KIND,
  RESPONSE_CODE,
  TARGET_ACCESS_RESULT_KIND,
} from '../../constants';
import type { ProxyGateway } from '../../ports/inbound';
import type {
  ProxyExecutionPlan,
  ProxyProviderInstance,
} from '../../ports/outbound';
import { BodyBufferManager } from '../buffering/body-buffer-manager';
import { ResultClassifier } from '../classification';
import { ProxyFetchEnvelopeBuilder, ProxyFetchEnvelopeParser } from '../envelopes/proxy-fetch-json-envelope';
import { RedactionService } from '../redaction';
import { RetryDecider } from '../retry';
import { TargetAccessGuard } from '../security';
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
      if (!this.#options.transport) {
        return this.#envelopeBuilder.buildServiceError(500, {
          code: RESPONSE_CODE.TRANSPORT_NOT_CONFIGURED,
          message: 'No target transport is configured.',
        });
      }

      const provider = providerSelection.provider;
      const requestId = this.#options.random?.createId() ?? randomUUID();

      await provider.adapter.getCapabilities();

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
        parentSignal: totalScope.signal,
        plan: createSingleAttemptPlan(provider),
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
