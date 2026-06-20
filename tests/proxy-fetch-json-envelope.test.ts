import { describe, expect, it } from '@jest/globals';

import {
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

function jsonRequest(envelope: unknown): Request {
  return new Request('https://gateway.test/proxy', {
    body: JSON.stringify(envelope),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  });
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
