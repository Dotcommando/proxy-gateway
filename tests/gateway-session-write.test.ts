import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  createMemoryProxySessionStore,
  createProxyGateway,
  type GatewayTargetResponse,
  PROXY_ATTEMPT_RESULT_OUTCOME,
  PROXY_IDENTITY_ROTATION,
  PROXY_PLAN_KIND,
  PROXY_ROUTE_KIND,
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

describe('gateway session write path', () => {
  it('writes a session record with provider id and expiration after a successful attempt', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2030-01-01T00:00:00.000Z'));

    const sessionStore = createMemoryProxySessionStore();
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
      providers: [provider('provider-a')],
      sessionStore,
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest());
    const recordKey = sessionKey('provider-a', stickyIdentity);

    expect((await response.json()).ok).toBe(true);
    expect(await sessionStore.getMany([recordKey])).toEqual([
      {
        expiresAt: new Date('2030-01-01T00:01:00.000Z'),
        identity: stickyIdentity,
        key: recordKey,
        providerInstanceId: 'provider-a',
        providerKind: 'test-provider',
      },
    ]);
  });

  it('does not overwrite an existing session after a failed attempt', async () => {
    const sessionStore = createMemoryProxySessionStore();
    const existingRecord = createRecord('provider-a', stickyIdentity, {
      expiresAt: new Date('2030-01-01T00:10:00.000Z'),
      providerInstanceId: 'provider-a',
    });

    await sessionStore.setMany([existingRecord]);

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
      providers: [provider('provider-a')],
      sessionStore,
      transport: {
        execute: async () => {
          throw new Error('target failed');
        },
      },
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect(response.status).toBe(502);
    expect(await sessionStore.getMany([existingRecord.key])).toEqual([existingRecord]);
  });

  it('updates the sticky provider to the fallback provider after fallback success', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2030-01-01T00:00:00.000Z'));

    const acquiredProviderIds: string[] = [];
    const sessionStore = createMemoryProxySessionStore();
    const oldProviderKey = sessionKey('provider-a', stickyIdentity);
    const fallbackProviderKey = sessionKey('provider-b', stickyIdentity);

    await sessionStore.setMany([
      createRecord('provider-a', stickyIdentity, {
        expiresAt: new Date('2030-01-01T00:10:00.000Z'),
        providerInstanceId: 'provider-a',
      }),
    ]);

    const gateway = createProxyGateway({
      plan: {
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
        kind: PROXY_PLAN_KIND.FALLBACK,
      },
      providers: [
        provider('provider-a', acquiredProviderIds),
        provider('provider-b', acquiredProviderIds),
      ],
      sessionStore,
      transport: {
        execute: async () => {
          if (acquiredProviderIds.length === 1) {
            throw new Error('provider-a failed');
          }

          return okTargetResponse();
        },
      },
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(acquiredProviderIds).toEqual(['provider-a', 'provider-b']);
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

  it('keeps a successful target response when session writes fail', async () => {
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
      providers: [provider('provider-a')],
      sessionStore: throwingSessionStore(),
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      response: {
        body: {
          kind: 'text',
          text: 'ok',
        },
        headers: [],
        status: 200,
        statusText: 'OK',
        url: targetUrl,
      },
      version: WIRE_PROTOCOL_VERSION,
    });
  });
});

function createRecord(
  keyProviderInstanceId: string,
  identity: ProxyIdentityRequirements,
  overrides: {
    expiresAt: Date;
    providerInstanceId: string;
  },
): ProxySessionRecord {
  const key = sessionKey(keyProviderInstanceId, identity);

  return {
    expiresAt: overrides.expiresAt,
    identity,
    key,
    providerInstanceId: overrides.providerInstanceId,
    providerKind: 'test-provider',
  };
}

function sessionKey(providerInstanceId: string, identity: ProxyIdentityRequirements): string {
  return keyFactory.derive({
    context,
    identity,
    providerInstanceId,
    targetUrl,
  }).key;
}

function provider(id: string, acquiredProviderIds: string[] = []): ProxyProviderInstance {
  return {
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
      getCapabilities: () => ({}),
      kind: 'test-provider',
      release: async (_lease, result) => {
        if (result.outcome !== PROXY_ATTEMPT_RESULT_OUTCOME.SUCCESS) {
          return;
        }
      },
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
    headers: [],
    status: 200,
    statusText: 'OK',
    url: targetUrl,
  };
}

function throwingSessionStore(): ProxySessionStorePort {
  return {
    deleteMany: async () => {
      throw new Error('delete failed');
    },
    getMany: async () => [],
    setMany: async () => {
      throw new Error('set failed');
    },
    touchMany: async () => {
      throw new Error('touch failed');
    },
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
