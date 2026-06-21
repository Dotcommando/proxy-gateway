import { createHash } from 'node:crypto';

import { createProxyGateway } from '@echospecter/proxy-gateway';

import { createProvider } from './smoke-common.mjs';

const boundary = 'local-registry-boundary';
const expectedBytes = Buffer.from('multipart request bytes from consumer', 'utf8');
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
        throw new Error(`multipart smoke expected bytes target body, got ${body.kind}`);
      }
      if (sha256(Buffer.from(body.bytes)) !== sha256(expectedBytes)) {
        throw new Error('multipart smoke target bytes mismatch');
      }

      return {
        body: {
          kind: 'text',
          replayability: 'replayable',
          text: `multipart ${body.bytes.byteLength}`
        },
        headers: [
          ['content-type', 'text/plain; charset=utf-8']
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
  body: createMultipartBody(),
  headers: {
    accept: 'application/json',
    'content-type': `multipart/form-data; boundary=${boundary}`
  },
  method: 'POST'
}));
const envelope = await response.json();

if (envelope.ok !== true) {
  throw new Error(`multipart smoke expected ok=true: ${JSON.stringify(envelope)}`);
}
if (envelope.response?.body?.text !== `multipart ${expectedBytes.byteLength}`) {
  throw new Error(`multipart smoke unexpected response: ${JSON.stringify(envelope)}`);
}

console.log('multipart body: ok');

function createMultipartBody() {
  const encoder = new TextEncoder();
  const meta = {
    version: 'proxy-fetch.v1',
    request: {
      body: {
        kind: 'binary',
        partName: 'body'
      },
      headers: [
        ['content-type', 'application/octet-stream']
      ],
      method: 'POST',
      url: 'https://example.test/multipart'
    }
  };
  const preamble = encoder.encode([
    `--${boundary}`,
    'Content-Disposition: form-data; name="meta"',
    'Content-Type: application/json',
    '',
    JSON.stringify(meta),
    `--${boundary}`,
    'Content-Disposition: form-data; name="body"; filename="body"',
    'Content-Type: application/octet-stream',
    '',
    ''
  ].join('\r\n'));
  const closing = encoder.encode(`\r\n--${boundary}--\r\n`);

  return new Blob([preamble, expectedBytes, closing]);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
