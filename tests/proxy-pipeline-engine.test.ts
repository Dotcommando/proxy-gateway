import { describe, expect, it } from '@jest/globals';

import {
  ProxyPipelineEngine,
  ProxyPipelineStepRegistry,
  ProxyPipelineStepRegistryError,
} from '../src/app/pipeline';
import {
  PIPELINE_DECISION_KIND,
  PIPELINE_PHASE,
  PIPELINE_RESULT_KIND,
  PIPELINE_WHEN_NOT_MATCHED_REASON,
  PROXY_PLAN_KIND,
  RESPONSE_CODE,
} from '../src/constants';
import type {
  GatewayEvent,
  ProxyDecisionState,
  ProxyExecutionPlan,
  ProxyPipelineConfig,
  ProxyPipelineStep,
} from '../src/ports/outbound';

const createState = (): ProxyDecisionState => ({
  candidates: [],
  context: {
    flowKey: 'flow-1',
    metadata: {
      original: true,
    },
  },
  facts: {},
  metadata: {
    original: true,
  },
  requirements: {},
  target: {
    body: {
      kind: 'none',
      replayability: 'replayable',
    },
    fetch: {},
    headers: [],
    method: 'GET',
    url: 'https://api.example.com/v1/models',
  },
});
const createPlan = (providerInstanceId = 'provider-a'): ProxyExecutionPlan => ({
  attempts: [
    {
      providerInstanceId,
    },
  ],
  kind: PROXY_PLAN_KIND.FALLBACK,
});
const createStep = (
  type: string,
  execute: ProxyPipelineStep['execute'],
): ProxyPipelineStep => ({
  execute,
  type,
});

describe('ProxyPipelineEngine', () => {
  it('uses package enums for phases, decisions, results, and unknown-step codes', () => {
    expect(PIPELINE_PHASE.MATCH).toBe('match');
    expect(PIPELINE_PHASE.ENRICH).toBe('enrich');
    expect(PIPELINE_PHASE.REQUIRE).toBe('require');
    expect(PIPELINE_PHASE.SELECT).toBe('select');
    expect(PIPELINE_PHASE.RANK).toBe('rank');
    expect(PIPELINE_PHASE.PLAN).toBe('plan');
    expect(PIPELINE_PHASE.VERIFY).toBe('verify');
    expect(PIPELINE_DECISION_KIND.CONTINUE).toBe('continue');
    expect(PIPELINE_DECISION_KIND.REJECT).toBe('reject');
    expect(PIPELINE_DECISION_KIND.USE_PLAN).toBe('use-plan');
    expect(PIPELINE_DECISION_KIND.SKIP_PIPELINE).toBe('skip-pipeline');
    expect(PIPELINE_RESULT_KIND.COMPLETED).toBe('completed');
    expect(PIPELINE_RESULT_KIND.REJECTED).toBe('rejected');
    expect(PIPELINE_RESULT_KIND.PLAN_SELECTED).toBe('plan-selected');
    expect(PIPELINE_RESULT_KIND.SKIPPED).toBe('skipped');
    expect(PIPELINE_RESULT_KIND.STEP_NOT_FOUND).toBe('step-not-found');
    expect(RESPONSE_CODE.PIPELINE_STEP_ALREADY_REGISTERED).toBe('PIPELINE_STEP_ALREADY_REGISTERED');
    expect(RESPONSE_CODE.PIPELINE_STEP_NOT_FOUND).toBe('PIPELINE_STEP_NOT_FOUND');
  });

  it('rejects duplicate step registrations without replacing the previous step', async () => {
    const firstStep = createStep('duplicate', async () => ({
      statePatch: {
        metadata: {
          selected: 'first',
        },
      },
    }));
    const secondStep = createStep('duplicate', async () => ({
      statePatch: {
        metadata: {
          selected: 'second',
        },
      },
    }));
    const registry = new ProxyPipelineStepRegistry([firstStep]);
    let error: unknown;

    try {
      registry.register(secondStep);
    } catch (caughtError) {
      error = caughtError;
    }

    expect(error).toBeInstanceOf(ProxyPipelineStepRegistryError);
    expect(error).toMatchObject({
      code: RESPONSE_CODE.PIPELINE_STEP_ALREADY_REGISTERED,
      stepType: 'duplicate',
    });

    const result = await new ProxyPipelineEngine(registry).execute({
      initialState: createState(),
      pipeline: {
        id: 'pipeline-a',
        plan: [{ use: 'duplicate' }],
      },
      requestId: 'request-1',
      services: {},
      signal: new AbortController().signal,
    });

    expect(result.kind).toBe(PIPELINE_RESULT_KIND.COMPLETED);
    expect(result.state.metadata).toMatchObject({
      selected: 'first',
    });
  });

  it('executes configured steps in pipeline phase order and passes execution input', async () => {
    const order: string[] = [];
    const services = {
      marker: 'services',
    };
    const abortController = new AbortController();
    const registry = new ProxyPipelineStepRegistry();
    const phases = [
      PIPELINE_PHASE.MATCH,
      PIPELINE_PHASE.ENRICH,
      PIPELINE_PHASE.REQUIRE,
      PIPELINE_PHASE.SELECT,
      PIPELINE_PHASE.RANK,
      PIPELINE_PHASE.PLAN,
      PIPELINE_PHASE.VERIFY,
    ];

    for (const phase of phases) {
      registry.register(
        createStep(`${phase}-step`, async (input) => {
          order.push(`${phase}:${String(input.args.name)}`);
          expect(input.requestId).toBe('request-1');
          expect(input.services).toBe(services);
          expect(input.signal).toBe(abortController.signal);

          return {};
        }),
      );
    }

    const pipeline: ProxyPipelineConfig = {
      enrich: [{ args: { name: 'enrich' }, use: `${PIPELINE_PHASE.ENRICH}-step` }],
      id: 'pipeline-a',
      match: [{ args: { name: 'match' }, use: `${PIPELINE_PHASE.MATCH}-step` }],
      plan: [{ args: { name: 'plan' }, use: `${PIPELINE_PHASE.PLAN}-step` }],
      rank: [{ args: { name: 'rank' }, use: `${PIPELINE_PHASE.RANK}-step` }],
      require: [{ args: { name: 'require' }, use: `${PIPELINE_PHASE.REQUIRE}-step` }],
      select: [{ args: { name: 'select' }, use: `${PIPELINE_PHASE.SELECT}-step` }],
      verify: [{ args: { name: 'verify' }, use: `${PIPELINE_PHASE.VERIFY}-step` }],
    };
    const result = await new ProxyPipelineEngine(registry).execute({
      initialState: createState(),
      pipeline,
      requestId: 'request-1',
      services,
      signal: abortController.signal,
    });

    expect(result.kind).toBe(PIPELINE_RESULT_KIND.COMPLETED);
    expect(order).toEqual([
      'match:match',
      'enrich:enrich',
      'require:require',
      'select:select',
      'rank:rank',
      'plan:plan',
      'verify:verify',
    ]);
  });

  it('skips the whole pipeline when the declarative when prefilter does not match', async () => {
    const registry = new ProxyPipelineStepRegistry([
      createStep('plan-step', async () => {
        throw new Error('pipeline steps should not run when prefilter does not match');
      }),
    ]);
    const result = await new ProxyPipelineEngine(registry).execute({
      initialState: createState(),
      pipeline: {
        id: 'pipeline-a',
        plan: [{ use: 'plan-step' }],
        when: {
          host: 'other.example.com',
        },
      },
      requestId: 'request-1',
      services: {},
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      events: [],
      kind: PIPELINE_RESULT_KIND.SKIPPED,
      reason: PIPELINE_WHEN_NOT_MATCHED_REASON,
      state: createState(),
    });
  });

  it('runs optional match phase steps after a matching declarative when prefilter', async () => {
    const executed: string[] = [];
    const registry = new ProxyPipelineStepRegistry([
      createStep('match-step', async () => {
        executed.push('match');

        return {};
      }),
      createStep('plan-step', async () => {
        executed.push('plan');

        return {};
      }),
    ]);
    const result = await new ProxyPipelineEngine(registry).execute({
      initialState: createState(),
      pipeline: {
        id: 'pipeline-a',
        match: [{ use: 'match-step' }],
        plan: [{ use: 'plan-step' }],
        when: {
          host: 'api.example.com',
        },
      },
      requestId: 'request-1',
      services: {},
      signal: new AbortController().signal,
    });

    expect(result.kind).toBe(PIPELINE_RESULT_KIND.COMPLETED);
    expect(executed).toEqual(['match', 'plan']);
  });

  it('merges state patches into later steps without mutating previous state', async () => {
    const initialState = createState();
    let secondStepState: ProxyDecisionState | undefined;
    const registry = new ProxyPipelineStepRegistry([
      createStep('patch-state', async () => ({
        statePatch: {
          candidates: [
            {
              providerInstanceId: 'provider-a',
              providerKind: 'direct',
            },
          ],
          context: {
            useCase: 'patched',
          },
          facts: {
            target: {
              host: 'api.example.com',
            },
          },
          metadata: {
            patched: true,
          },
          requirements: {
            protocols: ['socks5h'],
          },
          target: {
            ...initialState.target,
            method: 'POST',
          },
        },
      })),
      createStep('read-state', async (input) => {
        secondStepState = input.state;

        return {};
      }),
    ]);
    const result = await new ProxyPipelineEngine(registry).execute({
      initialState,
      pipeline: {
        id: 'pipeline-a',
        plan: [{ use: 'patch-state' }, { use: 'read-state' }],
      },
      requestId: 'request-1',
      services: {},
      signal: new AbortController().signal,
    });

    expect(result.kind).toBe(PIPELINE_RESULT_KIND.COMPLETED);
    expect(initialState.context).toEqual({
      flowKey: 'flow-1',
      metadata: {
        original: true,
      },
    });
    expect(initialState.metadata).toEqual({
      original: true,
    });
    expect(secondStepState).toMatchObject({
      candidates: [
        {
          providerInstanceId: 'provider-a',
          providerKind: 'direct',
        },
      ],
      context: {
        flowKey: 'flow-1',
        metadata: {
          original: true,
        },
        useCase: 'patched',
      },
      facts: {
        target: {
          host: 'api.example.com',
        },
      },
      metadata: {
        original: true,
        patched: true,
      },
      requirements: {
        protocols: ['socks5h'],
      },
      target: {
        method: 'POST',
      },
    });
  });

  it('stops on reject decisions', async () => {
    const executed: string[] = [];
    const registry = new ProxyPipelineStepRegistry([
      createStep('reject', async () => {
        executed.push('reject');

        return {
          decision: {
            code: 'REJECTED_BY_TEST',
            kind: PIPELINE_DECISION_KIND.REJECT,
            message: 'Rejected by test.',
            status: 403,
          },
        };
      }),
      createStep('later', async () => {
        executed.push('later');

        return {};
      }),
    ]);
    const result = await new ProxyPipelineEngine(registry).execute({
      initialState: createState(),
      pipeline: {
        id: 'pipeline-a',
        plan: [{ use: 'reject' }, { use: 'later' }],
      },
      requestId: 'request-1',
      services: {},
      signal: new AbortController().signal,
    });

    expect(result.kind).toBe(PIPELINE_RESULT_KIND.REJECTED);
    expect(executed).toEqual(['reject']);

    if (result.kind === PIPELINE_RESULT_KIND.REJECTED) {
      expect(result.decision.code).toBe('REJECTED_BY_TEST');
      expect(result.decision.status).toBe(403);
    }
  });

  it('stops and returns the selected plan on use-plan decisions', async () => {
    const selectedPlan = createPlan('provider-b');
    const registry = new ProxyPipelineStepRegistry([
      createStep('use-plan', async () => ({
        decision: {
          kind: PIPELINE_DECISION_KIND.USE_PLAN,
          plan: selectedPlan,
        },
      })),
      createStep('later', async () => {
        throw new Error('later step should not run');
      }),
    ]);
    const result = await new ProxyPipelineEngine(registry).execute({
      initialState: createState(),
      pipeline: {
        id: 'pipeline-a',
        plan: [{ use: 'use-plan' }, { use: 'later' }],
      },
      requestId: 'request-1',
      services: {},
      signal: new AbortController().signal,
    });

    expect(result.kind).toBe(PIPELINE_RESULT_KIND.PLAN_SELECTED);

    if (result.kind === PIPELINE_RESULT_KIND.PLAN_SELECTED) {
      expect(result.plan).toBe(selectedPlan);
      expect(result.state.plan).toBe(selectedPlan);
    }
  });

  it('stops without rejection on skip-pipeline decisions', async () => {
    const registry = new ProxyPipelineStepRegistry([
      createStep('skip', async () => ({
        decision: {
          kind: PIPELINE_DECISION_KIND.SKIP_PIPELINE,
          reason: 'not applicable',
        },
      })),
      createStep('later', async () => {
        throw new Error('later step should not run');
      }),
    ]);
    const result = await new ProxyPipelineEngine(registry).execute({
      initialState: createState(),
      pipeline: {
        id: 'pipeline-a',
        plan: [{ use: 'skip' }, { use: 'later' }],
      },
      requestId: 'request-1',
      services: {},
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      kind: PIPELINE_RESULT_KIND.SKIPPED,
      reason: 'not applicable',
    });
  });

  it('returns a stable result for unknown step types before later steps execute', async () => {
    const registry = new ProxyPipelineStepRegistry([
      createStep('later', async () => {
        throw new Error('later step should not run');
      }),
    ]);
    const result = await new ProxyPipelineEngine(registry).execute({
      initialState: createState(),
      pipeline: {
        id: 'pipeline-a',
        plan: [{ use: 'missing-step' }, { use: 'later' }],
      },
      requestId: 'request-1',
      services: {},
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      code: RESPONSE_CODE.PIPELINE_STEP_NOT_FOUND,
      events: [],
      kind: PIPELINE_RESULT_KIND.STEP_NOT_FOUND,
      message: 'Pipeline step is not registered: missing-step.',
      state: createState(),
      stepType: 'missing-step',
    });
  });

  it('accumulates returned events in execution order', async () => {
    const firstEvent: GatewayEvent = {
      type: 'first',
    };
    const secondEvent: GatewayEvent = {
      type: 'second',
    };
    const registry = new ProxyPipelineStepRegistry([
      createStep('first', async () => ({
        events: [firstEvent],
      })),
      createStep('second', async () => ({
        events: [secondEvent],
      })),
    ]);
    const result = await new ProxyPipelineEngine(registry).execute({
      initialState: createState(),
      pipeline: {
        id: 'pipeline-a',
        plan: [{ use: 'first' }, { use: 'second' }],
      },
      requestId: 'request-1',
      services: {},
      signal: new AbortController().signal,
    });

    expect(result.events).toEqual([firstEvent, secondEvent]);
  });
});
