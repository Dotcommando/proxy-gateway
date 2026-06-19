import {
  PIPELINE_DECISION_KIND,
  PIPELINE_PHASE,
  PIPELINE_RESULT_KIND,
  RESPONSE_CODE,
} from '../../constants';
import type {
  GatewayEvent,
  ProxyDecisionState,
  ProxyDecisionStatePatch,
  ProxyExecutionPlan,
  ProxyGatewayServices,
  ProxyPipelineConfig,
  ProxyPipelineDecision,
  ProxyPipelineStepConfig,
  ProxyPipelineStepRegistryPort,
} from '../../ports/outbound';

const PIPELINE_PHASE_ORDER = [
  PIPELINE_PHASE.MATCH,
  PIPELINE_PHASE.ENRICH,
  PIPELINE_PHASE.REQUIRE,
  PIPELINE_PHASE.SELECT,
  PIPELINE_PHASE.RANK,
  PIPELINE_PHASE.PLAN,
  PIPELINE_PHASE.VERIFY,
];

export interface ProxyPipelineEngineInput {
  initialState: ProxyDecisionState;
  pipeline: ProxyPipelineConfig;
  requestId: string;
  services: ProxyGatewayServices;
  signal: AbortSignal;
}

export type ProxyPipelineEngineResult =
  | {
      events: GatewayEvent[];
      kind: PIPELINE_RESULT_KIND.COMPLETED;
      state: ProxyDecisionState;
    }
  | {
      decision: Extract<ProxyPipelineDecision, { kind: PIPELINE_DECISION_KIND.REJECT }>;
      events: GatewayEvent[];
      kind: PIPELINE_RESULT_KIND.REJECTED;
      state: ProxyDecisionState;
    }
  | {
      events: GatewayEvent[];
      kind: PIPELINE_RESULT_KIND.PLAN_SELECTED;
      plan: ProxyExecutionPlan;
      state: ProxyDecisionState;
    }
  | {
      events: GatewayEvent[];
      kind: PIPELINE_RESULT_KIND.SKIPPED;
      reason?: string;
      state: ProxyDecisionState;
    }
  | {
      code: RESPONSE_CODE.PIPELINE_STEP_NOT_FOUND;
      events: GatewayEvent[];
      kind: PIPELINE_RESULT_KIND.STEP_NOT_FOUND;
      message: string;
      state: ProxyDecisionState;
      stepType: string;
    };

export class ProxyPipelineEngine {
  constructor(private readonly stepRegistry: ProxyPipelineStepRegistryPort) {}

  async execute(input: ProxyPipelineEngineInput): Promise<ProxyPipelineEngineResult> {
    let state = input.initialState;
    const events: GatewayEvent[] = [];

    for (const phase of PIPELINE_PHASE_ORDER) {
      const stepConfigs = getPhaseStepConfigs(input.pipeline, phase);

      for (const stepConfig of stepConfigs) {
        const step = this.stepRegistry.get(stepConfig.use);

        if (step === undefined) {
          return {
            code: RESPONSE_CODE.PIPELINE_STEP_NOT_FOUND,
            events,
            kind: PIPELINE_RESULT_KIND.STEP_NOT_FOUND,
            message: `Pipeline step is not registered: ${stepConfig.use}.`,
            state,
            stepType: stepConfig.use,
          };
        }

        const stepResult = await step.execute({
          args: stepConfig.args ?? {},
          requestId: input.requestId,
          services: input.services,
          signal: input.signal,
          state,
        });

        if (stepResult.events !== undefined) {
          events.push(...stepResult.events);
        }
        if (stepResult.statePatch !== undefined) {
          state = applyProxyDecisionStatePatch(state, stepResult.statePatch);
        }

        const decision = stepResult.decision;

        if (decision === undefined || decision.kind === PIPELINE_DECISION_KIND.CONTINUE) {
          continue;
        }
        if (decision.kind === PIPELINE_DECISION_KIND.REJECT) {
          return {
            decision,
            events,
            kind: PIPELINE_RESULT_KIND.REJECTED,
            state,
          };
        }
        if (decision.kind === PIPELINE_DECISION_KIND.USE_PLAN) {
          const nextState = applyProxyDecisionStatePatch(state, {
            plan: decision.plan,
          });

          return {
            events,
            kind: PIPELINE_RESULT_KIND.PLAN_SELECTED,
            plan: decision.plan,
            state: nextState,
          };
        }

        return createSkippedResult(decision, state, events);
      }
    }

    return {
      events,
      kind: PIPELINE_RESULT_KIND.COMPLETED,
      state,
    };
  }
}

export function applyProxyDecisionStatePatch(
  state: ProxyDecisionState,
  patch: ProxyDecisionStatePatch,
): ProxyDecisionState {
  const nextState: ProxyDecisionState = {
    candidates: patch.candidates ?? state.candidates,
    context:
      patch.context === undefined
        ? state.context
        : {
            ...state.context,
            ...patch.context,
          },
    facts:
      patch.facts === undefined
        ? state.facts
        : {
            ...state.facts,
            ...patch.facts,
          },
    metadata:
      patch.metadata === undefined
        ? state.metadata
        : {
            ...state.metadata,
            ...patch.metadata,
          },
    requirements:
      patch.requirements === undefined
        ? state.requirements
        : {
            ...state.requirements,
            ...patch.requirements,
          },
    target: patch.target ?? state.target,
  };
  const nextPlan = patch.plan ?? state.plan;

  if (nextPlan !== undefined) {
    nextState.plan = nextPlan;
  }

  return nextState;
}

function getPhaseStepConfigs(
  pipeline: ProxyPipelineConfig,
  phase: PIPELINE_PHASE,
): ProxyPipelineStepConfig[] {
  switch (phase) {
    case PIPELINE_PHASE.MATCH:
      return pipeline.match ?? [];
    case PIPELINE_PHASE.ENRICH:
      return pipeline.enrich ?? [];
    case PIPELINE_PHASE.REQUIRE:
      return pipeline.require ?? [];
    case PIPELINE_PHASE.SELECT:
      return pipeline.select ?? [];
    case PIPELINE_PHASE.RANK:
      return pipeline.rank ?? [];
    case PIPELINE_PHASE.PLAN:
      return pipeline.plan;
    case PIPELINE_PHASE.VERIFY:
      return pipeline.verify ?? [];
  }
}

function createSkippedResult(
  decision: Extract<ProxyPipelineDecision, { kind: PIPELINE_DECISION_KIND.SKIP_PIPELINE }>,
  state: ProxyDecisionState,
  events: GatewayEvent[],
): ProxyPipelineEngineResult {
  if (decision.reason === undefined) {
    return {
      events,
      kind: PIPELINE_RESULT_KIND.SKIPPED,
      state,
    };
  }

  return {
    events,
    kind: PIPELINE_RESULT_KIND.SKIPPED,
    reason: decision.reason,
    state,
  };
}
