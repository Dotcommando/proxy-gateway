import { describe, expect, it } from '@jest/globals';

import {
  createProxyGateway,
  type GatewayTargetResponse,
  PROXY_ATTEMPT_RESULT_OUTCOME,
  PROXY_GEO_STRICTNESS,
  PROXY_PLAN_KIND,
  PROXY_PROTOCOL,
  PROXY_PROVIDER_COUNTRY_SELECTION,
  PROXY_PROVIDER_GEO_MODE,
  PROXY_ROUTE_KIND,
  type ProxyAttemptResult,
  type ProxyProviderCapabilities,
  type ProxyProviderInstance,
  type ProxyRoute,
  RESPONSE_CODE,
  RETRY_CONDITION,
  type TargetTransportPort,
  WIRE_PROTOCOL_VERSION,
} from '../src';

describe('gateway planner-owned direct flow', () => {
  it('uses a configured execution plan to select a provider without providerSelection', async () => {
    const acquiredProviderIds: string[] = [];
    const gateway = createProxyGateway({
      plan: {
        attempts: [
          {
            provider: 'provider-b',
          },
        ],
        kind: PROXY_PLAN_KIND.FALLBACK,
      },
      providers: [
        provider('provider-a', acquiredProviderIds),
        provider('provider-b', acquiredProviderIds),
      ],
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(acquiredProviderIds).toEqual(['provider-b']);
  });

  it('executes fallback attempts from a configured plan through the gateway', async () => {
    const acquiredProviderIds: string[] = [];
    const releasedResults: ProxyAttemptResult[] = [];
    const gateway = createProxyGateway({
      plan: {
        attempts: [
          {
            provider: 'provider-a',
            retryOn: [RETRY_CONDITION.TARGET_NETWORK_ERROR],
          },
          {
            provider: 'provider-b',
          },
        ],
        kind: PROXY_PLAN_KIND.FALLBACK,
      },
      providers: [
        provider('provider-a', acquiredProviderIds, {
          release: async (_lease, result) => {
            releasedResults.push(result);
          },
          route: forwardProxyRoute('proxy-a.example'),
        }),
        provider('provider-b', acquiredProviderIds, {
          release: async (_lease, result) => {
            releasedResults.push(result);
          },
          route: forwardProxyRoute('proxy-b.example'),
        }),
      ],
      transport: {
        execute: async (input) => {
          if (input.route.kind === PROXY_ROUTE_KIND.FORWARD_PROXY && input.route.host === 'proxy-a.example') {
            throw new Error('provider-a failed');
          }

          return okTargetResponse();
        },
      },
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(acquiredProviderIds).toEqual(['provider-a', 'provider-b']);
    expect(releasedResults.map((result) => result.outcome)).toEqual([
      PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_NETWORK_ERROR,
      PROXY_ATTEMPT_RESULT_OUTCOME.SUCCESS,
    ]);
  });

  it('retries the same configured attempt through the gateway when policy allows it', async () => {
    const acquiredProviderIds: string[] = [];
    const releasedResults: ProxyAttemptResult[] = [];
    let transportCalls = 0;
    const gateway = createProxyGateway({
      plan: {
        attempts: [
          {
            maxAttempts: 2,
            provider: 'provider-a',
            retryOn: [RETRY_CONDITION.TARGET_NETWORK_ERROR],
          },
        ],
        kind: PROXY_PLAN_KIND.FALLBACK,
      },
      providers: [
        provider('provider-a', acquiredProviderIds, {
          release: async (_lease, result) => {
            releasedResults.push(result);
          },
        }),
      ],
      transport: {
        execute: async () => {
          transportCalls += 1;

          if (transportCalls === 1) {
            throw new Error('temporary target failure');
          }

          return okTargetResponse();
        },
      },
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(acquiredProviderIds).toEqual(['provider-a', 'provider-a']);
    expect(releasedResults.map((result) => result.outcome)).toEqual([
      PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_NETWORK_ERROR,
      PROXY_ATTEMPT_RESULT_OUTCOME.SUCCESS,
    ]);
  });

  it('plans strict verified-after-acquire geo when an exit verifier is configured', async () => {
    let verified = false;
    const acquiredProviderIds: string[] = [];
    const gateway = createProxyGateway({
      exitVerifier: {
        verify: async () => {
          verified = true;

          return {
            checkedAt: new Date('2026-01-01T00:00:00.000Z'),
            country: 'DE',
            ip: '203.0.113.10',
            matchesRequirements: true,
            source: 'test-verifier',
          };
        },
      },
      plan: {
        attempts: [
          {
            provider: 'geo-provider',
            requirements: {
              geo: {
                country: 'DE',
                strictness: PROXY_GEO_STRICTNESS.REQUIRED,
              },
            },
          },
        ],
        kind: PROXY_PLAN_KIND.FALLBACK,
      },
      providers: [
        provider('geo-provider', acquiredProviderIds, {
          capabilities: {
            geo: {
              countries: '*',
              countrySelection: PROXY_PROVIDER_COUNTRY_SELECTION.EXTERNAL_OR_PROVIDER_CONFIG,
              mode: PROXY_PROVIDER_GEO_MODE.VERIFIED_AFTER_ACQUIRE,
            },
          },
        }),
      ],
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(acquiredProviderIds).toEqual(['geo-provider']);
    expect(verified).toBe(true);
  });

  it('falls back after verification mismatch through the gateway when policy allows it', async () => {
    const acquiredProviderIds: string[] = [];
    const verifiedProviderIds: string[] = [];
    const transportedProviderIds: string[] = [];
    const gateway = createProxyGateway({
      exitVerifier: {
        verify: async (input) => {
          verifiedProviderIds.push(input.lease.providerInstanceId);

          return {
            checkedAt: new Date('2026-01-01T00:00:00.000Z'),
            country: input.lease.providerInstanceId === 'geo-provider-a' ? 'FR' : 'DE',
            ip: input.lease.providerInstanceId === 'geo-provider-a' ? '203.0.113.11' : '203.0.113.12',
            matchesRequirements: input.lease.providerInstanceId !== 'geo-provider-a',
            source: 'test-verifier',
          };
        },
      },
      plan: {
        attempts: [
          {
            provider: 'geo-provider-a',
            requirements: strictGermanGeoRequirements(),
            retryOn: [RETRY_CONDITION.PROXY_GEO_MISMATCH],
          },
          {
            provider: 'geo-provider-b',
            requirements: strictGermanGeoRequirements(),
          },
        ],
        kind: PROXY_PLAN_KIND.FALLBACK,
      },
      providers: [
        provider('geo-provider-a', acquiredProviderIds, {
          capabilities: verifiedAfterAcquireGeoCapabilities(),
          route: forwardProxyRoute('geo-a.example'),
        }),
        provider('geo-provider-b', acquiredProviderIds, {
          capabilities: verifiedAfterAcquireGeoCapabilities(),
          route: forwardProxyRoute('geo-b.example'),
        }),
      ],
      transport: {
        execute: async (input) => {
          if (input.route.kind === PROXY_ROUTE_KIND.FORWARD_PROXY) {
            transportedProviderIds.push(input.route.host);
          }

          return okTargetResponse();
        },
      },
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(acquiredProviderIds).toEqual(['geo-provider-a', 'geo-provider-b']);
    expect(verifiedProviderIds).toEqual(['geo-provider-a', 'geo-provider-b']);
    expect(transportedProviderIds).toEqual(['geo-b.example']);
  });

  it('rejects a verified-after-acquire geo plan before acquire when no verifier is configured', async () => {
    let acquired = false;
    let transported = false;
    const gateway = createProxyGateway({
      plan: {
        attempts: [
          {
            provider: 'geo-provider',
            requirements: strictGermanGeoRequirements(),
          },
        ],
        kind: PROXY_PLAN_KIND.FALLBACK,
      },
      providers: [
        provider('geo-provider', [], {
          acquire: async () => {
            acquired = true;

            return {
              id: 'geo-provider-lease',
              providerInstanceId: 'geo-provider',
              providerKind: 'test-provider',
              route: { kind: PROXY_ROUTE_KIND.DIRECT },
            };
          },
          capabilities: verifiedAfterAcquireGeoCapabilities(),
        }),
      ],
      transport: {
        execute: async () => {
          transported = true;

          return okTargetResponse();
        },
      },
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: {
        code: RESPONSE_CODE.NO_PLANNABLE_PROVIDER,
      },
      ok: false,
      version: WIRE_PROTOCOL_VERSION,
    });
    expect(acquired).toBe(false);
    expect(transported).toBe(false);
  });

  it('returns a stable service error when the configured plan is not plannable', async () => {
    let acquired = false;
    let transported = false;
    const gateway = createProxyGateway({
      plan: {
        attempts: [
          {
            provider: 'geo-provider',
            requirements: {
              geo: {
                country: 'DE',
                strictness: PROXY_GEO_STRICTNESS.REQUIRED,
              },
            },
          },
        ],
        kind: PROXY_PLAN_KIND.FALLBACK,
      },
      providers: [
        provider('geo-provider', [], {
          acquire: async () => {
            acquired = true;

            return {
              id: 'geo-provider-lease',
              providerInstanceId: 'geo-provider',
              providerKind: 'test-provider',
              route: { kind: PROXY_ROUTE_KIND.DIRECT },
            };
          },
          capabilities: {
            geo: {
              countrySelection: PROXY_PROVIDER_COUNTRY_SELECTION.NOT_SUPPORTED,
              mode: PROXY_PROVIDER_GEO_MODE.UNSUPPORTED,
            },
          },
        }),
      ],
      transport: {
        execute: async () => {
          transported = true;

          return okTargetResponse();
        },
      },
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: {
        code: RESPONSE_CODE.NO_PLANNABLE_PROVIDER,
      },
      ok: false,
      version: WIRE_PROTOCOL_VERSION,
    });
    expect(acquired).toBe(false);
    expect(transported).toBe(false);
  });

  it('returns missing transport before provider capability lookup', async () => {
    let capabilityCalls = 0;
    const gateway = createProxyGateway({
      plan: {
        attempts: [
          {
            provider: 'provider-a',
          },
        ],
        kind: PROXY_PLAN_KIND.FALLBACK,
      },
      providers: [
        provider('provider-a', [], {
          getCapabilities: () => {
            capabilityCalls += 1;

            return {};
          },
        }),
      ],
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: {
        code: RESPONSE_CODE.TRANSPORT_NOT_CONFIGURED,
      },
      ok: false,
      version: WIRE_PROTOCOL_VERSION,
    });
    expect(capabilityCalls).toBe(0);
  });

  it('returns a stable service error when the JSON service request exceeds the configured body limit', async () => {
    let transportCalls = 0;
    const gateway = createProxyGateway({
      bodyBuffering: {
        bufferRequestStreamsForRetry: true,
        bufferResponsesBeforeReturn: true,
        maxBufferedRequestBodyBytes: 80,
        maxBufferedResponseBodyBytes: 1024,
        rejectWhenRequestBufferExceeded: false,
        rejectWhenResponseBufferExceeded: false,
      },
      plan: {
        attempts: [
          {
            provider: 'provider-a',
          },
        ],
        kind: PROXY_PLAN_KIND.FALLBACK,
      },
      providers: [
        provider('provider-a', []),
      ],
      transport: {
        execute: async () => {
          transportCalls += 1;

          return okTargetResponse();
        },
      },
    });
    const response = await gateway.handle(oversizedProxyFetchJsonRequest());

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: RESPONSE_CODE.INVALID_PROXY_FETCH_REQUEST,
        message: 'JSON request body exceeded 80 bytes.',
      },
      ok: false,
      version: WIRE_PROTOCOL_VERSION,
    });
    expect(transportCalls).toBe(0);
  });

  it('does not retry unsafe POST without an idempotency key through the gateway', async () => {
    const acquiredProviderIds: string[] = [];
    let transportCalls = 0;
    const gateway = createProxyGateway({
      plan: {
        attempts: [
          {
            maxAttempts: 2,
            provider: 'provider-a',
            retryOn: [RETRY_CONDITION.TARGET_NETWORK_ERROR],
          },
        ],
        kind: PROXY_PLAN_KIND.FALLBACK,
      },
      providers: [
        provider('provider-a', acquiredProviderIds),
      ],
      retrySafety: {
        requireIdempotencyKeyForUnsafeRetries: true,
        retryUnsafeMethods: true,
      },
      transport: {
        execute: async () => {
          transportCalls += 1;

          throw new Error('target failure');
        },
      },
    });
    const response = await gateway.handle(proxyFetchJsonRequest({
      body: {
        kind: 'text',
        text: 'unsafe write',
      },
      method: 'POST',
    }));

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: {
        code: RESPONSE_CODE.TARGET_TRANSPORT_ERROR,
      },
      ok: false,
      version: WIRE_PROTOCOL_VERSION,
    });
    expect(acquiredProviderIds).toEqual(['provider-a']);
    expect(transportCalls).toBe(1);
  });
});

interface IProxyFetchJsonRequestOptions {
  body?: null | {
    kind: 'text';
    text: string;
  };
  headers?: Array<[string, string]>;
  method?: string;
}

function provider(
  id: string,
  acquiredProviderIds: string[],
  overrides: {
    acquire?: ProxyProviderInstance['adapter']['acquire'];
    capabilities?: ProxyProviderCapabilities;
    getCapabilities?: ProxyProviderInstance['adapter']['getCapabilities'];
    release?: NonNullable<ProxyProviderInstance['adapter']['release']>;
    route?: ProxyRoute;
  } = {},
): ProxyProviderInstance {
  return {
    id,
    adapter: {
      acquire:
        overrides.acquire
        ?? (async (input) => {
          acquiredProviderIds.push(input.providerInstanceId);

          return {
            id: `${id}-lease`,
            providerInstanceId: id,
            providerKind: 'test-provider',
            route: overrides.route ?? { kind: PROXY_ROUTE_KIND.DIRECT },
          };
        }),
      getCapabilities: overrides.getCapabilities ?? (() => overrides.capabilities ?? {}),
      kind: 'test-provider',
      ...(overrides.release !== undefined && { release: overrides.release }),
    },
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

function forwardProxyRoute(host: string): ProxyRoute {
  return {
    host,
    kind: PROXY_ROUTE_KIND.FORWARD_PROXY,
    port: 8080,
    protocol: PROXY_PROTOCOL.HTTP,
  };
}

function strictGermanGeoRequirements(): ProxyProviderInstance['adapter']['acquire'] extends (
  input: infer IInput,
) => Promise<unknown>
  ? IInput extends { requirements: infer IRequirements }
    ? IRequirements
    : never
  : never {
  return {
    geo: {
      country: 'DE',
      strictness: PROXY_GEO_STRICTNESS.REQUIRED,
    },
  };
}

function verifiedAfterAcquireGeoCapabilities(): ProxyProviderCapabilities {
  return {
    geo: {
      countries: '*',
      countrySelection: PROXY_PROVIDER_COUNTRY_SELECTION.EXTERNAL_OR_PROVIDER_CONFIG,
      mode: PROXY_PROVIDER_GEO_MODE.VERIFIED_AFTER_ACQUIRE,
    },
  };
}

function proxyFetchJsonRequest(options: IProxyFetchJsonRequestOptions = {}): Request {
  const method = options.method ?? 'GET';

  return new Request('https://gateway.test/proxy', {
    body: JSON.stringify({
      context: {},
      request: {
        body: options.body ?? null,
        headers: options.headers ?? [],
        method,
        url: 'https://example.com/resource',
      },
      version: WIRE_PROTOCOL_VERSION,
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  });
}

function oversizedProxyFetchJsonRequest(): Request {
  return new Request('https://gateway.test/proxy', {
    body: JSON.stringify({
      context: {
        metadata: {
          padding: 'x'.repeat(128),
        },
      },
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
  });
}
