# AGENTS.md - @echospecter/proxy-gateway

This is the root working contract for agents and contributors. Keep it compact. Detailed rules live in nested `AGENTS.md` files near the code they govern.

`@echospecter/proxy-gateway` is a provider-agnostic proxy execution gateway for `@echospecter/proxy-fetch`. It accepts `proxy-fetch.v1` service requests, applies policy/planning/execution, executes target requests through selected routes, and returns valid `proxy-fetch.v1` response envelopes.

## Active Task Workflow

We work through a top-level markdown task file, usually named by the user, such as `PHASE_0.1.md`.

The active task file should contain the task description, decomposition, Red/Green/Verify notes, and implementation progress. After each completed step:

```txt
- mark the completed step in the active task file;
- describe what was implemented;
- reassess the next three steps;
- split or clarify any upcoming step that is too large or ambiguous;
- update nested AGENTS.md files when a new durable architecture rule appears.
```

Do not let the task file become stale. It is the local map for current phase work.

## Context Routing

Start from this root file, then load only the nested contracts relevant to the task:

```txt
- proxy-fetch wire parsing/building: src/app/envelopes/AGENTS.md
- top-level request flow and attempt execution: src/app/AGENTS.md and src/app/use-cases/AGENTS.md
- retry/fallback rules: src/app/retry/AGENTS.md
- timeout/abort rules: src/app/timeouts/AGENTS.md
- redaction/diagnostics: src/app/redaction/AGENTS.md
- target access/SSRF guard: src/app/security/AGENTS.md
- execution planning and geo capability compatibility: src/app/planning/AGENTS.md
- provider/transport/verifier ports and route contracts: src/ports/outbound/AGENTS.md
- domain matchers and route selection: src/domain/AGENTS.md
- inbound HTTP/framework wrappers: src/adapters/inbound/AGENTS.md
- outbound dependency-free adapters: src/adapters/outbound/AGENTS.md
- test strategy and compatibility fixtures: tests/AGENTS.md
```

For example:

```txt
- PHASE_0.1 step 23 retry/fallback/verification:
  read src/app/use-cases, src/app/retry, src/app/timeouts, src/app/redaction, src/ports/outbound, tests.
- PHASE_0.1 step 24 full direct-route flow:
  add src/app/envelopes, src/app/security, src/app/planning, src/domain.
- PHASE_0.1 step 25 wrapper contract suite:
  read src/adapters/inbound, src/app/envelopes, tests.
```

## Hard Rules

The runtime package must have zero external dependencies.

Allowed in runtime code:

```txt
- Node.js built-in modules;
- Web Fetch API types and runtime objects available in supported Node.js versions;
- internal code written inside this package.
```

Not allowed in runtime code:

```txt
- dotenv or env/config loaders;
- minimatch/micromatch/path-to-regexp;
- express/fastify/@nestjs/*;
- maxmind/geoip libraries;
- socks/proxy-agent packages;
- yaml/json5 config parsers;
- logger/metrics/tracing SDKs;
- provider SDKs.
```

The core must not read `.env`, `process.env`, global variables, global config files, or framework globals. All configuration is passed explicitly through function arguments. Config loading belongs to user applications or separate helper packages.

The package must use hexagonal architecture. The gateway core must not depend on provider packages, framework packages, Tor integrations, GeoIP/DNS intelligence packages, dotenv, or config-loading packages.

## Positioning

The gateway is a policy-driven execution engine.

It is not:

```txt
- a proxy provider adapter package;
- a Tor integration package;
- a GeoIP/DNS intelligence package;
- a web framework package;
- a replacement for native fetch;
- a scraping framework;
- a config loader;
- an environment variable loader.
```

Generic flow:

```txt
proxy-fetch client
  -> proxy-fetch.v1 HTTP request
  -> inbound adapter
  -> proxy-gateway application core
  -> policy/planning/execution
  -> provider adapter port
  -> optional lease verification
  -> target transport
  -> proxy-fetch.v1 HTTP response
```

## Source Layout

Required source tree:

```txt
src/
  adapters/
    inbound/
    outbound/
  app/
    buffering/
    classification/
    envelopes/
    normalization/
    pipeline/
    planning/
    redaction/
    retry/
    security/
    timeouts/
    types/
    use-cases/
  domain/
    matching/
    routing/
  ports/
    inbound/
    outbound/
  constants.ts
```

Ownership summary:

```txt
- src/ports/inbound: inbound core contracts, such as ProxyGateway.
- src/ports/outbound: outbound ports implemented by user code, adapters, or tests.
- src/adapters/inbound: thin inbound adapters around ProxyGateway.handle().
- src/adapters/outbound: dependency-free outbound adapters that can live in the core package.
- src/app: application-layer orchestration and collaborators.
- src/domain: provider-agnostic models, value objects, matching, routing, and pure rules.
- src/constants.ts: package-wide constants and enums shared across layers.
```

Use-cases belong in `src/app/use-cases`. Domain behavior belongs in `src/domain` or a narrow domain/app module, not a generic `src/utils` bucket.

## Import Boundaries

```txt
- src/adapters must not have a barrel file.
- src/adapters/inbound must have its own barrel file.
- src/adapters/outbound must have its own barrel file.
- src/ports must not have a barrel file.
- src/ports/inbound must have its own barrel file.
- src/ports/outbound must have its own barrel file.
```

The import section of any file should make dependency direction visible at a glance. Import from `src/adapters/inbound`, `src/adapters/outbound`, `src/ports/inbound`, or `src/ports/outbound`, not ambiguous top-level barrels.

## Constants And Enums

Package-wide constants and enums belong in `src/constants.ts`.

Wire compatibility constants copied from `@echospecter/proxy-fetch/src/constants.ts` must keep the same names and values unless the client package contract changes. `WIRE_PROTOCOL_VERSION` must keep the same name and value.

Do not copy env/config-loading constants from `@echospecter/proxy-fetch` into the gateway runtime.

When a field has a closed set of string values, define an enum instead of an inline string-literal union. Use package-wide enums in `src/constants.ts` when values cross module boundaries. Architecture examples may show raw strings for readability; implementation code must use the corresponding enum.

Target access denied address ranges must be represented as CIDR/range constants in `src/constants.ts`, not individual blocked URL strings.

## Public API Shape

The core gateway operates on Web Fetch API `Request` and `Response` objects:

```ts
export interface ProxyGateway {
  handle(request: Request): Promise<Response>;
}

export function createProxyGateway(options: ProxyGatewayOptions): ProxyGateway;
```

Framework integrations must be thin wrappers around the same `ProxyGateway.handle()` method. Do not duplicate gateway logic across Node HTTP, Express, Fastify, and NestJS.

## Core Responsibilities

The gateway core must:

```txt
- accept proxy-fetch.v1 service requests;
- parse JSON, JSON base64, and multipart service request formats supported by proxy-fetch;
- build valid JSON and multipart proxy-fetch.v1 service responses;
- normalize target requests into provider-agnostic internal models;
- preserve serialized Fetch metadata where applicable;
- enforce total request timeout and per-attempt timeout;
- propagate caller abort/cancellation;
- execute policy/planning/attempt execution through app collaborators;
- support request facts enrichment through ports;
- select provider instances using provider-agnostic policy;
- support multiple provider instances and multiple instances of the same provider kind;
- support retry/fallback/weighted distribution/priority routing;
- support sticky sessions and isolation tokens when implemented;
- support HTTP, HTTPS, SOCKS4, SOCKS5, and SOCKS5H in the common route model;
- support optional lease verification through ports;
- enforce target access restrictions to reduce SSRF risk;
- classify target/proxy/gateway failures;
- return target HTTP statuses as normal target responses unless policy explicitly retries them;
- emit safe events/diagnostics without leaking secrets;
- return valid proxy-fetch.v1 response/error envelopes.
```

The gateway core must not:

```txt
- hardcode any proxy provider;
- know Bright Data/Oxylabs/SOAX/Webshare syntax;
- know Tor ControlPort commands;
- manage local Tor processes;
- ship provider integrations inside the core package;
- ship GeoIP databases or GeoIP vendor integrations inside the core package;
- perform DNS intelligence by itself;
- depend on Express, Fastify, or NestJS in the core;
- retry unsafe methods by default;
- retry target HTTP statuses by default;
- log target authorization headers, cookies, proxy credentials, or provider passwords;
- allow localhost/private/link-local targets by default;
- buffer unlimited request or response streams.
```

## Testing Expectations

Phase work is TDD:

```txt
1. Write or update failing tests.
2. Implement the smallest useful change.
3. Refactor with tests green.
4. Update the active task markdown file.
5. Reassess the next three steps.
```

Run the relevant focused tests during development. Before finishing a step that changes behavior or public contracts, run:

```sh
npm run typecheck
npm run lint
npm test
npm run pack:check
```

Use `tests/AGENTS.md` for detailed testing and compatibility guidance.

## Coding Rules

Use the repo's existing patterns and narrowest reasonable module ownership. Avoid unrelated refactors.

Use structured APIs/parsers instead of ad hoc string manipulation when reasonable.

Add abstractions only when they remove real complexity, reduce meaningful duplication, or match an established local pattern.

If required context is not available in the workspace or current conversation, ask for the file or details before guessing. If the file exists in the workspace, read it directly.

New code must not use `as`, `any`, the `object` type, or double assertions such as `as unknown as`. Prefer precise narrowing, discriminated unions/enums, generics, and explicit interfaces.

Prefer interfaces over type aliases for object shapes. For newly introduced internal object-shape interfaces, use the `I` prefix. Do not rename existing or documented public contracts only to add the prefix; public API and port names that are already established, such as `ProxyGatewayOptions`, should stay stable unless the active task explicitly changes the public contract.

When a field has a closed set of string values, use an enum in `src/constants.ts` instead of a string-literal union.

When building objects with optional properties, prefer conditional object spread over repeatedly mutating an initially empty object. Preserve semantics for valid falsy values: use explicit checks such as `value !== undefined` when `0`, `false`, or `""` are valid.

Prefer concise returns and ternaries when they make function completion clearer. Do not force a ternary when it makes control flow harder to read.

Do not make cosmetic edits or reformat existing code just to match a different personal style. Keep diffs minimal and scoped to the task.

Do not remove user-written comments. Do not add new code comments unless the task explicitly needs one or the code would otherwise be unusually hard to understand.

Do not list unchanged files in summaries.

CRUD-style services should be batch-oriented by default and work with arrays. Single-item methods are acceptable for high-level user-facing operations that are naturally handled one at a time.

Default to ASCII in files unless the file already uses non-ASCII or the content requires it.

Do not use destructive git commands unless the user explicitly requests them.
