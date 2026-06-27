import assert from 'node:assert/strict';
import test from 'node:test';

import { createProxyFetch } from '@echospecter/proxy-fetch';

import { waitForJson } from './helpers/http.mjs';

const gatewayBaseUrl =
  process.env.MICRO_GATEWAY_BASE_URL ?? 'http://localhost:8080';
const providerBaseUrl =
  process.env.MICRO_PROVIDER_BASE_URL ?? 'http://localhost:8081';
const serviceUrl = `${gatewayBaseUrl}/fetch`;

test('sticky-session reuses the provider stored by the memory session store', async () => {
  const context = stickyContext({
    caseId: 'reuse',
    flowKey: 'flow-reuse',
    routeKey: 'route-reuse',
    tenantId: 'tenant-reuse',
  });

  await resetAllObservations();
  await executeStickyRequest('/write', 'reuse-seed', context);

  let observations = await readAllObservations();
  assertProviderByCase(observations.gateway, 'reuse-seed', 'sticky-provider-a');
  assertRequestIdsCorrelate(observations.gateway, observations.provider);

  await resetAllObservations();
  await executeStickyRequest('/read', 'reuse-read', context);

  observations = await readAllObservations();
  assertProviderByCase(observations.gateway, 'reuse-read', 'sticky-provider-a');
  assertRequestIdsCorrelate(observations.gateway, observations.provider);
});

test('sticky-session isolates parallel requests by flow and target host', async () => {
  const baseContext = stickyContext({
    caseId: 'isolation-seed',
    flowKey: 'flow-isolation',
    routeKey: 'route-isolation',
    tenantId: 'tenant-isolation',
  });
  const cases = [
    {
      caseId: 'same-context',
      context: baseContext,
      expectedProvider: 'sticky-provider-a',
    },
    {
      caseId: 'different-flow',
      context: stickyContext({
        caseId: 'different-flow',
        flowKey: 'flow-other',
        routeKey: 'route-isolation',
        tenantId: 'tenant-isolation',
      }),
      expectedProvider: 'sticky-provider-b',
    },
    {
      caseId: 'different-target-host',
      context: baseContext,
      expectedProvider: 'sticky-provider-b',
      host: 'sticky-alt.policy.example.com',
    },
  ];

  await resetAllObservations();
  await executeStickyRequest('/write', 'isolation-seed', baseContext);
  await resetAllObservations();

  await Promise.all(
    cases.map((entry) =>
      executeStickyRequest('/read', entry.caseId, entry.context, {
        host: entry.host,
      }),
    ),
  );

  const observations = await readAllObservations();

  for (const entry of cases) {
    assertProviderByCase(
      observations.gateway,
      entry.caseId,
      entry.expectedProvider,
    );
  }

  assertRequestIdsCorrelate(observations.gateway, observations.provider);
});

async function executeStickyRequest(path, caseId, context, options = {}) {
  const proxyFetch = createProxyFetch({
    serviceUrl,
    timeoutMs: 10_000,
  });
  const response = await proxyFetch(stickyUrl(path, caseId, options), {
    context: contextForCase(context, caseId),
  });

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'deterministic text response');
}

function stickyUrl(path, caseId, options = {}) {
  const search = new URLSearchParams({
    case: caseId,
    mode: 'text',
  });
  const host = options.host ?? 'sticky.policy.example.com';

  return `https://${host}${path}?${search}`;
}

function stickyContext({ caseId, flowKey, routeKey, tenantId }) {
  return {
    flowKey,
    metadata: {
      caseId,
    },
    routeKey,
    tenantId,
  };
}

function contextForCase(context, caseId) {
  return {
    ...context,
    metadata: {
      ...context.metadata,
      caseId,
    },
  };
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

function assertProviderByCase(gatewayObservations, caseId, expectedProvider) {
  const acquire = gatewayObservations.items.find(
    (item) =>
      item.type === 'provider-acquire'
      && readCaseId(item.targetUrl) === caseId,
  );

  assert.ok(acquire, `missing acquire observation for ${caseId}`);
  assert.equal(acquire.selectedProvider, expectedProvider);
  assert.equal(acquire.policyPipelineId, 'sticky-session');
  assert.equal(acquire.context.metadata.caseId, caseId);
}

function assertRequestIdsCorrelate(gatewayObservations, providerObservations) {
  const transportRequestIds = gatewayObservations.items
    .filter((item) => item.type === 'transport-execute')
    .map((item) => item.requestId)
    .sort();
  const providerRequestIds = providerObservations.items
    .map((item) => item.requestId)
    .sort();

  assert.deepEqual(providerRequestIds, transportRequestIds);
}

function readCaseId(targetUrl) {
  return new URL(targetUrl).searchParams.get('case');
}
