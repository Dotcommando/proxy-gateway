# AGENTS.md - Pipeline App Collaborators

Pipeline code owns declarative policy pipeline execution and deterministic state-patch merging.

`ProxyPipelineEngine` executes registered steps by phase. It must not acquire providers, execute target transport, verify exits, parse proxy-fetch envelopes, or build service responses.

Gateway wiring runs non-empty configured pipelines after target access and after route/default selection has supplied base requirements. Custom and built-in steps must stay behind `ProxyPipelineStepRegistryPort`; missing step types return stable pipeline errors instead of falling through to no-plan provider fallback.

Selected pipeline plans win over route/default/direct plans. If all configured pipelines skip or complete without a plan, gateway wiring may fall through to the selected route/default plan or direct `ProxyGatewayOptions.plan`; it must not fall through to no-plan provider fallback while pipelines are configured.

Built-in pipeline step names belong in package enums. Requirement built-ins are available by default through the gateway's pipeline registry composition. A user-provided registry intentionally overrides a built-in when it returns a step for the same type; otherwise built-ins remain available as fallback steps.

Provider selection/ranking built-ins may only filter or reorder `ProxyDecisionState.candidates` built from enabled provider instances. They may use provider instance id, provider kind, tags, priority, weight, metadata, and injected pipeline services such as deterministic random, but must not inspect provider-specific adapter config, call provider adapters, or reintroduce a gateway-level provider-selection option.

Plan built-ins produce executable `ProxyExecutionPlan` decisions by delegating provider validation and capability checks to an injected planner service backed by `ExecutionPlanner`. They may use current candidates as provider-order constraints, but must not acquire providers, execute transports, or bypass planner rejection codes.
