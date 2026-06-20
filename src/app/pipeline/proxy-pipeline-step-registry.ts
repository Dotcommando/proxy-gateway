import { RESPONSE_CODE } from '../../constants';
import type { ProxyPipelineStep, ProxyPipelineStepRegistryPort } from '../../ports/outbound';

export class ProxyPipelineStepRegistryError extends Error {
  readonly code = RESPONSE_CODE.PIPELINE_STEP_ALREADY_REGISTERED;

  readonly stepType: string;

  constructor(stepType: string) {
    super(`Pipeline step is already registered: ${stepType}.`);
    this.name = 'ProxyPipelineStepRegistryError';
    this.stepType = stepType;
  }
}

export class ProxyPipelineStepRegistry implements ProxyPipelineStepRegistryPort {
  private readonly steps = new Map<string, ProxyPipelineStep>();

  constructor(steps: Iterable<ProxyPipelineStep> = []) {
    for (const step of steps) {
      this.register(step);
    }
  }

  get(type: string): ProxyPipelineStep | undefined {
    return this.steps.get(type);
  }

  register(step: ProxyPipelineStep): void {
    if (this.steps.has(step.type)) {
      throw new ProxyPipelineStepRegistryError(step.type);
    }

    this.steps.set(step.type, step);
  }
}
