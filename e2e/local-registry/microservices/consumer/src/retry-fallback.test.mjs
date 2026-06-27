import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  ProxyFetchServiceError,
  createProxyFetch,
} from '@echospecter/proxy-fetch';

import { waitForJson } from './helpers/http.mjs';

const gatewayBaseUrl =
  process.env.MICRO_GATEWAY_BASE_URL ?? 'http://localhost:8080';
const providerBaseUrl =
  process.env.MICRO_PROVIDER_BASE_URL ?? 'http://localhost:8081';
const serviceUrl = `${gatewayBaseUrl}/fetch`;

test('retry-fallback preserves replayable body across fallback attempts', async () => {
  const body = 'retry fallback replayable body';
  const result = await executeRetryFallback('/replayable', {
    body,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
    },
    method: 'OPTIONS',
  });

  assert.equal(result.response.status, 200);
  assert.equal(await result.response.text(), 'retry fallback replayable response');
  assertFallbackSequence(result.gatewayObservations, {
    expectedOutcomes: ['target-network-error', 'success'],
  });
  assert.equal(result.providerObservations.items.length, 1);
  assert.equal(result.providerObservations.items[0].mode, 'retry-fallback-replayable');
  assert.equal(
    result.providerObservations.items[0].requestId,
    transportObservations(result.gatewayObservations)[1].requestId,
  );
  assertTargetTextBody(result.providerObservations.items[0].targetBody, body);
});

test('retry-fallback does not retry when request body becomes non-replayable', async () => {
  const body = Uint8Array.from({ length: 8192 }, (_, index) => index % 256);
  const error = await executeRetryFallbackExpectingServiceError(
    '/non-replayable',
    {
      body,
      headers: {
        'content-type': 'application/octet-stream',
      },
      method: 'OPTIONS',
    },
    {
      binaryBodyTransport: 'json-base64',
    },
  );
  const observations = await readAllObservations();

  assertServiceError(error);
  assertSingleFailedPrimaryAttempt(observations.gateway);
  assert.deepEqual(observations.provider.items, []);
  assert.equal(
    transportObservations(observations.gateway)[0].targetBody.replayability,
    'non-replayable',
  );
  assert.equal(transportObservations(observations.gateway)[0].targetBody.sizeBytes, 8192);
});

test('retry-fallback does not retry unsafe POST without explicit retry policy allowance', async () => {
  const error = await executeRetryFallbackExpectingServiceError('/unsafe', {
    body: 'unsafe retry body',
    headers: {
      'content-type': 'text/plain; charset=utf-8',
    },
    method: 'POST',
  });
  const observations = await readAllObservations();

  assertServiceError(error);
  assertSingleFailedPrimaryAttempt(observations.gateway);
  assert.deepEqual(observations.provider.items, []);
  assert.equal(transportObservations(observations.gateway)[0].targetMethod, 'POST');
});

async function executeRetryFallback(path, init) {
  await resetAllObservations();

  const proxyFetch = createProxyFetch({
    serviceUrl,
    timeoutMs: 10_000,
  });
  const response = await proxyFetch(retryFallbackUrl(path), init);
  const observations = await readAllObservations();

  return {
    gatewayObservations: observations.gateway,
    providerObservations: observations.provider,
    response,
  };
}

async function executeRetryFallbackExpectingServiceError(path, init, options = {}) {
  await resetAllObservations();

  const proxyFetch = createProxyFetch({
    ...(options.binaryBodyTransport === undefined
      ? {}
      : { binaryBodyTransport: options.binaryBodyTransport }),
    serviceUrl,
    timeoutMs: 10_000,
  });

  try {
    await proxyFetch(retryFallbackUrl(path), init);
  } catch (error) {
    return error;
  }

  assert.fail('Expected proxyFetch to reject with a service error.');
}

function retryFallbackUrl(path) {
  const mode = `retry-fallback-${path.slice(1)}`;

  return `https://retry-fallback.policy.example.com${path}?mode=${mode}`;
}

async function resetAllObservations() {
  await Promise.all([
    resetObservations(gatewayBaseUrl),
    resetObservations(providerBaseUrl),
  ]);
}

async function resetObservations(baseUrl) {
  const response = await fetch(`${baseUrl}/observations/reset`, {
    method: 'POST',
  });
  assert.equal(response.status, 200);
}

async function readAllObservations() {
  const [gateway, provider] = await Promise.all([
    waitForJson(`${gatewayBaseUrl}/observations`),
    waitForJson(`${providerBaseUrl}/observations`),
  ]);

  return {
    gateway,
    provider,
  };
}

function assertFallbackSequence(gatewayObservations, { expectedOutcomes }) {
  assert.deepEqual(
    providerAcquireObservations(gatewayObservations).map(
      (item) => item.selectedProvider,
    ),
    ['fallback-primary-provider', 'fallback-secondary-provider'],
  );
  assert.deepEqual(
    transportObservations(gatewayObservations).map((item) => item.routeProvider),
    ['fallback-primary-provider', 'fallback-secondary-provider'],
  );
  assert.deepEqual(
    releaseObservations(gatewayObservations).map((item) => item.outcome),
    expectedOutcomes,
  );
}

function assertSingleFailedPrimaryAttempt(gatewayObservations) {
  assert.deepEqual(
    providerAcquireObservations(gatewayObservations).map(
      (item) => item.selectedProvider,
    ),
    ['fallback-primary-provider'],
  );
  assert.deepEqual(
    transportObservations(gatewayObservations).map((item) => item.routeProvider),
    ['fallback-primary-provider'],
  );
  assert.deepEqual(
    releaseObservations(gatewayObservations).map((item) => item.outcome),
    ['target-network-error'],
  );
}

function providerAcquireObservations(gatewayObservations) {
  return gatewayObservations.items.filter((item) => item.type === 'provider-acquire');
}

function transportObservations(gatewayObservations) {
  return gatewayObservations.items.filter((item) => item.type === 'transport-execute');
}

function releaseObservations(gatewayObservations) {
  return gatewayObservations.items.filter((item) => item.type === 'provider-release');
}

function assertTargetTextBody(targetBody, expectedText) {
  const bytes = new TextEncoder().encode(expectedText);

  assert.equal(targetBody.kind, 'text');
  assert.equal(targetBody.byteLength, bytes.byteLength);
  assert.equal(targetBody.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(targetBody.text, expectedText);
}

function assertServiceError(error) {
  assert.ok(error instanceof ProxyFetchServiceError);
  assert.equal(error.name, 'ProxyFetchServiceError');
  assert.equal(typeof error.code, 'string');
  assert.equal(error.retryable, false);
}
