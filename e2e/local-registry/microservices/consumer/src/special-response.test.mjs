import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INVALID_SERVICE_RESPONSE_CODE,
  WIRE_PROTOCOL_VERSION,
  createProxyFetch,
  InvalidServiceResponseError,
} from '@echospecter/proxy-fetch';

import { waitForJson } from './helpers/http.mjs';

const gatewayBaseUrl =
  process.env.MICRO_GATEWAY_BASE_URL ?? 'http://localhost:8080';
const providerBaseUrl =
  process.env.MICRO_PROVIDER_BASE_URL ?? 'http://localhost:8081';
const serviceUrl = `${gatewayBaseUrl}/fetch`;
const targetUrl = 'https://example.com/special-response';
const invalidServiceUrl = 'https://proxy-fetch-service.example';

test('special-response gateway returns valid Response.error envelope', async () => {
  await assertSpecialGatewayResponse('error');
});

test('special-response gateway returns valid opaque envelope', async () => {
  await assertSpecialGatewayResponse('opaque');
});

test('special-response gateway returns valid opaqueredirect envelope', async () => {
  await assertSpecialGatewayResponse('opaqueredirect');
});

test('special-response invalid JSON service response rejects before gateway call', async () => {
  const proxyFetch = createProxyFetchForServiceResponse(
    () =>
      new Response('not-json', {
        headers: {
          'content-type': 'application/json',
        },
        status: 200,
      }),
  );

  await assertInvalidServiceResponse(proxyFetch);
});

test('special-response unsupported wire version rejects before gateway call', async () => {
  const proxyFetch = createProxyFetchForServiceResponse(() =>
    jsonServiceResponse({
      ok: true,
      response: basicServiceResponse(),
      version: 'proxy-fetch.v2',
    }),
  );

  await assertInvalidServiceResponse(proxyFetch);
});

test('special-response unsupported response body kind rejects before gateway call', async () => {
  const proxyFetch = createProxyFetchForServiceResponse(() =>
    jsonServiceResponse({
      ok: true,
      response: {
        ...basicServiceResponse(),
        body: {
          kind: 'stream',
          partName: 'body',
        },
      },
      version: WIRE_PROTOCOL_VERSION,
    }),
  );

  await assertInvalidServiceResponse(proxyFetch);
});

test('special-response impossible special envelope rejects before gateway call', async () => {
  const proxyFetch = createProxyFetchForServiceResponse(() =>
    jsonServiceResponse({
      ok: true,
      response: {
        body: {
          kind: 'text',
          text: 'visible body',
        },
        headers: [['content-type', 'text/plain']],
        redirected: false,
        status: 200,
        statusText: 'OK',
        type: 'opaque',
        url: targetUrl,
      },
      version: WIRE_PROTOCOL_VERSION,
    }),
  );

  await assertInvalidServiceResponse(proxyFetch);
});

test('special-response multipart response without metadata rejects before gateway call', async () => {
  const proxyFetch = createProxyFetchForServiceResponse(() => {
    const formData = new FormData();

    formData.set('body', new Blob(['payload']), 'body');

    return new Response(formData, {
      status: 200,
    });
  });

  await assertInvalidServiceResponse(proxyFetch);
});

async function assertSpecialGatewayResponse(type) {
  await Promise.all([
    resetObservations(gatewayBaseUrl),
    resetObservations(providerBaseUrl),
  ]);

  const proxyFetch = createProxyFetch({
    serviceUrl,
    timeoutMs: 10_000,
  });
  const response = await proxyFetch(
    `${targetUrl}/${type}?mode=special-${type}`,
  );

  assert.equal(response.type, type);
  assert.equal(response.status, 0);
  assert.equal(response.statusText, '');
  assert.equal(response.ok, false);
  assert.equal(response.url, '');
  assert.equal(response.body, null);
  assert.deepEqual(Array.from(response.headers.entries()), []);

  const [gatewayObservations, providerObservations] = await Promise.all([
    waitForJson(`${gatewayBaseUrl}/observations`),
    waitForJson(`${providerBaseUrl}/observations`),
  ]);

  assert.deepEqual(
    gatewayObservations.items.map((item) => item.type),
    ['provider-acquire', 'transport-execute', 'provider-release'],
  );
  assert.equal(gatewayObservations.items[1].mode, `special-${type}`);
  assert.equal(gatewayObservations.items[2].outcome, 'success');
  assert.deepEqual(providerObservations.items, []);
}

function createProxyFetchForServiceResponse(createServiceResponse) {
  return createProxyFetch({
    fetchImpl: async () => createServiceResponse(),
    serviceUrl: invalidServiceUrl,
    timeoutMs: 10_000,
  });
}

async function assertInvalidServiceResponse(proxyFetch) {
  await resetObservations(gatewayBaseUrl);

  await assert.rejects(
    proxyFetch(targetUrl),
    (error) => {
      assert.ok(error instanceof InvalidServiceResponseError);
      assert.equal(error.name, 'InvalidServiceResponseError');
      assert.equal(error.code, INVALID_SERVICE_RESPONSE_CODE);
      assert.equal(error.retryable, false);

      return true;
    },
  );
  await assertGatewayWasNotCalled();
}

function jsonServiceResponse(payload) {
  return new Response(JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json',
    },
    status: 200,
  });
}

function basicServiceResponse() {
  return {
    body: null,
    headers: [],
    redirected: false,
    status: 200,
    statusText: 'OK',
    type: 'basic',
    url: targetUrl,
  };
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
