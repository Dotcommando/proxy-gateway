import assert from 'node:assert/strict';
import test from 'node:test';

import { createProxyFetch } from '@echospecter/proxy-fetch';

import { waitForJson } from './helpers/http.mjs';

const gatewayBaseUrl =
  process.env.MICRO_GATEWAY_BASE_URL ?? 'http://localhost:8080';
const providerBaseUrl =
  process.env.MICRO_PROVIDER_BASE_URL ?? 'http://localhost:8081';
const serviceUrl = `${gatewayBaseUrl}/fetch`;

test('gateway-policy default route selects the default provider', async () => {
  const result = await executePolicyRequest(
    'https://default.policy.example.com/resource?mode=text',
  );
  const acquire = findProviderAcquire(result.gatewayObservations.items);

  assert.equal(result.response.status, 200);
  assert.equal(result.body, 'deterministic text response');
  assert.equal(acquire.selectedProvider, 'micro-provider');
  assert.equal(acquire.policyRouteId, 'gateway-policy-default');
});

test('gateway-policy host route selects the route provider', async () => {
  const result = await executePolicyRequest(
    'https://host.policy.example.com/resource?mode=text',
  );
  const acquire = findProviderAcquire(result.gatewayObservations.items);

  assert.equal(result.response.status, 200);
  assert.equal(result.body, 'deterministic text response');
  assert.equal(acquire.selectedProvider, 'route-host-provider');
  assert.equal(acquire.policyRouteId, 'gateway-policy-host');
});

test('gateway-policy route priority chooses the highest priority match', async () => {
  const result = await executePolicyRequest(
    'https://priority.policy.example.com/resource?mode=text',
  );
  const acquire = findProviderAcquire(result.gatewayObservations.items);

  assert.equal(result.response.status, 200);
  assert.equal(result.body, 'deterministic text response');
  assert.equal(acquire.selectedProvider, 'route-priority-provider');
  assert.equal(acquire.policyRouteId, 'gateway-policy-priority-high');
});

test('gateway-policy route exclude falls through to the fallback route', async () => {
  const result = await executePolicyRequest(
    'https://exclude.policy.example.com/admin/panel?mode=text',
  );
  const acquire = findProviderAcquire(result.gatewayObservations.items);

  assert.equal(result.response.status, 200);
  assert.equal(result.body, 'deterministic text response');
  assert.equal(acquire.selectedProvider, 'route-exclude-provider');
  assert.equal(acquire.policyRouteId, 'gateway-policy-exclude-fallback');
});

test('gateway-policy pipeline geo, tags, and priority select the ranked GB provider', async () => {
  const result = await executePolicyRequest(
    'https://pipeline-gb.policy.example.com/resource?mode=text',
  );
  const acquire = findProviderAcquire(result.gatewayObservations.items);

  assert.equal(result.response.status, 200);
  assert.equal(result.body, 'deterministic text response');
  assert.equal(acquire.selectedProvider, 'gb-high-provider');
  assert.deepEqual(acquire.requirements.geo, {
    country: 'GB',
    strictness: 'required',
  });
  assert.deepEqual(acquire.requirements.providerInstanceIds, [
    'gb-high-provider',
    'gb-low-provider',
  ]);
  assert.equal(acquire.policyPipelineId, 'gateway-policy-gb');
});

test('gateway-policy plan fallback retries through the secondary provider', async () => {
  const result = await executePolicyRequest(
    'https://fallback.policy.example.com/resource?mode=gateway-policy-fallback',
  );
  const acquires = result.gatewayObservations.items.filter(
    (item) => item.type === 'provider-acquire',
  );
  const transportProviders = result.gatewayObservations.items
    .filter((item) => item.type === 'transport-execute')
    .map((item) => item.routeProvider);
  const releaseOutcomes = result.gatewayObservations.items
    .filter((item) => item.type === 'provider-release')
    .map((item) => item.outcome);

  assert.equal(result.response.status, 200);
  assert.equal(result.body, 'gateway policy fallback response');
  assert.deepEqual(
    acquires.map((item) => item.selectedProvider),
    ['fallback-primary-provider', 'fallback-secondary-provider'],
  );
  assert.deepEqual(
    acquires.map((item) => item.policyAttemptId),
    ['primary', 'secondary'],
  );
  assert.deepEqual(
    acquires.map((item) => item.policyPipelineId),
    ['gateway-policy-fallback', 'gateway-policy-fallback'],
  );
  assert.deepEqual(transportProviders, [
    'fallback-primary-provider',
    'fallback-secondary-provider',
  ]);
  assert.deepEqual(releaseOutcomes, ['target-network-error', 'success']);
  assert.equal(result.providerObservations.items.length, 1);
  assert.equal(result.providerObservations.items[0].mode, 'gateway-policy-fallback');
});

async function executePolicyRequest(targetUrl) {
  await Promise.all([
    resetObservations(gatewayBaseUrl),
    resetObservations(providerBaseUrl),
  ]);

  const proxyFetch = createProxyFetch({
    serviceUrl,
    timeoutMs: 10_000,
  });
  const response = await proxyFetch(targetUrl);
  const body = await response.text();
  const [gatewayObservations, providerObservations] = await Promise.all([
    waitForJson(`${gatewayBaseUrl}/observations`),
    waitForJson(`${providerBaseUrl}/observations`),
  ]);

  assert.equal(providerObservations.items.length, 1);

  return {
    body,
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

function findProviderAcquire(items) {
  const observation = items.find((item) => item.type === 'provider-acquire');

  assert.ok(observation);

  return observation;
}
