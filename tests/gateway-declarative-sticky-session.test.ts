import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  createMemoryProxySessionStore,
  createProxyGateway,
  type GatewayExecutionContext,
  type GatewayTargetResponse,
  PROXY_IDENTITY_ROTATION,
  PROXY_PLAN_KIND,
  PROXY_ROUTE_KIND,
  type ProxyAcquireInput,
  type ProxyIdentityRequirements,
  type ProxyProviderInstance,
  type ProxySessionRecord,
  type ProxySessionStorePort,
  RETRY_CONDITION,
  type TargetTransportPort,
  WIRE_PROTOCOL_VERSION,
} from '../src';
import { SessionKeyFactory } from '../src/app/sessions';

const keyFactory = new SessionKeyFactory();
const targetUrl = 'https://example.com/resource';
const context = {
  flowKey: 'flow-a',
  routeKey: 'route-a',
  tenantId: 'tenant-a',
};
const stickyIdentity: ProxyIdentityRequirements = {
  isolationKey: 'market:gb',
  rotation: PROXY_IDENTITY_ROTATION.STICKY,
  stickySessionId: 'session-a',
  stickySessionTtlMs: 60_000,
};

afterEach(() => {
  jest.useRealTimers();
});

describe('gateway declarative sticky sessions', () => {
  it('reuses an existing sticky session through route config', async () => {
    const acquired: ProxyAcquireInput[] = [];
    const sessionStore = createMemoryProxySessionStore();

    await seedSession(sessionStore, 'provider-b', stickyIdentity);

    const gateway = createProxyGateway({
      providers: [
        provider('provider-a', acquired),
        provider('provider-b', acquired),
      ],
      routes: [
        {
          id: 'sticky-route',
          match: {
            host: 'example.com',
          },
          plan: implicitFallbackPlan(),
          requirements: {
            identity: stickyIdentity,
          },
        },
      ],
      sessionStore,
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(acquired.map((input) => input.providerInstanceId)).toEqual(['provider-b']);
  });

  it('writes and reuses a sticky session through pipeline config', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2030-01-01T00:00:00.000Z'));

    const firstAcquired: ProxyAcquireInput[] = [];
    const secondAcquired: ProxyAcquireInput[] = [];
    const sessionStore = createMemoryProxySessionStore();
    const firstGateway = createProxyGateway({
      pipelines: [
        {
          id: 'write-sticky',
          plan: [
            {
              args: {
                attempts: [
                  {
                    provider: 'provider-b',
                    requirements: {
                      identity: stickyIdentity,
                    },
                  },
                ],
              },
              use: 'plan.fallback',
            },
          ],
        },
      ],
      providers: [
        provider('provider-a', firstAcquired),
        provider('provider-b', firstAcquired),
      ],
      sessionStore,
      transport: okTransport(),
    });
    const firstResponse = await firstGateway.handle(proxyFetchJsonRequest());
    const providerBKey = sessionKey('provider-b', stickyIdentity);

    expect((await firstResponse.json()).ok).toBe(true);
    expect(firstAcquired.map((input) => input.providerInstanceId)).toEqual(['provider-b']);
    expect(await sessionStore.getMany([providerBKey])).toEqual([
      {
        expiresAt: new Date('2030-01-01T00:01:00.000Z'),
        identity: stickyIdentity,
        key: providerBKey,
        providerInstanceId: 'provider-b',
        providerKind: 'test-provider',
      },
    ]);

    const secondGateway = createProxyGateway({
      pipelines: [
        {
          id: 'read-sticky',
          plan: [
            {
              args: {
                attempts: [
                  {
                    requirements: {
                      identity: stickyIdentity,
                    },
                  },
                ],
              },
              use: 'plan.fallback',
            },
          ],
        },
      ],
      providers: [
        provider('provider-a', secondAcquired),
        provider('provider-b', secondAcquired),
      ],
      sessionStore,
      transport: okTransport(),
    });
    const secondResponse = await secondGateway.handle(proxyFetchJsonRequest());

    expect((await secondResponse.json()).ok).toBe(true);
    expect(secondAcquired.map((input) => input.providerInstanceId)).toEqual(['provider-b']);
  });

  it('does not reuse a sticky session from a different flow', async () => {
    const acquired: ProxyAcquireInput[] = [];
    const sessionStore = createMemoryProxySessionStore();

    await seedSession(sessionStore, 'provider-b', stickyIdentity);

    const gateway = createPipelineGateway({
      acquired,
      sessionStore,
    });
    const response = await gateway.handle(proxyFetchJsonRequest({
      flowKey: 'flow-b',
      routeKey: 'route-a',
      tenantId: 'tenant-a',
    }));

    expect((await response.json()).ok).toBe(true);
    expect(acquired.map((input) => input.providerInstanceId)).toEqual(['provider-a']);
  });

  it('ignores expired sticky sessions and cleans them up through pipeline config', async () => {
    const acquired: ProxyAcquireInput[] = [];
    const sessionStore = createMemoryProxySessionStore();
    const expiredKey = sessionKey('provider-b', stickyIdentity);

    await seedSession(sessionStore, 'provider-b', stickyIdentity, {
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
    });

    const gateway = createPipelineGateway({
      acquired,
      sessionStore,
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(acquired.map((input) => input.providerInstanceId)).toEqual(['provider-a']);
    expect(await sessionStore.getMany([expiredKey])).toEqual([]);
  });

  it('bypasses and replaces an existing sticky session when requestNewIdentity is set', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2030-01-01T00:00:00.000Z'));

    const acquired: ProxyAcquireInput[] = [];
    const sessionStore = createMemoryProxySessionStore();
    const requestNewIdentity = {
      ...stickyIdentity,
      requestNewIdentity: true,
    };
    const oldProviderKey = sessionKey('provider-b', stickyIdentity);
    const newProviderKey = sessionKey('provider-a', requestNewIdentity);

    await seedSession(sessionStore, 'provider-b', stickyIdentity);

    const gateway = createPipelineGateway({
      acquired,
      identity: requestNewIdentity,
      sessionStore,
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(acquired.map((input) => input.providerInstanceId)).toEqual(['provider-a']);
    expect(await sessionStore.getMany([oldProviderKey])).toEqual([]);
    expect(await sessionStore.getMany([newProviderKey])).toEqual([
      {
        expiresAt: new Date('2030-01-01T00:01:00.000Z'),
        identity: requestNewIdentity,
        key: newProviderKey,
        providerInstanceId: 'provider-a',
        providerKind: 'test-provider',
      },
    ]);
  });

  it('updates the sticky provider after declarative fallback success', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2030-01-01T00:00:00.000Z'));

    const acquired: ProxyAcquireInput[] = [];
    const sessionStore = createMemoryProxySessionStore();
    const oldProviderKey = sessionKey('provider-a', stickyIdentity);
    const fallbackProviderKey = sessionKey('provider-b', stickyIdentity);

    await seedSession(sessionStore, 'provider-a', stickyIdentity);

    const gateway = createProxyGateway({
      pipelines: [
        {
          id: 'fallback-sticky',
          plan: [
            {
              args: {
                attempts: [
                  {
                    provider: 'provider-a',
                    requirements: {
                      identity: stickyIdentity,
                    },
                    retryOn: [RETRY_CONDITION.TARGET_NETWORK_ERROR],
                  },
                  {
                    provider: 'provider-b',
                    requirements: {
                      identity: stickyIdentity,
                    },
                  },
                ],
              },
              use: 'plan.fallback',
            },
          ],
        },
      ],
      providers: [
        provider('provider-a', acquired),
        provider('provider-b', acquired),
      ],
      sessionStore,
      transport: {
        execute: async () => {
          if (acquired.length === 1) {
            throw new Error('provider-a failed');
          }

          return okTargetResponse();
        },
      },
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(acquired.map((input) => input.providerInstanceId)).toEqual(['provider-a', 'provider-b']);
    expect(await sessionStore.getMany([oldProviderKey])).toEqual([]);
    expect(await sessionStore.getMany([fallbackProviderKey])).toEqual([
      {
        expiresAt: new Date('2030-01-01T00:01:00.000Z'),
        identity: stickyIdentity,
        key: fallbackProviderKey,
        providerInstanceId: 'provider-b',
        providerKind: 'test-provider',
      },
    ]);
  });
});

interface IPipelineGatewayOptions {
  acquired: ProxyAcquireInput[];
  identity?: ProxyIdentityRequirements;
  sessionStore: ProxySessionStorePort;
}

function createPipelineGateway(options: IPipelineGatewayOptions) {
  const identity = options.identity ?? stickyIdentity;

  return createProxyGateway({
    pipelines: [
      {
        id: 'sticky-pipeline',
        plan: [
          {
            args: {
              attempts: [
                {
                  requirements: {
                    identity,
                  },
                },
              ],
            },
            use: 'plan.fallback',
          },
        ],
      },
    ],
    providers: [
      provider('provider-a', options.acquired),
      provider('provider-b', options.acquired),
    ],
    sessionStore: options.sessionStore,
    transport: okTransport(),
  });
}

async function seedSession(
  sessionStore: ProxySessionStorePort,
  providerInstanceId: string,
  identity: ProxyIdentityRequirements,
  overrides: {
    context?: GatewayExecutionContext;
    expiresAt?: Date;
  } = {},
): Promise<void> {
  const sessionContext = overrides.context ?? context;
  const record: ProxySessionRecord = {
    expiresAt: overrides.expiresAt ?? new Date('2030-01-01T00:00:00.000Z'),
    identity,
    key: sessionKey(providerInstanceId, identity, sessionContext),
    providerInstanceId,
    providerKind: 'test-provider',
  };

  await sessionStore.setMany([record]);
}

function sessionKey(
  providerInstanceId: string,
  identity: ProxyIdentityRequirements,
  sessionContext: GatewayExecutionContext = context,
): string {
  return keyFactory.derive({
    context: sessionContext,
    identity,
    providerInstanceId,
    targetUrl,
  }).key;
}

function provider(id: string, acquired: ProxyAcquireInput[]): ProxyProviderInstance {
  return {
    adapter: {
      acquire: async (input) => {
        acquired.push(input);

        return {
          id: `${id}-lease`,
          providerInstanceId: id,
          providerKind: 'test-provider',
          route: { kind: PROXY_ROUTE_KIND.DIRECT },
        };
      },
      getCapabilities: () => ({}),
      kind: 'test-provider',
    },
    id,
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
    url: targetUrl,
  };
}

function proxyFetchJsonRequest(requestContext: GatewayExecutionContext = context): Request {
  return new Request('https://gateway.test/proxy', {
    body: JSON.stringify({
      context: requestContext,
      request: {
        body: null,
        headers: [],
        method: 'GET',
        url: targetUrl,
      },
      version: WIRE_PROTOCOL_VERSION,
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  });
}
