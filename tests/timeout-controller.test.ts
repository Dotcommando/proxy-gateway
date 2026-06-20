import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  createProxyGateway,
  type GatewayTargetResponse,
  PROXY_ATTEMPT_RESULT_OUTCOME,
  PROXY_ROUTE_KIND,
  type ProxyAttemptResult,
  type ProxyLease,
  type ProxyProviderInstance,
  RESPONSE_CODE,
  TIMEOUT_OBSERVATION_KIND,
  WIRE_PROTOCOL_VERSION,
} from '../src';
import {
  mapTimeoutObservationToOutcome,
  TimeoutController,
} from '../src/app/timeouts';

describe('TimeoutController', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses package enums for timeout observations and maps them to classified outcomes', () => {
    expect(TIMEOUT_OBSERVATION_KIND.CALLER_ABORTED).toBe('caller-aborted');
    expect(TIMEOUT_OBSERVATION_KIND.TOTAL_TIMEOUT).toBe('total-timeout');
    expect(TIMEOUT_OBSERVATION_KIND.ATTEMPT_TIMEOUT).toBe('attempt-timeout');
    expect(mapTimeoutObservationToOutcome({ kind: TIMEOUT_OBSERVATION_KIND.CALLER_ABORTED })).toBe(
      PROXY_ATTEMPT_RESULT_OUTCOME.ABORTED,
    );
    expect(mapTimeoutObservationToOutcome({ kind: TIMEOUT_OBSERVATION_KIND.TOTAL_TIMEOUT })).toBe(
      PROXY_ATTEMPT_RESULT_OUTCOME.GATEWAY_TIMEOUT,
    );
    expect(mapTimeoutObservationToOutcome({ kind: TIMEOUT_OBSERVATION_KIND.ATTEMPT_TIMEOUT })).toBe(
      PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_TIMEOUT,
    );
  });

  it('cleans up total timers and caller abort listeners after disposal', () => {
    jest.useFakeTimers();

    const caller = new AbortController();
    const scope = new TimeoutController().createTotalScope({
      callerSignal: caller.signal,
      timeoutMs: 10,
    });

    scope.dispose();
    jest.advanceTimersByTime(10);
    caller.abort('after-dispose');

    expect(scope.signal.aborted).toBe(false);
    expect(scope.observation).toBeUndefined();
  });

  it('total timeout cancels active acquisition and returns a gateway-timeout service error', async () => {
    jest.useFakeTimers();

    let acquireSignal: AbortSignal | undefined;
    let transportCalled = false;
    const provider = directProvider({
      acquire: async (input) => {
        acquireSignal = input.signal;

        return neverSettlingOperation();
      },
    });
    const gateway = createProxyGateway({
      providers: [provider],
      transport: {
        execute: async () => {
          transportCalled = true;

          return okTargetResponse();
        },
      },
    });
    const responsePromise = gateway.handle(proxyFetchJsonRequest({ timeoutMs: 10 }));

    await waitUntil(() => acquireSignal !== undefined);
    await jest.advanceTimersByTimeAsync(10);

    const response = await responsePromise;

    expect(acquireSignal?.aborted).toBe(true);
    expect(transportCalled).toBe(false);
    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: RESPONSE_CODE.GATEWAY_TIMEOUT,
        retryable: false,
      },
      ok: false,
      version: WIRE_PROTOCOL_VERSION,
    });
  });

  it('caller abort cancels active acquisition and prevents target transport execution', async () => {
    const caller = new AbortController();
    let acquireSignal: AbortSignal | undefined;
    let transportCalled = false;
    const provider = directProvider({
      acquire: async (input) => {
        acquireSignal = input.signal;

        return neverSettlingOperation();
      },
    });
    const gateway = createProxyGateway({
      providers: [provider],
      transport: {
        execute: async () => {
          transportCalled = true;

          return okTargetResponse();
        },
      },
    });
    const responsePromise = gateway.handle(proxyFetchJsonRequest({ signal: caller.signal }));

    caller.abort('caller stopped');

    const response = await responsePromise;

    expect(acquireSignal?.aborted).toBe(true);
    expect(transportCalled).toBe(false);
    expect(response.status).toBe(499);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: RESPONSE_CODE.REQUEST_ABORTED,
        retryable: false,
      },
      ok: false,
      version: WIRE_PROTOCOL_VERSION,
    });
  });

  it('passes the same attempt signal to provider acquisition and target transport', async () => {
    let acquireSignal: AbortSignal | undefined;
    let transportSignal: AbortSignal | undefined;
    const gateway = createProxyGateway({
      providers: [
        directProvider({
          acquire: async (input) => {
            acquireSignal = input.signal;

            return directLease();
          },
        }),
      ],
      transport: {
        execute: async (input) => {
          transportSignal = input.signal;

          return okTargetResponse();
        },
      },
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(acquireSignal).toBeDefined();
    expect(transportSignal).toBe(acquireSignal);
    expect(transportSignal?.aborted).toBe(false);
  });

  it('attempt timeout is reported separately and releases an acquired lease', async () => {
    jest.useFakeTimers();

    const releasedResults: ProxyAttemptResult[] = [];
    let transportSignal: AbortSignal | undefined;
    const gateway = createProxyGateway({
      providers: [
        directProvider({
          release: async (_lease, result) => {
            releasedResults.push(result);
          },
        }),
      ],
      timeouts: {
        attemptTimeoutMs: 10,
      },
      transport: {
        execute: async (input) => {
          transportSignal = input.signal;

          await neverSettlingOperation();

          return okTargetResponse();
        },
      },
    });
    const responsePromise = gateway.handle(proxyFetchJsonRequest());

    await waitUntil(() => transportSignal !== undefined);
    await jest.advanceTimersByTimeAsync(10);

    const response = await responsePromise;

    expect(transportSignal?.aborted).toBe(true);
    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: RESPONSE_CODE.TARGET_TIMEOUT,
        retryable: true,
      },
      ok: false,
      version: WIRE_PROTOCOL_VERSION,
    });
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
});

function directProvider(
  overrides: {
    acquire?: ProxyProviderInstance['adapter']['acquire'];
    release?: NonNullable<ProxyProviderInstance['adapter']['release']>;
  } = {},
): ProxyProviderInstance {
  return {
    adapter: {
      acquire: overrides.acquire ?? (async () => directLease()),
      getCapabilities: () => ({}),
      kind: 'test-direct',
      ...(overrides.release === undefined ? {} : { release: overrides.release }),
    },
    id: 'direct-provider',
  };
}

function directLease(): ProxyLease {
  return {
    id: 'lease-1',
    providerInstanceId: 'direct-provider',
    providerKind: 'test-direct',
    route: {
      kind: PROXY_ROUTE_KIND.DIRECT,
    },
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

function proxyFetchJsonRequest(options: { signal?: AbortSignal; timeoutMs?: number } = {}): Request {
  const init: RequestInit = {
    body: JSON.stringify({
      context: {},
      options: options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs },
      request: {
        body: null,
        headers: [],
        method: 'GET',
        url: 'https://example.com/resource',
      },
      version: WIRE_PROTOCOL_VERSION,
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  };

  if (options.signal !== undefined) {
    init.signal = options.signal;
  }

  return new Request('https://gateway.test/proxy', init);
}
