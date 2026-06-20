import { describe, expect, it } from '@jest/globals';

import {
  JSON_CONTENT_TYPE,
  MULTIPART_CONTENT_TYPE_PREFIX,
  type ProxyGateway,
  RESPONSE_CODE,
  WIRE_PROTOCOL_VERSION,
} from '../../src';

export interface IInboundAdapterContractRequest {
  body: Uint8Array;
  headers: Array<[string, string]>;
  method: string;
  url: string;
}

export interface IInboundAdapterContractResponse {
  body: Uint8Array;
  headers: Array<[string, string]>;
  status: number;
}

export interface IInboundAdapterContractAdapter {
  handle(request: IInboundAdapterContractRequest): Promise<IInboundAdapterContractResponse>;
}

export interface IInboundAdapterContractOptions {
  createAdapter(gateway: ProxyGateway): IInboundAdapterContractAdapter;
  name: string;
}

const textEncoder = new TextEncoder();

export function runInboundAdapterContractSuite(options: IInboundAdapterContractOptions): void {
  describe(options.name, () => {
    it('passes raw JSON request bytes to the gateway', async () => {
      const rawJson = '{ "version" : "proxy-fetch.v1", "request" : { "url" : "https://example.com" } }';
      let observedBody = '';
      let observedContentType = '';
      const adapter = options.createAdapter({
        handle: async (request) => {
          observedBody = await request.text();
          observedContentType = request.headers.get('content-type') ?? '';

          return jsonResponse(200, {
            ok: true,
            version: WIRE_PROTOCOL_VERSION,
          });
        },
      });
      const response = await adapter.handle({
        body: textEncoder.encode(rawJson),
        headers: [['content-type', JSON_CONTENT_TYPE]],
        method: 'POST',
        url: 'https://gateway.test/proxy',
      });

      expect(response.status).toBe(200);
      expect(observedBody).toBe(rawJson);
      expect(observedContentType).toBe(JSON_CONTENT_TYPE);
    });

    it('passes multipart request bytes and boundary to the gateway', async () => {
      const boundary = 'adapter-contract-boundary';
      const multipartBytes = new Uint8Array([
        ...textEncoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="meta"\r\n\r\n{}\r\n`),
        0,
        1,
        2,
        255,
        ...textEncoder.encode(`\r\n--${boundary}--\r\n`),
      ]);
      let observedBody = new Uint8Array();
      let observedContentType = '';
      const adapter = options.createAdapter({
        handle: async (request) => {
          observedBody = new Uint8Array(await request.arrayBuffer());
          observedContentType = request.headers.get('content-type') ?? '';

          return jsonResponse(200, {
            ok: true,
            version: WIRE_PROTOCOL_VERSION,
          });
        },
      });
      const response = await adapter.handle({
        body: multipartBytes,
        headers: [['content-type', `${MULTIPART_CONTENT_TYPE_PREFIX}; boundary=${boundary}`]],
        method: 'POST',
        url: 'https://gateway.test/proxy',
      });

      expect(response.status).toBe(200);
      expect(Array.from(observedBody)).toEqual(Array.from(multipartBytes));
      expect(observedContentType).toBe(`${MULTIPART_CONTENT_TYPE_PREFIX}; boundary=${boundary}`);
    });

    it('preserves gateway response status headers and body bytes', async () => {
      const responseBody = new Uint8Array([0, 1, 2, 3, 255]);
      const adapter = options.createAdapter({
        handle: async () => new Response(Buffer.from(responseBody), {
          headers: {
            'content-type': 'application/octet-stream',
            'x-contract': 'response-header',
          },
          status: 207,
        }),
      });
      const response = await adapter.handle(emptyPostRequest());

      expect(response.status).toBe(207);
      expect(response.headers).toEqual(expect.arrayContaining([
        ['content-type', 'application/octet-stream'],
        ['x-contract', 'response-header'],
      ]));
      expect(Array.from(response.body)).toEqual(Array.from(responseBody));
    });

    it('preserves service error details without reserializing the body', async () => {
      const serviceErrorBody = JSON.stringify({
        error: {
          code: RESPONSE_CODE.TARGET_TRANSPORT_ERROR,
          details: {
            route: {
              kind: 'direct',
            },
            target: {
              url: 'https://example.com/resource',
            },
          },
          message: 'Target transport execution failed.',
          retryable: true,
        },
        ok: false,
        version: WIRE_PROTOCOL_VERSION,
      });
      const adapter = options.createAdapter({
        handle: async () => new Response(serviceErrorBody, {
          headers: {
            'content-type': JSON_CONTENT_TYPE,
          },
          status: 502,
        }),
      });
      const response = await adapter.handle(emptyPostRequest());

      expect(response.status).toBe(502);
      expect(readUtf8(response.body)).toBe(serviceErrorBody);
      expect(response.headers).toEqual(expect.arrayContaining([
        ['content-type', JSON_CONTENT_TYPE],
      ]));
    });
  });
}

function emptyPostRequest(): IInboundAdapterContractRequest {
  return {
    body: new Uint8Array(),
    headers: [['content-type', JSON_CONTENT_TYPE]],
    method: 'POST',
    url: 'https://gateway.test/proxy',
  };
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': JSON_CONTENT_TYPE,
    },
    status,
  });
}

function readUtf8(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('utf8');
}
