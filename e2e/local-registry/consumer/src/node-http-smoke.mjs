import { createServer } from 'node:http';

import {
  createNodeHttpHandler,
  createProxyGateway
} from '@echospecter/proxy-gateway';

import {
  createProvider,
  createProxyFetchEnvelope,
  createTransport
} from './smoke-common.mjs';

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
  transport: createTransport()
});
const handler = createNodeHttpHandler(gateway);
const server = createServer((request, response) => {
  void handler(request, response);
});

try {
  const address = await listen(server);
  const response = await fetch(`http://127.0.0.1:${address.port}/proxy-fetch`, {
    body: JSON.stringify(createProxyFetchEnvelope()),
    headers: {
      accept: 'application/json',
      'content-type': 'application/json'
    },
    method: 'POST'
  });
  const envelope = await response.json();

  if (response.status !== 200) {
    throw new Error(`node-http smoke expected service HTTP 200, got ${response.status}`);
  }
  if (envelope.ok !== true) {
    throw new Error(`node-http smoke expected ok=true: ${JSON.stringify(envelope)}`);
  }
  if (envelope.response?.body?.kind !== 'text') {
    throw new Error(`node-http smoke expected text body: ${JSON.stringify(envelope)}`);
  }

  console.log('node http handler: ok');
} finally {
  await close(server);
}

function listen(serverToListen) {
  return new Promise((resolve, reject) => {
    serverToListen.once('error', reject);
    serverToListen.listen(0, '127.0.0.1', () => {
      serverToListen.off('error', reject);

      const address = serverToListen.address();

      if (address === null || typeof address === 'string') {
        reject(new Error('node-http smoke could not read server port'));

        return;
      }

      resolve(address);
    });
  });
}

function close(serverToClose) {
  return new Promise((resolve, reject) => {
    serverToClose.close((error) => {
      if (error) {
        reject(error);

        return;
      }

      resolve();
    });
  });
}
