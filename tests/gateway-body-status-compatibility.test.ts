import { describe, expect, it } from '@jest/globals';

import {
  BINARY_BODY_PART_NAME,
  BODY_ENCODING_BASE64,
  BODY_KIND_BASE64,
  BODY_KIND_BINARY,
  BODY_KIND_TEXT,
  createProxyGateway,
  type GatewayBody,
  type GatewayTargetRequest,
  type GatewayTargetResponse,
  JSON_CONTENT_TYPE,
  METADATA_PART_NAME,
  MULTIPART_CONTENT_TYPE_PREFIX,
  OCTET_STREAM_CONTENT_TYPE,
  PROXY_PLAN_KIND,
  PROXY_ROUTE_KIND,
  type ProxyProviderInstance,
  type TargetTransportPort,
  WIRE_PROTOCOL_VERSION,
} from '../src';

const TEST_PROVIDER_KIND = 'test-provider';
const MULTIPART_BOUNDARY = 'gateway-body-status-boundary';
const textEncoder = new TextEncoder();

describe('gateway body and status compatibility', () => {
  it('passes JSON text requests through the full gateway path and returns JSON text responses', async () => {
    const executedTargets: GatewayTargetRequest[] = [];
    const gateway = createGateway(recordingTransport(executedTargets, {
      body: {
        kind: BODY_KIND_TEXT,
        replayability: 'replayable',
        text: 'text response',
      },
      headers: [['content-type', 'text/plain']],
      status: 200,
      statusText: 'OK',
      url: 'https://api.example.com/text',
    }));
    const response = await gateway.handle(jsonProxyFetchRequest({
      body: {
        kind: BODY_KIND_TEXT,
        text: 'text request',
      },
      headers: [['content-type', 'text/plain']],
      method: 'POST',
      url: 'https://api.example.com/text',
    }));

    expect(executedTargets).toHaveLength(1);
    expect(executedTargets[0]?.body).toEqual({
      kind: BODY_KIND_TEXT,
      replayability: 'replayable',
      text: 'text request',
    });
    expect(await response.json()).toMatchObject({
      ok: true,
      response: {
        body: {
          kind: BODY_KIND_TEXT,
          text: 'text response',
        },
        status: 200,
      },
      version: WIRE_PROTOCOL_VERSION,
    });
  });

  it('normalizes JSON base64 request bodies to bytes through the full gateway path', async () => {
    const executedTargets: GatewayTargetRequest[] = [];
    const gateway = createGateway(recordingTransport(executedTargets));
    const response = await gateway.handle(jsonProxyFetchRequest({
      body: {
        data: Buffer.from([1, 2, 3, 4]).toString(BODY_ENCODING_BASE64),
        kind: BODY_KIND_BASE64,
      },
      headers: [['content-type', OCTET_STREAM_CONTENT_TYPE]],
      method: 'POST',
      url: 'https://api.example.com/base64',
    }));

    expect(await response.json()).toMatchObject({
      ok: true,
      response: {
        status: 200,
      },
      version: WIRE_PROTOCOL_VERSION,
    });
    expectBytesBody(executedTargets[0]?.body, [1, 2, 3, 4]);
  });

  it('passes multipart binary requests and multipart binary responses through the full gateway path', async () => {
    const executedTargets: GatewayTargetRequest[] = [];
    const responseBytes = textEncoder.encode('binary response');
    const gateway = createGateway(recordingTransport(executedTargets, {
      body: {
        bytes: responseBytes,
        kind: 'bytes',
        replayability: 'replayable',
      },
      headers: [
        ['content-type', OCTET_STREAM_CONTENT_TYPE],
        ['content-length', '999'],
      ],
      status: 200,
      statusText: 'OK',
      url: 'https://api.example.com/binary',
    }));
    const requestBytes = new Uint8Array([0, 1, 2, 3, 255]);
    const response = await gateway.handle(multipartProxyFetchRequest({
      accept: MULTIPART_CONTENT_TYPE_PREFIX,
      bodyBytes: requestBytes,
      url: 'https://api.example.com/binary',
    }));
    const multipartResponse = await readMultipartResponse(response);

    expect(response.headers.get('content-type')).toContain(MULTIPART_CONTENT_TYPE_PREFIX);
    expectBytesBody(executedTargets[0]?.body, Array.from(requestBytes));
    expect(multipartResponse.meta).toMatchObject({
      ok: true,
      response: {
        body: {
          kind: BODY_KIND_BINARY,
          partName: BINARY_BODY_PART_NAME,
        },
        headers: [['content-type', OCTET_STREAM_CONTENT_TYPE]],
        status: 200,
      },
      version: WIRE_PROTOCOL_VERSION,
    });
    expect(Array.from(multipartResponse.bodyBytes)).toEqual(Array.from(responseBytes));
  });

  it.each([204, 205, 304])('uses null-body semantics for target status %i', async (status) => {
    const executedTargets: GatewayTargetRequest[] = [];
    const gateway = createGateway(recordingTransport(executedTargets, {
      body: {
        kind: BODY_KIND_TEXT,
        replayability: 'replayable',
        text: 'must be ignored',
      },
      headers: [['content-type', 'text/plain']],
      status,
      statusText: 'No Body',
      url: 'https://api.example.com/no-body',
    }));
    const response = await gateway.handle(jsonProxyFetchRequest({
      body: null,
      method: 'GET',
      url: 'https://api.example.com/no-body',
    }));

    expect(executedTargets[0]?.body).toEqual({
      kind: 'none',
      replayability: 'replayable',
    });
    expect(await response.json()).toMatchObject({
      ok: true,
      response: {
        body: null,
        status,
      },
      version: WIRE_PROTOCOL_VERSION,
    });
  });

  it.each([403, 404, 429, 500, 503])('returns target HTTP status %i as a successful service envelope by default', async (status) => {
    const gateway = createGateway({
      execute: async () => ({
        body: {
          kind: BODY_KIND_TEXT,
          replayability: 'replayable',
          text: `target status ${status}`,
        },
        headers: [['content-type', 'text/plain']],
        status,
        statusText: 'Target Status',
        url: 'https://api.example.com/status',
      }),
    });
    const response = await gateway.handle(jsonProxyFetchRequest({
      url: 'https://api.example.com/status',
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      response: {
        body: {
          kind: BODY_KIND_TEXT,
          text: `target status ${status}`,
        },
        status,
      },
      version: WIRE_PROTOCOL_VERSION,
    });
  });
});

interface IMultipartResponse {
  bodyBytes: Uint8Array;
  meta: Record<string, unknown>;
}

interface IProxyFetchJsonRequestOptions {
  body?: null | {
    data?: string;
    kind: typeof BODY_KIND_BASE64 | typeof BODY_KIND_TEXT;
    text?: string;
  };
  headers?: Array<[string, string]>;
  method?: string;
  url?: string;
}

interface IMultipartProxyFetchRequestOptions {
  accept?: string;
  bodyBytes: Uint8Array;
  url: string;
}

function createGateway(transport: TargetTransportPort): {
  handle(request: Request): Promise<Response>;
} {
  return createProxyGateway({
    plan: {
      attempts: [
        {
          provider: 'provider-a',
        },
      ],
      kind: PROXY_PLAN_KIND.FALLBACK,
    },
    providers: [provider()],
    transport,
  });
}

function provider(): ProxyProviderInstance {
  return {
    adapter: {
      acquire: async (input) => ({
        id: 'provider-a-lease',
        providerInstanceId: input.providerInstanceId,
        providerKind: TEST_PROVIDER_KIND,
        route: { kind: PROXY_ROUTE_KIND.DIRECT },
      }),
      getCapabilities: () => ({}),
      kind: TEST_PROVIDER_KIND,
    },
    id: 'provider-a',
  };
}

function recordingTransport(
  executedTargets: GatewayTargetRequest[],
  response: GatewayTargetResponse = okTargetResponse(),
): TargetTransportPort {
  return {
    execute: async (input) => {
      executedTargets.push(input.target);

      return response;
    },
  };
}

function okTargetResponse(): GatewayTargetResponse {
  return {
    body: {
      kind: BODY_KIND_TEXT,
      replayability: 'replayable',
      text: 'ok',
    },
    headers: [['content-type', 'text/plain']],
    status: 200,
    statusText: 'OK',
    url: 'https://api.example.com/ok',
  };
}

function jsonProxyFetchRequest(options: IProxyFetchJsonRequestOptions = {}): Request {
  return new Request('https://gateway.test/proxy', {
    body: JSON.stringify({
      context: {},
      request: {
        body: options.body ?? null,
        headers: options.headers ?? [],
        method: options.method ?? 'GET',
        url: options.url ?? 'https://api.example.com/resource',
      },
      version: WIRE_PROTOCOL_VERSION,
    }),
    headers: {
      'content-type': JSON_CONTENT_TYPE,
    },
    method: 'POST',
  });
}

function multipartProxyFetchRequest(options: IMultipartProxyFetchRequestOptions): Request {
  const envelope = {
    context: {},
    request: {
      body: {
        kind: BODY_KIND_BINARY,
        partName: BINARY_BODY_PART_NAME,
      },
      headers: [['content-type', OCTET_STREAM_CONTENT_TYPE]],
      method: 'POST',
      url: options.url,
    },
    version: WIRE_PROTOCOL_VERSION,
  };
  const body = concatBytes([
    textEncoder.encode([
      `--${MULTIPART_BOUNDARY}`,
      `Content-Disposition: form-data; name="${METADATA_PART_NAME}"`,
      `Content-Type: ${JSON_CONTENT_TYPE}`,
      '',
      JSON.stringify(envelope),
      `--${MULTIPART_BOUNDARY}`,
      `Content-Disposition: form-data; name="${BINARY_BODY_PART_NAME}"; filename="${BINARY_BODY_PART_NAME}"`,
      `Content-Type: ${OCTET_STREAM_CONTENT_TYPE}`,
      '',
      '',
    ].join('\r\n')),
    options.bodyBytes,
    textEncoder.encode(`\r\n--${MULTIPART_BOUNDARY}--\r\n`),
  ]);

  return new Request('https://gateway.test/proxy', {
    body: Buffer.from(body),
    headers: {
      accept: options.accept ?? JSON_CONTENT_TYPE,
      'content-type': `${MULTIPART_CONTENT_TYPE_PREFIX}; boundary=${MULTIPART_BOUNDARY}`,
    },
    method: 'POST',
  });
}

async function readMultipartResponse(response: Response): Promise<IMultipartResponse> {
  const contentType = response.headers.get('content-type') ?? '';
  const boundary = readBoundary(contentType);
  const rawBytes = new Uint8Array(await response.arrayBuffer());
  const rawText = Buffer.from(rawBytes).toString('latin1');
  const parts = rawText.split(`--${boundary}`).filter((part) => part.includes('Content-Disposition'));
  const metaPart = parts.find((part) => part.includes(`name="${METADATA_PART_NAME}"`));
  const bodyPart = parts.find((part) => part.includes(`name="${BINARY_BODY_PART_NAME}"`));

  if (metaPart === undefined || bodyPart === undefined) {
    throw new Error('Expected multipart response meta and body parts.');
  }

  return {
    bodyBytes: readPartBodyBytes(bodyPart),
    meta: readJsonRecord(readPartBodyText(metaPart)),
  };
}

function readBoundary(contentType: string): string {
  const boundaryPrefix = 'boundary=';
  const boundaryIndex = contentType.indexOf(boundaryPrefix);

  if (boundaryIndex === -1) {
    throw new Error('Expected multipart response boundary.');
  }

  return contentType.slice(boundaryIndex + boundaryPrefix.length);
}

function readPartBodyText(part: string): string {
  const separator = '\r\n\r\n';
  const separatorIndex = part.indexOf(separator);

  if (separatorIndex === -1) {
    throw new Error('Expected multipart part body.');
  }

  return part.slice(separatorIndex + separator.length).replace(/\r\n$/, '');
}

function readPartBodyBytes(part: string): Uint8Array {
  return Buffer.from(readPartBodyText(part), 'latin1');
}

function readJsonRecord(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);

  if (!isRecord(parsed)) {
    throw new Error('Expected JSON record.');
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectBytesBody(body: GatewayBody | undefined, bytes: number[]): void {
  expect(body?.kind).toBe('bytes');

  if (body?.kind !== 'bytes') {
    throw new Error('Expected bytes body.');
  }

  expect(Array.from(body.bytes)).toEqual(bytes);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;

  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }

  return bytes;
}
