import { describe, expect, it } from '@jest/globals';

import {
  createProxyGateway,
  type GatewayTargetResponse,
  PIPELINE_DECISION_KIND,
  PIPELINE_STEP_TYPE,
  PLANNER_RESULT_KIND,
  PROXY_PLAN_KIND,
  PROXY_PROTOCOL,
  PROXY_ROUTE_KIND,
  type ProxyAcquireInput,
  type ProxyDecisionState,
  type ProxyExecutionPlan,
  type ProxyGatewayServices,
  type ProxyPipelineStepResult,
  type ProxyProviderCandidate,
  type ProxyProviderCapabilities,
  type ProxyProviderInstance,
  RESPONSE_CODE,
  RETRY_CONDITION,
  type TargetTransportPort,
  WIRE_PROTOCOL_VERSION,
} from '../src';
import { createBuiltInPipelineStepRegistry } from '../src/app/pipeline';
import { ExecutionPlanner } from '../src/app/planning';

describe('built-in plan pipeline steps', () => {
  it('uses a package enum value for the fallback plan step name', () => {
    expect(PIPELINE_STEP_TYPE.PLAN_FALLBACK).toBe('plan.fallback');
  });

  it('uses current candidates as the default provider order', async () => {
    const plannedConfigs: Array<{
      candidates: ProxyProviderCandidate[];
      plan: unknown;
    }> = [];
    const plannedPlan = executionPlan('provider-b');
    const result = await executeBuiltIn(
      {},
      {
        candidates: [
          candidate('provider-b'),
          candidate('provider-a'),
        ],
      },
      {
        planner: {
          plan: async (input: {
            candidates: ProxyProviderCandidate[];
            plan: unknown;
          }) => {
            plannedConfigs.push(input);

            return {
              kind: PLANNER_RESULT_KIND.PLANNED,
              plan: plannedPlan,
            };
          },
        },
      },
    );

    expect(result.decision).toEqual({
      kind: PIPELINE_DECISION_KIND.USE_PLAN,
      plan: plannedPlan,
    });
    expect(plannedConfigs).toEqual([
      {
        candidates: [
          candidate('provider-b'),
          candidate('provider-a'),
        ],
        plan: {
          attempts: [
            {
              requirements: {
                providerInstanceIds: ['provider-b', 'provider-a'],
              },
            },
          ],
          kind: PROXY_PLAN_KIND.FALLBACK,
        },
      },
    ]);
  });

  it('parses explicit attempts with provider, retry, timeout, requirements, and verification args', async () => {
    const plannedConfigs: unknown[] = [];
    const plannedPlan = executionPlan('provider-a');
    const result = await executeBuiltIn(
      {
        attempts: [
          {
            maxAttempts: 2,
            provider: 'provider-a',
            requirements: {
              protocols: [PROXY_PROTOCOL.HTTP],
            },
            retryOn: [RETRY_CONDITION.TARGET_NETWORK_ERROR],
            timeoutMs: 1500,
            verification: {
              verifyExit: true,
            },
          },
        ],
        stopOnTargetHttpError: true,
        totalTimeoutMs: 3000,
      },
      {},
      {
        planner: {
          plan: async (input: unknown) => {
            plannedConfigs.push(input);

            return {
              kind: PLANNER_RESULT_KIND.PLANNED,
              plan: plannedPlan,
            };
          },
        },
      },
    );

    expect(result.decision).toEqual({
      kind: PIPELINE_DECISION_KIND.USE_PLAN,
      plan: plannedPlan,
    });
    expect(plannedConfigs).toEqual([
      {
        candidates: [],
        plan: {
          attempts: [
            {
              maxAttempts: 2,
              provider: 'provider-a',
              requirements: {
                protocols: [PROXY_PROTOCOL.HTTP],
                verification: {
                  verifyExit: true,
                },
              },
              retryOn: [RETRY_CONDITION.TARGET_NETWORK_ERROR],
              timeoutMs: 1500,
            },
          ],
          kind: PROXY_PLAN_KIND.FALLBACK,
          stopOnTargetHttpError: true,
          totalTimeoutMs: 3000,
        },
      },
    ]);
  });

  it('returns a stable reject decision for malformed attempts', async () => {
    const result = await executeBuiltIn(
      {
        attempts: 'provider-a',
      },
      {},
      {
        planner: plannerService([]),
      },
    );

    expect(result.decision).toEqual({
      code: RESPONSE_CODE.PIPELINE_STEP_INVALID_ARGS,
      kind: PIPELINE_DECISION_KIND.REJECT,
      message: 'Invalid plan.fallback args: attempts must be an array of objects.',
      status: 400,
    });
  });

  it('returns planner rejection errors for unknown provider references', async () => {
    const result = await executeBuiltIn(
      {
        attempts: [
          {
            provider: 'missing-provider',
          },
        ],
      },
      {},
      {
        planner: plannerService([provider('available-provider', [])]),
      },
    );

    expect(result.decision).toEqual({
      code: RESPONSE_CODE.PROVIDER_INSTANCE_NOT_FOUND,
      kind: PIPELINE_DECISION_KIND.REJECT,
      message: 'Provider instance "missing-provider" was not found or is disabled.',
      status: 500,
    });
  });

  it('executes a gateway pipeline plan through ranked candidates', async () => {
    const acquired: ProxyAcquireInput[] = [];
    const gateway = createProxyGateway({
      pipelines: [
        {
          id: 'ranked-plan',
          plan: [{ use: PIPELINE_STEP_TYPE.PLAN_FALLBACK }],
          rank: [{ use: PIPELINE_STEP_TYPE.PROVIDERS_PRIORITY }],
        },
      ],
      providers: [
        provider('provider-a', acquired, { priority: 1 }),
        provider('provider-b', acquired, { priority: 10 }),
      ],
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(acquired.map((input) => input.providerInstanceId)).toEqual(['provider-b']);
  });

  it('preserves per-attempt plan args through gateway execution', async () => {
    const acquired: ProxyAcquireInput[] = [];
    const gateway = createProxyGateway({
      pipelines: [
        {
          id: 'explicit-plan',
          plan: [
            {
              args: {
                attempts: [
                  {
                    maxAttempts: 2,
                    provider: 'provider-a',
                    requirements: {
                      protocols: [PROXY_PROTOCOL.HTTP],
                    },
                    retryOn: [RETRY_CONDITION.TARGET_NETWORK_ERROR],
                    timeoutMs: 1500,
                    verification: {
                      verifyExit: true,
                    },
                  },
                ],
              },
              use: PIPELINE_STEP_TYPE.PLAN_FALLBACK,
            },
          ],
        },
      ],
      providers: [
        provider('provider-a', acquired, {
          capabilities: {
            protocols: [PROXY_PROTOCOL.HTTP],
          },
        }),
      ],
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(acquired).toHaveLength(1);
    expect(acquired[0]?.providerInstanceId).toBe('provider-a');
    expect(acquired[0]?.requirements).toEqual({
      protocols: [PROXY_PROTOCOL.HTTP],
      verification: {
        verifyExit: true,
      },
    });
  });
});

async function executeBuiltIn(
  args: Record<string, unknown>,
  statePatch: Partial<ProxyDecisionState> = {},
  services: ProxyGatewayServices,
): Promise<ProxyPipelineStepResult> {
  const stepToExecute = createBuiltInPipelineStepRegistry().get(PIPELINE_STEP_TYPE.PLAN_FALLBACK);

  if (stepToExecute === undefined) {
    throw new Error('Missing built-in step: plan.fallback.');
  }

  return stepToExecute.execute({
    args,
    requestId: 'request-1',
    services,
    signal: new AbortController().signal,
    state: {
      candidates: [],
      context: {},
      facts: {},
      metadata: {},
      requirements: {},
      target: {
        body: {
          kind: 'none',
          replayability: 'replayable',
        },
        fetch: {},
        headers: [],
        method: 'GET',
        url: 'https://example.com/resource',
      },
      ...statePatch,
    },
  });
}

function plannerService(providers: ProxyProviderInstance[]): ProxyGatewayServices['planner'] {
  return {
    plan: (input: {
      candidates: ProxyProviderCandidate[];
      plan: Parameters<ExecutionPlanner['plan']>[0]['plan'];
    }) =>
      new ExecutionPlanner({
        providers: orderProvidersForCandidates(providers, input.candidates),
      }).plan({ plan: input.plan }),
  };
}

function orderProvidersForCandidates(
  providers: ProxyProviderInstance[],
  candidates: ProxyProviderCandidate[],
): ProxyProviderInstance[] {
  if (candidates.length === 0) {
    return providers;
  }

  const candidateIds = candidates.map((providerCandidate) => providerCandidate.providerInstanceId);
  const candidateProviders = candidateIds.flatMap((candidateId) => {
    const selectedProvider = providers.find((providerInstance) => providerInstance.id === candidateId);

    return selectedProvider === undefined ? [] : [selectedProvider];
  });
  const remainingProviders = providers.filter((providerInstance) => !candidateIds.includes(providerInstance.id));

  return [...candidateProviders, ...remainingProviders];
}

function candidate(id: string): ProxyProviderCandidate {
  return {
    providerInstanceId: id,
    providerKind: 'test-provider',
  };
}

interface IProviderOptions {
  capabilities?: ProxyProviderCapabilities;
  priority?: number;
}

function provider(
  id: string,
  acquired: ProxyAcquireInput[],
  options: IProviderOptions = {},
): ProxyProviderInstance {
  return {
    id,
    ...(options.priority === undefined ? {} : { priority: options.priority }),
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
      getCapabilities: () => options.capabilities ?? {},
      kind: 'test-provider',
    },
  };
}

function executionPlan(providerInstanceId: string): ProxyExecutionPlan {
  return {
    attempts: [
      {
        providerInstanceId,
      },
    ],
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
    url: 'https://example.com/resource',
  };
}

function proxyFetchJsonRequest(): Request {
  return new Request('https://gateway.test/proxy', {
    body: JSON.stringify({
      context: {},
      request: {
        body: null,
        headers: [],
        method: 'GET',
        url: 'https://example.com/resource',
      },
      version: WIRE_PROTOCOL_VERSION,
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  });
}
