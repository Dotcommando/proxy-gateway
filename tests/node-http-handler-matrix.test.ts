import { createHash } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import {
  BINARY_BODY_PART_NAME,
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
  RESPONSE_CODE,
  TARGET_ACCESS_RESULT_KIND,
  type TargetTransportPort,
  WIRE_PROTOCOL_VERSION,
} from '../src';
import { createNodeHttpContractAdapter } from './helpers/node-http-contract-adapter';

const TEST_PROVIDER_KIND = 'test-provider';
const MULTIPART_BOUNDARY = 'node-handler-matrix-boundary';
const textEncoder = new TextEncoder();

describe('createNodeHttpHandler body status and error matrix', () => {
  it('preserves JSON text request and response bodies across the Node boundary', async () => {
    const executedTargets: GatewayTargetRequest[] = [];
    const adapter = createNodeHttpContractAdapter(createGateway(recordingTransport(executedTargets, {
      body: {
        kind: BODY_KIND_TEXT,
        replayability: 'replayable',
        text: 'text response',
      },
      headers: [['content-type', 'text/plain']],
      status: 200,
      statusText: 'OK',
      url: 'https://api.example.com/text',
    })));
    const response = await adapter.handle(jsonProxyFetchRequest({
      body: {
        kind: BODY_KIND_TEXT,
        text: 'text request',
      },
      headers: [['content-type', 'text/plain']],
      method: 'POST',
      url: 'https://api.example.com/text',
    }));

    expect(executedTargets[0]?.body).toEqual({
      kind: BODY_KIND_TEXT,
      replayability: 'replayable',
      text: 'text request',
    });
    expect(readJsonRecord(response.body)).toMatchObject({
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

  it('preserves multipart request and response bytes across the Node boundary', async () => {
    const executedTargets: GatewayTargetRequest[] = [];
    const responseBytes = new Uint8Array([9, 8, 7, 6, 5, 255]);
    const adapter = createNodeHttpContractAdapter(createGateway(recordingTransport(executedTargets, {
      body: {
        bytes: responseBytes,
        kind: 'bytes',
        replayability: 'replayable',
      },
      headers: [['content-type', OCTET_STREAM_CONTENT_TYPE]],
      status: 200,
      statusText: 'OK',
      url: 'https://api.example.com/binary',
    })));
    const requestBytes = new Uint8Array([0, 1, 2, 3, 4, 255]);
    const response = await adapter.handle(multipartProxyFetchRequest({
      accept: MULTIPART_CONTENT_TYPE_PREFIX,
      bodyBytes: requestBytes,
      url: 'https://api.example.com/binary',
    }));
    const multipartResponse = readMultipartResponse(response.body, response.headers);

    expectBytesBody(executedTargets[0]?.body, requestBytes);
    expect(sha256(multipartResponse.bodyBytes)).toBe(sha256(responseBytes));
    expect(multipartResponse.meta).toMatchObject({
      ok: true,
      response: {
        body: {
          kind: BODY_KIND_BINARY,
          partName: BINARY_BODY_PART_NAME,
        },
        status: 200,
      },
      version: WIRE_PROTOCOL_VERSION,
    });
  });

  it.each([204, 205, 304])('preserves null-body status %i across the Node boundary', async (status) => {
    const adapter = createNodeHttpContractAdapter(createGateway({
      execute: async () => ({
        body: {
          kind: BODY_KIND_TEXT,
          replayability: 'replayable',
          text: 'ignored',
        },
        headers: [['content-type', 'text/plain']],
        status,
        statusText: 'No Body',
        url: 'https://api.example.com/no-body',
      }),
    }));
    const response = await adapter.handle(jsonProxyFetchRequest({
      url: 'https://api.example.com/no-body',
    }));

    expect(readJsonRecord(response.body)).toMatchObject({
      ok: true,
      response: {
        body: null,
        status,
      },
      version: WIRE_PROTOCOL_VERSION,
    });
  });

  it.each([403, 404, 429, 500, 503])('preserves target HTTP status %i as a successful service envelope', async (status) => {
    const adapter = createNodeHttpContractAdapter(createGateway({
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
    }));
    const response = await adapter.handle(jsonProxyFetchRequest({
      url: 'https://api.example.com/status',
    }));

    expect(response.status).toBe(200);
    expect(readJsonRecord(response.body)).toMatchObject({
      ok: true,
      response: {
        status,
      },
      version: WIRE_PROTOCOL_VERSION,
    });
  });

  it('preserves service error details across the Node boundary', async () => {
    const adapter = createNodeHttpContractAdapter(createGateway({
      execute: async () => {
        throw new Error('target failed');
      },
    }));
    const response = await adapter.handle(jsonProxyFetchRequest({
      headers: [['authorization', 'Bearer target-token']],
      url: 'https://api.example.com/failure?token=target-token',
    }));
    const body = readJsonRecord(response.body);
    const serializedBody = JSON.stringify(body);

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      error: {
        code: RESPONSE_CODE.TARGET_TRANSPORT_ERROR,
        details: {
          route: {
            kind: PROXY_ROUTE_KIND.DIRECT,
          },
          target: {
            headers: [['authorization', '<redacted>']],
          },
        },
      },
      ok: false,
      version: WIRE_PROTOCOL_VERSION,
    });
    expect(serializedBody).not.toContain('target-token');
  });

  it('preserves finalUrlGuard behavior through the Node wrapper', async () => {
    let guardRejected = false;
    const adapter = createNodeHttpContractAdapter(createGateway({
      execute: async (input) => {
        const guard = input.finalUrlGuard;

        if (guard === undefined) {
          throw new Error('Expected final URL guard.');
        }

        guardRejected = guard.check({
          baseUrl: input.target.url,
          url: '//127.0.0.1/admin',
        }).kind === TARGET_ACCESS_RESULT_KIND.REJECTED;

        return okTargetResponse();
      },
    }));
    const response = await adapter.handle(jsonProxyFetchRequest({
      url: 'https://api.example.com/start',
    }));

    expect(readJsonRecord(response.body)).toMatchObject({
      ok: true,
      response: {
        status: 200,
      },
      version: WIRE_PROTOCOL_VERSION,
    });
    expect(guardRejected).toBe(true);
  });
});

interface IJsonProxyFetchRequestOptions {
  body?: null | {
    data?: string;
    kind: typeof BODY_KIND_TEXT;
    text?: string;
  };
  headers?: Array<[string, string]>;
  method?: string;
  url: string;
}

interface IMultipartProxyFetchRequestOptions {
  accept: string;
  bodyBytes: Uint8Array;
  url: string;
}

interface IMultipartResponse {
  bodyBytes: Uint8Array;
  meta: Record<string, unknown>;
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
  response: GatewayTargetResponse,
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

function jsonProxyFetchRequest(options: IJsonProxyFetchRequestOptions): {
  body: Uint8Array;
  headers: Array<[string, string]>;
  method: string;
  url: string;
} {
  return {
    body: textEncoder.encode(JSON.stringify({
      context: {},
      request: {
        body: options.body ?? null,
        headers: options.headers ?? [],
        method: options.method ?? 'GET',
        url: options.url,
      },
      version: WIRE_PROTOCOL_VERSION,
    })),
    headers: [['content-type', JSON_CONTENT_TYPE]],
    method: 'POST',
    url: 'https://gateway.test/proxy',
  };
}

function multipartProxyFetchRequest(options: IMultipartProxyFetchRequestOptions): {
  body: Uint8Array;
  headers: Array<[string, string]>;
  method: string;
  url: string;
} {
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

  return {
    body: concatBytes([
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
    ]),
    headers: [
      ['accept', options.accept],
      ['content-type', `${MULTIPART_CONTENT_TYPE_PREFIX}; boundary=${MULTIPART_BOUNDARY}`],
    ],
    method: 'POST',
    url: 'https://gateway.test/proxy',
  };
}

function readJsonRecord(bytes: Uint8Array): Record<string, unknown> {
  const parsed: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));

  if (!isRecord(parsed)) {
    throw new Error('Expected JSON record.');
  }

  return parsed;
}

function readMultipartResponse(bytes: Uint8Array, headers: Array<[string, string]>): IMultipartResponse {
  const contentType = headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1] ?? '';
  const boundary = readBoundary(contentType);
  const rawText = Buffer.from(bytes).toString('latin1');
  const parts = rawText.split(`--${boundary}`).filter((part) => part.includes('Content-Disposition'));
  const metaPart = parts.find((part) => part.includes(`name="${METADATA_PART_NAME}"`));
  const bodyPart = parts.find((part) => part.includes(`name="${BINARY_BODY_PART_NAME}"`));

  if (metaPart === undefined || bodyPart === undefined) {
    throw new Error('Expected multipart response meta and body parts.');
  }

  return {
    bodyBytes: Buffer.from(readPartBodyText(bodyPart), 'latin1'),
    meta: readJsonRecord(textEncoder.encode(readPartBodyText(metaPart))),
  };
}

function readBoundary(contentType: string): string {
  const boundaryPrefix = 'boundary=';
  const boundaryIndex = contentType.indexOf(boundaryPrefix);

  if (boundaryIndex === -1) {
    throw new Error('Expected multipart boundary.');
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectBytesBody(body: GatewayBody | undefined, bytes: Uint8Array): void {
  expect(body?.kind).toBe('bytes');

  if (body?.kind !== 'bytes') {
    throw new Error('Expected bytes body.');
  }

  expect(sha256(body.bytes)).toBe(sha256(bytes));
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

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
