# @echospecter/proxy-gateway

Provider-agnostic execution gateway for `@echospecter/proxy-fetch`.

`@echospecter/proxy-gateway` receives `proxy-fetch.v1` service requests, applies routing and safety policy, executes the target request through a selected provider adapter, and returns a `proxy-fetch.v1` response envelope that `@echospecter/proxy-fetch` can reconstruct as a native `Response`.

It is intended for applications that want a Fetch-like client API while centralizing proxy credentials, routing policy, retries, fallback, target access controls, and observability on the server side.

## Status

`0.1.x` is the first public line. The package focuses on the provider-agnostic gateway core and a thin Node HTTP integration surface. Provider integrations, framework integrations, GeoIP integrations, Tor adapters, probe targets, and config loaders are expected to live in separate packages or user applications.

## Installation

```sh
npm install @echospecter/proxy-gateway
```

Install provider adapters separately:

```sh
npm install @echospecter/proxy-gateway-provider-bright-data
npm install @echospecter/proxy-gateway-provider-oxylabs
npm install @echospecter/proxy-gateway-provider-static-forward-proxy
```

## When to Use It

Use this package when you want to:

- expose a server-side endpoint compatible with `@echospecter/proxy-fetch`;
- keep proxy credentials out of client/application request code;
- route different target requests through different proxy providers;
- use retry and fallback policies across provider instances;
- preserve `proxy-fetch.v1` request/response body formats;
- enforce target access restrictions before outbound execution;
- keep provider-specific logic outside your gateway core.

Do not use this package as a provider SDK, a scraping framework, a config loader, or a drop-in replacement for native `fetch`.

## Relationship to proxy-fetch

`@echospecter/proxy-fetch` is the client-side package. It serializes a Fetch-compatible request and sends it to a service endpoint.

`@echospecter/proxy-gateway` is one implementation of that service endpoint.

```txt
application code
  -> proxyFetch(input, init)
  -> proxy-fetch.v1 request
  -> proxy-gateway
  -> provider adapter
  -> selected route
  -> target server
  -> proxy-fetch.v1 response
  -> native Response
```

Target HTTP statuses are normal target responses by default. A target `404`, `403`, `429`, `500`, or `503` is not a gateway failure unless your route policy explicitly retries or rejects that status.

## Quick Start

```ts
import { createProxyGateway } from '@echospecter/proxy-gateway';
import { createBrightDataProvider } from '@echospecter/proxy-gateway-provider-bright-data';
import { createOxylabsProvider } from '@echospecter/proxy-gateway-provider-oxylabs';

const gateway = createProxyGateway({
  providers: [
    {
      id: 'bright-data-gb',
      adapter: createBrightDataProvider({
        customer: appConfig.brightData.customer,
        zone: appConfig.brightData.zone,
        password: appConfig.brightData.password,
      }),
      tags: ['residential', 'gb'],
      weight: 70,
    },
    {
      id: 'oxylabs-gb',
      adapter: createOxylabsProvider({
        username: appConfig.oxylabs.username,
        password: appConfig.oxylabs.password,
      }),
      tags: ['residential', 'gb'],
      weight: 30,
    },
  ],

  pipelines: [
    {
      id: 'google-uk-search',
      priority: 100,
      when: {
        host: { type: 'regexp', source: '(^|\\.)google\\.com$', flags: 'i' },
      },
      require: [
        {
          use: 'requirements.set',
          args: {
            networkTypes: ['residential'],
            geo: { country: 'GB', strictness: 'required' },
          },
        },
      ],
      plan: [
        {
          use: 'plan.fallback',
          args: {
            attempts: [
              {
                provider: 'bright-data-gb',
                maxAttempts: 3,
                timeoutMs: 15_000,
                retryOn: ['proxy-timeout', 'target-network-error', 'http-403', 'http-429'],
              },
              {
                provider: 'oxylabs-gb',
                maxAttempts: 2,
                timeoutMs: 15_000,
                retryOn: ['proxy-timeout', 'target-network-error'],
              },
            ],
          },
        },
      ],
    },
  ],
});

export async function handleProxyFetchRequest(request: Request): Promise<Response> {
  return gateway.handle(request);
}
```

Your application is responsible for loading secrets and configuration. Pass ready-to-use provider adapters and plain JavaScript objects to the gateway.

## Public API

```ts
export interface ProxyGateway {
  handle(request: Request): Promise<Response>;
}

export interface ProxyGatewayOptions {
  providers: ProxyProviderInstance[];
  routes?: Array<ProxyRouteConfig<ProxyPlanConfig, ProxyRouteRequirements>>;
  defaultRoute?: ProxyDefaultRouteConfig<ProxyPlanConfig, ProxyRouteRequirements>;
  pipelines?: ProxyPipelineConfig[];
  stepRegistry?: ProxyPipelineStepRegistryPort;
  transport?: TargetTransportPort;

  targetAccess?: TargetAccessPolicy;
  retrySafety?: RetrySafetyPolicy;
  bodyBuffering?: BodyBufferingPolicy;
  redaction?: RedactionPolicy;
  timeouts?: TimeoutPolicy;
  plan?: ProxyPlanConfig;

  sessionStore?: ProxySessionStorePort;
  random?: RandomPort;
}

export function createProxyGateway(options: ProxyGatewayOptions): ProxyGateway;
export function createMemoryProxySessionStore(): ProxySessionStorePort;
```

The primary integration point is `ProxyGateway.handle(request)`. Framework-specific integrations should delegate to this method.

## Request and Response Formats

The gateway accepts the `proxy-fetch.v1` formats produced by `@echospecter/proxy-fetch`:

- JSON envelope with `request.body: null`;
- JSON envelope with `request.body.kind: "text"`;
- JSON envelope with `request.body.kind: "base64"` and `request.body.data`;
- `multipart/form-data` with part `meta` and raw binary part `body`.

These wire formats cover the Fetch inputs accepted by `@echospecter/proxy-fetch`, including string, `URLSearchParams`, `Blob`, `ArrayBuffer`, typed arrays, `FormData`, `ReadableStream` with `duplex: "half"`, and existing `Request` objects. The gateway validates the serialized service request; it does not receive those client-side JavaScript body objects directly.

The JSON request envelope uses `request`, not `target`:

```json
{
  "version": "proxy-fetch.v1",
  "request": {
    "url": "https://api.example.com",
    "method": "GET",
    "headers": [],
    "body": null
  },
  "options": {
    "timeoutMs": 360000
  },
  "context": {}
}
```

For multipart requests, `meta.request.body` references the raw binary part:

```json
{
  "kind": "binary",
  "partName": "body"
}
```

The gateway returns `proxy-fetch.v1` service responses as:

- JSON envelope with text response body;
- JSON envelope with null response body;
- JSON envelope with base64 response body using `body.data`;
- `multipart/form-data` response with part `meta` and raw binary part `body`;
- service error envelope with `ok: false`.

Successful service execution returns `ok: true` even for target HTTP errors. Response envelopes must preserve `url`, `status`, `statusText`, `redirected`, `type`, `headers`, and `body` where applicable.

Null-body statuses `204`, `205`, and `304` must preserve native null-body semantics. Special response types `error`, `opaque`, and `opaqueredirect` use `status: 0`, empty `statusText`, no headers, and `body: null`.

Fetch metadata serialized by `@echospecter/proxy-fetch` is preserved where applicable:

- `mode`;
- `credentials`;
- `cache`;
- `redirect`;
- `referrer`;
- `referrerPolicy`;
- `integrity`;
- `keepalive`;
- `duplex`.

## Providers

A provider instance gives the gateway one selectable route source.

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
```

Multiple instances can use the same adapter kind. Routing identity is the provider instance `id`, not the provider kind.

Provider adapters implement:

```ts
export interface ProxyProviderAdapter {
  readonly kind: string;

  getCapabilities(): ProxyProviderCapabilities | Promise<ProxyProviderCapabilities>;

  acquire(input: ProxyAcquireInput): Promise<ProxyLease>;

  release?(lease: ProxyLease, result: ProxyAttemptResult): void | Promise<void>;
}
```

An adapter acquires one lease for one attempt. It does not own retry or fallback behavior.

## Routes

Provider adapters return provider-agnostic routes:

```ts
export type ProxyRoute =
  | ForwardProxyRoute
  | RouteChain
  | DirectRoute
  | CustomTransportRoute;
```

Common route examples:

```ts
const directRoute: DirectRoute = {
  kind: 'direct',
};

const socks5hRoute: ForwardProxyRoute = {
  kind: 'forward-proxy',
  protocol: 'socks5h',
  host: '127.0.0.1',
  port: 9050,
  auth: { mode: 'none' },
  dns: 'proxy',
};
```

Use `socks5h` with proxy DNS when the hostname must be resolved by the proxy, such as Tor-like or privacy-sensitive routes. Do not use `socks5` when remote DNS is required.

## Routing Policies

Most applications can use declarative pipelines. A pipeline matches a target request, adjusts requirements, selects/ranks providers, and builds an execution plan.

```ts
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
```

`when` is a declarative prefilter. If it is absent, the pipeline applies. `match` is an optional programmable phase that runs only after `when` matches.

Example:

```ts
const pipelines: ProxyPipelineConfig[] = [
  {
    id: 'serp-gb',
    priority: 100,
    when: {
      host: { type: 'suffix', value: 'google.com' },
    },
    require: [
      {
        use: 'requirements.set',
        args: {
          networkTypes: ['residential'],
          protocols: ['http', 'https', 'socks5h'],
          geo: { country: 'GB', strictness: 'required' },
        },
      },
    ],
    plan: [
      {
        use: 'plan.fallback',
        args: {
          attempts: [
            {
              provider: 'primary-residential-gb',
              maxAttempts: 2,
              timeoutMs: 15_000,
              retryOn: ['proxy-timeout', 'target-network-error', 'http-429'],
            },
            {
              provider: 'fallback-residential-gb',
              maxAttempts: 1,
              timeoutMs: 20_000,
              retryOn: ['proxy-timeout', 'target-network-error'],
            },
          ],
        },
      },
    ],
  },
];
```

If you need fully custom routing, provide explicit plans or custom pipeline steps from application code.

## Sessions

Sticky-session behavior is configured through route or pipeline requirements and a session store.

```ts
import {
  createMemoryProxySessionStore,
  createProxyGateway,
} from '@echospecter/proxy-gateway';

const gateway = createProxyGateway({
  providers,
  routes,
  defaultRoute,
  sessionStore: createMemoryProxySessionStore(),
});
```

Applications that need shared or durable sticky sessions can implement `ProxySessionStorePort`.

## Matchers

Route and pipeline matching can use:

- exact string matching;
- prefix matching;
- suffix matching;
- glob matching;
- regular expressions;
- programmatic predicates where the API allows them.

For JSON-friendly configuration, use declarative regexp objects:

```ts
{
  type: 'regexp',
  source: '(^|\\.)google\\.com$',
  flags: 'i',
}
```

Priority decides conflicts:

- higher priority wins;
- equal priority keeps declaration order;
- `exclude` is evaluated after a positive match;
- no match returns a service-level routing error unless a default route is configured.

Route and default-route `requirements` are defaults for every attempt in the selected route plan. Attempt-level requirements override route defaults. Nested `dns`, `geo`, `verification`, and `identity` requirements merge by field; array fields such as `providerInstanceIds`, `excludeProviderInstanceIds`, `protocols`, `networkTypes`, and `identity.isolationScope` are replaced by the attempt-level array instead of concatenated.

## Body Buffering

Readable request bodies can only be retried if the gateway buffers them first. Buffering is bounded by explicit limits.

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

Useful defaults for most applications:

```ts
const bodyBuffering: BodyBufferingPolicy = {
  maxBufferedRequestBodyBytes: 10 * 1024 * 1024,
  maxBufferedResponseBodyBytes: 25 * 1024 * 1024,
  bufferRequestStreamsForRetry: true,
  bufferResponsesBeforeReturn: true,
  rejectWhenRequestBufferExceeded: false,
  rejectWhenResponseBufferExceeded: false,
};
```

If buffering exceeds the request limit and rejection is disabled, the request may still execute, but retry/fallback is disabled for that non-replayable body.

## Retry and Fallback Behavior

Safe defaults are conservative:

- target HTTP statuses are not retried unless the route explicitly lists retryable statuses;
- unsafe HTTP methods are not retried by default;
- caller abort is not retryable;
- total gateway timeout is not retryable;
- proxy/target network failures are retryable only when policy allows them;
- non-replayable request bodies cannot be retried.

Example attempt policy:

```ts
{
  provider: 'primary-residential-gb',
  maxAttempts: 3,
  timeoutMs: 15_000,
  retryOn: [
    'proxy-timeout',
    'proxy-connection-error',
    'target-network-error',
    'http-403',
    'http-429',
  ],
}
```

## Timeouts and Abort

The gateway has a total request timeout and per-attempt timeouts.

- If the caller aborts, the active attempt stops and no fallback starts.
- If the total timeout expires, the active attempt stops and no fallback starts.
- If a single attempt times out, fallback can continue only when retry policy allows it.
- Provider acquisition and target transport receive the active attempt `AbortSignal`.

## Target Access Policy

The gateway is expected to guard target access before outbound execution.

```ts
export interface TargetAccessPolicy {
  allowedSchemes: Array<'http:' | 'https:'>;
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

Default policy should allow only `http:` and `https:` targets and deny localhost, private, link-local, and `.onion` targets. Redirect targets must be checked too.

Configure explicit allow rules only for trusted internal deployments and tests.

## Redaction

Logs, telemetry events, service errors, and diagnostics should not expose secrets.

```ts
export interface RedactionPolicy {
  redactHeaders: string[];
  redactQueryParams: string[];
  redactProviderCredentials: boolean;
  redactCookies: boolean;
  replacement: string;
}
```

Commonly redacted headers include `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-api-key`, and `x-auth-token`.

Commonly redacted query parameters include `api_key`, `access_token`, `token`, `password`, `secret`, and `key`.

## Tor and SOCKS5H

Tor is represented by ordinary provider adapters and route capabilities. There is no gateway-level `useTor` mode.

Tor-like providers should generally return `socks5h` routes with proxy DNS:

```ts
{
  kind: 'forward-proxy',
  protocol: 'socks5h',
  host: '127.0.0.1',
  port: 9050,
  auth: { mode: 'none' },
  dns: 'proxy',
}
```

For country-sensitive Tor-like routes, combine policy requirements with exit verification through an external verifier port or companion package.

## Framework Integration

The core gateway operates on Web Fetch API `Request` and `Response` objects. Framework adapters should only translate framework request/response objects and delegate to `gateway.handle()`.

For plain Node HTTP, use the Node handler when available:

```ts
import { createNodeHttpHandler, createProxyGateway } from '@echospecter/proxy-gateway';
import { createServer } from 'node:http';

const gateway = createProxyGateway(options);
const handler = createNodeHttpHandler(gateway);

createServer(handler).listen(3000);
```

The core v0.1 package does not export Express, Fastify, or NestJS wrappers. Use `ProxyGateway.handle(request)` directly from your application, or use separate framework adapter packages when they are available. Framework routes must preserve the raw `proxy-fetch.v1` request body bytes before calling the gateway.

## Configuration

The gateway accepts plain JavaScript objects. It does not load `.env`, YAML, JSON5, TOML, secret stores, or process-level configuration by itself.

Typical application setup:

```ts
const config = loadAppConfigSomewhereElse();

const gateway = createProxyGateway({
  providers: createProviders(config.providers),
  pipelines: config.proxyGateway.pipelines,
  targetAccess: config.proxyGateway.targetAccess,
});
```

This keeps application-specific configuration and secrets outside the gateway package.

## Compatibility Notes

- Supported runtime: Node.js 20 or newer.
- Runtime package dependencies: none.
- Provider packages should depend on this package through peer dependencies.
- Advanced DNS, GeoIP, exit verification, probe targets, framework bindings, and provider integrations should be provided by companion packages or user code.

## License

MIT
