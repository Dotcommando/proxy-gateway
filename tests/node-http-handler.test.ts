import { describe, expect, it } from '@jest/globals';

import {
  JSON_CONTENT_TYPE,
  WIRE_PROTOCOL_VERSION,
} from '../src';
import { runInboundAdapterContractSuite } from './helpers/inbound-adapter-contract';
import { createNodeHttpContractAdapter } from './helpers/node-http-contract-adapter';

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
