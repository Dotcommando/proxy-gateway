import { describe, expect, it } from '@jest/globals';

import {
  ProxyFetchJsonEnvelopeBuilder,
  ProxyFetchJsonEnvelopeParser,
} from '../src/app/envelopes/proxy-fetch-json-envelope';
import { RESPONSE_CODE, WIRE_PROTOCOL_VERSION } from '../src/constants';

const parser = new ProxyFetchJsonEnvelopeParser();
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
