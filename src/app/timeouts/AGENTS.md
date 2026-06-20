# AGENTS.md - Timeouts

The gateway has two cancellation levels:

```txt
Client AbortSignal
  -> total gateway AbortController
     -> attempt 1 AbortController
     -> attempt 2 AbortController
     -> attempt 3 AbortController
```

Rules:

```txt
- If the client aborts, all attempts stop and no fallback starts.
- If total timeout expires, all attempts stop and no fallback starts.
- If one attempt timeout expires, fallback may continue only when retry policy allows.
- The total gateway timeout scope is owned by the request flow above attempt execution.
- AttemptExecutor creates per-attempt timeout scopes from the total/caller parent signal.
- provider.acquire(), lease verification, and target transport all receive the attempt signal.
```

Timeout observation to outcome mapping belongs in the timeout/classification boundary, not in provider adapters or transports.
