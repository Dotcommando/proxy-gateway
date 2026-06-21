import { describe, expect, it } from '@jest/globals';

import { SessionKeyFactory } from '../src/app/sessions';
import {
  PROXY_IDENTITY_ISOLATION_SCOPE,
  PROXY_IDENTITY_ROTATION,
} from '../src/constants';

const factory = new SessionKeyFactory();

describe('SessionKeyFactory', () => {
  it('derives a deterministic default-scope key from sticky id, isolation key, context, provider, and target host', () => {
    const input = {
      context: {
        flowKey: 'flow-a',
        routeKey: 'route-a',
        tenantId: 'tenant-a',
      },
      identity: {
        isolationKey: 'market:gb',
        rotation: PROXY_IDENTITY_ROTATION.STICKY,
        stickySessionId: 'session-a',
        stickySessionTtlMs: 60_000,
      },
      providerInstanceId: 'provider-a',
      targetUrl: 'https://API.Example.COM./v1/products?sku=1',
    };
    const first = factory.derive(input);
    const second = factory.derive(input);

    expect(first.key).toBe(second.key);
    expect(first.components).toEqual([
      { name: 'stickySessionId', value: 'session-a' },
      { name: 'isolationKey', value: 'market:gb' },
      { name: 'tenantId', value: 'tenant-a' },
      { name: 'flowKey', value: 'flow-a' },
      { name: 'routeKey', value: 'route-a' },
      { name: 'providerInstanceId', value: 'provider-a' },
      { name: 'targetHost', value: 'api.example.com' },
    ]);
  });

  it('uses explicit isolation scope and includes attempt index only when requested', () => {
    const scopedInput = {
      attemptIndex: 1,
      context: {
        tenantId: 'tenant-a',
      },
      identity: {
        isolationKey: 'operation-a',
        isolationScope: [
          PROXY_IDENTITY_ISOLATION_SCOPE.TENANT,
          PROXY_IDENTITY_ISOLATION_SCOPE.ATTEMPT,
        ],
        rotation: PROXY_IDENTITY_ROTATION.FIXED,
        stickySessionId: 'session-a',
      },
      providerInstanceId: 'provider-a',
      targetUrl: 'https://example.com/one',
    };
    const withoutAttemptScope = {
      ...scopedInput,
      identity: {
        ...scopedInput.identity,
        isolationScope: [PROXY_IDENTITY_ISOLATION_SCOPE.TENANT],
      },
    };

    expect(factory.derive(scopedInput).components).toEqual([
      { name: 'stickySessionId', value: 'session-a' },
      { name: 'isolationKey', value: 'operation-a' },
      { name: 'tenantId', value: 'tenant-a' },
      { name: 'attemptIndex', value: '1' },
    ]);
    expect(factory.derive(scopedInput).key).not.toBe(
      factory.derive({
        ...scopedInput,
        attemptIndex: 2,
      }).key,
    );
    expect(factory.derive(withoutAttemptScope).key).toBe(
      factory.derive({
        ...withoutAttemptScope,
        attemptIndex: 2,
      }).key,
    );
  });

  it('represents missing scope components explicitly so unrelated sessions do not collapse', () => {
    const missingTenant = factory.derive({
      context: {
        flowKey: 'flow-a',
      },
      identity: {
        stickySessionId: 'session-a',
      },
      providerInstanceId: 'provider-a',
      targetUrl: 'https://api.example.com/a',
    });
    const missingFlow = factory.derive({
      context: {
        tenantId: 'tenant-a',
      },
      identity: {
        stickySessionId: 'session-a',
      },
      providerInstanceId: 'provider-a',
      targetUrl: 'https://api.example.com/a',
    });

    expect(missingTenant.components).toEqual([
      { name: 'stickySessionId', value: 'session-a' },
      { name: 'isolationKey', value: null },
      { name: 'tenantId', value: null },
      { name: 'flowKey', value: 'flow-a' },
      { name: 'routeKey', value: null },
      { name: 'providerInstanceId', value: 'provider-a' },
      { name: 'targetHost', value: 'api.example.com' },
    ]);
    expect(missingFlow.components).toEqual([
      { name: 'stickySessionId', value: 'session-a' },
      { name: 'isolationKey', value: null },
      { name: 'tenantId', value: 'tenant-a' },
      { name: 'flowKey', value: null },
      { name: 'routeKey', value: null },
      { name: 'providerInstanceId', value: 'provider-a' },
      { name: 'targetHost', value: 'api.example.com' },
    ]);
    expect(missingTenant.key).not.toBe(missingFlow.key);
  });

  it('normalizes target host before it contributes to the key', () => {
    const baseInput = {
      context: {
        tenantId: 'tenant-a',
      },
      identity: {
        isolationScope: [PROXY_IDENTITY_ISOLATION_SCOPE.TARGET_HOST],
        stickySessionId: 'session-a',
      },
      targetUrl: 'https://API.Example.COM.:443/a',
    };
    const sameHost = factory.derive(baseInput);
    const normalizedHost = factory.derive({
      ...baseInput,
      targetUrl: 'https://api.example.com/b',
    });

    expect(sameHost.components).toEqual([
      { name: 'stickySessionId', value: 'session-a' },
      { name: 'isolationKey', value: null },
      { name: 'targetHost', value: 'api.example.com' },
    ]);
    expect(sameHost.key).toBe(normalizedHost.key);
  });
});
