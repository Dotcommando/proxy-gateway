import { createProxyGateway } from '@echospecter/proxy-gateway';

import { assertGatewaySmoke } from './smoke-common.mjs';

await assertGatewaySmoke(createProxyGateway, 'esm import');
