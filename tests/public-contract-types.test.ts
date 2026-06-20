import { describe, expect, it } from '@jest/globals';

import {
  createMemoryProxySessionStore,
  type NodeHttpHandler,
  PROXY_IDENTITY_ISOLATION_SCOPE,
  PROXY_IDENTITY_ROTATION,
  PROXY_PLAN_KIND,
  PROXY_PROTOCOL,
  PROXY_ROUTE_KIND,
  type ProxyDefaultRouteConfig,
  type ProxyGatewayOptions,
  type ProxyIdentityRequirements,
  type ProxyPipelineConfig,
  type ProxyPipelineStep,
  type ProxyPipelineStepRegistryPort,
  type ProxyPlanConfig,
  type ProxyProviderInstance,
  type ProxyRouteConfig,
  type ProxyRouteMatch,
  type ProxyRouteRequirements,
  type ProxySessionRecord,
  type ProxySessionStorePort,
  RESPONSE_CODE,
  STRING_MATCHER_KIND,
  TARGET_ACCESS_REJECTION_REASON,
  TARGET_ACCESS_RESULT_KIND,
  type TargetFinalUrlCheckInput,
  type TargetFinalUrlCheckResult,
  type TargetFinalUrlGuardPort,
} from '../src';

describe('public contract types', () => {
  it('exports Node HTTP handler and final URL guard public types', () => {
    const handler: NodeHttpHandler = async (_request, response) => {
      response.statusCode = 204;
      response.end();
    };
    const checkInput: TargetFinalUrlCheckInput = {
      baseUrl: 'https://example.com/start',
      url: 'https://example.com/final',
    };
    const allowedGuard: TargetFinalUrlGuardPort = {
      check: () => ({
        kind: TARGET_ACCESS_RESULT_KIND.ALLOWED,
      }),
    };
    const rejectedResult: TargetFinalUrlCheckResult = {
      code: RESPONSE_CODE.TARGET_ACCESS_DENIED,
      kind: TARGET_ACCESS_RESULT_KIND.REJECTED,
      message: 'Denied.',
      reason: TARGET_ACCESS_REJECTION_REASON.PRIVATE_IP_RANGE,
      status: 403,
    };

    expect(typeof handler).toBe('function');
    expect(allowedGuard.check(checkInput)).toEqual({
      kind: TARGET_ACCESS_RESULT_KIND.ALLOWED,
    });
    expect(rejectedResult).toEqual({
      code: RESPONSE_CODE.TARGET_ACCESS_DENIED,
      kind: TARGET_ACCESS_RESULT_KIND.REJECTED,
      message: 'Denied.',
      reason: TARGET_ACCESS_REJECTION_REASON.PRIVATE_IP_RANGE,
      status: 403,
    });
  });

  it('accepts v0.2 route, pipeline, step registry, and session-store gateway options', () => {
    const provider: ProxyProviderInstance = {
      adapter: {
        acquire: async (input) => ({
          id: 'lease-1',
          providerInstanceId: input.providerInstanceId,
          providerKind: 'test-provider',
          route: { kind: PROXY_ROUTE_KIND.DIRECT },
        }),
        getCapabilities: () => ({}),
        kind: 'test-provider',
      },
      id: 'provider-a',
    };
    const plan: ProxyPlanConfig = {
      attempts: [{ provider: 'provider-a' }],
      kind: PROXY_PLAN_KIND.FALLBACK,
    };
    const routes: Array<ProxyRouteConfig<ProxyPlanConfig, ProxyRouteRequirements>> = [
      {
        id: 'api-route',
        match: {
          host: 'api.example.com',
        },
        plan,
        requirements: {
          protocols: [PROXY_PROTOCOL.HTTP],
        },
      },
    ];
    const defaultRoute: ProxyDefaultRouteConfig<ProxyPlanConfig, ProxyRouteRequirements> = {
      id: 'default',
      plan,
      requirements: {
        protocols: [PROXY_PROTOCOL.HTTP],
      },
    };
    const pipelineStep: ProxyPipelineStep = {
      execute: async () => ({}),
      type: 'plan.fallback',
    };
    const stepRegistry: ProxyPipelineStepRegistryPort = {
      get: (type) => (type === pipelineStep.type ? pipelineStep : undefined),
      register: () => undefined,
    };
    const pipelines: ProxyPipelineConfig[] = [
      {
        id: 'api-pipeline',
        plan: [{ use: 'plan.fallback' }],
      },
    ];
    const sessionStore = createMemoryProxySessionStore();
    const options: ProxyGatewayOptions = {
      defaultRoute,
      pipelines,
      providers: [provider],
      routes,
      sessionStore,
      stepRegistry,
    };

    expect(options.routes).toBe(routes);
    expect(options.defaultRoute).toBe(defaultRoute);
    expect(options.pipelines).toBe(pipelines);
    expect(options.stepRegistry).toBe(stepRegistry);
    expect(options.sessionStore).toBe(sessionStore);
  });

  it('binds route configs to matcher, plan, and requirements contracts', () => {
    const routeMatch: ProxyRouteMatch = {
      host: {
        type: STRING_MATCHER_KIND.SUFFIX,
        value: '.example.com',
      },
      method: ['GET', 'POST'],
      path: {
        type: STRING_MATCHER_KIND.GLOB,
        value: '/api/**',
      },
      url: {
        type: STRING_MATCHER_KIND.PREFIX,
        value: 'https://',
      },
    };
    const plan: ProxyPlanConfig = {
      attempts: [
        {
          provider: 'provider-a',
          requirements: {
            identity: {
              rotation: PROXY_IDENTITY_ROTATION.STICKY,
              stickySessionId: 'route-session',
            },
          },
        },
      ],
      kind: PROXY_PLAN_KIND.FALLBACK,
    };
    const requirements: ProxyRouteRequirements = {
      identity: {
        rotation: PROXY_IDENTITY_ROTATION.STICKY,
        stickySessionTtlMs: 60_000,
      },
      protocols: [PROXY_PROTOCOL.HTTP],
      providerInstanceIds: ['provider-a'],
    };
    const route: ProxyRouteConfig<ProxyPlanConfig, ProxyRouteRequirements> = {
      exclude: {
        path: {
          type: STRING_MATCHER_KIND.PREFIX,
          value: '/api/internal',
        },
      },
      id: 'api-route',
      match: routeMatch,
      plan,
      priority: 10,
      requirements,
    };
    const defaultRoute: ProxyDefaultRouteConfig<ProxyPlanConfig, ProxyRouteRequirements> = {
      id: 'default-route',
      plan,
      requirements,
    };
    const options: ProxyGatewayOptions = {
      defaultRoute,
      providers: [],
      routes: [route],
    };

    expect(route.match).toBe(routeMatch);
    expect(route.plan).toBe(plan);
    expect(route.requirements).toBe(requirements);
    expect(defaultRoute.requirements).toBe(requirements);
    expect(options.routes).toEqual([route]);
    expect(options.defaultRoute).toBe(defaultRoute);
  });

  it('exposes structured identity requirements on route requirements', () => {
    const identity: ProxyIdentityRequirements = {
      isolationKey: 'market:gb',
      isolationScope: [
        PROXY_IDENTITY_ISOLATION_SCOPE.TENANT,
        PROXY_IDENTITY_ISOLATION_SCOPE.FLOW,
        PROXY_IDENTITY_ISOLATION_SCOPE.ROUTE,
        PROXY_IDENTITY_ISOLATION_SCOPE.PROVIDER,
        PROXY_IDENTITY_ISOLATION_SCOPE.TARGET_HOST,
        PROXY_IDENTITY_ISOLATION_SCOPE.ATTEMPT,
      ],
      requestNewIdentity: true,
      rotation: PROXY_IDENTITY_ROTATION.STICKY,
      stickySessionId: 'session-a',
      stickySessionTtlMs: 60_000,
    };
    const fixedIdentity: ProxyIdentityRequirements = {
      rotation: PROXY_IDENTITY_ROTATION.FIXED,
    };
    const perRequestIdentity: ProxyIdentityRequirements = {
      rotation: PROXY_IDENTITY_ROTATION.PER_REQUEST,
    };
    const requirements: ProxyRouteRequirements = {
      identity,
    };

    expect(PROXY_IDENTITY_ROTATION.STICKY).toBe('sticky');
    expect(PROXY_IDENTITY_ROTATION.FIXED).toBe('fixed');
    expect(PROXY_IDENTITY_ROTATION.PER_REQUEST).toBe('per-request');
    expect(PROXY_IDENTITY_ISOLATION_SCOPE.TENANT).toBe('tenant');
    expect(PROXY_IDENTITY_ISOLATION_SCOPE.FLOW).toBe('flow');
    expect(PROXY_IDENTITY_ISOLATION_SCOPE.ROUTE).toBe('route');
    expect(PROXY_IDENTITY_ISOLATION_SCOPE.PROVIDER).toBe('provider');
    expect(PROXY_IDENTITY_ISOLATION_SCOPE.TARGET_HOST).toBe('target-host');
    expect(PROXY_IDENTITY_ISOLATION_SCOPE.ATTEMPT).toBe('attempt');
    expect(fixedIdentity.rotation).toBe(PROXY_IDENTITY_ROTATION.FIXED);
    expect(perRequestIdentity.rotation).toBe(PROXY_IDENTITY_ROTATION.PER_REQUEST);
    expect(requirements.identity).toEqual({
      isolationKey: 'market:gb',
      isolationScope: [
        PROXY_IDENTITY_ISOLATION_SCOPE.TENANT,
        PROXY_IDENTITY_ISOLATION_SCOPE.FLOW,
        PROXY_IDENTITY_ISOLATION_SCOPE.ROUTE,
        PROXY_IDENTITY_ISOLATION_SCOPE.PROVIDER,
        PROXY_IDENTITY_ISOLATION_SCOPE.TARGET_HOST,
        PROXY_IDENTITY_ISOLATION_SCOPE.ATTEMPT,
      ],
      requestNewIdentity: true,
      rotation: PROXY_IDENTITY_ROTATION.STICKY,
      stickySessionId: 'session-a',
      stickySessionTtlMs: 60_000,
    });
  });

  it('exports the session store port, session record, and memory store factory contracts', async () => {
    const record: ProxySessionRecord = {
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      key: 'tenant-a:route-a',
      providerInstanceId: 'provider-a',
      providerKind: 'test-provider',
    };
    const records = new Map<string, ProxySessionRecord>();
    const store: ProxySessionStorePort = {
      deleteMany: async (keys) => {
        for (const key of keys) {
          records.delete(key);
        }
      },
      getMany: async (keys) =>
        keys.flatMap((key) => {
          const found = records.get(key);

          return found === undefined ? [] : [found];
        }),
      setMany: async (nextRecords) => {
        for (const nextRecord of nextRecords) {
          records.set(nextRecord.key, nextRecord);
        }
      },
      touchMany: async (touches) => {
        for (const touch of touches) {
          const found = records.get(touch.key);

          if (found !== undefined) {
            records.set(touch.key, {
              ...found,
              expiresAt: touch.expiresAt,
            });
          }
        }
      },
    };
    const memoryStore: ProxySessionStorePort = createMemoryProxySessionStore();

    await store.setMany([record]);

    expect(await store.getMany([record.key])).toEqual([record]);
    expect(memoryStore).toEqual({
      deleteMany: expect.any(Function),
      getMany: expect.any(Function),
      setMany: expect.any(Function),
      touchMany: expect.any(Function),
    });
  });
});
