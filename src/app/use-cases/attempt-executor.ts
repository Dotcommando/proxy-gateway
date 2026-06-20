import {
  ATTEMPT_EXECUTOR_RESULT_KIND,
  GATEWAY_EVENT_TYPE,
  PROXY_ATTEMPT_RESULT_OUTCOME,
  PROXY_GEO_STRICTNESS,
  RESPONSE_CODE,
  RETRY_DECISION_KIND,
} from '../../constants';
import type {
  GatewayEvent,
  GatewayExecutionContext,
  GatewayTargetRequest,
  GatewayTargetResponse,
  ProxyAttemptResult,
  ProxyExecutionAttempt,
  ProxyExecutionPlan,
  ProxyExitVerifierPort,
  ProxyLease,
  ProxyProviderInstance,
  TargetFinalUrlGuardPort,
  TargetTransportPort,
} from '../../ports/outbound';
import { BodyBufferLimitExceededError, BodyBufferManager } from '../buffering/body-buffer-manager';
import { type ClassifiedAttempt, ResultClassifier } from '../classification';
import { RetryDecider } from '../retry';
import {
  mapTimeoutObservationToOutcome,
  readTimeoutObservation,
  TimeoutController,
} from '../timeouts';

export interface AttemptExecutorOptions {
  bodyBufferManager: BodyBufferManager;
  exitVerifier?: ProxyExitVerifierPort;
  providers: ProxyProviderInstance[];
  resultClassifier: ResultClassifier;
  retryDecider?: RetryDecider;
  timeoutController: TimeoutController;
  transport: TargetTransportPort;
}

export interface AttemptExecutorInput {
  attemptTimeoutMs?: number;
  context: GatewayExecutionContext;
  finalUrlGuard?: TargetFinalUrlGuardPort;
  parentSignal: AbortSignal;
  plan: ProxyExecutionPlan;
  requestId: string;
  target: GatewayTargetRequest;
}

export type AttemptExecutorResult =
  | {
      attempt: ProxyExecutionAttempt;
      classified: ClassifiedAttempt;
      events: GatewayEvent[];
      kind: ATTEMPT_EXECUTOR_RESULT_KIND.COMPLETED;
      response: GatewayTargetResponse;
    }
  | {
      attempt?: ProxyExecutionAttempt;
      classified: ClassifiedAttempt;
      events: GatewayEvent[];
      kind: ATTEMPT_EXECUTOR_RESULT_KIND.FAILED;
    };

export class AttemptExecutor {
  readonly #bodyBufferManager: BodyBufferManager;
  readonly #exitVerifier: ProxyExitVerifierPort | undefined;
  readonly #providers: ProxyProviderInstance[];
  readonly #resultClassifier: ResultClassifier;
  readonly #retryDecider: RetryDecider;
  readonly #timeoutController: TimeoutController;
  readonly #transport: TargetTransportPort;

  constructor(options: AttemptExecutorOptions) {
    this.#bodyBufferManager = options.bodyBufferManager;
    this.#exitVerifier = options.exitVerifier;
    this.#providers = options.providers;
    this.#resultClassifier = options.resultClassifier;
    this.#retryDecider = options.retryDecider ?? new RetryDecider();
    this.#timeoutController = options.timeoutController;
    this.#transport = options.transport;
  }

  async execute(input: AttemptExecutorInput): Promise<AttemptExecutorResult> {
    let attemptIndex = 0;
    let attemptNumber = 1;
    const events: GatewayEvent[] = [];

    while (true) {
      const attempt = input.plan.attempts[attemptIndex];

      if (attempt === undefined) {
        return this.#failed({
          classified: this.#resultClassifier.classifyFailure({
            message: 'Execution plan does not contain an attempt.',
            outcome: PROXY_ATTEMPT_RESULT_OUTCOME.REJECTED_BY_POLICY,
            target: input.target,
          }),
          events,
        });
      }

      const result = await this.#executePlannedAttempt({
        attempt,
        attemptIndex,
        attemptNumber,
        context: input.context,
        ...(input.finalUrlGuard !== undefined && { finalUrlGuard: input.finalUrlGuard }),
        parentSignal: input.parentSignal,
        requestId: input.requestId,
        target: input.target,
        ...(input.attemptTimeoutMs !== undefined && { attemptTimeoutMs: input.attemptTimeoutMs }),
      });

      events.push(...result.events);

      const decision = this.#retryDecider.decide({
        attemptIndex,
        attemptNumber,
        outcome: result.classified.attemptResult.outcome,
        plan: input.plan,
        target: input.target,
        ...(result.classified.retryCondition !== undefined && {
          retryCondition: result.classified.retryCondition,
        }),
      });

      if (decision.kind === RETRY_DECISION_KIND.RETRY_SAME_ATTEMPT) {
        attemptNumber += 1;
        continue;
      }
      if (decision.kind === RETRY_DECISION_KIND.FALLBACK_TO_NEXT_ATTEMPT) {
        attemptIndex = decision.attemptIndex;
        attemptNumber = 1;
        continue;
      }

      return withEvents(result, events);
    }
  }

  async #executePlannedAttempt(input: {
    attempt: ProxyExecutionAttempt;
    attemptIndex: number;
    attemptNumber: number;
    attemptTimeoutMs?: number;
    context: GatewayExecutionContext;
    finalUrlGuard?: TargetFinalUrlGuardPort;
    parentSignal: AbortSignal;
    requestId: string;
    target: GatewayTargetRequest;
  }): Promise<AttemptExecutorResult> {
    const provider = this.#providers.find(
      (candidate) => candidate.id === input.attempt.providerInstanceId && candidate.enabled !== false,
    );

    if (provider === undefined) {
      return this.#failed({
        attempt: input.attempt,
        classified: this.#resultClassifier.classifyFailure({
          message: `Provider instance "${input.attempt.providerInstanceId}" was not found or is disabled.`,
          outcome: PROXY_ATTEMPT_RESULT_OUTCOME.REJECTED_BY_POLICY,
          target: input.target,
        }),
        events: [],
      });
    }

    const attemptScope = this.#timeoutController.createAttemptScope({
      parentSignal: input.parentSignal,
      ...(input.attemptTimeoutMs === undefined ? {} : { timeoutMs: input.attemptTimeoutMs }),
    });

    try {
      return await this.#executeAttemptWithScope({
        attempt: input.attempt,
        attemptIndex: input.attemptIndex,
        attemptSignal: attemptScope.signal,
        context: input.context,
        ...(input.finalUrlGuard !== undefined && { finalUrlGuard: input.finalUrlGuard }),
        provider,
        requestId: input.requestId,
        target: input.target,
        timeoutScope: attemptScope,
      });
    } finally {
      attemptScope.dispose();
    }
  }

  async #executeAttemptWithScope(input: {
    attempt: ProxyExecutionAttempt;
    attemptIndex: number;
    attemptSignal: AbortSignal;
    context: GatewayExecutionContext;
    finalUrlGuard?: TargetFinalUrlGuardPort;
    provider: ProxyProviderInstance;
    requestId: string;
    target: GatewayTargetRequest;
    timeoutScope: Parameters<TimeoutController['race']>[1];
  }): Promise<AttemptExecutorResult> {
    let lease: ProxyLease;

    try {
      lease = await this.#timeoutController.race(
        input.provider.adapter.acquire({
          attempt: { index: input.attemptIndex },
          context: input.context,
          providerInstanceId: input.provider.id,
          requestId: input.requestId,
          requirements: input.attempt.requirements ?? {},
          signal: input.attemptSignal,
          target: input.target,
        }),
        input.timeoutScope,
      );
    } catch (error) {
      return this.#failed({
        attempt: input.attempt,
        classified: this.#classifyAcquireFailure(error, input.target),
        events: [],
      });
    }

    if (this.#transport.supportsRoute?.(lease.route) === false) {
      const message = `Target transport does not support route kind: ${lease.route.kind}.`;
      const classified = this.#resultClassifier.classifyFailure({
        message,
        outcome: PROXY_ATTEMPT_RESULT_OUTCOME.UNSUPPORTED_ROUTE,
        route: lease.route,
        target: input.target,
      });
      const events = await releaseBestEffort(input.provider, lease, classified.attemptResult);

      return this.#failed({
        attempt: input.attempt,
        classified,
        events,
      });
    }

    const verificationResult = await this.#verifyLeaseIfRequired({
      attempt: input.attempt,
      attemptSignal: input.attemptSignal,
      lease,
      requestId: input.requestId,
      target: input.target,
      timeoutScope: input.timeoutScope,
    });

    if ('attemptResult' in verificationResult) {
      const events = await releaseBestEffort(input.provider, lease, verificationResult.attemptResult);

      return this.#failed({
        attempt: input.attempt,
        classified: verificationResult,
        events,
      });
    }

    lease = verificationResult;

    try {
      const targetResponse = await this.#timeoutController.race(
        this.#transport.execute({
          ...(input.finalUrlGuard !== undefined && { finalUrlGuard: input.finalUrlGuard }),
          requestId: input.requestId,
          route: lease.route,
          signal: input.attemptSignal,
          target: input.target,
        }),
        input.timeoutScope,
      );
      const bufferedResponse = await this.#timeoutController.race(
        this.#bodyBufferManager.bufferResponseBody(targetResponse),
        input.timeoutScope,
      );
      const classified = this.#resultClassifier.classifyTargetResponse(bufferedResponse);
      const events = await releaseBestEffort(input.provider, lease, classified.attemptResult);

      return {
        attempt: input.attempt,
        classified,
        events,
        kind: ATTEMPT_EXECUTOR_RESULT_KIND.COMPLETED,
        response: bufferedResponse,
      };
    } catch (error) {
      const classified = this.#classifyPostLeaseFailure(error, lease, input.target);
      const events = await releaseBestEffort(input.provider, lease, classified.attemptResult);

      return this.#failed({
        attempt: input.attempt,
        classified,
        events,
      });
    }
  }

  #classifyAcquireFailure(error: unknown, target: GatewayTargetRequest): ClassifiedAttempt {
    const timeoutObservation = readTimeoutObservation(error);

    if (timeoutObservation !== undefined) {
      return this.#resultClassifier.classifyFailure({
        outcome: mapTimeoutObservationToOutcome(timeoutObservation),
        target,
      });
    }
    if (readErrorCode(error) === RESPONSE_CODE.PROXY_AUTH_ERROR) {
      return this.#resultClassifier.classifyFailure({
        message: readErrorMessage(error) ?? 'Proxy authentication failed.',
        outcome: PROXY_ATTEMPT_RESULT_OUTCOME.PROXY_AUTH_ERROR,
        target,
      });
    }

    return this.#resultClassifier.classifyFailure({
      message: 'Proxy connection failed.',
      outcome: PROXY_ATTEMPT_RESULT_OUTCOME.PROXY_CONNECTION_ERROR,
      target,
    });
  }

  #classifyPostLeaseFailure(
    error: unknown,
    lease: ProxyLease,
    target: GatewayTargetRequest,
  ): ClassifiedAttempt {
    const timeoutObservation = readTimeoutObservation(error);

    if (timeoutObservation !== undefined) {
      return this.#resultClassifier.classifyFailure({
        outcome: mapTimeoutObservationToOutcome(timeoutObservation),
        route: lease.route,
        target,
      });
    }
    if (error instanceof BodyBufferLimitExceededError && error.direction === 'response') {
      return this.#resultClassifier.classifyFailure({
        message: 'Response buffering failed.',
        outcome: PROXY_ATTEMPT_RESULT_OUTCOME.GATEWAY_ERROR,
        route: lease.route,
        target,
      });
    }
    if (readErrorCode(error) === RESPONSE_CODE.RESPONSE_STREAM_ALREADY_STARTED) {
      return this.#resultClassifier.classifyFailure({
        message: readErrorMessage(error) ?? 'Response stream already started.',
        outcome: PROXY_ATTEMPT_RESULT_OUTCOME.RESPONSE_STREAM_ALREADY_STARTED,
        route: lease.route,
        target,
      });
    }

    return this.#resultClassifier.classifyFailure({
      message: 'Target transport execution failed.',
      outcome: PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_NETWORK_ERROR,
      route: lease.route,
      target,
    });
  }

  #failed(input: {
    attempt?: ProxyExecutionAttempt;
    classified: ClassifiedAttempt;
    events: GatewayEvent[];
  }): AttemptExecutorResult {
    const result: AttemptExecutorResult = {
      classified: input.classified,
      events: input.events,
      kind: ATTEMPT_EXECUTOR_RESULT_KIND.FAILED,
    };

    if (input.attempt !== undefined) {
      result.attempt = input.attempt;
    }

    return result;
  }

  async #verifyLeaseIfRequired(input: {
    attempt: ProxyExecutionAttempt;
    attemptSignal: AbortSignal;
    lease: ProxyLease;
    requestId: string;
    target: GatewayTargetRequest;
    timeoutScope: Parameters<TimeoutController['race']>[1];
  }): Promise<ProxyLease | ClassifiedAttempt> {
    if (input.attempt.verification?.verifyExit !== true) {
      return input.lease;
    }
    if (this.#exitVerifier === undefined) {
      return this.#resultClassifier.classifyFailure({
        message: 'Proxy exit verification failed.',
        outcome: PROXY_ATTEMPT_RESULT_OUTCOME.EXIT_VERIFICATION_FAILED,
        route: input.lease.route,
        target: input.target,
      });
    }

    try {
      const verification = await this.#timeoutController.race(
        this.#exitVerifier.verify({
          lease: input.lease,
          requestId: input.requestId,
          route: input.lease.route,
          signal: input.attemptSignal,
          ...(input.attempt.requirements?.geo !== undefined && {
            expected: input.attempt.requirements.geo,
          }),
        }),
        input.timeoutScope,
      );

      if (!verification.matchesRequirements && shouldRejectGeoMismatch(input.attempt)) {
        return this.#resultClassifier.classifyFailure({
          message: 'Proxy exit did not match geo requirements.',
          outcome: PROXY_ATTEMPT_RESULT_OUTCOME.PROXY_GEO_MISMATCH,
          route: input.lease.route,
          target: input.target,
        });
      }

      return {
        ...input.lease,
        verification,
      };
    } catch (error) {
      const timeoutObservation = readTimeoutObservation(error);

      if (timeoutObservation !== undefined) {
        return this.#resultClassifier.classifyFailure({
          outcome: mapTimeoutObservationToOutcome(timeoutObservation),
          route: input.lease.route,
          target: input.target,
        });
      }

      return this.#resultClassifier.classifyFailure({
        message: 'Proxy exit verification failed.',
        outcome: PROXY_ATTEMPT_RESULT_OUTCOME.EXIT_VERIFICATION_FAILED,
        route: input.lease.route,
        target: input.target,
      });
    }
  }
}

function shouldRejectGeoMismatch(attempt: ProxyExecutionAttempt): boolean {
  return (
    attempt.verification?.rejectOnGeoMismatch === true
    || attempt.requirements?.geo?.strictness === PROXY_GEO_STRICTNESS.REQUIRED
  );
}

function readErrorCode(error: unknown): RESPONSE_CODE | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  return isResponseCode(error.code) ? error.code : undefined;
}

function readErrorMessage(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('message' in error)) {
    return undefined;
  }

  return typeof error.message === 'string' ? error.message : undefined;
}

function isResponseCode(value: unknown): value is RESPONSE_CODE {
  return Object.values(RESPONSE_CODE).some((code) => code === value);
}

function withEvents(result: AttemptExecutorResult, events: GatewayEvent[]): AttemptExecutorResult {
  if (result.kind === ATTEMPT_EXECUTOR_RESULT_KIND.COMPLETED) {
    return {
      ...result,
      events,
    };
  }

  return {
    ...result,
    events,
  };
}

async function releaseBestEffort(
  provider: ProxyProviderInstance,
  lease: ProxyLease,
  result: ProxyAttemptResult,
): Promise<GatewayEvent[]> {
  try {
    await provider.adapter.release?.(lease, result);

    return [];
  } catch {
    return [
      {
        message: 'Provider release failed.',
        metadata: {
          leaseId: lease.id,
          providerInstanceId: provider.id,
        },
        type: GATEWAY_EVENT_TYPE.PROVIDER_RELEASE_FAILED,
      },
    ];
  }
}
