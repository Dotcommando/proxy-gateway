import { RESPONSE_CODE, WIRE_PROTOCOL_VERSION } from '../../constants';
import type {
  GatewayBody,
  GatewayExecutionContext,
  GatewayFetchMetadata,
  GatewayTargetRequest,
  GatewayTargetResponse,
} from '../../ports/outbound';

export interface ParsedProxyFetchRequest {
  target: GatewayTargetRequest;
  context: GatewayExecutionContext;
}

export interface ServiceError {
  code: RESPONSE_CODE;
  message: string;
}

export class ProxyFetchJsonEnvelopeParser {
  async parse(request: Request): Promise<ParsedProxyFetchRequest> {
    const envelope = parseJsonObject(await request.text());

    if (envelope.version !== WIRE_PROTOCOL_VERSION) {
      throw new Error('Unsupported proxy-fetch envelope version.');
    }

    const targetEnvelope = readRequiredRecord(envelope, 'target');
    const target: GatewayTargetRequest = {
      body: normalizeBody(targetEnvelope.body),
      fetch: normalizeFetchMetadata(targetEnvelope.fetch),
      headers: normalizeHeaders(targetEnvelope.headers),
      method: typeof targetEnvelope.method === 'string' ? targetEnvelope.method : 'GET',
      url: readRequiredString(targetEnvelope, 'url', 'target.url'),
    };

    return {
      context: normalizeContext(envelope.context),
      target,
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

function readRequiredString(source: Record<string, unknown>, key: string, label = key): string {
  const value = source[key];

  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Expected ${label} to be a non-empty string.`);
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
  if (value.kind === 'base64') {
    return {
      bytes: decodeBase64Body(value.base64),
      kind: 'bytes',
      replayability: 'replayable',
    };
  }

  throw new Error('Unsupported target body kind.');
}

function decodeBase64Body(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !isValidBase64(value)) {
    throw new Error('Expected target body base64 to be valid base64.');
  }

  return new Uint8Array(Buffer.from(value, 'base64'));
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

  if (isRequestMode(value.mode)) {
    metadata.mode = value.mode;
  }
  if (isRequestCredentials(value.credentials)) {
    metadata.credentials = value.credentials;
  }
  if (isRequestCache(value.cache)) {
    metadata.cache = value.cache;
  }
  if (isRequestRedirect(value.redirect)) {
    metadata.redirect = value.redirect;
  }
  if (typeof value.referrer === 'string') {
    metadata.referrer = value.referrer;
  }
  if (isReferrerPolicy(value.referrerPolicy)) {
    metadata.referrerPolicy = value.referrerPolicy;
  }
  if (typeof value.integrity === 'string') {
    metadata.integrity = value.integrity;
  }
  if (typeof value.keepalive === 'boolean') {
    metadata.keepalive = value.keepalive;
  }
  if (value.duplex === 'half') {
    metadata.duplex = value.duplex;
  }

  return metadata;
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

function isValidBase64(value: string): boolean {
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

function isRequestMode(value: unknown): value is RequestMode {
  return value === 'cors' || value === 'navigate' || value === 'no-cors' || value === 'same-origin';
}

function isRequestCredentials(value: unknown): value is RequestCredentials {
  return value === 'include' || value === 'omit' || value === 'same-origin';
}

function isRequestCache(value: unknown): value is RequestCache {
  return (
    value === 'default'
    || value === 'force-cache'
    || value === 'no-cache'
    || value === 'no-store'
    || value === 'only-if-cached'
    || value === 'reload'
  );
}

function isRequestRedirect(value: unknown): value is RequestRedirect {
  return value === 'error' || value === 'follow' || value === 'manual';
}

function isReferrerPolicy(value: unknown): value is ReferrerPolicy {
  return (
    value === ''
    || value === 'no-referrer'
    || value === 'no-referrer-when-downgrade'
    || value === 'origin'
    || value === 'origin-when-cross-origin'
    || value === 'same-origin'
    || value === 'strict-origin'
    || value === 'strict-origin-when-cross-origin'
    || value === 'unsafe-url'
  );
}
