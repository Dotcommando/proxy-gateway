const test = require('node:test');
const { createProxyGateway } = require('@echospecter/proxy-gateway');

test('loads the installed CJS entrypoint', async () => {
  const { assertGatewayResponse } = await import('./test-common.mjs');

  await assertGatewayResponse(createProxyGateway);
});
