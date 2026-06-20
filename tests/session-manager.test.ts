import { describe, expect, it } from '@jest/globals';

import { createMemoryProxySessionStore } from '../src/adapters/outbound';
import {
  SESSION_MANAGER_READ_RESULT_KIND,
  SessionKeyFactory,
  SessionManager,
} from '../src/app/sessions';
import {
  PROXY_IDENTITY_ISOLATION_SCOPE,
  PROXY_IDENTITY_ROTATION,
  PROXY_ROUTE_KIND,
} from '../src/constants';
import type {
  GatewayExecutionContext,
  ProxyIdentityRequirements,
  ProxyProviderInstance,
  ProxySessionRecord,
  ProxySessionStorePort,
} from '../src/ports/outbound';

const keyFactory = new SessionKeyFactory();
const targetUrl = 'https://api.example.com/products';
const context: GatewayExecutionContext = {
  flowKey: 'flow-a',
  routeKey: 'route-a',
  tenantId: 'tenant-a',
};
const baseIdentity: ProxyIdentityRequirements = {
  isolationKey: 'market:gb',
  rotation: PROXY_IDENTITY_ROTATION.STICKY,
  stickySessionId: 'session-a',
  stickySessionTtlMs: 60_000,
};
const now = new Date('2030-01-01T00:00:00.000Z');

describe('SessionManager', () => {
  it('reads an existing session by derived key and returns a provider pin for an enabled provider', async () => {
    const provider = providerInstance('provider-a');
    const store = createMemoryProxySessionStore();
    const record = createRecord({
      expiresAt: new Date('2030-01-01T00:01:00.000Z'),
      identity: baseIdentity,
      providerInstanceId: provider.id,
    });
    const manager = new SessionManager({
      keyFactory,
      store,
    });

    await store.setMany([record]);

    const result = await manager.read({
      context,
      identity: baseIdentity,
      now,
      providers: [provider],
      targetUrl,
    });

    expect(result).toEqual({
      key: record.key,
      kind: SESSION_MANAGER_READ_RESULT_KIND.HIT,
      providerInstanceId: 'provider-a',
      providerKind: 'test-provider',
      record,
    });
  });

  it('ignores expired records and deletes them when cleanup is requested', async () => {
    const provider = providerInstance('provider-a');
    const store = createMemoryProxySessionStore();
    const expiredRecord = createRecord({
      expiresAt: new Date('2029-12-31T23:59:59.000Z'),
      identity: baseIdentity,
      providerInstanceId: provider.id,
    });
    const manager = new SessionManager({
      keyFactory,
      store,
    });

    await store.setMany([expiredRecord]);

    const result = await manager.read({
      cleanupExpired: true,
      context,
      identity: baseIdentity,
      now,
      providers: [provider],
      targetUrl,
    });

    expect(result).toEqual({
      kind: SESSION_MANAGER_READ_RESULT_KIND.MISS,
    });
    expect(await store.getMany([expiredRecord.key])).toEqual([]);
  });

  it('ignores records for disabled or unknown providers without calling provider adapters', async () => {
    const calls: string[] = [];
    const disabledProvider = providerInstance('disabled-provider', {
      calls,
      enabled: false,
    });
    const enabledProvider = providerInstance('enabled-provider', {
      calls,
    });
    const store = createMemoryProxySessionStore();
    const disabledProviderRecord = createRecord({
      expiresAt: new Date('2030-01-01T00:01:00.000Z'),
      identity: baseIdentity,
      providerInstanceId: disabledProvider.id,
    });
    const unknownProviderIdentity: ProxyIdentityRequirements = {
      ...baseIdentity,
      isolationScope: [PROXY_IDENTITY_ISOLATION_SCOPE.TENANT],
    };
    const unknownProviderRecord = createRecord({
      expiresAt: new Date('2030-01-01T00:01:00.000Z'),
      identity: unknownProviderIdentity,
      providerInstanceId: 'unknown-provider',
    });
    const manager = new SessionManager({
      keyFactory,
      store,
    });

    await store.setMany([disabledProviderRecord, unknownProviderRecord]);

    const disabledResult = await manager.read({
      context,
      identity: baseIdentity,
      now,
      providers: [disabledProvider, enabledProvider],
      targetUrl,
    });
    const unknownResult = await manager.read({
      context,
      identity: unknownProviderIdentity,
      now,
      providers: [enabledProvider],
      targetUrl,
    });

    expect(disabledResult).toEqual({
      kind: SESSION_MANAGER_READ_RESULT_KIND.MISS,
    });
    expect(unknownResult).toEqual({
      kind: SESSION_MANAGER_READ_RESULT_KIND.MISS,
    });
    expect(calls).toEqual([]);
  });

  it('respects requestNewIdentity without reading the session store', async () => {
    const store = recordingStore();
    const manager = new SessionManager({
      keyFactory,
      store,
    });
    const result = await manager.read({
      context,
      identity: {
        ...baseIdentity,
        requestNewIdentity: true,
      },
      now,
      providers: [providerInstance('provider-a')],
      targetUrl,
    });

    expect(result).toEqual({
      kind: SESSION_MANAGER_READ_RESULT_KIND.REQUEST_NEW_IDENTITY,
    });
    expect(store.calls).toEqual([]);
  });
});

function createRecord(input: {
  expiresAt: Date;
  identity: ProxyIdentityRequirements;
  providerInstanceId: string;
}): ProxySessionRecord {
  return {
    expiresAt: input.expiresAt,
    identity: input.identity,
    key: keyFactory.derive({
      context,
      identity: input.identity,
      providerInstanceId: input.providerInstanceId,
      targetUrl,
    }).key,
    metadata: {
      source: 'test',
    },
    providerInstanceId: input.providerInstanceId,
    providerKind: 'test-provider',
  };
}

function providerInstance(
  id: string,
  options: {
    calls?: string[];
    enabled?: boolean;
  } = {},
): ProxyProviderInstance {
  return {
    adapter: {
      acquire: async () => {
        options.calls?.push(`acquire:${id}`);

        return {
          id: `${id}-lease`,
          providerInstanceId: id,
          providerKind: 'test-provider',
          route: { kind: PROXY_ROUTE_KIND.DIRECT },
        };
      },
      getCapabilities: () => {
        options.calls?.push(`capabilities:${id}`);

        return {};
      },
      kind: 'test-provider',
    },
    id,
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
  };
}

function recordingStore(): ProxySessionStorePort & { calls: string[] } {
  const calls: string[] = [];

  return {
    calls,
    deleteMany: async (keys) => {
      calls.push(`delete:${keys.join(',')}`);
    },
    getMany: async (keys) => {
      calls.push(`get:${keys.join(',')}`);

      return [];
    },
    setMany: async (records) => {
      calls.push(`set:${records.map((record) => record.key).join(',')}`);
    },
    touchMany: async (touches) => {
      calls.push(`touch:${touches.map((touch) => touch.key).join(',')}`);
    },
  };
}
