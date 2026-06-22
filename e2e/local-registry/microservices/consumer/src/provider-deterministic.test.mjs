import assert from 'node:assert/strict';
import test from 'node:test';

import { waitForJson } from './helpers/http.mjs';

const providerBaseUrl =
  process.env.MICRO_PROVIDER_BASE_URL ?? 'http://localhost:8081';

test('mock provider records execute observations', async () => {
  await resetObservations();

  const response = await execute('text');
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'deterministic text response');

  const observations = await getObservations();
  assert.equal(observations.items.length, 1);
  assert.equal(observations.items[0].mode, 'text');
  assert.equal(observations.items[0].path, '/execute');
});

test('mock provider returns body modes', async () => {
  const text = await execute('text');
  assert.equal(text.status, 200);
  assert.match(text.headers.get('content-type') ?? '', /^text\/plain\b/u);
  assert.equal(await text.text(), 'deterministic text response');

  const json = await execute('json');
  assert.equal(json.status, 200);
  assert.match(json.headers.get('content-type') ?? '', /^application\/json\b/u);
  assert.deepEqual(await json.json(), {
    mode: 'json',
    ok: true,
  });

  const binary = await execute('binary');
  assert.equal(binary.status, 200);
  assert.match(
    binary.headers.get('content-type') ?? '',
    /^application\/octet-stream\b/u,
  );
  assert.deepEqual(
    Array.from(new Uint8Array(await binary.arrayBuffer())),
    [0, 1, 2, 3, 254, 255],
  );
});

test('mock provider returns status modes', async () => {
  assert.equal((await execute('no-content-204')).status, 204);
  assert.equal((await execute('reset-content-205')).status, 205);
  assert.equal((await execute('not-modified-304')).status, 304);

  const targetNotFound = await execute('target-404');
  assert.equal(targetNotFound.status, 404);
  assert.equal(await targetNotFound.text(), 'deterministic target 404');

  const targetError = await execute('target-500');
  assert.equal(targetError.status, 500);
  assert.equal(await targetError.text(), 'deterministic target 500');
});

test('mock provider returns slow and failure modes', async () => {
  const startedAt = Date.now();
  const slow = await execute('slow', {
    delayMs: 120,
  });
  assert.equal(slow.status, 200);
  assert.equal(await slow.text(), 'deterministic slow response');
  assert.ok(Date.now() - startedAt >= 100);

  const failure = await execute('provider-failure');
  assert.equal(failure.status, 503);
  assert.deepEqual(await failure.json(), {
    error: 'provider_failure',
    ok: false,
  });
});

test('mock provider returns redirect modes', async () => {
  const safe = await execute('redirect-safe');
  assert.equal(safe.status, 302);
  assert.equal(safe.headers.get('location'), 'https://example.com/final');

  const denied = await execute('redirect-denied');
  assert.equal(denied.status, 302);
  assert.equal(denied.headers.get('location'), 'http://127.0.0.1/private');
});

async function execute(mode, body = {}) {
  return fetch(`${providerBaseUrl}/execute`, {
    body: JSON.stringify({
      mode,
      ...body,
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
    redirect: 'manual',
  });
}

async function getObservations() {
  return waitForJson(`${providerBaseUrl}/observations`);
}

async function resetObservations() {
  const response = await fetch(`${providerBaseUrl}/observations/reset`, {
    method: 'POST',
  });
  assert.equal(response.status, 200);
}
