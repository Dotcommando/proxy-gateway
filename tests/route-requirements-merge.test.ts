import { describe, expect, it } from '@jest/globals';

import {
  mergeProxyRouteRequirements,
  mergeRouteRequirementsIntoPlan,
  type ProxyPlanConfig,
} from '../src/app/planning';
import {
  PROXY_DNS_MODE,
  PROXY_GEO_STRICTNESS,
  PROXY_IDENTITY_ISOLATION_SCOPE,
  PROXY_IDENTITY_ROTATION,
  PROXY_NETWORK_TYPE,
  PROXY_PLAN_KIND,
  PROXY_PROTOCOL,
} from '../src/constants';
import type { ProxyRouteRequirements } from '../src/ports/outbound';

describe('route requirements merge', () => {
  it('merges route defaults with attempt requirements by field', () => {
    const routeRequirements: ProxyRouteRequirements = {
      dns: {
        forbidLocalDnsLeak: true,
        resolution: PROXY_DNS_MODE.PROXY,
      },
      geo: {
        country: 'DE',
        strictness: PROXY_GEO_STRICTNESS.REQUIRED,
      },
      identity: {
        isolationScope: [
          PROXY_IDENTITY_ISOLATION_SCOPE.TENANT,
          PROXY_IDENTITY_ISOLATION_SCOPE.ROUTE,
        ],
        rotation: PROXY_IDENTITY_ROTATION.STICKY,
        stickySessionTtlMs: 60_000,
      },
      verification: {
        cacheTtlMs: 30_000,
        rejectOnGeoMismatch: true,
        verifyExit: true,
      },
    };
    const attemptRequirements: ProxyRouteRequirements = {
      dns: {
        resolution: PROXY_DNS_MODE.ANY,
      },
      geo: {
        city: 'Berlin',
      },
      identity: {
        requestNewIdentity: true,
        stickySessionId: 'attempt-session',
      },
      verification: {
        maxVerificationAttempts: 2,
        rejectOnGeoMismatch: false,
      },
    };

    expect(mergeProxyRouteRequirements(routeRequirements, attemptRequirements)).toEqual({
      dns: {
        forbidLocalDnsLeak: true,
        resolution: PROXY_DNS_MODE.ANY,
      },
      geo: {
        city: 'Berlin',
        country: 'DE',
        strictness: PROXY_GEO_STRICTNESS.REQUIRED,
      },
      identity: {
        isolationScope: [
          PROXY_IDENTITY_ISOLATION_SCOPE.TENANT,
          PROXY_IDENTITY_ISOLATION_SCOPE.ROUTE,
        ],
        requestNewIdentity: true,
        rotation: PROXY_IDENTITY_ROTATION.STICKY,
        stickySessionId: 'attempt-session',
        stickySessionTtlMs: 60_000,
      },
      verification: {
        cacheTtlMs: 30_000,
        maxVerificationAttempts: 2,
        rejectOnGeoMismatch: false,
        verifyExit: true,
      },
    });
  });

  it('replaces array fields from attempt requirements instead of concatenating them', () => {
    const routeRequirements: ProxyRouteRequirements = {
      excludeProviderInstanceIds: ['route-excluded'],
      identity: {
        isolationScope: [
          PROXY_IDENTITY_ISOLATION_SCOPE.TENANT,
          PROXY_IDENTITY_ISOLATION_SCOPE.ROUTE,
        ],
      },
      networkTypes: [PROXY_NETWORK_TYPE.TOR],
      protocols: [PROXY_PROTOCOL.SOCKS5H],
      providerInstanceIds: ['route-provider-a', 'route-provider-b'],
    };
    const attemptRequirements: ProxyRouteRequirements = {
      excludeProviderInstanceIds: ['attempt-excluded'],
      identity: {
        isolationScope: [PROXY_IDENTITY_ISOLATION_SCOPE.FLOW],
      },
      networkTypes: [PROXY_NETWORK_TYPE.RESIDENTIAL],
      protocols: [PROXY_PROTOCOL.HTTP],
      providerInstanceIds: ['attempt-provider'],
    };

    expect(mergeProxyRouteRequirements(routeRequirements, attemptRequirements)).toEqual({
      excludeProviderInstanceIds: ['attempt-excluded'],
      identity: {
        isolationScope: [PROXY_IDENTITY_ISOLATION_SCOPE.FLOW],
      },
      networkTypes: [PROXY_NETWORK_TYPE.RESIDENTIAL],
      protocols: [PROXY_PROTOCOL.HTTP],
      providerInstanceIds: ['attempt-provider'],
    });
  });

  it('lets attempt custom requirement fields override route custom fields shallowly', () => {
    const routeRequirements: ProxyRouteRequirements = {
      customPolicy: {
        source: 'route',
      },
      tenantPolicy: 'route-default',
    };
    const attemptRequirements: ProxyRouteRequirements = {
      customPolicy: {
        source: 'attempt',
      },
    };

    expect(mergeProxyRouteRequirements(routeRequirements, attemptRequirements)).toEqual({
      customPolicy: {
        source: 'attempt',
      },
      tenantPolicy: 'route-default',
    });
  });

  it('applies merged route requirements to every plan attempt without mutating the original plan', () => {
    const routeRequirements: ProxyRouteRequirements = {
      protocols: [PROXY_PROTOCOL.SOCKS5H],
      providerInstanceIds: ['route-provider'],
    };
    const plan: ProxyPlanConfig = {
      attempts: [
        {},
        {
          requirements: {
            protocols: [PROXY_PROTOCOL.HTTP],
          },
        },
      ],
      kind: PROXY_PLAN_KIND.FALLBACK,
    };
    const merged = mergeRouteRequirementsIntoPlan(plan, routeRequirements);

    expect(merged).toEqual({
      attempts: [
        {
          requirements: {
            protocols: [PROXY_PROTOCOL.SOCKS5H],
            providerInstanceIds: ['route-provider'],
          },
        },
        {
          requirements: {
            protocols: [PROXY_PROTOCOL.HTTP],
            providerInstanceIds: ['route-provider'],
          },
        },
      ],
      kind: PROXY_PLAN_KIND.FALLBACK,
    });
    expect(plan.attempts[0]?.requirements).toBeUndefined();
    expect(plan.attempts[1]?.requirements).toEqual({
      protocols: [PROXY_PROTOCOL.HTTP],
    });
  });
});
