import { describe, expect, it } from '@jest/globals';

import {
  ProxyFetchEnvelopeBuilder,
  ProxyFetchEnvelopeParser,
  ProxyFetchJsonEnvelopeBuilder,
  ProxyFetchJsonEnvelopeParser,
  ProxyFetchMultipartEnvelopeParser,
} from '../src/app/envelopes/proxy-fetch-json-envelope';
import {
  BINARY_BODY_PART_NAME,
  BODY_KIND_BINARY,
  JSON_CONTENT_TYPE,
  METADATA_PART_NAME,
  MULTIPART_CONTENT_TYPE_PREFIX,
  OCTET_STREAM_CONTENT_TYPE,
  RESPONSE_CODE,
  STREAMING_MULTIPART_BOUNDARY_PREFIX,
  WIRE_PROTOCOL_VERSION,
} from '../src/constants';

const parser = new ProxyFetchJsonEnvelopeParser();
const envelopeParser = new ProxyFetchEnvelopeParser();
const builder = new ProxyFetchJsonEnvelopeBuilder();
const envelopeBuilder = new ProxyFetchEnvelopeBuilder();

describe('ProxyFetchJsonEnvelopeParser', () => {
  it('parses a proxy-fetch JSON envelope with a null body', async () => {
    const parsed = await parser.parse(
      jsonRequest({
        version: WIRE_PROTOCOL_VERSION,
        request: {
          url: 'https://example.com/no-body',
          method: 'GET',
          headers: [['accept', 'text/plain']],
          body: null,
          cache: 'no-store',
          credentials: 'include',
          duplex: 'half',
          integrity: 'sha256-test',
          keepalive: true,
          mode: 'cors',
          redirect: 'manual',
          referrer: 'https://referrer.example/',
          referrerPolicy: 'no-referrer',
        },
        options: {
          timeoutMs: 360_000,
        },
        context: {
          consistency: 'same-session',
          flowKey: 'flow-a',
          marketCountry: 'GB',
          metadata: {
            trace: 'abc',
          },
          routeKey: 'route-a',
          tenantId: 'tenant-a',
          useCase: 'serp',
        },
      }),
    );

    expect(parsed).toEqual({
      context: {
        consistency: 'same-session',
        flowKey: 'flow-a',
        marketCountry: 'GB',
        metadata: {
          trace: 'abc',
        },
        routeKey: 'route-a',
        tenantId: 'tenant-a',
        useCase: 'serp',
      },
      options: {
        timeoutMs: 360_000,
      },
      target: {
        body: {
          kind: 'none',
          replayability: 'replayable',
        },
        fetch: {
          cache: 'no-store',
          credentials: 'include',
          duplex: 'half',
          integrity: 'sha256-test',
          keepalive: true,
          mode: 'cors',
          redirect: 'manual',
          referrer: 'https://referrer.example/',
          referrerPolicy: 'no-referrer',
        },
        headers: [['accept', 'text/plain']],
        method: 'GET',
        url: 'https://example.com/no-body',
      },
    });
  });

  it('parses a proxy-fetch JSON envelope with a text body', async () => {
    const parsed = await parser.parse(
      jsonRequest({
        version: WIRE_PROTOCOL_VERSION,
        request: {
          url: 'https://example.com/text',
          method: 'POST',
          headers: [['content-type', 'text/plain']],
          body: {
            kind: 'text',
            text: 'hello',
          },
        },
      }),
    );

    expect(parsed.target.body).toEqual({
      kind: 'text',
      replayability: 'replayable',
      text: 'hello',
    });
  });

  it('parses a proxy-fetch JSON envelope with a base64 body using data', async () => {
    const parsed = await parser.parse(
      jsonRequest({
        version: WIRE_PROTOCOL_VERSION,
        request: {
          url: 'https://example.com/base64',
          method: 'POST',
          body: {
            data: 'AQIDBA==',
            kind: 'base64',
          },
        },
      }),
    );

    expect(parsed.target.body.kind).toBe('bytes');
    expect(parsed.target.body.replayability).toBe('replayable');

    if (parsed.target.body.kind === 'bytes') {
      expect(Array.from(parsed.target.body.bytes)).toEqual([1, 2, 3, 4]);
    }
  });

  it('rejects multipart binary references in JSON transport', async () => {
    await expect(
      parser.parse(
        jsonRequest({
          version: WIRE_PROTOCOL_VERSION,
          request: {
            url: 'https://example.com/binary',
            method: 'POST',
            body: {
              kind: 'binary',
              partName: 'body',
            },
          },
        }),
      ),
    ).rejects.toThrow('Binary request bodies must use multipart service transport.');
  });

  it.each([
    {
      envelope: {
        version: 'proxy-fetch.v2',
        request: {
          url: 'https://example.com',
        },
      },
      message: 'Unsupported proxy-fetch envelope version.',
      name: 'unsupported version',
    },
    {
      envelope: {
        version: WIRE_PROTOCOL_VERSION,
        request: {},
      },
      message: 'Expected request.url to be a non-empty string.',
      name: 'missing request URL',
    },
    {
      envelope: {
        version: WIRE_PROTOCOL_VERSION,
        target: {
          url: 'https://example.com',
        },
      },
      message: 'Expected request to be an object.',
      name: 'legacy target envelope',
    },
    {
      envelope: {
        version: WIRE_PROTOCOL_VERSION,
        request: {
          url: 'https://example.com',
          body: {
            kind: 'json',
            value: {},
          },
        },
      },
      message: 'Unsupported request body kind.',
      name: 'unknown body kind',
    },
    {
      envelope: {
        version: WIRE_PROTOCOL_VERSION,
        request: {
          url: 'https://example.com',
          body: {
            data: 'not-base64!',
            kind: 'base64',
          },
        },
      },
      message: 'Expected request body data to be valid base64.',
      name: 'invalid base64 data',
    },
  ])('rejects $name', async ({ envelope, message }) => {
    await expect(parser.parse(jsonRequest(envelope))).rejects.toThrow(message);
  });
});

describe('ProxyFetchEnvelopeParser multipart dispatch', () => {
  it('parses a multipart request with meta and raw binary body parts', async () => {
    const bodyBytes = new Uint8Array([0, 1, 2, 3, 255, 10, 13]);
    const parsed = await envelopeParser.parse(
      multipartRequest({
        bodyBytes,
        envelope: multipartEnvelope({
          request: {
            body: {
              kind: BODY_KIND_BINARY,
              partName: BINARY_BODY_PART_NAME,
            },
            headers: [['content-type', OCTET_STREAM_CONTENT_TYPE]],
            method: 'POST',
            url: 'https://example.com/upload',
          },
        }),
      }),
    );

    expect(parsed.target).toMatchObject({
      body: {
        kind: 'bytes',
        replayability: 'replayable',
      },
      headers: [['content-type', OCTET_STREAM_CONTENT_TYPE]],
      method: 'POST',
      url: 'https://example.com/upload',
    });
    expect(parsed.target.body.kind).toBe('bytes');

    if (parsed.target.body.kind === 'bytes') {
      expect(Array.from(parsed.target.body.bytes)).toEqual(Array.from(bodyBytes));
    }
  });

  it('accepts the proxy-fetch streaming multipart shape with meta first and body second', async () => {
    const boundary = `${STREAMING_MULTIPART_BOUNDARY_PREFIX}-test-boundary`;
    const parsed = await envelopeParser.parse(
      multipartRequest({
        bodyBytes: new TextEncoder().encode('streamed'),
        boundary,
        envelope: multipartEnvelope({
          request: {
            body: {
              kind: BODY_KIND_BINARY,
              partName: BINARY_BODY_PART_NAME,
            },
            duplex: 'half',
            method: 'POST',
            url: 'https://example.com/stream',
          },
        }),
      }),
    );

    expect(parsed.target.fetch.duplex).toBe('half');
    expect(parsed.target.body.kind).toBe('bytes');

    if (parsed.target.body.kind === 'bytes') {
      expect(new TextDecoder().decode(parsed.target.body.bytes)).toBe('streamed');
    }
  });

  it('rejects missing, extra, out-of-order, and malformed multipart parts', async () => {
    await expect(
      envelopeParser.parse(
        multipartRequest({
          bodyBytes: new Uint8Array(),
          includeBodyPart: false,
        }),
      ),
    ).rejects.toThrow('Expected multipart request to contain exactly meta and body parts.');

    await expect(
      envelopeParser.parse(
        multipartRequest({
          bodyBytes: new Uint8Array(),
          extraPart: true,
        }),
      ),
    ).rejects.toThrow('Expected multipart request to contain exactly meta and body parts.');

    await expect(
      envelopeParser.parse(
        multipartRequest({
          bodyBytes: new Uint8Array(),
          bodyFirst: true,
        }),
      ),
    ).rejects.toThrow('Expected multipart request parts to be ordered as meta then body.');

    await expect(
      envelopeParser.parse(
        new Request('https://gateway.test/proxy', {
          body: 'not multipart',
          headers: {
            'content-type': `${MULTIPART_CONTENT_TYPE_PREFIX}; boundary=missing`,
          },
          method: 'POST',
        }),
      ),
    ).rejects.toThrow('Malformed multipart request boundary.');
  });

  it('rejects multipart meta that does not reference the body part', async () => {
    await expect(
      envelopeParser.parse(
        multipartRequest({
          bodyBytes: new Uint8Array([1]),
          envelope: multipartEnvelope({
            request: {
              body: {
                kind: BODY_KIND_BINARY,
                partName: 'other',
              },
              method: 'POST',
              url: 'https://example.com/upload',
            },
          }),
        }),
      ),
    ).rejects.toThrow('Expected multipart request body to reference the body part.');
  });

  it('enforces the configured multipart request body limit while reading', async () => {
    const limitedParser = new ProxyFetchMultipartEnvelopeParser({
      maxBufferedRequestBodyBytes: 20,
    });

    await expect(
      limitedParser.parse(
        multipartRequest({
          bodyBytes: new Uint8Array(64),
        }),
      ),
    ).rejects.toThrow('Multipart request body exceeded 20 bytes.');
  });

  it('enforces the configured JSON request body limit while reading', async () => {
    const limitedParser = new ProxyFetchEnvelopeParser({
      maxBufferedRequestBodyBytes: 80,
    });

    await expect(
      limitedParser.parse(
        jsonRequest({
          context: {
            metadata: {
              padding: 'x'.repeat(128),
            },
          },
          request: {
            body: null,
            method: 'GET',
            url: 'https://example.com/json',
          },
          version: WIRE_PROTOCOL_VERSION,
        }),
      ),
    ).rejects.toThrow('JSON request body exceeded 80 bytes.');
  });

  it('dispatches JSON requests unchanged and rejects unsupported content types', async () => {
    const parsed = await envelopeParser.parse(
      jsonRequest({
        request: {
          body: null,
          method: 'GET',
          url: 'https://example.com/json',
        },
        version: WIRE_PROTOCOL_VERSION,
      }),
    );

    expect(parsed.target.url).toBe('https://example.com/json');
    await expect(
      envelopeParser.parse(
        new Request('https://gateway.test/proxy', {
          body: 'hello',
          headers: {
            'content-type': 'text/plain',
          },
          method: 'POST',
        }),
      ),
    ).rejects.toThrow('Unsupported proxy-fetch request content type.');
  });
});

describe('ProxyFetchJsonEnvelopeBuilder', () => {
  it('builds a JSON response envelope with full response metadata and a text body', async () => {
    const response = builder.buildTargetResponse({
      body: {
        kind: 'text',
        replayability: 'replayable',
        text: 'ok',
      },
      headers: [['content-type', 'text/plain']],
      redirected: true,
      status: 200,
      statusText: 'OK',
      type: 'basic',
      url: 'https://example.com/final',
    });

    await expect(response.json()).resolves.toEqual({
      ok: true,
      response: {
        body: {
          kind: 'text',
          text: 'ok',
        },
        headers: [['content-type', 'text/plain']],
        redirected: true,
        status: 200,
        statusText: 'OK',
        type: 'basic',
        url: 'https://example.com/final',
      },
      version: WIRE_PROTOCOL_VERSION,
    });
  });

  it('builds a JSON response envelope with a null body for null-body statuses', async () => {
    const response = builder.buildTargetResponse({
      body: {
        kind: 'text',
        replayability: 'replayable',
        text: 'ignored',
      },
      headers: [],
      status: 204,
      statusText: 'No Content',
      url: 'https://example.com/no-content',
    });

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      response: {
        body: null,
        status: 204,
      },
      version: WIRE_PROTOCOL_VERSION,
    });
  });

  it('builds a JSON response envelope with a base64 body using data', async () => {
    const response = builder.buildTargetResponse({
      body: {
        bytes: new Uint8Array([1, 2, 3, 4]),
        kind: 'bytes',
        replayability: 'replayable',
      },
      headers: [['content-type', 'application/octet-stream']],
      status: 200,
      statusText: 'OK',
      url: 'https://example.com/base64',
    });

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      response: {
        body: {
          data: 'AQIDBA==',
          kind: 'base64',
        },
      },
      version: WIRE_PROTOCOL_VERSION,
    });
  });

  it('removes stale target response body framing headers from JSON envelopes', async () => {
    const response = builder.buildTargetResponse({
      body: {
        bytes: new Uint8Array([1, 2, 3, 4]),
        kind: 'bytes',
        replayability: 'replayable',
      },
      headers: [
        ['content-type', 'application/octet-stream'],
        ['content-length', '999'],
        ['transfer-encoding', 'chunked'],
      ],
      status: 200,
      statusText: 'OK',
      url: 'https://example.com/base64',
    });

    await expect(response.json()).resolves.toMatchObject({
      response: {
        headers: [['content-type', 'application/octet-stream']],
      },
    });
  });

  it.each(['error', 'opaque', 'opaqueredirect'] as const)('builds a special %s response shape', async (type) => {
    const response = builder.buildTargetResponse({
      body: {
        kind: 'none',
        replayability: 'replayable',
      },
      headers: [],
      status: 0,
      statusText: '',
      type,
      url: '',
    });

    await expect(response.json()).resolves.toEqual({
      ok: true,
      response: {
        body: null,
        headers: [],
        redirected: false,
        status: 0,
        statusText: '',
        type,
        url: '',
      },
      version: WIRE_PROTOCOL_VERSION,
    });
  });

  it('rejects impossible special response combinations', () => {
    expect(() =>
      builder.buildTargetResponse({
        body: {
          kind: 'text',
          replayability: 'replayable',
          text: 'not allowed',
        },
        headers: [['x-test', '1']],
        status: 200,
        statusText: 'OK',
        type: 'opaque',
        url: '',
      }),
    ).toThrow('Special response types require status 0, empty statusText, no headers, and null body.');
  });

  it('keeps target HTTP errors as successful service responses', async () => {
    const response = builder.buildTargetResponse({
      body: {
        kind: 'text',
        replayability: 'replayable',
        text: 'upstream error',
      },
      headers: [],
      status: 500,
      statusText: 'Internal Server Error',
      url: 'https://example.com/error',
    });

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      response: {
        status: 500,
      },
    });
  });

  it('builds a service error envelope with optional retryability and details', async () => {
    const response = builder.buildServiceError(400, {
      code: RESPONSE_CODE.INVALID_PROXY_FETCH_REQUEST,
      details: {
        field: 'request.url',
      },
      message: 'Invalid request.',
      retryable: false,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: RESPONSE_CODE.INVALID_PROXY_FETCH_REQUEST,
        details: {
          field: 'request.url',
        },
        message: 'Invalid request.',
        retryable: false,
      },
      ok: false,
      version: WIRE_PROTOCOL_VERSION,
    });
  });
});

describe('ProxyFetchEnvelopeBuilder response negotiation', () => {
  it('builds a multipart response for binary bodies when service Accept allows multipart', async () => {
    const response = envelopeBuilder.buildTargetResponse(binaryTargetResponse([0, 1, 2, 255]), serviceHeaders({
      accept: 'application/json, multipart/form-data',
    }));
    const parsed = await parseMultipartResponse(response);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain(MULTIPART_CONTENT_TYPE_PREFIX);
    expect(parsed.meta).toEqual({
      ok: true,
      response: {
        body: {
          kind: BODY_KIND_BINARY,
          partName: BINARY_BODY_PART_NAME,
        },
        headers: [['content-type', OCTET_STREAM_CONTENT_TYPE]],
        redirected: false,
        status: 200,
        statusText: 'OK',
        type: 'basic',
        url: 'https://example.com/binary',
      },
      version: WIRE_PROTOCOL_VERSION,
    });
    expect(Array.from(parsed.body)).toEqual([0, 1, 2, 255]);
  });

  it('uses JSON base64 for binary bodies when service Accept is JSON-only or missing', async () => {
    const jsonOnlyResponse = envelopeBuilder.buildTargetResponse(binaryTargetResponse([1, 2, 3]), serviceHeaders({
      accept: 'application/json',
    }));
    const missingAcceptResponse = envelopeBuilder.buildTargetResponse(binaryTargetResponse([4, 5, 6]), new Headers());

    expect(jsonOnlyResponse.headers.get('content-type')).toContain(JSON_CONTENT_TYPE);
    await expect(jsonOnlyResponse.json()).resolves.toMatchObject({
      response: {
        body: {
          data: 'AQID',
          kind: 'base64',
        },
      },
    });
    expect(missingAcceptResponse.headers.get('content-type')).toContain(JSON_CONTENT_TYPE);
    await expect(missingAcceptResponse.json()).resolves.toMatchObject({
      response: {
        body: {
          data: 'BAUG',
          kind: 'base64',
        },
      },
    });
  });

  it('returns a stable service error when service Accept allows neither JSON nor multipart for binary bodies', async () => {
    const response = envelopeBuilder.buildTargetResponse(binaryTargetResponse([1]), serviceHeaders({
      accept: 'text/plain',
    }));

    expect(response.status).toBe(406);
    expect(response.headers.get('content-type')).toContain(JSON_CONTENT_TYPE);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: RESPONSE_CODE.INVALID_PROXY_FETCH_REQUEST,
        message: 'Service response content negotiation failed.',
        retryable: false,
      },
      ok: false,
      version: WIRE_PROTOCOL_VERSION,
    });
  });

  it('keeps null-body statuses and special response types JSON-only even when multipart is accepted', async () => {
    const nullBodyResponse = envelopeBuilder.buildTargetResponse(
      {
        ...binaryTargetResponse([1, 2, 3]),
        status: 204,
        statusText: 'No Content',
      },
      serviceHeaders({ accept: 'multipart/form-data' }),
    );
    const specialResponse = envelopeBuilder.buildTargetResponse(
      {
        body: {
          kind: 'none',
          replayability: 'replayable',
        },
        headers: [],
        status: 0,
        statusText: '',
        type: 'opaque',
        url: '',
      },
      serviceHeaders({ accept: 'multipart/form-data' }),
    );

    expect(nullBodyResponse.headers.get('content-type')).toContain(JSON_CONTENT_TYPE);
    await expect(nullBodyResponse.json()).resolves.toMatchObject({
      response: {
        body: null,
        status: 204,
      },
    });
    expect(specialResponse.headers.get('content-type')).toContain(JSON_CONTENT_TYPE);
    await expect(specialResponse.json()).resolves.toMatchObject({
      response: {
        body: null,
        status: 0,
        type: 'opaque',
      },
    });
  });

  it('removes stale target response body framing headers from multipart metadata', async () => {
    const response = envelopeBuilder.buildTargetResponse(
      {
        ...binaryTargetResponse([1, 2, 3]),
        headers: [
          ['content-type', OCTET_STREAM_CONTENT_TYPE],
          ['content-length', '999'],
          ['transfer-encoding', 'chunked'],
        ],
      },
      serviceHeaders({ accept: 'multipart/form-data' }),
    );
    const parsed = await parseMultipartResponse(response);

    expect(parsed.meta.response.headers).toEqual([['content-type', OCTET_STREAM_CONTENT_TYPE]]);
  });

  it('keeps service errors as JSON regardless of service Accept', async () => {
    const response = envelopeBuilder.buildServiceError(502, {
      code: RESPONSE_CODE.TARGET_TRANSPORT_ERROR,
      message: 'Failed.',
      retryable: true,
    });

    expect(response.headers.get('content-type')).toContain(JSON_CONTENT_TYPE);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: RESPONSE_CODE.TARGET_TRANSPORT_ERROR,
      },
      ok: false,
    });
  });
});

function jsonRequest(envelope: unknown): Request {
  return new Request('https://gateway.test/proxy', {
    body: JSON.stringify(envelope),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  });
}

function serviceHeaders(headers: { accept?: string }): Headers {
  const result = new Headers();

  if (headers.accept !== undefined) {
    result.set('accept', headers.accept);
  }

  return result;
}

function binaryTargetResponse(bytes: number[]): {
  body: {
    bytes: Uint8Array;
    kind: 'bytes';
    replayability: 'replayable';
  };
  headers: Array<[string, string]>;
  status: number;
  statusText: string;
  url: string;
} {
  return {
    body: {
      bytes: new Uint8Array(bytes),
      kind: 'bytes',
      replayability: 'replayable',
    },
    headers: [['content-type', OCTET_STREAM_CONTENT_TYPE]],
    status: 200,
    statusText: 'OK',
    url: 'https://example.com/binary',
  };
}

interface ParsedMultipartResponse {
  body: Uint8Array;
  meta: {
    ok: boolean;
    response: {
      body: unknown;
      headers: Array<[string, string]>;
      redirected: boolean;
      status: number;
      statusText: string;
      type: ResponseType;
      url: string;
    };
    version: string;
  };
}

async function parseMultipartResponse(response: Response): Promise<ParsedMultipartResponse> {
  const contentType = response.headers.get('content-type') ?? '';
  const boundary = contentType.split(';').find((part) => part.trim().startsWith('boundary='))?.split('=')[1];

  if (boundary === undefined) {
    throw new Error('Missing multipart response boundary.');
  }

  const rawBody = Buffer.from(await response.arrayBuffer()).toString('latin1');
  const [metaPart, bodyPart] = rawBody
    .split(`--${boundary}`)
    .filter((part) => part.trim() !== '' && part.trim() !== '--');

  if (metaPart === undefined || bodyPart === undefined) {
    throw new Error('Expected multipart response meta and body parts.');
  }

  const metaBody = metaPart.slice(metaPart.indexOf('\r\n\r\n') + '\r\n\r\n'.length).replace(/\r\n$/, '');
  const binaryBody = bodyPart.slice(bodyPart.indexOf('\r\n\r\n') + '\r\n\r\n'.length).replace(/\r\n$/, '');

  return {
    body: new Uint8Array(Buffer.from(binaryBody, 'latin1')),
    meta: parseMultipartResponseMeta(JSON.parse(metaBody)),
  };
}

function parseMultipartResponseMeta(value: unknown): ParsedMultipartResponse['meta'] {
  if (!isRecord(value) || !isRecord(value.response)) {
    throw new Error('Expected multipart response meta envelope.');
  }

  return {
    ok: value.ok === true,
    response: {
      body: value.response.body,
      headers: parseHeaderPairs(value.response.headers),
      redirected: value.response.redirected === true,
      status: typeof value.response.status === 'number' ? value.response.status : -1,
      statusText: typeof value.response.statusText === 'string' ? value.response.statusText : '',
      type: parseResponseType(value.response.type),
      url: typeof value.response.url === 'string' ? value.response.url : '',
    },
    version: typeof value.version === 'string' ? value.version : '',
  };
}

function parseHeaderPairs(value: unknown): Array<[string, string]> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (
      !Array.isArray(entry)
      || entry.length !== 2
      || typeof entry[0] !== 'string'
      || typeof entry[1] !== 'string'
    ) {
      return [];
    }

    return [[entry[0], entry[1]]];
  });
}

function parseResponseType(value: unknown): ResponseType {
  if (
    value === 'basic'
    || value === 'cors'
    || value === 'default'
    || value === 'error'
    || value === 'opaque'
    || value === 'opaqueredirect'
  ) {
    return value;
  }

  return 'basic';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function multipartEnvelope(overrides: {
  request?: Record<string, unknown>;
} = {}): Record<string, unknown> {
  return {
    context: {
      flowKey: 'flow-a',
    },
    options: {
      timeoutMs: 1000,
    },
    request: {
      body: {
        kind: BODY_KIND_BINARY,
        partName: BINARY_BODY_PART_NAME,
      },
      method: 'POST',
      url: 'https://example.com/upload',
      ...overrides.request,
    },
    version: WIRE_PROTOCOL_VERSION,
  };
}

function multipartRequest(options: {
  bodyBytes: Uint8Array;
  bodyFirst?: boolean;
  boundary?: string;
  envelope?: Record<string, unknown>;
  extraPart?: boolean;
  includeBodyPart?: boolean;
}): Request {
  const boundary = options.boundary ?? 'proxy-gateway-test-boundary';
  const envelope = options.envelope ?? multipartEnvelope();
  const metaPart = multipartPart({
    body: new TextEncoder().encode(JSON.stringify(envelope)),
    contentType: JSON_CONTENT_TYPE,
    name: METADATA_PART_NAME,
  });
  const bodyPart = multipartPart({
    body: options.bodyBytes,
    contentType: OCTET_STREAM_CONTENT_TYPE,
    filename: BINARY_BODY_PART_NAME,
    name: BINARY_BODY_PART_NAME,
  });
  const parts = options.bodyFirst
    ? [bodyPart, metaPart]
    : [metaPart, ...(options.includeBodyPart === false ? [] : [bodyPart])];

  if (options.extraPart === true) {
    parts.push(
      multipartPart({
        body: new TextEncoder().encode('extra'),
        contentType: 'text/plain',
        name: 'extra',
      }),
    );
  }

  const body = Buffer.concat([
    ...parts.map((part) => Buffer.concat([Buffer.from(`--${boundary}\r\n`, 'utf8'), part])),
    Buffer.from(`--${boundary}--\r\n`, 'utf8'),
  ]);

  return new Request('https://gateway.test/proxy', {
    body,
    headers: {
      'content-type': `${MULTIPART_CONTENT_TYPE_PREFIX}; boundary=${boundary}`,
    },
    method: 'POST',
  });
}

function multipartPart(options: {
  body: Uint8Array;
  contentType: string;
  filename?: string;
  name: string;
}): Buffer {
  const disposition = options.filename === undefined
    ? `Content-Disposition: form-data; name="${options.name}"`
    : `Content-Disposition: form-data; name="${options.name}"; filename="${options.filename}"`;

  return Buffer.concat([
    Buffer.from(`${disposition}\r\nContent-Type: ${options.contentType}\r\n\r\n`, 'utf8'),
    Buffer.from(options.body),
    Buffer.from('\r\n', 'utf8'),
  ]);
}
