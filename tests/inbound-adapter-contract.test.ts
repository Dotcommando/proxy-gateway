import { runInboundAdapterContractSuite } from './helpers/inbound-adapter-contract';

runInboundAdapterContractSuite({
  createAdapter: (gateway) => ({
    handle: async (request) => {
      const response = await gateway.handle(new Request(request.url, {
        body: Buffer.from(request.body),
        headers: request.headers,
        method: request.method,
      }));

      return {
        body: new Uint8Array(await response.arrayBuffer()),
        headers: Array.from(response.headers.entries()),
        status: response.status,
      };
    },
  }),
  name: 'inbound adapter contract harness',
});
