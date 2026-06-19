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
- `src/app/classification`
- `src/app/envelopes`
- `src/app/normalization`
- `src/app/pipeline`
- `src/app/planning`
- `src/app/retry`
- `src/app/types`
- `src/app/use-cases`
- `src/domain`
- `src/domain/matching`
- `src/domain/routing`

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

## 8. Matchers - Done

Implemented:
- Added `src/domain/matching` for pure dependency-free matching primitives instead of a generic `src/utils` bucket.
- Added a focused glob contract test suite recreated for this package's route-matching needs, without copying third-party fixtures or keeping external test links in the repo.
- Implemented `matchGlob()` and `hasGlobMagic()` for literal segments, `*`, `?`, full-segment `**`, character classes/ranges, negated classes, escaping, and explicit case-insensitive matching.
- Kept brace expansion and extglob unsupported and literal.
- Added `STRING_MATCHER_KIND` for closed matcher kinds.
- Added generic string matcher compilation and matching for exact, prefix, suffix, glob, declarative regexp, programmatic `RegExp`, and predicate matchers.
- Added host normalization for case, trailing dots, explicit ports, and URL input.
- Added label-aware suffix host matching.
- Added target URL normalization, path matching against URL pathnames, and `.onion` detection.

Red:
- Keep the focused glob tests green while adding the broader route matcher surface.
- Add matcher tests for exact host, suffix host, glob path, declarative regexp, programmatic `RegExp`, hostname case normalization, trailing-dot normalization, and `.onion` detection.

Green:
- Implement URL and host normalization.
- Implement exact, suffix, glob, and regexp matching.
- Validate declarative regexp inputs.
- Represent closed matcher kinds with enums, not inline string-literal unions.

Verify:
- Matcher tests pass.

## 9. Route Priority and Exclude - Done

Detailed scope:
- Keep route selection as a pure domain rule in `src/domain/routing`.
- Add route-match evaluation over the normalized target URL: `url`, `host`, `path`, and `method` for this slice.
- Keep richer match surfaces such as headers/context/facts for later route/pipeline work unless a test in this step requires them.
- Use deterministic ordering: higher `priority` wins; equal priority preserves declaration order.
- Evaluate `exclude` only after the route's positive `match` succeeds.
- Use an explicit default route only when no configured route matches.
- Represent route-selection result kinds and stable no-match error codes with package enums.

Implemented:
- Added `src/domain/routing` with `selectRoute()` and `matchesRoute()`.
- Added route config, default-route config, route-match, route-selection input, target, and result types.
- Added `ROUTE_SELECTION_RESULT_KIND` and `RESPONSE_CODE.NO_ROUTE_MATCHED`.
- Implemented deterministic priority sorting without mutating configured routes.
- Implemented stable equal-priority ordering by declaration index.
- Implemented `exclude` evaluation after positive match only.
- Implemented explicit default route fallback only after no route matched.
- Implemented method matching case-insensitively against target methods.

Red:
- Add tests for priority ordering.
- Add tests for stable ordering when priorities are equal.
- Add tests showing `exclude` is evaluated after a positive match.
- Add a no-match test that returns `NO_ROUTE_MATCHED`.
- Add tests that route-selection result kinds and stable error codes use package enums.
- Add a default-route test proving default selection happens only after no route matched.
- Add a small route-match test for method plus URL/host/path matcher integration.

Green:
- Implement deterministic route selection.
- Add default-route behavior only where explicitly configured.

Verify:
- Route selection tests pass.

## 10. Policy Pipeline Engine - Done

Detailed scope:
- Keep pipeline orchestration in `src/app/pipeline`; keep custom step contracts in outbound ports because user/application code implements them.
- Add package enums for pipeline phases and decision kinds before adding public contracts.
- Execute phases in this fixed order: `match`, `enrich`, `require`, `select`, `rank`, `plan`, `verify`.
- Treat missing optional phase arrays as empty. The `plan` phase remains required by config shape, but tests may use an empty `plan` array to exercise engine behavior.
- Each configured step receives `requestId`, the current decision state, configured `args`, gateway services, and the caller/attempt `AbortSignal`.
- A step result may return a `statePatch`, a decision, and events. State patches must be merged deterministically and must not mutate the previous state object.
- Keep v0.1 state-patch semantics intentionally explicit:
  - replace `target` when provided;
  - shallow-merge `context`, `facts`, `requirements`, and `metadata`;
  - replace `candidates` and `plan` when provided.
- Decision behavior for v0.1:
  - missing decision or `CONTINUE` continues;
  - `REJECT` stops execution and returns the rejection;
  - `USE_PLAN` stores/returns the execution plan and stops later phases for the selected pipeline;
  - `SKIP_PIPELINE` stops the current pipeline without treating it as rejection.
- Unknown step types must fail with a stable package enum/code before any later step executes.
- Events returned by steps should be accumulated in order, but telemetry emission remains a later integration concern.

Implemented:
- Added `PIPELINE_PHASE`, `PIPELINE_DECISION_KIND`, `PIPELINE_RESULT_KIND`, and `RESPONSE_CODE.PIPELINE_STEP_NOT_FOUND`.
- Added outbound pipeline contracts: configs, step input/result, decisions, decision state, state patch, events, services, candidates, requirements, and execution plan types.
- Added `src/app/pipeline/ProxyPipelineStepRegistry`.
- Added `src/app/pipeline/ProxyPipelineEngine`.
- Implemented fixed phase order: `match`, `enrich`, `require`, `select`, `rank`, `plan`, `verify`.
- Implemented deterministic state patch merging without mutating previous state.
- Implemented stop behavior for `REJECT`, `USE_PLAN`, and `SKIP_PIPELINE`.
- Implemented stable unknown-step result before later steps execute.
- Implemented ordered event accumulation.
- Exported pipeline outbound contracts from the package root.

Red:
- Add tests that pipeline phase enums and decision-kind enums are used instead of inline string literals.
- Add tests proving phase order.
- Add tests for state patches flowing into later steps.
- Add tests for `reject`, `use-plan`, and `skip-pipeline` decisions.
- Add a test for unknown step type handling.
- Add tests that pipeline phase and decision kinds use enums, not inline string-literal unions.
- Add tests proving step args, request id, services, and `AbortSignal` are passed to each step.
- Add tests proving returned events are accumulated in execution order.

Green:
- Add outbound `ProxyPipelineStep` and registry contracts.
- Implement `ProxyPipelineEngine`.
- Implement `ProxyPipelineStepRegistry`.
- Implement controlled state patch merging.
- Add stable error/result shape for unknown step types.

Verify:
- Pipeline tests pass.

## 11. Execution Planner and Requirements - Done

Detailed scope:
- Keep planning orchestration in `src/app/planning`; keep provider capability/domain contracts in outbound ports and domain models.
- Refine the placeholder `ProxyExecutionPlan` and attempt types introduced in step 10 instead of creating a second execution-plan model.
- The planner consumes the selected route/default-route plan from step 9 and turns it into a provider-agnostic `ProxyExecutionPlan`.
- Start with one built-in plan kind: fallback attempts in declared order.
- Planner output should be executable by a later attempt executor, but this step should not execute provider `acquire()` or target transport.
- Provider references inside plan attempts must use provider instance ids, not adapter kind names.
- Capability snapshots must be collected in the planner before execution and reused by later attempt execution.
- Requirement filtering in this step covers only the provider capability dimensions needed for v0.1:
  - explicit provider instance include/exclude;
  - protocol support;
  - network type support;
  - DNS mode support and remote DNS requirement;
  - disabled provider instances.
- `socks5h` and `dns.resolution: "proxy"` must be preserved as requirements. The planner must not silently downgrade to `socks5` or gateway DNS.
- Unknown explicit provider instance ids keep using `RESPONSE_CODE.PROVIDER_INSTANCE_NOT_FOUND`.
- Capability mismatch/no viable provider should return a stable planner result code, represented by package enums.
- Step 11 introduces planner-owned provider selection. Full removal or narrowing of the temporary public `providerSelection.providerInstanceId` bridge stays in step 19 after the full direct-route flow is wired through the planner.
- Keep route-chain, forward-proxy transport support, retry execution, and timeout behavior out of this step unless needed only as inert plan data.

Implemented:
- Added `src/app/planning/ExecutionPlanner`.
- Added `PLANNER_RESULT_KIND`, `PROXY_PLAN_KIND`, `PROXY_PROTOCOL`, `PROXY_DNS_MODE`, `PROXY_NETWORK_TYPE`, and `RESPONSE_CODE.NO_PLANNABLE_PROVIDER`.
- Refined the step 10 `ProxyExecutionPlan` placeholder with `kind`, capability snapshots, provider kind, and typed requirements.
- Refined provider capabilities enough for v0.1 planning: protocols, network types, and DNS modes.
- Implemented fallback attempt ordering.
- Implemented explicit provider instance selection by id.
- Implemented implicit provider selection that skips disabled providers.
- Implemented unknown/disabled explicit provider rejection with `PROVIDER_INSTANCE_NOT_FOUND`.
- Implemented protocol, network type, and DNS mode filtering before execution.
- Preserved `socks5h` and `dns.resolution: "proxy"` requirements without downgrade.
- Ensured provider capabilities are read during planning and `acquire()` is not called.
- Proved the temporary direct provider-selection hook can be represented as planner-owned provider choice.

Red:
- Add tests that planner result kinds and stable rejection codes use package enums.
- Add tests that the step 10 `ProxyExecutionPlan` placeholder shape is refined into the planner-owned public shape, not duplicated.
- Add tests that `plan.fallback` produces ordered attempts.
- Add tests for provider capability mismatch before `acquire()`.
- Add tests for protocol, network type, and DNS requirement checks.
- Add a test proving `socks5h` plus proxy DNS requirements are not downgraded.
- Add tests that explicit provider references use provider instance ids and unknown ids return the stable `PROVIDER_INSTANCE_NOT_FOUND` service code.
- Add tests that disabled providers are rejected/skipped during planning.
- Add tests that provider capabilities are read during planning but provider `acquire()` is not called.
- Add tests that planner-owned provider selection can express the same direct-route choice currently covered by the temporary `providerSelection.providerInstanceId` hook from step 7.

Green:
- Implement `ExecutionPlanner`.
- Add the initial built-in `plan.fallback` step.
- Reject impossible plans before execution.
- Move provider capability snapshots into planner-owned selection so the use-case does not duplicate planning concerns.
- Keep use-case integration scoped: introduce planner-owned selection now, remove or narrow the temporary public bridge later in step 19.

Verify:
- Planner tests pass.

## 12. Forward Proxy and SOCKS5H Route Model

Detailed scope:
- This step is about route contracts and transport handoff only. It must not implement provider-specific adapters, SOCKS clients, HTTP CONNECT tunneling, or actual proxy networking.
- Reuse the protocol and DNS enums introduced in step 11. Do not create a second protocol/DNS model for routes.
- Extend the common outbound route model from direct-only to include:
  - `ForwardProxyRoute`;
  - `RouteChain`;
  - `ForwardProxyHop`;
  - `TorClientHop`;
  - `CustomTransportHop`;
  - `CustomTransportRoute`;
  - route auth and DNS mode types.
- Use enums for closed route kinds, hop kinds, protocols, DNS modes, and auth modes.
- Preserve `socks5h` as a distinct protocol and require `dns: "proxy"` for Tor-like SOCKS5H routes where remote DNS is required.
- The target transport port receives the provider route unchanged. Translation into provider-specific syntax belongs outside the core.
- Unsupported routes should be classified with a stable enum/code at the transport/attempt boundary, but this step only needs enough classification shape to test route support rejection.
- Route credentials and auth tokens must be representable but must not appear in diagnostics or event metadata.
- Keep full `ResultClassifier` behavior in step 14; this step may add only the minimal unsupported-route result enum/code needed by route model tests.

Red:
- Add tests that providers can return `forward-proxy` routes for supported protocols.
- Add a test that a `socks5h` route preserves proxy DNS mode.
- Add a test that unsupported route types are classified as `UNSUPPORTED_ROUTE`.
- Add a test that route auth does not leak into diagnostics.
- Add tests for route kind, hop kind, protocol, DNS mode, and auth mode enums.
- Add tests that `CustomTransportRoute.execute()` can return a target response through the common route model without the core knowing provider syntax.
- Add tests that route chains are representable but rejected by a transport that does not support route chains.

Green:
- Add forward-proxy route contracts.
- Add route-chain and custom-transport route contracts.
- Pass routes to the transport without provider-specific translation.
- Classify unsupported transport routes clearly.
- Add a small route diagnostic/redaction helper only if needed by tests; otherwise leave full redaction for the redaction step.

Verify:
- Route model tests pass.

## 13. Retry Safety

Detailed scope:
- Keep retry decision logic in `src/app/retry`; keep classification itself in step 14.
- This step decides whether another already-planned attempt may run. It should not execute attempts, acquire leases, or classify raw errors.
- Inputs should be already-classified attempt outcomes, request method/body replayability, route retry policy, retry safety policy, and attempt/fallback position.
- Use enums for retry conditions and retry decision kinds. If this step needs attempt outcome values before step 14, extend the existing `PROXY_ATTEMPT_RESULT_OUTCOME` enum rather than introducing a parallel outcome enum.
- Default behavior must stay safe:
  - target HTTP statuses are not retried by default;
  - unsafe methods are not retried by default;
  - unsafe method retry requires explicit policy and, when configured, an idempotency key;
  - non-replayable bodies prevent retry before a second attempt starts;
  - caller abort and total gateway timeout are never retried.
- This step should distinguish "retry same route/provider attempt" from "fallback to next planned attempt" where the plan has another attempt available.
- Response streaming already started remains non-retryable; full streamed-response handling can stay in later response streaming work.
- Keep retry decision output small and executable by a later attempt executor: decision kind, optional retry condition, next attempt index/provider id where applicable, and reason/code.

Red:
- Add tests that retry condition enums and retry decision enums are used instead of inline string literals.
- Add a test that target HTTP `500` is returned without retry by default.
- Add a test that HTTP status retry happens only when explicitly configured.
- Add tests for retryable network/proxy failures when policy allows them.
- Add tests that unsafe methods do not retry by default.
- Add tests that non-replayable bodies prevent retry.
- Add tests that POST retries require explicit unsafe retry policy and an idempotency key when the policy requires one.
- Add tests that caller abort and total gateway timeout never retry.
- Add tests that retry can choose fallback only when a later planned attempt exists.
- Add tests that response-stream-already-started is not retryable.

Green:
- Implement `RetryDecider`.
- Add default retry safety behavior.
- Connect retry decisions to attempt outcomes and body replayability.
- Represent retry conditions and retry decisions with enums where they cross module boundaries.
- Keep attempt execution integration for later steps; this step returns decisions only.

Verify:
- Retry tests pass.

## 14. Result Classification

Detailed scope:
- Keep result classification in `src/app/classification`.
- This step converts already-observed attempt data into stable gateway taxonomy. It does not decide whether to retry; retry remains step 13.
- Expand or replace the provisional `PROXY_ATTEMPT_RESULT_OUTCOME.SUCCESS` / `GATEWAY_ERROR` values from earlier direct-route slices with the final outcome enum values, preserving or updating existing tests intentionally.
- Classifier inputs should be explicit and testable:
  - target HTTP response status;
  - target transport/network error kind;
  - proxy auth/connection/timeout error kind;
  - gateway timeout;
  - caller abort;
  - policy rejection;
  - request body replayability failure;
  - response stream already started;
  - unsupported route.
- Target HTTP statuses are classified for retry policy decisions but must not become service errors by default.
- Classifier output should include the attempt outcome enum, optional retry condition enum, stable service error code/status where the failure is service-level, and safe diagnostic metadata.
- Preserve best-effort provider `release()` behavior: release should receive the final classified `ProxyAttemptResult` without release failures masking the response/error returned to the caller.
- Keep envelope building integration narrow: add mapping helpers only where needed by tests; full gateway wiring remains in later full-flow steps.

Red:
- Add classification tests for target HTTP status, target network error, target timeout, proxy auth error, proxy connection error, proxy timeout, gateway timeout, caller abort, policy rejection, and unsupported route.
- Add tests that replace the step 6 provisional `TARGET_TRANSPORT_ERROR` / `PROXY_ATTEMPT_RESULT_OUTCOME.GATEWAY_ERROR` handling with the final result taxonomy where possible, without regressing best-effort `release()` behavior.
- Add tests that target HTTP 4xx/5xx statuses are not service errors by default but expose retry condition values for retry policy.
- Add tests that caller abort and gateway timeout are not retryable conditions.
- Add tests that diagnostic metadata does not include route credentials, target authorization headers, or cookies.

Green:
- Implement `ResultClassifier`.
- Add stable service error codes and statuses.
- Map classified attempt results into response envelopes.
- Keep `ProxyAttemptResult.outcome` backed by enum values.
- Expand `PROXY_ATTEMPT_RESULT_OUTCOME` to the final v0.1 taxonomy or provide a deliberate compatibility alias if a rename is unavoidable.
- Keep retry decisions out of the classifier; expose retry condition data only.

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
