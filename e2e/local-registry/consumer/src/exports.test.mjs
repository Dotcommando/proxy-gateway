import * as gateway from '@echospecter/proxy-gateway';
import assert from 'node:assert/strict';
import test from 'node:test';

const expectedExports = [
  'PIPELINE_STEP_TYPE',
  'PROXY_GEO_STRICTNESS',
  'PROXY_IDENTITY_ROTATION',
  'PROXY_PLAN_KIND',
  'PROXY_PROVIDER_COUNTRY_SELECTION',
  'PROXY_PROVIDER_GEO_MODE',
  'createNodeHttpHandler',
  'createMemoryProxySessionStore',
  'createProxyGateway',
  'WIRE_PROTOCOL_VERSION'
];
const deferredFrameworkExports = [
  'createExpressMiddleware',
  'createFastifyPlugin',
  'createNestProxyGatewayModule'
];

test('public runtime exports are available and deferred framework wrappers are absent', () => {
  for (const exportName of expectedExports) {
    assert.ok(exportName in gateway, `expected public export missing: ${exportName}`);
  }

  for (const exportName of deferredFrameworkExports) {
    assert.ok(!(exportName in gateway), `framework export should not be present in core package: ${exportName}`);
  }

  assert.equal(gateway.WIRE_PROTOCOL_VERSION, 'proxy-fetch.v1');
});
