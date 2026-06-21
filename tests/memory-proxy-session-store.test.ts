import { describe, expect, it } from '@jest/globals';

import {
  createMemoryProxySessionStore,
  PROXY_IDENTITY_ISOLATION_SCOPE,
  PROXY_IDENTITY_ROTATION,
  type ProxySessionRecord,
} from '../src';

describe('createMemoryProxySessionStore', () => {
  it('overwrites records with the same session key without affecting other sessions', async () => {
    const store = createMemoryProxySessionStore();
    const original = createRecord('session-a', 'provider-a');
    const replacement = {
      ...createRecord('session-a', 'provider-c'),
      metadata: {
        source: 'replacement',
      },
    };
    const other = createRecord('session-b', 'provider-b');

    await store.setMany([original, other]);
    await store.setMany([replacement]);

    expect(await store.getMany(['session-a', 'session-b'])).toEqual([replacement, other]);
  });

  it('handles partial touch and delete batches without creating missing records', async () => {
    const store = createMemoryProxySessionStore();
    const first = createRecord('session-a', 'provider-a');
    const second = createRecord('session-b', 'provider-b');
    const touchedExpiration = new Date('2030-03-01T00:00:00.000Z');

    await store.setMany([first, second]);
    await store.touchMany([
      {
        expiresAt: touchedExpiration,
        key: first.key,
      },
      {
        expiresAt: new Date('2030-04-01T00:00:00.000Z'),
        key: 'missing-session',
      },
    ]);

    expect(await store.getMany([first.key, second.key, 'missing-session'])).toEqual([
      {
        ...first,
        expiresAt: touchedExpiration,
      },
      second,
    ]);

    await store.deleteMany([second.key, 'missing-session']);

    expect(await store.getMany([first.key, second.key, 'missing-session'])).toEqual([
      {
        ...first,
        expiresAt: touchedExpiration,
      },
    ]);
  });

  it('stores expiration timestamps without interpreting expired records', async () => {
    const store = createMemoryProxySessionStore();
    const expiredRecord = {
      ...createRecord('expired-session', 'provider-a'),
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
    };

    await store.setMany([expiredRecord]);

    expect(await store.getMany([expiredRecord.key])).toEqual([expiredRecord]);
  });

  it('does not leak stored records through caller-owned or returned object references', async () => {
    const store = createMemoryProxySessionStore();
    const isolationScope = [PROXY_IDENTITY_ISOLATION_SCOPE.TENANT];
    const metadata = {
      source: 'original',
    };
    const record: ProxySessionRecord = {
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      identity: {
        isolationScope,
        rotation: PROXY_IDENTITY_ROTATION.STICKY,
        stickySessionId: 'session-a',
      },
      key: 'session-a',
      metadata,
      providerInstanceId: 'provider-a',
      providerKind: 'test-provider',
    };

    await store.setMany([record]);

    record.providerInstanceId = 'mutated-provider';
    isolationScope.push(PROXY_IDENTITY_ISOLATION_SCOPE.ROUTE);
    metadata.source = 'mutated-metadata';

    const [fetched] = await store.getMany([record.key]);

    if (fetched === undefined) {
      throw new Error('Expected stored record to be returned.');
    }

    fetched.providerInstanceId = 'mutated-returned-provider';
    fetched.metadata = {
      source: 'mutated-returned-metadata',
    };

    expect(await store.getMany([record.key])).toEqual([
      {
        expiresAt: new Date('2030-01-01T00:00:00.000Z'),
        identity: {
          isolationScope: [PROXY_IDENTITY_ISOLATION_SCOPE.TENANT],
          rotation: PROXY_IDENTITY_ROTATION.STICKY,
          stickySessionId: 'session-a',
        },
        key: 'session-a',
        metadata: {
          source: 'original',
        },
        providerInstanceId: 'provider-a',
        providerKind: 'test-provider',
      },
    ]);
  });
});

function createRecord(key: string, providerInstanceId: string): ProxySessionRecord {
  return {
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    identity: {
      isolationKey: 'market:gb',
      isolationScope: [PROXY_IDENTITY_ISOLATION_SCOPE.TENANT],
      rotation: PROXY_IDENTITY_ROTATION.STICKY,
      stickySessionId: key,
      stickySessionTtlMs: 60_000,
    },
    key,
    metadata: {
      providerInstanceId,
    },
    providerInstanceId,
    providerKind: 'test-provider',
  };
}
