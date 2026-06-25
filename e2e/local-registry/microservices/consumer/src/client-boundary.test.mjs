import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROXY_FETCH_SERVICE_URL_ENV,
  createProxyFetch,
} from '@echospecter/proxy-fetch';

import { waitForJson } from './helpers/http.mjs';

const gatewayBaseUrl =
  process.env.MICRO_GATEWAY_BASE_URL ?? 'http://localhost:8080';
const providerBaseUrl =
  process.env.MICRO_PROVIDER_BASE_URL ?? 'http://localhost:8081';
const serviceUrl = `${gatewayBaseUrl}/fetch`;
const targetUrl = 'https://example.com/client-boundary?mode=text';
const serviceApiKey = 'service-api-key-for-boundary-test';
const targetAuthorization = 'Bearer target-token-for-boundary-test';

test('client-boundary PROXY_FETCH_SERVICE_URL env fallback reaches micro-gateway', async () => {
  const previousServiceUrl = process.env[PROXY_FETCH_SERVICE_URL_ENV];

  process.env[PROXY_FETCH_SERVICE_URL_ENV] = serviceUrl;

  try {
    const { response } = await executeWithProxyFetch(createProxyFetch({
      timeoutMs: 10_000,
    }));

    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'deterministic text response');
  } finally {
    restoreEnv(PROXY_FETCH_SERVICE_URL_ENV, previousServiceUrl);
  }
});

test('client-boundary explicit serviceUrl overrides env fallback', async () => {
  const previousServiceUrl = process.env[PROXY_FETCH_SERVICE_URL_ENV];

  process.env[PROXY_FETCH_SERVICE_URL_ENV] = 'http://127.0.0.1:1/wrong';

  try {
    const { response } = await executeWithProxyFetch(createProxyFetch({
      serviceUrl,
      timeoutMs: 10_000,
    }));

    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'deterministic text response');
  } finally {
    restoreEnv(PROXY_FETCH_SERVICE_URL_ENV, previousServiceUrl);
  }
});

test('client-boundary service apiKey stays on service request only', async () => {
  const { gatewayObservations, providerObservations, response } =
    await executeWithProxyFetch(createProxyFetch({
      apiKey: serviceApiKey,
      fetchImpl: observeServiceFetch,
      serviceUrl,
      timeoutMs: 10_000,
    }));

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'deterministic text response');

  const serviceRequest = findObservation(gatewayObservations, 'service-request');

  assert.equal(
    readHeader(serviceRequest.headers, 'authorization'),
    `Bearer ${serviceApiKey}`,
  );
  assert.equal(
    readHeader(providerObservations.items[0].targetHeaders, 'authorization'),
    null,
  );
});

test('client-boundary target authorization reaches provider target headers', async () => {
  const { providerObservations, response } = await executeWithProxyFetch(
    createProxyFetch({
      serviceUrl,
      timeoutMs: 10_000,
    }),
    {
      headers: {
        authorization: targetAuthorization,
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'deterministic text response');
  assert.equal(
    readHeader(providerObservations.items[0].targetHeaders, 'authorization'),
    targetAuthorization,
  );
});

test('client-boundary defaultHeaders reach target headers', async () => {
  const { providerObservations, response } = await executeWithProxyFetch(
    createProxyFetch({
      defaultHeaders: {
        'x-client-boundary-default': 'default-target-header',
      },
      serviceUrl,
      timeoutMs: 10_000,
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'deterministic text response');
  assert.equal(
    readHeader(
      providerObservations.items[0].targetHeaders,
      'x-client-boundary-default',
    ),
    'default-target-header',
  );
});

test('client-boundary request headers override defaultHeaders', async () => {
  const { providerObservations, response } = await executeWithProxyFetch(
    createProxyFetch({
      defaultHeaders: {
        'x-client-boundary-override': 'default-value',
      },
      serviceUrl,
      timeoutMs: 10_000,
    }),
    {
      headers: {
        'x-client-boundary-override': 'request-value',
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'deterministic text response');
  assert.equal(
    readHeader(
      providerObservations.items[0].targetHeaders,
      'x-client-boundary-override',
    ),
    'request-value',
  );
});

test('client-boundary defaultContext and request context merge at gateway', async () => {
  const { gatewayObservations, response } = await executeWithProxyFetch(
    createProxyFetch({
      defaultContext: {
        consistency: 'same-session',
        flowKey: 'default-flow',
        metadata: {
          shared: 'default-value',
          tenant: 'tenant-a',
        },
      },
      serviceUrl,
      timeoutMs: 10_000,
    }),
    {
      context: {
        metadata: {
          requestId: 'request-a',
          shared: 'request-value',
        },
        useCase: 'client-boundary',
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'deterministic text response');

  const providerAcquire = findObservation(gatewayObservations, 'provider-acquire');

  assert.deepEqual(providerAcquire.context, {
    consistency: 'same-session',
    flowKey: 'default-flow',
    metadata: {
      requestId: 'request-a',
      shared: 'request-value',
      tenant: 'tenant-a',
    },
    useCase: 'client-boundary',
  });
});

async function executeWithProxyFetch(proxyFetch, init = {}) {
  await Promise.all([
    resetObservations(gatewayBaseUrl),
    resetObservations(providerBaseUrl),
  ]);

  const response = await proxyFetch(targetUrl, init);
  const [gatewayObservations, providerObservations] = await Promise.all([
    waitForJson(`${gatewayBaseUrl}/observations`),
    waitForJson(`${providerBaseUrl}/observations`),
  ]);

  assert.equal(providerObservations.items.length, 1);
  assert.equal(providerObservations.items[0].mode, 'text');

  return {
    gatewayObservations,
    providerObservations,
    response,
  };
}

async function resetObservations(baseUrl) {
  const response = await fetch(`${baseUrl}/observations/reset`, {
    method: 'POST',
  });
  assert.equal(response.status, 200);
}

function observeServiceFetch(input, init) {
  const headers = new Headers(
    input instanceof Request ? input.headers : init?.headers,
  );
  headers.set('x-client-boundary-observe-service', '1');

  if (input instanceof Request) {
    return fetch(new Request(input, {
      headers,
    }));
  }

  return fetch(input, {
    ...init,
    headers,
  });
}

function readHeader(headers, name) {
  if (!Array.isArray(headers)) {
    return null;
  }

  const normalizedName = name.toLowerCase();
  const header = headers.find(
    (entry) =>
      Array.isArray(entry)
      && entry.length >= 2
      && String(entry[0]).toLowerCase() === normalizedName,
  );

  return header === undefined ? null : String(header[1]);
}

function findObservation(observations, type) {
  const observation = observations.items.find((item) => item.type === type);

  assert.ok(observation);

  return observation;
}

function restoreEnv(name, previousValue) {
  if (previousValue === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = previousValue;
}
