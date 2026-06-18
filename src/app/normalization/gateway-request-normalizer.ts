import type { GatewayBody, GatewayFetchMetadata, GatewayTargetRequest } from '../../ports/outbound';

const BODY_FRAMING_HEADERS = new Set(['content-length', 'transfer-encoding']);

export class GatewayRequestNormalizer {
  normalize(requestEnvelope: Record<string, unknown>): GatewayTargetRequest {
    return {
      body: normalizeBody(requestEnvelope.body),
      fetch: normalizeFetchMetadata(requestEnvelope),
      headers: normalizeHeaders(requestEnvelope.headers),
      method: typeof requestEnvelope.method === 'string' ? requestEnvelope.method : 'GET',
      url: readRequiredString(requestEnvelope, 'url', 'request.url'),
    };
  }
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
    throw new Error('Expected request body to be null or an object.');
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
      bytes: decodeBase64Body(value.data),
      kind: 'bytes',
      replayability: 'replayable',
    };
  }
  if (value.kind === 'binary') {
    throw new Error('Binary request bodies must use multipart service transport.');
  }

  throw new Error('Unsupported request body kind.');
}

function decodeBase64Body(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !isValidBase64(value)) {
    throw new Error('Expected request body data to be valid base64.');
  }

  return new Uint8Array(Buffer.from(value, 'base64'));
}

function normalizeHeaders(value: unknown): Array<[string, string]> {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('Expected request headers to be an array.');
  }

  const headers: Array<[string, string]> = [];

  for (const entry of value) {
    if (
      !Array.isArray(entry)
      || entry.length !== 2
      || typeof entry[0] !== 'string'
      || typeof entry[1] !== 'string'
    ) {
      throw new Error('Expected each request header to be a string pair.');
    }

    const name = entry[0];
    const normalizedName = name.toLowerCase();

    if (!BODY_FRAMING_HEADERS.has(normalizedName)) {
      headers.push([name, entry[1]]);
    }
  }

  return headers;
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
