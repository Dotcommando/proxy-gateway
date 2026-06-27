# NODE_HTTP_STREAMING.md

## Goal

Make the built-in Node HTTP inbound adapter streaming-safe without violating the package's hexagonal architecture.

The current `createNodeHttpHandler()` reads the entire inbound `IncomingMessage` into memory before calling `ProxyGateway.handle()`, and it writes returned Web `Response` bodies by first materializing `response.arrayBuffer()`. This adds avoidable buffering outside the app-layer envelope/body policies.

The target outcome:

- Node inbound request bodies are passed to `ProxyGateway.handle()` as streaming Web `Request` bodies.
- Node outbound responses are written from Web `Response.body` as streams.
- Proxy-fetch envelope parsing and body-size limits remain owned by `src/app/envelopes` and `src/app/buffering`, not by the Node adapter.
- Existing raw byte preservation behavior remains intact for JSON, multipart, and binary service traffic.

## Architecture Boundaries

`src/adapters/inbound/node-http-handler.ts` must remain a thin adapter:

- translate Node `IncomingMessage` to Web `Request`;
- translate Web `Response` to Node `ServerResponse`;
- preserve method, URL, raw headers, body bytes, status, response headers, and body bytes;
- propagate client abort/cancellation into the Web `Request` signal;
- avoid proxy-fetch envelope parsing, target routing, provider acquire, target transport execution, retry decisions, and service response building.

`src/app/envelopes` owns:

- proxy-fetch JSON and multipart request parsing;
- service response envelope construction;
- request body read limits for service envelopes.

`src/app/buffering` owns:

- target request/response replayability buffering;
- target body buffering limits after proxy-fetch envelope parsing.

No provider, framework, config loader, logger, metrics, tracing, DNS, GeoIP, or proxy SDK dependencies are allowed.

## Current Risk

Inbound request path:

```txt
IncomingMessage
  -> Buffer.concat(all chunks) in Node adapter
  -> Blob/ArrayBuffer Web Request body
  -> app envelope parser reads body again
```

This means `bodyBuffering.maxBufferedRequestBodyBytes` does not protect the Node adapter from first accepting a large service request body into memory.

Outbound response path:

```txt
Web Response
  -> response.arrayBuffer() in Node adapter
  -> ServerResponse.end(Buffer)
```

This prevents response streaming and can add another full materialization after app-layer buffering/envelope construction.

## Primary Reproduction Tests

These tests should be written first. They prove the buffering problem through stable observable behavior instead of brittle memory assertions.

### Reproduction Test A - inbound delegation waits for request end

Status: completed (red)

Purpose:

- Prove that the current Node handler does not delegate to `ProxyGateway.handle()` until the full inbound request body has been read.
- This reproduces the root inbound problem without measuring heap usage.

Test shape:

```txt
node:http client
  -> opens POST /proxy
  -> writes first chunk
  -> intentionally does not end the request yet

createNodeHttpHandler(fakeGateway)
  -> should call fakeGateway.handle(request) after request setup
```

Expected red with current implementation:

- `fakeGateway.handle()` is not called while the client request is still open.
- The handler is blocked in `readIncomingMessageBody()` until `req.end()`.

Expected green after streaming fix:

- `fakeGateway.handle()` is called after headers/request setup, before the client sends the final body chunk.
- The Web `Request.body` exposed to the fake gateway is still readable as a stream.

Recommended test details:

- Use a real `node:http` server with `createNodeHttpHandler(fakeGateway)`.
- Use a real `http.request()` client with `transfer-encoding: chunked`.
- After `clientRequest.write(firstChunk)`, race a short wait against a `handleCalled` promise.
- Keep the fake gateway simple; it can return `new Response("ok")` without parsing proxy-fetch.
- Always finish or destroy the client request and close the server in cleanup.

Sketch:

```ts
it('delegates to the gateway before the full inbound body is received', async () => {
  const handleCalled = createDeferred<void>();
  const gateway: ProxyGateway = {
    handle: async () => {
      handleCalled.resolve();

      return new Response('ok');
    },
  };

  const server = createServer(createNodeHttpHandler(gateway));
  const address = await listenOnRandomPort(server);
  const request = http.request({
    headers: {
      'content-type': 'application/json',
      'transfer-encoding': 'chunked',
    },
    method: 'POST',
    path: '/proxy',
    port: address.port,
  });

  request.write('{"version"');

  await expect(handleCalled.promise).resolves.toBeUndefined();

  request.end(':"proxy-fetch.v1","request":{"url":"https://example.com","body":null}}');
});
```

The final implementation should avoid long fixed sleeps. Prefer a small `Promise.race()` timeout helper so red failure is clear and bounded.

### Reproduction Test B - outbound response waits for full Web Response body

Status: completed (red)

Purpose:

- Prove that the current Node handler does not stream returned Web `Response.body` chunks to the client.
- This reproduces the outbound buffering problem caused by `response.arrayBuffer()`.

Test shape:

```txt
fakeGateway.handle()
  -> returns Response(ReadableStream)
  -> stream enqueues first chunk
  -> stream waits
  -> stream enqueues second chunk and closes

node:http client
  -> should observe first chunk before stream closes
```

Expected red with current implementation:

- The client receives no response data until the entire Web `Response.body` completes.
- The handler is blocked in `response.arrayBuffer()`.

Expected green after streaming fix:

- The client receives the first chunk while the Web `Response.body` is still open.
- The second chunk still arrives later and the full body remains byte-identical.

Recommended test details:

- Use a fake gateway that returns a `Response` with a controlled `ReadableStream<Uint8Array>`.
- Use a deferred promise to hold the second chunk.
- The client listens for the first `data` event and resolves a promise.
- Assert the first chunk promise resolves before releasing the second chunk.
- Cleanup should release the second chunk and close the server even if the assertion fails.

Sketch:

```ts
it('streams response chunks to the Node client before the Web Response body closes', async () => {
  const releaseSecondChunk = createDeferred<void>();
  const encoder = new TextEncoder();
  const gateway: ProxyGateway = {
    handle: async () => new Response(new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode('chunk-1'));
        await releaseSecondChunk.promise;
        controller.enqueue(encoder.encode('chunk-2'));
        controller.close();
      },
    })),
  };

  const server = createServer(createNodeHttpHandler(gateway));
  const address = await listenOnRandomPort(server);
  const firstChunk = waitForFirstClientChunk(address.port);

  await expect(firstChunk).resolves.toBe('chunk-1');

  releaseSecondChunk.resolve();
});
```

The current implementation should fail this test because `response.arrayBuffer()` waits for `releaseSecondChunk` before writing anything to the Node response.

## Step Plan

### Step 1 - Red: add inbound streaming reproduction test

Status: completed (red)

Scope:

- Add Reproduction Test A to the Node HTTP handler suite.
- Keep it focused on adapter delegation timing and Web `Request` construction.
- Do not involve real proxy-fetch envelope parsing in this test.

Expected red:

- Current implementation waits for `readIncomingMessageBody()` to finish.
- The fake gateway is not called until the client ends the request.

Green target:

- The adapter constructs a Web `Request` with a streaming body and calls `gateway.handle()` immediately after headers/request setup.

Verify:

```sh
npm test -- node-http-handler
```

Red result:

```txt
FAIL tests/node-http-handler.test.ts
createNodeHttpHandler › delegates to the gateway before the full inbound body is received
Rejected to value: [Error: Gateway handle was not called before request end.]
```

Implemented:

- Added a focused low-level `node:http` test in `tests/node-http-handler.test.ts`.
- The test opens a chunked `POST`, writes the first body chunk, keeps the request open, and expects `ProxyGateway.handle()` to have already been called.
- Current implementation fails because the Node adapter waits for full body buffering before delegating.

Next-step reassessment:

- Step 2 is still clear, small, and testable: replace inbound `Buffer.concat()` with a streaming Web `Request` body.
- Step 3 remains valid after Step 2: add the outbound response streaming Red test separately.
- Step 4 remains valid but should not be started until Step 3 is red.

### Step 2 - Green: stream IncomingMessage into Web Request

Status: completed

Scope:

- Replace the inbound `Buffer.concat()` path in `src/adapters/inbound/node-http-handler.ts`.
- For methods with a request body, pass a `ReadableStream<Uint8Array>` as the Web `Request` body.
- Include `duplex: "half"` in the request init for streaming bodies.
- Create the abort signal before the body is handed to `Request`.
- Preserve raw headers through the existing `createHeaders()` behavior.
- Preserve URL construction behavior.

Implementation notes:

- Prefer Node built-ins only.
- Keep conversion local to the inbound adapter.
- If using Node stream-to-Web APIs requires loose typing, avoid `any` and `as`; prefer a small typed wrapper that reads chunks as `unknown` and narrows through the existing `toBuffer()` helper or a new precise helper.
- Do not parse JSON, multipart, or proxy-fetch metadata in the adapter.

Post-green cleanup:

- Remove dead helpers such as `readIncomingMessageBody()` and `copyToArrayBuffer()` if they are no longer used.

Verify:

```sh
npm test -- node-http-handler
npm test -- inbound-adapter-contract
```

Verify result:

```txt
npm test -- node-http-handler
Test Suites: 2 passed, 2 total
Tests: 18 passed, 18 total

npm test -- inbound-adapter-contract
Test Suites: 1 passed, 1 total
Tests: 4 passed, 4 total

npm run typecheck
tsc --noEmit passed
```

Implemented:

- `src/adapters/inbound/node-http-handler.ts` now creates a streaming Web `Request` body from `IncomingMessage`.
- Streaming request bodies use `duplex: "half"` in the Web `Request` init.
- Removed the inbound `Buffer.concat()` body read path and the extra Blob/ArrayBuffer copy.
- Kept URL, method, raw header preservation, and abort signal wiring in the Node adapter.
- Response writing is intentionally unchanged; outbound streaming remains Step 3/4.

Next-step reassessment:

- Step 3 is still clear, small, and testable: add the outbound Web `Response.body` streaming Red test.
- Step 4 remains the paired Green implementation for response streaming and should not start until Step 3 fails for the expected `response.arrayBuffer()` reason.
- Step 5 remains separate app-layer work for bounded JSON envelope reads; it should not be folded into Node adapter work.

### Step 3 - Red: add outbound streaming reproduction test

Status: completed (red)

Scope:

- Add Reproduction Test B to the Node HTTP handler suite.
- Keep it focused on Web `Response.body` to Node `ServerResponse` streaming.
- Do not involve real proxy-fetch envelope construction in this test.

Expected red:

- Current `writeResponse()` awaits `response.arrayBuffer()`, so no client chunk is received until the whole Web `Response` body completes.

Green target:

- Node adapter writes chunks as they are read from `response.body`.

Verify:

```sh
npm test -- node-http-handler
```

Red result:

```txt
FAIL tests/node-http-handler.test.ts
createNodeHttpHandler › streams response chunks to the Node client before the Web Response body closes
Rejected to value: [Error: First response chunk was not streamed before body close.]
```

Implemented:

- Added a focused low-level `node:http` test in `tests/node-http-handler.test.ts`.
- The fake gateway returns a `Response` backed by a controlled `ReadableStream<Uint8Array>`.
- The first chunk is enqueued immediately, the second chunk is held behind a deferred promise, and the client expects to observe the first chunk before the Web response body closes.
- Current implementation fails because `writeResponse()` waits for `response.arrayBuffer()` before writing to `ServerResponse`.

Next-step reassessment:

- Step 4 is still clear, small, and testable: replace `response.arrayBuffer()` with chunked `ServerResponse.write()` handling.
- Step 5 remains separate app-layer work for bounded JSON envelope reads and should not be mixed into the response streaming change.
- Step 6 remains paired with Step 5 and should only start after Step 5 has a focused Red test.

### Step 4 - Green: stream Web Response to ServerResponse

Status: completed

Scope:

- Replace `response.arrayBuffer()` in `writeResponse()`.
- Keep status and headers behavior unchanged.
- If `response.body === null`, call `serverResponse.end()` without writing a body.
- Otherwise, read from `response.body.getReader()` and write each `Uint8Array` chunk to `ServerResponse`.
- Respect Node backpressure: when `serverResponse.write()` returns `false`, wait for `drain` before continuing.
- Handle read/write errors by ending or destroying the Node response without masking already-started response behavior.

Implementation notes:

- Use Node built-ins only, such as `node:events` for `once`.
- Keep the adapter ignorant of proxy-fetch envelope structure.
- Preserve binary bytes exactly.

Verify:

```sh
npm test -- node-http-handler
npm test -- inbound-adapter-contract
```

Verify result:

```txt
npm test -- node-http-handler
Test Suites: 2 passed, 2 total
Tests: 19 passed, 19 total

npm test -- inbound-adapter-contract
Test Suites: 1 passed, 1 total
Tests: 4 passed, 4 total

npm run typecheck
tsc --noEmit passed
```

Implemented:

- Replaced `response.arrayBuffer()` in `src/adapters/inbound/node-http-handler.ts`.
- `Response.body === null` now ends the Node response without body materialization.
- Streaming Web response bodies are read with `getReader()` and written to `ServerResponse` chunk-by-chunk.
- Node backpressure is respected by waiting for `drain` when `serverResponse.write()` returns `false`.
- Response stream/write errors destroy the Node response instead of appending an internal error body after streaming has started.

Next-step reassessment:

- Step 5 is still clear, small, and testable: add a focused Red test for oversized JSON service envelope reads.
- Step 6 remains the matching Green implementation in `src/app/envelopes`, not in the Node adapter.
- Step 7 remains valid but should wait until request/response streaming and bounded envelope reads are settled, because abort propagation depends on the final stream ownership shape.

### Step 5 - Red: bound JSON service envelope reads in app/envelopes

Status: completed (red)

Scope:

- Add tests for oversized JSON proxy-fetch service requests.
- Configure a small `bodyBuffering.maxBufferedRequestBodyBytes`.
- Send a JSON service request body that exceeds the limit.
- Expect a stable service error instead of unbounded `request.text()` behavior.

Expected red:

- Current JSON parser calls `request.text()` without an explicit read limit.

Green target:

- JSON and multipart service envelope reads both have bounded reads owned by `src/app/envelopes`.

Verify:

```sh
npm test -- proxy-fetch-json-envelope
npm test -- gateway-plan-flow
```

Red result:

```txt
npm test -- proxy-fetch-json-envelope
FAIL tests/proxy-fetch-json-envelope.test.ts
ProxyFetchEnvelopeParser multipart dispatch › enforces the configured JSON request body limit while reading
Received promise resolved instead of rejected

npm test -- gateway-plan-flow
FAIL tests/gateway-plan-flow.test.ts
gateway planner-owned direct flow › returns a stable service error when the JSON service request exceeds the configured body limit
Expected: 400
Received: 200
```

Implemented:

- Added a parser-level Red test in `tests/proxy-fetch-json-envelope.test.ts`.
- Added a gateway-level Red test in `tests/gateway-plan-flow.test.ts`.
- The parser test expects `ProxyFetchEnvelopeParser` to reject oversized JSON service envelopes with `JSON request body exceeded 80 bytes.`.
- The gateway test expects the parser failure to become a stable `INVALID_PROXY_FETCH_REQUEST` service error and to prevent target transport execution.
- Current implementation fails because JSON parsing still uses unbounded `request.text()`.

Next-step reassessment:

- Step 6 is still clear, small, and testable: add bounded JSON body reading inside `src/app/envelopes`.
- Step 7 remains valid and should wait until Step 6 is green, because abort behavior depends on the final JSON/multipart stream read path.
- Step 8 remains a regression pass after Step 6 and Step 7, with no new architecture rule needed yet.

### Step 6 - Green: add bounded JSON envelope body reader

Status: pending

Scope:

- Update `ProxyFetchJsonEnvelopeParser` so it receives the same body buffering policy shape already used by multipart parsing.
- Replace `request.text()` with a bounded stream read helper.
- Decode bytes as UTF-8 after the limit check.
- Keep existing JSON error messages stable unless tests require a more specific stable message.
- Ensure unsupported content type and malformed JSON behavior remains compatible with existing tests.

Implementation notes:

- Do not move app-layer limits into the Node adapter.
- Avoid duplicate ad hoc stream-reading code if a narrow shared helper inside `proxy-fetch-json-envelope.ts` is enough.
- Preserve default policy values from `DEFAULT_BODY_BUFFERING_POLICY`.

Verify:

```sh
npm test -- proxy-fetch-json-envelope
npm test -- proxy-fetch-wire-compatibility
```

### Step 7 - Red/Green: abort propagation during streaming inbound request

Status: pending

Scope:

- Add a test where a client aborts while the gateway is reading the streamed request body.
- The Web `Request.signal` observed by the fake gateway should abort.
- The body stream should not continue indefinitely after client abort.

Expected red:

- Current abort signal is created after full inbound body buffering, so it cannot represent aborts during that buffering phase.

Green target:

- Abort signal is created before gateway delegation and is tied to `IncomingMessage` abort/close events.

Verify:

```sh
npm test -- node-http-handler
npm test -- timeout-controller
```

### Step 8 - Regression: preserve raw JSON and multipart compatibility

Status: pending

Scope:

- Run existing adapter contract tests.
- Add focused regression cases only if current tests do not cover:
  - raw JSON bytes preserved;
  - multipart bytes and boundary preserved;
  - binary request body bytes preserved;
  - duplicate headers behavior remains unchanged where Node/Web header semantics allow it.

Verify:

```sh
npm test -- inbound-adapter-contract
npm test -- node-http-handler-matrix
npm test -- proxy-fetch-wire-compatibility
```

### Step 9 - Full verification

Status: pending

Run:

```sh
npm run typecheck
npm test
npm run pack:check
```

Do not run `npm run lint` during exploratory work unless ready for formatter/fixer changes, because the current lint script runs ESLint with `--fix`.

## Next-Step Reassessment Checklist

After each completed step:

- Mark the step complete in this file.
- Add a short note describing what changed.
- Reassess the next three pending steps.
- Split a pending step if it is too broad or not testable.
- Check whether nested `AGENTS.md` contracts need updates.
- Update nested contracts only if the implementation creates a durable architecture rule.

## Out Of Scope

- Adding Express, Fastify, or NestJS wrappers.
- Adding provider integrations.
- Adding SOCKS/HTTP proxy transport packages.
- Changing retry/fallback semantics.
- Changing target access policy.
- Changing provider adapter contracts.
- Adding external runtime dependencies.
