import { PLANNER_RESULT_KIND, PROXY_DNS_MODE, PROXY_PLAN_KIND, RESPONSE_CODE, RETRY_CONDITION } from '../../constants';
import type {
  ProxyExecutionAttempt,
  ProxyExecutionPlan,
  ProxyProviderCapabilities,
  ProxyProviderInstance,
  ProxyRouteRequirements,
} from '../../ports/outbound';

export interface ExecutionPlannerOptions {
  providers: ProxyProviderInstance[];
}

export interface ProxyPlanAttemptConfig {
  maxAttempts?: number;
  metadata?: Record<string, unknown>;
  provider?: string;
  requirements?: ProxyRouteRequirements;
  retryOn?: RETRY_CONDITION[];
  timeoutMs?: number;
}

export interface ProxyFallbackPlanConfig {
  attempts: ProxyPlanAttemptConfig[];
  kind: PROXY_PLAN_KIND.FALLBACK;
  metadata?: Record<string, unknown>;
  stopOnTargetHttpError?: boolean;
  totalTimeoutMs?: number;
}

export type ProxyPlanConfig = ProxyFallbackPlanConfig;

export interface ExecutionPlannerInput {
  plan: ProxyPlanConfig;
}

export type ExecutionPlannerResult =
  | {
      kind: PLANNER_RESULT_KIND.PLANNED;
      plan: ProxyExecutionPlan;
    }
  | {
      code: RESPONSE_CODE.NO_PLANNABLE_PROVIDER | RESPONSE_CODE.PROVIDER_INSTANCE_NOT_FOUND;
      kind: PLANNER_RESULT_KIND.REJECTED;
      message: string;
    };

interface ProviderWithCapabilities {
  capabilities: ProxyProviderCapabilities;
  provider: ProxyProviderInstance;
}

type ProviderSelectionResult =
  | Extract<ExecutionPlannerResult, { kind: PLANNER_RESULT_KIND.REJECTED }>
  | ProviderWithCapabilities;

export class ExecutionPlanner {
  readonly #providers: ProxyProviderInstance[];

  constructor(options: ExecutionPlannerOptions) {
    this.#providers = options.providers;
  }

  async plan(input: ExecutionPlannerInput): Promise<ExecutionPlannerResult> {
    const capabilitySnapshots = new Map<string, Promise<ProxyProviderCapabilities>>();
    const attempts: ProxyExecutionAttempt[] = [];

    for (const attemptConfig of input.plan.attempts) {
      const providerSelection = await this.#selectProvider(attemptConfig, capabilitySnapshots);

      if (isRejectedPlannerResult(providerSelection)) {
        return providerSelection;
      }

      attempts.push(createExecutionAttempt(attemptConfig, providerSelection));
    }

    const plan: ProxyExecutionPlan = {
      attempts,
      kind: input.plan.kind,
    };

    if (input.plan.metadata !== undefined) {
      plan.metadata = input.plan.metadata;
    }
    if (input.plan.stopOnTargetHttpError !== undefined) {
      plan.stopOnTargetHttpError = input.plan.stopOnTargetHttpError;
    }
    if (input.plan.totalTimeoutMs !== undefined) {
      plan.totalTimeoutMs = input.plan.totalTimeoutMs;
    }

    return {
      kind: PLANNER_RESULT_KIND.PLANNED,
      plan,
    };
  }

  async #selectProvider(
    attemptConfig: ProxyPlanAttemptConfig,
    capabilitySnapshots: Map<string, Promise<ProxyProviderCapabilities>>,
  ): Promise<ProviderSelectionResult> {
    if (attemptConfig.provider !== undefined) {
      const provider = this.#providers.find(
        (candidate) => candidate.id === attemptConfig.provider && candidate.enabled !== false,
      );

      if (provider === undefined) {
        return providerNotFound(attemptConfig.provider);
      }

      const capabilities = await getCapabilities(provider, capabilitySnapshots);

      return satisfiesRequirements(capabilities, attemptConfig.requirements)
        ? { capabilities, provider }
        : noPlannableProvider();
    }

    const candidateIds = attemptConfig.requirements?.providerInstanceIds;

    if (candidateIds !== undefined) {
      const missingProviderId = candidateIds.find(
        (providerId) =>
          !this.#providers.some((candidate) => candidate.id === providerId && candidate.enabled !== false),
      );

      if (missingProviderId !== undefined) {
        return providerNotFound(missingProviderId);
      }
    }

    const candidates = this.#providers.filter((provider) => {
      if (provider.enabled === false) {
        return false;
      }
      if (candidateIds !== undefined && !candidateIds.includes(provider.id)) {
        return false;
      }
      if (attemptConfig.requirements?.excludeProviderInstanceIds?.includes(provider.id) === true) {
        return false;
      }

      return true;
    });

    for (const provider of candidates) {
      const capabilities = await getCapabilities(provider, capabilitySnapshots);

      if (satisfiesRequirements(capabilities, attemptConfig.requirements)) {
        return {
          capabilities,
          provider,
        };
      }
    }

    return noPlannableProvider();
  }
}

function createExecutionAttempt(
  attemptConfig: ProxyPlanAttemptConfig,
  selection: ProviderWithCapabilities,
): ProxyExecutionAttempt {
  const attempt: ProxyExecutionAttempt = {
    capabilities: selection.capabilities,
    providerInstanceId: selection.provider.id,
    providerKind: selection.provider.adapter.kind,
  };

  if (attemptConfig.maxAttempts !== undefined) {
    attempt.maxAttempts = attemptConfig.maxAttempts;
  }
  if (attemptConfig.metadata !== undefined) {
    attempt.metadata = attemptConfig.metadata;
  }
  if (attemptConfig.requirements !== undefined) {
    attempt.requirements = attemptConfig.requirements;
  }
  if (attemptConfig.retryOn !== undefined) {
    attempt.retryOn = attemptConfig.retryOn;
  }
  if (attemptConfig.timeoutMs !== undefined) {
    attempt.timeoutMs = attemptConfig.timeoutMs;
  }

  return attempt;
}

async function getCapabilities(
  provider: ProxyProviderInstance,
  capabilitySnapshots: Map<string, Promise<ProxyProviderCapabilities>>,
): Promise<ProxyProviderCapabilities> {
  const cachedSnapshot = capabilitySnapshots.get(provider.id);

  if (cachedSnapshot !== undefined) {
    return cachedSnapshot;
  }

  const snapshot = Promise.resolve(provider.adapter.getCapabilities());

  capabilitySnapshots.set(provider.id, snapshot);

  return snapshot;
}

function satisfiesRequirements(
  capabilities: ProxyProviderCapabilities,
  requirements: ProxyRouteRequirements | undefined,
): boolean {
  if (requirements === undefined) {
    return true;
  }
  if (
    requirements.protocols !== undefined
    && capabilities.protocols !== undefined
    && !hasIntersection(requirements.protocols, capabilities.protocols)
  ) {
    return false;
  }
  if (
    requirements.networkTypes !== undefined
    && capabilities.networkTypes !== undefined
    && !hasIntersection(requirements.networkTypes, capabilities.networkTypes)
  ) {
    return false;
  }
  if (
    requirements.dns?.resolution !== undefined
    && capabilities.dns?.modes !== undefined
    && !capabilities.dns.modes.some((mode) => dnsModeSatisfies(mode, requirements.dns!.resolution))
  ) {
    return false;
  }

  return true;
}

function hasIntersection(left: string[], right: string[]): boolean {
  return left.some((leftValue) => right.includes(leftValue));
}

function dnsModeSatisfies(capabilityMode: string, requiredMode: string): boolean {
  return (
    requiredMode === PROXY_DNS_MODE.ANY
    || capabilityMode === PROXY_DNS_MODE.ANY
    || capabilityMode === requiredMode
  );
}

function providerNotFound(
  providerInstanceId: string,
): Extract<ExecutionPlannerResult, { kind: PLANNER_RESULT_KIND.REJECTED }> {
  return {
    code: RESPONSE_CODE.PROVIDER_INSTANCE_NOT_FOUND,
    kind: PLANNER_RESULT_KIND.REJECTED,
    message: `Provider instance "${providerInstanceId}" was not found or is disabled.`,
  };
}

function noPlannableProvider(): Extract<ExecutionPlannerResult, { kind: PLANNER_RESULT_KIND.REJECTED }> {
  return {
    code: RESPONSE_CODE.NO_PLANNABLE_PROVIDER,
    kind: PLANNER_RESULT_KIND.REJECTED,
    message: 'No provider can satisfy the plan attempt requirements.',
  };
}

function isRejectedPlannerResult(
  result: ProviderSelectionResult,
): result is Extract<ExecutionPlannerResult, { kind: PLANNER_RESULT_KIND.REJECTED }> {
  return 'code' in result;
}
