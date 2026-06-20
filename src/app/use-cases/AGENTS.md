# AGENTS.md - Use-Cases

Use-cases coordinate domain objects, app collaborators, and ports. They must not import provider packages or framework packages.

## HandleProxyFetchRequestUseCase

Owns the top-level request flow:

```txt
Request
  -> parse proxy-fetch.v1 envelope
  -> normalize target request
  -> enforce target access
  -> select or obtain execution plan
  -> execute attempts
  -> build proxy-fetch.v1 response envelope
```

It may build Web `Response` objects through envelope builders. It must not inline provider acquire/release, transport execution, retry-loop, or lease-verification details when those belong to app collaborators.

When `ProxyGatewayOptions.routes` or `defaultRoute` are configured, this use-case must select a route/default route after target access and before planning. The selected route/default `plan` flows through the same configured-plan path as `ProxyGatewayOptions.plan`.

When non-empty `ProxyGatewayOptions.pipelines` are configured, this use-case must execute them through `ProxyPipelineEngine` after route/default selection has supplied any base requirements. Pipeline steps must come from `ProxyPipelineStepRegistryPort`; missing steps return stable pipeline service errors. A selected pipeline plan is executable and goes to attempt execution without route/default/direct fallback.

If all configured pipelines skip or complete without a plan, the use-case falls through to the selected route/default plan or direct `ProxyGatewayOptions.plan`. It must not fall through to no-plan provider fallback while pipelines are configured.

Pipeline execution services may expose a planner service that wraps `ExecutionPlanner` and orders providers by current pipeline candidates. Do not expose provider-specific adapter config to built-in selection/ranking steps or reintroduce gateway-level provider selection outside configured plans.

When a configured plan is selected from either `ProxyGatewayOptions.plan` or declarative route/default-route config, this use-case must resolve sticky-session read-path pins before obtaining the executable attempt plan from `ExecutionPlanner`. For route/default-route config, merge selected route/default requirements into the selected plan before session pinning so route-level identity defaults participate in sticky-session reads and writes. Session hits may constrain the first configured attempt to a provider instance, but `ExecutionPlanner` must still perform provider capability checks.

There is no public `providerSelection.providerInstanceId` bridge. Explicit provider choice belongs in configured plans, route/default-route plans, or pipeline output. The no-plan fallback may only select the first enabled provider when no `plan`, `routes`, `defaultRoute`, or non-empty `pipelines` are configured.

After a completed successful attempt with identity TTL requirements, this use-case owns best-effort sticky-session writes through `ProxySessionStorePort`. Session write failures must not mask a successful target response. Provider-scoped session writes should remove stale candidate keys before writing the successful provider record.

## AttemptExecutor

Owns attempt execution over a `ProxyExecutionPlan`:

```txt
planned attempt
  -> provider.acquire()
  -> optional lease verification in retry/verification phase
  -> route support check
  -> target transport execution
  -> response buffering
  -> result classification
  -> provider.release() best-effort
```

It returns app-level execution results, not Web `Response` objects. Envelope building stays in `HandleProxyFetchRequestUseCase`.

When classified attempt diagnostics are exposed in service error `details`, use-cases must pass only the `ResultClassifier` diagnostics. Do not build raw target, route, verifier, or provider diagnostics directly in envelope code.

It must pass `requestId`, provider instance id, attempt context, normalized target, structured requirements, execution context, and the active attempt signal to `provider.acquire()`.

`release()` receives the classified `ProxyAttemptResult`. Release failures are recorded as `GatewayEvent`s and must not mask the completed or failed attempt result.

When retry/fallback is enabled, `AttemptExecutor` keeps retry-loop state but delegates every same-attempt retry and fallback decision to `RetryDecider`. It must evaluate the classified result of each completed or failed attempt before deciding whether to return it, retry the same attempt, or move to a fallback attempt.

Gateway events from earlier attempts must be accumulated and returned with the final executor result.

## Retry, Fallback, and Verification

Same-attempt retry and fallback traversal must be driven by `RetryDecider`.

Caller abort and total timeout prevent future fallback attempts. Per-attempt timeout may continue to a later attempt only when `RetryDecider` allows it.

Lease verification runs after provider `acquire()` and before target transport execution. It uses `ProxyExecutionAttempt.verification` plus `ProxyExecutionAttempt.requirements.geo` as the trigger and expected-geo source.

`ProxyExitVerifierPort` receives request id, lease, route, expected geo requirements, and the active attempt `AbortSignal`.

If `verification.verifyExit` is true but no verifier is configured, classify the attempt as `EXIT_VERIFICATION_FAILED`.

If verification returns a mismatch and the attempt requires rejection, classify the attempt as `PROXY_GEO_MISMATCH`. Target transport must not execute after verification rejection.

Stable thrown service/error codes at the executor boundary may be mapped to classified outcomes before retry decisions. Known examples include `PROXY_AUTH_ERROR` and `RESPONSE_STREAM_ALREADY_STARTED`; all final outcome/code/retryability mapping still goes through `ResultClassifier`.

Parser, planner, envelope building, framework wrappers, real verifier implementations, DNS, GeoIP, and target probing stay outside retry/fallback/verification execution.
