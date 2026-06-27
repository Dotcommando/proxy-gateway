import { randomUUID } from 'node:crypto';

import {
  ACCEPT_HEADER_NAME,
  BINARY_BODY_PART_NAME,
  BODY_ENCODING_BASE64,
  BODY_KIND_BASE64,
  BODY_KIND_BINARY,
  BODY_KIND_TEXT,
  CONTENT_TYPE_HEADER_NAME,
  JSON_CONTENT_TYPE,
  METADATA_PART_NAME,
  MULTIPART_BOUNDARY_PREFIX,
  MULTIPART_CONTENT_TYPE_PREFIX,
  MULTIPART_CRLF,
  MULTIPART_HEADER_SEPARATOR,
  OCTET_STREAM_CONTENT_TYPE,
  RESPONSE_CODE,
  WIRE_PROTOCOL_VERSION,
} from '../../constants';
import type {
  GatewayBody,
  GatewayExecutionContext,
  GatewayTargetRequest,
  GatewayTargetResponse,
} from '../../ports/outbound';
import { DEFAULT_BODY_BUFFERING_POLICY } from '../buffering/body-buffer-manager';
import { GatewayRequestNormalizer } from '../normalization/gateway-request-normalizer';
import type { BodyBufferingPolicy } from '../types';

const NULL_BODY_STATUS_CODES = new Set([204, 205, 304]);
const SPECIAL_RESPONSE_TYPES = new Set<ResponseType>(['error', 'opaque', 'opaqueredirect']);
const BODY_FRAMING_HEADERS = new Set(['content-length', 'transfer-encoding']);

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
  readonly #policy: BodyBufferingPolicy;

  constructor(bodyBuffering: Partial<BodyBufferingPolicy> = {}) {
    this.#policy = {
      ...DEFAULT_BODY_BUFFERING_POLICY,
      ...bodyBuffering,
    };
  }

  async parse(request: Request): Promise<ParsedProxyFetchRequest> {
    const bodyBytes = await readRequestBodyWithLimit(
      request,
      this.#policy.maxBufferedRequestBodyBytes,
      'JSON',
    );

    return parseJsonEnvelope(parseJsonObject(Buffer.from(bodyBytes).toString('utf8')), this.#normalizer);
  }
}

export class ProxyFetchEnvelopeParser {
  readonly #jsonParser: ProxyFetchJsonEnvelopeParser;
  readonly #multipartParser: ProxyFetchMultipartEnvelopeParser;

  constructor(bodyBuffering: Partial<BodyBufferingPolicy> = {}) {
    this.#jsonParser = new ProxyFetchJsonEnvelopeParser(bodyBuffering);
    this.#multipartParser = new ProxyFetchMultipartEnvelopeParser(bodyBuffering);
  }

  async parse(request: Request): Promise<ParsedProxyFetchRequest> {
    const contentType = request.headers.get(CONTENT_TYPE_HEADER_NAME) ?? '';

    if (isJsonContentType(contentType)) {
      return this.#jsonParser.parse(request);
    }
    if (isMultipartContentType(contentType)) {
      return this.#multipartParser.parse(request, contentType);
    }

    throw new Error('Unsupported proxy-fetch request content type.');
  }
}

export class ProxyFetchMultipartEnvelopeParser {
  readonly #normalizer = new GatewayRequestNormalizer();
  readonly #policy: BodyBufferingPolicy;

  constructor(bodyBuffering: Partial<BodyBufferingPolicy> = {}) {
    this.#policy = {
      ...DEFAULT_BODY_BUFFERING_POLICY,
      ...bodyBuffering,
    };
  }

  async parse(request: Request, contentType = request.headers.get(CONTENT_TYPE_HEADER_NAME) ?? ''): Promise<ParsedProxyFetchRequest> {
    const boundary = readMultipartBoundary(contentType);
    const bodyBytes = await readRequestBodyWithLimit(
      request,
      this.#policy.maxBufferedRequestBodyBytes,
      'Multipart',
    );
    const parts = parseMultipartParts(bodyBytes, boundary);

    if (parts.length !== 2) {
      throw new Error('Expected multipart request to contain exactly meta and body parts.');
    }
    if (parts[0]?.name !== METADATA_PART_NAME || parts[1]?.name !== BINARY_BODY_PART_NAME) {
      throw new Error('Expected multipart request parts to be ordered as meta then body.');
    }

    const envelope = parseJsonObject(Buffer.from(parts[0].body).toString('utf8'));
    const requestEnvelope = readRequiredRecord(envelope, 'request');
    const bodyReference = readRequiredRecord(requestEnvelope, 'body');

    if (bodyReference.kind !== BODY_KIND_BINARY || bodyReference.partName !== BINARY_BODY_PART_NAME) {
      throw new Error('Expected multipart request body to reference the body part.');
    }

    const target = this.#normalizer.normalize({
      ...requestEnvelope,
      body: null,
    });

    return {
      context: normalizeContext(envelope.context),
      options: normalizeOptions(envelope.options),
      target: {
        ...target,
        body: {
          bytes: parts[1].body,
          kind: 'bytes',
          replayability: 'replayable',
        },
      },
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

export class ProxyFetchEnvelopeBuilder {
  readonly #jsonBuilder = new ProxyFetchJsonEnvelopeBuilder();

  buildTargetResponse(targetResponse: GatewayTargetResponse, serviceHeaders: Headers = new Headers()): Response {
    const format = selectServiceResponseFormat(targetResponse, serviceHeaders);

    if (format === SERVICE_RESPONSE_FORMAT.UNSUPPORTED) {
      return this.buildServiceError(406, {
        code: RESPONSE_CODE.INVALID_PROXY_FETCH_REQUEST,
        message: 'Service response content negotiation failed.',
        retryable: false,
      });
    }
    if (format === SERVICE_RESPONSE_FORMAT.MULTIPART) {
      return multipartTargetResponse(targetResponse);
    }

    return this.#jsonBuilder.buildTargetResponse(targetResponse);
  }

  buildServiceError(status: number, error: ServiceError): Response {
    return this.#jsonBuilder.buildServiceError(status, error);
  }
}

function parseJsonObject(input: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(input);

  if (!isRecord(parsed)) {
    throw new Error('Expected a JSON object envelope.');
  }

  return parsed;
}

function parseJsonEnvelope(
  envelope: Record<string, unknown>,
  normalizer: GatewayRequestNormalizer,
): ParsedProxyFetchRequest {
  if (envelope.version !== WIRE_PROTOCOL_VERSION) {
    throw new Error('Unsupported proxy-fetch envelope version.');
  }

  const requestEnvelope = readRequiredRecord(envelope, 'request');

  return {
    context: normalizeContext(envelope.context),
    options: normalizeOptions(envelope.options),
    target: normalizer.normalize(requestEnvelope),
  };
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

type SerializedResponseBody =
  | { data: string; kind: typeof BODY_KIND_BASE64 }
  | { kind: typeof BODY_KIND_BINARY; partName: typeof BINARY_BODY_PART_NAME }
  | { kind: typeof BODY_KIND_TEXT; text: string }
  | null;

function serializeTargetResponse(
  targetResponse: GatewayTargetResponse,
  bodyOverride?: SerializedResponseBody,
): {
  body: SerializedResponseBody;
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
    body: NULL_BODY_STATUS_CODES.has(targetResponse.status) ? null : (bodyOverride ?? serializeBody(targetResponse.body)),
    headers: sanitizeTargetResponseHeaders(targetResponse.headers),
    redirected: targetResponse.redirected ?? false,
    status: targetResponse.status,
    statusText: targetResponse.statusText,
    type,
    url: targetResponse.url ?? '',
  };
}

function serializeBody(body: GatewayBody): Exclude<SerializedResponseBody, { kind: typeof BODY_KIND_BINARY }> {
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

enum SERVICE_RESPONSE_FORMAT {
  JSON = 'json',
  MULTIPART = 'multipart',
  UNSUPPORTED = 'unsupported',
}

function selectServiceResponseFormat(
  targetResponse: GatewayTargetResponse,
  serviceHeaders: Headers,
): SERVICE_RESPONSE_FORMAT {
  if (targetResponse.body.kind !== 'bytes' || NULL_BODY_STATUS_CODES.has(targetResponse.status)) {
    return SERVICE_RESPONSE_FORMAT.JSON;
  }

  const acceptHeader = serviceHeaders.get(ACCEPT_HEADER_NAME);

  if (acceptHeader === null || acceptHeader.trim() === '') {
    return SERVICE_RESPONSE_FORMAT.JSON;
  }

  const accepts = parseAcceptHeader(acceptHeader);
  const acceptsJson = accepts.includes(JSON_CONTENT_TYPE) || accepts.includes('*/*') || accepts.includes('application/*');
  const acceptsMultipart = accepts.includes(MULTIPART_CONTENT_TYPE_PREFIX) || accepts.includes('*/*') || accepts.includes('multipart/*');

  if (acceptsMultipart) {
    return SERVICE_RESPONSE_FORMAT.MULTIPART;
  }
  if (acceptsJson) {
    return SERVICE_RESPONSE_FORMAT.JSON;
  }

  return SERVICE_RESPONSE_FORMAT.UNSUPPORTED;
}

function parseAcceptHeader(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .filter((entry) => !entry.split(';').slice(1).some((parameter) => parameter.trim() === 'q=0'))
    .map((entry) => entry.split(';', 1)[0]?.trim().toLowerCase())
    .filter((entry): entry is string => entry !== undefined && entry !== '');
}

function multipartTargetResponse(targetResponse: GatewayTargetResponse): Response {
  if (targetResponse.body.kind !== 'bytes') {
    return new ProxyFetchJsonEnvelopeBuilder().buildTargetResponse(targetResponse);
  }

  const boundary = `proxy-gateway-response-${randomUUID()}`;
  const metaEnvelope = {
    ok: true,
    response: serializeTargetResponse(targetResponse, {
      kind: BODY_KIND_BINARY,
      partName: BINARY_BODY_PART_NAME,
    }),
    version: WIRE_PROTOCOL_VERSION,
  };
  const body = Buffer.concat([
    multipartResponsePart({
      body: new TextEncoder().encode(JSON.stringify(metaEnvelope)),
      boundary,
      contentType: JSON_CONTENT_TYPE,
      name: METADATA_PART_NAME,
    }),
    multipartResponsePart({
      body: targetResponse.body.bytes,
      boundary,
      contentType: OCTET_STREAM_CONTENT_TYPE,
      filename: BINARY_BODY_PART_NAME,
      name: BINARY_BODY_PART_NAME,
    }),
    Buffer.from(`${MULTIPART_BOUNDARY_PREFIX}${boundary}${MULTIPART_BOUNDARY_PREFIX}${MULTIPART_CRLF}`, 'utf8'),
  ]);

  return new Response(body, {
    headers: {
      [CONTENT_TYPE_HEADER_NAME]: `${MULTIPART_CONTENT_TYPE_PREFIX}; boundary=${boundary}`,
    },
    status: 200,
  });
}

function multipartResponsePart(input: {
  body: Uint8Array;
  boundary: string;
  contentType: string;
  filename?: string;
  name: string;
}): Buffer {
  const disposition = input.filename === undefined
    ? `Content-Disposition: form-data; name="${input.name}"`
    : `Content-Disposition: form-data; name="${input.name}"; filename="${input.filename}"`;

  return Buffer.concat([
    Buffer.from(`${MULTIPART_BOUNDARY_PREFIX}${input.boundary}${MULTIPART_CRLF}`, 'utf8'),
    Buffer.from(`${disposition}${MULTIPART_CRLF}Content-Type: ${input.contentType}${MULTIPART_HEADER_SEPARATOR}`, 'utf8'),
    Buffer.from(input.body),
    Buffer.from(MULTIPART_CRLF, 'utf8'),
  ]);
}

function sanitizeTargetResponseHeaders(headers: Array<[string, string]>): Array<[string, string]> {
  return headers.filter(([name]) => !BODY_FRAMING_HEADERS.has(name.toLowerCase()));
}

interface MultipartPart {
  body: Uint8Array;
  headers: Record<string, string>;
  name: string;
}

async function readRequestBodyWithLimit(
  request: Request,
  limitBytes: number,
  bodyKind: 'JSON' | 'Multipart',
): Promise<Uint8Array> {
  if (request.body === null) {
    return new Uint8Array(await request.arrayBuffer());
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let sizeBytes = 0;

  while (true) {
    const next = await reader.read();

    if (next.done) {
      return concatChunks(chunks, sizeBytes);
    }

    chunks.push(next.value);
    sizeBytes += next.value.byteLength;

    if (sizeBytes > limitBytes) {
      throw new Error(`${bodyKind} request body exceeded ${limitBytes} bytes.`);
    }
  }
}

function parseMultipartParts(body: Uint8Array, boundary: string): MultipartPart[] {
  const rawBody = Buffer.from(body).toString('latin1');
  const boundaryMarker = `${MULTIPART_BOUNDARY_PREFIX}${boundary}`;
  let cursor = 0;
  const parts: MultipartPart[] = [];

  if (!rawBody.startsWith(boundaryMarker)) {
    throw new Error('Malformed multipart request boundary.');
  }

  cursor += boundaryMarker.length;

  while (true) {
    if (rawBody.startsWith(`${MULTIPART_BOUNDARY_PREFIX}${MULTIPART_CRLF}`, cursor)) {
      cursor += `${MULTIPART_BOUNDARY_PREFIX}${MULTIPART_CRLF}`.length;
      break;
    }
    if (rawBody.startsWith(MULTIPART_BOUNDARY_PREFIX, cursor)) {
      cursor += MULTIPART_BOUNDARY_PREFIX.length;
      break;
    }
    if (!rawBody.startsWith(MULTIPART_CRLF, cursor)) {
      throw new Error('Malformed multipart request boundary.');
    }

    cursor += MULTIPART_CRLF.length;

    const headerEndIndex = rawBody.indexOf(MULTIPART_HEADER_SEPARATOR, cursor);

    if (headerEndIndex === -1) {
      throw new Error('Malformed multipart part headers.');
    }

    const headers = parseMultipartHeaders(rawBody.slice(cursor, headerEndIndex));
    const name = readMultipartPartName(headers);
    const bodyStartIndex = headerEndIndex + MULTIPART_HEADER_SEPARATOR.length;
    const nextBoundaryIndex = rawBody.indexOf(`${MULTIPART_CRLF}${boundaryMarker}`, bodyStartIndex);

    if (nextBoundaryIndex === -1) {
      throw new Error('Malformed multipart request boundary.');
    }

    parts.push({
      body: new Uint8Array(Buffer.from(rawBody.slice(bodyStartIndex, nextBoundaryIndex), 'latin1')),
      headers,
      name,
    });

    cursor = nextBoundaryIndex + MULTIPART_CRLF.length + boundaryMarker.length;
  }

  if (rawBody.slice(cursor).trim() !== '') {
    throw new Error('Malformed multipart request boundary.');
  }

  return parts;
}

function parseMultipartHeaders(rawHeaders: string): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const line of rawHeaders.split(MULTIPART_CRLF)) {
    const separatorIndex = line.indexOf(':');

    if (separatorIndex === -1) {
      throw new Error('Malformed multipart part headers.');
    }

    headers[line.slice(0, separatorIndex).trim().toLowerCase()] = line.slice(separatorIndex + 1).trim();
  }

  return headers;
}

function readMultipartPartName(headers: Record<string, string>): string {
  const contentDisposition = headers['content-disposition'];

  if (contentDisposition === undefined) {
    throw new Error('Expected multipart part content-disposition header.');
  }

  const match = /(?:^|;\s*)name="([^"]+)"/.exec(contentDisposition);

  if (match?.[1] === undefined) {
    throw new Error('Expected multipart part name.');
  }

  return match[1];
}

function readMultipartBoundary(contentType: string): string {
  if (!isMultipartContentType(contentType)) {
    throw new Error('Expected multipart/form-data content type.');
  }

  for (const parameter of contentType.split(';').slice(1)) {
    const [rawName, ...rawValueParts] = parameter.split('=');

    if (rawName?.trim().toLowerCase() !== 'boundary') {
      continue;
    }

    const rawValue = rawValueParts.join('=').trim();
    const value = rawValue.startsWith('"') && rawValue.endsWith('"') ? rawValue.slice(1, -1) : rawValue;

    if (value.length === 0) {
      break;
    }

    return value;
  }

  throw new Error('Expected multipart boundary.');
}

function isJsonContentType(contentType: string): boolean {
  return contentType.toLowerCase().split(';', 1)[0]?.trim() === JSON_CONTENT_TYPE;
}

function isMultipartContentType(contentType: string): boolean {
  return contentType.toLowerCase().split(';', 1)[0]?.trim() === MULTIPART_CONTENT_TYPE_PREFIX;
}

function concatChunks(chunks: Uint8Array[], sizeBytes: number): Uint8Array {
  const bytes = new Uint8Array(sizeBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
