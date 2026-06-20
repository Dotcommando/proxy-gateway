import type {
  ProxyPipelineStep,
  ProxyPipelineStepRegistryPort,
} from '../../ports/outbound';
import { createBuiltInPlanSteps } from './built-in-plan-steps';
import { createBuiltInProviderSteps } from './built-in-provider-steps';
import { createBuiltInRequirementSteps } from './built-in-requirement-steps';
import { ProxyPipelineStepRegistry } from './proxy-pipeline-step-registry';

class CompositePipelineStepRegistry implements ProxyPipelineStepRegistryPort {
  constructor(
    private readonly userRegistry: ProxyPipelineStepRegistryPort | undefined,
    private readonly builtInRegistry: ProxyPipelineStepRegistryPort,
  ) {}

  get(type: string): ProxyPipelineStep | undefined {
    return this.userRegistry?.get(type) ?? this.builtInRegistry.get(type);
  }

  register(step: ProxyPipelineStep): void {
    if (this.userRegistry !== undefined) {
      this.userRegistry.register(step);

      return;
    }

    this.builtInRegistry.register(step);
  }
}

export function createBuiltInPipelineStepRegistry(
  userRegistry?: ProxyPipelineStepRegistryPort,
): ProxyPipelineStepRegistryPort {
  return new CompositePipelineStepRegistry(
    userRegistry,
    new ProxyPipelineStepRegistry([
      ...createBuiltInRequirementSteps(),
      ...createBuiltInProviderSteps(),
      ...createBuiltInPlanSteps(),
    ]),
  );
}
