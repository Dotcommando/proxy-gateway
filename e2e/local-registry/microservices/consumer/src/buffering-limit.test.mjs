import assert from 'node:assert/strict';
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
const largeBody = Uint8Array.from({ length: 8192 }, (_, index) => index % 256);

test('buffering-limit rejects oversized multipart service body before planning', async () => {
  const error = await executeExpectingServiceError('/parser', {
    body: largeBody,
    headers: {
      'content-type': 'application/octet-stream',
    },
    method: 'OPTIONS',
  });
  const observations = await readAllObservations();

  assertServiceError(error);
  assert.deepEqual(observations.gateway.items, []);
  assert.deepEqual(observations.provider.items, []);
});

test('buffering-limit marks oversized JSON-base64 target body non-replayable before retry', async () => {
  const error = await executeExpectingServiceError(
    '/request-non-replayable',
    {
      body: largeBody,
      headers: {
        'content-type': 'application/octet-stream',
      },
      method: 'OPTIONS',
    },
    {
      binaryBodyTransport: 'json-base64',
      mode: 'buffering-limit-request-non-replayable',
    },
  );
  const observations = await readAllObservations();
  const transport = transportObservations(observations.gateway)[0];

  assertServiceError(error);
  assert.deepEqual(
    acquireObservations(observations.gateway).map((item) => item.selectedProvider),
    ['fallback-primary-provider'],
  );
  assert.equal(transport.targetBody.kind, 'stream');
  assert.equal(transport.targetBody.replayability, 'non-replayable');
  assert.equal(transport.targetBody.sizeBytes, largeBody.byteLength);
  assert.deepEqual(
    releaseObservations(observations.gateway).map((item) => item.outcome),
    ['target-network-error'],
  );
  assert.deepEqual(observations.provider.items, []);
});

test('buffering-limit rejects oversized target response while building service response', async () => {
  const error = await executeExpectingServiceError('/response', undefined, {
    mode: 'buffering-limit-response',
  });
  const observations = await readAllObservations();

  assertServiceError(error);
  assert.deepEqual(
    acquireObservations(observations.gateway).map((item) => item.selectedProvider),
    ['micro-provider'],
  );
  assert.deepEqual(
    transportObservations(observations.gateway).map((item) => item.mode),
    ['buffering-limit-response'],
  );
  assert.deepEqual(
    releaseObservations(observations.gateway).map((item) => item.outcome),
    ['gateway-error'],
  );
  assert.deepEqual(observations.provider.items, []);
});

async function executeExpectingServiceError(path, init = {}, options = {}) {
  await resetAllObservations();

  const proxyFetch = createProxyFetch({
    ...(options.binaryBodyTransport === undefined
      ? {}
      : { binaryBodyTransport: options.binaryBodyTransport }),
    serviceUrl,
    timeoutMs: 10_000,
  });

  try {
    await proxyFetch(bufferingLimitUrl(path, options), init);
  } catch (error) {
    return error;
  }

  assert.fail('Expected proxyFetch to reject with a service error.');
}

function bufferingLimitUrl(path, options = {}) {
  const mode = options.mode ?? 'text';

  return `https://buffering-limit.policy.example.com${path}?mode=${mode}`;
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

function acquireObservations(gatewayObservations) {
  return gatewayObservations.items.filter((item) => item.type === 'provider-acquire');
}

function transportObservations(gatewayObservations) {
  return gatewayObservations.items.filter((item) => item.type === 'transport-execute');
}

function releaseObservations(gatewayObservations) {
  return gatewayObservations.items.filter((item) => item.type === 'provider-release');
}

function assertServiceError(error) {
  assert.ok(error instanceof ProxyFetchServiceError);
  assert.equal(error.name, 'ProxyFetchServiceError');
  assert.equal(typeof error.code, 'string');
  assert.equal(error.retryable, false);
}
