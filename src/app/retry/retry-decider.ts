import {
  PROXY_ATTEMPT_RESULT_OUTCOME,
  RETRY_CONDITION,
  RETRY_DECISION_KIND,
  RETRY_DECISION_REASON,
} from '../../constants';
import type { GatewayTargetRequest, ProxyExecutionPlan } from '../../ports/outbound';
import type { RetrySafetyPolicy } from '../types';

const DEFAULT_UNSAFE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
const IDEMPOTENCY_KEY_HEADER_NAME = 'idempotency-key';
const NON_RETRYABLE_OUTCOMES = new Set<PROXY_ATTEMPT_RESULT_OUTCOME>([
  PROXY_ATTEMPT_RESULT_OUTCOME.ABORTED,
  PROXY_ATTEMPT_RESULT_OUTCOME.GATEWAY_TIMEOUT,
  PROXY_ATTEMPT_RESULT_OUTCOME.REQUEST_BODY_NOT_REPLAYABLE,
  PROXY_ATTEMPT_RESULT_OUTCOME.RESPONSE_STREAM_ALREADY_STARTED,
  PROXY_ATTEMPT_RESULT_OUTCOME.SUCCESS,
]);

export interface RetryDeciderOptions {
  retrySafety?: RetrySafetyPolicy;
}

export interface RetryDeciderInput {
  attemptIndex: number;
  attemptNumber: number;
  outcome: PROXY_ATTEMPT_RESULT_OUTCOME;
  plan: ProxyExecutionPlan;
  retryCondition?: RETRY_CONDITION;
  retrySafety?: RetrySafetyPolicy;
  target: GatewayTargetRequest;
}

export type RetryDecision =
  | {
      kind: RETRY_DECISION_KIND.DO_NOT_RETRY;
      reason: RETRY_DECISION_REASON;
      retryCondition?: RETRY_CONDITION;
    }
  | {
      attemptIndex: number;
      kind: RETRY_DECISION_KIND.RETRY_SAME_ATTEMPT;
      providerInstanceId: string;
      retryCondition: RETRY_CONDITION;
    }
  | {
      attemptIndex: number;
      kind: RETRY_DECISION_KIND.FALLBACK_TO_NEXT_ATTEMPT;
      providerInstanceId: string;
      retryCondition: RETRY_CONDITION;
    };

export class RetryDecider {
  readonly #retrySafety: RetrySafetyPolicy | undefined;

  constructor(options: RetryDeciderOptions = {}) {
    this.#retrySafety = options.retrySafety;
  }

  decide(input: RetryDeciderInput): RetryDecision {
    if (NON_RETRYABLE_OUTCOMES.has(input.outcome)) {
      return doNotRetry(RETRY_DECISION_REASON.NON_RETRYABLE_OUTCOME, input.retryCondition);
    }

    const attempt = input.plan.attempts[input.attemptIndex];

    if (attempt === undefined) {
      return doNotRetry(RETRY_DECISION_REASON.ATTEMPT_NOT_FOUND, input.retryCondition);
    }
    if (input.retryCondition === undefined) {
      return doNotRetry(RETRY_DECISION_REASON.NO_RETRY_CONDITION);
    }
    if (attempt.retryOn?.includes(input.retryCondition) !== true) {
      return doNotRetry(RETRY_DECISION_REASON.RETRY_CONDITION_NOT_CONFIGURED, input.retryCondition);
    }
    if (input.target.body.replayability === 'non-replayable') {
      return doNotRetry(RETRY_DECISION_REASON.REQUEST_BODY_NOT_REPLAYABLE, input.retryCondition);
    }

    const retrySafety = mergeRetrySafety(this.#retrySafety, input.retrySafety);
    const unsafeMethodDecision = this.#decideUnsafeMethod(input, retrySafety);

    if (unsafeMethodDecision !== undefined) {
      return unsafeMethodDecision;
    }
    if (input.outcome !== PROXY_ATTEMPT_RESULT_OUTCOME.PROXY_AUTH_ERROR) {
      const maxAttempts = attempt.maxAttempts ?? 1;

      if (input.attemptNumber < maxAttempts) {
        return {
          attemptIndex: input.attemptIndex,
          kind: RETRY_DECISION_KIND.RETRY_SAME_ATTEMPT,
          providerInstanceId: attempt.providerInstanceId,
          retryCondition: input.retryCondition,
        };
      }
    }

    const fallbackAttempt = findFallbackAttempt(input);

    if (fallbackAttempt !== undefined) {
      return {
        attemptIndex: fallbackAttempt.index,
        kind: RETRY_DECISION_KIND.FALLBACK_TO_NEXT_ATTEMPT,
        providerInstanceId: fallbackAttempt.providerInstanceId,
        retryCondition: input.retryCondition,
      };
    }

    return doNotRetry(RETRY_DECISION_REASON.NO_FALLBACK_ATTEMPT_AVAILABLE, input.retryCondition);
  }

  #decideUnsafeMethod(
    input: RetryDeciderInput,
    retrySafety: Required<RetrySafetyPolicy>,
  ): Extract<RetryDecision, { kind: RETRY_DECISION_KIND.DO_NOT_RETRY }> | undefined {
    if (!isUnsafeMethod(input.target.method, retrySafety.unsafeMethods)) {
      return undefined;
    }
    if (!retrySafety.retryUnsafeMethods) {
      return doNotRetry(RETRY_DECISION_REASON.UNSAFE_METHOD, input.retryCondition);
    }
    if (
      retrySafety.requireIdempotencyKeyForUnsafeRetries
      && !hasHeader(input.target.headers, IDEMPOTENCY_KEY_HEADER_NAME)
    ) {
      return doNotRetry(RETRY_DECISION_REASON.IDEMPOTENCY_KEY_REQUIRED, input.retryCondition);
    }

    return undefined;
  }
}

function findFallbackAttempt(input: RetryDeciderInput): { index: number; providerInstanceId: string } | undefined {
  const currentAttempt = input.plan.attempts[input.attemptIndex];

  for (let index = input.attemptIndex + 1; index < input.plan.attempts.length; index += 1) {
    const fallbackAttempt = input.plan.attempts[index];

    if (fallbackAttempt === undefined) {
      continue;
    }
    if (
      input.outcome === PROXY_ATTEMPT_RESULT_OUTCOME.PROXY_AUTH_ERROR
      && fallbackAttempt.providerInstanceId === currentAttempt?.providerInstanceId
    ) {
      continue;
    }

    return {
      index,
      providerInstanceId: fallbackAttempt.providerInstanceId,
    };
  }

  return undefined;
}

function doNotRetry(
  reason: RETRY_DECISION_REASON,
  retryCondition?: RETRY_CONDITION,
): Extract<RetryDecision, { kind: RETRY_DECISION_KIND.DO_NOT_RETRY }> {
  const decision: Extract<RetryDecision, { kind: RETRY_DECISION_KIND.DO_NOT_RETRY }> = {
    kind: RETRY_DECISION_KIND.DO_NOT_RETRY,
    reason,
  };

  if (retryCondition !== undefined) {
    decision.retryCondition = retryCondition;
  }

  return decision;
}

function mergeRetrySafety(
  base: RetrySafetyPolicy | undefined,
  override: RetrySafetyPolicy | undefined,
): Required<RetrySafetyPolicy> {
  return {
    requireIdempotencyKeyForUnsafeRetries:
      override?.requireIdempotencyKeyForUnsafeRetries
      ?? base?.requireIdempotencyKeyForUnsafeRetries
      ?? true,
    retryUnsafeMethods: override?.retryUnsafeMethods ?? base?.retryUnsafeMethods ?? false,
    unsafeMethods: override?.unsafeMethods ?? base?.unsafeMethods ?? DEFAULT_UNSAFE_METHODS,
  };
}

function isUnsafeMethod(method: string, unsafeMethods: string[]): boolean {
  const normalizedMethod = method.toUpperCase();

  return unsafeMethods.some((unsafeMethod) => unsafeMethod.toUpperCase() === normalizedMethod);
}

function hasHeader(headers: Array<[string, string]>, headerName: string): boolean {
  const normalizedHeaderName = headerName.toLowerCase();

  return headers.some(([name, value]) => name.toLowerCase() === normalizedHeaderName && value.length > 0);
}
