import { randomUUID } from 'node:crypto';

import {
  GATEWAY_TIMEOUT_MESSAGE,
  PROVIDER_SELECTION_RESULT_KIND,
  PROXY_ATTEMPT_RESULT_OUTCOME,
  RESPONSE_CODE,
  TARGET_ACCESS_RESULT_KIND,
} from '../../constants';
import type { ProxyGateway } from '../../ports/inbound';
import type {
  GatewayTargetRequest,
  GatewayTargetResponse,
  ProxyAttemptResult,
  ProxyLease,
  ProxyProviderInstance,
} from '../../ports/outbound';
import { BodyBufferManager } from '../buffering/body-buffer-manager';
import { ResultClassifier } from '../classification';
import { ProxyFetchEnvelopeBuilder, ProxyFetchEnvelopeParser } from '../envelopes/proxy-fetch-json-envelope';
import { RedactionService } from '../redaction';
import { TargetAccessGuard } from '../security';
import {
  mapTimeoutObservationToOutcome,
  readTimeoutObservation,
  TimeoutController,
  type TimeoutObservation,
  type TimeoutScope,
} from '../timeouts';
import type { ProxyGatewayOptions } from '../types';

export class HandleProxyFetchRequestUseCase implements ProxyGateway {
  readonly #bodyBufferManager: BodyBufferManager;
  readonly #envelopeBuilder = new ProxyFetchEnvelopeBuilder();
  readonly #envelopeParser: ProxyFetchEnvelopeParser;
  readonly #options: ProxyGatewayOptions;
  readonly #resultClassifier: ResultClassifier;
  readonly #targetAccessGuard: TargetAccessGuard;
  readonly #timeoutController = new TimeoutController();

  constructor(options: ProxyGatewayOptions) {
    this.#options = options;
    this.#bodyBufferManager = new BodyBufferManager(options.bodyBuffering);
    this.#envelopeParser = new ProxyFetchEnvelopeParser(options.bodyBuffering);
    this.#resultClassifier = new ResultClassifier(new RedactionService(options.redaction));
    this.#targetAccessGuard = new TargetAccessGuard(options.targetAccess);
  }

  async handle(request: Request): Promise<Response> {
    let totalScope: TimeoutScope | undefined;

    try {
      const parsed = await this.#envelopeParser.parse(request);
      const totalTimeoutMs = parsed.options.timeoutMs ?? this.#options.timeouts?.totalTimeoutMs;

      totalScope = this.#timeoutController.createTotalScope({
        callerSignal: request.signal,
        ...(totalTimeoutMs === undefined ? {} : { timeoutMs: totalTimeoutMs }),
      });
      const target = {
        ...parsed.target,
        body: await this.#bodyBufferManager.bufferRequestBody(parsed.target.body),
      };
      const targetAccess = this.#targetAccessGuard.check({ target });

      if (targetAccess.kind === TARGET_ACCESS_RESULT_KIND.REJECTED) {
        return this.#envelopeBuilder.buildServiceError(targetAccess.status, {
          code: targetAccess.code,
          message: targetAccess.message,
          retryable: false,
        });
      }

      const providerSelection = selectProviderInstance(
        this.#options.providers,
        this.#options.providerSelection?.providerInstanceId,
      );

      if (providerSelection.kind === PROVIDER_SELECTION_RESULT_KIND.NONE_ENABLED) {
        return this.#envelopeBuilder.buildServiceError(500, {
          code: RESPONSE_CODE.NO_PROVIDER_AVAILABLE,
          message: 'No enabled proxy provider is available.',
        });
      }
      if (providerSelection.kind === PROVIDER_SELECTION_RESULT_KIND.NOT_FOUND) {
        return this.#envelopeBuilder.buildServiceError(500, {
          code: RESPONSE_CODE.PROVIDER_INSTANCE_NOT_FOUND,
          message: `Provider instance "${providerSelection.providerInstanceId}" was not found or is disabled.`,
        });
      }
      if (!this.#options.transport) {
        return this.#envelopeBuilder.buildServiceError(500, {
          code: RESPONSE_CODE.TRANSPORT_NOT_CONFIGURED,
          message: 'No target transport is configured.',
        });
      }

      const provider = providerSelection.provider;
      const requestId = this.#options.random?.createId() ?? randomUUID();

      await provider.adapter.getCapabilities();

      const attemptTimeoutMs = this.#options.timeouts?.attemptTimeoutMs;
      const attemptScope = this.#timeoutController.createAttemptScope({
        parentSignal: totalScope.signal,
        ...(attemptTimeoutMs === undefined ? {} : { timeoutMs: attemptTimeoutMs }),
      });

      try {
        const lease = await this.#timeoutController.race(
          provider.adapter.acquire({
            attempt: { index: 0 },
            context: parsed.context,
            providerInstanceId: provider.id,
            requestId,
            requirements: {},
            signal: attemptScope.signal,
            target,
          }),
          attemptScope,
        );
        const attemptResponse = await executeDirectAttempt({
          bodyBufferManager: this.#bodyBufferManager,
          envelopeBuilder: this.#envelopeBuilder,
          lease,
          provider,
          requestId,
          resultClassifier: this.#resultClassifier,
          signal: attemptScope.signal,
          target,
          timeoutController: this.#timeoutController,
          timeoutScope: attemptScope,
          transport: this.#options.transport,
        });

        if (attemptResponse instanceof Response) {
          return attemptResponse;
        }

        await releaseBestEffort(provider, lease, {
          outcome: PROXY_ATTEMPT_RESULT_OUTCOME.SUCCESS,
          response: attemptResponse,
        });

        return this.#envelopeBuilder.buildTargetResponse(attemptResponse, request.headers);
      } finally {
        attemptScope.dispose();
      }
    } catch (error) {
      const timeoutObservation = readTimeoutObservation(error);

      if (timeoutObservation !== undefined) {
        return buildTimeoutServiceError(this.#envelopeBuilder, this.#resultClassifier, timeoutObservation);
      }

      return this.#envelopeBuilder.buildServiceError(400, {
        code: RESPONSE_CODE.INVALID_PROXY_FETCH_REQUEST,
        message: error instanceof Error ? error.message : 'Invalid proxy-fetch request.',
      });
    } finally {
      totalScope?.dispose();
    }
  }
}

type ProviderSelectionResult =
  | { kind: PROVIDER_SELECTION_RESULT_KIND.SELECTED; provider: ProxyProviderInstance }
  | { kind: PROVIDER_SELECTION_RESULT_KIND.NOT_FOUND; providerInstanceId: string }
  | { kind: PROVIDER_SELECTION_RESULT_KIND.NONE_ENABLED };

function selectProviderInstance(
  providers: ProxyProviderInstance[],
  providerInstanceId?: string,
): ProviderSelectionResult {
  if (providerInstanceId !== undefined) {
    const provider = providers.find((candidate) => candidate.id === providerInstanceId && candidate.enabled !== false);

    return provider
      ? { kind: PROVIDER_SELECTION_RESULT_KIND.SELECTED, provider }
      : { kind: PROVIDER_SELECTION_RESULT_KIND.NOT_FOUND, providerInstanceId };
  }

  const provider = providers.find((candidate) => candidate.enabled !== false);

  return provider
    ? { kind: PROVIDER_SELECTION_RESULT_KIND.SELECTED, provider }
    : { kind: PROVIDER_SELECTION_RESULT_KIND.NONE_ENABLED };
}

async function executeDirectAttempt(input: {
  bodyBufferManager: BodyBufferManager;
  envelopeBuilder: ProxyFetchEnvelopeBuilder;
  lease: ProxyLease;
  provider: ProxyProviderInstance;
  requestId: string;
  resultClassifier: ResultClassifier;
  signal: AbortSignal;
  target: GatewayTargetRequest;
  timeoutController: TimeoutController;
  timeoutScope: TimeoutScope;
  transport: NonNullable<ProxyGatewayOptions['transport']>;
}): Promise<GatewayTargetResponse | Response> {
  if (input.transport.supportsRoute?.(input.lease.route) === false) {
    const message = `Target transport does not support route kind: ${input.lease.route.kind}.`;
    const classified = input.resultClassifier.classifyFailure({
      message,
      outcome: PROXY_ATTEMPT_RESULT_OUTCOME.UNSUPPORTED_ROUTE,
      route: input.lease.route,
      target: input.target,
    });

    await releaseBestEffort(input.provider, input.lease, classified.attemptResult);

    const serviceError = classified.serviceError;

    return input.envelopeBuilder.buildServiceError(serviceError?.status ?? 502, {
      code: serviceError?.code ?? RESPONSE_CODE.UNSUPPORTED_ROUTE,
      message: serviceError?.message ?? message,
      retryable: serviceError?.retryable ?? false,
    });
  }

  try {
    const targetResponse = await input.timeoutController.race(
      input.transport.execute({
        requestId: input.requestId,
        route: input.lease.route,
        signal: input.signal,
        target: input.target,
      }),
      input.timeoutScope,
    );

    return await input.timeoutController.race(
      input.bodyBufferManager.bufferResponseBody(targetResponse),
      input.timeoutScope,
    );
  } catch (error) {
    const timeoutObservation = readTimeoutObservation(error);

    if (timeoutObservation !== undefined) {
      const classified = input.resultClassifier.classifyFailure({
        outcome: mapTimeoutObservationToOutcome(timeoutObservation),
        route: input.lease.route,
        target: input.target,
      });

      await releaseBestEffort(input.provider, input.lease, classified.attemptResult);

      const serviceError = classified.serviceError;

      return input.envelopeBuilder.buildServiceError(serviceError?.status ?? 504, {
        code: serviceError?.code ?? RESPONSE_CODE.GATEWAY_TIMEOUT,
        message: serviceError?.message ?? GATEWAY_TIMEOUT_MESSAGE,
        retryable: serviceError?.retryable ?? false,
      });
    }

    const classified = input.resultClassifier.classifyFailure({
      message: 'Target transport execution failed.',
      outcome: PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_NETWORK_ERROR,
      route: input.lease.route,
      target: input.target,
    });

    await releaseBestEffort(input.provider, input.lease, classified.attemptResult);

    const serviceError = classified.serviceError;

    return input.envelopeBuilder.buildServiceError(serviceError?.status ?? 502, {
      code: serviceError?.code ?? RESPONSE_CODE.TARGET_TRANSPORT_ERROR,
      message: serviceError?.message ?? 'Target transport execution failed.',
      retryable: serviceError?.retryable ?? true,
    });
  }
}

function buildTimeoutServiceError(
  envelopeBuilder: ProxyFetchEnvelopeBuilder,
  resultClassifier: ResultClassifier,
  timeoutObservation: TimeoutObservation,
): Response {
  const classified = resultClassifier.classifyFailure({
    outcome: mapTimeoutObservationToOutcome(timeoutObservation),
  });
  const serviceError = classified.serviceError;

  return envelopeBuilder.buildServiceError(serviceError?.status ?? 504, {
    code: serviceError?.code ?? RESPONSE_CODE.GATEWAY_TIMEOUT,
    message: serviceError?.message ?? GATEWAY_TIMEOUT_MESSAGE,
    retryable: serviceError?.retryable ?? false,
  });
}

async function releaseBestEffort(
  provider: ProxyProviderInstance,
  lease: ProxyLease,
  result: ProxyAttemptResult,
): Promise<void> {
  try {
    await provider.adapter.release?.(lease, result);
  } catch {
    // Release failures must not mask the attempt result returned to the caller.
  }
}
