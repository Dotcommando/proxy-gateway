# AGENTS.md - Planning

`ExecutionPlanner` turns route/pipeline plan config into provider-instance execution attempts.

It owns provider capability compatibility checks and provider-instance attempt ordering. It must not call `provider.acquire()`, target transport, verifier ports, DNS, GeoIP, probe endpoints, or provider-specific APIs.

Geo behavior:

```txt
- geo.mode guaranteed may satisfy required country during planning when countries match or countries are "*";
- geo.mode unsupported must be skipped or rejected for required geo requirements;
- geo.mode best-effort must not satisfy strict required geo unless policy explicitly accepts best-effort;
- geo.mode verified-after-acquire may remain plannable only when exit verification is available and the attempt is marked for verification.
```

`ExecutionPlanner` may mark a `ProxyExecutionAttempt` as requiring exit verification through `attempt.verification`. Lease verification itself belongs after `provider.acquire()` and before target transport execution.

Planning must preserve structured requirements on generated attempts so later retry/verifier logic can reason about them.
