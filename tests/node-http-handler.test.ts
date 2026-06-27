import { createServer, request as createHttpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, expect, it } from '@jest/globals';

import {
  createNodeHttpHandler,
  JSON_CONTENT_TYPE,
  WIRE_PROTOCOL_VERSION,
} from '../src';
import { runInboundAdapterContractSuite } from './helpers/inbound-adapter-contract';
import { createNodeHttpContractAdapter } from './helpers/node-http-contract-adapter';

runInboundAdapterContractSuite({
  createAdapter: (gateway) => createNodeHttpContractAdapter(gateway),
  name: 'createNodeHttpHandler inbound adapter contract',
});

describe('createNodeHttpHandler', () => {
  it('delegates to the gateway before the full inbound body is received', async () => {
    const handleCalled = createDeferred<void>();
    const responseReceived = createDeferred<void>();
    const server = createServer(createNodeHttpHandler({
      handle: async () => {
        handleCalled.resolve(undefined);

        return new Response('ok');
      },
    }));

    await listen(server);

    const address = readAddressInfo(server);
    const request = createHttpRequest({
      headers: {
        'content-type': JSON_CONTENT_TYPE,
        'transfer-encoding': 'chunked',
      },
      host: '127.0.0.1',
      method: 'POST',
      path: '/proxy',
      port: address.port,
    }, (response) => {
      response.resume();
      response.once('end', () => {
        responseReceived.resolve(undefined);
      });
      response.once('error', responseReceived.reject);
    });

    request.once('error', responseReceived.reject);

    try {
      request.write('{"partial":');

      await expect(
        withTimeout(handleCalled.promise, 100, 'Gateway handle was not called before request end.'),
      ).resolves.toBeUndefined();
    } finally {
      request.end('"done"}');
      await withTimeout(responseReceived.promise, 1_000, 'Node HTTP response was not received during cleanup.')
        .catch(() => undefined);
      await close(server);
    }
  });

  it('streams response chunks to the Node client before the Web Response body closes', async () => {
    const releaseSecondChunk = createDeferred<void>();
    const firstChunkReceived = createDeferred<string>();
    const responseReceived = createDeferred<string>();
    const encoder = new TextEncoder();
    const server = createServer(createNodeHttpHandler({
      handle: async () => new Response(new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode('chunk-1'));
          await releaseSecondChunk.promise;
          controller.enqueue(encoder.encode('chunk-2'));
          controller.close();
        },
      })),
    }));

    await listen(server);

    const address = readAddressInfo(server);
    const chunks: string[] = [];
    const request = createHttpRequest({
      host: '127.0.0.1',
      method: 'GET',
      path: '/proxy',
      port: address.port,
    }, (response) => {
      response.on('data', (chunk: unknown) => {
        chunks.push(readResponseChunkText(chunk));

        if (chunks.join('').includes('chunk-1')) {
          firstChunkReceived.resolve(chunks.join(''));
        }
      });
      response.once('end', () => {
        responseReceived.resolve(chunks.join(''));
      });
      response.once('error', responseReceived.reject);
    });

    request.once('error', responseReceived.reject);

    try {
      request.end();

      await expect(
        withTimeout(firstChunkReceived.promise, 100, 'First response chunk was not streamed before body close.'),
      ).resolves.toContain('chunk-1');
    } finally {
      releaseSecondChunk.resolve(undefined);
      await withTimeout(responseReceived.promise, 1_000, 'Node HTTP response was not received during cleanup.')
        .catch(() => undefined);
      await close(server);
    }
  });

  it('converts Node request URL method headers and raw body into a Web Request', async () => {
    let observedUrl = '';
    let observedMethod = '';
    let observedHeader = '';
    let observedBody = '';
    const adapter = createNodeHttpContractAdapter({
      handle: async (request) => {
        observedUrl = request.url;
        observedMethod = request.method;
        observedHeader = request.headers.get('x-custom-header') ?? '';
        observedBody = await request.text();

        return new Response(JSON.stringify({
          ok: true,
          version: WIRE_PROTOCOL_VERSION,
        }), {
          headers: {
            'content-type': JSON_CONTENT_TYPE,
          },
          status: 202,
        });
      },
    });
    const response = await adapter.handle({
      body: new TextEncoder().encode('{"raw":true}'),
      headers: [
        ['content-type', JSON_CONTENT_TYPE],
        ['x-custom-header', 'custom-value'],
      ],
      method: 'PATCH',
      url: 'https://gateway.test/custom/path?query=1',
    });
    const observedParsedUrl = new URL(observedUrl);

    expect(response.status).toBe(202);
    expect(observedParsedUrl.pathname).toBe('/custom/path');
    expect(observedParsedUrl.search).toBe('?query=1');
    expect(observedMethod).toBe('PATCH');
    expect(observedHeader).toBe('custom-value');
    expect(observedBody).toBe('{"raw":true}');
  });
});

interface IDeferred<T> {
  promise: Promise<T>;
  reject(reason?: unknown): void;
  resolve(value: T | PromiseLike<T>): void;
}

function createDeferred<T>(): IDeferred<T> {
  let resolveDeferred: ((value: T | PromiseLike<T>) => void) | undefined;
  let rejectDeferred: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });

  if (resolveDeferred === undefined || rejectDeferred === undefined) {
    throw new Error('Expected deferred callbacks to be initialized.');
  }

  return {
    promise,
    reject: rejectDeferred,
    resolve: resolveDeferred,
  };
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

function readAddressInfo(server: Server): AddressInfo {
  const address = server.address();

  if (!isAddressInfo(address)) {
    throw new Error('Expected server address info.');
  }

  return address;
}

function isAddressInfo(value: string | AddressInfo | null): value is AddressInfo {
  return typeof value === 'object' && value !== null;
}

function readResponseChunkText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('utf8');
  }

  throw new TypeError('Unsupported response chunk.');
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
