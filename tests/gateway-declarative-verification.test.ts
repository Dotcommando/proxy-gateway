import { describe, expect, it } from '@jest/globals';

import {
  createProxyGateway,
  type ForwardProxyRoute,
  type GatewayTargetResponse,
  PIPELINE_STEP_TYPE,
  PROXY_DNS_MODE,
  PROXY_GEO_STRICTNESS,
  PROXY_PLAN_KIND,
  PROXY_PROTOCOL,
  PROXY_PROVIDER_COUNTRY_SELECTION,
  PROXY_PROVIDER_GEO_MODE,
  PROXY_ROUTE_KIND,
  type ProxyAcquireInput,
  type ProxyExitVerifyInput,
  type ProxyProviderCapabilities,
  type ProxyProviderInstance,
  RESPONSE_CODE,
  RETRY_CONDITION,
  type TargetTransportPort,
  WIRE_PROTOCOL_VERSION,
} from '../src';

describe('gateway declarative verification', () => {
  it('runs exit verification from route-level requirements', async () => {
    const acquired: ProxyAcquireInput[] = [];
    const verified: ProxyExitVerifyInput[] = [];
    const gateway = createProxyGateway({
      exitVerifier: {
        verify: async (input) => {
          verified.push(input);

          return exitVerification({
            country: 'DE',
            ip: '203.0.113.10',
            matchesRequirements: true,
          });
        },
      },
      providers: [
        provider('geo-provider', acquired, {
          capabilities: verifiedAfterAcquireCapabilities(),
        }),
      ],
      routes: [
        {
          id: 'geo-api',
          match: {
            host: 'api.example.com',
          },
          plan: implicitFallbackPlan(),
          requirements: strictGermanGeoRequirements(),
        },
      ],
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(acquired.map((input) => input.providerInstanceId)).toEqual(['geo-provider']);
    expect(verified).toHaveLength(1);
    expect(verified[0]?.expected).toEqual({
      country: 'DE',
      strictness: PROXY_GEO_STRICTNESS.REQUIRED,
    });
  });

  it('runs exit verification from pipeline plan.fallback verification args', async () => {
    const acquired: ProxyAcquireInput[] = [];
    const verified: ProxyExitVerifyInput[] = [];
    const gateway = createProxyGateway({
      exitVerifier: {
        verify: async (input) => {
          verified.push(input);

          return exitVerification({
            country: 'DE',
            ip: '203.0.113.20',
            matchesRequirements: true,
          });
        },
      },
      pipelines: [
        {
          id: 'pipeline-geo',
          plan: [
            {
              args: {
                attempts: [
                  {
                    provider: 'geo-provider',
                    requirements: strictGermanGeoRequirements(),
                    verification: {
                      rejectOnGeoMismatch: true,
                      verifyExit: true,
                    },
                  },
                ],
              },
              use: PIPELINE_STEP_TYPE.PLAN_FALLBACK,
            },
          ],
        },
      ],
      providers: [
        provider('geo-provider', acquired, {
          capabilities: verifiedAfterAcquireCapabilities(),
        }),
      ],
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(acquired.map((input) => input.providerInstanceId)).toEqual(['geo-provider']);
    expect(verified).toHaveLength(1);
    expect(verified[0]?.expected?.country).toBe('DE');
  });

  it('falls back after declarative pipeline geo mismatch when retry policy allows it', async () => {
    const acquired: ProxyAcquireInput[] = [];
    const verifiedProviderIds: string[] = [];
    const transportedHosts: string[] = [];
    const gateway = createProxyGateway({
      exitVerifier: {
        verify: async (input) => {
          verifiedProviderIds.push(input.lease.providerInstanceId);

          return exitVerification({
            country: input.lease.providerInstanceId === 'geo-provider-a' ? 'FR' : 'DE',
            ip: input.lease.providerInstanceId === 'geo-provider-a' ? '203.0.113.31' : '203.0.113.32',
            matchesRequirements: input.lease.providerInstanceId === 'geo-provider-b',
          });
        },
      },
      pipelines: [
        {
          id: 'pipeline-fallback',
          plan: [
            {
              args: {
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
              },
              use: PIPELINE_STEP_TYPE.PLAN_FALLBACK,
            },
          ],
        },
      ],
      providers: [
        provider('geo-provider-a', acquired, {
          capabilities: verifiedAfterAcquireCapabilities(),
          routeHost: 'geo-a.proxy.test',
        }),
        provider('geo-provider-b', acquired, {
          capabilities: verifiedAfterAcquireCapabilities(),
          routeHost: 'geo-b.proxy.test',
        }),
      ],
      transport: {
        execute: async (input) => {
          if (input.route.kind === PROXY_ROUTE_KIND.FORWARD_PROXY) {
            transportedHosts.push(input.route.host);
          }

          return okTargetResponse();
        },
      },
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(acquired.map((input) => input.providerInstanceId)).toEqual(['geo-provider-a', 'geo-provider-b']);
    expect(verifiedProviderIds).toEqual(['geo-provider-a', 'geo-provider-b']);
    expect(transportedHosts).toEqual(['geo-b.proxy.test']);
  });

  it('rejects route-level verified-after-acquire geo before acquire when no verifier is configured', async () => {
    const acquired: ProxyAcquireInput[] = [];
    let transported = false;
    const gateway = createProxyGateway({
      providers: [
        provider('geo-provider', acquired, {
          capabilities: verifiedAfterAcquireCapabilities(),
        }),
      ],
      routes: [
        {
          id: 'geo-api',
          match: {
            host: 'api.example.com',
          },
          plan: implicitFallbackPlan(),
          requirements: strictGermanGeoRequirements(),
        },
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
    expect(acquired).toEqual([]);
    expect(transported).toBe(false);
  });
});

interface IExitVerificationOptions {
  country: string;
  ip: string;
  matchesRequirements: boolean;
}

function exitVerification(options: IExitVerificationOptions) {
  return {
    checkedAt: new Date('2026-01-01T00:00:00.000Z'),
    country: options.country,
    ip: options.ip,
    matchesRequirements: options.matchesRequirements,
    source: 'test-verifier',
  };
}

function strictGermanGeoRequirements() {
  return {
    geo: {
      country: 'DE',
      strictness: PROXY_GEO_STRICTNESS.REQUIRED,
    },
  };
}

function verifiedAfterAcquireCapabilities(): ProxyProviderCapabilities {
  return {
    geo: {
      countries: '*',
      countrySelection: PROXY_PROVIDER_COUNTRY_SELECTION.EXTERNAL_OR_PROVIDER_CONFIG,
      mode: PROXY_PROVIDER_GEO_MODE.VERIFIED_AFTER_ACQUIRE,
    },
    protocols: [PROXY_PROTOCOL.HTTP],
  };
}

interface IProviderOptions {
  capabilities?: ProxyProviderCapabilities;
  routeHost?: string;
}

function provider(
  id: string,
  acquired: ProxyAcquireInput[],
  options: IProviderOptions = {},
): ProxyProviderInstance {
  return {
    id,
    adapter: {
      acquire: async (input) => {
        acquired.push(input);

        return {
          id: `${id}-lease`,
          providerInstanceId: id,
          providerKind: 'test-provider',
          route: options.routeHost === undefined ? { kind: PROXY_ROUTE_KIND.DIRECT } : forwardProxyRoute(options.routeHost),
        };
      },
      getCapabilities: () => options.capabilities ?? {},
      kind: 'test-provider',
    },
  };
}

function forwardProxyRoute(host: string): ForwardProxyRoute {
  return {
    dns: PROXY_DNS_MODE.PROXY,
    host,
    kind: PROXY_ROUTE_KIND.FORWARD_PROXY,
    port: 8080,
    protocol: PROXY_PROTOCOL.HTTP,
  };
}

function implicitFallbackPlan() {
  return {
    attempts: [{}],
    kind: PROXY_PLAN_KIND.FALLBACK,
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

function proxyFetchJsonRequest(): Request {
  return new Request('https://gateway.test/proxy', {
    body: JSON.stringify({
      context: {},
      request: {
        body: null,
        headers: [],
        method: 'GET',
        url: 'https://api.example.com/v1/models',
      },
      version: WIRE_PROTOCOL_VERSION,
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  });
}
