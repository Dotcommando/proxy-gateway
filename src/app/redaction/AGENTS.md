# AGENTS.md - Redaction

Redaction is application-layer safety for diagnostics, service errors, logs, telemetry events, route auth, sensitive headers, URLs, and secret-like metadata.

Never log or expose:

```txt
- target authorization headers;
- cookies and set-cookie values;
- proxy credentials;
- provider passwords or tokens;
- API keys;
- secret-like metadata values.
```

Route diagnostics may expose route kind/protocol/host/port/DNS/auth mode, but never username/password/token values.

Verification-sensitive diagnostics must go through `RedactionService`.

Service error `details` may include diagnostics only after `RedactionService` has removed sensitive headers, URL credentials/query secrets, route credentials, and secret-like metadata.

Redaction must not mutate successful target response headers or bodies. It applies to diagnostics and service-level failure information.
