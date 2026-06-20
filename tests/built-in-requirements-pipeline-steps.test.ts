import { describe, expect, it } from '@jest/globals';

import {
  createProxyGateway,
  type GatewayTargetResponse,
  PIPELINE_DECISION_KIND,
  PIPELINE_STEP_TYPE,
  PROXY_GEO_STRICTNESS,
  PROXY_IDENTITY_ROTATION,
  PROXY_PLAN_KIND,
  PROXY_PROTOCOL,
  PROXY_ROUTE_KIND,
  type ProxyAcquireInput,
  type ProxyExecutionPlan,
  type ProxyPipelineStep,
  type ProxyPipelineStepRegistryPort,
  type ProxyProviderInstance,
  RESPONSE_CODE,
  type TargetTransportPort,
  WIRE_PROTOCOL_VERSION,
} from '../src';
import { createBuiltInPipelineStepRegistry } from '../src/app/pipeline';
import type { ProxyDecisionState } from '../src/ports/outbound';

describe('built-in requirements pipeline steps', () => {
  it('uses package enum values for built-in requirement step names', () => {
    expect(PIPELINE_STEP_TYPE.REQUIREMENTS_SET).toBe('requirements.set');
    expect(PIPELINE_STEP_TYPE.REQUIREMENTS_MERGE).toBe('requirements.merge');
    expect(PIPELINE_STEP_TYPE.REQUIREMENTS_IDENTITY).toBe('requirements.identity');
    expect(PIPELINE_STEP_TYPE.REQUIREMENTS_GEO).toBe('requirements.geo');
    expect(PIPELINE_STEP_TYPE.REQUIREMENTS_VERIFICATION).toBe('requirements.verification');
  });

  it('sets requirement fields from args', async () => {
    const result = await executeBuiltIn(PIPELINE_STEP_TYPE.REQUIREMENTS_SET, {
      geo: {
        country: 'GB',
        strictness: PROXY_GEO_STRICTNESS.REQUIRED,
      },
      protocols: [PROXY_PROTOCOL.HTTP],
    });

    expect(result.statePatch?.requirements).toEqual({
      geo: {
        country: 'GB',
        strictness: PROXY_GEO_STRICTNESS.REQUIRED,
      },
      protocols: [PROXY_PROTOCOL.HTTP],
    });
  });

  it('merges requirement args into existing state with route requirement merge semantics', async () => {
    const result = await executeBuiltIn(
      PIPELINE_STEP_TYPE.REQUIREMENTS_MERGE,
      {
        identity: {
          requestNewIdentity: true,
        },
        protocols: [PROXY_PROTOCOL.HTTP],
      },
      {
        requirements: {
          identity: {
            rotation: PROXY_IDENTITY_ROTATION.STICKY,
            stickySessionTtlMs: 60_000,
          },
          protocols: [PROXY_PROTOCOL.SOCKS5H],
        },
      },
    );

    expect(result.statePatch?.requirements).toEqual({
      identity: {
        requestNewIdentity: true,
        rotation: PROXY_IDENTITY_ROTATION.STICKY,
        stickySessionTtlMs: 60_000,
      },
      protocols: [PROXY_PROTOCOL.HTTP],
    });
  });

  it('sets identity, geo, and verification requirement groups', async () => {
    const identityResult = await executeBuiltIn(PIPELINE_STEP_TYPE.REQUIREMENTS_IDENTITY, {
      rotation: PROXY_IDENTITY_ROTATION.PER_REQUEST,
    });
    const geoResult = await executeBuiltIn(PIPELINE_STEP_TYPE.REQUIREMENTS_GEO, {
      country: 'DE',
      strictness: PROXY_GEO_STRICTNESS.REQUIRED,
    });
    const verificationResult = await executeBuiltIn(PIPELINE_STEP_TYPE.REQUIREMENTS_VERIFICATION, {
      maxVerificationAttempts: 2,
      verifyExit: true,
    });

    expect(identityResult.statePatch?.requirements?.identity).toEqual({
      rotation: PROXY_IDENTITY_ROTATION.PER_REQUEST,
    });
    expect(geoResult.statePatch?.requirements?.geo).toEqual({
      country: 'DE',
      strictness: PROXY_GEO_STRICTNESS.REQUIRED,
    });
    expect(verificationResult.statePatch?.requirements?.verification).toEqual({
      maxVerificationAttempts: 2,
      verifyExit: true,
    });
  });

  it('returns a stable reject decision for invalid args', async () => {
    const result = await executeBuiltIn(PIPELINE_STEP_TYPE.REQUIREMENTS_SET, {
      protocols: 'http',
    });

    expect(result.decision).toEqual({
      code: RESPONSE_CODE.PIPELINE_STEP_INVALID_ARGS,
      kind: PIPELINE_DECISION_KIND.REJECT,
      message: 'Invalid requirements.set args: protocols must be an array of strings.',
      status: 400,
    });
  });

  it('registers built-ins by default while allowing a user registry to provide plan steps', async () => {
    const acquired: ProxyAcquireInput[] = [];
    const planStep = step('plan.use-provider-b', async (input) => {
      expect(input.state.requirements.geo).toEqual({
        country: 'GB',
        strictness: PROXY_GEO_STRICTNESS.REQUIRED,
      });

      return {
        decision: {
          kind: PIPELINE_DECISION_KIND.USE_PLAN,
          plan: executionPlan('provider-b'),
        },
      };
    });
    const gateway = createProxyGateway({
      pipelines: [
        {
          id: 'pipeline',
          plan: [{ use: 'plan.use-provider-b' }],
          require: [
            {
              args: {
                geo: {
                  country: 'GB',
                  strictness: PROXY_GEO_STRICTNESS.REQUIRED,
                },
              },
              use: PIPELINE_STEP_TYPE.REQUIREMENTS_SET,
            },
          ],
        },
      ],
      providers: [
        provider('provider-a', acquired),
        provider('provider-b', acquired),
      ],
      stepRegistry: stepRegistry([planStep]),
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(acquired.map((input) => input.providerInstanceId)).toEqual(['provider-b']);
  });

  it('lets a user registry override a built-in requirement step intentionally', async () => {
    const acquired: ProxyAcquireInput[] = [];
    const customRequirementsSet = step(PIPELINE_STEP_TYPE.REQUIREMENTS_SET, async () => ({
      statePatch: {
        requirements: {
          protocols: [PROXY_PROTOCOL.SOCKS5H],
        },
      },
    }));
    const planStep = step('plan.read-overridden-requirements', async (input) => {
      expect(input.state.requirements).toEqual({
        protocols: [PROXY_PROTOCOL.SOCKS5H],
      });

      return {
        decision: {
          kind: PIPELINE_DECISION_KIND.USE_PLAN,
          plan: executionPlan('provider-b'),
        },
      };
    });
    const gateway = createProxyGateway({
      pipelines: [
        {
          id: 'pipeline',
          plan: [{ use: 'plan.read-overridden-requirements' }],
          require: [
            {
              args: {
                protocols: [PROXY_PROTOCOL.HTTP],
              },
              use: PIPELINE_STEP_TYPE.REQUIREMENTS_SET,
            },
          ],
        },
      ],
      providers: [
        provider('provider-a', acquired),
        provider('provider-b', acquired),
      ],
      stepRegistry: stepRegistry([customRequirementsSet, planStep]),
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(acquired.map((input) => input.providerInstanceId)).toEqual(['provider-b']);
  });
});

async function executeBuiltIn(
  type: PIPELINE_STEP_TYPE,
  args: Record<string, unknown>,
  statePatch: Partial<ProxyDecisionState> = {},
) {
  const stepToExecute = createBuiltInPipelineStepRegistry().get(type);

  if (stepToExecute === undefined) {
    throw new Error(`Missing built-in step: ${type}.`);
  }

  return stepToExecute.execute({
    args,
    requestId: 'request-1',
    services: {},
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
