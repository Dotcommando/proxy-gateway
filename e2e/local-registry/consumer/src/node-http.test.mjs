import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNodeHttpHandler,
  createProxyGateway
} from '@echospecter/proxy-gateway';

import {
  createProvider,
  createProxyFetchEnvelope,
  createTransport
} from './test-common.mjs';

test('node HTTP handler delegates to the installed gateway', async () => {
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

  const address = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/proxy-fetch`, {
      body: JSON.stringify(createProxyFetchEnvelope()),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json'
      },
      method: 'POST'
    });
    const envelope = await response.json();

    assert.equal(response.status, 200);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.response?.body?.kind, 'text');
  } finally {
    await close(server);
  }
});

function listen(serverToListen) {
  return new Promise((resolve, reject) => {
    serverToListen.once('error', reject);
    serverToListen.listen(0, '127.0.0.1', () => {
      serverToListen.off('error', reject);

      const address = serverToListen.address();

      if (address === null || typeof address === 'string') {
        reject(new Error('node-http test could not read server port'));

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
