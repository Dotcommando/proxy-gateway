import { describe, expect, it } from '@jest/globals';

import {
  ProxyFetchJsonEnvelopeBuilder,
  ProxyFetchJsonEnvelopeParser,
} from '../src/app/envelopes/proxy-fetch-json-envelope';
import { RESPONSE_CODE, WIRE_PROTOCOL_VERSION } from '../src/constants';

const parser = new ProxyFetchJsonEnvelopeParser();
const builder = new ProxyFetchJsonEnvelopeBuilder();

describe('ProxyFetchJsonEnvelopeParser', () => {
  it('parses a JSON envelope with a null body', async () => {
    const parsed = await parser.parse(
      jsonRequest({
        version: WIRE_PROTOCOL_VERSION,
        target: {
          url: 'https://example.com/no-body',
          method: 'GET',
          headers: [['accept', 'text/plain']],
          body: null,
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
        },
        context: {
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
        flowKey: 'flow-a',
        marketCountry: 'GB',
        metadata: {
          trace: 'abc',
        },
        routeKey: 'route-a',
        tenantId: 'tenant-a',
        useCase: 'serp',
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

  it('parses a JSON envelope with a text body', async () => {
    const parsed = await parser.parse(
      jsonRequest({
        version: WIRE_PROTOCOL_VERSION,
        target: {
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

  it('parses a JSON envelope with a base64 body', async () => {
    const parsed = await parser.parse(
      jsonRequest({
        version: WIRE_PROTOCOL_VERSION,
        target: {
          url: 'https://example.com/base64',
          method: 'POST',
          body: {
            base64: 'AQIDBA==',
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

  it.each([
    {
      envelope: {
        version: 'proxy-fetch.v2',
        target: {
          url: 'https://example.com',
        },
      },
      message: 'Unsupported proxy-fetch envelope version.',
      name: 'unsupported version',
    },
    {
      envelope: {
        version: WIRE_PROTOCOL_VERSION,
        target: {},
      },
      message: 'Expected target.url to be a non-empty string.',
      name: 'missing target URL',
    },
    {
      envelope: {
        version: WIRE_PROTOCOL_VERSION,
        target: {
          url: 'https://example.com',
          body: {
            kind: 'json',
            value: {},
          },
        },
      },
      message: 'Unsupported target body kind.',
      name: 'unknown body kind',
    },
    {
      envelope: {
        version: WIRE_PROTOCOL_VERSION,
        target: {
          url: 'https://example.com',
          body: {
            base64: 'not-base64!',
            kind: 'base64',
          },
        },
      },
      message: 'Expected target body base64 to be valid base64.',
      name: 'invalid base64',
    },
  ])('rejects $name', async ({ envelope, message }) => {
    await expect(parser.parse(jsonRequest(envelope))).rejects.toThrow(message);
  });
});

describe('ProxyFetchJsonEnvelopeBuilder', () => {
  it('builds a JSON response envelope with a text body', async () => {
    const response = builder.buildTargetResponse({
      body: {
        kind: 'text',
        replayability: 'replayable',
        text: 'ok',
      },
      headers: [['content-type', 'text/plain']],
      status: 200,
      statusText: 'OK',
    });

    await expect(response.json()).resolves.toEqual({
      ok: true,
      response: {
        body: {
          kind: 'text',
          text: 'ok',
        },
        headers: [['content-type', 'text/plain']],
        status: 200,
        statusText: 'OK',
      },
      version: WIRE_PROTOCOL_VERSION,
    });
  });

  it('builds a JSON response envelope with a null body', async () => {
    const response = builder.buildTargetResponse({
      body: {
        kind: 'none',
        replayability: 'replayable',
      },
      headers: [],
      status: 204,
      statusText: 'No Content',
    });

    await expect(response.json()).resolves.toEqual({
      ok: true,
      response: {
        body: null,
        headers: [],
        status: 204,
        statusText: 'No Content',
      },
      version: WIRE_PROTOCOL_VERSION,
    });
  });

  it('builds a JSON response envelope with a base64 body', async () => {
    const response = builder.buildTargetResponse({
      body: {
        bytes: new Uint8Array([1, 2, 3, 4]),
        kind: 'bytes',
        replayability: 'replayable',
      },
      headers: [['content-type', 'application/octet-stream']],
      status: 200,
      statusText: 'OK',
    });

    await expect(response.json()).resolves.toEqual({
      ok: true,
      response: {
        body: {
          base64: 'AQIDBA==',
          kind: 'base64',
        },
        headers: [['content-type', 'application/octet-stream']],
        status: 200,
        statusText: 'OK',
      },
      version: WIRE_PROTOCOL_VERSION,
    });
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
    });

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      response: {
        status: 500,
      },
    });
  });

  it('builds a service error envelope', async () => {
    const response = builder.buildServiceError(400, {
      code: RESPONSE_CODE.INVALID_PROXY_FETCH_REQUEST,
      message: 'Invalid request.',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: RESPONSE_CODE.INVALID_PROXY_FETCH_REQUEST,
        message: 'Invalid request.',
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
