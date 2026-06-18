import { RESPONSE_CODE, WIRE_PROTOCOL_VERSION } from '../../constants';
import type {
  GatewayBody,
  GatewayExecutionContext,
  GatewayTargetRequest,
  GatewayTargetResponse,
} from '../../ports/outbound';
import { GatewayRequestNormalizer } from '../normalization/gateway-request-normalizer';

export interface ParsedProxyFetchRequest {
  target: GatewayTargetRequest;
  context: GatewayExecutionContext;
}

export interface ServiceError {
  code: RESPONSE_CODE;
  message: string;
}

export class ProxyFetchJsonEnvelopeParser {
  readonly #normalizer = new GatewayRequestNormalizer();

  async parse(request: Request): Promise<ParsedProxyFetchRequest> {
    const envelope = parseJsonObject(await request.text());

    if (envelope.version !== WIRE_PROTOCOL_VERSION) {
      throw new Error('Unsupported proxy-fetch envelope version.');
    }

    const targetEnvelope = readRequiredRecord(envelope, 'target');

    return {
      context: normalizeContext(envelope.context),
      target: this.#normalizer.normalize(targetEnvelope),
    };
  }
}

export class ProxyFetchJsonEnvelopeBuilder {
  buildTargetResponse(targetResponse: GatewayTargetResponse): Response {
    return jsonResponse(200, {
      ok: true,
      response: {
        body: serializeBody(targetResponse.body),
        headers: targetResponse.headers,
        status: targetResponse.status,
        statusText: targetResponse.statusText,
      },
      version: WIRE_PROTOCOL_VERSION,
    });
  }

  buildServiceError(status: number, error: ServiceError): Response {
    return jsonResponse(status, {
      error,
      ok: false,
      version: WIRE_PROTOCOL_VERSION,
    });
  }
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

function normalizeContext(value: unknown): GatewayExecutionContext {
  if (!isRecord(value)) {
    return {};
  }

  const context: GatewayExecutionContext = {};
  const metadata = value.metadata;

  if (typeof value.tenantId === 'string') {
    context.tenantId = value.tenantId;
  }
  if (typeof value.useCase === 'string') {
    context.useCase = value.useCase;
  }
  if (typeof value.flowKey === 'string') {
    context.flowKey = value.flowKey;
  }
  if (typeof value.routeKey === 'string') {
    context.routeKey = value.routeKey;
  }
  if (typeof value.marketCountry === 'string') {
    context.marketCountry = value.marketCountry;
  }
  if (isRecord(metadata)) {
    context.metadata = metadata;
  }

  return context;
}

function serializeBody(body: GatewayBody): { base64: string; kind: 'base64' } | { kind: 'text'; text: string } | null {
  if (body.kind === 'none') {
    return null;
  }
  if (body.kind === 'text') {
    return {
      kind: 'text',
      text: body.text,
    };
  }
  if (body.kind === 'bytes') {
    return {
      base64: Buffer.from(body.bytes).toString('base64'),
      kind: 'base64',
    };
  }

  throw new Error('Unsupported response body kind.');
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    status,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
