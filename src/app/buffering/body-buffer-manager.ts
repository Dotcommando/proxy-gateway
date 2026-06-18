import type { GatewayBody, GatewayTargetResponse } from '../../ports/outbound';
import type { BodyBufferingPolicy } from '../types';

export const DEFAULT_BODY_BUFFERING_POLICY: BodyBufferingPolicy = {
  bufferRequestStreamsForRetry: true,
  bufferResponsesBeforeReturn: true,
  maxBufferedRequestBodyBytes: 10 * 1024 * 1024,
  maxBufferedResponseBodyBytes: 25 * 1024 * 1024,
  rejectWhenRequestBufferExceeded: false,
  rejectWhenResponseBufferExceeded: false,
};

export class BodyBufferLimitExceededError extends Error {
  readonly direction: 'request' | 'response';

  readonly limitBytes: number;

  constructor(direction: 'request' | 'response', limitBytes: number) {
    super(`Buffered ${direction} body exceeded ${limitBytes} bytes.`);
    this.name = 'BodyBufferLimitExceededError';
    this.direction = direction;
    this.limitBytes = limitBytes;
  }
}

export class BodyBufferManager {
  readonly #policy: BodyBufferingPolicy;

  constructor(policy: Partial<BodyBufferingPolicy> = {}) {
    this.#policy = {
      ...DEFAULT_BODY_BUFFERING_POLICY,
      ...policy,
    };
  }

  async bufferRequestBody(body: GatewayBody): Promise<GatewayBody> {
    if (body.kind === 'none' || body.kind === 'text') {
      return body;
    }
    if (body.kind === 'bytes') {
      return this.#bufferRequestBytes(body.bytes);
    }
    if (!this.#policy.bufferRequestStreamsForRetry) {
      return body;
    }

    const buffered = await readStreamWithLimit(body.stream, this.#policy.maxBufferedRequestBodyBytes);

    if (buffered.exceeded) {
      if (this.#policy.rejectWhenRequestBufferExceeded) {
        throw new BodyBufferLimitExceededError('request', this.#policy.maxBufferedRequestBodyBytes);
      }

      return {
        kind: 'stream',
        replayability: 'non-replayable',
        sizeBytes: buffered.sizeBytes,
        stream: streamFromChunksAndReader(buffered.chunks, buffered.reader),
      };
    }

    return {
      bytes: concatChunks(buffered.chunks, buffered.sizeBytes),
      kind: 'bytes',
      replayability: 'buffered-replayable',
    };
  }

  async bufferResponseBody(response: GatewayTargetResponse): Promise<GatewayTargetResponse> {
    const body = response.body;

    if (body.kind === 'none' || body.kind === 'text') {
      return response;
    }
    if (body.kind === 'bytes') {
      if (
        body.bytes.byteLength > this.#policy.maxBufferedResponseBodyBytes
        && this.#policy.rejectWhenResponseBufferExceeded
      ) {
        throw new BodyBufferLimitExceededError('response', this.#policy.maxBufferedResponseBodyBytes);
      }

      return response;
    }
    if (!this.#policy.bufferResponsesBeforeReturn) {
      return response;
    }

    const buffered = await readStreamWithLimit(body.stream, this.#policy.maxBufferedResponseBodyBytes);

    if (buffered.exceeded) {
      if (this.#policy.rejectWhenResponseBufferExceeded) {
        throw new BodyBufferLimitExceededError('response', this.#policy.maxBufferedResponseBodyBytes);
      }

      return {
        ...response,
        body: {
          kind: 'stream',
          replayability: 'non-replayable',
          sizeBytes: buffered.sizeBytes,
          stream: streamFromChunksAndReader(buffered.chunks, buffered.reader),
        },
      };
    }

    return {
      ...response,
      body: {
        bytes: concatChunks(buffered.chunks, buffered.sizeBytes),
        kind: 'bytes',
        replayability: 'buffered-replayable',
      },
    };
  }

  #bufferRequestBytes(bytes: Uint8Array): GatewayBody {
    if (bytes.byteLength <= this.#policy.maxBufferedRequestBodyBytes) {
      return {
        bytes,
        kind: 'bytes',
        replayability: 'replayable',
      };
    }
    if (this.#policy.rejectWhenRequestBufferExceeded) {
      throw new BodyBufferLimitExceededError('request', this.#policy.maxBufferedRequestBodyBytes);
    }

    return {
      kind: 'stream',
      replayability: 'non-replayable',
      sizeBytes: bytes.byteLength,
      stream: streamFromBytes(bytes),
    };
  }
}

interface BufferedStreamRead {
  chunks: Uint8Array[];
  exceeded: boolean;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  sizeBytes: number;
}

async function readStreamWithLimit(stream: ReadableStream<Uint8Array>, limitBytes: number): Promise<BufferedStreamRead> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let sizeBytes = 0;

  while (true) {
    const next = await reader.read();

    if (next.done) {
      return {
        chunks,
        exceeded: false,
        reader,
        sizeBytes,
      };
    }

    chunks.push(next.value);
    sizeBytes += next.value.byteLength;

    if (sizeBytes > limitBytes) {
      return {
        chunks,
        exceeded: true,
        reader,
        sizeBytes,
      };
    }
  }
}

function concatChunks(chunks: Uint8Array[], sizeBytes: number): Uint8Array {
  const bytes = new Uint8Array(sizeBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

function streamFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function streamFromChunksAndReader(
  chunks: Uint8Array[],
  reader: ReadableStreamDefaultReader<Uint8Array>,
): ReadableStream<Uint8Array> {
  const pending = [...chunks];

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = pending.shift();

      if (chunk) {
        controller.enqueue(chunk);

        return;
      }

      const next = await reader.read();

      if (next.done) {
        reader.releaseLock();
        controller.close();

        return;
      }

      controller.enqueue(next.value);
    },
    cancel() {
      reader.releaseLock();
    },
  });
}
