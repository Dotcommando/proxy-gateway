import { describe, expect, it } from '@jest/globals';

import {
  createProxyGateway,
  type GatewayTargetResponse,
  PROXY_PLAN_KIND,
  PROXY_PROTOCOL,
  PROXY_ROUTE_KIND,
  type ProxyProviderCapabilities,
  type ProxyProviderInstance,
  RESPONSE_CODE,
  STRING_MATCHER_KIND,
  type TargetTransportPort,
  WIRE_PROTOCOL_VERSION,
} from '../src';

describe('gateway route selection wiring', () => {
  it('matches a configured route by host, path, and method', async () => {
    const acquiredProviderIds: string[] = [];
    const gateway = createProxyGateway({
      providers: [
        provider('provider-a', acquiredProviderIds),
        provider('provider-b', acquiredProviderIds),
      ],
      routes: [
        {
          id: 'api-post',
          match: {
            host: 'api.example.com',
            method: 'POST',
            path: {
              type: STRING_MATCHER_KIND.GLOB,
              value: '/v1/**',
            },
          },
          plan: fallbackPlan('provider-b'),
        },
      ],
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest({
      method: 'POST',
      url: 'https://api.example.com/v1/models',
    }));

    expect((await response.json()).ok).toBe(true);
    expect(acquiredProviderIds).toEqual(['provider-b']);
  });

  it('uses route priority before declaration order', async () => {
    const acquiredProviderIds: string[] = [];
    const gateway = createProxyGateway({
      providers: [
        provider('provider-a', acquiredProviderIds),
        provider('provider-b', acquiredProviderIds),
      ],
      routes: [
        {
          id: 'low-priority',
          match: {
            host: 'api.example.com',
          },
          plan: fallbackPlan('provider-a'),
          priority: 1,
        },
        {
          id: 'high-priority',
          match: {
            host: 'api.example.com',
          },
          plan: fallbackPlan('provider-b'),
          priority: 10,
        },
      ],
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest({
      url: 'https://api.example.com/v1/models',
    }));

    expect((await response.json()).ok).toBe(true);
    expect(acquiredProviderIds).toEqual(['provider-b']);
  });

  it('evaluates route exclude after a positive match', async () => {
    const acquiredProviderIds: string[] = [];
    const gateway = createProxyGateway({
      providers: [
        provider('provider-a', acquiredProviderIds),
        provider('provider-b', acquiredProviderIds),
      ],
      routes: [
        {
          exclude: {
            path: {
              type: STRING_MATCHER_KIND.GLOB,
              value: '/admin/**',
            },
          },
          id: 'public-api',
          match: {
            host: 'api.example.com',
          },
          plan: fallbackPlan('provider-a'),
          priority: 10,
        },
        {
          id: 'admin-fallback',
          match: {
            host: 'api.example.com',
          },
          plan: fallbackPlan('provider-b'),
          priority: 1,
        },
      ],
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest({
      url: 'https://api.example.com/admin/users',
    }));

    expect((await response.json()).ok).toBe(true);
    expect(acquiredProviderIds).toEqual(['provider-b']);
  });

  it('uses the default route when no configured route matches', async () => {
    const acquiredProviderIds: string[] = [];
    const gateway = createProxyGateway({
      defaultRoute: {
        id: 'default-route',
        plan: fallbackPlan('provider-b'),
      },
      providers: [
        provider('provider-a', acquiredProviderIds),
        provider('provider-b', acquiredProviderIds),
      ],
      routes: [
        {
          id: 'vendor-api',
          match: {
            host: 'vendor.example.com',
          },
          plan: fallbackPlan('provider-a'),
        },
      ],
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest({
      url: 'https://unknown.example.com/resource',
    }));

    expect((await response.json()).ok).toBe(true);
    expect(acquiredProviderIds).toEqual(['provider-b']);
  });

  it('returns NO_ROUTE_MATCHED when no route and no default route match', async () => {
    const acquiredProviderIds: string[] = [];
    const gateway = createProxyGateway({
      providers: [
        provider('provider-a', acquiredProviderIds),
      ],
      routes: [
        {
          id: 'vendor-api',
          match: {
            host: 'vendor.example.com',
          },
          plan: fallbackPlan('provider-a'),
        },
      ],
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest({
      url: 'https://unknown.example.com/resource',
    }));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: {
        code: RESPONSE_CODE.NO_ROUTE_MATCHED,
      },
      ok: false,
      version: WIRE_PROTOCOL_VERSION,
    });
    expect(acquiredProviderIds).toEqual([]);
  });

  it('matches routes against the normalized target request', async () => {
    const acquiredProviderIds: string[] = [];
    const gateway = createProxyGateway({
      providers: [
        provider('provider-a', acquiredProviderIds),
        provider('provider-b', acquiredProviderIds),
      ],
      routes: [
        {
          id: 'normalized-api',
          match: {
            host: 'api.example.com',
            path: '/v1/models',
          },
          plan: fallbackPlan('provider-b'),
        },
      ],
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest({
      url: 'https://API.Example.COM./v1/models?limit=10',
    }));

    expect((await response.json()).ok).toBe(true);
    expect(acquiredProviderIds).toEqual(['provider-b']);
  });

  it('checks target access before route-selected planning side effects', async () => {
    let capabilityCalls = 0;
    let transportCalls = 0;
    const gateway = createProxyGateway({
      providers: [
        provider('provider-a', [], {
          getCapabilities: () => {
            capabilityCalls += 1;

            return {};
          },
        }),
      ],
      routes: [
        {
          id: 'localhost',
          match: {
            host: '127.0.0.1',
          },
          plan: fallbackPlan('provider-a'),
        },
      ],
      transport: {
        execute: async () => {
          transportCalls += 1;

          return okTargetResponse();
        },
      },
    });
    const response = await gateway.handle(proxyFetchJsonRequest({
      url: 'http://127.0.0.1/admin',
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: {
        code: RESPONSE_CODE.TARGET_ACCESS_DENIED,
      },
      ok: false,
      version: WIRE_PROTOCOL_VERSION,
    });
    expect(capabilityCalls).toBe(0);
    expect(transportCalls).toBe(0);
  });

  it('merges matched route requirements into route-selected plan attempts before planning', async () => {
    const acquiredProviderIds: string[] = [];
    const gateway = createProxyGateway({
      providers: [
        provider('provider-a', acquiredProviderIds, {
          capabilities: {
            protocols: [PROXY_PROTOCOL.HTTP],
          },
        }),
        provider('provider-b', acquiredProviderIds, {
          capabilities: {
            protocols: [PROXY_PROTOCOL.SOCKS5H],
          },
        }),
      ],
      routes: [
        {
          id: 'socks-api',
          match: {
            host: 'api.example.com',
          },
          plan: implicitFallbackPlan(),
          requirements: {
            protocols: [PROXY_PROTOCOL.SOCKS5H],
          },
        },
      ],
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest({
      url: 'https://api.example.com/v1/models',
    }));

    expect((await response.json()).ok).toBe(true);
    expect(acquiredProviderIds).toEqual(['provider-b']);
  });

  it('merges default route requirements into default-route plan attempts before planning', async () => {
    const acquiredProviderIds: string[] = [];
    const gateway = createProxyGateway({
      defaultRoute: {
        id: 'default-socks',
        plan: implicitFallbackPlan(),
        requirements: {
          providerInstanceIds: ['provider-b'],
        },
      },
      providers: [
        provider('provider-a', acquiredProviderIds),
        provider('provider-b', acquiredProviderIds),
      ],
      routes: [],
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest({
      url: 'https://unknown.example.com/v1/models',
    }));

    expect((await response.json()).ok).toBe(true);
    expect(acquiredProviderIds).toEqual(['provider-b']);
  });
});

interface IProxyFetchJsonRequestOptions {
  method?: string;
  url: string;
}

interface IProviderOverrides {
  capabilities?: ProxyProviderCapabilities;
  getCapabilities?: ProxyProviderInstance['adapter']['getCapabilities'];
}

function provider(
  id: string,
  acquiredProviderIds: string[],
  overrides: IProviderOverrides = {},
): ProxyProviderInstance {
  return {
    id,
    adapter: {
      acquire: async (input) => {
        acquiredProviderIds.push(input.providerInstanceId);

        return {
          id: `${id}-lease`,
          providerInstanceId: id,
          providerKind: 'test-provider',
          route: { kind: PROXY_ROUTE_KIND.DIRECT },
        };
      },
      getCapabilities: overrides.getCapabilities ?? (() => overrides.capabilities ?? {}),
      kind: 'test-provider',
    },
  };
}

function fallbackPlan(providerId: string) {
  return {
    attempts: [
      {
        provider: providerId,
      },
    ],
    kind: PROXY_PLAN_KIND.FALLBACK,
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

function proxyFetchJsonRequest(options: IProxyFetchJsonRequestOptions): Request {
  return new Request('https://gateway.test/proxy', {
    body: JSON.stringify({
      context: {},
      request: {
        body: null,
        headers: [],
        method: options.method ?? 'GET',
        url: options.url,
      },
      version: WIRE_PROTOCOL_VERSION,
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  });
}
