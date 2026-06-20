import { PROXY_ATTEMPT_RESULT_OUTCOME, TIMEOUT_OBSERVATION_KIND } from '../../constants';

export interface TimeoutObservation {
  kind: TIMEOUT_OBSERVATION_KIND;
}

export interface TotalTimeoutScopeInput {
  callerSignal: AbortSignal;
  timeoutMs?: number;
}

export interface AttemptTimeoutScopeInput {
  parentSignal: AbortSignal;
  timeoutMs?: number;
}

export class TimeoutScope {
  readonly #abortController = new AbortController();
  #disposed = false;
  #observation: TimeoutObservation | undefined;
  #onParentAbort: (() => void) | undefined;
  #parentSignal: AbortSignal | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;

  get signal(): AbortSignal {
    return this.#abortController.signal;
  }

  get observation(): TimeoutObservation | undefined {
    return this.#observation;
  }

  bindParent(parentSignal: AbortSignal, createObservation: () => TimeoutObservation): void {
    if (this.#disposed) {
      return;
    }
    if (parentSignal.aborted) {
      this.abort(readTimeoutObservation(parentSignal.reason) ?? createObservation());

      return;
    }

    const onParentAbort = (): void => {
      this.abort(readTimeoutObservation(parentSignal.reason) ?? createObservation());
    };

    this.#parentSignal = parentSignal;
    this.#onParentAbort = onParentAbort;
    parentSignal.addEventListener('abort', onParentAbort, {
      once: true,
    });
  }

  bindTimer(timeoutMs: number | undefined, observation: TimeoutObservation): void {
    if (this.#disposed || timeoutMs === undefined) {
      return;
    }

    this.#timer = setTimeout(() => {
      this.abort(observation);
    }, timeoutMs);
  }

  abort(observation: TimeoutObservation): void {
    if (this.#disposed || this.signal.aborted) {
      return;
    }

    this.#observation = observation;
    this.#abortController.abort(observation);
    this.#clearTimer();
    this.#removeParentListener();
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.#clearTimer();
    this.#removeParentListener();
  }

  #clearTimer(): void {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
  }

  #removeParentListener(): void {
    if (this.#parentSignal !== undefined && this.#onParentAbort !== undefined) {
      this.#parentSignal.removeEventListener('abort', this.#onParentAbort);
      this.#parentSignal = undefined;
      this.#onParentAbort = undefined;
    }
  }
}

export class TimeoutController {
  createTotalScope(input: TotalTimeoutScopeInput): TimeoutScope {
    const scope = new TimeoutScope();

    scope.bindParent(input.callerSignal, () => ({
      kind: TIMEOUT_OBSERVATION_KIND.CALLER_ABORTED,
    }));
    scope.bindTimer(input.timeoutMs, {
      kind: TIMEOUT_OBSERVATION_KIND.TOTAL_TIMEOUT,
    });

    return scope;
  }

  createAttemptScope(input: AttemptTimeoutScopeInput): TimeoutScope {
    const scope = new TimeoutScope();

    scope.bindParent(input.parentSignal, () => ({
      kind: TIMEOUT_OBSERVATION_KIND.CALLER_ABORTED,
    }));
    scope.bindTimer(input.timeoutMs, {
      kind: TIMEOUT_OBSERVATION_KIND.ATTEMPT_TIMEOUT,
    });

    return scope;
  }

  async race<T>(operation: Promise<T>, scope: TimeoutScope): Promise<T> {
    if (scope.signal.aborted) {
      throw scope.observation ?? readTimeoutObservation(scope.signal.reason);
    }

    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        reject(scope.observation ?? readTimeoutObservation(scope.signal.reason));
      };

      scope.signal.addEventListener('abort', onAbort, {
        once: true,
      });

      operation.then(
        (value) => {
          scope.signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error: unknown) => {
          scope.signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
  }
}

export function mapTimeoutObservationToOutcome(observation: TimeoutObservation): PROXY_ATTEMPT_RESULT_OUTCOME {
  if (observation.kind === TIMEOUT_OBSERVATION_KIND.TOTAL_TIMEOUT) {
    return PROXY_ATTEMPT_RESULT_OUTCOME.GATEWAY_TIMEOUT;
  }
  if (observation.kind === TIMEOUT_OBSERVATION_KIND.ATTEMPT_TIMEOUT) {
    return PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_TIMEOUT;
  }

  return PROXY_ATTEMPT_RESULT_OUTCOME.ABORTED;
}

export function readTimeoutObservation(value: unknown): TimeoutObservation | undefined {
  if (
    typeof value === 'object'
    && value !== null
    && 'kind' in value
    && isTimeoutObservationKind(value.kind)
  ) {
    return {
      kind: value.kind,
    };
  }

  return undefined;
}

function isTimeoutObservationKind(value: unknown): value is TIMEOUT_OBSERVATION_KIND {
  return (
    value === TIMEOUT_OBSERVATION_KIND.ATTEMPT_TIMEOUT
    || value === TIMEOUT_OBSERVATION_KIND.CALLER_ABORTED
    || value === TIMEOUT_OBSERVATION_KIND.TOTAL_TIMEOUT
  );
}
