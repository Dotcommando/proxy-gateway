import { randomUUID } from 'node:crypto';

import { RESPONSE_CODE } from '../../constants';
import type { ProxyGateway } from '../../ports/inbound';
import type {
  GatewayTargetRequest,
  GatewayTargetResponse,
  ProxyAttemptResult,
  ProxyLease,
  ProxyProviderInstance,
} from '../../ports/outbound';
import { BodyBufferManager } from '../buffering/body-buffer-manager';
import { ProxyFetchJsonEnvelopeBuilder, ProxyFetchJsonEnvelopeParser } from '../envelopes/proxy-fetch-json-envelope';
import type { ProxyGatewayOptions } from '../types';

export class HandleProxyFetchRequestUseCase implements ProxyGateway {
  readonly #bodyBufferManager: BodyBufferManager;
  readonly #jsonEnvelopeBuilder = new ProxyFetchJsonEnvelopeBuilder();
  readonly #jsonEnvelopeParser = new ProxyFetchJsonEnvelopeParser();
  readonly #options: ProxyGatewayOptions;

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
      const provider = this.#options.providers.find((candidate) => candidate.enabled !== false);

      if (!provider) {
        return this.#jsonEnvelopeBuilder.buildServiceError(500, {
          code: RESPONSE_CODE.NO_PROVIDER_AVAILABLE,
          message: 'No enabled proxy provider is available.',
        });
      }
      if (!this.#options.transport) {
        return this.#jsonEnvelopeBuilder.buildServiceError(500, {
          code: RESPONSE_CODE.TRANSPORT_NOT_CONFIGURED,
          message: 'No target transport is configured.',
        });
      }

      const requestId = this.#options.random?.createId() ?? randomUUID();
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
        target,
        transport: this.#options.transport,
      });

      if (attemptResponse instanceof Response) {
        return attemptResponse;
      }

      await releaseBestEffort(provider, lease, {
        outcome: 'success',
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

async function executeDirectAttempt(input: {
  bodyBufferManager: BodyBufferManager;
  jsonEnvelopeBuilder: ProxyFetchJsonEnvelopeBuilder;
  lease: ProxyLease;
  provider: ProxyProviderInstance;
  request: Request;
  requestId: string;
  target: GatewayTargetRequest;
  transport: NonNullable<ProxyGatewayOptions['transport']>;
}): Promise<GatewayTargetResponse | Response> {
  try {
    const targetResponse = await input.transport.execute({
      requestId: input.requestId,
      route: input.lease.route,
      signal: input.request.signal,
      target: input.target,
    });

    return await input.bodyBufferManager.bufferResponseBody(targetResponse);
  } catch {
    const result: ProxyAttemptResult = {
      error: {
        code: RESPONSE_CODE.TARGET_TRANSPORT_ERROR,
        message: 'Target transport execution failed.',
      },
      outcome: 'gateway-error',
    };

    await releaseBestEffort(input.provider, input.lease, result);

    return input.jsonEnvelopeBuilder.buildServiceError(502, {
      code: RESPONSE_CODE.TARGET_TRANSPORT_ERROR,
      message: 'Target transport execution failed.',
      retryable: true,
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
