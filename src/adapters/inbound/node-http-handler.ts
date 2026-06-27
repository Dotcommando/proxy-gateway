import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import type { ProxyGateway } from '../../ports/inbound';

export interface NodeHttpHandler {
  (request: IncomingMessage, response: ServerResponse): Promise<void>;
}

export function createNodeHttpHandler(gateway: ProxyGateway): NodeHttpHandler {
  return async (incomingMessage, serverResponse) => {
    try {
      const request = createRequest(incomingMessage);
      const response = await gateway.handle(request);

      await writeResponse(serverResponse, response);
    } catch {
      writeInternalError(serverResponse);
    }
  };
}

interface IRequestInitWithDuplex extends RequestInit {
  duplex?: 'half';
}

function createRequest(incomingMessage: IncomingMessage): Request {
  const method = incomingMessage.method ?? 'GET';
  const body = hasRequestBody(method)
    ? createRequestBodyStream(incomingMessage)
    : undefined;
  const init: IRequestInitWithDuplex = {
    headers: createHeaders(incomingMessage),
    method,
    signal: createAbortSignal(incomingMessage),
  };

  if (body !== undefined) {
    init.body = body;
    init.duplex = 'half';
  }

  return new Request(createRequestUrl(incomingMessage), init);
}

function createRequestUrl(incomingMessage: IncomingMessage): string {
  return new URL(incomingMessage.url ?? '/', `http://${readHost(incomingMessage)}`).toString();
}

function readHost(incomingMessage: IncomingMessage): string {
  const host = incomingMessage.headers.host;

  if (Array.isArray(host)) {
    return host[0] ?? 'localhost';
  }

  return host ?? 'localhost';
}

function createHeaders(incomingMessage: IncomingMessage): Headers {
  const headers = new Headers();

  for (let index = 0; index < incomingMessage.rawHeaders.length; index += 2) {
    const name = incomingMessage.rawHeaders[index];
    const value = incomingMessage.rawHeaders[index + 1];

    if (name !== undefined && value !== undefined) {
      headers.append(name, value);
    }
  }

  return headers;
}

function createAbortSignal(incomingMessage: IncomingMessage): AbortSignal {
  const abortController = new AbortController();
  const abort = (): void => {
    abortController.abort();
  };

  incomingMessage.once('aborted', abort);
  incomingMessage.once('close', () => {
    if (!incomingMessage.complete) {
      abort();
    }
  });

  return abortController.signal;
}

function hasRequestBody(method: string): boolean {
  const normalizedMethod = method.toUpperCase();

  return normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD';
}

function createRequestBodyStream(incomingMessage: IncomingMessage): ReadableStream<Uint8Array> {
  const reader = Readable.toWeb(incomingMessage).getReader();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await reader.read();

      if (next.done) {
        reader.releaseLock();
        controller.close();

        return;
      }

      controller.enqueue(toBuffer(next.value));
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
}

function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return Buffer.from(value);
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }

  throw new TypeError('Unsupported request body chunk.');
}

async function writeResponse(serverResponse: ServerResponse, response: Response): Promise<void> {
  serverResponse.statusCode = response.status;
  response.headers.forEach((value, name) => {
    serverResponse.setHeader(name, value);
  });

  if (response.body === null) {
    serverResponse.end();

    return;
  }

  const reader = response.body.getReader();

  try {
    while (true) {
      const next = await reader.read();

      if (next.done) {
        serverResponse.end();

        return;
      }
      if (!serverResponse.write(next.value)) {
        await once(serverResponse, 'drain');
      }
    }
  } catch (error) {
    serverResponse.destroy(toError(error));
  } finally {
    reader.releaseLock();
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error('Node HTTP response streaming failed.');
}

function writeInternalError(serverResponse: ServerResponse): void {
  if (!serverResponse.headersSent) {
    serverResponse.statusCode = 500;
    serverResponse.setHeader('content-type', 'text/plain; charset=utf-8');
  }

  serverResponse.end('Internal Server Error');
}
