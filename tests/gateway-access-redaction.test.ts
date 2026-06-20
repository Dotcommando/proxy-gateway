import { describe, expect, it } from '@jest/globals';

import {
  BODY_KIND_TEXT,
  createProxyGateway,
  type GatewayTargetResponse,
  PROXY_PLAN_KIND,
  PROXY_PROTOCOL,
  PROXY_ROUTE_AUTH_MODE,
  PROXY_ROUTE_KIND,
  type ProxyProviderInstance,
  type ProxyRoute,
  RESPONSE_CODE,
  WIRE_PROTOCOL_VERSION,
} from '../src';

const TEST_PROVIDER_KIND = 'test-provider';

describe('gateway target access and redaction integration', () => {
  it('rejects denied targets before plan-configured side effects', async () => {
    const effects = createEffects();
    const gateway = createProxyGateway({
      exitVerifier: {
        verify: async () => {
          effects.verifierCalls += 1;

          return {
            checkedAt: new Date('2026-01-01T00:00:00.000Z'),
            ip: '203.0.113.10',
            matchesRequirements: true,
            source: 'test-verifier',
          };
        },
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
        provider('provider-a', effects),
      ],
      transport: {
        execute: async () => {
          effects.transportCalls += 1;

          return okTargetResponse();
        },
      },
    });
    const response = await gateway.handle(proxyFetchJsonRequest({
      url: 'http://127.0.0.1/private',
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: {
        code: RESPONSE_CODE.TARGET_ACCESS_DENIED,
      },
      ok: false,
      version: WIRE_PROTOCOL_VERSION,
    });
    expect(effects).toEqual({
      acquireCalls: 0,
      capabilityCalls: 0,
      transportCalls: 0,
      verifierCalls: 0,
    });
  });

  it('rejects denied targets before no-plan fallback side effects', async () => {
    const effects = createEffects();
    const gateway = createProxyGateway({
      providers: [
        provider('provider-a', effects),
      ],
      transport: {
        execute: async () => {
          effects.transportCalls += 1;

          return okTargetResponse();
        },
      },
    });
    const response = await gateway.handle(proxyFetchJsonRequest({
      url: 'http://localhost/private',
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: {
        code: RESPONSE_CODE.TARGET_ACCESS_DENIED,
      },
      ok: false,
      version: WIRE_PROTOCOL_VERSION,
    });
    expect(effects).toEqual({
      acquireCalls: 0,
      capabilityCalls: 0,
      transportCalls: 0,
      verifierCalls: 0,
    });
  });

  it('returns redacted diagnostics in service errors after acquire', async () => {
    const effects = createEffects();
    const route = forwardProxyRouteWithCredentials();
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
        provider('provider-a', effects, route),
      ],
      transport: {
        execute: async () => {
          effects.transportCalls += 1;

          throw new Error('target failed');
        },
      },
    });
    const response = await gateway.handle(proxyFetchJsonRequest({
      headers: [
        ['Authorization', 'Bearer target-token'],
        ['cookie', 'session=target-cookie'],
        ['x-api-key', 'target-api-key'],
        ['accept', 'application/json'],
      ],
      url: 'https://target-user:target-password@api.example.com/models?api_key=target-key&token=target-token&name=model',
    }));
    const body = await response.json();
    const serializedBody = JSON.stringify(body);

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      error: {
        code: RESPONSE_CODE.TARGET_TRANSPORT_ERROR,
        details: {
          route: {
            auth: {
              mode: PROXY_ROUTE_AUTH_MODE.USERNAME_PASSWORD,
            },
            host: 'proxy.example.com',
            protocol: PROXY_PROTOCOL.HTTP,
          },
          target: {
            headers: [
              ['Authorization', '<redacted>'],
              ['cookie', '<redacted>'],
              ['x-api-key', '<redacted>'],
              ['accept', 'application/json'],
            ],
          },
        },
      },
      ok: false,
      version: WIRE_PROTOCOL_VERSION,
    });
    expect(serializedBody).toContain('name=model');
    expect(serializedBody).toContain(`api_key=${encodeURIComponent('<redacted>')}`);
    expect(serializedBody).toContain(`token=${encodeURIComponent('<redacted>')}`);
    expect(serializedBody).not.toContain('target-user');
    expect(serializedBody).not.toContain('target-password');
    expect(serializedBody).not.toContain('target-token');
    expect(serializedBody).not.toContain('target-cookie');
    expect(serializedBody).not.toContain('target-api-key');
    expect(serializedBody).not.toContain('target-key');
    expect(serializedBody).not.toContain('route-user');
    expect(serializedBody).not.toContain('route-password');
    expect(serializedBody).not.toContain('route-token');
  });

  it('does not redact or mutate successful target response headers and body', async () => {
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
        provider('provider-a', createEffects()),
      ],
      transport: {
        execute: async () => ({
          body: {
            kind: BODY_KIND_TEXT,
            replayability: 'replayable',
            text: 'secret response body',
          },
          headers: [
            ['authorization', 'Bearer response-token'],
            ['set-cookie', 'session=response-cookie'],
            ['content-type', 'text/plain'],
          ],
          status: 200,
          statusText: 'OK',
          url: 'https://api.example.com/result',
        }),
      },
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect(await response.json()).toEqual({
      ok: true,
      response: {
        body: {
          kind: BODY_KIND_TEXT,
          text: 'secret response body',
        },
        headers: [
          ['authorization', 'Bearer response-token'],
          ['set-cookie', 'session=response-cookie'],
          ['content-type', 'text/plain'],
        ],
        redirected: false,
        status: 200,
        statusText: 'OK',
        type: 'basic',
        url: 'https://api.example.com/result',
      },
      version: WIRE_PROTOCOL_VERSION,
    });
  });
});

interface IEffects {
  acquireCalls: number;
  capabilityCalls: number;
  transportCalls: number;
  verifierCalls: number;
}

interface IProxyFetchJsonRequestOptions {
  headers?: Array<[string, string]>;
  url?: string;
}

function createEffects(): IEffects {
  return {
    acquireCalls: 0,
    capabilityCalls: 0,
    transportCalls: 0,
    verifierCalls: 0,
  };
}

function provider(id: string, effects: IEffects, route: ProxyRoute = { kind: PROXY_ROUTE_KIND.DIRECT }): ProxyProviderInstance {
  return {
    adapter: {
      acquire: async (input) => {
        effects.acquireCalls += 1;

        return {
          id: `${id}-lease`,
          providerInstanceId: input.providerInstanceId,
          providerKind: TEST_PROVIDER_KIND,
          route,
        };
      },
      getCapabilities: () => {
        effects.capabilityCalls += 1;

        return {};
      },
      kind: TEST_PROVIDER_KIND,
    },
    id,
  };
}

function forwardProxyRouteWithCredentials(): ProxyRoute {
  return {
    auth: {
      mode: PROXY_ROUTE_AUTH_MODE.USERNAME_PASSWORD,
      password: 'route-password',
      token: 'route-token',
      username: 'route-user',
    },
    host: 'proxy.example.com',
    kind: PROXY_ROUTE_KIND.FORWARD_PROXY,
    port: 8080,
    protocol: PROXY_PROTOCOL.HTTP,
  };
}

function okTargetResponse(): GatewayTargetResponse {
  return {
    body: {
      kind: BODY_KIND_TEXT,
      replayability: 'replayable',
      text: 'ok',
    },
    headers: [['content-type', 'text/plain']],
    status: 200,
    statusText: 'OK',
    url: 'https://example.com/resource',
  };
}

function proxyFetchJsonRequest(options: IProxyFetchJsonRequestOptions = {}): Request {
  return new Request('https://gateway.test/proxy', {
    body: JSON.stringify({
      context: {},
      request: {
        body: null,
        headers: options.headers ?? [],
        method: 'GET',
        url: options.url ?? 'https://example.com/resource',
      },
      version: WIRE_PROTOCOL_VERSION,
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  });
}
