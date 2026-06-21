import * as gateway from '@echospecter/proxy-gateway';

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

for (const exportName of expectedExports) {
  if (!(exportName in gateway)) {
    throw new Error(`expected public export missing: ${exportName}`);
  }
}

for (const exportName of deferredFrameworkExports) {
  if (exportName in gateway) {
    throw new Error(`framework export should not be present in core package: ${exportName}`);
  }
}

if (gateway.WIRE_PROTOCOL_VERSION !== 'proxy-fetch.v1') {
  throw new Error(`unexpected WIRE_PROTOCOL_VERSION: ${gateway.WIRE_PROTOCOL_VERSION}`);
}

console.log('public exports: ok');
