# AGENTS.md - App Layer

The app layer coordinates gateway use-cases and ports. It is not the domain model and it must not depend on framework, provider, config-loading, GeoIP, DNS intelligence, logger SDK, metrics SDK, tracing SDK, or provider SDK packages.

## Ownership

```txt
- buffering: bounded request/response body buffering and replayability decisions.
- classification: mapping observed target/proxy/gateway failures into stable outcomes, service error codes, retryability, retry-condition hints, and redacted diagnostics.
- envelopes: proxy-fetch.v1 wire parsers/builders and service response format negotiation.
- normalization: conversion from parsed wire shapes into internal gateway request models.
- pipeline: declarative policy pipeline execution and deterministic state-patch merging.
- planning: provider capability filtering and provider-instance attempt ordering.
- redaction: safe diagnostics for headers, URLs, metadata, routes, logs, telemetry, and service errors.
- retry: retry/fallback decisions over classified outcomes, retry policy, replayability, and attempt position.
- security: target access policy and SSRF risk checks; no DNS/GeoIP intelligence by itself.
- timeouts: total-request and per-attempt timeout/abort orchestration.
- types: app-layer composition/config/result types only.
- use-cases: gateway orchestration, attempt execution, verification/retry coordination, and request-flow coordination.
```

Keep app-layer collaborators narrow. Do not put domain models, port contracts, wire envelopes, or miscellaneous "just interfaces" into `src/app/types`.

## Boundaries

`HandleProxyFetchRequestUseCase` owns the proxy-fetch request flow: parse the service envelope, normalize the target, enforce target access, select or obtain an execution plan, call attempt execution, and build the proxy-fetch service response envelope.

`HandleProxyFetchRequestUseCase` must not grow provider acquire/release, target transport, retry-loop, or lease-verification details inline when those details belong to dedicated app collaborators.

Configured gateway plans must flow through `ExecutionPlanner` before attempt execution. Temporary direct provider selection may remain only as no-plan compatibility behavior.

`AttemptExecutor` belongs in `src/app/use-cases`. It consumes a `ProxyExecutionPlan`, acquires provider leases, checks route support, executes target transport, buffers target responses, applies timeout scopes, classifies outcomes, and releases leases. It returns app-level execution results, not Web `Response` objects.

`AttemptExecutor` must not parse proxy-fetch envelopes, perform route matching, load configuration, perform DNS/GeoIP intelligence, know provider-specific syntax, or build service response envelopes.

`ExecutionPlanner` may mark a `ProxyExecutionAttempt` as requiring exit verification through `attempt.verification`, but it must not call `ProxyExitVerifierPort`, DNS, GeoIP, probe endpoints, or provider-specific APIs.

`ResultClassifier` is the single owner of raw failure to outcome/code/retryability mapping. Executors and use-cases must not duplicate that mapping except for a defensive fallback when a classified failure has no service error.

`RetryDecider` owns retry/fallback decisions. Executors may manage loop state, acquired leases, attempt indexes, and fallback traversal, but must not add ad hoc retry/fallback rules outside `RetryDecider`.

## Gateway Events

Provider `release()` failures and similar non-masking operational failures should first be represented as `GatewayEvent`s. When logger/telemetry ports are available, those events may be emitted through them, but they must not replace the target response or service error for the actual attempt outcome.
