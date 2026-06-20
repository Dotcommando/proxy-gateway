# AGENTS.md - Outbound Ports

Outbound ports are contracts implemented by user code, provider packages, adapters, or tests. Core runtime code must not import provider packages, framework packages, GeoIP libraries, DNS intelligence packages, logger SDKs, metrics SDKs, tracing SDKs, dotenv, YAML/JSON5 parsers, or provider SDKs.

## Provider Adapter Port

Provider adapters acquire routes for one attempt. They do not execute retry, fallback, verification policy, target transport, or response building.

`ProxyAcquireInput.requirements` must stay typed as `ProxyRouteRequirements`, not widened to `Record<string, unknown>`. Preserve structured requirements such as `dns`, `geo`, `identity`, and `verification`.

`release(lease, result)` is cleanup, not policy. It receives the classified `ProxyAttemptResult`, should be called when possible for every acquired lease, and must remain best-effort. Release failures are gateway events and must not replace the real attempt outcome.

Provider adapter packages live outside the core and depend on `@echospecter/proxy-gateway` through `peerDependencies`.

## Route Model

The common route model supports:

```txt
- direct
- forward-proxy
- route-chain
- custom-transport
```

Forward proxy protocols are represented by package enums and include `http`, `https`, `socks4`, `socks5`, and `socks5h`.

Use `socks5h` and `dns.resolution: "proxy"` for Tor-like routes. Do not silently downgrade Tor-like routes to `socks5`.

The core route model may describe chains. A concrete `TargetTransportPort` may support only a subset. Transports may expose `supportsRoute(route)`; when present, the core must check it before `execute()` and fail unsupported routes with `UNSUPPORTED_ROUTE`.

Route diagnostics must never include route credentials, username/password values, tokens, proxy authorization material, or provider secrets.

`TargetTransportExecuteInput.finalUrlGuard` lets transports validate redirect/final URLs against the gateway target access policy without importing app-layer classes. It is a guard contract only; the core must not implement redirect-chain orchestration inside attempt execution.

## Provider Capabilities

Capabilities must be honest. They are used by planning and later retry/verification logic.

Geo behavior:

```txt
- guaranteed: provider may satisfy geo.country during acquire/planning;
- best-effort: mismatch should be recorded but not necessarily rejected;
- verified-after-acquire: core must verify exit when strict geo policy requires it;
- unsupported: required geo skips/rejects provider unless policy accepts best-effort.
```

`ExecutionPlanner` may mark `ProxyExecutionAttempt.verification`; it must not call verifier/DNS/GeoIP/probe/provider APIs.

## Tor-Like Providers

Tor is not a special core mode. Tor-like adapters are ordinary provider adapters.

Common requirements:

```txt
- SOCKS5H is required to avoid local DNS leaks;
- exit country may be guaranteed, preferred, best-effort, or verified after acquire;
- isolation may be controlled by socks auth, dedicated port, control plane, or provider-defined sessions;
- identity rotation may require control-plane support or a new lease;
- .onion targets may require Tor-capable route/provider/transport support.
```

Local Tor, hosted Tor SOCKS endpoints, commercial proxy providers, and static forward proxies must remain separate provider packages outside the core.

## Identity Requirements

`ProxyRouteRequirements.identity` is the provider-agnostic handoff for sticky sessions, fixed identity, per-request rotation, isolation keys, isolation scopes, and request-new-identity hints. Rotation and isolation scope values must use package enums, not ad hoc strings.

Provider adapters may interpret identity requirements according to their own capabilities, but the core route model must not contain provider-specific session syntax.

## Verifier and Intelligence Ports

`ProxyExitVerifierPort` is generic, not Tor-specific. It receives request id, lease, route, expected geo requirements, and the active attempt signal.

Real DNS, GeoIP, IP intelligence, target probing, and HTTP exit verifier implementations live outside the core package.

## Session Store Port

`ProxySessionStorePort` is an outbound persistence contract for sticky/session coordination. It must remain provider-agnostic and batch-oriented (`getMany`, `setMany`, `deleteMany`, `touchMany`).

Session records identify provider instances by provider instance id and provider kind. Store implementations should persist records; app-level session coordination owns expiry interpretation, provider compatibility checks, and request-new-identity policy.
