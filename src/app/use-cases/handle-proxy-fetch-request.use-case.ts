import type { ProxyGateway } from '../../ports/inbound';
import type {
  GatewayBody,
  GatewayExecutionContext,
  GatewayFetchMetadata,
  GatewayTargetRequest,
  GatewayTargetResponse,
  ProxyAttemptResult,
  ProxyProviderInstance,
  TargetTransportPort,
} from '../../ports/outbound';

export interface ProxyGatewayOptions {
  providers: ProxyProviderInstance[];
  transport?: TargetTransportPort;
}

interface ParsedProxyFetchRequest {
  target: GatewayTargetRequest;
  context: GatewayExecutionContext;
}

interface ServiceError {
  code: string;
  message: string;
}

export function createProxyGateway(options: ProxyGatewayOptions): ProxyGateway {
  return new HandleProxyFetchRequestUseCase(options);
}

class HandleProxyFetchRequestUseCase implements ProxyGateway {
  readonly #options: ProxyGatewayOptions;

  constructor(options: ProxyGatewayOptions) {
    this.#options = options;
  }

  async handle(request: Request): Promise<Response> {
    try {
      const parsed = await parseProxyFetchRequest(request);
      const provider = this.#options.providers.find((candidate) => candidate.enabled !== false);

      if (!provider) {
        return buildServiceErrorResponse(500, {
          code: 'NO_PROVIDER_AVAILABLE',
          message: 'No enabled proxy provider is available.',
        });
      }
      if (!this.#options.transport) {
        return buildServiceErrorResponse(500, {
          code: 'TRANSPORT_NOT_CONFIGURED',
          message: 'No target transport is configured.',
        });
      }

      const requestId = 'request-1';
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

      return buildServiceResponse(targetResponse);
    } catch (error) {
      return buildServiceErrorResponse(400, {
        code: 'INVALID_PROXY_FETCH_REQUEST',
        message: error instanceof Error ? error.message : 'Invalid proxy-fetch request.',
      });
    }
  }
}

async function parseProxyFetchRequest(request: Request): Promise<ParsedProxyFetchRequest> {
  const envelope = parseJsonObject(await request.text());

  if (envelope.version !== 'proxy-fetch.v1') {
    throw new Error('Unsupported proxy-fetch envelope version.');
  }

  const targetEnvelope = readRequiredRecord(envelope, 'target');
  const target: GatewayTargetRequest = {
    body: normalizeBody(targetEnvelope.body),
    fetch: normalizeFetchMetadata(targetEnvelope.fetch),
    headers: normalizeHeaders(targetEnvelope.headers),
    method: typeof targetEnvelope.method === 'string' ? targetEnvelope.method : 'GET',
    url: readRequiredString(targetEnvelope, 'url'),
  };

  return {
    context: normalizeContext(envelope.context),
    target,
  };
}

function parseJsonObject(input: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(input);

  if (!isRecord(parsed)) {
    throw new Error('Expected a JSON object envelope.');
  }

  return parsed;
}

function readRequiredRecord(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key];

  if (!isRecord(value)) {
    throw new Error(`Expected ${key} to be an object.`);
  }

  return value;
}

function readRequiredString(source: Record<string, unknown>, key: string): string {
  const value = source[key];

  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Expected ${key} to be a non-empty string.`);
  }

  return value;
}

function normalizeBody(value: unknown): GatewayBody {
  if (value === null || value === undefined) {
    return {
      kind: 'none',
      replayability: 'replayable',
    };
  }
  if (!isRecord(value)) {
    throw new Error('Expected target body to be null or an object.');
  }
  if (value.kind === 'text' && typeof value.text === 'string') {
    return {
      kind: 'text',
      replayability: 'replayable',
      text: value.text,
    };
  }

  throw new Error('Unsupported target body kind.');
}

function normalizeHeaders(value: unknown): Array<[string, string]> {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('Expected target headers to be an array.');
  }

  return value.map((entry) => {
    if (
      !Array.isArray(entry)
      || entry.length !== 2
      || typeof entry[0] !== 'string'
      || typeof entry[1] !== 'string'
    ) {
      throw new Error('Expected each target header to be a string pair.');
    }

    return [entry[0], entry[1]];
  });
}

function normalizeFetchMetadata(value: unknown): GatewayFetchMetadata {
  if (!isRecord(value)) {
    return {};
  }

  const metadata: GatewayFetchMetadata = {};

  if (isRequestRedirect(value.redirect)) {
    metadata.redirect = value.redirect;
  }

  return metadata;
}

function normalizeContext(value: unknown): GatewayExecutionContext {
  if (!isRecord(value)) {
    return {};
  }

  const context: GatewayExecutionContext = {};

  if (typeof value.tenantId === 'string') {
    context.tenantId = value.tenantId;
  }

  return context;
}

function buildServiceResponse(targetResponse: GatewayTargetResponse): Response {
  return jsonResponse(200, {
    ok: true,
    response: {
      body: serializeBody(targetResponse.body),
      headers: targetResponse.headers,
      status: targetResponse.status,
      statusText: targetResponse.statusText,
    },
    version: 'proxy-fetch.v1',
  });
}

function buildServiceErrorResponse(status: number, error: ServiceError): Response {
  return jsonResponse(status, {
    error,
    ok: false,
    version: 'proxy-fetch.v1',
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    status,
  });
}

function serializeBody(body: GatewayBody): { kind: 'text'; text: string } | null {
  if (body.kind === 'none') {
    return null;
  }
  if (body.kind === 'text') {
    return {
      kind: 'text',
      text: body.text,
    };
  }

  throw new Error('Unsupported response body kind.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequestRedirect(value: unknown): value is RequestRedirect {
  return value === 'error' || value === 'follow' || value === 'manual';
}
