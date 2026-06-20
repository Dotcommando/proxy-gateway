import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, expect, it } from '@jest/globals';

import {
  createNodeHttpHandler,
  JSON_CONTENT_TYPE,
  type ProxyGateway,
  WIRE_PROTOCOL_VERSION,
} from '../src';
import {
  type IInboundAdapterContractAdapter,
  type IInboundAdapterContractRequest,
  runInboundAdapterContractSuite,
} from './helpers/inbound-adapter-contract';

runInboundAdapterContractSuite({
  createAdapter: (gateway) => createNodeHttpContractAdapter(gateway),
  name: 'createNodeHttpHandler inbound adapter contract',
});

describe('createNodeHttpHandler', () => {
  it('converts Node request URL method headers and raw body into a Web Request', async () => {
    let observedUrl = '';
    let observedMethod = '';
    let observedHeader = '';
    let observedBody = '';
    const adapter = createNodeHttpContractAdapter({
      handle: async (request) => {
        observedUrl = request.url;
        observedMethod = request.method;
        observedHeader = request.headers.get('x-custom-header') ?? '';
        observedBody = await request.text();

        return new Response(JSON.stringify({
          ok: true,
          version: WIRE_PROTOCOL_VERSION,
        }), {
          headers: {
            'content-type': JSON_CONTENT_TYPE,
          },
          status: 202,
        });
      },
    });
    const response = await adapter.handle({
      body: new TextEncoder().encode('{"raw":true}'),
      headers: [
        ['content-type', JSON_CONTENT_TYPE],
        ['x-custom-header', 'custom-value'],
      ],
      method: 'PATCH',
      url: 'https://gateway.test/custom/path?query=1',
    });
    const observedParsedUrl = new URL(observedUrl);

    expect(response.status).toBe(202);
    expect(observedParsedUrl.pathname).toBe('/custom/path');
    expect(observedParsedUrl.search).toBe('?query=1');
    expect(observedMethod).toBe('PATCH');
    expect(observedHeader).toBe('custom-value');
    expect(observedBody).toBe('{"raw":true}');
  });
});

function createNodeHttpContractAdapter(gateway: ProxyGateway): IInboundAdapterContractAdapter {
  const handler = createNodeHttpHandler(gateway);

  return {
    handle: async (request) => {
      const server = createServer((incomingMessage, serverResponse) => {
        void handler(incomingMessage, serverResponse);
      });

      await listen(server);

      try {
        const response = await fetch(localUrl(server, request), {
          body: Buffer.from(request.body),
          headers: request.headers,
          method: request.method,
        });

        return {
          body: new Uint8Array(await response.arrayBuffer()),
          headers: Array.from(response.headers.entries()),
          status: response.status,
        };
      } finally {
        await close(server);
      }
    },
  };
}

function localUrl(server: Server, request: IInboundAdapterContractRequest): string {
  const address = server.address();

  if (!isAddressInfo(address)) {
    throw new Error('Expected server address info.');
  }

  const inputUrl = new URL(request.url);

  return `http://127.0.0.1:${address.port}${inputUrl.pathname}${inputUrl.search}`;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);

        return;
      }

      resolve();
    });
  });
}

function isAddressInfo(value: string | AddressInfo | null): value is AddressInfo {
  return typeof value === 'object' && value !== null;
}
