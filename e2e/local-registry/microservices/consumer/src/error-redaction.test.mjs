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
const noRouteServiceUrl = `${gatewayBaseUrl}/fetch-no-route`;

test('error-redaction target access denied before provider execution', async () => {
  await resetAllObservations();

  const { captured, proxyFetch } = createCapturedProxyFetch(serviceUrl);
  const error = await executeExpectingServiceHttpError(
    proxyFetch,
    'http://127.0.0.1/private?token=target-token',
    {
      headers: {
        authorization: 'Bearer target-token',
        cookie: 'session=target-cookie',
      },
    },
  );
  const observations = await readAllObservations();

  assertServiceHttpError(error, 403);
  assert.equal(captured.body.error.code, 'TARGET_ACCESS_DENIED');
  assert.deepEqual(observations.gateway.items, []);
  assert.deepEqual(observations.provider.items, []);
});

test('error-redaction no route matched before provider execution', async () => {
  await resetAllObservations();

  const { captured, proxyFetch } = createCapturedProxyFetch(noRouteServiceUrl);
  const error = await executeExpectingServiceHttpError(
    proxyFetch,
    'https://unmatched.error-redaction.example.com/resource?token=target-token',
  );
  const observations = await readAllObservations();

  assertServiceHttpError(error, 404);
  assert.equal(captured.body.error.code, 'NO_ROUTE_MATCHED');
  assert.deepEqual(observations.gateway.items, []);
  assert.deepEqual(observations.provider.items, []);
});

test('error-redaction transport failure exposes only redacted diagnostics', async () => {
  await resetAllObservations();

  const { captured, proxyFetch } = createCapturedProxyFetch(serviceUrl, {
    apiKey: 'service-api-secret',
  });
  const error = await executeExpectingServiceHttpError(
    proxyFetch,
    errorRedactionFailureUrl(),
    {
      headers: {
        accept: 'application/json',
        authorization: 'Bearer target-token',
        cookie: 'session=target-cookie',
        'x-api-key': 'target-api-key',
      },
    },
  );
  const observations = await readAllObservations();
  const serializedBody = JSON.stringify(captured.body);

  assertServiceHttpError(error, 502);
  assert.equal(captured.body.error.code, 'TARGET_TRANSPORT_ERROR');
  assert.equal(captured.body.error.retryable, true);
  assert.deepEqual(captured.body.error.details.target.headers, [
    ['accept', 'application/json'],
    ['authorization', '<redacted>'],
    ['cookie', '<redacted>'],
    ['x-api-key', '<redacted>'],
  ]);
  assert.equal(
    captured.body.error.details.target.url,
    'https://error-redaction.policy.example.com/models?api_key=%3Credacted%3E&token=%3Credacted%3E&password=%3Credacted%3E&name=model&mode=error-redaction-transport-failure',
  );
  assert.deepEqual(captured.body.error.details.route.auth, {
    mode: 'username-password',
  });
  assert.equal(captured.body.error.details.route.host, 'proxy.example.com');
  assert.equal(captured.body.error.details.route.protocol, 'http');
  assert.doesNotMatch(serializedBody, /target-password/u);
  assert.doesNotMatch(serializedBody, /target-token|target-cookie|target-api-key|target-key/u);
  assert.doesNotMatch(serializedBody, /route-user|route-password|route-token/u);
  assert.doesNotMatch(serializedBody, /service-api-secret/u);
  assert.deepEqual(
    acquireObservations(observations.gateway).map((item) => item.selectedProvider),
    ['micro-provider'],
  );
  assert.deepEqual(
    transportObservations(observations.gateway).map((item) => item.mode),
    ['error-redaction-transport-failure'],
  );
  assert.deepEqual(
    releaseObservations(observations.gateway).map((item) => item.outcome),
    ['target-network-error'],
  );
  assert.deepEqual(observations.provider.items, []);
});

function createCapturedProxyFetch(serviceEndpoint, options = {}) {
  const captured = {
    body: undefined,
    status: undefined,
  };
  const proxyFetch = createProxyFetch({
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
    fetchImpl: async (url, init) => {
      const response = await fetch(url, init);

      captured.status = response.status;
      captured.body = await response.clone().json();

      return response;
    },
    serviceUrl: serviceEndpoint,
    timeoutMs: 10_000,
  });

  return {
    captured,
    proxyFetch,
  };
}

async function executeExpectingServiceHttpError(proxyFetch, url, init = {}) {
  try {
    await proxyFetch(url, init);
  } catch (error) {
    return error;
  }

  assert.fail('Expected proxyFetch to reject with a service HTTP error.');
}

function errorRedactionFailureUrl() {
  return 'https://error-redaction.policy.example.com/models?api_key=target-key&token=target-token&password=target-password&name=model&mode=error-redaction-transport-failure';
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

function assertServiceHttpError(error, status) {
  assert.ok(error instanceof ProxyFetchServiceError);
  assert.equal(error.name, 'ProxyFetchServiceError');
  assert.equal(error.code, 'SERVICE_HTTP_ERROR');
  assert.equal(error.retryable, false);
  assert.equal(error.details.status, status);
}
