# AGENTS.md - Pipeline App Collaborators

Pipeline code owns declarative policy pipeline execution and deterministic state-patch merging.

`ProxyPipelineEngine` executes registered steps by phase. It must not acquire providers, execute target transport, verify exits, parse proxy-fetch envelopes, or build service responses.

Gateway wiring runs non-empty configured pipelines after target access and before route/default/direct planning. Custom and built-in steps must stay behind `ProxyPipelineStepRegistryPort`; missing step types return stable pipeline errors instead of falling through to no-plan provider fallback.

Built-in pipeline step names belong in package enums. Requirement built-ins are available by default through the gateway's pipeline registry composition. A user-provided registry intentionally overrides a built-in when it returns a step for the same type; otherwise built-ins remain available as fallback steps.
