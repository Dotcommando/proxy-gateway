import type { ProxyPipelineStep, ProxyPipelineStepRegistryPort } from '../../ports/outbound';

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
    this.steps.set(step.type, step);
  }
}
