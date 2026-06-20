# AGENTS.md - Outbound Adapters

Outbound adapters in the core package must remain dependency-free and provider-agnostic.

Provider integrations, Tor integrations, GeoIP/DNS enrichers, HTTP exit verifiers, logger SDK emitters, telemetry SDK emitters, and config/secret-manager integrations live outside the core package unless explicitly introduced as separate helper packages.

Core outbound adapters may implement small dependency-free test or utility adapters only when they do not violate zero runtime dependencies.

The in-memory proxy session store is allowed here as a dependency-free utility adapter. It must implement `ProxySessionStorePort` without provider-specific behavior, config loading, timers, or external persistence dependencies.

The memory session store should persist caller-provided `expiresAt` values without interpreting expiry. It must avoid leaking stored records through caller-owned or returned object references.
