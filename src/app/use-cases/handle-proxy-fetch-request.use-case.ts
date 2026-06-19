import { randomUUID } from 'node:crypto';

import { PROVIDER_SELECTION_RESULT_KIND, PROXY_ATTEMPT_RESULT_OUTCOME, RESPONSE_CODE } from '../../constants';
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
import { ProxyFetchJsonEnvelopeBuilder, ProxyFetchJsonEnvelopeParser } from '../envelopes/proxy-fetch-json-envelope';
import type { ProxyGatewayOptions } from '../types';

export class HandleProxyFetchRequestUseCase implements ProxyGateway {
  readonly #bodyBufferManager: BodyBufferManager;
  readonly #jsonEnvelopeBuilder = new ProxyFetchJsonEnvelopeBuilder();
  readonly #jsonEnvelopeParser = new ProxyFetchJsonEnvelopeParser();
  readonly #options: ProxyGatewayOptions;
  readonly #resultClassifier = new ResultClassifier();

  constructor(options: ProxyGatewayOptions) {
    this.#options = options;
    this.#bodyBufferManager = new BodyBufferManager(options.bodyBuffering);
  }

  async handle(request: Request): Promise<Response> {
    try {
      const parsed = await this.#jsonEnvelopeParser.parse(request);
      const target = {
        ...parsed.target,
        body: await this.#bodyBufferManager.bufferRequestBody(parsed.target.body),
      };
      const providerSelection = selectProviderInstance(
        this.#options.providers,
        this.#options.providerSelection?.providerInstanceId,
      );

      if (providerSelection.kind === PROVIDER_SELECTION_RESULT_KIND.NONE_ENABLED) {
        return this.#jsonEnvelopeBuilder.buildServiceError(500, {
          code: RESPONSE_CODE.NO_PROVIDER_AVAILABLE,
          message: 'No enabled proxy provider is available.',
        });
      }
      if (providerSelection.kind === PROVIDER_SELECTION_RESULT_KIND.NOT_FOUND) {
        return this.#jsonEnvelopeBuilder.buildServiceError(500, {
          code: RESPONSE_CODE.PROVIDER_INSTANCE_NOT_FOUND,
          message: `Provider instance "${providerSelection.providerInstanceId}" was not found or is disabled.`,
        });
      }
      if (!this.#options.transport) {
        return this.#jsonEnvelopeBuilder.buildServiceError(500, {
          code: RESPONSE_CODE.TRANSPORT_NOT_CONFIGURED,
          message: 'No target transport is configured.',
        });
      }

      const provider = providerSelection.provider;
      const requestId = this.#options.random?.createId() ?? randomUUID();

      await provider.adapter.getCapabilities();

      const lease = await provider.adapter.acquire({
        attempt: { index: 0 },
        context: parsed.context,
        providerInstanceId: provider.id,
        requestId,
        requirements: {},
        signal: request.signal,
        target,
      });
      const attemptResponse = await executeDirectAttempt({
        bodyBufferManager: this.#bodyBufferManager,
        jsonEnvelopeBuilder: this.#jsonEnvelopeBuilder,
        lease,
        provider,
        request,
        requestId,
        resultClassifier: this.#resultClassifier,
        target,
        transport: this.#options.transport,
      });

      if (attemptResponse instanceof Response) {
        return attemptResponse;
      }

      await releaseBestEffort(provider, lease, {
        outcome: PROXY_ATTEMPT_RESULT_OUTCOME.SUCCESS,
        response: attemptResponse,
      });

      return this.#jsonEnvelopeBuilder.buildTargetResponse(attemptResponse);
    } catch (error) {
      return this.#jsonEnvelopeBuilder.buildServiceError(400, {
        code: RESPONSE_CODE.INVALID_PROXY_FETCH_REQUEST,
        message: error instanceof Error ? error.message : 'Invalid proxy-fetch request.',
      });
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
  jsonEnvelopeBuilder: ProxyFetchJsonEnvelopeBuilder;
  lease: ProxyLease;
  provider: ProxyProviderInstance;
  request: Request;
  requestId: string;
  resultClassifier: ResultClassifier;
  target: GatewayTargetRequest;
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

    return input.jsonEnvelopeBuilder.buildServiceError(serviceError?.status ?? 502, {
      code: serviceError?.code ?? RESPONSE_CODE.UNSUPPORTED_ROUTE,
      message: serviceError?.message ?? message,
      retryable: serviceError?.retryable ?? false,
    });
  }

  try {
    const targetResponse = await input.transport.execute({
      requestId: input.requestId,
      route: input.lease.route,
      signal: input.request.signal,
      target: input.target,
    });

    return await input.bodyBufferManager.bufferResponseBody(targetResponse);
  } catch {
    const classified = input.resultClassifier.classifyFailure({
      message: 'Target transport execution failed.',
      outcome: PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_NETWORK_ERROR,
      route: input.lease.route,
      target: input.target,
    });

    await releaseBestEffort(input.provider, input.lease, classified.attemptResult);

    const serviceError = classified.serviceError;

    return input.jsonEnvelopeBuilder.buildServiceError(serviceError?.status ?? 502, {
      code: serviceError?.code ?? RESPONSE_CODE.TARGET_TRANSPORT_ERROR,
      message: serviceError?.message ?? 'Target transport execution failed.',
      retryable: serviceError?.retryable ?? true,
    });
  }
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
