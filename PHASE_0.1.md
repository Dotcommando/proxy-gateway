# v0.1 Implementation Plan

Source: `README.md`, section `Status`, plus the v0.1 package scope described throughout the README.

This plan breaks v0.1 into small, behavior-driven TDD slices. Each slice starts with a failing test, then the smallest implementation that makes it pass, then refactoring with the same tests green.

## Source Layout

Keep the source tree aligned with the hexagonal architecture rules in `AGENTS.md`:

- `src/ports/inbound`
- `src/ports/outbound`
- `src/adapters/inbound`
- `src/adapters/outbound`
- `src/app`
- `src/app/buffering`
- `src/app/envelopes`
- `src/app/normalization`
- `src/app/types`
- `src/app/use-cases`
- `src/domain`

Use-cases belong in `src/app/use-cases`. `src/domain` is for provider-agnostic models, value objects, classification types, route models, matching primitives, and pure rules.

## Completion Criteria

- `npm run typecheck` passes.
- `npm test` passes.
- `npm run build` passes.
- `npm run pack:check` passes.
- The package root exports the documented v0.1 API.
- The test suite covers the user-visible v0.1 behaviors described in `README.md`.
- The service wire contract matches `@echospecter/proxy-fetch` exactly for v0.1 request/response envelope shapes.

## 1. Test Harness and Package Entrypoint - Done

Red:
- Add `tests/public-api.test.ts`.
- Import `createProxyGateway` from the package root.
- Create a gateway with a test direct provider and injected test transport.
- Send a valid JSON `proxy-fetch.v1` request through `gateway.handle(request)`.
- Assert that the result is a `Response` with a valid service envelope.

Green:
- Add `src/index.ts`.
- Export `createProxyGateway` and the minimum public contracts needed by the test.
- Add a minimal `HandleProxyFetchRequestUseCase` behind `createProxyGateway()` that returns controlled service errors for uncovered paths.

Verify:
- `npm test -- --runTestsByPath tests/public-api.test.ts`
- `npm run typecheck`

## 2. JSON Request Parser and Response Builder - Done

Red:
- Add parser tests for JSON request envelopes with `body: null`, text body, base64 body, target URL, method, headers, context, and Fetch metadata.
- Add invalid-envelope tests for unsupported version, missing target URL, unknown body kind, and invalid base64.
- Add builder tests for text, null, base64, and service-error responses.

Green:
- Implement `ProxyFetchEnvelopeParser` for `application/json`.
- Implement `ProxyFetchEnvelopeBuilder` for JSON service responses.
- Preserve target HTTP statuses as target responses, not service errors.

Verify:
- JSON parser/builder tests pass.

## 3. Target Request Normalization - Done

Red:
- Add tests for converting parsed envelopes into `GatewayTargetRequest`.
- Cover replayable none, replayable text, replayable bytes, header preservation, and Fetch metadata preservation.
- Add a test that stale body-related headers are not carried forward after body transformation.

Green:
- Implement `GatewayRequestNormalizer`.
- Add the internal body model used by providers and transports.
- Normalize methods, headers, URL, context, body, and Fetch metadata.

Verify:
- Normalizer tests pass.

## 4. Request and Response Body Buffer Limits - Done

Red:
- Add tests for request bytes/streams inside and above the configured limit.
- Add tests for reject-on-overflow and continue-as-non-replayable overflow modes.
- Add response buffering tests for the configured response byte limit.

Green:
- Implement `BodyBufferManager`.
- Apply buffering decisions during request normalization and response building.
- Surface replayability decisions to retry logic.

Verify:
- Body-buffering tests pass.

## 5. Proxy-Fetch JSON Wire Contract Parity - Done

This step closes the JSON-envelope compatibility gap between the early gateway-local test shape and the actual `@echospecter/proxy-fetch` wire contract. Multipart parsing and multipart response building stay in step 18.

Implemented:
- `src/constants.ts` contains the wire compatibility constants copied from `@echospecter/proxy-fetch` plus serializer constants needed for streaming multipart compatibility.
- `tests/proxy-fetch-wire-compatibility.test.ts` locks exact constant values and the client-body-to-wire-format compatibility matrix.
- `GatewayExecutionContext` includes `consistency`, and the current JSON parser preserves `context.consistency` when present.
- JSON request parsing uses top-level `request`, reads `options.timeoutMs`, reads Fetch metadata directly from `request`, reads base64 bodies from `request.body.data`, and rejects multipart binary body references on JSON transport.
- JSON response building emits `response.url`, `response.redirected`, `response.type`, `status`, `statusText`, `headers`, and `body`; uses base64 `body.data`; preserves null-body status semantics; and rejects invalid special response combinations.

Red:
- Add tests that JSON request envelopes use top-level `request`, not `target`.
- Add tests for `request.body: null`, `request.body.kind: "text"`, and `request.body.kind: "base64"` with field `data`.
- Add tests that `request.body.kind: "binary"` is rejected on JSON transport because it belongs to multipart service transport.
- Add tests that `options.timeoutMs` is parsed and exposed to the gateway execution flow.
- Add tests that service context preserves `useCase`, `flowKey`, `consistency`, and `metadata`.
- Add tests that Fetch metadata fields are read from `request` directly and only when present in the envelope: `mode`, `credentials`, `cache`, `redirect`, `referrer`, `referrerPolicy`, `integrity`, `keepalive`, `duplex`.
- Add response builder tests for `response.url`, `response.redirected`, `response.type`, `status`, `statusText`, `headers`, and body.
- Add response builder tests for JSON base64 response body using `data`, not `base64`.
- Add null-body status tests for `204`, `205`, and `304`.
- Add special response shape tests for `type: "error"`, `type: "opaque"`, and `type: "opaqueredirect"`.
- Add service error tests for `error.code`, `error.message`, optional `error.retryable`, and optional `error.details`.

Green:
- Keep `src/constants.ts` synchronized with the compatibility constants from `@echospecter/proxy-fetch`.
- Update JSON parser/builder and normalizer adapters to consume the actual `proxy-fetch.v1` wire shape.
- Treat client-side Fetch body types as compatibility fixtures, not separate gateway-domain body kinds.
- Keep internal `GatewayTargetRequest` provider-agnostic; map `request` wire data into the internal target model.
- Preserve `WIRE_PROTOCOL_VERSION` as the shared version constant name.
- Reject impossible or internally inconsistent service response shapes before returning them.

Verify:
- JSON wire contract parity tests pass against the documented `@echospecter/proxy-fetch` shapes.

## 6. Provider Adapter Port and Direct Route Execution Hardening - Done

Implemented:
- Added focused hardening tests for post-lease transport failure, best-effort release, missing provider, missing transport, generated request id, and buffered normalized target forwarding.
- Added stable `TARGET_TRANSPORT_ERROR` service code for post-lease target transport failures.
- Ensured provider `release()` is called with a failed `ProxyAttemptResult` when transport execution fails after a lease is acquired.
- Ensured provider `release()` remains best-effort and does not mask successful target responses.

Red:
- Add focused tests for behavior not fully covered by earlier vertical slices:
  - provider `release()` is called when transport execution fails after a lease is acquired;
  - provider `release()` receives the classified failed attempt result;
  - missing enabled provider returns a stable service error code;
  - missing transport returns a stable service error code;
  - direct route execution receives the buffered/normalized target and generated request id.

Green:
- Keep provider, lease, route, attempt result, `RandomPort`, and transport contracts in outbound ports.
- Extract direct attempt execution out of `HandleProxyFetchRequestUseCase` if the use-case starts owning too much orchestration.
- Ensure release is best-effort but attempted for success and post-lease failure paths.

Verify:
- Direct route hardening tests pass.

## 7. Multiple Provider Instances - Done

Implemented:
- Added `providerSelection.providerInstanceId` as a temporary direct-route selection hook until the planner/pipeline steps own provider selection.
- Added tests for selecting one instance among multiple instances with the same adapter kind.
- Added tests proving disabled provider instances are skipped.
- Added stable `PROVIDER_INSTANCE_NOT_FOUND` service error for an explicit provider instance id that is unknown or disabled.
- Added selected-provider capability snapshot before acquisition.

Red:
- Add tests for multiple provider instances, including multiple instances with the same adapter kind.
- Add a test that disabled instances are not selected.
- Add a test that a plan referencing an unknown provider fails with a stable service error code.

Green:
- Implement provider instance lookup.
- Use provider instance id as the routing identity.
- Capture provider capability snapshots for planning.

Verify:
- Multiple-provider tests pass.

## 8. Matchers

Red:
- Add matcher tests for exact host, suffix host, glob path, declarative regexp, programmatic `RegExp`, hostname case normalization, trailing-dot normalization, and `.onion` detection.

Green:
- Implement URL and host normalization.
- Implement exact, suffix, glob, and regexp matching.
- Validate declarative regexp inputs.
- Represent closed matcher kinds with enums, not inline string-literal unions.

Verify:
- Matcher tests pass.

## 9. Route Priority and Exclude

Red:
- Add tests for priority ordering.
- Add tests for stable ordering when priorities are equal.
- Add tests showing `exclude` is evaluated after a positive match.
- Add a no-match test that returns `NO_ROUTE_MATCHED`.
- Add tests that route-selection result kinds and stable error codes use package enums.

Green:
- Implement deterministic route/pipeline selection.
- Add default-route behavior only where explicitly configured.

Verify:
- Route selection tests pass.

## 10. Policy Pipeline Engine

Red:
- Add tests proving phase order.
- Add tests for state patches flowing into later steps.
- Add tests for `reject`, `use-plan`, and `skip-pipeline` decisions.
- Add a test for unknown step type handling.
- Add tests that pipeline phase and decision kinds use enums, not inline string-literal unions.

Green:
- Implement `ProxyPipelineEngine`.
- Implement `ProxyPipelineStepRegistry`.
- Implement controlled state patch merging.

Verify:
- Pipeline tests pass.

## 11. Execution Planner and Requirements

Red:
- Add tests that `plan.fallback` produces ordered attempts.
- Add tests for provider capability mismatch before `acquire()`.
- Add tests for protocol, network type, and DNS requirement checks.
- Add a test proving `socks5h` plus proxy DNS requirements are not downgraded.
- Add tests that explicit provider references use provider instance ids and unknown ids return the stable `PROVIDER_INSTANCE_NOT_FOUND` service code.
- Add tests that planner-owned provider selection replaces the temporary `providerSelection.providerInstanceId` direct-route hook from step 7.

Green:
- Implement `ExecutionPlanner`.
- Add the initial built-in `plan.fallback` step.
- Reject impossible plans before execution.
- Move provider capability snapshots into planner-owned selection so the use-case does not duplicate planning concerns.

Verify:
- Planner tests pass.

## 12. Forward Proxy and SOCKS5H Route Model

Red:
- Add tests that providers can return `forward-proxy` routes for supported protocols.
- Add a test that a `socks5h` route preserves proxy DNS mode.
- Add a test that unsupported route types are classified as `UNSUPPORTED_ROUTE`.
- Add a test that route auth does not leak into diagnostics.

Green:
- Add forward-proxy route contracts.
- Pass routes to the transport without provider-specific translation.
- Classify unsupported transport routes clearly.

Verify:
- Route model tests pass.

## 13. Retry Safety

Red:
- Add a test that target HTTP `500` is returned without retry by default.
- Add a test that HTTP status retry happens only when explicitly configured.
- Add tests for retryable network/proxy failures when policy allows them.
- Add tests that unsafe methods do not retry by default.
- Add tests that non-replayable bodies prevent retry.

Green:
- Implement `RetryDecider`.
- Add default retry safety behavior.
- Connect retry decisions to attempt outcomes and body replayability.
- Represent retry conditions and retry decisions with enums where they cross module boundaries.

Verify:
- Retry tests pass.

## 14. Result Classification

Red:
- Add classification tests for target HTTP status, target network error, target timeout, proxy auth error, proxy connection error, proxy timeout, gateway timeout, caller abort, policy rejection, and unsupported route.
- Add tests that replace the step 6 provisional `TARGET_TRANSPORT_ERROR` / `PROXY_ATTEMPT_RESULT_OUTCOME.GATEWAY_ERROR` handling with the final result taxonomy where possible, without regressing best-effort `release()` behavior.

Green:
- Implement `ResultClassifier`.
- Add stable service error codes and statuses.
- Map classified attempt results into response envelopes.
- Keep `ProxyAttemptResult.outcome` backed by enum values.

Verify:
- Classifier tests pass.

## 15. Total Timeout, Attempt Timeout, and Abort

Red:
- Add a test that total timeout cancels the active attempt and prevents fallback.
- Add a test that per-attempt timeout can move to the next attempt when policy allows it.
- Add a test that caller abort cancels acquire/transport and prevents future attempts.
- Add a test for success-vs-timeout race settling once.
- Add a test that lease release runs after timeout or abort when a lease exists.

Green:
- Implement `TimeoutController`.
- Wire total and attempt `AbortSignal`s through provider acquisition and target transport.
- Clean up timers and abort listeners.

Verify:
- Timeout and abort tests pass.

## 16. Target Access Guard

Red:
- Add default-deny tests for unsupported schemes, localhost, loopback IPs, private IP ranges, link-local addresses, and redirect-to-denied-target cases.
- Add explicit-allow tests for policies that intentionally permit local/private targets.

Green:
- Implement `TargetAccessGuard`.
- Apply it before execution.
- Apply it to redirect targets when redirect information is available.

Verify:
- Access guard tests pass.

## 17. Redaction

Red:
- Add tests for redacting sensitive headers, sensitive query parameters, and route credentials.
- Add tests that service errors, logs, telemetry events, and diagnostics use redacted values.

Green:
- Implement `RedactionService`.
- Apply it at service-error, event, and diagnostic boundaries.

Verify:
- Redaction tests pass.

## 18. Multipart Request Parser and Response Builder

Red:
- Add multipart request tests for `meta` JSON part, raw binary `body` part, missing required parts, byte-preserving binary round trip, and body-size enforcement.
- Add multipart response builder tests for meta/body output.
- Add parser/integration fixtures for binary client-side body shapes serialized by `@echospecter/proxy-fetch`: `Blob`, `ArrayBuffer`, typed arrays, `FormData`, `ReadableStream` with `duplex: "half"`, existing `Request` objects with binary bodies, and unknown non-text bodies.
- Add tests proving default binary behavior uses multipart, and JSON base64 is used only when `binaryBodyTransport` is `json-base64`.
- Add tests that multipart `meta` uses `request.body.kind: "binary"` and `request.body.partName: "body"`.
- Add multipart streaming tests for the exact streaming shape: `multipart/form-data` content type, `proxy-fetch-stream-*` boundary prefix, `meta` JSON part first, `body` binary part second, and `application/octet-stream` body part content type.
- Add tests that multipart parsing does not require buffering the entire incoming service request before body-limit policy is applied.
- Reuse the exact `request.body.kind: "binary"` / `response.body.kind: "binary"` meta shape from the `@echospecter/proxy-fetch` wire contract.

Green:
- Implement multipart parsing for the service contract.
- Implement multipart response building.
- Reuse body buffering decisions for multipart binary content.

Verify:
- Multipart tests pass.

## 19. Full Direct-Route Gateway Flow

Red:
- Add integration tests that cover parse, normalize, match, plan, acquire, execute, classify, and build response.
- Cover text, binary/base64, null-body statuses, and target HTTP error statuses.

Green:
- Wire parser, normalizer, access guard, pipeline/planner, attempt executor, retry decider, classifier, and builder through `HandleProxyFetchRequestUseCase` and extracted app collaborators.
- Remove temporary `NOT_IMPLEMENTED` paths for covered v0.1 behavior.
- Remove or narrow the temporary `providerSelection.providerInstanceId` hook once planner-owned direct-route defaults cover the same behavior.

Verify:
- Direct-route integration tests pass.

## 20. Thin Wrapper Contract Suite

Red:
- Add a shared adapter contract suite.
- Test that an adapter preserves raw JSON body, multipart bytes, response status, response headers, and response body.
- Add a Node HTTP server factory for the contract suite.
- Add framework-shaped mock factories for Express, Fastify, and NestJS wrappers if real frameworks are not dev dependencies.

Green:
- Implement `createNodeHttpHandler(gateway)`.
- Implement dependency-free structural wrappers only where they can be shipped without importing framework packages.
- Keep the contract suite reusable for future separate framework adapter packages.

Verify:
- Wrapper contract tests pass.

## 21. Public Exports and Packaging Checks

Red:
- Add public export tests for documented v0.1 contracts.
- Add CJS and ESM smoke tests after build.
- Add a packaging check that fails if package runtime dependencies are introduced.

Green:
- Finalize `src/index.ts` exports.
- Add or fix build/test configuration required by the current package scripts.
- Ensure package contents include the built API and README.

Verify:
- `npm run build`
- `npm run typecheck`
- `npm test`
- `npm run pack:check`

## Suggested PR Order

1. Test harness, package entrypoint, and JSON envelope support.
2. Target normalization and body buffering.
3. Provider/transport ports and direct execution.
4. Matchers, route selection, and pipeline engine.
5. Planner, retry/fallback, and classification.
6. Timeout, abort, and target access guard.
7. Redaction and multipart support.
8. Full direct-route E2E and wrapper contract suite.
9. Public exports and packaging checks.
