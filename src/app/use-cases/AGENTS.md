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

When `ProxyGatewayOptions.plan` is configured, this use-case must resolve sticky-session read-path pins before obtaining the executable attempt plan from `ExecutionPlanner`. Session hits may constrain the first configured attempt to a provider instance, but `ExecutionPlanner` must still perform provider capability checks. The temporary `providerSelection.providerInstanceId` bridge is only for no-plan fallback behavior until route/pipeline planning fully owns default direct-route selection.

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
