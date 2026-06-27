import assert from 'node:assert/strict';
import test from 'node:test';

import { createProxyFetch } from '@echospecter/proxy-fetch';

import { waitForJson } from './helpers/http.mjs';

const gatewayBaseUrl =
  process.env.MICRO_GATEWAY_BASE_URL ?? 'http://localhost:8080';
const providerBaseUrl =
  process.env.MICRO_PROVIDER_BASE_URL ?? 'http://localhost:8081';
const serviceUrl = `${gatewayBaseUrl}/fetch`;
const targetBaseUrl = 'https://example.com/fetch-metadata';

test('fetch-metadata serializes non-default Fetch metadata to gateway and provider', async () => {
  const expectedFetch = {
    cache: 'no-store',
    credentials: 'include',
    integrity: 'sha256-abc',
    keepalive: true,
    mode: 'no-cors',
    redirect: 'manual',
    referrer: 'https://referrer.example/path',
    referrerPolicy: 'no-referrer',
  };
  const { gatewayObservations, providerObservations, response } = await execute(
    'text',
    {
      cache: expectedFetch.cache,
      credentials: expectedFetch.credentials,
      integrity: expectedFetch.integrity,
      keepalive: expectedFetch.keepalive,
      mode: expectedFetch.mode,
      redirect: expectedFetch.redirect,
      referrer: expectedFetch.referrer,
      referrerPolicy: expectedFetch.referrerPolicy,
    },
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'deterministic text response');
  assert.deepEqual(
    findObservation(gatewayObservations, 'transport-execute').targetFetch,
    expectedFetch,
  );
  assert.deepEqual(providerObservations.items[0].targetFetch, expectedFetch);
});

test('fetch-metadata serializes duplex half for ReadableStream request bodies', async () => {
  const { gatewayObservations, providerObservations, response } = await execute(
    'text',
    {
      body: createReadableStream([
        new Uint8Array([1, 2, 3]),
        new Uint8Array([4, 5, 6]),
      ]),
      duplex: 'half',
      headers: {
        'content-type': 'application/octet-stream',
      },
      method: 'POST',
    },
    {
      path: '/fetch-metadata/duplex',
    },
  );
  const expectedFetch = {
    duplex: 'half',
  };

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'deterministic text response');
  assert.deepEqual(
    findObservation(gatewayObservations, 'transport-execute').targetFetch,
    expectedFetch,
  );
  assert.deepEqual(providerObservations.items[0].targetFetch, expectedFetch);
});

test('fetch-metadata controlled redirect checks final URL guard', async () => {
  const { gatewayObservations, providerObservations, response } = await execute(
    'redirect-safe',
    {
      redirect: 'manual',
    },
    {
      path: '/fetch-metadata/redirect',
    },
  );
  const finalUrlCheck = findObservation(gatewayObservations, 'final-url-check');

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://example.com/final');
  assert.equal(providerObservations.items[0].targetFetch.redirect, 'manual');
  assert.deepEqual(finalUrlCheck.result, {
    kind: 'allowed',
  });
  assert.equal(finalUrlCheck.location, 'https://example.com/final');
});

async function execute(mode, init = {}, options = {}) {
  await Promise.all([
    resetObservations(gatewayBaseUrl),
    resetObservations(providerBaseUrl),
  ]);

  const proxyFetch = createProxyFetch({
    serviceUrl,
    timeoutMs: 10_000,
  });
  const response = await proxyFetch(targetUrlForMode(mode, options), init);
  const [gatewayObservations, providerObservations] = await Promise.all([
    waitForJson(`${gatewayBaseUrl}/observations`),
    waitForJson(`${providerBaseUrl}/observations`),
  ]);

  assert.equal(providerObservations.items.length, 1);
  assert.equal(providerObservations.items[0].mode, mode);

  return {
    gatewayObservations,
    providerObservations,
    response,
  };
}

function targetUrlForMode(mode, options = {}) {
  const path = options.path ?? `/fetch-metadata/${mode}`;

  return `${targetBaseUrl}${path}?mode=${encodeURIComponent(mode)}`;
}

async function resetObservations(baseUrl) {
  const response = await fetch(`${baseUrl}/observations/reset`, {
    method: 'POST',
  });
  assert.equal(response.status, 200);
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

function findObservation(observations, type) {
  const observation = observations.items.find((item) => item.type === type);

  assert.ok(observation);

  return observation;
}
