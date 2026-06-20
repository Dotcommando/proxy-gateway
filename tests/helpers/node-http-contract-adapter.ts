import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createNodeHttpHandler, type ProxyGateway } from '../../src';
import {
  type IInboundAdapterContractAdapter,
  type IInboundAdapterContractRequest,
} from './inbound-adapter-contract';

export function createNodeHttpContractAdapter(gateway: ProxyGateway): IInboundAdapterContractAdapter {
  const handler = createNodeHttpHandler(gateway);

  return {
    handle: async (request) => {
      const server = createServer((incomingMessage, serverResponse) => {
        void handler(incomingMessage, serverResponse);
      });

      await listen(server);

      try {
        const response = await fetch(localUrl(server, request), {
          body: Buffer.from(request.body),
          headers: request.headers,
          method: request.method,
        });

        return {
          body: new Uint8Array(await response.arrayBuffer()),
          headers: Array.from(response.headers.entries()),
          status: response.status,
        };
      } finally {
        await close(server);
      }
    },
  };
}

function localUrl(server: Server, request: IInboundAdapterContractRequest): string {
  const address = server.address();

  if (!isAddressInfo(address)) {
    throw new Error('Expected server address info.');
  }

  const inputUrl = new URL(request.url);

  return `http://127.0.0.1:${address.port}${inputUrl.pathname}${inputUrl.search}`;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);

        return;
      }

      resolve();
    });
  });
}

function isAddressInfo(value: string | AddressInfo | null): value is AddressInfo {
  return typeof value === 'object' && value !== null;
}
