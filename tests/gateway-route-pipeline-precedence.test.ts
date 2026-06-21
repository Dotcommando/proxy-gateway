import { describe, expect, it } from '@jest/globals';

import {
  createProxyGateway,
  type GatewayTargetResponse,
  PIPELINE_DECISION_KIND,
  PIPELINE_STEP_TYPE,
  PROXY_PLAN_KIND,
  PROXY_PROTOCOL,
  PROXY_ROUTE_KIND,
  type ProxyAcquireInput,
  type ProxyPipelineStep,
  type ProxyPipelineStepRegistryPort,
  type ProxyProviderCapabilities,
  type ProxyProviderInstance,
  RESPONSE_CODE,
  type TargetTransportPort,
  WIRE_PROTOCOL_VERSION,
} from '../src';

describe('gateway route and pipeline precedence', () => {
  it('lets route requirements constrain a pipeline-selected plan', async () => {
    const acquired: ProxyAcquireInput[] = [];
    const gateway = createProxyGateway({
      pipelines: [
        {
          id: 'pipeline-plan',
          plan: [{ use: PIPELINE_STEP_TYPE.PLAN_FALLBACK }],
        },
      ],
      providers: [
        provider('provider-a', acquired, {
          capabilities: {
            protocols: [PROXY_PROTOCOL.HTTP],
          },
        }),
        provider('provider-b', acquired, {
          capabilities: {
            protocols: [PROXY_PROTOCOL.SOCKS5H],
          },
        }),
      ],
      routes: [
        {
          id: 'socks-api',
          match: {
            host: 'api.example.com',
          },
          plan: fallbackPlan('provider-a'),
          requirements: {
            protocols: [PROXY_PROTOCOL.SOCKS5H],
          },
        },
      ],
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest('https://api.example.com/v1/models'));

    expect((await response.json()).ok).toBe(true);
    expect(acquired.map((input) => input.providerInstanceId)).toEqual(['provider-b']);
    expect(acquired[0]?.requirements).toEqual({
      protocols: [PROXY_PROTOCOL.SOCKS5H],
      providerInstanceIds: ['provider-a', 'provider-b'],
    });
  });

  it('stops on pipeline rejection before route/default planning', async () => {
    const acquired: ProxyAcquireInput[] = [];
    const gateway = createProxyGateway({
      pipelines: [
        {
          id: 'rejecting-pipeline',
          plan: [{ use: 'plan.reject' }],
        },
      ],
      providers: [
        provider('provider-a', acquired),
        provider('provider-b', acquired),
      ],
      routes: [
        {
          id: 'api-route',
          match: {
            host: 'api.example.com',
          },
          plan: fallbackPlan('provider-b'),
        },
      ],
      stepRegistry: stepRegistry([
        step('plan.reject', async () => ({
          decision: {
            code: RESPONSE_CODE.REJECTED_BY_POLICY,
            kind: PIPELINE_DECISION_KIND.REJECT,
            message: 'Pipeline rejected this request.',
            status: 451,
          },
        })),
      ]),
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest('https://api.example.com/v1/models'));

    expect(response.status).toBe(451);
    expect(await response.json()).toEqual({
      error: {
        code: RESPONSE_CODE.REJECTED_BY_POLICY,
        message: 'Pipeline rejected this request.',
        retryable: false,
      },
      ok: false,
      version: WIRE_PROTOCOL_VERSION,
    });
    expect(acquired).toEqual([]);
  });

  it('falls through to the default route when all configured pipelines skip', async () => {
    const acquired: ProxyAcquireInput[] = [];
    const gateway = createProxyGateway({
      defaultRoute: {
        id: 'default-route',
        plan: fallbackPlan('provider-b'),
      },
      pipelines: [
        {
          id: 'other-host',
          plan: [{ use: 'plan.missing-but-skipped' }],
          when: {
            host: 'other.example.com',
          },
        },
      ],
      providers: [
        provider('provider-a', acquired),
        provider('provider-b', acquired),
      ],
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest('https://api.example.com/v1/models'));

    expect((await response.json()).ok).toBe(true);
    expect(acquired.map((input) => input.providerInstanceId)).toEqual(['provider-b']);
  });

  it('falls through to direct options.plan when pipelines skip and no route is configured', async () => {
    const acquired: ProxyAcquireInput[] = [];
    const gateway = createProxyGateway({
      pipelines: [
        {
          id: 'other-host',
          plan: [{ use: 'plan.missing-but-skipped' }],
          when: {
            host: 'other.example.com',
          },
        },
      ],
      plan: fallbackPlan('provider-b'),
      providers: [
        provider('provider-a', acquired),
        provider('provider-b', acquired),
      ],
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest('https://api.example.com/v1/models'));

    expect((await response.json()).ok).toBe(true);
    expect(acquired.map((input) => input.providerInstanceId)).toEqual(['provider-b']);
  });

  it('returns a stable no-plan error after configured pipelines skip without a route/default/direct plan', async () => {
    const acquired: ProxyAcquireInput[] = [];
    const gateway = createProxyGateway({
      pipelines: [
        {
          id: 'other-host',
          plan: [{ use: 'plan.missing-but-skipped' }],
          when: {
            host: 'other.example.com',
          },
        },
      ],
      providers: [
        provider('provider-a', acquired),
      ],
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest('https://api.example.com/v1/models'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: RESPONSE_CODE.REJECTED_BY_POLICY,
        message: 'No configured pipeline selected an execution plan.',
        retryable: false,
      },
      ok: false,
      version: WIRE_PROTOCOL_VERSION,
    });
    expect(acquired).toEqual([]);
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

interface IProviderOptions {
  capabilities?: ProxyProviderCapabilities;
}

function provider(
  id: string,
  acquired: ProxyAcquireInput[],
  options: IProviderOptions = {},
): ProxyProviderInstance {
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
      getCapabilities: () => options.capabilities ?? {},
      kind: 'test-provider',
    },
  };
}

function fallbackPlan(providerId: string) {
  return {
    attempts: [
      {
        provider: providerId,
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
      context: {},
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
