import { describe, expect, it } from '@jest/globals';

import { BodyBufferLimitExceededError, BodyBufferManager } from '../src/app/buffering/body-buffer-manager';

describe('BodyBufferManager', () => {
  it('keeps request bytes replayable when they are within the limit', async () => {
    const manager = new BodyBufferManager({
      ...testPolicy,
      maxBufferedRequestBodyBytes: 4,
    });

    await expect(
      manager.bufferRequestBody({
        bytes: new Uint8Array([1, 2, 3, 4]),
        kind: 'bytes',
        replayability: 'replayable',
      }),
    ).resolves.toEqual({
      bytes: new Uint8Array([1, 2, 3, 4]),
      kind: 'bytes',
      replayability: 'replayable',
    });
  });

  it('buffers request streams into replayable bytes when they are within the limit', async () => {
    const manager = new BodyBufferManager({
      ...testPolicy,
      maxBufferedRequestBodyBytes: 4,
    });
    const body = await manager.bufferRequestBody({
      kind: 'stream',
      replayability: 'non-replayable',
      stream: streamFromChunks([[1, 2], [3, 4]]),
    });

    expect(body.kind).toBe('bytes');
    expect(body.replayability).toBe('buffered-replayable');

    if (body.kind === 'bytes') {
      expect(Array.from(body.bytes)).toEqual([1, 2, 3, 4]);
    }
  });

  it('rejects request bodies that exceed the limit when configured to reject', async () => {
    const manager = new BodyBufferManager({
      ...testPolicy,
      maxBufferedRequestBodyBytes: 2,
      rejectWhenRequestBufferExceeded: true,
    });

    await expect(
      manager.bufferRequestBody({
        bytes: new Uint8Array([1, 2, 3]),
        kind: 'bytes',
        replayability: 'replayable',
      }),
    ).rejects.toBeInstanceOf(BodyBufferLimitExceededError);
  });

  it('returns non-replayable request streams when the request limit is exceeded without rejection', async () => {
    const manager = new BodyBufferManager({
      ...testPolicy,
      maxBufferedRequestBodyBytes: 2,
      rejectWhenRequestBufferExceeded: false,
    });
    const body = await manager.bufferRequestBody({
      bytes: new Uint8Array([1, 2, 3]),
      kind: 'bytes',
      replayability: 'replayable',
    });

    expect(body.kind).toBe('stream');
    expect(body.replayability).toBe('non-replayable');

    if (body.kind === 'stream') {
      await expect(readStream(body.stream)).resolves.toEqual([1, 2, 3]);
    }
  });

  it('buffers response streams into bytes when they are within the limit', async () => {
    const manager = new BodyBufferManager({
      ...testPolicy,
      maxBufferedResponseBodyBytes: 4,
    });
    const response = await manager.bufferResponseBody({
      body: {
        kind: 'stream',
        replayability: 'non-replayable',
        stream: streamFromChunks([[1, 2], [3, 4]]),
      },
      headers: [],
      status: 200,
      statusText: 'OK',
    });

    expect(response.body.kind).toBe('bytes');

    if (response.body.kind === 'bytes') {
      expect(response.body.replayability).toBe('buffered-replayable');
      expect(Array.from(response.body.bytes)).toEqual([1, 2, 3, 4]);
    }
  });

  it('rejects response bodies that exceed the limit when configured to reject', async () => {
    const manager = new BodyBufferManager({
      ...testPolicy,
      maxBufferedResponseBodyBytes: 2,
      rejectWhenResponseBufferExceeded: true,
    });

    await expect(
      manager.bufferResponseBody({
        body: {
          bytes: new Uint8Array([1, 2, 3]),
          kind: 'bytes',
          replayability: 'replayable',
        },
        headers: [],
        status: 200,
        statusText: 'OK',
      }),
    ).rejects.toBeInstanceOf(BodyBufferLimitExceededError);
  });
});

const testPolicy = {
  bufferRequestStreamsForRetry: true,
  bufferResponsesBeforeReturn: true,
  maxBufferedRequestBodyBytes: 1024,
  maxBufferedResponseBodyBytes: 1024,
  rejectWhenRequestBufferExceeded: false,
  rejectWhenResponseBufferExceeded: false,
};

function streamFromChunks(chunks: number[][]): ReadableStream<Uint8Array> {
  const pending = chunks.map((chunk) => new Uint8Array(chunk));

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = pending.shift();

      if (next) {
        controller.enqueue(next);

        return;
      }

      controller.close();
    },
  });
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<number[]> {
  const reader = stream.getReader();
  const result: number[] = [];

  try {
    while (true) {
      const next = await reader.read();

      if (next.done) {
        return result;
      }

      result.push(...next.value);
    }
  } finally {
    reader.releaseLock();
  }
}
