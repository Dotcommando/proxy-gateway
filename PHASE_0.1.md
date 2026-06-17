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

## 1. Test Harness and Package Entrypoint

Red:
- Add `tests/public-api.test.ts`.
- Import `createProxyGateway` from the package root.
- Create a gateway with a test direct provider and injected test transport.
- Send a valid JSON `proxy-fetch.v1` request through `gateway.handle(request)`.
- Assert that the result is a `Response` with a valid service envelope.

Green:
- Add `src/index.ts`.
- Export `createProxyGateway` and the minimum public contracts needed by the test.
- Add a minimal `ProxyGatewayService` that returns controlled service errors for uncovered paths.

Verify:
- `npm test -- --runTestsByPath tests/public-api.test.ts`
- `npm run typecheck`

## 2. JSON Request Parser and Response Builder

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

## 3. Target Request Normalization

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

## 4. Request and Response Body Buffer Limits

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

## 5. Provider Adapter Port and Direct Route Execution

Red:
- Add a mock provider adapter that returns a direct lease.
- Add a mock `TargetTransportPort`.
- Assert that `handle()` calls `acquire()`, executes the target through the transport, and calls `release()` after success.
- Assert that `release()` is still called when transport execution fails after a lease is acquired.

Green:
- Add provider, lease, route, attempt, result, and transport contracts.
- Implement the first vertical path through `AttemptExecutor` for direct routes.

Verify:
- Direct route execution tests pass.

## 6. Multiple Provider Instances

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

## 7. Matchers

Red:
- Add matcher tests for exact host, suffix host, glob path, declarative regexp, programmatic `RegExp`, hostname case normalization, trailing-dot normalization, and `.onion` detection.

Green:
- Implement URL and host normalization.
- Implement exact, suffix, glob, and regexp matching.
- Validate declarative regexp inputs.

Verify:
- Matcher tests pass.

## 8. Route Priority and Exclude

Red:
- Add tests for priority ordering.
- Add tests for stable ordering when priorities are equal.
- Add tests showing `exclude` is evaluated after a positive match.
- Add a no-match test that returns `NO_ROUTE_MATCHED`.

Green:
- Implement deterministic route/pipeline selection.
- Add default-route behavior only where explicitly configured.

Verify:
- Route selection tests pass.

## 9. Policy Pipeline Engine

Red:
- Add tests proving phase order.
- Add tests for state patches flowing into later steps.
- Add tests for `reject`, `use-plan`, and `skip-pipeline` decisions.
- Add a test for unknown step type handling.

Green:
- Implement `ProxyPipelineEngine`.
- Implement `ProxyPipelineStepRegistry`.
- Implement controlled state patch merging.

Verify:
- Pipeline tests pass.

## 10. Execution Planner and Requirements

Red:
- Add tests that `plan.fallback` produces ordered attempts.
- Add tests for provider capability mismatch before `acquire()`.
- Add tests for protocol, network type, and DNS requirement checks.
- Add a test proving `socks5h` plus proxy DNS requirements are not downgraded.

Green:
- Implement `ExecutionPlanner`.
- Add the initial built-in `plan.fallback` step.
- Reject impossible plans before execution.

Verify:
- Planner tests pass.

## 11. Forward Proxy and SOCKS5H Route Model

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

## 12. Retry Safety

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

Verify:
- Retry tests pass.

## 13. Result Classification

Red:
- Add classification tests for target HTTP status, target network error, target timeout, proxy auth error, proxy connection error, proxy timeout, gateway timeout, caller abort, policy rejection, and unsupported route.

Green:
- Implement `ResultClassifier`.
- Add stable service error codes and statuses.
- Map classified attempt results into response envelopes.

Verify:
- Classifier tests pass.

## 14. Total Timeout, Attempt Timeout, and Abort

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

## 15. Target Access Guard

Red:
- Add default-deny tests for unsupported schemes, localhost, loopback IPs, private IP ranges, link-local addresses, and redirect-to-denied-target cases.
- Add explicit-allow tests for policies that intentionally permit local/private targets.

Green:
- Implement `TargetAccessGuard`.
- Apply it before execution.
- Apply it to redirect targets when redirect information is available.

Verify:
- Access guard tests pass.

## 16. Redaction

Red:
- Add tests for redacting sensitive headers, sensitive query parameters, and route credentials.
- Add tests that service errors, logs, telemetry events, and diagnostics use redacted values.

Green:
- Implement `RedactionService`.
- Apply it at service-error, event, and diagnostic boundaries.

Verify:
- Redaction tests pass.

## 17. Multipart Request Parser and Response Builder

Red:
- Add multipart request tests for `meta` JSON part, raw binary `body` part, missing required parts, byte-preserving binary round trip, and body-size enforcement.
- Add multipart response builder tests for meta/body output.

Green:
- Implement multipart parsing for the service contract.
- Implement multipart response building.
- Reuse body buffering decisions for multipart binary content.

Verify:
- Multipart tests pass.

## 18. Full Direct-Route Gateway Flow

Red:
- Add integration tests that cover parse, normalize, match, plan, acquire, execute, classify, and build response.
- Cover text, binary/base64, null-body statuses, and target HTTP error statuses.

Green:
- Wire parser, normalizer, access guard, pipeline/planner, attempt executor, retry decider, classifier, and builder inside `ProxyGatewayService`.
- Remove temporary `NOT_IMPLEMENTED` paths for covered v0.1 behavior.

Verify:
- Direct-route integration tests pass.

## 19. Thin Wrapper Contract Suite

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

## 20. Public Exports and Packaging Checks

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
