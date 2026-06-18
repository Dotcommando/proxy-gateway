import { randomUUID } from 'node:crypto';

import { RESPONSE_CODE } from '../../constants';
import type { ProxyGateway } from '../../ports/inbound';
import type { ProxyAttemptResult } from '../../ports/outbound';
import { ProxyFetchJsonEnvelopeBuilder, ProxyFetchJsonEnvelopeParser } from '../envelopes/proxy-fetch-json-envelope';
import type { ProxyGatewayOptions } from '../types';

export class HandleProxyFetchRequestUseCase implements ProxyGateway {
  readonly #jsonEnvelopeBuilder = new ProxyFetchJsonEnvelopeBuilder();
  readonly #jsonEnvelopeParser = new ProxyFetchJsonEnvelopeParser();
  readonly #options: ProxyGatewayOptions;

  constructor(options: ProxyGatewayOptions) {
    this.#options = options;
  }

  async handle(request: Request): Promise<Response> {
    try {
      const parsed = await this.#jsonEnvelopeParser.parse(request);
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
        target: parsed.target,
      });
      const targetResponse = await this.#options.transport.execute({
        requestId,
        route: lease.route,
        signal: request.signal,
        target: parsed.target,
      });
      const result: ProxyAttemptResult = {
        outcome: 'success',
        response: targetResponse,
      };

      await provider.adapter.release?.(lease, result);

      return this.#jsonEnvelopeBuilder.buildTargetResponse(targetResponse);
    } catch (error) {
      return this.#jsonEnvelopeBuilder.buildServiceError(400, {
        code: RESPONSE_CODE.INVALID_PROXY_FETCH_REQUEST,
        message: error instanceof Error ? error.message : 'Invalid proxy-fetch request.',
      });
    }
  }
}
