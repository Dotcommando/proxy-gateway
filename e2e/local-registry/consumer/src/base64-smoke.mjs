import { createProxyGateway } from '@echospecter/proxy-gateway';

import { createProvider } from './smoke-common.mjs';

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

      if (body.kind !== 'bytes') {
        throw new Error(`base64 smoke expected bytes target body, got ${body.kind}`);
      }
      if (Buffer.compare(Buffer.from(body.bytes), requestBytes) !== 0) {
        throw new Error('base64 smoke target bytes mismatch');
      }

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

if (envelope.ok !== true) {
  throw new Error(`base64 smoke expected ok=true: ${JSON.stringify(envelope)}`);
}
if (envelope.response?.body?.kind !== 'base64') {
  throw new Error(`base64 smoke expected base64 response body: ${JSON.stringify(envelope)}`);
}
if (Buffer.from(envelope.response.body.data, 'base64').toString('utf8') !== responseBytes.toString('utf8')) {
  throw new Error('base64 smoke response bytes mismatch');
}

console.log('base64 body: ok');
