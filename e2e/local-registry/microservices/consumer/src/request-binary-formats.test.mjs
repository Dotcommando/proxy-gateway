import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createProxyFetch } from '@echospecter/proxy-fetch';

import { waitForJson } from './helpers/http.mjs';

const gatewayBaseUrl =
  process.env.MICRO_GATEWAY_BASE_URL ?? 'http://localhost:8080';
const providerBaseUrl =
  process.env.MICRO_PROVIDER_BASE_URL ?? 'http://localhost:8081';
const serviceUrl = `${gatewayBaseUrl}/fetch`;
const binaryBytes = new Uint8Array([0, 1, 2, 3, 254, 255]);

test('request-binary Uint8Array body reaches provider as raw bytes', async () => {
  const observation = await executeAndReadObservation(
    'https://example.com/request-binary/uint8array?mode=text',
    {
      body: binaryBytes,
      headers: {
        'content-type': 'application/octet-stream',
      },
      method: 'POST',
    },
  );

  assertBytesTargetBody(observation, binaryBytes);
});

test('request-binary ArrayBuffer body reaches provider as raw bytes', async () => {
  const observation = await executeAndReadObservation(
    'https://example.com/request-binary/array-buffer?mode=text',
    {
      body: binaryBytes.buffer.slice(0),
      headers: {
        'content-type': 'application/octet-stream',
      },
      method: 'POST',
    },
  );

  assertBytesTargetBody(observation, binaryBytes);
});

test('request-binary Blob body reaches provider as raw bytes', async () => {
  const observation = await executeAndReadObservation(
    'https://example.com/request-binary/blob?mode=text',
    {
      body: new Blob([binaryBytes], {
        type: 'application/octet-stream',
      }),
      method: 'POST',
    },
  );

  assertBytesTargetBody(observation, binaryBytes);
});

test('request-binary FormData body reaches provider as multipart bytes', async () => {
  const formData = new FormData();
  formData.set('prompt', 'describe this file');
  formData.set('file', new Blob([binaryBytes]), 'input.bin');

  const observation = await executeAndReadObservation(
    'https://example.com/request-binary/form-data?mode=text',
    {
      body: formData,
      method: 'POST',
    },
  );
  const bodyBytes = decodeTargetBody(observation);
  const bodyText = Buffer.from(bodyBytes).toString('utf8');

  assert.equal(observation.targetBody.kind, 'bytes');
  assert.match(
    observation.targetContentType ?? '',
    /^multipart\/form-data; boundary=/u,
  );
  assert.match(bodyText, /name="prompt"/u);
  assert.match(bodyText, /describe this file/u);
  assert.match(bodyText, /filename="input\.bin"/u);
  assert.notEqual(Buffer.from(bodyBytes).indexOf(Buffer.from(binaryBytes)), -1);
});

test('request-binary ReadableStream body reaches provider as raw bytes', async () => {
  const observation = await executeAndReadObservation(
    'https://example.com/request-binary/readable-stream?mode=text',
    {
      body: createReadableStream([
        new Uint8Array([0, 1, 2]),
        new Uint8Array([3, 254, 255]),
      ]),
      duplex: 'half',
      headers: {
        'content-type': 'application/octet-stream',
      },
      method: 'POST',
    },
  );

  assertBytesTargetBody(observation, binaryBytes);
});

test('request-binary JSON base64 fallback preserves raw bytes', async () => {
  const observation = await executeAndReadObservation(
    'https://example.com/request-binary/json-base64?mode=text',
    {
      body: binaryBytes,
      headers: {
        'content-type': 'application/octet-stream',
      },
      method: 'POST',
    },
    {
      binaryBodyTransport: 'json-base64',
    },
  );

  assertBytesTargetBody(observation, binaryBytes);
});

test('request-binary already-consumed Request rejects before gateway call', async () => {
  await resetObservations(gatewayBaseUrl);
  const proxyFetch = createProxyFetch({
    serviceUrl,
    timeoutMs: 10_000,
  });
  const request = new Request('https://example.com/request-binary/consumed', {
    body: 'already consumed',
    method: 'POST',
  });

  await request.text();

  await assert.rejects(proxyFetch(request), {
    name: 'TypeError',
  });
  await assertGatewayWasNotCalled();
});

test('request-binary unsupported dispatcher rejects before gateway call', async () => {
  await resetObservations(gatewayBaseUrl);
  const proxyFetch = createProxyFetch({
    serviceUrl,
    timeoutMs: 10_000,
  });

  await assert.rejects(
    proxyFetch('https://example.com/request-binary/dispatcher', {
      dispatcher: {
        dispatch() {
          throw new Error('dispatcher should not be invoked');
        },
      },
    }),
    /dispatcher/i,
  );
  await assertGatewayWasNotCalled();
});

async function executeAndReadObservation(input, init, proxyFetchOptions = {}) {
  await Promise.all([
    resetObservations(gatewayBaseUrl),
    resetObservations(providerBaseUrl),
  ]);

  const proxyFetch = createProxyFetch({
    binaryBodyTransport: proxyFetchOptions.binaryBodyTransport,
    serviceUrl,
    timeoutMs: 10_000,
  });
  const response = await proxyFetch(input, init);

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'deterministic text response');

  const [gatewayObservations, providerObservations] = await Promise.all([
    waitForJson(`${gatewayBaseUrl}/observations`),
    waitForJson(`${providerBaseUrl}/observations`),
  ]);
  const transportObservation = gatewayObservations.items.find(
    (item) => item.type === 'transport-execute',
  );

  assert.ok(transportObservation);
  assert.equal(providerObservations.items.length, 1);
  assert.deepEqual(
    transportObservation.targetBody,
    providerObservations.items[0].targetBody,
  );

  return providerObservations.items[0];
}

async function resetObservations(baseUrl) {
  const response = await fetch(`${baseUrl}/observations/reset`, {
    method: 'POST',
  });
  assert.equal(response.status, 200);
}

async function assertGatewayWasNotCalled() {
  const observations = await waitForJson(`${gatewayBaseUrl}/observations`);
  assert.deepEqual(observations.items, []);
}

function assertBytesTargetBody(observation, expectedBytes) {
  assert.equal(observation.targetBody.kind, 'bytes');
  assert.equal(observation.targetBody.byteLength, expectedBytes.byteLength);
  assert.equal(observation.targetBody.sha256, sha256(expectedBytes));
  assert.deepEqual(
    Array.from(decodeTargetBody(observation)),
    Array.from(expectedBytes),
  );
}

function decodeTargetBody(observation) {
  return new Uint8Array(Buffer.from(observation.targetBody.base64, 'base64'));
}

function createReadableStream(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }

      controller.close();
    },
  });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
