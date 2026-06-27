# Detailed Local Registry Microservice E2E Plan

## Start Here: Use Real Tests

Before adding the new microservice topology, convert the existing
`e2e/local-registry/consumer` scripts from console-driven smoke scripts into a
normal test suite.

Use the built-in Node.js test runner:

```txt
node:test
node:assert/strict
```

The local-registry consumer package should run tests with a command shaped like:

```json
{
  "scripts": {
    "test:e2e": "npm run test:types && node --test --test-reporter=spec src/*.test.mjs src/*.test.cjs",
    "test:types": "tsc -p tsconfig.json --noEmit"
  }
}
```

The current scenario files should be migrated from `console.log("ok")` scripts
to named tests:

```txt
exports-smoke.mjs       -> exports.test.mjs
esm-smoke.mjs           -> esm.test.mjs
cjs-smoke.cjs           -> cjs.test.cjs
node-http-smoke.mjs     -> node-http.test.mjs
base64-smoke.mjs        -> base64.test.mjs
multipart-smoke.mjs     -> multipart.test.mjs
v02-config-smoke.mjs    -> v02-config.test.mjs
```

Shell scripts and Docker Compose should only orchestrate package publishing,
container startup, and test command execution. Assertions belong in
`.test.mjs` or `.test.cjs` files, not in ad hoc scripts that print success
messages.

The new microservice lab must follow this paradigm from the first committed
scenario. The `micro-consumer` service is the test runner service, and its main
command should run:

```sh
npm run test:e2e
```

or directly:

```sh
node --test --test-reporter=spec src/*.test.mjs
```

The Docker exit code should come from the Node test runner. A passing scenario
is a passed test, not a printed `ok` line.

## Goal

Create an end-to-end lab that proves `@echospecter/proxy-fetch` and
`@echospecter/proxy-gateway` work together as separately installed packages
while `@echospecter/proxy-gateway` is installed from the local Verdaccio
registry before it is published publicly.

The lab should exercise a realistic microservice topology:

```txt
micro-consumer service
  -> @echospecter/proxy-fetch from npmjs.org
  -> micro-gateway service
  -> @echospecter/proxy-gateway from local Verdaccio
  -> micro-provider service
  -> real public API endpoints
```

The test must cover different request and response body formats, not only a
single JSON GET path.

## Non-Goals

- Do not publish `@echospecter/proxy-gateway` to npmjs.org from this lab.
- Do not require a local publish of `@echospecter/proxy-fetch`; it is already
  available from npmjs.org and may be installed through Verdaccio's npmjs
  uplink.
- Do not add provider, proxy-agent, SOCKS, framework, or config-loader
  dependencies to the gateway runtime package.
- Do not turn live public endpoints into the only compatibility source of
  truth; they are an installed-package integration layer.
- Do not move proxy execution, routing, provider selection, or retry policy
  into `@echospecter/proxy-fetch`.

## Source Repositories

- Proxy Fetch GitHub repository:
  `https://github.com/Dotcommando/proxy-fetch`
- Proxy Fetch npm package:
  `https://www.npmjs.com/package/@echospecter/proxy-fetch`
- Proxy Fetch live endpoint source:
  `https://github.com/Dotcommando/proxy-fetch/blob/master/tests/live/live-endpoints.live-e2e.cjs`

The local registry flow should publish only the local gateway repository into
Verdaccio. The proxy-fetch repository remains useful as a source of scenario
fixtures and compatibility expectations, but the consumer should install the
published npm package unless a future task explicitly requests local
proxy-fetch testing.

Do not commit developer-specific absolute paths such as local home-directory
paths into this plan or the e2e fixtures. If a local proxy-fetch checkout is
useful during implementation, pass it through an environment variable such as
`PROXY_FETCH_REPO`, and keep that value out of committed files.

## Existing Inputs To Reuse

Use the current gateway local registry lab as the base:

```txt
e2e/local-registry/docker-compose.yml
e2e/local-registry/scripts/reset-registry.sh
e2e/local-registry/scripts/publish-local.sh
e2e/local-registry/verdaccio/config.yaml
```

The existing Verdaccio config currently treats `@echospecter/*` as local-only.
For this microservice lab, add a more specific package rule before the
`@echospecter/*` rule so `@echospecter/proxy-fetch` can be read from npmjs:

```yaml
packages:
  '@echospecter/proxy-fetch':
    access: $all
    proxy: npmjs

  '@echospecter/*':
    access: $all
    publish: $anonymous
    unpublish: $anonymous
```

This lets containers use Verdaccio as the single registry while still resolving
`@echospecter/proxy-fetch` through npmjs and resolving
`@echospecter/proxy-gateway` from the local Verdaccio publish.

Use the proxy-fetch live endpoint scenarios as the source of the public endpoint
matrix. Copy the endpoint list into this repository's e2e fixture instead of
loading it from a developer-specific local checkout:

```txt
e2e/local-registry/microservices/shared/live-endpoints.mjs
```

The fixture should be derived from:

```txt
https://github.com/Dotcommando/proxy-fetch/blob/master/tests/live/live-endpoints.live-e2e.cjs
```

Use the proxy-fetch README and compatibility tests as references for the
request/response format matrix, but copy the scenario definitions needed by
this gateway e2e lab into local shared fixtures. The microservice lab should not
import test files from the proxy-fetch repository at runtime.

## Proposed Layout

Add a separate microservice lab under the existing local registry directory:

```txt
e2e/local-registry/
  docker-compose.microservices.yml
  scripts/
    run-microservices-e2e.sh
    publish-local-gateway.sh
  microservices/
    consumer/
      package.json
      src/
        live-endpoints.test.mjs
        request-body-formats.test.mjs
        response-formats.test.mjs
        client-boundary.test.mjs
        timeout-abort-errors.test.mjs
        gateway-policy.test.mjs
        concurrency.test.mjs
        helpers/
          assertions.mjs
          http.mjs
          observations.mjs
          proxy-fetch-client.mjs
    gateway/
      package.json
      src/
        server.mjs
        gateway-config.mjs
        mock-provider-adapter.mjs
        remote-provider-transport.mjs
    mock-provider/
      package.json
      src/
        server.mjs
        target-fetch.mjs
        observations.mjs
    shared/
      live-endpoints.mjs
      body-format-scenarios.mjs
      http.mjs
```

Keep the existing `consumer/` package directory, but migrate its scenario
scripts to `node:test` before adding the new microservice suite. The new
`microservices/` directory should be additive so the current local registry
release gate remains stable while the larger lab is developed.

## Coexistence With Existing Local Registry Tests

The existing path stays as the fast package-consumption test suite:

```txt
e2e/local-registry/docker-compose.yml
e2e/local-registry/consumer/
```

That suite should continue to use its existing compose service name `consumer`,
package directory, and volume names. It verifies lightweight
package-consumption behavior and should remain quick enough for the normal
release gate. Its internals should become `node:test` files rather than
console-driven scripts.

The new microservice lab must avoid name collisions by using:

```txt
e2e/local-registry/docker-compose.microservices.yml
e2e/local-registry/microservices/consumer/
e2e/local-registry/microservices/gateway/
e2e/local-registry/microservices/mock-provider/
```

Compose service names should be distinct:

```txt
micro-consumer
micro-gateway
micro-provider
```

Compose volumes should also be distinct:

```txt
micro-consumer-node-modules
micro-gateway-node-modules
micro-provider-node-modules
micro-verdaccio-storage
```

Prefer setting a dedicated compose project name in the runner, for example:

```sh
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml ...
```

This prevents accidental reuse of the current `local-registry_*` service and
volume names when both labs are run during development.

## Docker Compose Services

### `verdaccio`

Reuse the existing Verdaccio image and config.

Requirements:

- accessible from host publishing scripts at `http://localhost:4873`;
- accessible from containers at `http://verdaccio:4873`;
- anonymous publish remains local-only;
- npmjs uplink must remain enabled;
- `@echospecter/proxy-fetch` should resolve from npmjs through the uplink;
- `@echospecter/proxy-gateway` must resolve from the local Verdaccio publish.

### `micro-provider`

Node service that simulates a remote provider/proxy service.

Responsibilities:

- receive execution requests from the micro-gateway service;
- perform real outbound `fetch()` to public API endpoints;
- preserve method, headers, and body bytes where possible;
- return normalized response data to the gateway transport;
- record observations for test assertions;
- expose a health endpoint.

Suggested endpoints:

```txt
GET  /health
POST /execute
GET  /observations
POST /observations/reset
```

`POST /execute` should accept a JSON payload with base64 for binary bodies:

```json
{
  "requestId": "request-id",
  "target": {
    "url": "https://httpbin.org/post",
    "method": "POST",
    "headers": [["content-type", "application/json"]],
    "body": {
      "kind": "base64",
      "data": "..."
    }
  }
}
```

It should return a JSON payload that can represent text, null, and binary
responses:

```json
{
  "url": "https://httpbin.org/post",
  "status": 200,
  "statusText": "OK",
  "redirected": false,
  "type": "basic",
  "headers": [["content-type", "application/json"]],
  "body": {
    "kind": "base64",
    "data": "..."
  }
}
```

The mock provider may add an `x-mock-provider-id` response header so the
consumer can prove the response passed through the provider service.

### `micro-gateway`

Node service that installs and runs the locally published
`@echospecter/proxy-gateway`.

Responsibilities:

- expose `POST /proxy-fetch`;
- build `createProxyGateway()` with a mock provider adapter;
- configure route/default-route/pipeline policy so requests go through normal
  gateway planning;
- use an e2e-only `TargetTransportPort` that forwards execution to
  `micro-provider`;
- expose lightweight diagnostics only for e2e assertions.

Suggested endpoints:

```txt
GET  /health
POST /proxy-fetch
GET  /observations
POST /observations/reset
```

The gateway config should test public configuration surfaces:

- `providers`;
- `defaultRoute`;
- at least one `routes` entry;
- at least one `pipelines` entry with built-in steps;
- `sessionStore: createMemoryProxySessionStore()`;
- `targetAccess` allowing the selected public endpoint hosts;
- `timeouts` suitable for live endpoints.

The mock provider adapter can return a provider-agnostic lease such as:

```txt
providerInstanceId: "mock-provider-primary"
providerKind: "mock-remote-provider"
route: custom transport route or e2e forward route to micro-provider
```

The transport should remain in the e2e service code, not in gateway runtime
source.

### `micro-consumer`

Node service that installs and runs the npm-published
`@echospecter/proxy-fetch`.

Responsibilities:

- create a real `proxyFetch` client pointed at `http://micro-gateway:3000/proxy-fetch`;
- execute public endpoint scenarios;
- execute request body format scenarios;
- assert native `Response` behavior after proxy-fetch reconstructs the service
  response;
- query `micro-provider` observations to prove requests did not bypass the
  micro-gateway/micro-provider path.

The consumer should not import source files from either repository. It should
use the installed `@echospecter/proxy-fetch` package from npmjs, resolved either
directly or through Verdaccio's npmjs uplink.

## Local Publish Flow

Add a script:

```txt
e2e/local-registry/scripts/publish-local-gateway.sh
```

Inputs:

```txt
GATEWAY_REPO=<path-to-this-repository>
REGISTRY_URL=http://localhost:4873
```

Behavior:

1. Write a temporary `.npmrc.local-registry` for the gateway repository.
2. Publish `@echospecter/proxy-gateway` from the local gateway repo to
   Verdaccio.
3. Use `--registry http://localhost:4873 --access public --tag local`.
4. Never publish `@echospecter/proxy-gateway` to npmjs.org from this lab.

The script can reuse the existing `publish-local.sh`:

```sh
./e2e/local-registry/scripts/publish-local.sh "$GATEWAY_REPO"
```

Before republishing the same versions, run:

```sh
./e2e/local-registry/scripts/reset-registry.sh
```

## Test Runner Flow

Add a single high-level script:

```txt
e2e/local-registry/scripts/run-microservices-e2e.sh
```

Expose that runner through a short root `package.json` script so the full
microservice lab can be run from the repository root with one command:

```sh
npm run test:e2e:microservices
```

The root script should delegate to
`./e2e/local-registry/scripts/run-microservices-e2e.sh`. Do not add this
heavier live lab to the default `npm test` command.

Expected flow:

```sh
#!/usr/bin/env sh
set -eu

./e2e/local-registry/scripts/reset-registry.sh
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml up -d verdaccio
./e2e/local-registry/scripts/publish-local-gateway.sh
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml up -d micro-provider micro-gateway
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml run --rm micro-consumer npm run test:e2e
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml down
```

The final implementation should use `trap` so `docker compose down` runs after
failures.

## Dependency Rules

Consumer package:

```json
{
  "scripts": {
    "test:e2e": "node --test --test-reporter=spec"
  },
  "dependencies": {
    "@echospecter/proxy-fetch": "^0.1.0"
  }
}
```

Use Node test discovery for `micro-consumer` so focused verify commands can
append Node test filters through npm, for example:

```sh
npm run test:e2e -- --test-name-pattern health
```

Gateway package:

```json
{
  "dependencies": {
    "@echospecter/proxy-gateway": "local"
  }
}
```

If npm dist-tags in `package.json` prove unreliable in the container install
path for the locally published gateway package, use the exact gateway version
copied from the local gateway package manifest. Keep that version wiring inside
the e2e scripts, not in runtime code.

All microservice containers should set:

```txt
NPM_CONFIG_REGISTRY=http://verdaccio:4873
```

With the Verdaccio package rules above, this single registry setting should
install `@echospecter/proxy-fetch` through the npmjs uplink and
`@echospecter/proxy-gateway` from the local registry.

The compose install command should use:

```sh
npm install --package-lock=false --no-audit --no-fund
```

## Data Path Assertions

Every scenario should assert the full path:

```txt
consumer proxyFetch call
  -> gateway /proxy-fetch received proxy-fetch.v1 envelope
  -> gateway selected mock provider
  -> gateway transport called micro-provider /execute
  -> micro-provider fetched public endpoint
  -> gateway returned proxy-fetch.v1 service response
  -> proxy-fetch reconstructed native Response
```

Minimum assertions:

- consumer receives a native `Response`;
- response status and body match scenario expectations;
- response contains provider marker header where appropriate;
- micro-provider observations include the exact target URL;
- micro-provider observations include method and request body hash/length;
- gateway observations include selected provider instance id;
- gateway observations include route/pipeline/session path for selected tests.

## Live Public Endpoint Matrix

Start with the endpoint set from proxy-fetch live e2e:

| Scenario | Endpoint | Expected Coverage |
| --- | --- | --- |
| JSONPlaceholder | `https://jsonplaceholder.typicode.com/posts/1` | JSON GET response |
| Open-Meteo | `https://api.open-meteo.com/v1/forecast?...` | JSON API without auth |
| GitHub README | `https://api.github.com/repos/nodejs/node/readme` | JSON response containing base64 field, custom request headers |
| httpbin base64 | `https://httpbin.org/base64/SGVsbG8sIGZldGNoIQ==` | text response |
| httpbin stream | `https://httpbin.org/stream/10` | JSON-lines text response |
| httpbin stream bytes | `https://httpbin.org/stream-bytes/1024?chunk_size=128` | binary response |
| httpbin multipart POST | `https://httpbin.org/post` | `FormData` upload and JSON echo |
| httpbin gzip | `https://httpbin.org/gzip` | compressed upstream response decoded by fetch |
| Picsum image | `https://picsum.photos/200/300` | redirect plus binary image response |
| World Bank XML/JSON | `https://api.worldbank.org/...` | XML text and JSON variants |

Live endpoint behavior can be flaky. Preserve the proxy-fetch approach of
allowing temporary upstream statuses such as `429`, `502`, `503`, and `504` to
skip strict content assertions while still proving the proxy path was exercised.

## Request Body Format Matrix

Add body-format scenarios against a stable echo endpoint such as
`https://httpbin.org/post`.

| Scenario | proxyFetch Input | Expected Service/Gateway Coverage |
| --- | --- | --- |
| no body | `GET` | JSON envelope with `request.body: null` |
| string body | `POST`, string | JSON envelope text body |
| JSON string body | `POST`, JSON string with `content-type: application/json` | text request body and JSON echo |
| URLSearchParams | `POST`, `new URLSearchParams()` | text request body and form-urlencoded header |
| Uint8Array | `POST`, `Uint8Array` | multipart request body by default |
| ArrayBuffer | `POST`, `ArrayBuffer` | multipart request body by default |
| Blob | `POST`, `Blob` | multipart request body by default |
| FormData | `POST`, `FormData` with file | multipart request body preserving fields/file |
| ReadableStream | `POST`, stream with `duplex: "half"` | multipart request body preserving stream bytes |
| Request object | `proxyFetch(new Request(...))` | Request metadata/body preservation |
| JSON base64 fallback | `binaryBodyTransport: "json-base64"` | JSON request body `{ kind: "base64" }` |

The consumer should assert target-visible body content through httpbin echo
where possible. The micro-provider should also record body byte length and a
stable hash so binary payloads can be checked without logging raw bytes.

Add two consumer-only preflight scenarios that should not call the gateway:

| Scenario | Expected Result |
| --- | --- |
| already-consumed `Request` body | `proxyFetch()` rejects like native Fetch and gateway observations stay empty |
| non-`undefined` `dispatcher` option | `proxyFetch()` throws `TypeError` and gateway observations stay empty |

## Response Body Format Matrix

Use real public endpoints and micro-provider-controlled response forwarding to
cover:

| Scenario | Source | Expected Consumer Behavior |
| --- | --- | --- |
| JSON text response | JSONPlaceholder/Open-Meteo | `response.json()` works |
| plain text response | httpbin base64 endpoint | `response.text()` works |
| XML text response | World Bank XML | `response.text()` preserves XML |
| JSON-lines text response | httpbin stream | line splitting and JSON parse per line |
| binary response | httpbin stream-bytes | `response.arrayBuffer()` byte length matches |
| image response | Picsum | binary bytes and image content-type |
| null body status | micro-provider controlled `204` endpoint or gateway fixture path | `response.body` behaves as null-body response |
| target HTTP error | stable endpoint returning 404, or micro-provider controlled fallback | target status is a normal `Response`, not service error |
| multipart service response | binary response with proxy-fetch accepting multipart | native binary `Response` reconstruction |
| JSON base64 service response | force gateway JSON response path for bytes | native binary `Response` reconstruction |

If live services do not provide stable null-body or error responses, add
micro-provider test modes under URLs such as:

```txt
micro-provider://status/204
micro-provider://status/404
```

or expose explicit micro-provider passthrough routes just for those deterministic
cases. Keep deterministic format tests separate from live endpoint tests.

Also assert native `Response` API reconstruction details:

- `response.url`;
- `response.redirected`;
- `response.type`;
- `response.statusText`;
- `response.headers`;
- `response.clone()`;
- `response.bodyUsed`.

For null-body responses, cover all null-body statuses:

- `204`;
- `205`;
- `304`.

For special response states, use deterministic micro-provider or gateway fixture
modes and assert the documented envelope shape:

- `type: "error"`;
- `type: "opaque"`;
- `type: "opaqueredirect"`;
- `status: 0`;
- empty `statusText`;
- no headers;
- `body: null`.

## Client Configuration And Service Boundary Matrix

Add scenarios that prove `proxy-fetch` client configuration crosses the
microservice boundary correctly.

| Scenario | Expected Assertions |
| --- | --- |
| `PROXY_FETCH_SERVICE_URL` env fallback | consumer omits `serviceUrl`, request still reaches gateway |
| explicit `serviceUrl` | exact endpoint is used; no path is appended automatically |
| `apiKey` | service `Authorization` reaches gateway; micro-provider does not receive it as a target header |
| target `authorization` header | micro-provider receives target auth; gateway redaction hides it in diagnostics |
| `defaultHeaders` | micro-provider receives default target headers |
| request headers override defaults | request-level value wins |
| `defaultContext` | gateway observes default `useCase`, `consistency`, and metadata |
| request context merge | request context overrides matching fields and merges `metadata` |

The service transport headers and target request headers must stay separate.
This is one of the highest-value checks in the full microservice topology.

## Fetch Metadata Matrix

Add scenarios proving non-default Fetch metadata is serialized by proxy-fetch,
accepted by gateway, and visible to the e2e transport/micro-provider layer.

| Metadata | Suggested Scenario |
| --- | --- |
| `redirect: "manual"` | controlled redirect endpoint; assert final behavior and gateway final URL guard |
| `referrer` | micro-provider observes expected target referrer behavior where Node fetch exposes it |
| `referrerPolicy` | deterministic micro-provider observation, or gateway transport input assertion |
| `integrity` | deterministic success/failure where practical; otherwise assert metadata reaches transport |
| `keepalive` | assert metadata reaches gateway transport input |
| `duplex: "half"` | ReadableStream upload scenario |
| `cache` | assert metadata reaches gateway transport input |
| `credentials` | assert metadata reaches gateway transport input |
| `mode` | assert metadata reaches gateway transport input |

Some metadata fields are not directly observable from public endpoints. For
those, assert the gateway transport input or gateway observations instead of
trying to infer behavior from the remote service.

## Timeout And Abort Matrix

Add deterministic timeout and cancellation scenarios.

| Scenario | Expected Assertions |
| --- | --- |
| local proxy-fetch timeout | gateway delays service response; consumer rejects with timeout |
| serialized `timeoutMs` | gateway observes `options.timeoutMs`; active micro-provider execution is cancelled |
| caller `AbortSignal` | consumer abort cancels the gateway request; no fallback starts |
| provider/target slow response | gateway attempt timeout returns service error through proxy-fetch |

The local proxy-fetch timeout controls the consumer-to-gateway request. The
gateway timeout controls provider acquisition and target execution. Test both
because they fail in different places.

## Error Boundary Matrix

Add scenarios that prove target failures and service failures are not confused.

| Scenario | Expected Assertions |
| --- | --- |
| target `404` | consumer receives normal `Response` with `status === 404` |
| target `500` | consumer receives normal `Response` unless policy retries/rejects |
| target access denied | proxy-fetch rejects with service-level error from gateway |
| no route matched | proxy-fetch rejects with service-level routing error |
| micro-provider network failure | proxy-fetch rejects with service-level gateway/provider error |
| invalid service response fixture | consumer rejects with invalid service response error; gateway is not involved |

Invalid service response tests can remain consumer-only because a correct
gateway should not intentionally emit invalid envelopes.

## Gateway Policy Scenarios

After the basic data path works, add gateway-specific scenarios:

1. Default route sends requests to `mock-provider-primary`.
2. Route match by host sends selected domains to `mock-provider-primary`.
3. Pipeline with `requirements.geo`, `providers.tags`, `providers.priority`,
   and `plan.fallback` produces the executable plan.
4. Sticky session reuses the same provider for repeated requests with the same
   flow key.
5. Fallback switches to `mock-provider-secondary` when the primary mock provider
   returns a controlled provider failure.
6. Target access rejects localhost/private targets before micro-provider is
   called.
7. Redirect final URL guard rejects redirects to denied targets where a
   deterministic micro-provider redirect mode is used.
8. Replayable request bodies can retry/fallback after a controlled provider
   failure.
9. Non-replayable or over-limit request bodies do not retry unsafely.
10. Gateway buffering limits produce stable service errors or disable retry
   according to configured policy.

These should be added after format coverage so failures are easier to isolate.

## Security And Redaction Scenarios

Add failure scenarios with secrets in multiple places:

- target `authorization`;
- target `cookie`;
- target query string such as `?api_key=secret`;
- provider route credentials or metadata;
- service API key.

Assertions:

- consumer receives redacted service error details;
- gateway observations do not expose secrets;
- micro-provider observations do not receive service API key;
- target access denial happens before provider execution.

## Concurrency And Isolation Scenarios

Add a parallel scenario batch after the single-request paths pass.

Suggested coverage:

- parallel requests to different public endpoints;
- parallel requests with different `tenantId`;
- parallel requests with different `flowKey`;
- sticky sessions do not cross tenant/flow boundaries;
- request IDs remain unique;
- observations can be correlated without race-prone global state.

## Observability Contract

Use in-memory observations inside the gateway and micro-provider services.

Mock provider observation shape:

```json
{
  "requestId": "request-id",
  "targetUrl": "https://httpbin.org/post",
  "method": "POST",
  "requestBodyKind": "base64",
  "requestBodyBytes": 123,
  "requestBodySha256": "...",
  "responseStatus": 200,
  "responseBodyBytes": 456
}
```

Gateway observation shape:

```json
{
  "requestId": "request-id",
  "providerInstanceId": "mock-provider-primary",
  "providerKind": "mock-remote-provider",
  "planKind": "fallback",
  "routeMatched": "default-live-route",
  "session": "miss|hit|write|none"
}
```

Do not log secrets, cookies, authorization headers, or full binary bodies.

## Implementation Steps

Focused verify commands that run only `micro-consumer` assume Verdaccio has
already been started, the local gateway package has been published, and
`micro-provider` plus `micro-gateway` are running. The one-command runner in
Step 20 must perform that full setup from a clean state.

### 1. Convert Existing Local Registry Consumer To Node Test - Completed

Purpose:

- Stop treating e2e package checks as success-printing scripts.
- Make the existing local-registry consumer behave like a normal test suite
  before adding the larger microservice lab.

Red:

- Rename or wrap the existing scenario scripts as `.test.mjs` and `.test.cjs`
  files using `node:test`.
- Replace success-only `console.log("ok")` checks with named assertions.
- Keep `tsc -p tsconfig.json --noEmit` as a separate type contract check.

Green:

- Update `e2e/local-registry/consumer/package.json` to run:

```sh
npm run test:types && node --test --test-reporter=spec src/*.test.mjs src/*.test.cjs
```

- Keep assertions in test files with `node:assert/strict`.
- Keep Docker and shell scripts as orchestration only.
- Preserve the existing coverage: exports, types, ESM, CJS, Node HTTP, base64,
  multipart, and v0.2 config.

Verify:

```sh
./e2e/local-registry/scripts/reset-registry.sh
docker compose -f e2e/local-registry/docker-compose.yml up -d verdaccio
./e2e/local-registry/scripts/publish-local.sh "$GATEWAY_REPO"
docker compose -f e2e/local-registry/docker-compose.yml run --rm consumer
docker compose -f e2e/local-registry/docker-compose.yml down
```

The existing `consumer` compose command performs `npm install` before running
the `smoke` compatibility alias, which now delegates to `test:e2e`.

Progress:

- Renamed existing consumer scenario files from `*-smoke` scripts to
  `.test.mjs`/`.test.cjs` files and renamed the shared helper to
  `test-common.mjs`.
- Replaced success-printing top-level scripts with `node:test` and
  `node:assert/strict` assertions.
- Added `test:e2e` and `test:types` scripts while keeping `smoke` and
  `smoke:types` as compatibility aliases for existing compose usage.
- Switched the consumer dependency on `@echospecter/proxy-gateway` to the
  Verdaccio `local` dist-tag produced by `publish-local.sh`, avoiding drift
  from the package version in this repository.
- Used flat `src/*.test.mjs src/*.test.cjs` test globs because the Node 20
  Alpine consumer does not expand quoted recursive globs before the test
  runner receives them.
- Preserved the existing package-consumption coverage: public exports, ESM,
  CJS, Node HTTP handler, JSON base64 body handling, multipart body handling,
  v0.2 route/pipeline/session config, and TypeScript type imports.
- Updated `e2e/local-registry/AGENTS.md` with the durable rule that consumer
  scenarios run through `node:test`, the existing consumer uses the `local`
  dist-tag, and shell/Docker only orchestrate.
- Verified with root lint/typecheck, local publish through Verdaccio, and the
  compose consumer run; the consumer reports 9 passing Node tests.

Next three steps reassessment:

- Step 2 is ready. It should create the new microservice package skeleton using
  the same `node:test` pattern established here, with a minimal passing
  skeleton test rather than a success-printing script.
- Step 3 is ready after Step 2. Its compose service commands should invoke
  `npm run test:e2e` in `micro-consumer`, not direct scenario scripts.
- Step 4 is ready after Step 3. Health checks should be ordinary
  `health.test.mjs` tests and should reuse the helper/assertion style from the
  converted consumer suite.

### 2. Add Microservice Test Package Skeleton

Purpose:

- Create the new microservice test tree without changing runtime behavior.
- Keep it isolated from the existing `e2e/local-registry/consumer` suite.

Red:

- Add empty package directories for `consumer`, `gateway`, and `mock-provider`
  under `e2e/local-registry/microservices`. The future compose service can
  still be named `micro-provider`.
- Add a placeholder `micro-consumer` test command that fails because no test
  file exists yet.

Green:

- Add package manifests under `e2e/local-registry/microservices/*`.
- Add `micro-consumer` `test:e2e` script using `node:test`.
- Add one passing `skeleton.test.mjs` proving the test runner works.
- Add shared helper file placeholders only where immediately needed.
- Do not add Docker Compose wiring in this step yet.

Verify:

```sh
npm --prefix e2e/local-registry/microservices/consumer run test:e2e
```

### 3. Add Dedicated Microservice Compose Wiring - Completed

Purpose:

- Add the separate compose topology with collision-free names and volumes.

Red:

- Add `docker-compose.microservices.yml`.
- `micro-consumer` should fail until `micro-gateway` and `micro-provider`
  expose health endpoints.

Green:

- Add `verdaccio`, `micro-consumer`, `micro-gateway`, and `micro-provider`
  services.
- Use distinct volumes: `micro-consumer-node-modules`,
  `micro-gateway-node-modules`, `micro-provider-node-modules`, and
  `micro-verdaccio-storage`.
- Use the dedicated compose project name in documentation and verify commands.

Verify:

```sh
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml config
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml up -d verdaccio
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml down
```

Progress:

- Added `e2e/local-registry/docker-compose.microservices.yml` with
  `verdaccio`, `micro-consumer`, `micro-gateway`, and `micro-provider`
  services.
- Mapped service directories to `microservices/consumer`,
  `microservices/gateway`, and `microservices/mock-provider`.
- Added distinct `micro-*` node_modules/storage volumes and avoided fixed
  `container_name` values so the lab can run under the dedicated compose
  project name.
- Kept gateway/provider commands as direct `node src/server.mjs` commands for
  now; package install for the gateway starts in Step 5 after the local gateway
  package is published.
- Updated `e2e/local-registry/AGENTS.md` with the durable compose isolation
  rule.
- Verified compose config, `verdaccio` startup, and compose shutdown.

Next three steps reassessment:

- Step 4 is ready. It should add `src/server.mjs` files and package `start`
  scripts for `gateway` and `mock-provider`, then add health tests that use
  only Node built-ins so they can run before package-source assertions.
- Step 5 needs one clarification: after publishing the local gateway package,
  update the gateway container command to install dependencies before starting
  the server, because Step 3 intentionally avoided install before publication.
- Step 6 is ready after Step 5. Provider deterministic modes can build on the
  `mock-provider` server introduced in Step 4 and should keep using the
  existing `micro-provider` compose service.

### 4. Add Health Servers And Test Harness - Completed

Purpose:

- Make the microservice containers runnable before package-specific behavior is
  implemented.

Red:

- Add `micro-consumer` health tests that fail while service health endpoints are
  missing.

Green:

- Add `GET /health` to `micro-gateway` and `micro-provider`.
- Add `micro-consumer` helpers that wait for health endpoints.
- Add a passing `health.test.mjs` in `micro-consumer`.

Verify:

```sh
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml up -d verdaccio micro-gateway micro-provider
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml run --rm micro-consumer npm run test:e2e -- --test-name-pattern health
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml down
```

Progress:

- Added health-only `src/server.mjs` files for `micro-gateway` and
  `micro-provider`, each using Node built-in `node:http`.
- Added `start` scripts to the gateway and mock-provider packages and wired the
  compose services to run those scripts.
- Added `MICRO_GATEWAY_BASE_URL` and `MICRO_PROVIDER_BASE_URL` to
  `micro-consumer` compose environment.
- Added `micro-consumer` health test plus a small HTTP helper that waits for
  JSON health responses.
- Changed `micro-consumer` `test:e2e` to use Node test discovery so focused
  npm filters such as `--test-name-pattern health` are passed before test file
  discovery.
- Updated `e2e/local-registry/AGENTS.md` with the durable rule for
  `micro-consumer` test discovery.
- Verified the compose health flow and local lint/typecheck.

Next three steps reassessment:

- Step 5 is ready. It should publish/install packages and add package-source
  assertions without changing the basic health contract introduced here.
- Step 6 is ready after Step 5. It should extend the existing
  `mock-provider/src/server.mjs` with `/execute` and observations instead of
  replacing the server.
- Step 7 needs a scope clarification: it should extend the existing
  `gateway/src/server.mjs` from health-only behavior to the real installed
  gateway path, not create a second gateway server file.

### 5. Publish Local Gateway And Resolve Proxy Fetch From npm

Purpose:

- Prove package installation uses the intended sources.

Red:

- Gateway service install should fail when `@echospecter/proxy-gateway` is
  absent from local Verdaccio.
- Consumer install should still resolve `@echospecter/proxy-fetch` from npmjs
  through the Verdaccio uplink.

Green:

- Add the Verdaccio package rule that proxies `@echospecter/proxy-fetch` to
  npmjs before the broader `@echospecter/*` local rule.
- Add `publish-local-gateway.sh`.
- Publish the current gateway repository path supplied through `GATEWAY_REPO`.
- Update the `micro-gateway` compose command to install dependencies before
  starting the server, now that the local gateway package has been published.
- Install `@echospecter/proxy-gateway` from `http://verdaccio:4873` inside
  containers.
- Install `@echospecter/proxy-fetch` from npmjs through Verdaccio.
- Add package-source assertions in `micro-consumer` and `micro-gateway`.

Verify:

```sh
./e2e/local-registry/scripts/reset-registry.sh
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml up -d verdaccio
./e2e/local-registry/scripts/publish-local-gateway.sh
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml up -d micro-gateway
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml run --rm micro-consumer npm run test:e2e -- --test-name-pattern package
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml down
```

### 6. Implement Mock Provider Deterministic Modes - Completed

Purpose:

- Build a stable micro-provider before adding real public endpoints.

Red:

- Add `micro-provider` tests for deterministic `/execute` modes.
- Tests should fail while `/execute` is not implemented.

Green:

- Implement `POST /execute`.
- Add deterministic modes for:
  - text response;
  - JSON response;
  - binary response;
  - `204`, `205`, `304`;
  - target `404` and `500`;
  - slow response;
  - provider failure;
  - redirect to safe and denied final URLs.
- Add `GET /observations` and `POST /observations/reset`.

Verify:

```sh
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml up -d verdaccio micro-provider
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml run --rm micro-consumer npm run test:e2e -- --test-name-pattern provider
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml down
```

Progress:

- Extended `mock-provider/src/server.mjs` with `POST /execute`.
- Added deterministic modes for text, JSON, binary, `204`, `205`, `304`,
  target `404`, target `500`, slow response, provider failure, safe redirect,
  and denied redirect.
- Added in-memory observations with `GET /observations` and
  `POST /observations/reset`.
- Added `provider-deterministic.test.mjs` consumer tests covering the provider
  modes and observation recording.
- Renamed the health test title so the focused `provider` filter does not
  accidentally run health checks that require `micro-gateway`.
- Updated `e2e/local-registry/AGENTS.md` with the durable mock-provider
  deterministic API rule.
- Verified the Step 6 compose flow and local lint/typecheck.

Next three steps reassessment:

- Step 7 is ready. It can use `POST /execute` for the deterministic text path
  and can rely on provider observations already existing.
- Step 8 is ready after Step 7, but request body observation needs should extend
  the current observation records rather than introduce a second observation
  store.
- Step 9 should use the same install-before-test focused compose command as
  Steps 6-8 because the binary request tests need `@echospecter/proxy-fetch`
  installed in `micro-consumer`.

### 7. Implement Micro Gateway Deterministic Path - Completed

Purpose:

- Prove installed `@echospecter/proxy-fetch` can call installed
  `@echospecter/proxy-gateway` through a real HTTP service.

Red:

- Consumer sends a proxy-fetch request to micro-gateway and receives a service
  error because no provider/transport is wired.

Green:

- Extend the existing health-only `micro-gateway` `server.mjs`.
- Import `createProxyGateway` and `createNodeHttpHandler` from the installed
  gateway package.
- Configure one mock provider adapter.
- Implement e2e `TargetTransportPort` that forwards to `micro-provider`.
- Add gateway observations for selected provider, route, plan, and session.
- Add one deterministic proxy-fetch test that returns a text response.

Verify:

```sh
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml up -d verdaccio
./e2e/local-registry/scripts/publish-local-gateway.sh
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml up -d micro-provider micro-gateway
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml run --rm micro-consumer sh -lc "npm install --package-lock=false --no-audit --no-fund && npm run test:e2e -- --test-name-pattern deterministic"
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml down
```

Progress:

- Extended `micro-gateway/src/server.mjs` with `POST /fetch` handled by
  `createNodeHttpHandler(createProxyGateway(...))` from the installed gateway
  package.
- Added one mock provider adapter and a fallback plan targeting
  `micro-provider`.
- Added an e2e `TargetTransportPort` that forwards deterministic execution to
  `micro-provider` `POST /execute`.
- Added `GET /observations` and `POST /observations/reset` to `micro-gateway`
  for selected provider, route, plan, session, target, and release outcome
  assertions.
- Added `gateway-deterministic.test.mjs` using installed
  `@echospecter/proxy-fetch` to call the real micro-gateway service URL.
- Renamed provider scenario test titles so the focused `deterministic` filter
  only runs the gateway deterministic path and does not race provider scenario
  observation writes.
- Updated `e2e/local-registry/AGENTS.md` with durable rules for focused test
  pattern specificity and the micro-gateway deterministic path.
- Verified the full publish/install/provider/gateway deterministic compose
  flow. The publish path ran `prepublishOnly`, including lint, typecheck, 46
  Jest suites / 324 tests, and pack check.

Next three steps reassessment:

- Step 8 is ready. It should extend the existing gateway transport/provider
  request payload to capture target-visible text/JSON request body details,
  not replace the deterministic `/fetch` path.
- Step 9 is ready after Step 8. Binary request tests should build on the same
  provider observation model and keep focused test names distinct from Step 8.
- Step 10 should use the install-before-test focused compose command because
  response-format tests depend on installed `@echospecter/proxy-fetch`.

### 8. Add Request Format Tests: JSON And Text Paths - Completed

Red:

- Add failing `request-body-formats.test.mjs` scenarios for:
  - no body;
  - string body;
  - JSON string body;
  - `URLSearchParams`;
  - existing `Request` object with text body.

Green:

- Extend micro-provider observations to record target method, headers, body
  length, and body hash.
- Assert gateway receives valid JSON proxy-fetch envelopes for text/no-body
  cases.
- Assert micro-provider sees the target-visible body and content-type.

Verify:

```sh
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml run --rm micro-consumer sh -lc "npm install --package-lock=false --no-audit --no-fund && npm run test:e2e -- --test-name-pattern request-json"
```

Progress:

- Added `request-body-formats.test.mjs` with focused `request-json` scenarios
  for no body, string body, JSON string body, `URLSearchParams`, and existing
  `Request` text body.
- Extended `micro-gateway` transport observations and provider payloads with a
  target body summary containing `kind`, `byteLength`, and `sha256`.
- Extended `micro-provider` observations to record target method, URL, headers,
  content type, and target body summary.
- Asserted gateway transport and provider observations agree on the target body
  summary for each request.
- Verified that existing `Request` object text body reaches the provider intact
  as bytes, preserving byte length and hash.
- Updated `e2e/local-registry/AGENTS.md` with the durable target body
  observation shape rule.
- Verified the full publish/install/provider/gateway request-json compose flow.
  The publish path ran `prepublishOnly`, including lint, typecheck, 46 Jest
  suites / 324 tests, and pack check.

Next three steps reassessment:

- Step 9 is ready. Binary, multipart, stream, and base64 scenarios should reuse
  the `{ kind, byteLength, sha256 }` body summary and add `base64` assertions
  only where raw bytes need to be reconstructed.
- Step 10 is ready after Step 9. Response-format tests can reuse the existing
  mock-provider deterministic modes and should not change the target request
  observation contract introduced here.
- Step 11 is ready after Step 10. Its focused verify command should use the
  install-before-test wrapper because it depends on installed
  `@echospecter/proxy-fetch`.

### 9. Add Request Format Tests: Binary, Multipart, Stream, Base64 - Completed

Red:

- Add failing scenarios for:
  - `Uint8Array`;
  - `ArrayBuffer`;
  - `Blob`;
  - `FormData` with file;
  - `ReadableStream` with `duplex: "half"`;
  - JSON base64 fallback via `binaryBodyTransport: "json-base64"`;
  - already-consumed `Request`;
  - unsupported non-`undefined` `dispatcher`.

Green:

- Assert multipart request bytes preserve the target body.
- Assert JSON base64 fallback preserves bytes.
- Assert preflight errors do not call micro-gateway.

Verify:

```sh
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml run --rm micro-consumer sh -lc "npm install --package-lock=false --no-audit --no-fund && npm run test:e2e -- --test-name-pattern request-binary"
```

Progress:

- Added `request-binary-formats.test.mjs` in the microservice consumer with
  scenarios for `Uint8Array`, `ArrayBuffer`, `Blob`, `FormData` with file,
  `ReadableStream` with `duplex: "half"`, JSON base64 fallback, consumed
  `Request`, and unsupported `dispatcher`.
- Reused micro-gateway and mock-provider observations to assert target body
  summaries match at both boundaries.
- Asserted raw byte preservation by reconstructing observed `base64` bodies,
  including multipart payload bytes and JSON base64 fallback bytes.
- Asserted preflight failures happen before the micro-gateway is called.
- Updated `e2e/local-registry/AGENTS.md` with the durable binary/preflight
  observation rule.
- Verified the full publish/install/provider/gateway request-binary compose
  flow. The publish path ran `prepublishOnly`, including lint, typecheck,
  46 Jest suites / 324 tests, and pack check.

Next three steps reassessment:

- Step 10 is ready. Response-format tests should keep using deterministic
  provider modes and should compare client-visible `Response` behavior rather
  than expanding request body observations.
- Step 11 is ready after Step 10. Split special valid response envelopes from
  invalid service response fixtures so consumer-only invalid cases do not
  depend on the gateway path.
- Step 12 is ready after Step 11. Keep its focused verify command using the
  install-before-test wrapper because it depends on installed
  `@echospecter/proxy-fetch`.

### 10. Add Deterministic Response Format Tests - Completed

Red:

- Add failing `response-formats.test.mjs` scenarios for:
  - JSON text response;
  - plain text response;
  - binary response;
  - multipart service response;
  - JSON base64 service response;
  - null-body `204`, `205`, and `304`;
  - target `404` and `500`;
  - `response.url`, `redirected`, `type`, `statusText`, `headers`, `clone()`,
    and `bodyUsed`.

Green:

- Use deterministic micro-provider modes for every response shape.
- Keep target HTTP errors as normal `Response` objects.

Verify:

```sh
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml run --rm micro-consumer sh -lc "npm install --package-lock=false --no-audit --no-fund && npm run test:e2e -- --test-name-pattern response-format"
```

Progress:

- Added `response-formats.test.mjs` in the microservice consumer.
- Covered deterministic JSON, plain text, binary, multipart service response,
  JSON base64 service response fallback, null-body `204`/`205`/`304`, and
  target `404`/`500` responses through `@echospecter/proxy-fetch`.
- Asserted native `Response` metadata and behavior: `url`, `redirected`,
  `type`, `status`, `statusText`, headers, `clone()`, and `bodyUsed`.
- Captured service response `content-type` through a scoped `fetchImpl`
  wrapper to prove default binary responses use multipart service transport and
  JSON-only service `Accept` produces JSON base64 fallback.
- Confirmed target HTTP `404` and `500` remain normal client `Response`
  objects while gateway release observations classify them as
  `target-http-error`.
- Updated `e2e/local-registry/AGENTS.md` with the durable response-format
  service transport observation rule.
- Verified the full publish/install/provider/gateway response-format compose
  path. The publish path ran `prepublishOnly`, including lint, typecheck,
  46 Jest suites / 324 tests, and pack check.

Next three steps reassessment:

- Step 11 is ready, but should stay split into two focused groups: valid
  special response envelopes through a deterministic fixture and invalid
  service response fixtures through consumer-only service responses.
- Step 12 is ready after Step 11. It can reuse the observation pattern from
  Step 10, but should extend observations for service headers/context and
  target headers only where assertions require them.
- Step 13 is ready after Step 12. Keep Fetch metadata assertions limited to
  metadata observable through gateway/provider observations and avoid live
  endpoint dependencies.

### 11. Add Special Response And Invalid Service Response Tests - Completed

Red:

- Add failing scenarios for special response types:
  - `error`;
  - `opaque`;
  - `opaqueredirect`.
- Add consumer-only invalid service response tests.

Green:

- Use deterministic gateway or micro-provider fixture modes for valid special
  response envelopes.
- Keep invalid service response tests out of the gateway path.

Verify:

```sh
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml run --rm micro-consumer sh -lc "npm install --package-lock=false --no-audit --no-fund && npm run test:e2e -- --test-name-pattern special-response"
```

Progress:

- Added deterministic `special-error`, `special-opaque`, and
  `special-opaqueredirect` modes to the micro-gateway transport fixture.
- Added `special-response.test.mjs` in the microservice consumer.
- Verified valid `error`, `opaque`, and `opaqueredirect` envelopes through the
  real micro-gateway path and `@echospecter/proxy-fetch` reconstruction.
- Added consumer-only invalid service response fixtures for invalid JSON,
  unsupported wire version, unsupported response body kind, impossible special
  response shape, and multipart response without metadata.
- Asserted invalid service response fixtures reject with
  `InvalidServiceResponseError` and do not call the micro-gateway.
- Updated `e2e/local-registry/AGENTS.md` with the durable special/invalid
  response testing rule.
- Verified the full publish/install/provider/gateway special-response compose
  path. The publish path ran `prepublishOnly`, including lint, typecheck,
  46 Jest suites / 324 tests, and pack check.

Next three steps reassessment:

- Step 12 is ready. Keep it focused on client boundary propagation by extending
  observations for service headers/context and target headers, without adding
  new provider behavior.
- Step 13 is ready after Step 12. It should use the same install-before-test
  verify wrapper and keep assertions to metadata observable at gateway/provider
  boundaries.
- Step 14 is ready after Step 13, but should be reviewed for decomposition
  before implementation because route, fallback, pipeline, and sticky-session
  scenarios may need separate focused test files.

### 12. Add Client Boundary Tests - Completed

Red:

- Add failing scenarios for:
  - `PROXY_FETCH_SERVICE_URL` env fallback;
  - explicit `serviceUrl`;
  - service `apiKey`;
  - target `authorization`;
  - `defaultHeaders`;
  - request header override;
  - `defaultContext`;
  - request context merge.

Green:

- Extend micro-gateway observations for service headers and context.
- Extend micro-provider observations for target headers.
- Assert service API key never reaches target headers.

Verify:

```sh
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml run --rm micro-consumer sh -lc "npm install --package-lock=false --no-audit --no-fund && npm run test:e2e -- --test-name-pattern client-boundary"
```

Progress:

- Added `client-boundary.test.mjs` in the microservice consumer.
- Covered `PROXY_FETCH_SERVICE_URL` env fallback, explicit `serviceUrl`
  override, service `apiKey`, target `authorization`, `defaultHeaders`,
  request header override, and `defaultContext` / request context merge.
- Extended micro-gateway observations with opt-in service request headers,
  full provider acquire context, and target headers on transport execution.
- Used micro-provider target header observations to prove target
  `authorization` reaches the provider while service `apiKey` does not.
- Restored the tracked microservice compose file and removed an invalid stale
  smoke-script tail from the existing local-registry `base64.test.mjs` because
  both blocked the Step 12 e2e/lint verification path.
- Updated `e2e/local-registry/AGENTS.md` with the durable client-boundary
  observation rule.
- Verified the full publish/install/provider/gateway client-boundary compose
  path. The publish path ran `prepublishOnly`, including lint, typecheck,
  46 Jest suites / 324 tests, and pack check.

Next three steps reassessment:

- Step 13 is ready. It can reuse the `targetHeaders` and provider-acquire
  context observations added here, and should add only the metadata fields that
  are not already observable.
- Step 14 is too broad to implement as one large test. Before implementation,
  split it into focused route selection, pipeline requirements, provider
  ranking, and fallback scenarios while keeping one `gateway-policy` focused
  test pattern.
- Step 15 is ready after Step 14, but should keep sticky-session observations
  correlated by request id so parallel assertions do not depend on ordering.

### 13. Add Fetch Metadata Tests - Completed

Red:

- Add failing scenarios for `redirect`, `referrer`, `referrerPolicy`,
  `integrity`, `keepalive`, `duplex`, `cache`, `credentials`, and `mode`.

Green:

- Assert directly observable metadata through micro-provider when possible.
- Assert non-observable metadata through gateway transport input observations.
- Include a controlled redirect with final URL guard coverage.

Verify:

```sh
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml run --rm micro-consumer sh -lc "npm install --package-lock=false --no-audit --no-fund && npm run test:e2e -- --test-name-pattern fetch-metadata"
```

Progress:

- Added `fetch-metadata.test.mjs` in the microservice consumer.
- Extended micro-gateway transport observations and mock-provider observations
  with normalized `targetFetch` metadata.
- Covered `redirect`, `referrer`, `referrerPolicy`, `integrity`,
  `keepalive`, `duplex`, `cache`, `credentials`, and `mode` through
  `@echospecter/proxy-fetch`.
- Added a controlled `redirect-safe` scenario that records a
  `final-url-check` observation from the target transport fixture.
- Updated `e2e/local-registry/AGENTS.md` with the durable fetch metadata
  observation rule.
- Verified the full publish/install/provider/gateway fetch-metadata compose
  path. The publish path ran `prepublishOnly`, including lint, typecheck,
  46 Jest suites / 324 tests, and pack check.

Next three steps reassessment:

- Step 14 is completed below and now covers route/default-route, pipeline,
  provider ranking, and `plan.fallback` assertions.
- Step 15 is ready after Step 14. It should reuse request-id-correlated
  observations rather than asserting on parallel execution order.
- The old Step 16 scope has been split into retry/fallback/replayability and
  buffering-limit steps.

### 14. Add Declarative Route And Pipeline Tests - Completed

Red:

- Add failing route selection scenarios for:
  - default route;
  - route match by host;
  - route priority and exclude.
- Add failing pipeline requirement scenarios for:
  - pipeline `requirements.geo`;
  - pipeline-selected provider requirements.
- Add failing provider selection scenarios for:
  - provider tag filtering;
  - provider priority ranking;
  - `plan.fallback`.

Green:

- Extend micro-gateway config to use routes and pipelines in small fixtures.
- Assert gateway observations show selected route, pipeline, provider, and
  fallback attempt sequence.
- Keep focused test names under the `gateway-policy` pattern while splitting
  implementation into route, pipeline, and provider/fallback sections.

Verify:

```sh
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml up -d micro-provider micro-gateway
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml run --rm micro-consumer sh -lc "npm install --package-lock=false --no-audit --no-fund && npm run test:e2e -- --test-name-pattern gateway-policy"
```

Progress:

- Added `gateway-policy.test.mjs` in the microservice consumer with route,
  default-route, route priority, route exclude, pipeline geo/tag/priority, and
  `plan.fallback` assertions.
- Extended the micro-gateway e2e config to use `defaultRoute`, `routes`,
  `pipelines`, multiple provider instances, provider capabilities, provider
  tags, provider priority, and deterministic fallback failure.
- Added e2e-only gateway observations for selected provider, selected route,
  selected pipeline, requirements, route provider, and fallback attempt order.
- Added a deterministic mock-provider response mode for the fallback success
  leg.
- Verified the focused `gateway-policy` compose path after starting
  `micro-provider` and `micro-gateway`.

Next three steps reassessment:

- Step 15 is completed below and added request-id correlation before asserting
  isolation under parallel requests.
- Step 16 has been narrowed to retry/fallback/replayability because basic
  provider `plan.fallback` is now covered by Step 14.
- Step 17 has been split out as buffering-limit coverage so request/response
  byte limits do not get mixed with retry policy behavior.

### 15. Add Sticky Session And Isolation Tests - Completed

Red:

- Add a parallel request batch with mixed targets, tenants, flow keys, and
  sticky-session requirements.
- Add a failing assertion that gateway/provider observations can be correlated
  by request id or explicit e2e correlation metadata.

Green:

- Configure `createMemoryProxySessionStore()` in micro-gateway.
- Add repeated request scenarios proving sticky reuse.
- Correlate observations by request id.
- Avoid shared mutable test assertions that depend on execution order.
- In this installed `@echospecter/proxy-fetch` microservice path, assert
  isolation through serialized `flowKey` and target host. `tenantId` and
  `routeKey` are gateway context concepts, but they are not carried through
  the current proxy-fetch client boundary in this e2e lab.

Verify:

```sh
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml up -d micro-provider micro-gateway
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml run --rm micro-consumer sh -lc "npm install --package-lock=false --no-audit --no-fund && npm run test:e2e -- --test-name-pattern sticky-session"
```

Progress:

- Added `sticky-session.test.mjs` in the microservice consumer.
- Configured the micro-gateway with `createMemoryProxySessionStore()`.
- Added sticky write/read pipelines: `/write` stores `sticky-provider-a`, and
  `/read` would prefer higher-priority `sticky-provider-b` unless the session
  store pins the request back to `sticky-provider-a`.
- Added gateway and mock-provider `requestId` observations so parallel
  requests can be correlated without relying on event order.
- Covered repeated sticky reuse and a parallel isolation batch across
  serialized `flowKey` and target host.
- Verified the focused `sticky-session` compose path after starting
  `micro-provider` and `micro-gateway`.

Next three steps reassessment:

- Step 16 is completed below and reuses the Step 14 fallback providers plus
  the Step 15 request-id correlation.
- Step 17 remains separate and should configure narrow e2e-only buffering
  limits instead of mixing byte-limit behavior into retry/fallback assertions.
- Step 18 should reuse the request-id observations from Step 15 to prove aborts
  stop later provider or fallback work.

### 16. Add Retry, Fallback, And Replayability Tests - Completed

Red:

- Add failing scenarios for:
  - replayable body fallback after primary provider failure;
  - non-replayable body retry prevention;
  - unsafe method retry prevention unless policy explicitly allows it;
  - fallback attempt sequence with body preservation.

Green:

- Reuse the Step 14 secondary mock provider instances.
- Add deterministic provider failure modes that fail before target execution
  for the first attempt and succeed on the second attempt.
- Assert gateway release outcomes and provider observations for replayable and
  non-replayable bodies.
- Use JSON base64 service transport for the large non-replayable body case so
  the proxy-fetch multipart parser does not reject the service request before
  gateway planning can mark the target body as `non-replayable`.

Verify:

```sh
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml up -d micro-provider micro-gateway
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml run --rm micro-consumer sh -lc "npm install --package-lock=false --no-audit --no-fund && npm run test:e2e -- --test-name-pattern retry-fallback"
```

Progress:

- Added `retry-fallback.test.mjs` in the microservice consumer.
- Added retry/fallback pipelines in the micro-gateway for replayable fallback,
  non-replayable retry prevention, and unsafe POST retry prevention.
- Reused `fallback-primary-provider` and `fallback-secondary-provider` from
  Step 14, with deterministic primary transport failure before target/provider
  execution.
- Verified replayable body preservation across fallback by asserting the
  secondary provider receives the original target body.
- Verified large JSON-base64 binary bodies exceed the e2e request buffering
  threshold, become `non-replayable`, and stop before the secondary attempt.
- Verified unsafe POST stops after the primary attempt without explicit unsafe
  retry allowance.
- Verified the focused `retry-fallback` compose path after starting
  `micro-provider` and `micro-gateway`.

Next three steps reassessment:

- Step 17 should distinguish service-envelope parser limits from target body
  buffering limits. Multipart over-limit requests can fail before planning,
  while JSON-base64 bodies can reach planning and be marked non-replayable.
- Step 18 can reuse the Step 15 request-id observations and Step 16 fallback
  providers to assert aborts/timeouts stop later attempts.
- Step 19 remains ready, but redaction assertions should inspect gateway
  observations added in Steps 14-16 for request ids, providers, and target
  headers.

### 17. Add Buffering Limit Tests - Completed

Red:

- Add failing scenarios for:
  - multipart service-envelope parser limit before gateway planning;
  - JSON-base64 target body buffering limit before provider execution;
  - response buffering limit while building the service response;
  - retry disabled when the request body cannot be replayed safely after
    buffering decisions.

Green:

- Configure small e2e-only buffering limits in a narrow gateway fixture path.
- Add deterministic request and response body modes that exceed those limits.
- Assert multipart over-limit requests fail before provider acquisition and
  before transport execution.
- Assert JSON-base64 over-limit target bodies reach planning and become
  `non-replayable` or stable buffering-limit service errors according to the
  configured policy.
- Assert stable service errors and provider observation counts.

Verify:

```sh
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml up -d micro-provider micro-gateway
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml run --rm micro-consumer sh -lc "npm install --package-lock=false --no-audit --no-fund && npm run test:e2e -- --test-name-pattern buffering-limit"
```

Progress:

- Added `buffering-limit.test.mjs` in the microservice consumer.
- Configured e2e-only gateway buffering limits so request streams above 4096
  bytes become non-replayable and response streams above 25 MiB fail while
  building the service response.
- Verified oversized multipart service requests fail before provider
  acquisition, transport execution, and mock-provider execution.
- Verified oversized JSON-base64 target bodies reach planning, are observed as
  `non-replayable`, and stop fallback after the primary attempt fails.
- Verified oversized gateway-generated target responses produce stable service
  errors and do not call the mock-provider.
- Updated `e2e/local-registry/AGENTS.md` with the response buffering-limit
  fixture rule.
- Verified the focused `buffering-limit` compose path after starting
  `micro-provider` and `micro-gateway`.

Next three steps reassessment:

- Step 18 should reuse the Step 17 gateway-generated stream pattern for total
  timeout and attempt timeout where the boundary is inside the gateway, and the
  mock-provider slow mode only where the boundary is provider passthrough.
- Step 19 remains ready, but redaction assertions should include buffering and
  fallback service-error details now that those paths emit deterministic
  provider acquire/release observations.
- Step 20 remains ready and should stay separate from buffering-limit coverage:
  live endpoint assertions should not depend on large bodies, large streams, or
  retry/fallback policy behavior.

### 18. Add Timeout And Abort Tests - Completed

Red:

- Add failing scenarios for:
  - local proxy-fetch timeout;
  - serialized `timeoutMs`;
  - caller `AbortSignal`;
  - gateway attempt timeout.

Green:

- Add deterministic slow modes in micro-gateway and micro-provider.
- Assert the expected side of the boundary cancels.
- Assert fallback does not start after caller abort or total timeout.

Verify:

```sh
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml up -d micro-provider micro-gateway
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml run --rm micro-consumer sh -lc "npm install --package-lock=false --no-audit --no-fund && npm run test:e2e -- --test-name-pattern timeout-abort"
```

Progress:

- Added `timeout-abort.test.mjs` in the microservice consumer.
- Verified local `proxy-fetch` timeout cancels a streaming upload before
  gateway planning, leaving gateway and mock-provider observations empty.
- Verified caller `AbortSignal` cancels a streaming upload before gateway
  planning, leaving gateway and mock-provider observations empty.
- Verified serialized gateway `timeoutMs` stops a primary attempt without
  fallback; through `@echospecter/proxy-fetch` this currently surfaces as
  `SERVICE_HTTP_ERROR` with service HTTP status `504`.
- Added deterministic timeout-abort gateway pipeline fixtures and
  gateway-generated delayed target responses.
- Fixed `AttemptExecutor` so a planned attempt's `timeoutMs` overrides the
  gateway default attempt timeout for that attempt.
- Added a focused unit regression for planned attempt timeout precedence.
- Verified per-attempt timeout can fallback when retry policy allows it.
- Updated `src/app/use-cases/AGENTS.md` and `e2e/local-registry/AGENTS.md`
  with durable timeout rules introduced by this step.
- Reset and republished the package to local Verdaccio before the focused e2e
  run so micro-gateway installed the updated tarball.
- Verified the focused `timeout-abort` compose path after starting
  `micro-provider` and `micro-gateway`.

Next three steps reassessment:

- Step 19 should assert service error redaction across both envelope-level
  service errors and service HTTP errors, since Step 18 confirmed gateway
  timeout reaches `@echospecter/proxy-fetch` as HTTP 504 `SERVICE_HTTP_ERROR`.
- Step 20 remains ready, but live endpoint tests should avoid relying on
  timeout/error code mapping; keep them focused on successful real passthrough
  and explicitly documented flake-tolerant upstream handling.
- Step 21 should document that microservice e2e runs requiring unpublished core
  changes must reset Verdaccio and republish `@echospecter/proxy-gateway`
  before starting `micro-gateway`.

### 19. Add Error Boundary, Target Access, And Redaction Tests - Completed

Red:

- Add failing scenarios for:
  - target access denied;
  - no route matched;
  - provider/network failure;
  - secrets in target headers, cookies, query string, provider metadata, and
    service API key.

Green:

- Configure denied target cases.
- Add deterministic provider failure modes.
- Assert redacted service error details.
- Assert provider is not called when target access rejects.

Verify:

```sh
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml up -d micro-provider micro-gateway
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml run --rm micro-consumer sh -lc "npm install --package-lock=false --no-audit --no-fund && npm run test:e2e -- --test-name-pattern error-redaction"
```

Progress:

- Added `error-redaction.test.mjs` in the microservice consumer.
- Added a dedicated no-default-route gateway handler at `/fetch-no-route` for
  the `NO_ROUTE_MATCHED` e2e scenario without changing the normal `/fetch`
  default-route behavior.
- Added deterministic `error-redaction-transport-failure` gateway mode with a
  credentialed proxy route so service error diagnostics include route and target
  redaction surfaces.
- Verified target access denial returns before provider acquisition, transport
  execution, and mock-provider execution.
- Verified no-route failure returns before provider acquisition, transport
  execution, and mock-provider execution.
- Verified transport failure diagnostics redact target authorization, cookies,
  API keys, sensitive query parameters, route credentials, and service API key
  material.
- Captured raw service error envelope bodies through a cloned `fetchImpl`
  response because `@echospecter/proxy-fetch` surfaces service HTTP 4xx/5xx as
  `SERVICE_HTTP_ERROR`.
- Updated `e2e/local-registry/AGENTS.md` with the raw service-error capture
  rule and the URL userinfo caveat.
- Verified the focused `error-redaction` compose path after starting
  `micro-provider` and `micro-gateway`.

Next three steps reassessment:

- Step 20 should avoid service error assertions except for flake-tolerant live
  upstream handling; deterministic error boundary and redaction coverage now
  lives in Step 19.
- Step 21 should document both focused e2e patterns introduced by Steps 18-19:
  republish to local Verdaccio when package internals change, and use a cloned
  `fetchImpl` response when raw service error envelopes must be inspected.
- The release gate section remains valid, but the final e2e documentation should
  make clear that service HTTP errors are observed by consumers as
  `SERVICE_HTTP_ERROR` while raw envelopes are available only through capture or
  lower-level service calls.

### 20. Add Live Public Endpoint Tests - Completed

Red:

- Add failing `live-endpoints.test.mjs` scenarios using the copied endpoint
  fixture.

Green:

- Implement real outbound fetch passthrough in micro-provider.
- Add flake-tolerant handling for temporary upstream statuses.
- Keep deterministic format tests separate from live endpoint assertions.

Verify:

```sh
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml up -d micro-provider micro-gateway
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml run --rm micro-consumer sh -lc "npm install --package-lock=false --no-audit --no-fund && npm run test:e2e -- --test-name-pattern live-endpoints"
```

Progress:

- Added `live-endpoints.test.mjs` in the microservice consumer, based on the
  live endpoint categories from `@echospecter/proxy-fetch`.
- Added mock-provider `live-public` mode that performs real outbound `fetch`
  calls to target public APIs and returns their status, headers, and body through
  the gateway path.
- Added gateway support for reading the deterministic fixture mode from
  `x-micro-mode`, so live target URLs do not need test-only query parameters.
- Filtered `x-micro-mode`, `host`, and `content-length` before upstream live
  fetches, and filtered hop-by-hop/decoded-body response headers before the
  provider returns live responses to the gateway.
- Covered JSONPlaceholder, Open-Meteo, GitHub README JSON/base64, httpbin
  base64/text, httpbin JSON lines, httpbin binary bytes, httpbin multipart POST,
  httpbin gzip, Picsum image redirect, and World Bank XML/JSON.
- Added flake-tolerant strict assertion skips for temporary upstream statuses
  `429`, `502`, `503`, and `504` while still asserting the gateway and provider
  path was exercised.
- Updated `e2e/local-registry/AGENTS.md` with the live-public mode and temporary
  upstream status rule.
- Verified the focused `live-endpoints` compose path after starting
  `micro-provider` and `micro-gateway`; the run passed with temporary strict
  skips for currently unavailable httpbin endpoints.

Next three steps reassessment:

- Step 21 should add the one-command runner around the full microservice suite,
  including live endpoint tests, with cleanup traps so temporary upstream
  failures do not leave containers running.
- Step 21 documentation should explicitly call out that live endpoint tests are
  not the deterministic compatibility source of truth and may skip strict
  assertions for temporary upstream statuses.
- The release gate section remains valid, but the one-command runner should be
  kept outside default `npm test` because Step 20 introduced real public network
  dependency.

### 21. Add One-Command Runner And Documentation

Red:

- Running one command leaves containers or volumes behind on failure.

Green:

- Add `run-microservices-e2e.sh` with cleanup trap.
- Add root `package.json` script `test:e2e:microservices` delegating to the
  runner.
- Document it in `e2e/local-registry/README.md`.
- Update `e2e/local-registry/AGENTS.md` and `tests/AGENTS.md` only for durable
  testing rules introduced by this lab.

Verify:

```sh
npm run test:e2e:microservices
git status --short
```

## Release Gate Integration

Do not add this large live microservice lab to the default `npm test` command.

Recommended gates:

```sh
npm run lint
npm run typecheck
npm test
npm run pack:check
npm run test:e2e:microservices
```

Keep the current fast local-registry consumer test suite as the
package-consumption release gate. Treat the new microservice lab as a heavier
compatibility gate,
especially before public releases or changes to wire formats, gateway
transport/route contracts, or proxy-fetch serialization.

## Flake Handling

Live public endpoints may fail for reasons unrelated to the packages.

Rules:

- Temporary upstream statuses `429`, `502`, `503`, and `504` may skip strict
  content assertions.
- Even when strict assertions are skipped, the test must still assert that the
  request passed through gateway and micro-provider observations.
- Deterministic wire format behavior should be tested against micro-provider
  controlled responses, not only public endpoints.
- Avoid adding endpoints that require auth, API keys, cookies, or user-specific
  state.

## Documentation Updates After Implementation

Update:

```txt
e2e/local-registry/README.md
e2e/local-registry/AGENTS.md
tests/AGENTS.md
```

Only update nested `AGENTS.md` files when implementation introduces durable
rules, such as:

- only `@echospecter/proxy-gateway` must be locally published to Verdaccio for
  this lab;
- consumer should install `@echospecter/proxy-fetch` from npmjs, directly or
  through Verdaccio's npmjs uplink;
- gateway must install `@echospecter/proxy-gateway` from local Verdaccio;
- live endpoint strict assertions must be flake-tolerant;
- deterministic body format assertions must not rely only on public endpoints.

## Open Decisions

1. Whether to pin an exact npm version of `@echospecter/proxy-fetch` or use a
   semver range such as `^0.1.0`.
2. Whether the gateway e2e transport should model the mock provider as a custom
   transport route or a forward-proxy-like route.
3. Whether to run the lab on Node 20 only, or add an optional Node 26 consumer
   variant for the proxy-fetch Node 26 compatibility scenarios.
4. Whether to copy the proxy-fetch live endpoint list into gateway e2e shared
   fixtures or generate it from the proxy-fetch repository during the script.
5. Whether live endpoint logs should be printed by default or only on failure.
