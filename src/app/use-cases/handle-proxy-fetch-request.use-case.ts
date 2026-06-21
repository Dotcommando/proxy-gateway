import { randomUUID } from 'node:crypto';

import {
  ATTEMPT_EXECUTOR_RESULT_KIND,
  GATEWAY_TIMEOUT_MESSAGE,
  PIPELINE_RESULT_KIND,
  PLANNER_RESULT_KIND,
  PROVIDER_SELECTION_RESULT_KIND,
  PROXY_ATTEMPT_RESULT_OUTCOME,
  PROXY_PLAN_KIND,
  RESPONSE_CODE,
  ROUTE_SELECTION_RESULT_KIND,
  TARGET_ACCESS_RESULT_KIND,
} from '../../constants';
import { type RouteSelectionResult, selectRoute } from '../../domain/routing';
import type { ProxyGateway } from '../../ports/inbound';
import type {
  GatewayExecutionContext,
  GatewayTargetRequest,
  ProxyDecisionState,
  ProxyExecutionPlan,
  ProxyGatewayServices,
  ProxyProviderCandidate,
  ProxyProviderInstance,
  ProxyRouteRequirements,
  ProxySessionRecord,
  TargetFinalUrlGuardPort,
} from '../../ports/outbound';
import { BodyBufferManager } from '../buffering/body-buffer-manager';
import { ResultClassifier } from '../classification';
import { ProxyFetchEnvelopeBuilder, ProxyFetchEnvelopeParser } from '../envelopes/proxy-fetch-json-envelope';
import { createBuiltInPipelineStepRegistry, ProxyPipelineEngine } from '../pipeline';
import {
  ExecutionPlanner,
  type ExecutionPlannerResult,
  mergeRouteRequirementsIntoPlan,
  type ProxyPlanAttemptConfig,
  type ProxyPlanConfig,
} from '../planning';
import { RedactionService } from '../redaction';
import { RetryDecider } from '../retry';
import { TargetAccessGuard } from '../security';
import { SESSION_MANAGER_READ_RESULT_KIND, SessionKeyFactory, SessionManager } from '../sessions';
import {
  mapTimeoutObservationToOutcome,
  readTimeoutObservation,
  TimeoutController,
  type TimeoutObservation,
  type TimeoutScope,
} from '../timeouts';
import type { ProxyGatewayOptions } from '../types';
import { AttemptExecutor } from './attempt-executor';

interface ISessionPinRejected {
  code: RESPONSE_CODE.NO_PLANNABLE_PROVIDER;
  message: string;
}

type SessionPinResult = ISessionPinRejected | ProxyPlanConfig;

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
      const executionPlan = await this.#createExecutionPlan(
        target,
        parsed.context,
        requestId,
        totalScope.signal,
      );

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
        if (executorResult.classified.attemptResult.outcome === PROXY_ATTEMPT_RESULT_OUTCOME.SUCCESS) {
          await this.#writeSessionIfNeeded({
            attempt: executorResult.attempt,
            context: parsed.context,
            target,
          });
        }

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
    requestId: string,
    signal: AbortSignal,
  ): Promise<ProxyExecutionPlan | Response> {
    const selectedRoute = this.#selectConfiguredRoute(target);

    if (this.#usesConfiguredPipelines()) {
      const pipelinePlan = await this.#createPipelineExecutionPlan(
        target,
        context,
        requestId,
        signal,
        readSelectedRouteRequirements(selectedRoute),
      );

      if (pipelinePlan !== undefined) {
        return pipelinePlan;
      }
    }
    if (this.#usesConfiguredPipelines()) {
      if (selectedRoute === undefined && this.#options.plan === undefined) {
        return this.#envelopeBuilder.buildServiceError(500, {
          code: RESPONSE_CODE.REJECTED_BY_POLICY,
          message: 'No configured pipeline selected an execution plan.',
          retryable: false,
        });
      }
    }
    if (selectedRoute !== undefined) {
      if (selectedRoute.kind === ROUTE_SELECTION_RESULT_KIND.NO_MATCH) {
        return this.#envelopeBuilder.buildServiceError(404, {
          code: selectedRoute.code,
          message: selectedRoute.message,
          retryable: false,
        });
      }

      return this.#planConfiguredRoute(
        selectedRoute.route.plan,
        target,
        context,
        selectedRoute.route.requirements,
      );
    }
    if (this.#options.plan !== undefined) {
      return this.#planConfiguredRoute(this.#options.plan, target, context);
    }

    const providerSelection = selectProviderInstance(this.#options.providers);

    if (providerSelection.kind === PROVIDER_SELECTION_RESULT_KIND.NONE_ENABLED) {
      return this.#envelopeBuilder.buildServiceError(500, {
        code: RESPONSE_CODE.NO_PROVIDER_AVAILABLE,
        message: 'No enabled proxy provider is available.',
      });
    }

    await providerSelection.provider.adapter.getCapabilities();

    return createSingleAttemptPlan(providerSelection.provider);
  }

  #selectConfiguredRoute(
    target: GatewayTargetRequest,
  ): RouteSelectionResult<ProxyPlanConfig, ProxyRouteRequirements> | undefined {
    if (!this.#usesDeclarativeRouting()) {
      return undefined;
    }

    return selectRoute({
      ...(this.#options.defaultRoute === undefined ? {} : { defaultRoute: this.#options.defaultRoute }),
      routes: this.#options.routes ?? [],
      target: {
        method: target.method,
        url: target.url,
      },
    });
  }

  async #createPipelineExecutionPlan(
    target: GatewayTargetRequest,
    context: GatewayExecutionContext,
    requestId: string,
    signal: AbortSignal,
    routeRequirements: ProxyRouteRequirements | undefined,
  ): Promise<ProxyExecutionPlan | Response | undefined> {
    let state = createInitialPipelineState(target, context, this.#options.providers, routeRequirements);
    const engine = new ProxyPipelineEngine(createBuiltInPipelineStepRegistry(this.#options.stepRegistry));

    for (const pipeline of sortPipelines(this.#options.pipelines ?? [])) {
      const result = await engine.execute({
        initialState: state,
        pipeline,
        requestId,
        services: this.#createPipelineServices(target, context),
        signal,
      });

      state = result.state;

      if (result.kind === PIPELINE_RESULT_KIND.PLAN_SELECTED) {
        return result.plan;
      }
      if (result.kind === PIPELINE_RESULT_KIND.REJECTED) {
        return this.#envelopeBuilder.buildServiceError(result.decision.status ?? 403, {
          code: result.decision.code,
          message: result.decision.message,
          retryable: false,
        });
      }
      if (result.kind === PIPELINE_RESULT_KIND.STEP_NOT_FOUND) {
        return this.#envelopeBuilder.buildServiceError(500, {
          code: result.code,
          message: result.message,
          retryable: false,
        });
      }
      if (result.kind === PIPELINE_RESULT_KIND.COMPLETED && result.state.plan !== undefined) {
        return result.state.plan;
      }
    }

    return undefined;
  }

  #createPipelineServices(
    target: GatewayTargetRequest,
    context: GatewayExecutionContext,
  ): ProxyGatewayServices {
    return {
      planner: {
        plan: (input: {
          candidates: ProxyProviderCandidate[];
          plan: ProxyPlanConfig;
        }) => this.#planPipelineConfig(input.plan, target, context, input.candidates),
      },
      ...(this.#options.random === undefined ? {} : { random: this.#options.random }),
    };
  }

  async #planConfiguredRoute(
    planConfig: ProxyPlanConfig,
    target: GatewayTargetRequest,
    context: GatewayExecutionContext,
    routeRequirements?: ProxyRouteRequirements,
  ): Promise<ProxyExecutionPlan | Response> {
    const mergedPlanConfig = mergeRouteRequirementsIntoPlan(planConfig, routeRequirements);
    const plan = await this.#applySessionPin(mergedPlanConfig, target, context);

    if (isSessionPinRejected(plan)) {
      return this.#envelopeBuilder.buildServiceError(500, {
        code: plan.code,
        message: plan.message,
        retryable: false,
      });
    }

    const plannerResult = await this.#planExecutionConfig(plan);

    if (plannerResult.kind === PLANNER_RESULT_KIND.REJECTED) {
      return this.#envelopeBuilder.buildServiceError(500, {
        code: plannerResult.code,
        message: plannerResult.message,
        retryable: false,
      });
    }

    return plannerResult.plan;
  }

  async #planPipelineConfig(
    plan: ProxyPlanConfig,
    target: GatewayTargetRequest,
    context: GatewayExecutionContext,
    candidates: ProxyProviderCandidate[],
  ): Promise<ExecutionPlannerResult> {
    const pinnedPlan = await this.#applySessionPin(plan, target, context);

    if (isSessionPinRejected(pinnedPlan)) {
      return {
        code: pinnedPlan.code,
        kind: PLANNER_RESULT_KIND.REJECTED,
        message: pinnedPlan.message,
      };
    }

    return this.#planExecutionConfig(pinnedPlan, candidates);
  }

  #planExecutionConfig(
    plan: ProxyPlanConfig,
    candidates: ProxyProviderCandidate[] = [],
  ): Promise<ExecutionPlannerResult> {
    return new ExecutionPlanner({
      exitVerifierAvailable: this.#options.exitVerifier !== undefined,
      providers: orderProvidersForCandidates(this.#options.providers, candidates),
    }).plan({ plan });
  }

  #usesDeclarativeRouting(): boolean {
    return this.#options.routes !== undefined || this.#options.defaultRoute !== undefined;
  }

  #usesConfiguredPipelines(): boolean {
    return this.#options.pipelines !== undefined && this.#options.pipelines.length > 0;
  }

  async #applySessionPin(
    plan: ProxyPlanConfig,
    target: GatewayTargetRequest,
    context: GatewayExecutionContext,
  ): Promise<SessionPinResult> {
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
      return {
        code: RESPONSE_CODE.NO_PLANNABLE_PROVIDER,
        message: 'Sticky session provider is incompatible with the first plan attempt.',
      };
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

  async #writeSessionIfNeeded(input: {
    attempt: ProxyExecutionPlan['attempts'][number];
    context: GatewayExecutionContext;
    target: GatewayTargetRequest;
  }): Promise<void> {
    const identity = input.attempt.requirements?.identity;
    const ttlMs = identity?.stickySessionTtlMs;

    if (
      this.#options.sessionStore === undefined
      || identity === undefined
      || ttlMs === undefined
    ) {
      return;
    }

    const providerKind = input.attempt.providerKind ?? readProviderKind(
      this.#options.providers,
      input.attempt.providerInstanceId,
    );

    if (providerKind === undefined) {
      return;
    }

    const keyFactory = new SessionKeyFactory();
    const key = keyFactory.derive({
      context: input.context,
      identity,
      providerInstanceId: input.attempt.providerInstanceId,
      targetUrl: input.target.url,
    }).key;
    const staleKeys = deriveSessionCandidateKeys({
      context: input.context,
      identity,
      keyFactory,
      providers: this.#options.providers,
      targetUrl: input.target.url,
      winningKey: key,
    });
    const record: ProxySessionRecord = {
      expiresAt: new Date(Date.now() + ttlMs),
      identity,
      key,
      providerInstanceId: input.attempt.providerInstanceId,
      providerKind,
    };

    try {
      if (staleKeys.length > 0) {
        await this.#options.sessionStore.deleteMany(staleKeys);
      }

      await this.#options.sessionStore.setMany([record]);
    } catch {
      return;
    }
  }

  #createFinalUrlGuard(): TargetFinalUrlGuardPort {
    return {
      check: (input) => this.#targetAccessGuard.checkRedirectUrl(input.url, input.baseUrl),
    };
  }
}

type ProviderSelectionResult =
  | { kind: PROVIDER_SELECTION_RESULT_KIND.SELECTED; provider: ProxyProviderInstance }
  | { kind: PROVIDER_SELECTION_RESULT_KIND.NONE_ENABLED };

function selectProviderInstance(providers: ProxyProviderInstance[]): ProviderSelectionResult {
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

function createInitialPipelineState(
  target: GatewayTargetRequest,
  context: GatewayExecutionContext,
  providers: ProxyProviderInstance[],
  requirements: ProxyRouteRequirements | undefined,
): ProxyDecisionState {
  return {
    candidates: providers.flatMap((provider) => {
      if (provider.enabled === false) {
        return [];
      }

      return [
        {
          providerInstanceId: provider.id,
          providerKind: provider.adapter.kind,
          ...(provider.metadata === undefined ? {} : { metadata: provider.metadata }),
          ...(provider.priority === undefined ? {} : { priority: provider.priority }),
          ...(provider.tags === undefined ? {} : { tags: [...provider.tags] }),
          ...(provider.weight === undefined ? {} : { weight: provider.weight }),
        },
      ];
    }),
    context,
    facts: {},
    metadata: {},
    requirements: requirements ?? {},
    target,
  };
}

function readSelectedRouteRequirements(
  selectedRoute: RouteSelectionResult<ProxyPlanConfig, ProxyRouteRequirements> | undefined,
): ProxyRouteRequirements | undefined {
  return selectedRoute?.kind === ROUTE_SELECTION_RESULT_KIND.NO_MATCH ? undefined : selectedRoute?.route.requirements;
}

function isSessionPinRejected(result: SessionPinResult): result is ISessionPinRejected {
  return 'code' in result;
}

function sortPipelines<TPipeline extends { priority?: number }>(pipelines: TPipeline[]): TPipeline[] {
  return pipelines
    .map((pipeline, index) => ({
      index,
      pipeline,
    }))
    .sort((left, right) => {
      const priorityDelta = (right.pipeline.priority ?? 0) - (left.pipeline.priority ?? 0);

      return priorityDelta === 0 ? left.index - right.index : priorityDelta;
    })
    .map(({ pipeline }) => pipeline);
}

function orderProvidersForCandidates(
  providers: ProxyProviderInstance[],
  candidates: ProxyProviderCandidate[],
): ProxyProviderInstance[] {
  if (candidates.length === 0) {
    return providers;
  }

  const candidateIds = candidates.map((candidate) => candidate.providerInstanceId);
  const candidateProviders = candidateIds.flatMap((candidateId) => {
    const provider = providers.find((providerInstance) => providerInstance.id === candidateId);

    return provider === undefined ? [] : [provider];
  });
  const remainingProviders = providers.filter((provider) => !candidateIds.includes(provider.id));

  return [...candidateProviders, ...remainingProviders];
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

function deriveSessionCandidateKeys(input: {
  context: GatewayExecutionContext;
  identity: NonNullable<ProxyPlanAttemptConfig['requirements']>['identity'];
  keyFactory: SessionKeyFactory;
  providers: ProxyProviderInstance[];
  targetUrl: string;
  winningKey: string;
}): string[] {
  const providerIds = [
    undefined,
    ...input.providers.map((provider) => provider.id),
  ];
  const keys = new Set<string>();

  for (const providerInstanceId of providerIds) {
    const key = input.keyFactory.derive({
      context: input.context,
      ...(input.identity === undefined ? {} : { identity: input.identity }),
      ...(providerInstanceId === undefined ? {} : { providerInstanceId }),
      targetUrl: input.targetUrl,
    }).key;

    if (key !== input.winningKey) {
      keys.add(key);
    }
  }

  return [...keys];
}

function readProviderKind(
  providers: ProxyProviderInstance[],
  providerInstanceId: string,
): string | undefined {
  return providers.find((provider) => provider.id === providerInstanceId)?.adapter.kind;
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
