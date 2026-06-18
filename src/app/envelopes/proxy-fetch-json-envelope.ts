import {
  BODY_ENCODING_BASE64,
  BODY_KIND_BASE64,
  BODY_KIND_TEXT,
  RESPONSE_CODE,
  WIRE_PROTOCOL_VERSION,
} from '../../constants';
import type {
  GatewayBody,
  GatewayExecutionContext,
  GatewayTargetRequest,
  GatewayTargetResponse,
} from '../../ports/outbound';
import { GatewayRequestNormalizer } from '../normalization/gateway-request-normalizer';

const NULL_BODY_STATUS_CODES = new Set([204, 205, 304]);
const SPECIAL_RESPONSE_TYPES = new Set<ResponseType>(['error', 'opaque', 'opaqueredirect']);

export interface ParsedProxyFetchRequest {
  target: GatewayTargetRequest;
  context: GatewayExecutionContext;
  options: ProxyFetchRequestOptions;
}

export interface ProxyFetchRequestOptions {
  timeoutMs?: number;
}

export interface ServiceError {
  code: RESPONSE_CODE | string;
  details?: unknown;
  message: string;
  retryable?: boolean;
}

export class ProxyFetchJsonEnvelopeParser {
  readonly #normalizer = new GatewayRequestNormalizer();

  async parse(request: Request): Promise<ParsedProxyFetchRequest> {
    const envelope = parseJsonObject(await request.text());

    if (envelope.version !== WIRE_PROTOCOL_VERSION) {
      throw new Error('Unsupported proxy-fetch envelope version.');
    }

    const requestEnvelope = readRequiredRecord(envelope, 'request');

    return {
      context: normalizeContext(envelope.context),
      options: normalizeOptions(envelope.options),
      target: this.#normalizer.normalize(requestEnvelope),
    };
  }
}

export class ProxyFetchJsonEnvelopeBuilder {
  buildTargetResponse(targetResponse: GatewayTargetResponse): Response {
    return jsonResponse(200, {
      ok: true,
      response: serializeTargetResponse(targetResponse),
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

function normalizeOptions(value: unknown): ProxyFetchRequestOptions {
  if (!isRecord(value)) {
    return {};
  }

  const options: ProxyFetchRequestOptions = {};

  if (typeof value.timeoutMs === 'number' && Number.isFinite(value.timeoutMs)) {
    options.timeoutMs = value.timeoutMs;
  }

  return options;
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
  if (typeof value.consistency === 'string') {
    context.consistency = value.consistency;
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

function serializeTargetResponse(targetResponse: GatewayTargetResponse): {
  body: ReturnType<typeof serializeBody>;
  headers: Array<[string, string]>;
  redirected: boolean;
  status: number;
  statusText: string;
  type: ResponseType;
  url: string;
} {
  const type = targetResponse.type ?? 'basic';
  const isSpecialType = SPECIAL_RESPONSE_TYPES.has(type);

  if (targetResponse.status === 0 && !isSpecialType) {
    throw new Error('Response status 0 requires a special response type.');
  }
  if (isSpecialType) {
    if (
      targetResponse.status !== 0
      || targetResponse.statusText !== ''
      || targetResponse.headers.length !== 0
      || targetResponse.body.kind !== 'none'
    ) {
      throw new Error('Special response types require status 0, empty statusText, no headers, and null body.');
    }
  }

  return {
    body: NULL_BODY_STATUS_CODES.has(targetResponse.status) ? null : serializeBody(targetResponse.body),
    headers: targetResponse.headers,
    redirected: targetResponse.redirected ?? false,
    status: targetResponse.status,
    statusText: targetResponse.statusText,
    type,
    url: targetResponse.url ?? '',
  };
}

function serializeBody(body: GatewayBody): { data: string; kind: typeof BODY_KIND_BASE64 } | { kind: typeof BODY_KIND_TEXT; text: string } | null {
  if (body.kind === 'none') {
    return null;
  }
  if (body.kind === 'text') {
    return {
      kind: BODY_KIND_TEXT,
      text: body.text,
    };
  }
  if (body.kind === 'bytes') {
    return {
      data: Buffer.from(body.bytes).toString(BODY_ENCODING_BASE64),
      kind: BODY_KIND_BASE64,
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
