import {
  createNodeHttpHandler,
  createProxyGateway,
  PROXY_ROUTE_KIND,
  TARGET_ACCESS_RESULT_KIND,
  type GatewayTargetResponse,
  type NodeHttpHandler,
  type ProxyGateway,
  type ProxyGatewayOptions,
  type TargetFinalUrlGuardPort,
  type TargetTransportExecuteInput,
  type TargetTransportPort,
} from '@echospecter/proxy-gateway';

const targetResponse: GatewayTargetResponse = {
  body: {
    kind: 'text',
    replayability: 'replayable',
    text: 'typed response',
  },
  headers: [['content-type', 'text/plain']],
  redirected: false,
  status: 200,
  statusText: 'OK',
  type: 'basic',
  url: 'https://example.test/typed',
};
const finalUrlGuard: TargetFinalUrlGuardPort = {
  check: () => ({
    kind: TARGET_ACCESS_RESULT_KIND.ALLOWED,
  }),
};
const transport: TargetTransportPort = {
  execute: async (input: TargetTransportExecuteInput) => {
    input.finalUrlGuard?.check({
      url: 'https://example.test/final',
    });

    return targetResponse;
  },
};
const options: ProxyGatewayOptions = {
  providers: [
    {
      adapter: {
        acquire: async () => ({
          id: 'typed-lease',
          providerInstanceId: 'typed-provider',
          providerKind: 'typed',
          route: {
            kind: PROXY_ROUTE_KIND.DIRECT,
          },
        }),
        getCapabilities: () => ({}),
        kind: 'typed',
      },
      id: 'typed-provider',
    },
  ],
  transport,
};
const gateway: ProxyGateway = createProxyGateway(options);
const handler: NodeHttpHandler = createNodeHttpHandler(gateway);

finalUrlGuard.check({
  url: 'https://example.test/final',
});

void handler;
