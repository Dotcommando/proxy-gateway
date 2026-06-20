import { describe, expect, it } from '@jest/globals';

import {
  createMemoryProxySessionStore,
  PROXY_IDENTITY_ISOLATION_SCOPE,
  PROXY_IDENTITY_ROTATION,
  type ProxyIdentityRequirements,
  type ProxySessionRecord,
  type ProxySessionStorePort,
} from '../src';

describe('ProxySessionStorePort', () => {
  it('supports batch set, get, touch, and delete operations', async () => {
    const store: ProxySessionStorePort = createMemoryProxySessionStore();
    const first = createRecord('session-a', 'provider-a');
    const second = createRecord('session-b', 'provider-b');
    const touchedExpiration = new Date('2030-02-01T00:00:00.000Z');

    await store.setMany([first, second]);

    expect(await store.getMany([first.key, second.key])).toEqual([first, second]);

    await store.touchMany([
      {
        expiresAt: touchedExpiration,
        key: first.key,
      },
    ]);

    expect(await store.getMany([first.key, second.key])).toEqual([
      {
        ...first,
        expiresAt: touchedExpiration,
      },
      second,
    ]);

    await store.deleteMany([first.key, 'missing-session']);

    expect(await store.getMany([first.key, second.key])).toEqual([second]);
  });

  it('exposes session record fields for provider pinning, expiration, identity snapshot, and metadata', () => {
    const identity: ProxyIdentityRequirements = {
      isolationKey: 'market:gb',
      isolationScope: [
        PROXY_IDENTITY_ISOLATION_SCOPE.TENANT,
        PROXY_IDENTITY_ISOLATION_SCOPE.ROUTE,
      ],
      rotation: PROXY_IDENTITY_ROTATION.STICKY,
      stickySessionId: 'session-a',
      stickySessionTtlMs: 60_000,
    };
    const record: ProxySessionRecord = {
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      identity,
      key: 'tenant-a:route-a',
      metadata: {
        source: 'test',
      },
      providerInstanceId: 'provider-a',
      providerKind: 'test-provider',
    };
    const expiresAt: Date = record.expiresAt;

    expect(record).toEqual({
      expiresAt,
      identity,
      key: 'tenant-a:route-a',
      metadata: {
        source: 'test',
      },
      providerInstanceId: 'provider-a',
      providerKind: 'test-provider',
    });
  });
});

function createRecord(key: string, providerInstanceId: string): ProxySessionRecord {
  return {
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    identity: {
      rotation: PROXY_IDENTITY_ROTATION.STICKY,
      stickySessionId: key,
    },
    key,
    metadata: {
      providerInstanceId,
    },
    providerInstanceId,
    providerKind: 'test-provider',
  };
}
