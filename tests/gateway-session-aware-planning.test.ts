import { describe, expect, it } from '@jest/globals';

import {
  createMemoryProxySessionStore,
  createProxyGateway,
  type GatewayTargetResponse,
  PROXY_IDENTITY_ROTATION,
  PROXY_PLAN_KIND,
  PROXY_PROTOCOL,
  PROXY_ROUTE_KIND,
  type ProxyIdentityRequirements,
  type ProxyProviderInstance,
  type ProxyRoute,
  type ProxySessionRecord,
  type ProxySessionStorePort,
  RESPONSE_CODE,
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

describe('gateway session-aware planning', () => {
  it('pins the first planned attempt to an existing sticky-session provider', async () => {
    const acquiredProviderIds: string[] = [];
    const sessionStore = createMemoryProxySessionStore();

    await seedSession(sessionStore, 'provider-b', stickyIdentity);

    const gateway = createProxyGateway({
      plan: {
        attempts: [
          {
            requirements: {
              identity: stickyIdentity,
            },
          },
        ],
        kind: PROXY_PLAN_KIND.FALLBACK,
      },
      providers: [
        provider('provider-a', acquiredProviderIds),
        provider('provider-b', acquiredProviderIds),
      ],
      sessionStore,
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(acquiredProviderIds).toEqual(['provider-b']);
  });

  it('rejects an incompatible explicit provider constraint before acquire', async () => {
    const acquiredProviderIds: string[] = [];
    const sessionStore = createMemoryProxySessionStore();

    await seedSession(sessionStore, 'provider-b', stickyIdentity);

    const gateway = createProxyGateway({
      plan: {
        attempts: [
          {
            provider: 'provider-a',
            requirements: {
              identity: stickyIdentity,
            },
          },
        ],
        kind: PROXY_PLAN_KIND.FALLBACK,
      },
      providers: [
        provider('provider-a', acquiredProviderIds),
        provider('provider-b', acquiredProviderIds),
      ],
      sessionStore,
      transport: okTransport(),
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
    expect(acquiredProviderIds).toEqual([]);
  });

  it('keeps fallback attempts available when a session-pinned first attempt fails', async () => {
    const acquiredProviderIds: string[] = [];
    const sessionStore = createMemoryProxySessionStore();

    await seedSession(sessionStore, 'provider-b', stickyIdentity);

    const gateway = createProxyGateway({
      plan: {
        attempts: [
          {
            requirements: {
              identity: stickyIdentity,
            },
            retryOn: [RETRY_CONDITION.TARGET_NETWORK_ERROR],
          },
          {
            provider: 'provider-c',
          },
        ],
        kind: PROXY_PLAN_KIND.FALLBACK,
      },
      providers: [
        provider('provider-a', acquiredProviderIds),
        provider('provider-b', acquiredProviderIds, {
          route: forwardProxyRoute('session-provider.example'),
        }),
        provider('provider-c', acquiredProviderIds),
      ],
      sessionStore,
      transport: {
        execute: async (input) => {
          if (
            input.route.kind === PROXY_ROUTE_KIND.FORWARD_PROXY
            && input.route.host === 'session-provider.example'
          ) {
            throw new Error('session provider failed');
          }

          return okTargetResponse();
        },
      },
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(acquiredProviderIds).toEqual(['provider-b', 'provider-c']);
  });

  it('bypasses an existing sticky session when requestNewIdentity is set', async () => {
    const acquiredProviderIds: string[] = [];
    const sessionStore = createMemoryProxySessionStore();
    const requestNewIdentity = {
      ...stickyIdentity,
      requestNewIdentity: true,
    };

    await seedSession(sessionStore, 'provider-b', stickyIdentity);

    const gateway = createProxyGateway({
      plan: {
        attempts: [
          {
            requirements: {
              identity: requestNewIdentity,
            },
          },
        ],
        kind: PROXY_PLAN_KIND.FALLBACK,
      },
      providers: [
        provider('provider-a', acquiredProviderIds),
        provider('provider-b', acquiredProviderIds),
      ],
      sessionStore,
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(acquiredProviderIds).toEqual(['provider-a']);
  });
});

async function seedSession(
  sessionStore: ProxySessionStorePort,
  providerInstanceId: string,
  identity: ProxyIdentityRequirements,
): Promise<void> {
  const record: ProxySessionRecord = {
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    identity,
    key: keyFactory.derive({
      context,
      identity,
      providerInstanceId,
      targetUrl,
    }).key,
    providerInstanceId,
    providerKind: 'test-provider',
  };

  await sessionStore.setMany([record]);
}

function provider(
  id: string,
  acquiredProviderIds: string[],
  overrides: {
    route?: ProxyRoute;
  } = {},
): ProxyProviderInstance {
  return {
    adapter: {
      acquire: async (input) => {
        acquiredProviderIds.push(input.providerInstanceId);

        return {
          id: `${id}-lease`,
          providerInstanceId: id,
          providerKind: 'test-provider',
          route: overrides.route ?? { kind: PROXY_ROUTE_KIND.DIRECT },
        };
      },
      getCapabilities: () => ({}),
      kind: 'test-provider',
    },
    id,
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

function forwardProxyRoute(host: string): ProxyRoute {
  return {
    host,
    kind: PROXY_ROUTE_KIND.FORWARD_PROXY,
    port: 8080,
    protocol: PROXY_PROTOCOL.HTTP,
  };
}

function proxyFetchJsonRequest(): Request {
  return new Request('https://gateway.test/proxy', {
    body: JSON.stringify({
      context,
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
