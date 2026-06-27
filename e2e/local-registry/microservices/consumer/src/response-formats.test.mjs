import assert from 'node:assert/strict';
import test from 'node:test';

import { createProxyFetch } from '@echospecter/proxy-fetch';

import { waitForJson } from './helpers/http.mjs';

const gatewayBaseUrl =
  process.env.MICRO_GATEWAY_BASE_URL ?? 'http://localhost:8080';
const providerBaseUrl =
  process.env.MICRO_PROVIDER_BASE_URL ?? 'http://localhost:8081';
const serviceUrl = `${gatewayBaseUrl}/fetch`;
const binaryBytes = new Uint8Array([0, 1, 2, 3, 254, 255]);

test('response-format JSON target response becomes a native JSON response', async () => {
  const { response } = await execute('json');

  assert.equal(response.status, 200);
  assert.equal(response.statusText, 'OK');
  assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/u);
  assert.deepEqual(await response.json(), {
    mode: 'json',
    ok: true,
  });
});

test('response-format plain text preserves metadata clone and bodyUsed semantics', async () => {
  const path = '/response-format/metadata';
  const targetUrl = targetUrlForMode('text', {
    path,
  });
  const { response } = await execute('text', {
    path,
  });

  assert.equal(response.url, targetUrl);
  assert.equal(response.redirected, false);
  assert.equal(response.type, 'basic');
  assert.equal(response.status, 200);
  assert.equal(response.statusText, 'OK');
  assert.match(response.headers.get('content-type') ?? '', /^text\/plain\b/u);
  assert.equal(response.bodyUsed, false);

  const clone = response.clone();

  assert.equal(clone.url, response.url);
  assert.equal(clone.redirected, response.redirected);
  assert.equal(clone.type, response.type);
  assert.equal(clone.status, response.status);
  assert.equal(clone.statusText, response.statusText);
  assert.equal(clone.headers.get('content-type'), response.headers.get('content-type'));
  assert.equal(clone.bodyUsed, false);
  assert.equal(await response.text(), 'deterministic text response');
  assert.equal(response.bodyUsed, true);
  assert.equal(clone.bodyUsed, false);
  assert.equal(await clone.text(), 'deterministic text response');
  assert.equal(clone.bodyUsed, true);
});

test('response-format binary response uses multipart service response by default', async () => {
  const serviceResponses = [];
  const { response } = await execute('binary', {
    fetchImpl: captureServiceResponses(serviceResponses),
  });

  assert.equal(response.status, 200);
  assert.match(
    serviceResponses[0]?.contentType ?? '',
    /^multipart\/form-data; boundary=/u,
  );
  assert.match(response.headers.get('content-type') ?? '', /^application\/octet-stream\b/u);
  assert.deepEqual(
    Array.from(new Uint8Array(await response.arrayBuffer())),
    Array.from(binaryBytes),
  );
});

test('response-format binary response supports JSON base64 service response fallback', async () => {
  const serviceResponses = [];
  const { response } = await execute('binary', {
    fetchImpl: captureServiceResponses(serviceResponses, {
      serviceAccept: 'application/json',
    }),
    path: '/response-format/json-base64',
  });

  assert.equal(response.status, 200);
  assert.match(serviceResponses[0]?.contentType ?? '', /^application\/json\b/u);
  assert.match(response.headers.get('content-type') ?? '', /^application\/octet-stream\b/u);
  assert.deepEqual(
    Array.from(new Uint8Array(await response.arrayBuffer())),
    Array.from(binaryBytes),
  );
});

test('response-format null-body statuses expose native null bodies', async () => {
  const scenarios = [
    {
      mode: 'no-content-204',
      status: 204,
      statusText: 'No Content',
    },
    {
      mode: 'reset-content-205',
      status: 205,
      statusText: 'Reset Content',
    },
    {
      mode: 'not-modified-304',
      status: 304,
      statusText: 'Not Modified',
    },
  ];

  for (const scenario of scenarios) {
    const { response } = await execute(scenario.mode);

    assert.equal(response.status, scenario.status);
    assert.equal(response.statusText, scenario.statusText);
    assert.equal(response.body, null);
    assert.equal(await response.text(), '');
  }
});

test('response-format target HTTP errors remain normal responses', async () => {
  const notFound = await execute('target-404', {
    expectedReleaseOutcome: 'target-http-error',
  });
  const serverError = await execute('target-500', {
    expectedReleaseOutcome: 'target-http-error',
  });

  assert.equal(notFound.response.status, 404);
  assert.equal(notFound.response.statusText, 'Not Found');
  assert.equal(await notFound.response.text(), 'deterministic target 404');
  assert.equal(serverError.response.status, 500);
  assert.equal(serverError.response.statusText, 'Internal Server Error');
  assert.equal(await serverError.response.text(), 'deterministic target 500');
});

async function execute(mode, options = {}) {
  await Promise.all([
    resetObservations(gatewayBaseUrl),
    resetObservations(providerBaseUrl),
  ]);

  const proxyFetch = createProxyFetch({
    ...(options.fetchImpl !== undefined && { fetchImpl: options.fetchImpl }),
    serviceUrl,
    timeoutMs: 10_000,
  });
  const response = await proxyFetch(
    targetUrlForMode(mode, {
      path: options.path,
    }),
  );

  const [gatewayObservations, providerObservations] = await Promise.all([
    waitForJson(`${gatewayBaseUrl}/observations`),
    waitForJson(`${providerBaseUrl}/observations`),
  ]);

  assert.deepEqual(
    gatewayObservations.items.map((item) => item.type),
    ['provider-acquire', 'transport-execute', 'provider-release'],
  );
  assert.equal(gatewayObservations.items[1].mode, mode);
  assert.equal(
    gatewayObservations.items[2].outcome,
    options.expectedReleaseOutcome ?? 'success',
  );
  assert.equal(providerObservations.items.length, 1);
  assert.equal(providerObservations.items[0].mode, mode);

  return {
    gatewayObservations,
    providerObservations,
    response,
  };
}

function targetUrlForMode(mode, options = {}) {
  const path = options.path ?? `/response-format/${mode}`;

  return `https://example.com${path}?mode=${encodeURIComponent(mode)}`;
}

async function resetObservations(baseUrl) {
  const response = await fetch(`${baseUrl}/observations/reset`, {
    method: 'POST',
  });
  assert.equal(response.status, 200);
}

function captureServiceResponses(serviceResponses, options = {}) {
  return async (input, init) => {
    const response = await fetchWithServiceAccept(
      input,
      init,
      options.serviceAccept,
    );

    serviceResponses.push({
      contentType: response.headers.get('content-type'),
      status: response.status,
    });

    return response;
  };
}

function fetchWithServiceAccept(input, init, serviceAccept) {
  if (serviceAccept === undefined) {
    return fetch(input, init);
  }

  const headers = new Headers(
    input instanceof Request ? input.headers : init?.headers,
  );
  headers.set('accept', serviceAccept);

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
