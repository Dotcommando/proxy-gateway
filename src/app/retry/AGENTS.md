# AGENTS.md - Retry

Default behavior must be safe.

```txt
- Network errors are retryable only if policy allows retry.
- Proxy connection errors are retryable only if policy allows retry.
- Proxy auth errors are not retryable for the same provider instance.
- Caller abort is not retryable.
- Total gateway timeout is not retryable.
- Target HTTP statuses are returned by default.
- HTTP status retry must be explicitly configured by route policy.
- Unsafe methods are not retried by default.
- Geo mismatch is retryable only if policy explicitly says so.
```

`RetryDecider` consumes classified `PROXY_ATTEMPT_RESULT_OUTCOME` values, retry policy, body replayability, unsafe-method policy, and planned fallback position. It must not classify raw errors.

Same-attempt retry and fallback traversal must be driven by `RetryDecider`. Executors may manage loop state but must not add ad hoc retry/fallback rules.

Recommended unsafe-method defaults:

```txt
unsafeMethods = ["POST", "PUT", "PATCH", "DELETE"]
retryUnsafeMethods = false
requireIdempotencyKeyForUnsafeRetries = true
```
