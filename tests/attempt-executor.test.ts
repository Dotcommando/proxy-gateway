import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  ATTEMPT_EXECUTOR_RESULT_KIND,
  GATEWAY_EVENT_TYPE,
  type GatewayExecutionContext,
  type GatewayTargetRequest,
  type GatewayTargetResponse,
  PROXY_ATTEMPT_RESULT_OUTCOME,
  PROXY_GEO_STRICTNESS,
  PROXY_PLAN_KIND,
  PROXY_PROTOCOL,
  PROXY_PROVIDER_GEO_MODE,
  PROXY_ROUTE_AUTH_MODE,
  PROXY_ROUTE_KIND,
  type ProxyAcquireInput,
  type ProxyAttemptResult,
  type ProxyExecutionPlan,
  type ProxyExitVerifierPort,
  type ProxyLease,
  type ProxyProviderInstance,
  type ProxyRoute,
  RESPONSE_CODE,
  RETRY_CONDITION,
  type TargetTransportPort,
} from '../src';
import { BodyBufferManager } from '../src/app/buffering/body-buffer-manager';
import { ResultClassifier } from '../src/app/classification';
import { TimeoutController } from '../src/app/timeouts';
import { AttemptExecutor } from '../src/app/use-cases/attempt-executor';

describe('AttemptExecutor', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses package enums for executor result kinds and release failure events', () => {
    expect(ATTEMPT_EXECUTOR_RESULT_KIND.COMPLETED).toBe('completed');
    expect(ATTEMPT_EXECUTOR_RESULT_KIND.FAILED).toBe('failed');
    expect(GATEWAY_EVENT_TYPE.PROVIDER_RELEASE_FAILED).toBe('provider-release-failed');
  });

  it('passes normalized target, context, requirements, request id, provider id, attempt context, and active signal to acquire', async () => {
    const acquired: ProxyAcquireInput[] = [];
    const executedRoutes: ProxyRoute[] = [];
    const releasedResults: ProxyAttemptResult[] = [];
    const requirements = {
      geo: {
        country: 'DE',
        strictness: PROXY_GEO_STRICTNESS.REQUIRED,
      },
    };
    const verification = {
      rejectOnGeoMismatch: true,
      verifyExit: true,
    };
    const provider = directProvider({
      acquire: async (input) => {
        acquired.push(input);

        return directLease({
          route: {
            kind: PROXY_ROUTE_KIND.DIRECT,
          },
        });
      },
      release: async (_lease, result) => {
        releasedResults.push(result);
      },
    });
    const transport: TargetTransportPort = {
      execute: async (input) => {
        executedRoutes.push(input.route);

        return okTargetResponse();
      },
    };
    const executor = createExecutor({
      exitVerifier: {
        verify: async () => exitVerification({ country: 'DE', matchesRequirements: true }),
      },
      providers: [provider],
      transport,
    });
    const target = targetRequest();
    const context: GatewayExecutionContext = {
      flowKey: 'flow-1',
      useCase: 'test',
    };
    const result = await executor.execute({
      attemptTimeoutMs: 1000,
      context,
      parentSignal: new AbortController().signal,
      plan: plan([
        {
          providerInstanceId: 'provider-a',
          providerKind: 'test-provider',
          requirements,
          verification,
        },
      ]),
      requestId: 'request-1',
      target,
    });

    expect(result.kind).toBe(ATTEMPT_EXECUTOR_RESULT_KIND.COMPLETED);
    expect(acquired).toHaveLength(1);
    expect(acquired[0]).toMatchObject({
      attempt: { index: 0 },
      context,
      providerInstanceId: 'provider-a',
      requestId: 'request-1',
      requirements,
      target,
    });
    expect(acquired[0]?.signal.aborted).toBe(false);
    expect(executedRoutes).toEqual([{ kind: PROXY_ROUTE_KIND.DIRECT }]);
    expect(releasedResults).toEqual([
      {
        outcome: PROXY_ATTEMPT_RESULT_OUTCOME.SUCCESS,
        response: okTargetResponse(),
      },
    ]);

    if (result.kind === ATTEMPT_EXECUTOR_RESULT_KIND.COMPLETED) {
      expect(result.attempt.verification).toEqual(verification);
    }
  });

  it('records provider release failure without masking successful execution', async () => {
    const executor = createExecutor({
      providers: [
        directProvider({
          release: async () => {
            throw new Error('release failed');
          },
        }),
      ],
      transport: okTransport(),
    });
    const result = await executor.execute(baseInput());

    expect(result.kind).toBe(ATTEMPT_EXECUTOR_RESULT_KIND.COMPLETED);
    expect(result.events).toEqual([
      {
        message: 'Provider release failed.',
        metadata: {
          leaseId: 'lease-1',
          providerInstanceId: 'provider-a',
        },
        type: GATEWAY_EVENT_TYPE.PROVIDER_RELEASE_FAILED,
      },
    ]);
  });

  it('releases an acquired lease with classified target-network failure when transport throws', async () => {
    const releasedResults: ProxyAttemptResult[] = [];
    const executor = createExecutor({
      providers: [
        directProvider({
          release: async (_lease, result) => {
            releasedResults.push(result);
          },
        }),
      ],
      transport: {
        execute: async () => {
          throw new Error('socket closed');
        },
      },
    });
    const result = await executor.execute(baseInput());

    expect(result.kind).toBe(ATTEMPT_EXECUTOR_RESULT_KIND.FAILED);

    if (result.kind === ATTEMPT_EXECUTOR_RESULT_KIND.FAILED) {
      expect(result.classified.serviceError).toMatchObject({
        code: RESPONSE_CODE.TARGET_TRANSPORT_ERROR,
        retryable: true,
        status: 502,
      });
    }
    expect(releasedResults).toEqual([
      {
        error: {
          code: RESPONSE_CODE.TARGET_TRANSPORT_ERROR,
          message: 'Target transport execution failed.',
        },
        outcome: PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_NETWORK_ERROR,
      },
    ]);
  });

  it('releases unsupported routes before target transport execution', async () => {
    const releasedResults: ProxyAttemptResult[] = [];
    let transportCalled = false;
    const executor = createExecutor({
      providers: [
        directProvider({
          acquire: async () => directLease({
            route: {
              hops: [],
              kind: PROXY_ROUTE_KIND.ROUTE_CHAIN,
            },
          }),
          release: async (_lease, result) => {
            releasedResults.push(result);
          },
        }),
      ],
      transport: {
        execute: async () => {
          transportCalled = true;

          return okTargetResponse();
        },
        supportsRoute: (route) => route.kind !== PROXY_ROUTE_KIND.ROUTE_CHAIN,
      },
    });
    const result = await executor.execute(baseInput());

    expect(result.kind).toBe(ATTEMPT_EXECUTOR_RESULT_KIND.FAILED);
    expect(transportCalled).toBe(false);
    expect(releasedResults).toEqual([
      {
        error: {
          code: RESPONSE_CODE.UNSUPPORTED_ROUTE,
          message: 'Target transport does not support route kind: route-chain.',
        },
        outcome: PROXY_ATTEMPT_RESULT_OUTCOME.UNSUPPORTED_ROUTE,
      },
    ]);
  });

  it('classifies acquire failures without releasing a missing lease', async () => {
    let releaseCalled = false;
    const executor = createExecutor({
      providers: [
        directProvider({
          acquire: async () => {
            throw new Error('proxy connect failed');
          },
          release: async () => {
            releaseCalled = true;
          },
        }),
      ],
      transport: okTransport(),
    });
    const result = await executor.execute(baseInput());

    expect(result.kind).toBe(ATTEMPT_EXECUTOR_RESULT_KIND.FAILED);

    if (result.kind === ATTEMPT_EXECUTOR_RESULT_KIND.FAILED) {
      expect(result.classified.attemptResult).toMatchObject({
        outcome: PROXY_ATTEMPT_RESULT_OUTCOME.PROXY_CONNECTION_ERROR,
      });
    }
    expect(releaseCalled).toBe(false);
  });

  it('maps caller abort while acquire is active to an aborted attempt failure', async () => {
    const caller = new AbortController();
    let acquireSignal: AbortSignal | undefined;
    const executor = createExecutor({
      providers: [
        directProvider({
          acquire: async (input) => {
            acquireSignal = input.signal;

            return neverSettlingOperation();
          },
        }),
      ],
      transport: okTransport(),
    });
    const resultPromise = executor.execute({
      ...baseInput(),
      parentSignal: caller.signal,
    });

    await waitUntil(() => acquireSignal !== undefined);
    caller.abort('caller stopped');

    const result = await resultPromise;

    expect(acquireSignal?.aborted).toBe(true);
    expect(result.kind).toBe(ATTEMPT_EXECUTOR_RESULT_KIND.FAILED);

    if (result.kind === ATTEMPT_EXECUTOR_RESULT_KIND.FAILED) {
      expect(result.classified.serviceError).toMatchObject({
        code: RESPONSE_CODE.REQUEST_ABORTED,
        retryable: false,
        status: 499,
      });
    }
  });

  it('maps total timeout while acquire is active to gateway-timeout failure', async () => {
    jest.useFakeTimers();

    const timeoutController = new TimeoutController();
    const totalScope = timeoutController.createTotalScope({
      callerSignal: new AbortController().signal,
      timeoutMs: 10,
    });
    let acquireSignal: AbortSignal | undefined;
    const executor = createExecutor({
      providers: [
        directProvider({
          acquire: async (input) => {
            acquireSignal = input.signal;

            return neverSettlingOperation();
          },
        }),
      ],
      timeoutController,
      transport: okTransport(),
    });
    const resultPromise = executor.execute({
      ...baseInput(),
      parentSignal: totalScope.signal,
    });

    await waitUntil(() => acquireSignal !== undefined);
    await jest.advanceTimersByTimeAsync(10);

    const result = await resultPromise;

    totalScope.dispose();
    expect(result.kind).toBe(ATTEMPT_EXECUTOR_RESULT_KIND.FAILED);

    if (result.kind === ATTEMPT_EXECUTOR_RESULT_KIND.FAILED) {
      expect(result.classified.serviceError).toMatchObject({
        code: RESPONSE_CODE.GATEWAY_TIMEOUT,
        retryable: false,
        status: 504,
      });
    }
  });

  it('maps per-attempt timeout during transport execution and releases the lease', async () => {
    jest.useFakeTimers();

    const releasedResults: ProxyAttemptResult[] = [];
    let transportSignal: AbortSignal | undefined;
    const executor = createExecutor({
      providers: [
        directProvider({
          release: async (_lease, result) => {
            releasedResults.push(result);
          },
        }),
      ],
      transport: {
        execute: async (input) => {
          transportSignal = input.signal;

          return neverSettlingOperation();
        },
      },
    });
    const resultPromise = executor.execute({
      ...baseInput(),
      attemptTimeoutMs: 10,
    });

    await waitUntil(() => transportSignal !== undefined);
    await jest.advanceTimersByTimeAsync(10);

    const result = await resultPromise;

    expect(transportSignal?.aborted).toBe(true);
    expect(result.kind).toBe(ATTEMPT_EXECUTOR_RESULT_KIND.FAILED);
    expect(releasedResults).toEqual([
      {
        error: {
          code: RESPONSE_CODE.TARGET_TIMEOUT,
          message: 'Target request timed out.',
        },
        outcome: PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_TIMEOUT,
      },
    ]);
  });

  it('classifies response buffering failures and releases the acquired lease', async () => {
    const releasedResults: ProxyAttemptResult[] = [];
    const executor = createExecutor({
      bodyBufferManager: new BodyBufferManager({
        maxBufferedResponseBodyBytes: 1,
        rejectWhenResponseBufferExceeded: true,
      }),
      providers: [
        directProvider({
          release: async (_lease, result) => {
            releasedResults.push(result);
          },
        }),
      ],
      transport: {
        execute: async () => ({
          ...okTargetResponse(),
          body: {
            bytes: new Uint8Array([1, 2]),
            kind: 'bytes',
            replayability: 'replayable',
          },
        }),
      },
    });
    const result = await executor.execute(baseInput());

    expect(result.kind).toBe(ATTEMPT_EXECUTOR_RESULT_KIND.FAILED);

    if (result.kind === ATTEMPT_EXECUTOR_RESULT_KIND.FAILED) {
      expect(result.classified.serviceError).toMatchObject({
        code: RESPONSE_CODE.GATEWAY_ERROR,
        retryable: false,
        status: 500,
      });
    }
    expect(releasedResults).toEqual([
      {
        error: {
          code: RESPONSE_CODE.GATEWAY_ERROR,
          message: 'Response buffering failed.',
        },
        outcome: PROXY_ATTEMPT_RESULT_OUTCOME.GATEWAY_ERROR,
      },
    ]);
  });

  it('falls back to the next planned attempt when retry policy allows it', async () => {
    const acquiredProviderIds: string[] = [];
    const releasedResults: ProxyAttemptResult[] = [];
    const executor = createExecutor({
      providers: [
        directProvider({
          acquire: async (input) => {
            acquiredProviderIds.push(input.providerInstanceId);

            return directLease({
              route: forwardProxyRoute('proxy-a.example'),
            });
          },
          release: async (_lease, result) => {
            releasedResults.push(result);
          },
        }),
        directProvider({
          id: 'provider-b',
          acquire: async (input) => {
            acquiredProviderIds.push(input.providerInstanceId);

            return directLease({
              providerInstanceId: 'provider-b',
              route: forwardProxyRoute('proxy-b.example'),
            });
          },
          release: async (_lease, result) => {
            releasedResults.push(result);
          },
        }),
      ],
      transport: {
        execute: async (input) => {
          if (input.route.kind === PROXY_ROUTE_KIND.FORWARD_PROXY && input.route.host === 'proxy-a.example') {
            throw new Error('provider-a target failed');
          }

          return okTargetResponse();
        },
      },
    });
    const result = await executor.execute({
      ...baseInput(),
      plan: plan([
        {
          providerInstanceId: 'provider-a',
          providerKind: 'test-provider',
          retryOn: [RETRY_CONDITION.TARGET_NETWORK_ERROR],
        },
        {
          providerInstanceId: 'provider-b',
          providerKind: 'test-provider',
        },
      ]),
    });

    expect(result.kind).toBe(ATTEMPT_EXECUTOR_RESULT_KIND.COMPLETED);
    expect(acquiredProviderIds).toEqual(['provider-a', 'provider-b']);
    expect(releasedResults.map((releasedResult) => releasedResult.outcome)).toEqual([
      PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_NETWORK_ERROR,
      PROXY_ATTEMPT_RESULT_OUTCOME.SUCCESS,
    ]);
  });

  it('retries the same planned attempt until maxAttempts is reached', async () => {
    let transportCalls = 0;
    const acquiredProviderIds: string[] = [];
    const executor = createExecutor({
      providers: [
        directProvider({
          acquire: async (input) => {
            acquiredProviderIds.push(input.providerInstanceId);

            return directLease();
          },
        }),
      ],
      transport: {
        execute: async () => {
          transportCalls += 1;

          if (transportCalls === 1) {
            throw new Error('first target failure');
          }

          return okTargetResponse();
        },
      },
    });
    const result = await executor.execute({
      ...baseInput(),
      plan: plan([
        {
          maxAttempts: 2,
          providerInstanceId: 'provider-a',
          providerKind: 'test-provider',
          retryOn: [RETRY_CONDITION.TARGET_NETWORK_ERROR],
        },
      ]),
    });

    expect(result.kind).toBe(ATTEMPT_EXECUTOR_RESULT_KIND.COMPLETED);
    expect(acquiredProviderIds).toEqual(['provider-a', 'provider-a']);
    expect(transportCalls).toBe(2);
  });

  it('does not retry unsafe POST without the required idempotency key', async () => {
    let acquireCalls = 0;
    const executor = createExecutor({
      providers: [
        directProvider({
          acquire: async () => {
            acquireCalls += 1;

            return directLease();
          },
        }),
      ],
      transport: {
        execute: async () => {
          throw new Error('target failed');
        },
      },
    });
    const result = await executor.execute({
      ...baseInput(),
      plan: plan([
        {
          maxAttempts: 2,
          providerInstanceId: 'provider-a',
          providerKind: 'test-provider',
          retryOn: [RETRY_CONDITION.TARGET_NETWORK_ERROR],
        },
      ]),
      target: targetRequest({ method: 'POST' }),
    });

    expect(result.kind).toBe(ATTEMPT_EXECUTOR_RESULT_KIND.FAILED);
    expect(acquireCalls).toBe(1);
  });

  it('does not fallback after caller abort while acquisition is active', async () => {
    const caller = new AbortController();
    const acquiredProviderIds: string[] = [];
    let acquireSignal: AbortSignal | undefined;
    const executor = createExecutor({
      providers: [
        directProvider({
          acquire: async (input) => {
            acquiredProviderIds.push(input.providerInstanceId);
            acquireSignal = input.signal;

            return neverSettlingOperation();
          },
        }),
        directProvider({
          id: 'provider-b',
          acquire: async (input) => {
            acquiredProviderIds.push(input.providerInstanceId);

            return directLease({ providerInstanceId: 'provider-b' });
          },
        }),
      ],
      transport: okTransport(),
    });
    const resultPromise = executor.execute({
      ...baseInput(),
      parentSignal: caller.signal,
      plan: plan([
        {
          providerInstanceId: 'provider-a',
          providerKind: 'test-provider',
          retryOn: [RETRY_CONDITION.TARGET_NETWORK_ERROR],
        },
        {
          providerInstanceId: 'provider-b',
          providerKind: 'test-provider',
        },
      ]),
    });

    await waitUntil(() => acquireSignal !== undefined);
    caller.abort('caller stopped');

    const result = await resultPromise;

    expect(result.kind).toBe(ATTEMPT_EXECUTOR_RESULT_KIND.FAILED);
    expect(acquiredProviderIds).toEqual(['provider-a']);
  });

  it('does not fallback after total timeout while acquisition is active', async () => {
    jest.useFakeTimers();

    const timeoutController = new TimeoutController();
    const totalScope = timeoutController.createTotalScope({
      callerSignal: new AbortController().signal,
      timeoutMs: 10,
    });
    const acquiredProviderIds: string[] = [];
    let acquireSignal: AbortSignal | undefined;
    const executor = createExecutor({
      providers: [
        directProvider({
          acquire: async (input) => {
            acquiredProviderIds.push(input.providerInstanceId);
            acquireSignal = input.signal;

            return neverSettlingOperation();
          },
        }),
        directProvider({
          id: 'provider-b',
          acquire: async (input) => {
            acquiredProviderIds.push(input.providerInstanceId);

            return directLease({ providerInstanceId: 'provider-b' });
          },
        }),
      ],
      timeoutController,
      transport: okTransport(),
    });
    const resultPromise = executor.execute({
      ...baseInput(),
      parentSignal: totalScope.signal,
      plan: plan([
        {
          providerInstanceId: 'provider-a',
          providerKind: 'test-provider',
          retryOn: [RETRY_CONDITION.GATEWAY_TIMEOUT],
        },
        {
          providerInstanceId: 'provider-b',
          providerKind: 'test-provider',
        },
      ]),
    });

    await waitUntil(() => acquireSignal !== undefined);
    await jest.advanceTimersByTimeAsync(10);

    const result = await resultPromise;

    totalScope.dispose();
    expect(result.kind).toBe(ATTEMPT_EXECUTOR_RESULT_KIND.FAILED);
    expect(acquiredProviderIds).toEqual(['provider-a']);
  });

  it('can fallback after per-attempt timeout when retry policy allows it', async () => {
    jest.useFakeTimers();

    const acquiredProviderIds: string[] = [];
    const releasedResults: ProxyAttemptResult[] = [];
    let transportSignal: AbortSignal | undefined;
    const executor = createExecutor({
      providers: [
        directProvider({
          acquire: async (input) => {
            acquiredProviderIds.push(input.providerInstanceId);

            return directLease();
          },
          release: async (_lease, result) => {
            releasedResults.push(result);
          },
        }),
        directProvider({
          id: 'provider-b',
          acquire: async (input) => {
            acquiredProviderIds.push(input.providerInstanceId);

            return directLease({ providerInstanceId: 'provider-b' });
          },
          release: async (_lease, result) => {
            releasedResults.push(result);
          },
        }),
      ],
      transport: {
        execute: async (input) => {
          if (input.route.kind === PROXY_ROUTE_KIND.DIRECT && input.requestId === 'request-1') {
            transportSignal = input.signal;

            if (acquiredProviderIds.length === 1) {
              return neverSettlingOperation();
            }
          }

          return okTargetResponse();
        },
      },
    });
    const resultPromise = executor.execute({
      ...baseInput(),
      attemptTimeoutMs: 10,
      plan: plan([
        {
          providerInstanceId: 'provider-a',
          providerKind: 'test-provider',
          retryOn: [RETRY_CONDITION.TARGET_TIMEOUT],
        },
        {
          providerInstanceId: 'provider-b',
          providerKind: 'test-provider',
        },
      ]),
    });

    await waitUntil(() => transportSignal !== undefined);
    await jest.advanceTimersByTimeAsync(10);

    const result = await resultPromise;

    expect(result.kind).toBe(ATTEMPT_EXECUTOR_RESULT_KIND.COMPLETED);
    expect(acquiredProviderIds).toEqual(['provider-a', 'provider-b']);
    expect(releasedResults.map((releasedResult) => releasedResult.outcome)).toEqual([
      PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_TIMEOUT,
      PROXY_ATTEMPT_RESULT_OUTCOME.SUCCESS,
    ]);
  });

  it('verifies a lease after acquire and before target transport execution', async () => {
    const operations: string[] = [];
    let acquireSignal: AbortSignal | undefined;
    let verifySignal: AbortSignal | undefined;
    let transportSignal: AbortSignal | undefined;
    const expectedGeo = {
      country: 'DE',
      strictness: PROXY_GEO_STRICTNESS.REQUIRED,
    };
    const executor = createExecutor({
      exitVerifier: {
        verify: async (input) => {
          operations.push('verify');
          verifySignal = input.signal;
          expect(input.requestId).toBe('request-1');
          expect(input.lease.id).toBe('lease-1');
          expect(input.route).toEqual({ kind: PROXY_ROUTE_KIND.DIRECT });
          expect(input.expected).toEqual(expectedGeo);

          return exitVerification({ country: 'DE', matchesRequirements: true });
        },
      },
      providers: [
        directProvider({
          acquire: async (input) => {
            operations.push('acquire');
            acquireSignal = input.signal;

            return directLease();
          },
        }),
      ],
      transport: {
        execute: async (input) => {
          operations.push('transport');
          transportSignal = input.signal;

          return okTargetResponse();
        },
      },
    });
    const result = await executor.execute({
      ...baseInput(),
      plan: plan([
        {
          providerInstanceId: 'provider-a',
          providerKind: 'test-provider',
          requirements: {
            geo: expectedGeo,
          },
          verification: {
            rejectOnGeoMismatch: true,
            verifyExit: true,
          },
        },
      ]),
    });

    expect(result.kind).toBe(ATTEMPT_EXECUTOR_RESULT_KIND.COMPLETED);
    expect(operations).toEqual(['acquire', 'verify', 'transport']);
    expect(verifySignal).toBe(acquireSignal);
    expect(transportSignal).toBe(acquireSignal);
  });

  it('rejects geo mismatch before target transport and releases the lease', async () => {
    const releasedResults: ProxyAttemptResult[] = [];
    let transportCalled = false;
    const executor = createExecutor({
      exitVerifier: {
        verify: async () => exitVerification({ country: 'US', matchesRequirements: false }),
      },
      providers: [
        directProvider({
          release: async (_lease, result) => {
            releasedResults.push(result);
          },
        }),
      ],
      transport: {
        execute: async () => {
          transportCalled = true;

          return okTargetResponse();
        },
      },
    });
    const result = await executor.execute({
      ...baseInput(),
      plan: plan([
        {
          providerInstanceId: 'provider-a',
          providerKind: 'test-provider',
          requirements: {
            geo: {
              country: 'DE',
              strictness: PROXY_GEO_STRICTNESS.REQUIRED,
            },
          },
          verification: {
            rejectOnGeoMismatch: true,
            verifyExit: true,
          },
        },
      ]),
    });

    expect(result.kind).toBe(ATTEMPT_EXECUTOR_RESULT_KIND.FAILED);
    expect(transportCalled).toBe(false);
    expect(releasedResults).toEqual([
      {
        error: {
          code: RESPONSE_CODE.PROXY_GEO_MISMATCH,
          message: 'Proxy exit did not match geo requirements.',
        },
        outcome: PROXY_ATTEMPT_RESULT_OUTCOME.PROXY_GEO_MISMATCH,
      },
    ]);
  });

  it('can fallback after geo mismatch when retry policy allows it', async () => {
    const acquiredProviderIds: string[] = [];
    const releasedResults: ProxyAttemptResult[] = [];
    const executor = createExecutor({
      exitVerifier: {
        verify: async () => exitVerification({ country: 'US', matchesRequirements: false }),
      },
      providers: [
        directProvider({
          acquire: async (input) => {
            acquiredProviderIds.push(input.providerInstanceId);

            return directLease();
          },
          release: async (_lease, result) => {
            releasedResults.push(result);
          },
        }),
        directProvider({
          id: 'provider-b',
          acquire: async (input) => {
            acquiredProviderIds.push(input.providerInstanceId);

            return directLease({ providerInstanceId: 'provider-b' });
          },
          release: async (_lease, result) => {
            releasedResults.push(result);
          },
        }),
      ],
      transport: okTransport(),
    });
    const result = await executor.execute({
      ...baseInput(),
      plan: plan([
        {
          providerInstanceId: 'provider-a',
          providerKind: 'test-provider',
          requirements: {
            geo: {
              country: 'DE',
              strictness: PROXY_GEO_STRICTNESS.REQUIRED,
            },
          },
          retryOn: [RETRY_CONDITION.PROXY_GEO_MISMATCH],
          verification: {
            rejectOnGeoMismatch: true,
            verifyExit: true,
          },
        },
        {
          providerInstanceId: 'provider-b',
          providerKind: 'test-provider',
        },
      ]),
    });

    expect(result.kind).toBe(ATTEMPT_EXECUTOR_RESULT_KIND.COMPLETED);
    expect(acquiredProviderIds).toEqual(['provider-a', 'provider-b']);
    expect(releasedResults.map((releasedResult) => releasedResult.outcome)).toEqual([
      PROXY_ATTEMPT_RESULT_OUTCOME.PROXY_GEO_MISMATCH,
      PROXY_ATTEMPT_RESULT_OUTCOME.SUCCESS,
    ]);
  });

  it('can fallback after verifier failure when retry policy allows it', async () => {
    const acquiredProviderIds: string[] = [];
    const executor = createExecutor({
      exitVerifier: {
        verify: async () => {
          throw new Error('verifier unavailable');
        },
      },
      providers: [
        directProvider({
          acquire: async (input) => {
            acquiredProviderIds.push(input.providerInstanceId);

            return directLease();
          },
        }),
        directProvider({
          id: 'provider-b',
          acquire: async (input) => {
            acquiredProviderIds.push(input.providerInstanceId);

            return directLease({ providerInstanceId: 'provider-b' });
          },
        }),
      ],
      transport: okTransport(),
    });
    const result = await executor.execute({
      ...baseInput(),
      plan: plan([
        {
          providerInstanceId: 'provider-a',
          providerKind: 'test-provider',
          retryOn: [RETRY_CONDITION.EXIT_VERIFICATION_FAILED],
          verification: {
            verifyExit: true,
          },
        },
        {
          providerInstanceId: 'provider-b',
          providerKind: 'test-provider',
        },
      ]),
    });

    expect(result.kind).toBe(ATTEMPT_EXECUTOR_RESULT_KIND.COMPLETED);
    expect(acquiredProviderIds).toEqual(['provider-a', 'provider-b']);
  });

  it('skips same-provider retry after proxy auth error and falls back to another provider', async () => {
    const acquiredProviderIds: string[] = [];
    const executor = createExecutor({
      providers: [
        directProvider({
          acquire: async (input) => {
            acquiredProviderIds.push(input.providerInstanceId);
            throw {
              code: RESPONSE_CODE.PROXY_AUTH_ERROR,
              message: 'bad proxy credentials',
            };
          },
        }),
        directProvider({
          id: 'provider-b',
          acquire: async (input) => {
            acquiredProviderIds.push(input.providerInstanceId);

            return directLease({ providerInstanceId: 'provider-b' });
          },
        }),
      ],
      transport: okTransport(),
    });
    const result = await executor.execute({
      ...baseInput(),
      plan: plan([
        {
          maxAttempts: 2,
          providerInstanceId: 'provider-a',
          providerKind: 'test-provider',
          retryOn: [RETRY_CONDITION.PROXY_AUTH_ERROR],
        },
        {
          providerInstanceId: 'provider-a',
          providerKind: 'test-provider',
          retryOn: [RETRY_CONDITION.PROXY_AUTH_ERROR],
        },
        {
          providerInstanceId: 'provider-b',
          providerKind: 'test-provider',
        },
      ]),
    });

    expect(result.kind).toBe(ATTEMPT_EXECUTOR_RESULT_KIND.COMPLETED);
    expect(acquiredProviderIds).toEqual(['provider-a', 'provider-b']);
  });

  it('does not fallback after response stream already started', async () => {
    const acquiredProviderIds: string[] = [];
    const executor = createExecutor({
      providers: [
        directProvider({
          acquire: async (input) => {
            acquiredProviderIds.push(input.providerInstanceId);

            return directLease();
          },
        }),
        directProvider({
          id: 'provider-b',
          acquire: async (input) => {
            acquiredProviderIds.push(input.providerInstanceId);

            return directLease({ providerInstanceId: 'provider-b' });
          },
        }),
      ],
      transport: {
        execute: async () => {
          throw {
            code: RESPONSE_CODE.RESPONSE_STREAM_ALREADY_STARTED,
            message: 'response stream already started',
          };
        },
      },
    });
    const result = await executor.execute({
      ...baseInput(),
      plan: plan([
        {
          providerInstanceId: 'provider-a',
          providerKind: 'test-provider',
        },
        {
          providerInstanceId: 'provider-b',
          providerKind: 'test-provider',
        },
      ]),
    });

    expect(result.kind).toBe(ATTEMPT_EXECUTOR_RESULT_KIND.FAILED);
    expect(acquiredProviderIds).toEqual(['provider-a']);
  });

  it('redacts verification-sensitive diagnostics', async () => {
    const executor = createExecutor({
      exitVerifier: {
        verify: async () => exitVerification({ country: 'US', matchesRequirements: false }),
      },
      providers: [
        directProvider({
          acquire: async () => directLease({
            route: authenticatedForwardProxyRoute(),
          }),
        }),
      ],
      transport: okTransport(),
    });
    const result = await executor.execute({
      ...baseInput(),
      plan: plan([
        {
          providerInstanceId: 'provider-a',
          providerKind: 'test-provider',
          verification: {
            rejectOnGeoMismatch: true,
            verifyExit: true,
          },
        },
      ]),
    });

    expect(result.kind).toBe(ATTEMPT_EXECUTOR_RESULT_KIND.FAILED);
    expect(JSON.stringify(result.classified.diagnostics)).not.toContain('secret-password');
    expect(JSON.stringify(result.classified.diagnostics)).not.toContain('gateway-user');
  });
});

function createExecutor(options: {
  bodyBufferManager?: BodyBufferManager;
  exitVerifier?: ProxyExitVerifierPort;
  providers: ProxyProviderInstance[];
  timeoutController?: TimeoutController;
  transport: TargetTransportPort;
}): AttemptExecutor {
  return new AttemptExecutor({
    bodyBufferManager: options.bodyBufferManager ?? new BodyBufferManager(),
    ...(options.exitVerifier !== undefined && { exitVerifier: options.exitVerifier }),
    providers: options.providers,
    resultClassifier: new ResultClassifier(),
    timeoutController: options.timeoutController ?? new TimeoutController(),
    transport: options.transport,
  });
}

function baseInput(): Parameters<AttemptExecutor['execute']>[0] {
  return {
    context: {},
    parentSignal: new AbortController().signal,
    plan: plan([
      {
        providerInstanceId: 'provider-a',
        providerKind: 'test-provider',
      },
    ]),
    requestId: 'request-1',
    target: targetRequest(),
  };
}

function plan(attempts: ProxyExecutionPlan['attempts']): ProxyExecutionPlan {
  return {
    attempts,
    kind: PROXY_PLAN_KIND.FALLBACK,
  };
}

function directProvider(
  overrides: Partial<ProxyProviderInstance> & {
    acquire?: ProxyProviderInstance['adapter']['acquire'];
    release?: NonNullable<ProxyProviderInstance['adapter']['release']>;
  } = {},
): ProxyProviderInstance {
  const { acquire, id, release, ...instanceOverrides } = overrides;
  const providerId = id ?? 'provider-a';

  return {
    id: providerId,
    adapter: {
      acquire: acquire ?? (async () => directLease({ providerInstanceId: providerId })),
      getCapabilities: () => ({
        geo: {
          mode: PROXY_PROVIDER_GEO_MODE.UNSUPPORTED,
        },
      }),
      kind: 'test-provider',
      ...(release === undefined ? {} : { release }),
    },
    ...instanceOverrides,
  };
}

function directLease(
  options: {
    providerInstanceId?: string;
    route?: ProxyRoute;
  } = {},
): ProxyLease {
  return {
    id: 'lease-1',
    providerInstanceId: options.providerInstanceId ?? 'provider-a',
    providerKind: 'test-provider',
    route: options.route ?? { kind: PROXY_ROUTE_KIND.DIRECT },
  };
}

function okTransport(): TargetTransportPort {
  return {
    execute: async () => okTargetResponse(),
  };
}

function okTargetResponse(): GatewayTargetResponse {
  return {
    body: {
      kind: 'text',
      replayability: 'replayable',
      text: 'ok',
    },
    headers: [['content-type', 'text/plain']],
    status: 200,
    statusText: 'OK',
    url: 'https://example.com/resource',
  };
}

function targetRequest(
  options: {
    headers?: Array<[string, string]>;
    method?: string;
  } = {},
): GatewayTargetRequest {
  return {
    body: {
      kind: 'none',
      replayability: 'replayable',
    },
    fetch: {},
    headers: options.headers ?? [],
    method: options.method ?? 'GET',
    url: 'https://example.com/resource',
  };
}

function forwardProxyRoute(host: string): ProxyRoute {
  return {
    host,
    kind: PROXY_ROUTE_KIND.FORWARD_PROXY,
    port: 8080,
    protocol: PROXY_PROTOCOL.HTTP,
  };
}

function authenticatedForwardProxyRoute(): ProxyRoute {
  return {
    auth: {
      mode: PROXY_ROUTE_AUTH_MODE.USERNAME_PASSWORD,
      password: 'secret-password',
      username: 'gateway-user',
    },
    host: 'proxy.example',
    kind: PROXY_ROUTE_KIND.FORWARD_PROXY,
    port: 8080,
    protocol: PROXY_PROTOCOL.HTTP,
  };
}

function exitVerification(options: { country: string; matchesRequirements: boolean }) {
  return {
    checkedAt: new Date('2026-01-01T00:00:00.000Z'),
    country: options.country,
    ip: '203.0.113.10',
    matchesRequirements: options.matchesRequirements,
    source: 'test-verifier',
  };
}

function neverSettlingOperation(): Promise<never> {
  return new Promise(() => undefined);
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (predicate()) {
      return;
    }

    await Promise.resolve();
  }
}
