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
- `src/app/redaction`
- `src/app/retry`
- `src/app/security`
- `src/app/timeouts`
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

This step closes the JSON-envelope compatibility gap between the early gateway-local test shape and the actual `@echospecter/proxy-fetch` wire contract. Multipart parsing and multipart response building stay in steps 19 and 20.

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
- Step 11 introduces planner-owned provider selection. Full removal or narrowing of the temporary public `providerSelection.providerInstanceId` bridge stays in step 23 after the full direct-route flow is wired through the planner.
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
- Keep use-case integration scoped: introduce planner-owned selection now, remove or narrow the temporary public bridge later in step 23.

Verify:
- Planner tests pass.

## 12. Forward Proxy and SOCKS5H Route Model - Done

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
- Keep full `ResultClassifier` behavior in step 13; this step may add only the minimal unsupported-route result enum/code needed by route model tests.

Implemented:
- Added route model enums for route kinds, hop kinds, and route auth modes, plus `UNSUPPORTED_ROUTE`.
- Expanded the outbound `ProxyRoute` model from direct-only to direct, forward-proxy, route-chain, and custom-transport routes.
- Added forward-proxy, Tor client, and custom-transport hop contracts for route chains.
- Added route auth contracts that can represent credentials and tokens without exposing them through diagnostics.
- Added optional `TargetTransportPort.supportsRoute(route)` preflight support.
- Passed provider routes to target transports unchanged for supported route kinds.
- Added unsupported-route handling at the attempt/transport boundary with best-effort provider release.
- Added `createRouteDiagnostic()` for safe route diagnostics that omit usernames, passwords, and tokens.
- Added route model tests for forward-proxy handoff, `socks5h` with proxy DNS, unsupported route rejection, custom transport execution, route-chain representability, and safe diagnostics.

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

## 13. Result Classification - Done

Detailed scope:
- This step now comes before retry because `RetryDecider` must consume classified outcomes, not raw thrown values.
- Keep result classification in `src/app/classification`.
- This step converts already-observed attempt data into stable gateway taxonomy. It must not decide whether to retry and must not execute provider acquisition or target transport.
- Expand `PROXY_ATTEMPT_RESULT_OUTCOME` toward the final v0.1 taxonomy in `src/constants.ts`.
- Add `RETRY_CONDITION` in `src/constants.ts` because classifier output may expose retry-condition hints for the next step.
- Existing provisional values from earlier direct-route slices must be handled intentionally:
  - keep `SUCCESS`;
  - replace `GATEWAY_ERROR` usage with more specific outcomes where the classifier is used;
  - leave direct executor migration to later integration only when changing it would expand this step too far.
- Classifier inputs should be explicit and easy to test:
  - target HTTP response status;
  - target transport/network failure;
  - target timeout;
  - proxy auth failure;
  - proxy connection failure;
  - proxy timeout;
  - gateway timeout;
  - caller abort;
  - policy rejection;
  - request body replayability failure;
  - response stream already started;
  - unsupported route.
- Target HTTP statuses are classified for retry policy decisions but must not become service errors by default.
- Classifier output should include attempt outcome enum, optional retry condition enum, optional service error code/status for service-level failures, and safe diagnostic metadata.
- Diagnostics must reuse the route diagnostic rules added in step 12 where route data is included, and must not include route credentials, target authorization headers, cookies, proxy credentials, or tokens.
- Preserve best-effort provider `release()` behavior in existing tests. Full attempt-executor wiring remains later.

Implemented:
- Added `src/app/classification/ResultClassifier`.
- Expanded `PROXY_ATTEMPT_RESULT_OUTCOME` with the v0.1 classification taxonomy while keeping the earlier `GATEWAY_ERROR` value as a compatibility leftover for code paths not yet migrated.
- Added `RETRY_CONDITION` enum values for HTTP retry-status hints, target/proxy failures, timeout, geo mismatch, and exit verification failure.
- Added stable service-level response codes for classified target/proxy/timeout/policy/replayability/streaming/verification failures.
- Classified target HTTP 4xx/5xx responses as attempt outcomes with retry-condition hints, not service errors.
- Classified target transport failures in the current direct execution path as `TARGET_NETWORK_ERROR` while preserving the service envelope code `TARGET_TRANSPORT_ERROR`.
- Kept unsupported route classification wired through the direct execution path with `retryable: false`.
- Added diagnostics that reuse safe route diagnostics and redact sensitive target headers.
- Added result-classifier tests and updated direct route hardening/route model expectations for classified outcomes.

Red:
- Add tests that `PROXY_ATTEMPT_RESULT_OUTCOME` and `RETRY_CONDITION` use package enums.
- Add tests for target HTTP success and target HTTP retry-condition statuses such as 403, 429, and 500.
- Add tests proving target HTTP 4xx/5xx statuses are not service errors by default.
- Add tests for target network error, target timeout, proxy auth error, proxy connection error, and proxy timeout.
- Add tests for gateway timeout and caller abort.
- Add tests for policy rejection, request-body-not-replayable, response-stream-already-started, and unsupported route.
- Add tests for service-level error mapping: code, status, retryable hint where applicable, and safe message.
- Add tests that diagnostic metadata redacts route credentials and sensitive target headers.
- Add regression tests that best-effort provider `release()` still receives the classified `ProxyAttemptResult` where current direct execution uses the classifier.

Green:
- Implement `ResultClassifier`.
- Add final or near-final v0.1 attempt outcome enum values.
- Add retry-condition enum values for HTTP, proxy, target, timeout, geo, and verification conditions.
- Add stable service error codes/statuses only for service-level failures.
- Add small mapping helpers only where needed by tests; do not wire the full gateway flow in this step.
- Keep retry decisions out of the classifier; expose retry-condition hints only.

Verify:
- Classification tests pass.

## 14. Retry Safety - Done

Detailed scope:
- Keep retry decision logic in `src/app/retry`.
- This step consumes classified output from step 13. It must not classify raw errors, execute attempts, acquire leases, call target transport, or inspect thrown error objects.
- Reuse `RETRY_CONDITION` from step 13. Do not create a parallel retry-condition model.
- Add only the retry-decision enum and decision result shape needed by `RetryDecider`.
- Suggested decision enum values: `DO_NOT_RETRY`, `RETRY_SAME_ATTEMPT`, and `FALLBACK_TO_NEXT_ATTEMPT`.
- Inputs should be already-classified attempt outcome, optional retry condition, request method, request headers, request body replayability, retry policy, retry safety policy, current plan position, current attempt number for that provider attempt, and the planned attempts list.
- Retry policy in this step should stay close to the existing plan/attempt shape:
  - `retryOn?: RETRY_CONDITION[]`;
  - `maxAttempts?: number`;
  - fallback is available only when a later planned attempt exists.
- Default behavior must stay safe:
  - target HTTP statuses are not retried by default;
  - HTTP status retry happens only when the route/attempt policy lists the matching condition;
  - unsafe methods are not retried by default;
  - unsafe method retry requires explicit policy and, when configured, an idempotency key;
  - non-replayable bodies prevent retry before a second attempt starts;
  - caller abort and total gateway timeout are never retried;
  - response-stream-already-started is never retried.
- Proxy auth errors may fallback to a different provider instance when policy allows, but must not retry the same provider instance.
- `GATEWAY_ERROR` is a legacy compatibility outcome. New retry tests should use the specific outcomes produced by `ResultClassifier`.
- Keep retry output executable by a later attempt executor: decision kind, optional retry condition, optional next attempt index/provider id, and reason/code.

Implemented:
- Added `src/app/retry/RetryDecider`.
- Added `RETRY_DECISION_KIND` and `RETRY_DECISION_REASON` package enums.
- Reused `RETRY_CONDITION` from result classification instead of creating a parallel condition model.
- Added `retryOn?: RETRY_CONDITION[]` to execution attempts and plan attempt configs.
- Carried `retryOn` through `ExecutionPlanner`.
- Added `RetrySafetyPolicy` to app-layer configuration types and `ProxyGatewayOptions`.
- Implemented safe defaults: HTTP statuses do not retry unless configured, unsafe methods do not retry by default, idempotency keys are required when configured, non-replayable bodies do not retry, caller abort/gateway timeout/started response stream do not retry.
- Implemented same-attempt retry while `maxAttempts` remains and fallback to later planned attempts.
- Implemented proxy-auth behavior that forbids same-provider retry but allows fallback to another planned provider when policy allows.
- Added retry decision tests.

Red:
- Add tests that retry decision kinds use package enums, not inline string literals.
- Add tests that `RetryDecider` consumes `RETRY_CONDITION` from step 13 instead of redefining conditions.
- Add a test that target HTTP `500` is not retried by default even when classified with `RETRY_CONDITION.HTTP_500`.
- Add tests that HTTP status retry happens only when explicitly configured.
- Add tests for retryable network/proxy failures when policy allows them.
- Add tests that proxy auth error does not retry the same provider instance, but may fallback when another planned provider exists and policy allows it.
- Add tests that unsafe methods do not retry by default.
- Add tests that non-replayable bodies prevent retry.
- Add tests that POST retries require explicit unsafe retry policy and an idempotency key when the policy requires one.
- Add tests that caller abort and total gateway timeout never retry.
- Add tests that fallback is selected only when a later planned attempt exists.
- Add tests that response-stream-already-started is not retryable.

Green:
- Implement `RetryDecider`.
- Add `RETRY_DECISION_KIND` in `src/constants.ts`.
- Add default retry safety behavior.
- Connect retry decisions to classified attempt outcomes, retry conditions, plan position, current attempt count, method safety, idempotency key, and body replayability.
- Keep attempt execution integration for later steps; this step returns decisions only.

Verify:
- Retry tests pass.

## 15. Total Timeout, Attempt Timeout, and Abort - Done

Detailed scope:
- Keep timeout orchestration in `src/app/timeouts`.
- This step wires cancellation primitives, not full retry execution. Per-attempt timeout should be tested with a small harness/fake executor until the full attempt executor is ready.
- Model the two-level cancellation tree:
  - caller signal;
  - total gateway controller;
  - per-attempt controller derived from total/caller state.
- `options.timeoutMs` parsed from the proxy-fetch envelope should become the default total timeout for that request when present.
- Attempt timeout should come from the planned attempt when present; otherwise use the configured/default attempt timeout.
- Provider `acquire()`, optional verification, and target transport must receive the attempt signal.
- If caller aborts or total timeout fires, no fallback starts.
- If per-attempt timeout fires, `TimeoutController` should report an attempt-timeout observation that later retry logic can consume. Fallback execution itself remains outside this step.
- Lease `release()` should run when a lease exists, even after timeout or abort. Release remains best-effort.
- Timer cleanup and abort listener cleanup are required and must be test-covered with deterministic fake timers or controlled promises.
- Timeout/abort observations should map to the outcomes and service-error mappings already introduced by `ResultClassifier`.
- Avoid using real sleeps in tests; use controlled promises, fake timers, or immediate abort signals.

Implemented:
- Added `src/app/timeouts/TimeoutController`.
- Added `TIMEOUT_OBSERVATION_KIND` package enum and timeout message constants.
- Added `TimeoutPolicy` to app-layer config and `ProxyGatewayOptions`.
- Added total-request timeout from `proxy-fetch` envelope `options.timeoutMs`, falling back to configured total timeout when present.
- Added per-attempt timeout for the current direct-route vertical slice.
- Passed the same attempt `AbortSignal` through provider `acquire()` and target transport execution.
- Added timeout/abort observation mapping to `PROXY_ATTEMPT_RESULT_OUTCOME` values consumed by `ResultClassifier`.
- Returned classified service errors for caller abort, total gateway timeout, and attempt timeout.
- Released acquired leases after transport-side timeout/abort where a lease exists.
- Added deterministic fake-timer tests for cleanup, total timeout, caller abort, attempt signal propagation, and attempt timeout release.

Red:
- Add tests that timeout and abort observations map to existing `PROXY_ATTEMPT_RESULT_OUTCOME` enum values.
- Add a test that total timeout cancels the active attempt and prevents fallback.
- Add a test that per-attempt timeout is reported separately from total timeout.
- Add a test that caller abort cancels acquire/transport and prevents future attempts.
- Add a test for success-vs-timeout race settling once.
- Add a test that lease release runs after timeout or abort when a lease exists.
- Add a test that `options.timeoutMs` from the parsed service envelope is honored as total timeout.
- Add tests proving provider acquire and target transport receive the attempt signal.
- Add tests proving timers/listeners are cleaned up after success, timeout, and abort.

Green:
- Implement `TimeoutController`.
- Wire total and attempt `AbortSignal`s through provider acquisition and target transport.
- Clean up timers and abort listeners.
- Map timeout/abort observations through `ResultClassifier` outcomes from step 13.
- Keep retry/fallback execution minimal; full retry loop wiring remains later.

Verify:
- Timeout and abort tests pass.

## 16. Target Access Guard - Done

Detailed scope:
- Keep target access policy enforcement in `src/app/security`.
- Add package enums/constants before behavior:
  - `TARGET_ACCESS_RESULT_KIND`;
  - `TARGET_ACCESS_REJECTION_REASON`;
  - `TARGET_ACCESS_CHECK_PURPOSE`, unless an existing enum already covers initial target and redirect/final URL checks;
  - stable response code for denied targets, unless existing `REJECTED_BY_POLICY` is intentionally reused in tests.
- This step is SSRF risk reduction for target URLs. It must not become DNS intelligence, GeoIP, or network probing.
- The guard may inspect:
  - normalized target URL scheme/host/port;
  - literal IP hosts;
  - obvious local hostnames such as `localhost` and `*.localhost`;
  - `.onion` hosts;
  - already-provided resolved IP facts when a future enricher/port supplies them.
- The guard must not perform DNS resolution by itself.
- Default policy must deny unsupported schemes and local/private/link-local targets.
- Explicit policy may allow local/private targets for tests or trusted deployments.
- `.onion` access should stay denied by default unless target policy explicitly allows onion targets; route capability checks for onion support stay with planning/transport capability work.
- Redirect guarding in v0.1 should be implemented as a reusable guard method for a supplied redirect URL or final URL. Full redirect-chain integration waits until target transport exposes redirect information.
- Redirect/final URL guarding must normalize and validate:
  - absolute redirect URLs;
  - relative `Location` values resolved against the current URL;
  - protocol-relative `Location` values such as `//127.0.0.1:3000/admin` resolved against the current URL scheme;
  - malformed redirect URLs, returning enum-backed rejection reasons.
- Redirect/final URL guarding must apply the same default-deny SSRF rules as initial target guarding.
- Redirect/final URL guarding must not perform DNS resolution by itself. It may only use already-provided resolved IP facts.
- Rejections should use stable response codes and classified policy-rejection outcomes where practical.
- Keep IP parsing dependency-free and focused:
  - IPv4 loopback/private/link-local/multicast/unspecified ranges;
  - IPv6 loopback/link-local/unique-local/unspecified ranges;
  - bracketed IPv6 URL hosts.
- Keep new rejection messages in package constants or enum-backed reason codes. Do not add free-form string reasons.
- Integration should run before provider capability lookup/acquire in the current direct flow, so denied targets do not cause provider side effects.
- If integration would force a broad use-case rewrite, keep the guard fully tested as a component and add one direct-flow smoke test only.
- This step must not implement manual redirect following, redirect-chain execution, `maxRedirects`, cross-host redirect policy, DNS rebinding mitigation through transport connection pinning, or target transport redirect metadata. Those belong to the later target transport/orchestration work.

Implemented:
- Added `src/app/security/TargetAccessGuard`.
- Added `TargetAccessPolicy` to app-layer config and `ProxyGatewayOptions`.
- Added `DEFAULT_ALLOWED_TARGET_SCHEMES`, `DENIED_IPV4_CIDR_RANGES`, and `DENIED_IPV6_CIDR_RANGES` package constants.
- Added `TARGET_ACCESS_RESULT_KIND` and `TARGET_ACCESS_REJECTION_REASON` package enums.
- Added stable `TARGET_ACCESS_DENIED` response code and target-access denial message constant.
- Implemented dependency-free IPv4 and IPv6 CIDR matching instead of exact URL/IP matching.
- Denied unsupported schemes, localhost-style hostnames, private/loopback/link-local/multicast/unspecified IPv4 and IPv6 ranges, `.onion` targets by default, and already-resolved private IP facts.
- Added explicit allow policy for localhost/private/onion targets.
- Added reusable redirect/final URL validation for absolute, relative, and protocol-relative URL values without inventing target transport redirect metadata.
- Wired target access guard before provider acquisition in the current direct flow.
- Added target access tests for constants/enums, CIDR ranges, policy allow cases, resolved IP facts, redirect URL checks, and direct-flow pre-acquire rejection.

Deferred:
- `TARGET_ACCESS_CHECK_PURPOSE` was not added because the current guard has explicit entry points for initial target checks and redirect/final URL checks.
- Redirect-chain execution, transport redirect metadata, DNS rebinding mitigation, and connection pinning remain later orchestration/transport work.
- Redirect/final URL checks currently validate supplied URLs and base URL resolution, but do not consume redirect-specific resolved IP facts because target transport does not expose redirect resolution metadata yet.

Red:
- Add tests that target access result kinds and stable rejection codes use package enums.
- Add tests that target access rejection reasons use `TARGET_ACCESS_REJECTION_REASON` rather than free-form strings.
- Add default-deny tests for unsupported schemes such as `file:`, `ftp:`, and `data:`.
- Add default-deny tests for `localhost`, `*.localhost`, IPv4 loopback, private, link-local, multicast, and unspecified ranges.
- Add default-deny tests for IPv6 loopback, link-local, unique-local, and unspecified addresses, including bracketed URL hosts.
- Add `.onion` deny-by-default and explicit-allow tests.
- Add explicit-allow tests for policies that intentionally permit local/private targets.
- Add tests that already-resolved private IP facts cause rejection even when the hostname itself is public-looking.
- Add tests that already-resolved link-local IP facts cause rejection even when the hostname itself is public-looking.
- Add tests proving the guard does not perform DNS resolution and only consumes already-provided resolved IP facts.
- Add redirect/final-URL guard tests using a supplied redirect URL, without requiring target transport redirect-chain integration.
- Add redirect URL normalization tests for:
  - absolute `Location` values;
  - relative `Location` values resolved against the current URL;
  - protocol-relative `Location` values resolved against the current URL scheme;
  - malformed `Location` values rejected with enum-backed reason codes.
- Add redirect-to-local/private/link-local tests for normalized redirect URLs:
  - `http://127.0.0.1:<port>/secret`;
  - `http://[::1]:<port>/secret`;
  - `http://169.254.169.254/latest/meta-data/`;
  - `http://10.0.0.5/internal`;
  - `//127.0.0.1:<port>/admin`.
- Add tests proving redirect guard uses the same default-deny rules as initial target guard.
- Add tests proving redirect/final URL with unsupported scheme is rejected:
  - `file:`;
  - `ftp:`;
  - `data:`.
- Add tests proving redirect/final URL with `.onion` host is denied by default and allowed only when target policy explicitly allows onion hosts.
- Add tests proving redirect/final URL with already-provided resolved private/link-local IP facts is rejected.
- Add a direct-flow test proving denied initial targets return a classified service error before provider `getCapabilities()`, provider `acquire()`, provider `release()`, or target transport execution are called.

Green:
- Implement `TargetAccessGuard` in `src/app/security`.
- Add target access policy/result types in the owning app/security module or app-layer types when they are public configuration.
- Add enum-backed result and rejection models before implementing behavior.
- Add a reusable guard entry point for initial target URLs.
- Add a reusable guard entry point for supplied redirect/final URLs.
- The redirect/final URL guard should accept the current/base URL when needed, so relative and protocol-relative redirect locations can be resolved before policy evaluation.
- Apply default-deny rules to unsupported schemes, localhost, obvious local hostnames, local/private/link-local IPs, multicast IPs, unspecified IPs, IPv6 unique-local/link-local/loopback/unspecified IPs, and `.onion` hosts.
- Apply already-provided resolved IP facts to policy evaluation without performing DNS resolution inside the guard.
- Apply the guard before provider capability lookup/acquire/target execution in the current direct flow where doing so does not require the full step 23 orchestration.
- Add reusable validation for supplied redirect/final URLs, but do not invent redirect metadata in target transport.
- Return classified policy-rejection outcomes where practical. Reuse `REJECTED_BY_POLICY` intentionally if that is the current stable outcome, but keep target-access-specific reason codes stable.

Verify:
- Access guard tests pass.
- Redirect/final URL guard component tests pass.
- Direct-flow denied-target smoke test passes.
- Existing service envelope, direct execution, and provider adapter tests still pass.

## 17. Public Contract Alignment and Registry Guardrails - Done

Implemented:
- Target access public fields were aligned on `allowPrivateIps`, `allowLinkLocalIps`, `allowOnionHosts`, `onionRequiresNetworkType`, `allowedHosts`, `deniedHosts`, and `deniedCidrs`.
- Legacy `allowPrivateNetworks` and `allowOnionTargets` policy aliases were removed before v0.1 publication.
- Literal target IP hosts and already-provided resolved IP facts now use the same private/link-local allow semantics.
- `when` is implemented as an optional declarative pipeline prefilter, while `match` remains an optional programmable phase that runs only after `when` matches.
- Duplicate `ProxyPipelineStepRegistry.register()` calls now throw a stable `PIPELINE_STEP_ALREADY_REGISTERED` code and do not replace the existing step.
- README and AGENTS were updated to match the implemented public names.

Detailed scope:
- This step prevents public API drift before redaction, multipart support, and the full gateway flow lock the v0.1 surface.
- Keep this as a contract-alignment step, not a behavior expansion step.
- Align target access policy names across README, AGENTS, app-layer types, implementation, tests, and package exports.
- Use one public target access vocabulary for v0.1:
  - `allowLocalhost`;
  - `allowPrivateIps`;
  - `allowLinkLocalIps`;
  - `allowOnionHosts`;
  - `onionRequiresNetworkType`;
  - `allowedHosts`;
  - `deniedHosts`;
  - `deniedCidrs`.
- Remove or migrate competing names such as `allowPrivateNetworks` and `allowOnionTargets` before the public API is finalized.
- Keep already-implemented aliases only if they are explicitly marked internal or backward-compatibility shims. Since v0.1 is not released yet, prefer removing aliases over supporting two names.
- Stabilize the pipeline public shape:
  - `when` is the declarative prefilter used to decide whether a pipeline applies;
  - `match` phase steps are optional programmable/custom checks inside an already-selected pipeline;
  - if this distinction is not implemented, remove one of the two concepts before v0.1.
- Define `ProxyPipelineStepRegistry.register()` duplicate behavior before user-defined steps become public.
- Prefer rejecting duplicate step types with a stable enum/code instead of silently overwriting registrations.
- Resolve the interface naming rule before packaging:
  - either public API interfaces keep names such as `ProxyGatewayOptions` and the `I`-prefix rule is narrowed to this repository's internal style only;
  - or README, AGENTS, code, tests, and exports are updated to use `IProxyGatewayOptions` consistently.
- Do not add runtime dependencies, config loading, framework imports, provider imports, DNS, GeoIP, or target probing in this step.

Red:
- Add tests that exported target access policy types use `allowPrivateIps`, not `allowPrivateNetworks`.
- Add tests that exported target access policy types use `allowOnionHosts`, not `allowOnionTargets`.
- Add tests proving explicit private/link-local allow flags are applied consistently to literal IP hosts and already-provided resolved IP facts.
- Add tests that README/AGENTS documented policy names match exported TypeScript names where practical through public export/type tests.
- Add tests that a pipeline with `when` not matching does not execute any phase steps.
- Add tests that a pipeline with `when` matching may still use optional `match` phase steps when the public contract intentionally keeps both concepts.
- Add tests that duplicate pipeline step registration returns or throws a stable enum/code and does not silently replace the previous step.
- Add public export tests that fail if both old and new target access policy names remain visible without an explicit compatibility decision.
- Add a small documentation consistency test or static assertion for public interface naming if the project keeps the no-`I` public API style.

Green:
- Rename target access policy fields in types, implementation, tests, and exports to the chosen v0.1 names.
- Update `TargetAccessGuard` so already-provided resolved IP facts respect the same allow flags as literal IP hosts.
- Update pipeline contracts or documentation so `when` and `match` have non-overlapping responsibilities.
- Update `ProxyPipelineStepRegistry.register()` to reject duplicate step types, or document and test intentional overwrite behavior.
- Update README/AGENTS examples if any public names changed.
- Keep this step focused on contract alignment and guardrails.

Verify:
- Target access policy API alignment tests pass.
- Pipeline `when`/`match` contract tests pass.
- Step registry duplicate behavior tests pass.
- Public export tests pass.
- Existing target access, pipeline, planner, and retry tests still pass.

## 18. Redaction

Detailed scope:
- Keep redaction in `src/app/redaction`.
- This step must centralize safe presentation of sensitive data. It should not replace route matching, target access checks, or result classification.
- Add package constants/enums before behavior where values cross modules:
  - redaction placeholder, such as `REDACTED_VALUE`;
  - redaction target kinds/reasons if they are exposed in diagnostics.
- Redact sensitive headers case-insensitively:
  - `authorization`;
  - `proxy-authorization`;
  - `cookie`;
  - `set-cookie`;
  - `x-api-key`;
  - `x-auth-token`.
- Redact sensitive query parameters case-insensitively:
  - `token`;
  - `access_token`;
  - `api_key`;
  - `key`;
  - `secret`;
  - `password`.
- Redact route auth credentials and provider secret-like metadata. Reuse route diagnostic rules from step 12 where possible instead of serializing raw routes.
- Redact raw target URLs before they appear in service-error details, classifier diagnostics, events, logs, or telemetry helpers.
- Do not expose query-string secrets through `target.url`, redirect URLs, final URLs, route metadata, provider metadata, or nested diagnostic objects.
- Keep behavior dependency-free and deterministic.
- Add a narrow `RedactionPolicy` app-layer type only if tests need configuration. Keep default redaction usable without configuration.
- Store default sensitive header/query/metadata key lists as package constants when reused across modules.
- Keep route diagnostics structurally useful: route kind, protocol, host, port, DNS mode, and auth mode may remain visible; credential values must not.
- Apply redaction at service-error diagnostic boundaries that already exist. Full logger/telemetry emission can remain later if ports are not wired yet.
- Avoid changing successful target response envelopes in this step. Redaction is for diagnostics/errors/events, not target response body/header mutation.
- If an existing boundary does not yet carry diagnostics, do not invent a large event/logging system in this step; add reusable redaction helpers and wire only current service-error/classifier boundaries.

Red:
- Add tests that redaction constants/enums are used instead of inline placeholder strings.
- Add tests for sensitive header redaction with mixed-case header names.
- Add tests for sensitive query parameter redaction while preserving non-sensitive parameters.
- Add tests for route auth redaction: username, password, token, and proxy authorization material must not appear.
- Add tests for nested metadata redaction of obvious secret-like keys.
- Add tests that `ResultClassifier` diagnostics and service-error details use `RedactionService` without regressing the safe route diagnostics from step 12.
- Add tests proving classifier diagnostics do not expose raw `target.url` when the URL contains `api_key`, `token`, `password`, `secret`, or `access_token` query parameters.
- Add tests proving redirect/final URL diagnostics from target access checks are redacted before reaching service errors or events.
- Add tests that successful target response headers/bodies are not redacted or mutated by this service.
- Add tests proving redaction is idempotent and does not double-wrap an already redacted value.

Green:
- Implement `RedactionService`.
- Move any step-13 local redaction constants into the shared redaction module/constants where appropriate.
- Add URL redaction helpers that preserve scheme, host, path, and non-sensitive query parameters while replacing sensitive query values.
- Add header, URL, route diagnostic, and nested metadata redaction entry points. Keep them small and explicit instead of one broad magic sanitizer.
- Apply `RedactionService` at service-error, event, and diagnostic boundaries that exist today.
- Keep logger/telemetry integration scoped to helpers if concrete logger/telemetry ports are not wired yet.

Verify:
- Redaction tests pass.
- Existing result-classifier tests pass with centralized redaction.
- Existing target access tests pass without leaking sensitive URL values.

## 19. Multipart Request Parser

Detailed scope:
- Keep proxy-fetch wire parsing/building in `src/app/envelopes`.
- Multipart support must remain dependency-free and request-parser focused in this step.
- This step must implement the receiving side for all multipart shapes emitted by `@echospecter/proxy-fetch`:
  - `meta` JSON part first for streaming multipart;
  - binary `body` part with raw bytes;
  - `request.body.kind: "binary"` and `partName: "body"` in meta;
  - `proxy-fetch-stream-*` boundary compatibility for stream uploads.
- Keep JSON-base64 support from earlier steps intact; multipart must not regress JSON envelope behavior.
- Reuse body buffering limits for multipart binary bodies. Do not buffer unlimited streams.
- Keep multipart response building out of this step; it is step 20.
- Use constants for part names, content-type prefixes, CRLF-related parser strings where shared, and stable multipart parser errors.
- Tests should use byte-level assertions for binary round trips and boundary preservation.
- Implement only the `@echospecter/proxy-fetch` two-part service shape for v0.1. Do not attempt to support arbitrary browser multipart semantics, nested multipart bodies, repeated field names, or file metadata beyond the required `meta` and `body` parts.
- Parser dispatch must be based on `Content-Type`: JSON stays on the existing JSON parser path; `multipart/form-data` uses the multipart parser; unsupported content types become stable invalid-request errors.
- The parser may collect multipart bytes up to configured limits in v0.1, but the limit must be enforced while reading. Do not read unbounded request bodies and only then check the size.
- Streaming multipart compatibility means accepting the shape emitted by proxy-fetch for `ReadableStream` uploads. The gateway may still normalize to buffered bytes when within body limits until full streaming execution is introduced.

Red:
- Add multipart request tests for `meta` JSON part, raw binary `body` part, missing required parts, byte-preserving binary round trip, and body-size enforcement.
- Add parser/integration fixtures for binary client-side body shapes serialized by `@echospecter/proxy-fetch`: `Blob`, `ArrayBuffer`, typed arrays, `FormData`, `ReadableStream` with `duplex: "half"`, existing `Request` objects with binary bodies, and unknown non-text bodies.
- Add tests proving default binary behavior uses multipart, and JSON base64 is used only when `binaryBodyTransport` is `json-base64`.
- Add tests that multipart `meta` uses `request.body.kind: "binary"` and `request.body.partName: "body"`.
- Add multipart streaming tests for the exact streaming shape: `multipart/form-data` content type, `proxy-fetch-stream-*` boundary prefix, `meta` JSON part first, `body` binary part second, and `application/octet-stream` body part content type.
- Add tests that multipart parsing does not require buffering the entire incoming service request before body-limit policy is applied.
- Reuse the exact `request.body.kind: "binary"` / `response.body.kind: "binary"` meta shape from the `@echospecter/proxy-fetch` wire contract.
- Add regression tests proving JSON text/null/base64 requests still parse unchanged after multipart parser dispatch is introduced.
- Add tests for unsupported content types and malformed multipart boundaries returning stable invalid-request service errors.
- Add tests that extra unknown multipart parts are ignored or rejected according to one explicit v0.1 rule; prefer rejecting malformed/unexpected structure unless compatibility requires otherwise.

Green:
- Implement multipart parsing for the service contract.
- Reuse body buffering decisions for multipart binary content.
- Add parser dispatch by `Content-Type` without framework/body-parser dependencies.
- Keep parser errors stable and classified as invalid proxy-fetch requests.
- Keep multipart parser helpers private to `src/app/envelopes` unless a later wrapper contract needs them.

Verify:
- Multipart request parser tests pass.
- Existing JSON parser/builder and body-buffering tests still pass.

## 20. Multipart Response Builder

Detailed scope:
- Keep multipart response building in `src/app/envelopes`.
- This step produces service responses compatible with `@echospecter/proxy-fetch` multipart response parsing.
- Multipart response building should produce:
  - `meta` JSON response envelope part;
  - raw binary `body` part;
  - `response.body.kind: "binary"` and `partName: "body"` in meta.
- Keep JSON text/null/base64 response building intact.
- Do not introduce response streaming policy broader than the current body buffering policy unless tests require it.
- Use package constants for part names, content-type prefixes, CRLF, binary content type, and stable multipart builder errors.
- Ensure body-related headers cannot become stale after service-envelope or multipart body transformation.
- Make the response format decision explicit. For v0.1, prefer multipart for binary response bodies when the service request `Accept` header allows `multipart/form-data`; otherwise use JSON base64 fallback for binary bodies.
- Preserve current JSON response behavior for text, null, service errors, and special response types unless a test proves multipart is required for that shape.
- Keep request multipart parsing and response multipart building as separate components even if they share small constants.

Red:
- Add multipart response builder tests for meta/body output.
- Add byte-preserving binary response tests.
- Add tests that null-body statuses `204`, `205`, and `304` do not emit a body part.
- Add tests for special response types staying JSON-only or being rejected for multipart if the shape cannot be represented safely.
- Add tests that stale `content-length` from a target response is removed or recalculated when the service response body is transformed.
- Add tests that stale body-related headers from JSON/base64/multipart transformations do not corrupt reconstructed proxy-fetch responses.
- Add regression tests proving existing JSON response builder behavior remains unchanged.
- Add tests for response format selection from `Accept: application/json, multipart/form-data`, JSON-only accept, missing accept, and unsupported accept values.
- Add tests that service-error envelopes remain JSON and do not use multipart.

Green:
- Implement multipart response building.
- Reuse `ProxyFetchJsonEnvelopeBuilder` metadata serialization where possible instead of duplicating response envelope rules.
- Normalize or remove stale body-related headers when building service responses.
- Keep multipart response building explicit until response content negotiation/streaming policy is wired.
- Add a small response-format selector rather than scattering `Accept` parsing through builders or use-cases.

Verify:
- Multipart response builder tests pass.
- Existing JSON response builder tests pass.

## 21. Geo Requirements Planning Contract Smoke

Detailed scope:
- Keep this as a v0.1 contract-smoke step, not a real GeoIP, DNS, Tor, or probe-target implementation.
- The core must not ship GeoIP databases, call external IP services, perform DNS intelligence, or know provider-specific geo syntax.
- Add only the minimum planning behavior needed to prevent strict geo requirements from being silently ignored.
- Reuse provider capability contracts already introduced for `geo.mode`, `countries`, and `countrySelection`.
- Define or export `ProxyExitVerifierPort` if the contract is missing, but do not execute verifier calls in this step. Lease-based verification is part of step 22, after `AttemptExecutor` exists.
- Supported v0.1 behavior:
  - `geo.mode: "guaranteed"` may satisfy required country during planning when countries match or countries are `"*"`;
  - `geo.mode: "unsupported"` must be skipped or rejected for required geo requirements;
  - `geo.mode: "best-effort"` must not satisfy strict required geo unless policy explicitly accepts best-effort;
  - `geo.mode: "verified-after-acquire"` may remain plannable only when the plan marks exit verification as required for the attempt;
  - verification mismatch classification remains step 22 because it requires an acquired lease and attempt signal.
- `.onion` route capability checks stay provider/transport capability work; target access policy only decides whether the target is allowed at all.
- This step must not call provider `acquire()`, target transport, verifier ports, DNS, GeoIP, or HTTP probe endpoints.

Red:
- Add planner tests that a provider with `geo.mode: "unsupported"` does not satisfy `geo.strictness: "required"`.
- Add planner tests that a provider with `geo.mode: "guaranteed"` and matching country can satisfy required geo without calling a verifier.
- Add planner tests that a provider with `geo.mode: "verified-after-acquire"` produces an attempt requiring verification when strict geo or `verifyExit` requires it.
- Add planner tests that `verified-after-acquire` providers are rejected when strict verification is required but no verifier contract/configuration exists.
- Add tests that generated attempts preserve expected geo requirements for later verification.
- Add tests proving the core does not perform DNS resolution, GeoIP lookup, HTTP probe calls, or provider-specific geo syntax translation in this step.

Green:
- Extend `ExecutionPlanner` only enough to account for `geo` capability compatibility.
- Add or finalize `ProxyExitVerifierPort` and verification requirement contracts if they are not exported yet.
- Add planning metadata/attempt fields for later verification without executing verification in the planner.
- Keep real probe target, HTTP verifier, Tor providers, and GeoIP integrations out of the core package.

Verify:
- Geo capability planning tests pass.
- Existing planner, retry, timeout, target access, and redaction tests still pass.

## 22. Attempt Executor and Retry Loop

Detailed scope:
- Extract attempt execution out of `HandleProxyFetchRequestUseCase` before the full direct-route flow becomes too large.
- Keep attempt orchestration in `src/app/use-cases` or another narrow app-layer module if ownership is clearer, but do not put it in provider adapters or transports.
- `AttemptExecutor` coordinates already-built collaborators:
  - execution plan;
  - provider adapter acquire/release;
  - optional exit verification;
  - target transport execution;
  - timeout controller;
  - result classifier;
  - retry decider;
  - redaction helpers for diagnostics.
- It owns lease-based exit verification coordination when an attempt produced by the planner requires verification.
- It must not parse proxy-fetch envelopes, perform route matching, load config, perform DNS/GeoIP intelligence, or build service responses.
- Provider `release()` remains best-effort and must not mask the final target response or service error.
- Retry and fallback must be driven only by `RetryDecider`, not by ad hoc checks in the use-case.
- Caller abort and total gateway timeout prevent future fallback attempts.
- Per-attempt timeout may continue to later attempts only when the classified outcome and retry policy allow it.
- Unsafe or non-replayable requests must not be retried even when the plan contains fallback attempts.
- Response streaming already started must prevent retry/fallback.
- Exit verification requests must use the acquired lease/route and the active attempt `AbortSignal`.
- Verification diagnostics must go through `RedactionService`.

Red:
- Add tests for executing a planned fallback chain in declared order.
- Add tests that provider `acquire()` receives request id, provider instance id, attempt context, normalized target, requirements, execution context, and active attempt signal.
- Add tests that target transport receives the acquired route unchanged.
- Add tests that `release()` is called after success, classified failure, timeout, abort, unsupported route, verification failure, and target transport throw when a lease exists.
- Add tests that a release failure is recorded through logger/telemetry helpers when available but does not mask the final result.
- Add tests that `RetryDecider` controls same-attempt retry and fallback.
- Add tests that `POST` with retry policy but without a required idempotency key does not start a second acquire.
- Add tests that caller abort and total timeout prevent future fallback.
- Add tests that per-attempt timeout may fallback only when retry policy allows it.
- Add tests that proxy auth error skips same-provider retry and may fallback to another provider when policy allows it.
- Add tests that response-stream-already-started prevents retry/fallback.
- Add tests that an attempt requiring exit verification calls `ProxyExitVerifierPort` after acquire and before target transport execution.
- Add tests that verification receives request id, lease, route, expected geo requirements, and the active attempt `AbortSignal`.
- Add tests that strict country mismatch from the verifier produces `PROXY_GEO_MISMATCH` and can be retried only when retry policy allows `RETRY_CONDITION.PROXY_GEO_MISMATCH`.
- Add tests that verifier failure without trustworthy result produces `EXIT_VERIFICATION_FAILED`.
- Add tests that target transport is not executed after verification rejection.
- Add tests that verification-sensitive diagnostics are redacted.

Green:
- Implement `AttemptExecutor`.
- Move provider acquire/release, transport execution, optional verifier coordination, timeout observation, classification, and retry-loop logic out of `HandleProxyFetchRequestUseCase`.
- Return a final target response or classified service-level failure suitable for envelope building.
- Keep all retry/fallback decisions delegated to `RetryDecider`.
- Keep all raw error classification delegated to `ResultClassifier`.
- Keep real HTTP probe/verifier implementations outside the core package; tests should use a mock verifier port.

Verify:
- Attempt executor tests pass.
- Mock exit verification tests pass.
- Existing direct execution hardening, timeout, retry, classifier, planner, target access, and redaction tests still pass.

## 23. Full Direct-Route Gateway Flow

Red:
- Add integration tests that cover parse, normalize, target access, match, plan, acquire, optional verify, execute, classify, retry/fallback, redact diagnostics, and build response.
- Cover text, JSON base64, multipart binary request, multipart binary response, null-body statuses, target HTTP error statuses, timeout/abort, target access denial, redacted service errors, and geo/verification mismatch where a mock verifier is configured.
- Add tests proving planner-owned provider selection can replace the temporary `providerSelection.providerInstanceId` direct hook.
- Add tests proving retry decisions can select same-attempt retry or fallback for the direct-flow executor without retrying unsafe/non-replayable requests.
- Add tests proving denied initial targets return before provider `getCapabilities()`, provider `acquire()`, provider `release()`, target transport execution, or verifier execution are called.
- Add tests proving redirect/final URL guard methods are available to transports, even if full redirect-chain execution is still not owned by the core transport.
- Add tests proving no successful target response body/header is redacted or mutated by diagnostic redaction helpers.

Green:
- Wire parser, normalizer, access guard, route selection/pipeline/planner, attempt executor, retry decider, classifier, redaction, and builder through `HandleProxyFetchRequestUseCase` and extracted app collaborators.
- Remove temporary `NOT_IMPLEMENTED` paths for covered v0.1 behavior.
- Remove or narrow the temporary `providerSelection.providerInstanceId` hook once planner-owned direct-route defaults cover the same behavior.
- Ensure redirect-following responsibility is explicit in the target transport contract:
  - transports that follow redirects must call the supplied redirect/final URL guard before following;
  - transports using native fetch automatic redirect following must disable automatic following or document that they cannot provide guarded redirect behavior;
  - full redirect-chain orchestration remains outside v0.1 unless explicitly implemented by a transport.
- Keep framework wrappers out of this step.

Verify:
- Direct-route integration tests pass.
- Existing unit tests for parser, normalizer, target access, planner, retry, timeout, classifier, redaction, multipart, and attempt executor still pass.

## 24. Thin Wrapper Contract Suite

Red:
- Add a shared adapter contract suite.
- Test that an adapter preserves raw JSON body, multipart bytes, multipart boundary, response status, response headers, and response body.
- Add byte-level or sha256 assertions proving binary and multipart bodies are not corrupted by framework body parsers.
- Add tests proving wrapper code does not pre-read or JSON-parse the gateway route body before passing it to `ProxyGateway.handle()`.
- Add a Node HTTP server factory for the contract suite.
- Add framework-shaped mock factories for Express, Fastify, and NestJS wrappers if real frameworks are not dev dependencies.
- If real Express/Fastify/NestJS wrappers are shipped in this package, keep those packages out of runtime dependencies and use them only as devDependencies for tests where possible.

Green:
- Implement `createNodeHttpHandler(gateway)`.
- Implement dependency-free structural wrappers only where they can be shipped without importing framework packages.
- Keep the contract suite reusable for future separate framework adapter packages.
- Preserve raw request bytes and service response bytes across wrapper boundaries.

Verify:
- Wrapper contract tests pass.
- Runtime dependency check still proves zero external runtime dependencies.

## 25. Public Exports and Packaging Checks

Red:
- Add public export tests for documented v0.1 contracts.
- Add tests that deprecated or temporary bridge APIs are not exported unless explicitly intended for v0.1.
- Add CJS and ESM smoke tests after build.
- Add a packaging check that fails if package runtime dependencies are introduced.
- Add package-content checks for README, LICENSE, built ESM/CJS/types, and no test-only fixtures in the published package.

Green:
- Finalize `src/index.ts` exports.
- Add or fix build/test configuration required by the current package scripts.
- Ensure package contents include the built API and README.
- Ensure public exports match README and AGENTS public contracts.

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
5. Planner, classification, and retry/fallback.
6. Timeout, abort, and target access guard.
7. Public contract alignment, pipeline registry guardrails, and redaction.
8. Multipart request and response support.
9. Geo/verifyExit smoke contract and attempt executor.
10. Full direct-route E2E and wrapper contract suite.
11. Public exports and packaging checks.
