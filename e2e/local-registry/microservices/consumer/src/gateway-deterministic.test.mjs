import assert from 'node:assert/strict';
import test from 'node:test';

import { createProxyFetch } from '@echospecter/proxy-fetch';

import { waitForJson } from './helpers/http.mjs';

const gatewayBaseUrl =
  process.env.MICRO_GATEWAY_BASE_URL ?? 'http://localhost:8080';
const providerBaseUrl =
  process.env.MICRO_PROVIDER_BASE_URL ?? 'http://localhost:8081';

test('deterministic proxy-fetch request flows through micro-gateway and mock provider', async () => {
  await Promise.all([
    resetObservations(gatewayBaseUrl),
    resetObservations(providerBaseUrl),
  ]);

  const proxyFetch = createProxyFetch({
    serviceUrl: `${gatewayBaseUrl}/fetch`,
    timeoutMs: 10_000,
  });

  const response = await proxyFetch('https://example.com/deterministic?mode=text', {
    context: {
      consistency: 'same-session',
      flowKey: 'deterministic-flow',
      useCase: 'microservice-e2e',
    },
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/plain\b/u);
  assert.equal(await response.text(), 'deterministic text response');

  const [gatewayObservations, providerObservations] = await Promise.all([
    waitForJson(`${gatewayBaseUrl}/observations`),
    waitForJson(`${providerBaseUrl}/observations`),
  ]);

  assert.deepEqual(
    gatewayObservations.items.map((item) => item.type),
    ['provider-acquire', 'transport-execute', 'provider-release'],
  );
  assert.equal(gatewayObservations.items[0].selectedProvider, 'micro-provider');
  assert.equal(gatewayObservations.items[0].routeKind, 'direct');
  assert.equal(gatewayObservations.items[0].planKind, 'fallback');
  assert.deepEqual(gatewayObservations.items[0].session, {
    consistency: 'same-session',
    flowKey: 'deterministic-flow',
  });
  assert.equal(gatewayObservations.items[1].mode, 'text');
  assert.equal(gatewayObservations.items[2].outcome, 'success');

  assert.equal(providerObservations.items.length, 1);
  assert.equal(providerObservations.items[0].mode, 'text');
});

async function resetObservations(baseUrl) {
  const response = await fetch(`${baseUrl}/observations/reset`, {
    method: 'POST',
  });
  assert.equal(response.status, 200);
}
