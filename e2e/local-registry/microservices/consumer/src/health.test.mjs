import assert from 'node:assert/strict';
import test from 'node:test';

import { waitForJson } from './helpers/http.mjs';

const gatewayBaseUrl =
  process.env.MICRO_GATEWAY_BASE_URL ?? 'http://localhost:8080';
const providerBaseUrl =
  process.env.MICRO_PROVIDER_BASE_URL ?? 'http://localhost:8081';

test('microservice health endpoints are reachable', async () => {
  const [gateway, provider] = await Promise.all([
    waitForJson(`${gatewayBaseUrl}/health`),
    waitForJson(`${providerBaseUrl}/health`),
  ]);

  assert.deepEqual(gateway, {
    ok: true,
    service: 'micro-gateway',
  });
  assert.deepEqual(provider, {
    ok: true,
    service: 'micro-provider',
  });
});
