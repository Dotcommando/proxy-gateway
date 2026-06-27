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

test('timeout-abort local proxy-fetch timeout aborts streaming upload before planning', async () => {
  await resetAllObservations();

  let uploadCancelled = false;
  const proxyFetch = createProxyFetch({
    serviceUrl,
    timeoutMs: 50,
  });
  const requestPromise = proxyFetch(
    timeoutAbortUrl('/local', 'text'),
    {
      body: blockingUploadStream(() => {
        uploadCancelled = true;
      }),
      duplex: 'half',
      headers: {
        'content-type': 'application/octet-stream',
      },
      method: 'POST',
    },
  );

  await assert.rejects(requestPromise, (error) => {
    assert.equal(error.name, 'TimeoutError');
    assert.equal(error.message, 'Proxy fetch request timed out after 50 ms.');

    return true;
  });
  await delay(100);

  const observations = await readAllObservations();

  assert.equal(uploadCancelled, true);
  assert.deepEqual(observations.gateway.items, []);
  assert.deepEqual(observations.provider.items, []);
});

test('timeout-abort serialized timeoutMs stops gateway before fallback', async () => {
  await resetAllObservations();

  const proxyFetch = createProxyFetch({
    fetchImpl: createSerializedTimeoutFetch(75),
    serviceUrl,
    timeoutMs: 10_000,
  });
  const error = await executeExpectingServiceError(proxyFetch, '/total', {
    delayMs: 1_000,
    mode: 'timeout-abort-gateway-delay',
  });
  const observations = await waitForObservations(({ gateway }) =>
    releaseObservations(gateway).some((item) => item.outcome === 'gateway-timeout'),
  );

  assertServiceError(error, {
    code: 'SERVICE_HTTP_ERROR',
    retryable: false,
  });
  assert.equal(error.details.status, 504);
  assertNoFallback(observations.gateway, 'gateway-timeout');
  assert.deepEqual(observations.provider.items, []);
});

test('timeout-abort caller AbortSignal aborts streaming upload before planning', async () => {
  await resetAllObservations();

  const controller = new AbortController();
  let uploadCancelled = false;
  const proxyFetch = createProxyFetch({
    serviceUrl,
    timeoutMs: 10_000,
  });
  const requestPromise = proxyFetch(
    timeoutAbortUrl('/caller', 'text'),
    {
      body: blockingUploadStream(() => {
        uploadCancelled = true;
      }),
      duplex: 'half',
      headers: {
        'content-type': 'application/octet-stream',
      },
      method: 'POST',
      signal: controller.signal,
    },
  );

  await delay(50);

  controller.abort(new DOMException('Caller stopped.', 'AbortError'));

  await assert.rejects(requestPromise, (error) => {
    assert.equal(error.name, 'AbortError');
    assert.equal(error.message, 'Caller stopped.');

    return true;
  });
  await delay(100);

  const observations = await readAllObservations();

  assert.equal(uploadCancelled, true);
  assert.deepEqual(observations.gateway.items, []);
  assert.deepEqual(observations.provider.items, []);
});

test('timeout-abort per-attempt timeout can fallback when policy allows it', async () => {
  await resetAllObservations();

  const proxyFetch = createProxyFetch({
    serviceUrl,
    timeoutMs: 10_000,
  });
  const response = await proxyFetch(
    timeoutAbortUrl('/attempt', 'timeout-abort-attempt', {
      delayMs: 1_000,
    }),
  );
  const observations = await readAllObservations();

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'attempt timeout fallback response');
  assert.deepEqual(
    acquireObservations(observations.gateway).map((item) => item.selectedProvider),
    ['fallback-primary-provider', 'fallback-secondary-provider'],
  );
  assert.deepEqual(
    transportObservations(observations.gateway).map((item) => item.routeProvider),
    ['fallback-primary-provider', 'fallback-secondary-provider'],
  );
  assert.deepEqual(
    releaseObservations(observations.gateway).map((item) => item.outcome),
    ['target-timeout', 'success'],
  );
  assert.deepEqual(observations.provider.items, []);
});

async function executeExpectingServiceError(proxyFetch, path, options) {
  try {
    await proxyFetch(timeoutAbortUrl(path, options.mode, options));
  } catch (error) {
    return error;
  }

  assert.fail('Expected proxyFetch to reject with a service error.');
}

function createSerializedTimeoutFetch(timeoutMs) {
  return async (url, init) => {
    assert.equal(typeof init.body, 'string');

    const payload = JSON.parse(init.body);
    const nextPayload = {
      ...payload,
      options: {
        ...payload.options,
        timeoutMs,
      },
    };

    return fetch(url, {
      ...init,
      body: JSON.stringify(nextPayload),
    });
  };
}

function timeoutAbortUrl(path, mode, options = {}) {
  const searchParams = new URLSearchParams({
    mode,
  });

  if (options.delayMs !== undefined) {
    searchParams.set('delayMs', String(options.delayMs));
  }

  return `https://timeout-abort.policy.example.com${path}?${searchParams}`;
}

function blockingUploadStream(onCancel) {
  const chunk = new TextEncoder().encode('timeout-abort-upload-start');

  return new ReadableStream({
    pull(controller) {
      controller.enqueue(chunk);

      return new Promise(() => undefined);
    },
    cancel() {
      onCancel();
    },
  });
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

async function waitForObservations(predicate) {
  const deadline = Date.now() + 4_000;
  let observations;

  while (Date.now() <= deadline) {
    observations = await readAllObservations();

    if (predicate(observations)) {
      return observations;
    }

    await delay(25);
  }

  assert.fail(
    `Timed out waiting for observations. Last observations: ${JSON.stringify(observations)}`,
  );
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

function assertNoFallback(gatewayObservations, expectedOutcome) {
  assert.deepEqual(
    acquireObservations(gatewayObservations).map((item) => item.selectedProvider),
    ['fallback-primary-provider'],
  );
  assert.deepEqual(
    transportObservations(gatewayObservations).map((item) => item.routeProvider),
    ['fallback-primary-provider'],
  );
  assert.deepEqual(
    releaseObservations(gatewayObservations).map((item) => item.outcome),
    [expectedOutcome],
  );
}

function assertServiceError(error, expected) {
  assert.ok(error instanceof ProxyFetchServiceError);
  assert.equal(error.name, 'ProxyFetchServiceError');
  assert.equal(error.code, expected.code);
  assert.equal(error.retryable, expected.retryable);
}
