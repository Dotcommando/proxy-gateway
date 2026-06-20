import type { IncomingMessage, ServerResponse } from 'node:http';

import type { ProxyGateway } from '../../ports/inbound';

export interface NodeHttpHandler {
  (request: IncomingMessage, response: ServerResponse): Promise<void>;
}

export function createNodeHttpHandler(gateway: ProxyGateway): NodeHttpHandler {
  return async (incomingMessage, serverResponse) => {
    try {
      const request = await createRequest(incomingMessage);
      const response = await gateway.handle(request);

      await writeResponse(serverResponse, response);
    } catch {
      writeInternalError(serverResponse);
    }
  };
}

async function createRequest(incomingMessage: IncomingMessage): Promise<Request> {
  const method = incomingMessage.method ?? 'GET';
  const body = hasRequestBody(method)
    ? await readIncomingMessageBody(incomingMessage)
    : undefined;

  return new Request(createRequestUrl(incomingMessage), {
    ...(body !== undefined && { body: new Blob([copyToArrayBuffer(body)]) }),
    headers: createHeaders(incomingMessage),
    method,
    signal: createAbortSignal(incomingMessage),
  });
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

  incomingMessage.once('aborted', () => {
    abortController.abort();
  });

  return abortController.signal;
}

function hasRequestBody(method: string): boolean {
  const normalizedMethod = method.toUpperCase();

  return normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD';
}

async function readIncomingMessageBody(incomingMessage: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of incomingMessage) {
    chunks.push(toBuffer(chunk));
  }

  return Buffer.concat(chunks);
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

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);

  copy.set(bytes);

  return copy.buffer;
}

async function writeResponse(serverResponse: ServerResponse, response: Response): Promise<void> {
  serverResponse.statusCode = response.status;
  response.headers.forEach((value, name) => {
    serverResponse.setHeader(name, value);
  });

  serverResponse.end(Buffer.from(await response.arrayBuffer()));
}

function writeInternalError(serverResponse: ServerResponse): void {
  if (!serverResponse.headersSent) {
    serverResponse.statusCode = 500;
    serverResponse.setHeader('content-type', 'text/plain; charset=utf-8');
  }

  serverResponse.end('Internal Server Error');
}
