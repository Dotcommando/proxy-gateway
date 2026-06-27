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

test('request-json no-body request reaches provider as empty target body', async () => {
  const observation = await executeAndReadObservation(
    'https://example.com/request-json/no-body?mode=text',
  );

  assert.equal(observation.targetMethod, 'GET');
  assertTargetBody(observation, {
    kind: 'none',
    text: '',
  });
});

test('request-json string body reaches provider as target text body', async () => {
  const body = 'plain text body from proxy-fetch';
  const observation = await executeAndReadObservation(
    'https://example.com/request-json/string?mode=text',
    {
      body,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
      },
      method: 'POST',
    },
  );

  assert.equal(observation.targetMethod, 'POST');
  assert.match(observation.targetContentType ?? '', /^text\/plain\b/u);
  assertTargetBody(observation, {
    kind: 'text',
    text: body,
  });
});

test('request-json JSON string body reaches provider with JSON content type', async () => {
  const body = JSON.stringify({
    hello: 'world',
    source: 'request-json',
  });
  const observation = await executeAndReadObservation(
    'https://example.com/request-json/json?mode=text',
    {
      body,
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  );

  assert.equal(observation.targetMethod, 'POST');
  assert.match(observation.targetContentType ?? '', /^application\/json\b/u);
  assertTargetBody(observation, {
    kind: 'text',
    text: body,
  });
});

test('request-json URLSearchParams body reaches provider as form text', async () => {
  const params = new URLSearchParams({
    query: 'llm proxy fetch',
  });
  const observation = await executeAndReadObservation(
    'https://example.com/request-json/form?mode=text',
    {
      body: params,
      method: 'POST',
    },
  );

  assert.equal(observation.targetMethod, 'POST');
  assert.match(
    observation.targetContentType ?? '',
    /^application\/x-www-form-urlencoded\b/u,
  );
  assertTargetBody(observation, {
    kind: 'text',
    text: params.toString(),
  });
});

test('request-json Request object text body reaches provider intact as bytes', async () => {
  const body = 'request object text body';
  const request = new Request('https://example.com/request-json/request?mode=text', {
    body,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
    },
    method: 'PUT',
  });
  const observation = await executeAndReadObservation(request);

  assert.equal(observation.targetMethod, 'PUT');
  assert.match(observation.targetContentType ?? '', /^text\/plain\b/u);
  assertTargetBody(observation, {
    kind: 'bytes',
    text: body,
  });
});

async function executeAndReadObservation(input, init) {
  await Promise.all([
    resetObservations(gatewayBaseUrl),
    resetObservations(providerBaseUrl),
  ]);

  const proxyFetch = createProxyFetch({
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

function assertTargetBody(observation, expected) {
  const bytes = new TextEncoder().encode(expected.text);

  assert.equal(observation.targetBody.kind, expected.kind);
  assert.equal(observation.targetBody.byteLength, bytes.byteLength);
  assert.equal(observation.targetBody.sha256, sha256(bytes));

  if (expected.kind === 'text') {
    assert.equal(observation.targetBody.text, expected.text);
  }

  if (expected.kind === 'bytes') {
    assert.equal(
      Buffer.from(observation.targetBody.base64, 'base64').toString('utf8'),
      expected.text,
    );
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
