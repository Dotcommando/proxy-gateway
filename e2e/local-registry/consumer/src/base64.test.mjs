import assert from 'node:assert/strict';
import test from 'node:test';

import { createProxyGateway } from '@echospecter/proxy-gateway';

import { createProvider } from './test-common.mjs';

test('JSON base64 request and response bodies preserve bytes', async () => {
  const requestBytes = Buffer.from('hello through json base64', 'utf8');
  const responseBytes = Buffer.from('base64 response bytes', 'utf8');
  const gateway = createProxyGateway({
    plan: {
      attempts: [
        {
          provider: 'local-direct-provider'
        }
      ],
      kind: 'fallback'
    },
    providers: [createProvider()],
    transport: {
      async execute(input) {
        const body = input.target.body;

        assert.equal(body.kind, 'bytes');
        assert.equal(Buffer.compare(Buffer.from(body.bytes), requestBytes), 0);

        return {
          body: {
            bytes: responseBytes,
            kind: 'bytes',
            replayability: 'replayable'
          },
          headers: [
            ['content-type', 'application/octet-stream']
          ],
          redirected: false,
          status: 200,
          statusText: 'OK',
          type: 'basic',
          url: input.target.url
        };
      }
    }
  });
  const response = await gateway.handle(new Request('http://local-gateway/proxy-fetch', {
    body: JSON.stringify({
      version: 'proxy-fetch.v1',
      request: {
        body: {
          data: requestBytes.toString('base64'),
          kind: 'base64'
        },
        headers: [
          ['content-type', 'application/octet-stream']
        ],
        method: 'POST',
        url: 'https://example.test/base64'
      }
    }),
    headers: {
      accept: 'application/json',
      'content-type': 'application/json'
    },
    method: 'POST'
  }));
  const envelope = await response.json();

  assert.equal(envelope.ok, true);
  assert.equal(envelope.response?.body?.kind, 'base64');
  assert.equal(Buffer.from(envelope.response.body.data, 'base64').toString('utf8'), responseBytes.toString('utf8'));
});
