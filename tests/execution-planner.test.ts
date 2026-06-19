import { describe, expect, it } from '@jest/globals';

import { ExecutionPlanner } from '../src/app/planning';
import {
  PLANNER_RESULT_KIND,
  PROXY_DNS_MODE,
  PROXY_NETWORK_TYPE,
  PROXY_PLAN_KIND,
  PROXY_PROTOCOL,
  PROXY_ROUTE_KIND,
  RESPONSE_CODE,
} from '../src/constants';
import type { ProxyProviderCapabilities, ProxyProviderInstance } from '../src/ports/outbound';

describe('ExecutionPlanner', () => {
  it('uses package enums for planner result kinds, plan kinds, protocols, DNS, and network types', () => {
    expect(PLANNER_RESULT_KIND.PLANNED).toBe('planned');
    expect(PLANNER_RESULT_KIND.REJECTED).toBe('rejected');
    expect(PROXY_PLAN_KIND.FALLBACK).toBe('fallback');
    expect(PROXY_PROTOCOL.SOCKS5H).toBe('socks5h');
    expect(PROXY_DNS_MODE.PROXY).toBe('proxy');
    expect(PROXY_NETWORK_TYPE.TOR).toBe('tor');
    expect(RESPONSE_CODE.NO_PLANNABLE_PROVIDER).toBe('NO_PLANNABLE_PROVIDER');
  });

  it('turns fallback attempt config into ordered execution attempts', async () => {
    const planner = new ExecutionPlanner({
      providers: [
        provider('provider-a', {
          protocols: [PROXY_PROTOCOL.HTTP],
        }),
        provider('provider-b', {
          protocols: [PROXY_PROTOCOL.HTTP],
        }),
      ],
    });
    const result = await planner.plan({
      plan: {
        attempts: [
          {
            provider: 'provider-a',
            timeoutMs: 1000,
          },
          {
            provider: 'provider-b',
            maxAttempts: 2,
          },
        ],
        kind: PROXY_PLAN_KIND.FALLBACK,
        totalTimeoutMs: 3000,
      },
    });

    expect(result.kind).toBe(PLANNER_RESULT_KIND.PLANNED);

    if (result.kind === PLANNER_RESULT_KIND.PLANNED) {
      expect(result.plan).toMatchObject({
        attempts: [
          {
            providerInstanceId: 'provider-a',
            providerKind: 'test-provider',
            timeoutMs: 1000,
          },
          {
            maxAttempts: 2,
            providerInstanceId: 'provider-b',
            providerKind: 'test-provider',
          },
        ],
        kind: PROXY_PLAN_KIND.FALLBACK,
        totalTimeoutMs: 3000,
      });
    }
  });

  it('rejects capability mismatches before acquire is called', async () => {
    let acquireCalls = 0;
    const planner = new ExecutionPlanner({
      providers: [
        provider(
          'http-only',
          {
            protocols: [PROXY_PROTOCOL.HTTP],
          },
          {
            acquire: async () => {
              acquireCalls += 1;

              throw new Error('planner must not acquire');
            },
          },
        ),
      ],
    });
    const result = await planner.plan({
      plan: {
        attempts: [
          {
            provider: 'http-only',
            requirements: {
              protocols: [PROXY_PROTOCOL.SOCKS5H],
            },
          },
        ],
        kind: PROXY_PLAN_KIND.FALLBACK,
      },
    });

    expect(result).toEqual({
      code: RESPONSE_CODE.NO_PLANNABLE_PROVIDER,
      kind: PLANNER_RESULT_KIND.REJECTED,
      message: 'No provider can satisfy the plan attempt requirements.',
    });
    expect(acquireCalls).toBe(0);
  });

  it('checks protocol, network type, and DNS requirements without downgrading socks5h proxy DNS', async () => {
    const requirements = {
      dns: {
        forbidLocalDnsLeak: true,
        resolution: PROXY_DNS_MODE.PROXY,
      },
      networkTypes: [PROXY_NETWORK_TYPE.TOR],
      protocols: [PROXY_PROTOCOL.SOCKS5H],
    };
    const planner = new ExecutionPlanner({
      providers: [
        provider('tor-provider', {
          dns: {
            modes: [PROXY_DNS_MODE.PROXY],
            remoteRequired: true,
          },
          networkTypes: [PROXY_NETWORK_TYPE.TOR],
          protocols: [PROXY_PROTOCOL.SOCKS5H],
        }),
      ],
    });
    const result = await planner.plan({
      plan: {
        attempts: [
          {
            provider: 'tor-provider',
            requirements,
          },
        ],
        kind: PROXY_PLAN_KIND.FALLBACK,
      },
    });

    expect(result.kind).toBe(PLANNER_RESULT_KIND.PLANNED);

    if (result.kind === PLANNER_RESULT_KIND.PLANNED) {
      expect(result.plan.attempts[0]?.requirements).toEqual(requirements);
      expect(result.plan.attempts[0]?.capabilities).toMatchObject({
        dns: {
          modes: [PROXY_DNS_MODE.PROXY],
          remoteRequired: true,
        },
        networkTypes: [PROXY_NETWORK_TYPE.TOR],
        protocols: [PROXY_PROTOCOL.SOCKS5H],
      });
    }
  });

  it('rejects unknown explicit provider instance ids with a stable code', async () => {
    const planner = new ExecutionPlanner({
      providers: [provider('available-provider')],
    });
    const result = await planner.plan({
      plan: {
        attempts: [
          {
            provider: 'missing-provider',
          },
        ],
        kind: PROXY_PLAN_KIND.FALLBACK,
      },
    });

    expect(result).toEqual({
      code: RESPONSE_CODE.PROVIDER_INSTANCE_NOT_FOUND,
      kind: PLANNER_RESULT_KIND.REJECTED,
      message: 'Provider instance "missing-provider" was not found or is disabled.',
    });
  });

  it('skips disabled providers for implicit selection but rejects explicit disabled providers', async () => {
    const planner = new ExecutionPlanner({
      providers: [
        provider('disabled-provider', {}, { enabled: false }),
        provider('enabled-provider', {
          protocols: [PROXY_PROTOCOL.HTTP],
        }),
      ],
    });
    const implicitResult = await planner.plan({
      plan: {
        attempts: [
          {
            requirements: {
              protocols: [PROXY_PROTOCOL.HTTP],
            },
          },
        ],
        kind: PROXY_PLAN_KIND.FALLBACK,
      },
    });
    const explicitResult = await planner.plan({
      plan: {
        attempts: [
          {
            provider: 'disabled-provider',
          },
        ],
        kind: PROXY_PLAN_KIND.FALLBACK,
      },
    });

    expect(implicitResult.kind).toBe(PLANNER_RESULT_KIND.PLANNED);

    if (implicitResult.kind === PLANNER_RESULT_KIND.PLANNED) {
      expect(implicitResult.plan.attempts[0]?.providerInstanceId).toBe('enabled-provider');
    }
    expect(explicitResult).toEqual({
      code: RESPONSE_CODE.PROVIDER_INSTANCE_NOT_FOUND,
      kind: PLANNER_RESULT_KIND.REJECTED,
      message: 'Provider instance "disabled-provider" was not found or is disabled.',
    });
  });

  it('reads provider capabilities during planning but does not acquire leases', async () => {
    let capabilitiesCalls = 0;
    let acquireCalls = 0;
    const planner = new ExecutionPlanner({
      providers: [
        provider(
          'provider-a',
          {
            protocols: [PROXY_PROTOCOL.HTTP],
          },
          {
            acquire: async () => {
              acquireCalls += 1;

              throw new Error('planner must not acquire');
            },
            getCapabilities: () => {
              capabilitiesCalls += 1;

              return {
                protocols: [PROXY_PROTOCOL.HTTP],
              };
            },
          },
        ),
      ],
    });
    const result = await planner.plan({
      plan: {
        attempts: [
          {
            provider: 'provider-a',
            requirements: {
              protocols: [PROXY_PROTOCOL.HTTP],
            },
          },
        ],
        kind: PROXY_PLAN_KIND.FALLBACK,
      },
    });

    expect(result.kind).toBe(PLANNER_RESULT_KIND.PLANNED);
    expect(capabilitiesCalls).toBe(1);
    expect(acquireCalls).toBe(0);
  });

  it('can express the temporary direct provider selection hook as planner-owned provider choice', async () => {
    const planner = new ExecutionPlanner({
      providers: [provider('static-primary'), provider('static-secondary')],
    });
    const result = await planner.plan({
      plan: {
        attempts: [
          {
            provider: 'static-secondary',
          },
        ],
        kind: PROXY_PLAN_KIND.FALLBACK,
      },
    });

    expect(result.kind).toBe(PLANNER_RESULT_KIND.PLANNED);

    if (result.kind === PLANNER_RESULT_KIND.PLANNED) {
      expect(result.plan.attempts).toHaveLength(1);
      expect(result.plan.attempts[0]?.providerInstanceId).toBe('static-secondary');
    }
  });
});

function provider(
  id: string,
  capabilities: ProxyProviderCapabilities = {},
  overrides: {
    acquire?: ProxyProviderInstance['adapter']['acquire'];
    enabled?: boolean;
    getCapabilities?: ProxyProviderInstance['adapter']['getCapabilities'];
  } = {},
): ProxyProviderInstance {
  return {
    id,
    adapter: {
      kind: 'test-provider',
      acquire:
        overrides.acquire
        ?? (async () => ({
          id: `${id}-lease`,
          providerInstanceId: id,
          providerKind: 'test-provider',
          route: { kind: PROXY_ROUTE_KIND.DIRECT },
        })),
      getCapabilities: overrides.getCapabilities ?? (() => capabilities),
    },
    ...(overrides.enabled === undefined ? {} : { enabled: overrides.enabled }),
  };
}
