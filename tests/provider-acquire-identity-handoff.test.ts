import { describe, expect, it } from '@jest/globals';

import {
  createMemoryProxySessionStore,
  createProxyGateway,
  type GatewayTargetResponse,
  PROXY_IDENTITY_ISOLATION_SCOPE,
  PROXY_IDENTITY_ROTATION,
  PROXY_PLAN_KIND,
  PROXY_ROUTE_KIND,
  type ProxyAcquireInput,
  type ProxyIdentityRequirements,
  type ProxyProviderInstance,
  type ProxySessionRecord,
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
  isolationScope: [
    PROXY_IDENTITY_ISOLATION_SCOPE.TENANT,
    PROXY_IDENTITY_ISOLATION_SCOPE.FLOW,
    PROXY_IDENTITY_ISOLATION_SCOPE.ROUTE,
    PROXY_IDENTITY_ISOLATION_SCOPE.PROVIDER,
    PROXY_IDENTITY_ISOLATION_SCOPE.TARGET_HOST,
  ],
  rotation: PROXY_IDENTITY_ROTATION.STICKY,
  stickySessionId: 'session-a',
  stickySessionTtlMs: 60_000,
};
const fixedIdentity: ProxyIdentityRequirements = {
  isolationKey: 'fixed:identity',
  isolationScope: [
    PROXY_IDENTITY_ISOLATION_SCOPE.TENANT,
    PROXY_IDENTITY_ISOLATION_SCOPE.ATTEMPT,
  ],
  rotation: PROXY_IDENTITY_ROTATION.FIXED,
};
const perRequestIdentity: ProxyIdentityRequirements = {
  isolationKey: 'per-request:identity',
  requestNewIdentity: true,
  rotation: PROXY_IDENTITY_ROTATION.PER_REQUEST,
};

describe('provider acquire identity handoff', () => {
  it('preserves identity requirements through session pinning and fallback acquire calls', async () => {
    const acquired: ProxyAcquireInput[] = [];
    const sessionStore = createMemoryProxySessionStore();

    await sessionStore.setMany([
      sessionRecord('provider-b', stickyIdentity),
    ]);

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
            requirements: {
              identity: fixedIdentity,
            },
            retryOn: [RETRY_CONDITION.TARGET_NETWORK_ERROR],
          },
          {
            provider: 'provider-d',
            requirements: {
              identity: perRequestIdentity,
            },
          },
        ],
        kind: PROXY_PLAN_KIND.FALLBACK,
      },
      providers: [
        provider('provider-a', acquired),
        provider('provider-b', acquired),
        provider('provider-c', acquired),
        provider('provider-d', acquired),
      ],
      sessionStore,
      transport: flakyTwiceTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(acquired.map((input) => input.providerInstanceId)).toEqual([
      'provider-b',
      'provider-c',
      'provider-d',
    ]);
    expect(acquired.map((input) => input.requirements.identity)).toEqual([
      stickyIdentity,
      fixedIdentity,
      perRequestIdentity,
    ]);
  });
});

function sessionRecord(
  providerInstanceId: string,
  identity: ProxyIdentityRequirements,
): ProxySessionRecord {
  return {
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

function flakyTwiceTransport(): TargetTransportPort {
  let calls = 0;

  return {
    execute: async () => {
      calls += 1;

      if (calls < 3) {
        throw new Error('target failed');
      }

      return okTargetResponse();
    },
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
