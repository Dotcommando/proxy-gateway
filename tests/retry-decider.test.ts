import { describe, expect, it } from '@jest/globals';

import {
  type GatewayTargetRequest,
  PROXY_ATTEMPT_RESULT_OUTCOME,
  PROXY_PLAN_KIND,
  type ProxyExecutionPlan,
  RETRY_CONDITION,
  RETRY_DECISION_KIND,
  RETRY_DECISION_REASON,
} from '../src';
import { RetryDecider } from '../src/app/retry';

describe('RetryDecider', () => {
  it('uses package enums for retry decision kinds and existing retry conditions', () => {
    expect(RETRY_DECISION_KIND.DO_NOT_RETRY).toBe('do-not-retry');
    expect(RETRY_DECISION_KIND.RETRY_SAME_ATTEMPT).toBe('retry-same-attempt');
    expect(RETRY_DECISION_KIND.FALLBACK_TO_NEXT_ATTEMPT).toBe('fallback-to-next-attempt');
    expect(RETRY_CONDITION.HTTP_500).toBe('http-500');
  });

  it('does not retry target HTTP statuses by default', () => {
    const decision = new RetryDecider().decide({
      attemptIndex: 0,
      attemptNumber: 1,
      outcome: PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_HTTP_ERROR,
      plan: plan([{ providerInstanceId: 'provider-a' }]),
      retryCondition: RETRY_CONDITION.HTTP_500,
      target: targetRequest(),
    });

    expect(decision).toEqual({
      kind: RETRY_DECISION_KIND.DO_NOT_RETRY,
      reason: RETRY_DECISION_REASON.RETRY_CONDITION_NOT_CONFIGURED,
      retryCondition: RETRY_CONDITION.HTTP_500,
    });
  });

  it('retries configured HTTP status conditions on the same planned attempt while attempts remain', () => {
    const decision = new RetryDecider().decide({
      attemptIndex: 0,
      attemptNumber: 1,
      outcome: PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_HTTP_ERROR,
      plan: plan([
        {
          maxAttempts: 2,
          providerInstanceId: 'provider-a',
          retryOn: [RETRY_CONDITION.HTTP_500],
        },
      ]),
      retryCondition: RETRY_CONDITION.HTTP_500,
      target: targetRequest(),
    });

    expect(decision).toEqual({
      attemptIndex: 0,
      kind: RETRY_DECISION_KIND.RETRY_SAME_ATTEMPT,
      providerInstanceId: 'provider-a',
      retryCondition: RETRY_CONDITION.HTTP_500,
    });
  });

  it('falls back to the next planned attempt when same-attempt retries are exhausted', () => {
    const decision = new RetryDecider().decide({
      attemptIndex: 0,
      attemptNumber: 1,
      outcome: PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_NETWORK_ERROR,
      plan: plan([
        {
          providerInstanceId: 'provider-a',
          retryOn: [RETRY_CONDITION.TARGET_NETWORK_ERROR],
        },
        {
          providerInstanceId: 'provider-b',
          retryOn: [RETRY_CONDITION.TARGET_NETWORK_ERROR],
        },
      ]),
      retryCondition: RETRY_CONDITION.TARGET_NETWORK_ERROR,
      target: targetRequest(),
    });

    expect(decision).toEqual({
      attemptIndex: 1,
      kind: RETRY_DECISION_KIND.FALLBACK_TO_NEXT_ATTEMPT,
      providerInstanceId: 'provider-b',
      retryCondition: RETRY_CONDITION.TARGET_NETWORK_ERROR,
    });
  });

  it('does not retry proxy auth errors on the same provider but may fallback to another planned provider', () => {
    const sameProviderDecision = new RetryDecider().decide({
      attemptIndex: 0,
      attemptNumber: 1,
      outcome: PROXY_ATTEMPT_RESULT_OUTCOME.PROXY_AUTH_ERROR,
      plan: plan([
        {
          maxAttempts: 3,
          providerInstanceId: 'provider-a',
          retryOn: [RETRY_CONDITION.PROXY_AUTH_ERROR],
        },
      ]),
      retryCondition: RETRY_CONDITION.PROXY_AUTH_ERROR,
      target: targetRequest(),
    });
    const fallbackDecision = new RetryDecider().decide({
      attemptIndex: 0,
      attemptNumber: 1,
      outcome: PROXY_ATTEMPT_RESULT_OUTCOME.PROXY_AUTH_ERROR,
      plan: plan([
        {
          maxAttempts: 3,
          providerInstanceId: 'provider-a',
          retryOn: [RETRY_CONDITION.PROXY_AUTH_ERROR],
        },
        {
          providerInstanceId: 'provider-b',
          retryOn: [RETRY_CONDITION.PROXY_AUTH_ERROR],
        },
      ]),
      retryCondition: RETRY_CONDITION.PROXY_AUTH_ERROR,
      target: targetRequest(),
    });

    expect(sameProviderDecision).toEqual({
      kind: RETRY_DECISION_KIND.DO_NOT_RETRY,
      reason: RETRY_DECISION_REASON.NO_FALLBACK_ATTEMPT_AVAILABLE,
      retryCondition: RETRY_CONDITION.PROXY_AUTH_ERROR,
    });
    expect(fallbackDecision).toEqual({
      attemptIndex: 1,
      kind: RETRY_DECISION_KIND.FALLBACK_TO_NEXT_ATTEMPT,
      providerInstanceId: 'provider-b',
      retryCondition: RETRY_CONDITION.PROXY_AUTH_ERROR,
    });
  });

  it('does not retry unsafe methods by default', () => {
    const decision = new RetryDecider().decide({
      attemptIndex: 0,
      attemptNumber: 1,
      outcome: PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_NETWORK_ERROR,
      plan: plan([
        {
          maxAttempts: 2,
          providerInstanceId: 'provider-a',
          retryOn: [RETRY_CONDITION.TARGET_NETWORK_ERROR],
        },
      ]),
      retryCondition: RETRY_CONDITION.TARGET_NETWORK_ERROR,
      target: targetRequest({ method: 'POST' }),
    });

    expect(decision).toEqual({
      kind: RETRY_DECISION_KIND.DO_NOT_RETRY,
      reason: RETRY_DECISION_REASON.UNSAFE_METHOD,
      retryCondition: RETRY_CONDITION.TARGET_NETWORK_ERROR,
    });
  });

  it('does not retry non-replayable bodies', () => {
    const decision = new RetryDecider().decide({
      attemptIndex: 0,
      attemptNumber: 1,
      outcome: PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_NETWORK_ERROR,
      plan: plan([
        {
          maxAttempts: 2,
          providerInstanceId: 'provider-a',
          retryOn: [RETRY_CONDITION.TARGET_NETWORK_ERROR],
        },
      ]),
      retryCondition: RETRY_CONDITION.TARGET_NETWORK_ERROR,
      target: targetRequest({
        body: {
          kind: 'stream',
          replayability: 'non-replayable',
          stream: new ReadableStream<Uint8Array>(),
        },
      }),
    });

    expect(decision).toEqual({
      kind: RETRY_DECISION_KIND.DO_NOT_RETRY,
      reason: RETRY_DECISION_REASON.REQUEST_BODY_NOT_REPLAYABLE,
      retryCondition: RETRY_CONDITION.TARGET_NETWORK_ERROR,
    });
  });

  it('retries unsafe methods only when explicitly allowed and idempotency-key requirements are met', () => {
    const decider = new RetryDecider({
      retrySafety: {
        requireIdempotencyKeyForUnsafeRetries: true,
        retryUnsafeMethods: true,
      },
    });
    const missingKeyDecision = decider.decide({
      attemptIndex: 0,
      attemptNumber: 1,
      outcome: PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_NETWORK_ERROR,
      plan: retryablePostPlan(),
      retryCondition: RETRY_CONDITION.TARGET_NETWORK_ERROR,
      target: targetRequest({ method: 'POST' }),
    });
    const withKeyDecision = decider.decide({
      attemptIndex: 0,
      attemptNumber: 1,
      outcome: PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_NETWORK_ERROR,
      plan: retryablePostPlan(),
      retryCondition: RETRY_CONDITION.TARGET_NETWORK_ERROR,
      target: targetRequest({
        headers: [['idempotency-key', 'operation-1']],
        method: 'POST',
      }),
    });

    expect(missingKeyDecision).toEqual({
      kind: RETRY_DECISION_KIND.DO_NOT_RETRY,
      reason: RETRY_DECISION_REASON.IDEMPOTENCY_KEY_REQUIRED,
      retryCondition: RETRY_CONDITION.TARGET_NETWORK_ERROR,
    });
    expect(withKeyDecision).toEqual({
      attemptIndex: 0,
      kind: RETRY_DECISION_KIND.RETRY_SAME_ATTEMPT,
      providerInstanceId: 'provider-a',
      retryCondition: RETRY_CONDITION.TARGET_NETWORK_ERROR,
    });
  });

  it('never retries caller abort, total gateway timeout, or response stream already started', () => {
    const decider = new RetryDecider();
    const retryablePlan = plan([
      {
        maxAttempts: 2,
        providerInstanceId: 'provider-a',
        retryOn: [
          RETRY_CONDITION.GATEWAY_TIMEOUT,
          RETRY_CONDITION.TARGET_NETWORK_ERROR,
        ],
      },
      {
        providerInstanceId: 'provider-b',
        retryOn: [RETRY_CONDITION.GATEWAY_TIMEOUT],
      },
    ]);

    expect(
      decider.decide({
        attemptIndex: 0,
        attemptNumber: 1,
        outcome: PROXY_ATTEMPT_RESULT_OUTCOME.ABORTED,
        plan: retryablePlan,
        target: targetRequest(),
      }),
    ).toEqual({
      kind: RETRY_DECISION_KIND.DO_NOT_RETRY,
      reason: RETRY_DECISION_REASON.NON_RETRYABLE_OUTCOME,
    });
    expect(
      decider.decide({
        attemptIndex: 0,
        attemptNumber: 1,
        outcome: PROXY_ATTEMPT_RESULT_OUTCOME.GATEWAY_TIMEOUT,
        plan: retryablePlan,
        retryCondition: RETRY_CONDITION.GATEWAY_TIMEOUT,
        target: targetRequest(),
      }),
    ).toEqual({
      kind: RETRY_DECISION_KIND.DO_NOT_RETRY,
      reason: RETRY_DECISION_REASON.NON_RETRYABLE_OUTCOME,
      retryCondition: RETRY_CONDITION.GATEWAY_TIMEOUT,
    });
    expect(
      decider.decide({
        attemptIndex: 0,
        attemptNumber: 1,
        outcome: PROXY_ATTEMPT_RESULT_OUTCOME.RESPONSE_STREAM_ALREADY_STARTED,
        plan: retryablePlan,
        target: targetRequest(),
      }),
    ).toEqual({
      kind: RETRY_DECISION_KIND.DO_NOT_RETRY,
      reason: RETRY_DECISION_REASON.NON_RETRYABLE_OUTCOME,
    });
  });
});

function retryablePostPlan(): ProxyExecutionPlan {
  return plan([
    {
      maxAttempts: 2,
      providerInstanceId: 'provider-a',
      retryOn: [RETRY_CONDITION.TARGET_NETWORK_ERROR],
    },
  ]);
}

function plan(attempts: ProxyExecutionPlan['attempts']): ProxyExecutionPlan {
  return {
    attempts,
    kind: PROXY_PLAN_KIND.FALLBACK,
  };
}

function targetRequest(overrides: Partial<GatewayTargetRequest> = {}): GatewayTargetRequest {
  return {
    body: {
      kind: 'none',
      replayability: 'replayable',
    },
    fetch: {},
    headers: [],
    method: 'GET',
    url: 'https://example.com/resource',
    ...overrides,
  };
}
