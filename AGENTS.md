# AGENTS.md - @echospecter/proxy-gateway

This file is the working architectural contract for agents and contributors working on `@echospecter/proxy-gateway`.

`@echospecter/proxy-gateway` is a provider-agnostic proxy execution gateway for `@echospecter/proxy-fetch`. It accepts `proxy-fetch.v1` service requests, applies policy pipelines, enriches request facts through optional ports, selects one or more proxy provider instances, executes the target request through the selected route, and returns a valid `proxy-fetch.v1` response envelope.

The package must use hexagonal architecture. The gateway core must not depend on Express, Fastify, NestJS, Bright Data, Oxylabs, Webshare, Tor, MaxMind, IPinfo, dotenv, or any other framework/provider/config-loading package.

## 1. Hard rule: zero runtime dependencies

The runtime package must have zero external dependencies.

Allowed:

```txt
- Node.js built-in modules;
- Web Fetch API types and runtime objects available in supported Node.js versions;
- internal code written inside this package;
- devDependencies for tests/build/lint only.
```

Not allowed in runtime code:

```txt
- dotenv;
- minimatch/micromatch/path-to-regexp;
- express/fastify/@nestjs/*;
- maxmind/geoip libraries;
- socks/proxy-agent packages;
- yaml/json5 config parsers;
- logger/metrics/tracing SDKs;
- provider SDKs.
```

The core must not read `.env`, `process.env`, global variables, global config files, or framework globals. All configuration must be passed explicitly through function arguments. If a user wants `.env`, YAML, JSON5, secret-manager interpolation, or process-level config, that belongs to the user's application or a separate helper package.

## 2. Core positioning

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
  -> policy pipeline
  -> request facts enrichment ports
  -> provider-agnostic execution plan
  -> provider adapter port
  -> optional lease verification
  -> target transport
  -> proxy-fetch.v1 HTTP response
```

## 3. Hexagonal architecture

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

Expected ownership:

```txt
- src/ports/inbound: inbound core contracts, such as ProxyGateway.
- src/ports/outbound: outbound ports implemented by user code, adapters, or tests.
- src/adapters/inbound: thin inbound adapters that translate external HTTP/framework shapes into ProxyGateway.handle().
- src/adapters/outbound: dependency-free outbound adapters that can live in the core package.
- src/app: application-layer orchestration code that is not itself a domain concept.
- src/app/buffering: request/response body buffering policy and bounded buffering mechanics.
- src/app/classification: application-layer mapping from observed attempt results/errors into stable attempt outcomes, retry conditions, service error codes, and safe diagnostics.
- src/app/envelopes: proxy-fetch wire envelope parsers/builders. "Envelope" means the service wire wrapper around target request/response data, not a domain model.
- src/app/normalization: conversion from parsed wire/request shapes into internal gateway models.
- src/app/pipeline: application-layer policy pipeline orchestration and controlled state patch merging.
- src/app/planning: application-layer execution planning, provider capability filtering, and provider-instance attempt ordering.
- src/app/redaction: application-layer redaction helpers/services for diagnostics, service errors, logs, telemetry events, route auth, sensitive headers, and secret-like metadata.
- src/app/retry: application-layer retry decisions over classified attempt outcomes, request replayability, safety policy, and planned fallback position.
- src/app/security: application-layer target access policy enforcement and SSRF risk checks that do not perform DNS/GeoIP intelligence by themselves.
- src/app/timeouts: application-layer timeout and abort orchestration, including total-request and per-attempt cancellation controllers.
- src/app/types: app-layer composition, configuration, and result types only.
- src/app/use-cases: application use-cases, including gateway orchestration, parsing/building flow, planning, attempt execution, retry, timeout, and policy pipeline coordination.
- src/domain: provider-agnostic domain models, value objects, classification types, route models, matching primitives, and pure domain rules.
- src/domain/matching: pure matching primitives used by route and policy decisions, such as dependency-free glob matching.
- src/domain/routing: pure route matching and route selection rules, including priority ordering, exclude handling, and default-route fallback.
- src/constants.ts: package-wide constants and enums shared across layers.
```

Use-cases belong in `src/app/use-cases`. They coordinate domain objects and ports. `src/domain` stays focused on pure concepts and rules.

`HandleProxyFetchRequestUseCase` owns the proxy-fetch request flow: parse the service envelope, normalize the target, enforce target access, select or obtain an execution plan, call attempt execution, and build the proxy-fetch service response envelope. It must not grow provider acquire/release, target transport, retry-loop, or lease-verification details inline when those details belong to dedicated app collaborators.

`AttemptExecutor` belongs in `src/app/use-cases` because it coordinates app-layer ports and collaborators. It consumes a `ProxyExecutionPlan`, acquires provider leases, checks route support, executes the target transport, buffers target responses, applies timeout scopes, classifies outcomes, and releases leases. It must return app-layer execution results, not Web `Response` objects; envelope building stays in `HandleProxyFetchRequestUseCase`.

`AttemptExecutor` must not parse proxy-fetch envelopes, perform route matching, load configuration, perform DNS/GeoIP intelligence, know provider-specific syntax, or build service response envelopes.

Do not create a generic `src/utils` bucket for domain behavior. If a helper represents a gateway concept or rule, place it in the narrow domain/app module that owns that concept, such as `src/domain/matching`.

`src/app/types` may have a barrel file. Keep it narrow: only app-layer composition/config/result types belong there. Do not put domain models, port contracts, request/response envelopes, or miscellaneous "just interfaces" there. If this folder stays small, prefer keeping those app-level types directly in `src/app/types/index.ts` instead of creating one tiny file per type.

Package-wide constants and enums belong in `src/constants.ts`. Wire compatibility constants copied from `@echospecter/proxy-fetch/src/constants.ts` must keep the same names and values unless the client package contract changes. Serializer constants required to parse or build the `proxy-fetch.v1` wire shape may also live there. Do not copy env/config-loading constants such as `PROXY_FETCH_SERVICE_URL_ENV` or `PROXY_FETCH_DEFAULT_TIMEOUT_MS_ENV` into the gateway core runtime, because the core must not read env. `WIRE_PROTOCOL_VERSION` must keep the same name as the corresponding constant in `@echospecter/proxy-fetch`.

Target access denied address ranges must be represented as CIDR/range constants in `src/constants.ts`, not as individual blocked URL strings. Examples include `127.0.0.0/8`, `192.168.0.0/16`, `::1/128`, `fc00::/7`, and other loopback/private/link-local/multicast/unspecified ranges.

When a field has a closed set of string values, define an enum instead of an inline string-literal union. Use package-wide enums in `src/constants.ts` when the values cross module boundaries. Example: prefer `export enum STRING_EXAMPLE { STRING_1 = "string1", STRING_2 = "string2" }` over `"string1" | "string2"`. Architecture examples in this document may show raw string values for readability; implementation code must still use the corresponding package enum.

Import boundary rule:

```txt
- src/adapters must not have a barrel file.
- src/adapters/inbound must have its own barrel file.
- src/adapters/outbound must have its own barrel file.
- src/ports must not have a barrel file.
- src/ports/inbound must have its own barrel file.
- src/ports/outbound must have its own barrel file.
```

The import section of any file should make the dependency direction visible at a glance. Code must import from `src/adapters/inbound`, `src/adapters/outbound`, `src/ports/inbound`, or `src/ports/outbound` instead of importing through ambiguous top-level `src/adapters` or `src/ports` barrels.

Inbound adapters:

```txt
- Web Fetch API handler
- Node HTTP handler
- Express middleware
- Fastify plugin
- NestJS controller/module helper
```

Application core:

```txt
- HandleProxyFetchRequestUseCase
- ProxyFetchEnvelopeParser
- ProxyFetchEnvelopeBuilder
- ProxyPipelineEngine
- ExecutionPlanner
- AttemptExecutor
- ResultClassifier
- RetryDecider
- TimeoutController
- BodyBufferManager
- RouteMatcher
- SessionManager
- TargetAccessGuard
- RedactionService
- LeaseVerificationService
```

Outbound ports:

```txt
- ProxyProviderAdapter
- TargetTransportPort
- ProxyRoutingPolicy
- ProxyPipelineStep
- DnsResolverPort
- GeoIpResolverPort
- TargetIntelligencePort
- ProxyExitVerifierPort
- ProxySessionStorePort
- GatewayLoggerPort
- GatewayTelemetryPort
- SecretResolverPort
- RateLimiterPort
- ClockPort
- RandomPort
```

Provider adapter packages must live outside the core:

```txt
@echospecter/proxy-gateway-provider-bright-data
@echospecter/proxy-gateway-provider-oxylabs
@echospecter/proxy-gateway-provider-decodo
@echospecter/proxy-gateway-provider-netnut
@echospecter/proxy-gateway-provider-soax
@echospecter/proxy-gateway-provider-iproyal
@echospecter/proxy-gateway-provider-webshare
@echospecter/proxy-gateway-provider-infatica
@echospecter/proxy-gateway-provider-rayobyte
@echospecter/proxy-gateway-provider-dataimpulse
@echospecter/proxy-gateway-provider-tor-local
@echospecter/proxy-gateway-provider-tor-socks-endpoint
@echospecter/proxy-gateway-provider-static-forward-proxy
```

Provider packages depend on `@echospecter/proxy-gateway` through `peerDependencies`. The core package must never import provider packages.

Enricher/verifier/probe packages must also live outside the core:

```txt
@echospecter/proxy-gateway-enricher-dns-node
@echospecter/proxy-gateway-enricher-geoip-maxmind
@echospecter/proxy-gateway-enricher-ipinfo
@echospecter/proxy-gateway-exit-verifier-http
@echospecter/proxy-gateway-probe-target
```

## 4. What this package does

The gateway core must:

```txt
- accept proxy-fetch.v1 service requests;
- parse JSON service envelopes;
- parse multipart service requests with meta and binary body parts;
- parse JSON Base64 fallback bodies;
- validate request and response envelopes;
- normalize the target request into an internal provider-agnostic model;
- preserve Fetch metadata serialized by proxy-fetch;
- enforce total request timeout;
- enforce per-attempt timeout;
- propagate caller abort/cancellation;
- create per-attempt AbortControllers;
- execute policy pipelines;
- support request facts enrichment through ports;
- select provider instances using provider-agnostic policy;
- support multiple provider instances and multiple instances of the same provider kind;
- support retry/fallback/weighted distribution/priority routing;
- support sticky sessions and isolation tokens;
- support HTTP, HTTPS, SOCKS4, SOCKS5, and SOCKS5H in the common route model;
- support optional lease verification, including exit IP/country verification;
- support target access restrictions to reduce SSRF risk;
- classify target/proxy/gateway failures;
- return target HTTP statuses as normal responses unless policy explicitly retries them;
- emit logger and telemetry events without leaking secrets;
- return valid proxy-fetch.v1 response/error envelopes.
```

## 5. What this package does not do

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
- read .env, process.env, or globals;
- retry unsafe methods by default;
- retry target HTTP statuses by default;
- log target authorization headers, cookies, proxy credentials, or provider passwords;
- allow localhost/private/link-local targets by default;
- buffer unlimited request or response streams;
- pretend to be byte-for-byte identical to local fetch transport behavior.
```

## 6. Compatibility with @echospecter/proxy-fetch

The gateway must support exactly the service contract and body formats supported by `@echospecter/proxy-fetch`.

Supported Fetch input bodies from the client side:

```txt
- no body;
- string;
- URLSearchParams;
- Blob;
- ArrayBuffer;
- typed arrays;
- FormData;
- ReadableStream with duplex: "half";
- existing Request objects.
```

Serialized service request formats:

```txt
- JSON envelope with request.body: null;
- JSON envelope with request.body.kind: "text";
- JSON envelope with request.body.kind: "base64" and request.body.data as explicit binary fallback;
- multipart/form-data request with part "meta" and raw binary part "body";
- multipart meta request.body.kind: "binary" and request.body.partName: "body";
- default binary body transport is multipart;
- json-base64 is an explicit binary fallback transport;
- ReadableStream bodies are sent as streaming multipart with a proxy-fetch-stream-* boundary, meta part first, and body part second;
- text-like fallback bodies are detected by content type: text/*, application/json, application/x-www-form-urlencoded, application/xml, and application/graphql;
- options.timeoutMs serialized at the service envelope level.
```

Service context must preserve `useCase`, `flowKey`, `consistency`, and `metadata`.

Serialized Fetch metadata that must be preserved and enforced where applicable:

```txt
- mode;
- credentials;
- cache;
- redirect;
- referrer;
- referrerPolicy;
- integrity;
- keepalive;
- duplex.
```

Supported service response formats:

```txt
- JSON envelope with text response body;
- JSON envelope with null body;
- JSON envelope with base64 body using body.data;
- multipart/form-data response with part "meta" and raw binary part "body";
- multipart meta response.body.kind: "binary" and response.body.partName: "body";
- response.url, response.redirected, response.type, response.status, response.statusText, response.headers, and response.body;
- null-body semantics for 204, 205, and 304;
- special response shapes for type: "error", "opaque", and "opaqueredirect".
```

Target HTTP errors are not service errors. A target 404, 403, 429, 500, or 503 is returned as `ok: true` unless the route policy explicitly classifies that status as retryable for that route. Service-level failures use `ok: false`.

## 7. Public API shape

The core gateway operates on Web Fetch API `Request` and `Response` objects.

```ts
export interface ProxyGateway {
  handle(request: Request): Promise<Response>;
}

export interface ProxyGatewayOptions {
  providers: ProxyProviderInstance[];
  pipelines?: ProxyPipelineConfig[];
  policy?: ProxyRoutingPolicy;

  services?: ProxyGatewayServices;
  stepRegistry?: ProxyPipelineStepRegistry;

  transport?: TargetTransportPort;
  targetAccess?: TargetAccessPolicy;
  retrySafety?: RetrySafetyPolicy;
  bodyBuffering?: BodyBufferingPolicy;
  responseStreaming?: ResponseStreamingPolicy;
  redaction?: RedactionPolicy;
  limits?: GatewayLimits;
  providerSelection?: ProviderSelectionConfig; // temporary v0.1 direct-route selection hook until planner/pipeline owns selection

  sessionStore?: ProxySessionStorePort;
  secretResolver?: SecretResolverPort;
  rateLimiter?: RateLimiterPort;
  logger?: GatewayLoggerPort;
  telemetry?: GatewayTelemetryPort;
  clock?: ClockPort;
  random?: RandomPort;
}

export interface ProviderSelectionConfig {
  providerInstanceId?: string;
}

export function createProxyGateway(options: ProxyGatewayOptions): ProxyGateway;
```

`providerSelection.providerInstanceId` is a temporary v0.1 bridge for direct-route vertical slices. It must not become a parallel routing DSL. Later planner and pipeline work should replace it with normal execution-plan provider references.

Framework integrations must be thin wrappers around the same `ProxyGateway.handle()` method.

```ts
export function createNodeHttpHandler(gateway: ProxyGateway): NodeHttpHandler;
export function createExpressMiddleware(gateway: ProxyGateway): ExpressMiddleware;
export function createFastifyPlugin(gateway: ProxyGateway): FastifyPluginCallback;
export function createNestProxyGatewayModule(options: NestProxyGatewayModuleOptions): DynamicModule;
```

Do not duplicate gateway logic across Express, Fastify, and NestJS.

## 8. Provider adapter port

All provider adapter packages must implement this port.

```ts
export interface ProxyProviderInstance {
  id: string;
  adapter: ProxyProviderAdapter;
  enabled?: boolean;
  weight?: number;
  priority?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ProxyProviderAdapter {
  readonly kind: string;

  getCapabilities(): ProxyProviderCapabilities | Promise<ProxyProviderCapabilities>;

  acquire(input: ProxyAcquireInput): Promise<ProxyLease>;

  release?(lease: ProxyLease, result: ProxyAttemptResult): void | Promise<void>;
}

export interface ProxyAcquireInput {
  requestId: string;
  providerInstanceId: string;
  attempt: ProxyAttemptContext;
  target: GatewayTargetRequest;
  requirements: ProxyRouteRequirements;
  context: GatewayExecutionContext;
  signal: AbortSignal;
}
```

The adapter does not execute retry/fallback policy. It only acquires a route for one attempt.

`ProxyAcquireInput.requirements` must stay typed as `ProxyRouteRequirements`, not widened to `Record<string, unknown>`. Planning and execution code must preserve structured requirements such as `dns`, `geo`, and `verification` so later verifier/retry logic can reason about them without provider-specific parsing.

`release()` is cleanup, not policy. It receives the classified `ProxyAttemptResult`, should be called when possible for every acquired lease, and must remain best-effort. Release failures must be recorded as gateway events and may later be emitted through logger/telemetry ports, but they must not replace the target response or service error for the actual attempt outcome.

When implementing route contracts in code, represent closed route kinds, hop kinds, protocols, DNS modes, and auth modes with package enums in `src/constants.ts`. Older architecture examples may show string literals for readability; the enum rule in section 3 controls implementation.

```ts
export interface ProxyLease {
  id: string;
  providerInstanceId: string;
  providerKind: string;
  route: ProxyRoute;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
  verification?: ProxyExitVerification;
}

export type ProxyRoute =
  | ForwardProxyRoute
  | RouteChain
  | DirectRoute
  | CustomTransportRoute;

export interface ForwardProxyRoute {
  kind: "forward-proxy";
  protocol: ProxyProtocol;
  host: string;
  port: number;
  auth?: ProxyRouteAuth;
  headers?: Array<[string, string]>;
  dns?: ProxyDnsMode;
  metadata?: Record<string, unknown>;
}

export interface ProxyRouteAuth {
  mode: "none" | "username-password" | "token" | "ip-whitelist";
  username?: string;
  password?: string;
  token?: string;
}

export interface RouteChain {
  kind: "route-chain";
  hops: ProxyRouteHop[];
  dns?: ProxyDnsMode;
  metadata?: Record<string, unknown>;
}

export type ProxyRouteHop = ForwardProxyHop | TorClientHop | CustomTransportHop;

export interface ForwardProxyHop {
  kind: "forward-proxy-hop";
  protocol: ProxyProtocol;
  host: string;
  port: number;
  auth?: ProxyRouteAuth;
  dns?: ProxyDnsMode;
  metadata?: Record<string, unknown>;
}

export interface TorClientHop {
  kind: "tor-client-hop";
  socksHost: string;
  socksPort: number;
  socksProtocol: "socks5h";
  auth?: ProxyRouteAuth;
  isolation?: ProxyIsolationOptions;
  control?: ProxyControlPlaneHint;
  dns: "proxy";
  metadata?: Record<string, unknown>;
}

export interface CustomTransportHop {
  kind: "custom-transport-hop";
  metadata?: Record<string, unknown>;
}

export interface DirectRoute {
  kind: "direct";
}

export interface CustomTransportRoute {
  kind: "custom-transport";
  execute(input: CustomTransportExecuteInput): Promise<GatewayTargetResponse>;
}
```

`route-chain` is reserved for cases such as gateway -> Tor SOCKS5H -> target, gateway -> remote SOCKS5 endpoint that itself routes through Tor -> target, gateway -> upstream proxy -> Tor process configured with upstream proxy -> target, or gateway -> Tor -> downstream proxy -> target if a target transport supports nested proxy chaining.

The core route model may describe chains. A concrete `TargetTransportPort` may support only a subset of route types. Transports may expose `supportsRoute(route)`; when present, the core must check it before `execute()` and fail unsupported routes with a clear `UNSUPPORTED_ROUTE` error.

Route diagnostics must never include route credentials, username/password values, tokens, proxy authorization material, or provider secrets. A route diagnostic helper may expose route kind/protocol/host/port/DNS/auth mode for debugging, but full log/error/telemetry redaction still belongs to `RedactionService`.

## 9. Tor-related provider contracts

Tor is not a special mode in the gateway core. Tor-like adapters are ordinary provider adapters.

The common contract must support Tor-like providers because their important traits are shared with other private/proxy-chain adapters:

```txt
- SOCKS5H is required to avoid local DNS resolution;
- exit country may be guaranteed, preferred, best-effort, or verifiable only after acquiring a route;
- route isolation may be controlled by username/password, dedicated port, control plane, or provider-specific session tokens;
- identity rotation may require control-plane support or a new lease;
- exit IP verification may be required before the target request;
- .onion targets may require a Tor-capable route.
```

### 9.1 Local Tor provider

Possible adapter package:

```txt
@echospecter/proxy-gateway-provider-tor-local
```

Provider-specific options belong only to that adapter package, not to the core:

```ts
export interface TorLocalProviderOptions {
  socksHost?: string; // default: "127.0.0.1"
  socksPort?: number; // common values: 9050 for tor daemon, 9150 for Tor Browser
  controlHost?: string;
  controlPort?: number;
  controlPassword?: string;
  isolateBySocksAuth?: boolean;
  newCircuitOnMismatch?: boolean;
  exitCountryConfigMode?: "none" | "torrc" | "control-port";
}
```

The adapter returns a normal route:

```ts
{
  kind: "forward-proxy",
  protocol: "socks5h",
  host: "127.0.0.1",
  port: 9050,
  auth: {
    mode: "username-password",
    username: "isolation-token",
    password: "x"
  },
  dns: "proxy"
}
```

Capabilities must be honest:

```ts
const torLocalCapabilities: ProxyProviderCapabilities = {
  networkTypes: ["tor"],
  protocols: ["socks5h"],
  dns: {
    modes: ["proxy"],
    remoteRequired: true,
  },
  geo: {
    mode: "verified-after-acquire",
    countries: "*",
    countrySelection: "external-or-provider-config",
    regionLevel: false,
    cityLevel: false,
    postalCodeLevel: false,
    asnLevel: false,
  },
  identity: {
    rotation: ["per-request", "sticky"],
    isolation: ["socks-auth", "dedicated-port", "control-plane"],
  },
  auth: {
    modes: ["none", "username-password"],
  },
  transport: {
    forwardProxy: true,
    routeChain: false,
    customTransport: false,
    streamingRequestBody: true,
    streamingResponseBody: true,
    remoteDns: true,
    onionTargets: true,
  },
};
```

### 9.2 Private/hosted Tor SOCKS endpoint provider

A private hosted Tor proxy, Docker container, CI action, or remote service may expose a SOCKS5/SOCKS5H endpoint that routes through Tor internally.

Possible adapter package:

```txt
@echospecter/proxy-gateway-provider-tor-socks-endpoint
```

Provider-specific options:

```ts
export interface TorSocksEndpointProviderOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  requireSocks5h?: boolean;
  supportsPerRequestIsolation?: boolean;
  supportsControlPlane?: boolean;
  control?: {
    kind: "none" | "tor-control-port" | "provider-api";
    endpoint?: string;
    token?: string;
  };
}
```

Capabilities are usually weaker than local Tor:

```ts
const torSocksEndpointCapabilities: ProxyProviderCapabilities = {
  networkTypes: ["tor"],
  protocols: ["socks5h"],
  dns: {
    modes: ["proxy"],
    remoteRequired: true,
  },
  geo: {
    mode: "verified-after-acquire",
    countries: "*",
    countrySelection: "not-supported",
  },
  identity: {
    rotation: ["sticky"],
    isolation: ["provider-defined"],
  },
  auth: {
    modes: ["none", "username-password", "token"],
  },
  transport: {
    forwardProxy: true,
    routeChain: false,
    customTransport: false,
    streamingRequestBody: true,
    streamingResponseBody: true,
    remoteDns: true,
    onionTargets: true,
  },
};
```

This contract covers small wrappers such as local Docker Tor SOCKS containers and CI actions that expose `localhost:9050`.

### 9.3 External SOCKS providers used with Tor

Some providers expose ordinary SOCKS5 endpoints and credentials. They are not Tor providers by themselves, but they can be used before or after Tor depending on how the Tor process or target transport is configured.

The core must not model these as `tor: true`. They are normal `ForwardProxyRoute` hops.

```ts
export interface StaticForwardProxyProviderOptions {
  protocol: "http" | "https" | "socks4" | "socks5" | "socks5h";
  host: string;
  port: number;
  username?: string;
  password?: string;
  dns?: ProxyDnsMode;
}
```

## 10. Internal gateway request model

```ts
export interface GatewayTargetRequest {
  url: string;
  method: string;
  headers: Array<[string, string]>;
  body: GatewayBody;
  fetch: GatewayFetchMetadata;
}

export type GatewayBody =
  | { kind: "none"; replayability: "replayable" }
  | { kind: "text"; text: string; replayability: "replayable" }
  | { kind: "bytes"; bytes: Uint8Array; replayability: "replayable" | "buffered-replayable" }
  | { kind: "stream"; stream: ReadableStream<Uint8Array>; replayability: "non-replayable" | "buffered-replayable"; sizeBytes?: number };

export interface GatewayFetchMetadata {
  mode?: RequestMode;
  credentials?: RequestCredentials;
  cache?: RequestCache;
  redirect?: RequestRedirect;
  referrer?: string;
  referrerPolicy?: ReferrerPolicy;
  integrity?: string;
  keepalive?: boolean;
  duplex?: "half";
}

export interface GatewayExecutionContext {
  tenantId?: string;
  useCase?: string;
  flowKey?: string;
  consistency?: string;
  routeKey?: string;
  marketCountry?: string;
  metadata?: Record<string, unknown>;
}
```

## 11. Proxy requirements model

```ts
export interface ProxyRouteRequirements {
  providerInstanceIds?: string[];
  excludeProviderInstanceIds?: string[];

  networkTypes?: ProxyNetworkType[];
  protocols?: ProxyProtocol[];
  dns?: ProxyDnsRequirements;

  geo?: ProxyGeoRequirements;
  identity?: ProxyIdentityRequirements;
  performance?: ProxyPerformanceRequirements;
  budget?: ProxyBudgetRequirements;
  compliance?: ProxyComplianceRequirements;

  target?: ProxyTargetRequirements;
  verification?: ProxyVerificationRequirements;

  metadata?: Record<string, unknown>;
}

export type KnownProxyNetworkType =
  | "residential"
  | "mobile"
  | "datacenter"
  | "isp"
  | "static-residential"
  | "tor"
  | "direct"
  | "custom";

export type ProxyNetworkType = KnownProxyNetworkType | (string & {});

export type ProxyProtocol = "http" | "https" | "socks4" | "socks5" | "socks5h";

export type ProxyDnsMode = "gateway" | "proxy" | "any";

export interface ProxyDnsRequirements {
  resolution: ProxyDnsMode;
  forbidLocalDnsLeak?: boolean;
}

export interface ProxyGeoRequirements {
  country?: string;
  region?: string;
  city?: string;
  postalCode?: string;
  asn?: number;
  strictness?: "required" | "preferred" | "best-effort";
  verify?: boolean;
}

export interface ProxyIdentityRequirements {
  rotation?: "per-request" | "sticky" | "fixed";
  stickySessionId?: string;
  stickySessionTtlMs?: number;
  isolationKey?: string;
  isolationScope?: Array<"tenant" | "flow" | "route" | "provider" | "target-host" | "attempt">;
  requestNewIdentity?: boolean;
}

export interface ProxyTargetRequirements {
  allowOnionHosts?: boolean;
  requireTorForOnionHosts?: boolean;
}

export interface ProxyVerificationRequirements {
  verifyExit?: boolean;
  rejectOnGeoMismatch?: boolean;
  retryOnGeoMismatch?: boolean;
  maxVerificationAttempts?: number;
  verificationTimeoutMs?: number;
  cacheTtlMs?: number;
}
```

Use `socks5h` and `dns.resolution: "proxy"` for Tor-like routes. Do not silently downgrade Tor-like routes to `socks5`.

## 12. Provider capabilities

```ts
export interface ProxyProviderCapabilities {
  networkTypes: ProxyNetworkType[];
  protocols: ProxyProtocol[];

  dns: {
    modes: ProxyDnsMode[];
    remoteRequired?: boolean;
  };

  geo: ProxyProviderGeoCapabilities;

  identity: {
    rotation: Array<"per-request" | "sticky" | "fixed">;
    isolation?: ProxyIsolationMode[];
    maxStickySessionTtlMs?: number;
  };

  auth: {
    modes: Array<"none" | "username-password" | "ip-whitelist" | "api-token" | "token">;
  };

  transport: {
    forwardProxy: boolean;
    routeChain: boolean;
    customTransport: boolean;
    streamingRequestBody: boolean;
    streamingResponseBody: boolean;
    remoteDns?: boolean;
    onionTargets?: boolean;
  };

  cost?: ProviderCostHints;
}

export interface ProxyProviderGeoCapabilities {
  mode: "guaranteed" | "best-effort" | "verified-after-acquire" | "unsupported";
  countries: "*" | string[];
  countrySelection:
    | "per-request"
    | "provider-config"
    | "external-or-provider-config"
    | "not-supported";
  regionLevel?: boolean;
  cityLevel?: boolean;
  postalCodeLevel?: boolean;
  asnLevel?: boolean;
}

export type ProxyIsolationMode =
  | "none"
  | "provider-session"
  | "socks-auth"
  | "dedicated-port"
  | "control-plane"
  | "provider-defined";

export interface ProviderCostHints {
  costClass: "free" | "cheap" | "normal" | "expensive" | "very-expensive";
  estimatedCostPerGbUsd?: number;
  estimatedCostPerRequestUsd?: number;
}
```

Important behavior:

```txt
- If geo.mode is guaranteed, the provider adapter may satisfy geo.country during acquire().
- If geo.mode is best-effort, mismatch should be recorded but not necessarily rejected.
- If geo.mode is verified-after-acquire, the core should run exit verification when policy requires strict country matching.
- If geo.mode is unsupported, geo requirements should skip or reject that provider unless policy says best-effort is acceptable.
- `ExecutionPlanner` may mark a `ProxyExecutionAttempt` as requiring exit verification through `attempt.verification`, but it must not call `ProxyExitVerifierPort`, DNS, GeoIP, probe endpoints, or provider-specific APIs.
- Lease verification belongs after provider `acquire()` and before target transport execution. It uses `ProxyExecutionAttempt.verification` plus `ProxyExecutionAttempt.requirements.geo` as the core trigger and expected-geo source.
```

## 13. Request facts, enrichment, and custom policy pipelines

Custom rules should be represented as declarative pipelines. They behave like a controlled async pipeline, not like Express middleware and not like RxJS observables.

Pipeline phases:

```txt
match -> enrich -> require -> select -> rank -> plan -> verify
```

Do not use `next()`. Each step returns an explicit result.

```ts
export enum PIPELINE_PHASE {
  MATCH = "match",
  ENRICH = "enrich",
  REQUIRE = "require",
  SELECT = "select",
  RANK = "rank",
  PLAN = "plan",
  VERIFY = "verify",
}

export enum PIPELINE_DECISION_KIND {
  CONTINUE = "continue",
  REJECT = "reject",
  USE_PLAN = "use-plan",
  SKIP_PIPELINE = "skip-pipeline",
}

export interface ProxyPipelineConfig {
  id: string;
  priority?: number;
  when?: ProxyCondition;

  match?: ProxyPipelineStepConfig[];
  enrich?: ProxyPipelineStepConfig[];
  require?: ProxyPipelineStepConfig[];
  select?: ProxyPipelineStepConfig[];
  rank?: ProxyPipelineStepConfig[];
  plan: ProxyPipelineStepConfig[];
  verify?: ProxyPipelineStepConfig[];
}

export interface ProxyPipelineStepConfig {
  use: string;
  args?: Record<string, unknown>;
}

export interface ProxyPipelineStep {
  readonly type: string;
  execute(input: ProxyPipelineStepInput): Promise<ProxyPipelineStepResult>;
}

export interface ProxyPipelineStepInput {
  requestId: string;
  state: ProxyDecisionState;
  args: Record<string, unknown>;
  services: ProxyGatewayServices;
  signal: AbortSignal;
}

export interface ProxyPipelineStepResult {
  statePatch?: ProxyDecisionStatePatch;
  decision?: ProxyPipelineDecision;
  events?: GatewayEvent[];
}

export type ProxyPipelineDecision =
  | { kind: PIPELINE_DECISION_KIND.CONTINUE }
  | { kind: PIPELINE_DECISION_KIND.REJECT; code: string; message: string; status?: number }
  | { kind: PIPELINE_DECISION_KIND.USE_PLAN; plan: ProxyExecutionPlan }
  | { kind: PIPELINE_DECISION_KIND.SKIP_PIPELINE; reason?: string };
```

`when` is a declarative prefilter. If it is absent, the pipeline applies. `match` is an optional programmable phase that runs only after `when` matches.

State patches in v0.1 must be deterministic and non-mutating: replace `target`, `candidates`, and `plan` when provided; shallow-merge `context`, `facts`, `requirements`, and `metadata`.

State:

```ts
export interface ProxyDecisionState {
  target: GatewayTargetRequest;
  context: GatewayExecutionContext;
  facts: GatewayFacts;
  requirements: ProxyRouteRequirements;
  candidates: ProxyProviderCandidate[];
  plan?: ProxyExecutionPlan;
  metadata: Record<string, unknown>;
}

export interface GatewayFacts {
  target?: {
    host?: string;
    resolvedIps?: string[];
    primaryCountry?: string;
    countries?: string[];
    asns?: number[];
    isOnion?: boolean;
  };

  client?: {
    ip?: string;
    country?: string;
  };

  proxyExit?: {
    ip?: string;
    country?: string;
    asn?: number;
    isTor?: boolean;
  };

  custom?: Record<string, unknown>;
}
```

The core defines ports only. It does not implement GeoIP or DNS integrations.

## 14. Three separate country/IP scenarios

Support these scenarios separately. Do not collapse them into one `country` field.

### 14.1 Target IP country

Where is the target host/server/CDN resolved to?

Implementation: enrichment through `DnsResolverPort` and `GeoIpResolverPort`.

### 14.2 Proxy exit IP country

From which country will the target see this request?

Implementation:

```txt
- commercial provider may guarantee it during acquire;
- Tor-like provider usually needs exit verification after acquire;
- verifier calls a probe endpoint through the same route and then uses GeoIP.
```

### 14.3 Client IP country

From which country did the caller reach the gateway?

Implementation: optional inbound context or external enricher.

## 15. Exit verification and probe target

Exit verification is generic and must not be Tor-specific.

```ts
export interface ProxyExitVerifyInput {
  requestId: string;
  lease: ProxyLease;
  route: ProxyRoute;
  expected?: ProxyGeoRequirements;
  signal: AbortSignal;
}

export interface ProxyExitVerification {
  ip: string;
  country?: string;
  region?: string;
  city?: string;
  asn?: number;
  isTor?: boolean;
  matchesRequirements: boolean;
  source: "external-ip-echo" | "tor-control-port" | "provider-api" | string;
  checkedAt: Date;
  metadata?: Record<string, unknown>;
}
```

`@echospecter/proxy-gateway-probe-target` should be a separate package or test utility, not part of the core.

Recommended probe endpoints:

```txt
GET  /ip
GET  /whoami
POST /echo/json
POST /echo/text
POST /echo/binary
POST /echo/base64
POST /echo/multipart
POST /echo/stream
GET  /stream/chunks
GET  /sse
GET  /delay/:ms
GET  /status/:code
GET  /redirect/:count
GET  /headers
```

Probe target modes:

```txt
public-ip-only:
- expose only /ip;
- redact everything else.

authenticated-diagnostics:
- expose headers/body diagnostics with token auth.

local-e2e:
- expose all endpoints on 127.0.0.1 for deterministic tests.
```

Probe target rules:

```txt
- never echo secrets by default;
- redact authorization/cookie/proxy-authorization/x-api-key;
- for binary and stream bodies, return length and sha256 instead of unbounded content;
- enforce body limits;
- allow deterministic stream/chunk/delay/status/redirect tests.
```

## 16. Declarative config

The gateway should support programmatic configuration and a JSON-friendly declarative config. The core must not parse YAML or load `.env`.

```ts
export interface ProxyGatewayConfig {
  providers: ProviderInstanceConfig[];
  pipelines?: ProxyPipelineConfig[];
  routes?: ProxyRouteConfig[];
  defaults?: ProxyGatewayDefaults;
  security?: GatewaySecurityConfig;
  buffering?: BodyBufferingPolicy;
  redaction?: RedactionPolicy;
}

export interface ProviderInstanceConfig {
  id: string;
  kind: string;
  enabled?: boolean;
  weight?: number;
  priority?: number;
  tags?: string[];
  config?: Record<string, unknown>;
}

export interface ProxyRouteConfig {
  id: string;
  priority?: number;
  match: ProxyRouteMatch;
  exclude?: ProxyRouteMatch;
  plan: ProxyPlanConfig;
}

export interface ProxyPlanConfig {
  totalTimeoutMs?: number;
  stopOnTargetHttpError?: boolean;
  attempts: ProxyAttemptConfig[];
}

export interface ProxyAttemptConfig {
  provider: string;
  maxAttempts?: number;
  timeoutMs?: number;
  retryOn?: RetryCondition[];
  requirements?: ProxyRouteRequirements;
  verifyExit?: ProxyVerificationRequirements;
}
```

JSON-friendly expression references:

```ts
export type ProxyExpression =
  | string
  | number
  | boolean
  | null
  | { ref: string }
  | { coalesce: ProxyExpression[] }
  | { equals: [ProxyExpression, ProxyExpression] }
  | { in: [ProxyExpression, ProxyExpression[]] }
  | { concat: ProxyExpression[] };
```

Do not execute arbitrary JS from declarative config.

## 17. Matchers

Support exact, prefix, suffix, glob, regexp, and predicate matchers.

Use real `RegExp` only in programmatic API. Use `{ type: "regexp", source, flags }` in JSON-friendly config.

```ts
export interface ProxyRouteMatch {
  url?: UrlMatcher;
  host?: HostMatcher;
  path?: PathMatcher;
  method?: string | string[];
  headers?: HeaderMatcher[];
  context?: ContextMatcher;
  facts?: FactsMatcher;
}

export enum STRING_MATCHER_KIND {
  EXACT = "exact",
  PREFIX = "prefix",
  SUFFIX = "suffix",
  GLOB = "glob",
  REGEXP = "regexp",
}

export type StringMatcher =
  | string
  | RegExp
  | ((value: string) => boolean)
  | { type: STRING_MATCHER_KIND.EXACT; value: string }
  | { type: STRING_MATCHER_KIND.PREFIX; value: string }
  | { type: STRING_MATCHER_KIND.SUFFIX; value: string }
  | { type: STRING_MATCHER_KIND.GLOB; value: string }
  | { type: STRING_MATCHER_KIND.REGEXP; source: string; flags?: string };
```

Normalize URL/host before matching. Detect `.onion` hosts in normalized metadata.
Host suffix matching must be DNS-label-aware: a suffix matcher for `example.com` may match `example.com` and `api.example.com`, but not `badexample.com`.

Glob matching must remain dependency-free. Keep the supported scope intentionally narrow and testable for routing needs: literal segments, `*`, `?`, full-segment `**`, character classes/ranges, negated classes, escaping, and explicit case-sensitivity behavior. Do not copy third-party glob test fixtures into this project; recreate focused compatibility-inspired tests that describe this package's own matching contract. Treat unsupported broad shell features such as brace expansion and extglob as literal text unless a future phase explicitly widens the contract.

Route conflict resolution:

```txt
- Higher priority wins.
- If priority is equal, earlier route wins.
- exclude is evaluated after match.
- If no route matches, use default route if configured.
- If no route and no default route exist, reject with NO_ROUTE_MATCHED.
```

## 18. Retry and result classification

Default behavior must be safe.

```txt
- Network errors are retryable if policy allows retry.
- Proxy connection errors are retryable if policy allows retry.
- Proxy auth errors are not retryable for the same provider instance.
- Caller abort is not retryable.
- Total gateway timeout is not retryable.
- HTTP statuses from the target are returned to the client by default.
- HTTP status retry must be explicitly configured by route policy.
- Unsafe methods are not retried by default.
- Geo mismatch is retryable only if policy explicitly says so.
```

```ts
export enum RETRY_CONDITION {
  PROXY_TIMEOUT = "proxy-timeout",
  GATEWAY_TIMEOUT = "gateway-timeout",
  PROXY_AUTH_ERROR = "proxy-auth-error",
  PROXY_CONNECTION_ERROR = "proxy-connection-error",
  TARGET_NETWORK_ERROR = "target-network-error",
  TARGET_TIMEOUT = "target-timeout",
  PROXY_GEO_MISMATCH = "proxy-geo-mismatch",
  EXIT_VERIFICATION_FAILED = "exit-verification-failed",
  HTTP_403 = "http-403",
  HTTP_407 = "http-407",
  HTTP_408 = "http-408",
  HTTP_409 = "http-409",
  HTTP_425 = "http-425",
  HTTP_429 = "http-429",
  HTTP_500 = "http-500",
  HTTP_502 = "http-502",
  HTTP_503 = "http-503",
  HTTP_504 = "http-504",
}

export enum PROXY_ATTEMPT_RESULT_OUTCOME {
  // Use specific outcomes when possible. Use GATEWAY_ERROR for gateway-owned failures
  // that do not fit a more precise timeout/abort/policy/body/transport outcome.
  GATEWAY_ERROR = "gateway-error",
  SUCCESS = "success",
  TARGET_HTTP_ERROR = "target-http-error",
  TARGET_NETWORK_ERROR = "target-network-error",
  TARGET_TIMEOUT = "target-timeout",
  PROXY_AUTH_ERROR = "proxy-auth-error",
  PROXY_CONNECTION_ERROR = "proxy-connection-error",
  PROXY_TIMEOUT = "proxy-timeout",
  PROXY_GEO_MISMATCH = "proxy-geo-mismatch",
  EXIT_VERIFICATION_FAILED = "exit-verification-failed",
  GATEWAY_TIMEOUT = "gateway-timeout",
  ABORTED = "aborted",
  REJECTED_BY_POLICY = "rejected-by-policy",
  REQUEST_BODY_NOT_REPLAYABLE = "request-body-not-replayable",
  RESPONSE_STREAM_ALREADY_STARTED = "response-stream-already-started",
  UNSUPPORTED_ROUTE = "unsupported-route",
}
```

`GATEWAY_ERROR` is reserved for gateway-owned failures that do not fit a more precise outcome, such as response buffering failure. New classifier and retry code must still prefer specific outcomes such as `TARGET_NETWORK_ERROR`, `GATEWAY_TIMEOUT`, `ABORTED`, `REQUEST_BODY_NOT_REPLAYABLE`, or `REJECTED_BY_POLICY` whenever those apply.

`ResultClassifier` is the single owner of mapping observed target/proxy/gateway failures into `PROXY_ATTEMPT_RESULT_OUTCOME`, service error codes, retryability flags, retry-condition hints, and redacted diagnostics. Executors and use-cases must not duplicate raw-error-to-service-code mapping except for a defensive fallback when a classified failure has no service error.

`RetryDecider` consumes classified `PROXY_ATTEMPT_RESULT_OUTCOME` values and retry policy; it must not classify raw errors. `ResultClassifier` produces attempt outcomes and retry-condition hints; it must not decide whether to run another attempt.

Same-attempt retry and fallback traversal must be driven by `RetryDecider`. `AttemptExecutor` may manage retry-loop state, acquired leases, attempt indexes, and fallback traversal, but it must not add ad hoc retry/fallback rules outside `RetryDecider`.

Unsafe method retry policy:

```ts
export interface RetrySafetyPolicy {
  retryUnsafeMethods?: boolean;
  unsafeMethods?: string[];
  requireIdempotencyKeyForUnsafeRetries?: boolean;
}
```

Recommended defaults:

```txt
unsafeMethods = ["POST", "PUT", "PATCH", "DELETE"]
retryUnsafeMethods = false
requireIdempotencyKeyForUnsafeRetries = true
```

## 19. Abort and timeout model

The gateway needs two levels of cancellation.

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
- If one attempt timeout expires, the gateway may continue to the next attempt if policy allows.
- The total gateway timeout scope is owned by the request flow above attempt execution.
- `AttemptExecutor` creates per-attempt timeout scopes from the total/caller parent signal.
- Provider adapter acquire() receives the attempt signal.
- Lease verification receives the attempt signal.
- Target transport receives the attempt signal.
- release() should be called when possible, even after failed attempts.
- release() is best-effort. A release failure must first be represented as a `GatewayEvent`; when logger/telemetry ports are available that event may be emitted through them, but it must not mask the response or service error that represents the actual attempt outcome.
```

## 20. Body buffering and ReadableStream control

The gateway can control memory usage for `ReadableStream`, but only through explicit limits.

```ts
export interface BodyBufferingPolicy {
  maxBufferedRequestBodyBytes: number;
  maxBufferedResponseBodyBytes: number;
  bufferRequestStreamsForRetry: boolean;
  bufferResponsesBeforeReturn: boolean;
  rejectWhenRequestBufferExceeded: boolean;
  rejectWhenResponseBufferExceeded: boolean;
}
```

Recommended v0.1 defaults:

```ts
const defaultBodyBufferingPolicy: BodyBufferingPolicy = {
  maxBufferedRequestBodyBytes: 10 * 1024 * 1024,
  maxBufferedResponseBodyBytes: 25 * 1024 * 1024,
  bufferRequestStreamsForRetry: true,
  bufferResponsesBeforeReturn: true,
  rejectWhenRequestBufferExceeded: false,
  rejectWhenResponseBufferExceeded: false,
};
```

Rules:

```txt
- Text and bytes bodies are replayable.
- JSON Base64 bodies are replayable after decoding.
- Multipart binary bodies are replayable if fully buffered within maxBufferedRequestBodyBytes.
- ReadableStream bodies are replayable only if buffered within maxBufferedRequestBodyBytes.
- If a request body exceeds the buffer limit, retries/fallbacks must be disabled for that body.
- If policy requires retry for a non-replayable body, return REQUEST_BODY_NOT_REPLAYABLE before unsafe execution.
- For v0.1, do not implement disk spilling unless explicitly added later.
```

## 21. Target access policy

The gateway is a powerful SSRF surface. Secure defaults are required.

```ts
export interface TargetAccessPolicy {
  allowedSchemes: Array<"http:" | "https:">;
  allowLocalhost?: boolean;
  allowPrivateIps?: boolean;
  allowLinkLocalIps?: boolean;
  allowOnionHosts?: boolean;
  onionRequiresNetworkType?: PROXY_NETWORK_TYPE.TOR;
  allowedHosts?: HostMatcher[];
  deniedHosts?: HostMatcher[];
  deniedCidrs?: string[];
}
```

Recommended defaults:

```txt
- allowedSchemes: ["http:", "https:"]
- allowLocalhost: false
- allowPrivateIps: false
- allowLinkLocalIps: false
- allowOnionHosts: false unless explicitly enabled
- if .onion is enabled, require route network type "tor"
- deny 127.0.0.0/8, ::1/128, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, fc00::/7, fe80::/10
```

## 22. Redaction policy

Never log secrets.

```ts
export interface RedactionPolicy {
  redactHeaders: string[];
  redactQueryParams: string[];
  redactProviderCredentials: boolean;
  redactCookies: boolean;
  replacement: string;
}
```

Recommended defaults:

```txt
Headers: authorization, proxy-authorization, cookie, set-cookie, x-api-key, x-auth-token
Query params: api_key, access_token, token, password, secret, key
```

## 23. Sticky sessions and isolation

Sticky sessions and route isolation must be scoped. Do not let tenants or unrelated flows share a provider session accidentally.

```ts
export interface StickySessionKey {
  tenantId?: string;
  flowKey?: string;
  routeId: string;
  providerInstanceId: string;
  targetHost?: string;
}

export interface ProxyIsolationOptions {
  key: string;
  scope: Array<"tenant" | "flow" | "route" | "provider" | "target-host" | "attempt">;
  mode?: ProxyIsolationMode;
}
```

Rules:

```txt
- Sticky session id can come from context or can be generated by the gateway.
- Sticky session must be associated with tenant/useCase/flow/route/provider/targetHost as configured.
- For Tor-like providers, isolation may map to SOCKS username/password or dedicated SOCKS port.
- On proxy connection failures, a session may be preserved.
- On configured block statuses such as 403/429 or geo mismatch, a session may be invalidated by policy.
```

## 24. Circuit breaker and provider health

Provider health must be tracked outside provider adapters.

```ts
export interface CircuitBreakerConfig {
  enabled: boolean;
  failureThreshold: number;
  cooldownMs: number;
  halfOpenMaxAttempts: number;
}
```

Rules:

```txt
- Auth failures should open/degrade the provider quickly.
- Repeated proxy timeouts should degrade the provider.
- Repeated geo mismatch may degrade only that provider/country requirement combination.
- Circuit breaker state should affect provider snapshots passed to routing policy.
- Health should be per provider instance, not only per provider kind.
```

## 25. E2E test strategy

E2E tests must prove that the same gateway core works with Express, Fastify, and NestJS. Do not create three separate gateway implementations.

```ts
type ServerFactory = () => Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}>;

describeProxyGatewayE2e("express", createExpressGatewayServer);
describeProxyGatewayE2e("fastify", createFastifyGatewayServer);
describeProxyGatewayE2e("nestjs", createNestGatewayServer);
```

Recommended test servers:

```txt
- probe target server: receives final target requests and returns deterministic diagnostics;
- gateway test server: Express/Fastify/NestJS wrapper around ProxyGateway.handle();
- mock provider adapter: returns direct route, failing route, delayed route, socks5h route, route chain, or custom transport route;
- mock exit verifier: returns deterministic exit IP/country/isTor;
- proxy-fetch client: uses @echospecter/proxy-fetch against the gateway server.
```

## 26. Required tests

Service contract tests:

```txt
- JSON proxy-fetch.v1 request with no body/text body;
- multipart request with meta and binary body;
- JSON Base64 fallback body;
- invalid envelope version/body kind;
- impossible special response combinations;
- target 404/500 as service ok:true unless retry policy says otherwise;
- service ok:false on gateway-level failures.
```

Body compatibility tests:

```txt
- no body, string, URLSearchParams, Blob, ArrayBuffer, typed arrays, FormData, ReadableStream, existing Request;
- binary and multipart sha256 round-trip;
- large stream within buffer limit;
- stream exceeding buffer limit;
- non-replayable stream does not retry.
```

Routing and policy tests:

```txt
- exact/suffix/glob/regexp/programmatic RegExp host match;
- path, URL, method, header, context, facts match;
- exclude match;
- priority conflict resolution;
- no route matched;
- pipeline enrich/require/select/rank/plan/verify order;
- custom step registration;
- effectful step timeout/failMode behavior.
```

Retry/fallback tests:

```txt
- GET retries on configured network/proxy errors;
- target 403/429 not retried by default;
- target 429 retried only when configured;
- POST not retried by default;
- POST retry only with explicit unsafe retry policy and idempotency key when required;
- fallback from provider A to provider B;
- provider auth error does not retry same provider;
- total timeout stops all attempts;
- per-attempt timeout allows next attempt;
- client abort stops all attempts and prevents fallback;
- release called after success/failure where possible.
```

SOCKS/Tor tests:

```txt
- forward-proxy route supports socks5h;
- socks5h route requires dns: "proxy" when forbidLocalDnsLeak is true;
- socks5 route is rejected for Tor-like provider when remote DNS is required;
- Tor-like provider with geo.mode: "verified-after-acquire" triggers exit verification when strict geo is required;
- geo mismatch produces proxy-geo-mismatch;
- proxy-geo-mismatch can retry/new lease/fallback by policy;
- isolation key is passed to provider adapter and can be mapped to route auth metadata;
- .onion target is rejected by default;
- .onion target is allowed only when target access policy enables it and chosen route supports onion targets;
- unsupported route chain returns UNSUPPORTED_ROUTE.
```

Probe target tests:

```txt
- /ip returns visible IP metadata;
- /whoami returns method/url/redacted headers;
- /echo/json, /echo/text, /echo/binary, /echo/base64, /echo/multipart, /echo/stream;
- /stream/chunks, /delay/:ms, /status/:code, /redirect/:count.
```

Framework raw body tests:

```txt
- Express wrapper must not use express.json() before gateway raw body handling;
- Fastify wrapper must not lose multipart boundary or raw bytes;
- NestJS wrapper must bypass or correctly handle body parser for gateway route;
- binary/multipart sha256 must match through all three wrappers;
- ReadableStream body must reach target through all three wrappers.
```

## 27. Corner cases

```txt
1. RegExp is useful for host matching but not JSON-friendly. Support { type: "regexp", source, flags }.
2. Host normalization is required: case, trailing dot, port, punycode, IPv6, localhost.
3. Several routes can match the same request. Priority and order must be deterministic.
4. ReadableStream bodies are not replayable unless buffered.
5. Buffering must have explicit byte limits to avoid memory exhaustion.
6. Unsafe methods such as POST/PUT/PATCH/DELETE must not retry by default.
7. Retry after partial response streaming is not safe.
8. Target HTTP errors are not service errors by default.
9. Matching should use target URL, not the gateway service request host.
10. Redirects can change host. Routing is based on initial target URL in v0.1.
11. socks5 and socks5h differ in DNS resolution locality.
12. Tor-like routes must not leak DNS locally.
13. Sticky sessions must be scoped by tenant/flow/route/provider/host.
14. Failed sticky sessions may need invalidation on block-like statuses.
15. Circuit breaker state must be per provider instance.
16. Provider costs may affect routing decisions.
17. Rate limits may need tenant/useCase/provider/targetHost scopes.
18. Logs and telemetry must redact secrets.
19. Gateway must protect against SSRF by default.
20. Framework body parsers can corrupt raw bodies.
21. Multipart boundaries must be preserved.
22. Null-body statuses 204/205/304 must preserve null-body semantics.
23. Special response types must use valid Fetch-compatible shapes.
24. Abort from client must stop all future fallback attempts.
25. Provider auth error should not retry the same provider instance.
26. DNS rebinding and redirect-to-private-IP must be handled by target access checks.
27. Content-Length must not be stale after body transformation.
28. Gateway must not double-decompress or corrupt compressed/binary responses.
29. Stream bridges must respect backpressure unless buffering policy says otherwise.
30. release() should still run if transport throws after acquire.
31. Timeout/success races must settle once.
32. Large FormData text fields must be limited too.
33. Unknown context metadata is preserved but not trusted for security decisions.
34. Provider capability mismatch should skip/reject before acquire.
35. Weighted routing must skip disabled/down providers.
36. Retry budget exhaustion must fail early if plan cannot be executed safely.
37. Client disconnect after target request started should abort target execution when possible.
38. Tor exit country cannot be assumed before verification unless provider explicitly guarantees it.
39. ExitNodes-style provider configuration is not the same as per-request geo guarantee.
40. Exit verification request may itself use a different circuit if isolation is not configured.
41. Probe endpoints must not echo secrets by default.
42. Route chains may be expressible but unsupported by default transport; fail clearly.
43. .onion targets require Tor-capable route and explicit target access policy.
44. GeoIP result can be wrong/stale; strict policy should allow verification source metadata.
45. Provider may return correct country but target sees headers differently; probe target should test headers.
46. Zero runtime dependencies makes parsers and matchers our responsibility; keep them small and heavily tested.
```

## 28. Implementation phases

v0.1:

```txt
- core ProxyGateway.handle(Request): Promise<Response>;
- zero runtime dependencies;
- proxy-fetch.v1 JSON parser/builder;
- proxy-fetch.v1 multipart parser/builder;
- body normalization and buffer limits;
- provider adapter port;
- multiple provider instances;
- pipeline engine or rule-based routing;
- exact/suffix/glob/regexp matchers;
- route priority and exclude;
- total/per-attempt timeout;
- abort propagation;
- retry/fallback chain;
- safe retry defaults;
- basic target access guard;
- redaction;
- ForwardProxyRoute with socks5h support in contract;
- geo.mode capability model;
- verifyExit contract and mock verifier;
- Express/Fastify/NestJS thin wrappers;
- shared E2E suite across Express/Fastify/NestJS.
```

v0.2:

```txt
- weighted distribution;
- sticky session store;
- provider health snapshots;
- circuit breaker;
- cooldown after failures;
- rate limiter port;
- provider adapter testkit;
- JSON config factory with explicit registries;
- richer telemetry events;
- route chain contract tests;
- probe target package;
- HTTP exit verifier package.
```

v0.3:

```txt
- adaptive routing by latency/block-rate/cost;
- persistent metrics store;
- disk-backed stream buffering through BodyBufferStorePort;
- advanced redirect rerouting policies;
- policy plugins;
- Tor local provider package;
- Tor SOCKS endpoint provider package;
- live smoke tests for real provider adapters.
```

## 29. Coding rules for agents

```txt
- Keep the core provider-agnostic.
- Keep framework integrations as thin wrappers.
- Keep provider adapters outside the core package.
- Keep GeoIP/DNS/probe integrations outside the core package.
- Keep runtime dependencies at zero.
- Do not read .env, process.env, or globals from core runtime code.
- Prefer small pure services with explicit ports.
- Do not hide policy decisions inside provider adapters.
- Do not add provider-specific fields to core request types.
- Do not add useTor: true or tor: { ... } to core types.
- Model Tor through generic route, DNS, identity, geo capability, and verification contracts.
- Do not add large comments unless they explain a non-obvious edge case.
- Comments, when needed, must be in English.
- Test behavior through public APIs, not private implementation details.
- Any new body format must be justified by @echospecter/proxy-fetch compatibility.
- Any retry behavior must be safe by default.
- Any streaming behavior must respect memory limits.
```

## 30. TypeScript Rules

### General

- No `any`.
- Do not use `object` when a precise interface can be defined.
- Avoid `as` casts unless there is no cleaner option.
- Prefer strict typing.
- Minimize unrelated formatting changes.
- Do not add new comments unless explicitly requested.
- Do not remove existing comments unless necessary.

### Mongoose

- This repository uses Mongoose 9.x.
- Do not use deprecated `new: true` in `findOneAndUpdate()` or `findOneAndReplace()` options.
- Use `returnDocument: "after"` instead. Example:

```ts
await model.findOneAndUpdate(filter, update, {
  returnDocument: "after",
});
```

### Interfaces and Enums

- Prefer `interface` over `type` whenever an interface can express the shape.
- Every interface name must start with the `I` prefix. Example: `ISomeInterface`.
- Do not use string-union type aliases when an enum is appropriate.
- Prefer enums in uppercase snake case. Example:

```ts
export enum HOTEL_TYPE {
  HOTEL = "hotel",
  APARTMENT = "apartment",
}
```

- If an enum values array is needed, derive it via `Object.values(...)`. Example:

```ts
const HOTEL_TYPES_ARRAY = Object.values(HOTEL_TYPE);
```

## Control Flow Rules

- Do not use `while (true)`.
- All iteration must have explicit and controlled termination conditions.

## Formatting Rules

- Complex multiline conditions must be formatted like this:

```ts
if (
  condition1
    && condition2
    || condition3
) {
  handleCase();
}
```

- Do not format complex conditions like this:

```ts
if (
  condition1 &&
    condition2 ||
    condition3
) {
  handleCase();
}
```

## Comments

- Comments are allowed only rarely.
- Use comments only when important constraints or conditions are not obvious from the code itself.
- All comments must be in English.
