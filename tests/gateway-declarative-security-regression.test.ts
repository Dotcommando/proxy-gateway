import { describe, expect, it } from '@jest/globals';

import {
  createProxyGateway,
  type GatewayTargetResponse,
  PIPELINE_DECISION_KIND,
  PROXY_PLAN_KIND,
  PROXY_PROTOCOL,
  PROXY_ROUTE_AUTH_MODE,
  PROXY_ROUTE_KIND,
  type ProxyPipelineStep,
  type ProxyPipelineStepRegistryPort,
  type ProxyProviderInstance,
  type ProxyRoute,
  type ProxySessionStorePort,
  RESPONSE_CODE,
  WIRE_PROTOCOL_VERSION,
} from '../src';

describe('gateway declarative security regression', () => {
  it('rejects denied targets before declarative flow side effects', async () => {
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
      pipelines: [
        {
          id: 'side-effect-pipeline',
          plan: [{ use: 'plan.side-effect' }],
        },
      ],
      providers: [
        provider('provider-a', effects),
      ],
      routes: [
        {
          id: 'private-route',
          match: {
            host: '127.0.0.1',
          },
          plan: fallbackPlan('provider-a'),
        },
      ],
      sessionStore: sessionStore(effects),
      stepRegistry: stepRegistry([
        step('plan.side-effect', async () => {
          effects.pipelineCalls += 1;

          return {
            decision: {
              kind: PIPELINE_DECISION_KIND.USE_PLAN,
              plan: {
                attempts: [
                  {
                    providerInstanceId: 'provider-a',
                  },
                ],
                kind: PROXY_PLAN_KIND.FALLBACK,
              },
            },
          };
        }),
      ]),
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
      pipelineCalls: 0,
      sessionDeletes: 0,
      sessionReads: 0,
      sessionTouches: 0,
      sessionWrites: 0,
      transportCalls: 0,
      verifierCalls: 0,
    });
  });

  it('redacts service error diagnostics from declarative route and pipeline flow', async () => {
    const effects = createEffects();
    const gateway = createProxyGateway({
      pipelines: [
        {
          id: 'pipeline-plan',
          plan: [
            {
              args: {
                attempts: [
                  {
                    provider: 'provider-a',
                  },
                ],
              },
              use: 'plan.fallback',
            },
          ],
        },
      ],
      providers: [
        provider('provider-a', effects, forwardProxyRouteWithCredentials()),
      ],
      routes: [
        {
          id: 'api-route',
          match: {
            host: 'api.example.com',
          },
          plan: fallbackPlan('provider-a'),
        },
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
});

interface IEffects {
  acquireCalls: number;
  capabilityCalls: number;
  pipelineCalls: number;
  sessionDeletes: number;
  sessionReads: number;
  sessionTouches: number;
  sessionWrites: number;
  transportCalls: number;
  verifierCalls: number;
}

interface IProxyFetchJsonRequestOptions {
  headers?: Array<[string, string]>;
  url: string;
}

function createEffects(): IEffects {
  return {
    acquireCalls: 0,
    capabilityCalls: 0,
    pipelineCalls: 0,
    sessionDeletes: 0,
    sessionReads: 0,
    sessionTouches: 0,
    sessionWrites: 0,
    transportCalls: 0,
    verifierCalls: 0,
  };
}

function step(type: string, execute: ProxyPipelineStep['execute']): ProxyPipelineStep {
  return {
    execute,
    type,
  };
}

function stepRegistry(steps: ProxyPipelineStep[]): ProxyPipelineStepRegistryPort {
  const stepByType = new Map(steps.map((pipelineStep) => [pipelineStep.type, pipelineStep]));

  return {
    get: (type) => stepByType.get(type),
    register: (pipelineStep) => {
      stepByType.set(pipelineStep.type, pipelineStep);
    },
  };
}

function sessionStore(effects: IEffects): ProxySessionStorePort {
  return {
    deleteMany: async (keys) => {
      effects.sessionDeletes += keys.length;
    },
    getMany: async (keys) => {
      effects.sessionReads += keys.length;

      return [];
    },
    setMany: async (records) => {
      effects.sessionWrites += records.length;
    },
    touchMany: async (touches) => {
      effects.sessionTouches += touches.length;
    },
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
          providerKind: 'test-provider',
          route,
        };
      },
      getCapabilities: () => {
        effects.capabilityCalls += 1;

        return {};
      },
      kind: 'test-provider',
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
    metadata: {
      providerPassword: 'route-metadata-password',
    },
    port: 8080,
    protocol: PROXY_PROTOCOL.HTTP,
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
        headers: options.headers ?? [],
        method: 'GET',
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
