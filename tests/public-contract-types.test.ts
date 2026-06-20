import { describe, expect, it } from '@jest/globals';

import {
  createMemoryProxySessionStore,
  type NodeHttpHandler,
  PROXY_PLAN_KIND,
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
  type ProxyRouteRequirements,
  type ProxySessionRecord,
  type ProxySessionStorePort,
  RESPONSE_CODE,
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
    const routes: Array<ProxyRouteConfig<ProxyPlanConfig>> = [
      {
        id: 'api-route',
        match: {
          host: 'api.example.com',
        },
        plan,
      },
    ];
    const defaultRoute: ProxyDefaultRouteConfig<ProxyPlanConfig> = {
      id: 'default',
      plan,
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

  it('exposes structured identity requirements on route requirements', () => {
    const identity: ProxyIdentityRequirements = {
      isolationKey: 'tenant-a',
      stickySessionId: 'session-a',
      stickySessionTtlMs: 60_000,
    };
    const requirements: ProxyRouteRequirements = {
      identity,
    };

    expect(requirements.identity).toEqual({
      isolationKey: 'tenant-a',
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
