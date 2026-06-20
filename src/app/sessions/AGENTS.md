# AGENTS.md - Sessions

`src/app/sessions` owns app-level sticky/session coordination.

`SessionKeyFactory` must remain deterministic and provider-agnostic. It may derive keys from structured identity requirements, gateway execution context, provider instance id, target host, and attempt index. It must not call provider adapters, target transport, DNS, GeoIP, clocks, random sources, config loaders, or external services.

Use `PROXY_IDENTITY_ISOLATION_SCOPE` for isolation scope values. Missing scope components must remain explicit in derived keys so unrelated sessions do not collapse.

Session-store persistence belongs behind `ProxySessionStorePort`. Store expiry interpretation, provider compatibility, and request-new-identity policy belong in app-level session coordination, not in provider adapters or transports.
