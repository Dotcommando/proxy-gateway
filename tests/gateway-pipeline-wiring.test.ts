import { describe, expect, it } from '@jest/globals';

import {
  createProxyGateway,
  type GatewayTargetResponse,
  PIPELINE_DECISION_KIND,
  PROXY_PLAN_KIND,
  PROXY_ROUTE_KIND,
  type ProxyAcquireInput,
  type ProxyExecutionPlan,
  type ProxyPipelineStep,
  type ProxyPipelineStepRegistryPort,
  type ProxyProviderInstance,
  type TargetTransportPort,
  WIRE_PROTOCOL_VERSION,
} from '../src';

describe('gateway pipeline wiring', () => {
  it('uses configured pipelines and a custom step registry to execute a selected plan', async () => {
    const acquired: ProxyAcquireInput[] = [];
    const seenRequestIds: string[] = [];
    const seenTargets: string[] = [];
    const registry = stepRegistry([
      step('select-provider-b', async (input) => {
        seenRequestIds.push(input.requestId);
        seenTargets.push(input.state.target.url);

        return {
          decision: {
            kind: PIPELINE_DECISION_KIND.USE_PLAN,
            plan: executionPlan('provider-b'),
          },
        };
      }),
    ]);
    const gateway = createProxyGateway({
      pipelines: [
        {
          id: 'api-pipeline',
          plan: [{ use: 'select-provider-b' }],
        },
      ],
      providers: [
        provider('provider-a', acquired),
        provider('provider-b', acquired),
      ],
      random: {
        createId: () => 'request-pipeline-1',
      },
      stepRegistry: registry,
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest('https://api.example.com/v1/models'));

    expect((await response.json()).ok).toBe(true);
    expect(acquired.map((input) => input.providerInstanceId)).toEqual(['provider-b']);
    expect(seenRequestIds).toEqual(['request-pipeline-1']);
    expect(seenTargets).toEqual(['https://api.example.com/v1/models']);
  });

  it('filters pipelines by when before executing their steps', async () => {
    const acquired: ProxyAcquireInput[] = [];
    const executed: string[] = [];
    const registry = stepRegistry([
      step('skipped-plan', async () => {
        executed.push('skipped-plan');

        return {
          decision: {
            kind: PIPELINE_DECISION_KIND.USE_PLAN,
            plan: executionPlan('provider-a'),
          },
        };
      }),
      step('matched-plan', async () => {
        executed.push('matched-plan');

        return {
          decision: {
            kind: PIPELINE_DECISION_KIND.USE_PLAN,
            plan: executionPlan('provider-b'),
          },
        };
      }),
    ]);
    const gateway = createProxyGateway({
      pipelines: [
        {
          id: 'other-host',
          plan: [{ use: 'skipped-plan' }],
          when: {
            host: 'other.example.com',
          },
        },
        {
          id: 'api-host',
          plan: [{ use: 'matched-plan' }],
          when: {
            host: 'api.example.com',
          },
        },
      ],
      providers: [
        provider('provider-a', acquired),
        provider('provider-b', acquired),
      ],
      stepRegistry: registry,
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest('https://api.example.com/v1/models'));

    expect((await response.json()).ok).toBe(true);
    expect(executed).toEqual(['matched-plan']);
    expect(acquired.map((input) => input.providerInstanceId)).toEqual(['provider-b']);
  });

  it('runs match phase only after a matching when prefilter', async () => {
    const acquired: ProxyAcquireInput[] = [];
    const executed: string[] = [];
    const registry = stepRegistry([
      step('match-step', async () => {
        executed.push('match');

        return {};
      }),
      step('plan-step', async () => {
        executed.push('plan');

        return {
          decision: {
            kind: PIPELINE_DECISION_KIND.USE_PLAN,
            plan: executionPlan('provider-b'),
          },
        };
      }),
    ]);
    const gateway = createProxyGateway({
      pipelines: [
        {
          id: 'skipped',
          match: [{ use: 'match-step' }],
          plan: [{ use: 'plan-step' }],
          when: {
            host: 'other.example.com',
          },
        },
        {
          id: 'matched',
          match: [{ use: 'match-step' }],
          plan: [{ use: 'plan-step' }],
          when: {
            host: 'api.example.com',
          },
        },
      ],
      providers: [
        provider('provider-a', acquired),
        provider('provider-b', acquired),
      ],
      stepRegistry: registry,
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest('https://api.example.com/v1/models'));

    expect((await response.json()).ok).toBe(true);
    expect(executed).toEqual(['match', 'plan']);
    expect(acquired.map((input) => input.providerInstanceId)).toEqual(['provider-b']);
  });

  it('uses higher pipeline priority before declaration order and preserves equal-priority order', async () => {
    const acquired: ProxyAcquireInput[] = [];
    const executed: string[] = [];
    const registry = stepRegistry([
      step('provider-a-plan', async () => {
        executed.push('provider-a-plan');

        return {
          decision: {
            kind: PIPELINE_DECISION_KIND.USE_PLAN,
            plan: executionPlan('provider-a'),
          },
        };
      }),
      step('provider-b-plan', async () => {
        executed.push('provider-b-plan');

        return {
          decision: {
            kind: PIPELINE_DECISION_KIND.USE_PLAN,
            plan: executionPlan('provider-b'),
          },
        };
      }),
    ]);
    const gateway = createProxyGateway({
      pipelines: [
        {
          id: 'first-low',
          plan: [{ use: 'provider-a-plan' }],
          priority: 1,
        },
        {
          id: 'second-high',
          plan: [{ use: 'provider-b-plan' }],
          priority: 10,
        },
        {
          id: 'third-high-same-priority',
          plan: [{ use: 'provider-a-plan' }],
          priority: 10,
        },
      ],
      providers: [
        provider('provider-a', acquired),
        provider('provider-b', acquired),
      ],
      stepRegistry: registry,
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest('https://api.example.com/v1/models'));

    expect((await response.json()).ok).toBe(true);
    expect(executed).toEqual(['provider-b-plan']);
    expect(acquired.map((input) => input.providerInstanceId)).toEqual(['provider-b']);
  });
});

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

function provider(id: string, acquired: ProxyAcquireInput[]): ProxyProviderInstance {
  return {
    id,
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

function proxyFetchJsonRequest(url: string): Request {
  return new Request('https://gateway.test/proxy', {
    body: JSON.stringify({
      context: {
        flowKey: 'flow-1',
      },
      request: {
        body: null,
        headers: [],
        method: 'GET',
        url,
      },
      version: WIRE_PROTOCOL_VERSION,
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  });
}
