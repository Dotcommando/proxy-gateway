import test from 'node:test';

import { createProxyGateway } from '@echospecter/proxy-gateway';

import { assertGatewayResponse } from './test-common.mjs';

test('loads the installed ESM entrypoint', async () => {
  await assertGatewayResponse(createProxyGateway);
});
