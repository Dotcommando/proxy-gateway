import { describe, expect, it } from '@jest/globals';

import {
  createProxyGateway,
  type GatewayTargetResponse,
  PIPELINE_DECISION_KIND,
  PIPELINE_STEP_TYPE,
  PROXY_PLAN_KIND,
  PROXY_ROUTE_KIND,
  type ProxyAcquireInput,
  type ProxyDecisionState,
  type ProxyExecutionPlan,
  type ProxyGatewayServices,
  type ProxyPipelineStep,
  type ProxyPipelineStepRegistryPort,
  type ProxyProviderCandidate,
  type ProxyProviderInstance,
  RESPONSE_CODE,
  type TargetTransportPort,
  WIRE_PROTOCOL_VERSION,
} from '../src';
import { createBuiltInPipelineStepRegistry } from '../src/app/pipeline';

describe('built-in provider pipeline steps', () => {
  it('uses package enum values for built-in provider step names', () => {
    expect(PIPELINE_STEP_TYPE.PROVIDERS_INCLUDE).toBe('providers.include');
    expect(PIPELINE_STEP_TYPE.PROVIDERS_EXCLUDE).toBe('providers.exclude');
    expect(PIPELINE_STEP_TYPE.PROVIDERS_TAGS).toBe('providers.tags');
    expect(PIPELINE_STEP_TYPE.PROVIDERS_PRIORITY).toBe('providers.priority');
    expect(PIPELINE_STEP_TYPE.PROVIDERS_WEIGHTED).toBe('providers.weighted');
  });

  it('includes only requested provider instance ids while preserving candidate order', async () => {
    const result = await executeBuiltIn(
      PIPELINE_STEP_TYPE.PROVIDERS_INCLUDE,
      {
        providerInstanceIds: ['provider-c', 'provider-b'],
      },
      {
        candidates: [
          candidate('provider-a'),
          candidate('provider-b'),
          candidate('provider-c'),
        ],
      },
    );

    expect(candidateIds(result.statePatch?.candidates)).toEqual(['provider-b', 'provider-c']);
  });

  it('excludes requested provider instance ids', async () => {
    const result = await executeBuiltIn(
      PIPELINE_STEP_TYPE.PROVIDERS_EXCLUDE,
      {
        providerInstanceIds: ['provider-b'],
      },
      {
        candidates: [
          candidate('provider-a'),
          candidate('provider-b'),
          candidate('provider-c'),
        ],
      },
    );

    expect(candidateIds(result.statePatch?.candidates)).toEqual(['provider-a', 'provider-c']);
  });

  it('filters candidates by required tags', async () => {
    const result = await executeBuiltIn(
      PIPELINE_STEP_TYPE.PROVIDERS_TAGS,
      {
        tags: ['residential', 'eu'],
      },
      {
        candidates: [
          candidate('provider-a', { tags: ['residential', 'eu'] }),
          candidate('provider-b', { tags: ['residential'] }),
          candidate('provider-c', { tags: ['datacenter', 'eu'] }),
        ],
      },
    );

    expect(candidateIds(result.statePatch?.candidates)).toEqual(['provider-a']);
  });

  it('ranks candidates by priority with stable declaration-order ties', async () => {
    const result = await executeBuiltIn(
      PIPELINE_STEP_TYPE.PROVIDERS_PRIORITY,
      {},
      {
        candidates: [
          candidate('provider-a', { priority: 1 }),
          candidate('provider-b', { priority: 10 }),
          candidate('provider-c', { priority: 10 }),
          candidate('provider-d'),
        ],
      },
    );

    expect(candidateIds(result.statePatch?.candidates)).toEqual([
      'provider-b',
      'provider-c',
      'provider-a',
      'provider-d',
    ]);
  });

  it('ranks candidates by weight using an injected deterministic random source', async () => {
    const randomValues = [0.9, 0.5];
    const result = await executeBuiltIn(
      PIPELINE_STEP_TYPE.PROVIDERS_WEIGHTED,
      {},
      {
        candidates: [
          candidate('provider-a', { weight: 1 }),
          candidate('provider-b', { weight: 10 }),
        ],
      },
      {
        random: {
          nextFloat: () => randomValues.shift() ?? 0.5,
        },
      },
    );

    expect(candidateIds(result.statePatch?.candidates)).toEqual(['provider-b', 'provider-a']);
  });

  it('returns a stable reject decision for invalid provider step args', async () => {
    const result = await executeBuiltIn(PIPELINE_STEP_TYPE.PROVIDERS_INCLUDE, {
      providerInstanceIds: 'provider-a',
    });

    expect(result.decision).toEqual({
      code: RESPONSE_CODE.PIPELINE_STEP_INVALID_ARGS,
      kind: PIPELINE_DECISION_KIND.REJECT,
      message: 'Invalid providers.include args: providerInstanceIds must be an array of strings.',
      status: 400,
    });
  });

  it('does not let disabled providers enter built-in provider selection', async () => {
    const acquired: ProxyAcquireInput[] = [];
    const candidateSnapshots: string[][] = [];
    const planFirstCandidate = step('plan.first-candidate', async (input) => {
      candidateSnapshots.push(input.state.candidates.map((providerCandidate) => providerCandidate.providerInstanceId));

      const firstCandidate = input.state.candidates[0];

      if (firstCandidate === undefined) {
        throw new Error('Expected at least one candidate.');
      }

      return {
        decision: {
          kind: PIPELINE_DECISION_KIND.USE_PLAN,
          plan: executionPlan(firstCandidate.providerInstanceId),
        },
      };
    });
    const gateway = createProxyGateway({
      pipelines: [
        {
          id: 'provider-ranking',
          plan: [{ use: 'plan.first-candidate' }],
          rank: [{ use: PIPELINE_STEP_TYPE.PROVIDERS_PRIORITY }],
        },
      ],
      providers: [
        provider('disabled-high-priority', acquired, { enabled: false, priority: 100 }),
        provider('enabled-low-priority', acquired, { priority: 1 }),
      ],
      stepRegistry: stepRegistry([planFirstCandidate]),
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(candidateSnapshots).toEqual([['enabled-low-priority']]);
    expect(acquired.map((input) => input.providerInstanceId)).toEqual(['enabled-low-priority']);
  });
});

async function executeBuiltIn(
  type: PIPELINE_STEP_TYPE,
  args: Record<string, unknown>,
  statePatch: Partial<ProxyDecisionState> = {},
  services: ProxyGatewayServices = {},
) {
  const stepToExecute = createBuiltInPipelineStepRegistry().get(type);

  if (stepToExecute === undefined) {
    throw new Error(`Missing built-in step: ${type}.`);
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

interface ICandidateOptions {
  priority?: number;
  tags?: string[];
  weight?: number;
}

function candidate(id: string, options: ICandidateOptions = {}): ProxyProviderCandidate {
  return {
    providerInstanceId: id,
    providerKind: 'test-provider',
    ...(options.priority === undefined ? {} : { priority: options.priority }),
    ...(options.tags === undefined ? {} : { tags: options.tags }),
    ...(options.weight === undefined ? {} : { weight: options.weight }),
  };
}

function candidateIds(candidates: ProxyProviderCandidate[] | undefined): string[] {
  return candidates?.map((providerCandidate) => providerCandidate.providerInstanceId) ?? [];
}

function step(type: string, execute: ProxyPipelineStep['execute']): ProxyPipelineStep {
  return {
    execute,
    type,
  };
}

function stepRegistry(steps: ProxyPipelineStep[]): ProxyPipelineStepRegistryPort {
  const stepByType = new Map(steps.map((pipelineStep) => [pipelineStep.type, pipelineStep]));

  return {
    get: (type) => stepByType.get(type),
    register: (pipelineStep) => {
      stepByType.set(pipelineStep.type, pipelineStep);
    },
  };
}

interface IProviderOptions {
  enabled?: boolean;
  priority?: number;
  tags?: string[];
  weight?: number;
}

function provider(
  id: string,
  acquired: ProxyAcquireInput[],
  options: IProviderOptions = {},
): ProxyProviderInstance {
  return {
    id,
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
    ...(options.priority === undefined ? {} : { priority: options.priority }),
    ...(options.tags === undefined ? {} : { tags: options.tags }),
    ...(options.weight === undefined ? {} : { weight: options.weight }),
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
