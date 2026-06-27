# @echospecter/proxy-gateway

Provider-agnostic execution gateway for `@echospecter/proxy-fetch`.

`@echospecter/proxy-gateway` receives `proxy-fetch.v1` service requests, applies routing and safety policy, acquires a route from a selected provider adapter, executes the target request through a target transport, and returns a `proxy-fetch.v1` response envelope that `@echospecter/proxy-fetch` can reconstruct as a native `Response`.

It is intended for applications that want a Fetch-like client API while centralizing proxy credentials, routing policy, retries, fallback, and target access controls on the server side.

## Status

`0.2.x` is the current public line. The package focuses on the provider-agnostic gateway core and a thin Node HTTP integration surface. Provider integrations, framework integrations, GeoIP integrations, Tor adapters, probe targets, and config loaders are expected to live in separate packages or user applications.

## Installation

```sh
npm install @echospecter/proxy-gateway
```

The core package does not ship provider integrations or a production proxy transport. A working gateway needs:

- at least one `ProxyProviderAdapter` that acquires a provider-agnostic route;
- a `TargetTransportPort` that executes the target request through that route.

The Quick Start below uses a minimal direct provider and native `fetch` transport so it can run without third-party provider packages.

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
  -> target transport
  -> target server
  -> proxy-fetch.v1 response
  -> native Response
```

Target HTTP statuses are normal target responses by default. A target `404`, `403`, `429`, `500`, or `503` is not a gateway failure unless your route policy explicitly retries or rejects that status.

## Quick Start

The safest first transport is a direct smoke transport that does not automatically follow redirects. It returns target `3xx` responses to the client as normal target responses. If your application needs redirect following, use the guarded variant below and validate every `Location` through `finalUrlGuard` before making the next request.

```ts
import {
  createProxyGateway,
  PROXY_PLAN_KIND,
  PROXY_ROUTE_KIND,
  TARGET_ACCESS_RESULT_KIND,
  type GatewayBody,
  type GatewayTargetResponse,
  type ProxyProviderInstance,
  type TargetTransportExecuteInput,
  type TargetTransportPort,
} from '@echospecter/proxy-gateway';

const MAX_QUICK_START_REDIRECTS = 10;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const REQUEST_BODY_HEADER_NAMES = new Set([
  'content-length',
  'content-type',
  'transfer-encoding',
]);

function toFetchBody(body: GatewayBody): BodyInit | undefined {
  if (body.kind === 'none') {
    return undefined;
  }
  if (body.kind === 'text') {
    return body.text;
  }
  if (body.kind === 'bytes') {
    return new Uint8Array(body.bytes);
  }

  throw new Error('This quick-start transport only supports buffered request bodies.');
}

function toGatewayBody(response: Response): GatewayTargetResponse['body'] {
  if (response.body === null) {
    return {
      kind: 'none',
      replayability: 'replayable',
    };
  }

  return {
    kind: 'stream',
    replayability: 'non-replayable',
    stream: response.body,
  };
}

function toGatewayTargetResponse(
  response: Response,
  redirected = response.redirected,
): GatewayTargetResponse {
  return {
    body: toGatewayBody(response),
    headers: Array.from(response.headers.entries()),
    redirected,
    status: response.status,
    statusText: response.statusText,
    type: response.type,
    url: response.url,
  };
}

const directProvider: ProxyProviderInstance = {
  id: 'direct',
  adapter: {
    kind: 'direct',
    getCapabilities: () => ({}),
    acquire: async (input) => ({
      id: `${input.requestId}:direct`,
      providerInstanceId: input.providerInstanceId,
      providerKind: 'direct',
      route: {
        kind: PROXY_ROUTE_KIND.DIRECT,
      },
    }),
  },
};

const manualRedirectDirectTransport: TargetTransportPort = {
  supportsRoute: (route) => route.kind === PROXY_ROUTE_KIND.DIRECT,
  execute: async (input) => {
    const response = await fetch(input.target.url, {
      body: toFetchBody(input.target.body),
      headers: input.target.headers,
      method: input.target.method,
      redirect: 'manual',
      signal: input.signal,
    });

    return toGatewayTargetResponse(response);
  },
};

const guardedRedirectFollowingDirectTransport: TargetTransportPort = {
  supportsRoute: (route) => route.kind === PROXY_ROUTE_KIND.DIRECT,
  execute: async (input) => executeWithGuardedRedirectFollowing(input),
};

async function executeWithGuardedRedirectFollowing(
  input: TargetTransportExecuteInput,
): Promise<GatewayTargetResponse> {
  const originalBody = toFetchBody(input.target.body);
  let body = isBodylessMethod(input.target.method) ? undefined : originalBody;
  let headers = input.target.headers;
  let method = input.target.method;
  let url = input.target.url;

  for (let redirectCount = 0; redirectCount <= MAX_QUICK_START_REDIRECTS; redirectCount += 1) {
    const response = await fetch(url, {
      body,
      headers,
      method,
      redirect: 'manual',
      signal: input.signal,
    });
    const redirectUrl = readRedirectUrl(response, url);

    if (redirectUrl === undefined) {
      return toGatewayTargetResponse(response, redirectCount > 0);
    }
    if (redirectCount === MAX_QUICK_START_REDIRECTS) {
      await response.body?.cancel();
      throw new Error('Too many target redirects.');
    }

    const guardResult = input.finalUrlGuard?.check({
      baseUrl: url,
      url: redirectUrl,
    });

    if (guardResult?.kind === TARGET_ACCESS_RESULT_KIND.REJECTED) {
      await response.body?.cancel();
      throw new Error(guardResult.message);
    }

    await response.body?.cancel();

    const nextRequest = createRedirectRequest({
      body: originalBody,
      headers,
      method,
      status: response.status,
    });

    body = nextRequest.body;
    headers = nextRequest.headers;
    method = nextRequest.method;
    url = redirectUrl;
  }

  throw new Error('Too many target redirects.');
}

function readRedirectUrl(response: Response, baseUrl: string): string | undefined {
  if (!REDIRECT_STATUSES.has(response.status)) {
    return undefined;
  }

  const location = response.headers.get('location');

  return location === null ? undefined : new URL(location, baseUrl).toString();
}

function createRedirectRequest(input: {
  body: BodyInit | undefined;
  headers: Array<[string, string]>;
  method: string;
  status: number;
}): {
  body: BodyInit | undefined;
  headers: Array<[string, string]>;
  method: string;
} {
  const method = shouldRewriteRedirectToGet(input.status, input.method)
    ? 'GET'
    : input.method;

  return {
    body: isBodylessMethod(method) ? undefined : input.body,
    headers: isBodylessMethod(method)
      ? removeRequestBodyHeaders(input.headers)
      : input.headers,
    method,
  };
}

function shouldRewriteRedirectToGet(status: number, method: string): boolean {
  const normalizedMethod = method.toUpperCase();

  return (
    status === 303
    || ((status === 301 || status === 302) && normalizedMethod === 'POST')
  );
}

function isBodylessMethod(method: string): boolean {
  const normalizedMethod = method.toUpperCase();

  return normalizedMethod === 'GET' || normalizedMethod === 'HEAD';
}

function removeRequestBodyHeaders(headers: Array<[string, string]>): Array<[string, string]> {
  return headers.filter(([name]) => !REQUEST_BODY_HEADER_NAMES.has(name.toLowerCase()));
}

const gateway = createProxyGateway({
  providers: [directProvider],
  transport: manualRedirectDirectTransport,
  // To follow redirects, replace the transport with:
  // transport: guardedRedirectFollowingDirectTransport,
  plan: {
    kind: PROXY_PLAN_KIND.FALLBACK,
    attempts: [
      {
        provider: 'direct',
      },
    ],
  },
});

export async function handleProxyFetchRequest(request: Request): Promise<Response> {
  return gateway.handle(request);
}
```

The guarded redirect-following transport fails closed when `finalUrlGuard` rejects a redirect target. It is still a minimal direct smoke transport, not a production proxy transport. Production transports should implement the route protocols they claim to support, preserve proxy DNS behavior, enforce their own redirect limits, and call `finalUrlGuard` before every redirected request.

Your application is responsible for loading secrets and configuration. Pass ready-to-use provider adapters, transports, and plain JavaScript objects to the gateway.

To run the gateway with plain Node HTTP:

```ts
import { createServer } from 'node:http';
import { createNodeHttpHandler } from '@echospecter/proxy-gateway';

createServer(createNodeHttpHandler(gateway)).listen(3000);
```

Then point `@echospecter/proxy-fetch` at that service endpoint:

```ts
import { createProxyFetch } from '@echospecter/proxy-fetch';

const proxyFetch = createProxyFetch({
  serviceUrl: 'http://localhost:3000/',
});

const response = await proxyFetch('https://example.com/');

console.log(response.status);
```

## Public API

```ts
export interface ProxyGateway {
  handle(request: Request): Promise<Response>;
}

export interface ProxyGatewayOptions {
  providers: ProxyProviderInstance[];
  routes?: Array<ProxyRouteConfig<ProxyPlanConfig, ProxyRouteRequirements>>;
  defaultRoute?: ProxyDefaultRouteConfig<ProxyPlanConfig, ProxyRouteRequirements>;
  exitVerifier?: ProxyExitVerifierPort;
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
import {
  PROXY_DNS_MODE,
  PROXY_PROTOCOL,
  PROXY_ROUTE_AUTH_MODE,
  PROXY_ROUTE_KIND,
  type DirectRoute,
  type ForwardProxyRoute,
} from '@echospecter/proxy-gateway';

const directRoute: DirectRoute = {
  kind: PROXY_ROUTE_KIND.DIRECT,
};

const socks5hRoute: ForwardProxyRoute = {
  kind: PROXY_ROUTE_KIND.FORWARD_PROXY,
  protocol: PROXY_PROTOCOL.SOCKS5H,
  host: '127.0.0.1',
  port: 9050,
  auth: { mode: PROXY_ROUTE_AUTH_MODE.NONE },
  dns: PROXY_DNS_MODE.PROXY,
};
```

Use `socks5h` with proxy DNS when the hostname must be resolved by the proxy, such as Tor-like or privacy-sensitive routes. Do not use `socks5` when remote DNS is required.

## Route Configuration

Use `routes` when target requests should select different configured plans by host, path, URL, or method. Use `defaultRoute` when unmatched requests should still have a planned execution path.

```ts
import {
  createProxyGateway,
  PROXY_GEO_STRICTNESS,
  PROXY_NETWORK_TYPE,
  PROXY_PLAN_KIND,
  RETRY_CONDITION,
  STRING_MATCHER_KIND,
  type ProxyDefaultRouteConfig,
  type ProxyPlanConfig,
  type ProxyRouteConfig,
  type ProxyRouteRequirements,
} from '@echospecter/proxy-gateway';

const gbRequirements: ProxyRouteRequirements = {
  geo: {
    country: 'GB',
    strictness: PROXY_GEO_STRICTNESS.REQUIRED,
  },
  networkTypes: [PROXY_NETWORK_TYPE.RESIDENTIAL],
};

const routes: Array<ProxyRouteConfig<ProxyPlanConfig, ProxyRouteRequirements>> = [
  {
    id: 'search-gb',
    priority: 100,
    match: {
      host: { type: STRING_MATCHER_KIND.SUFFIX, value: 'google.com' },
      method: ['GET', 'POST'],
    },
    requirements: gbRequirements,
    plan: {
      kind: PROXY_PLAN_KIND.FALLBACK,
      attempts: [
        {
          provider: 'primary-residential-gb',
          maxAttempts: 2,
          timeoutMs: 15_000,
          retryOn: [
            RETRY_CONDITION.PROXY_TIMEOUT,
            RETRY_CONDITION.TARGET_NETWORK_ERROR,
            RETRY_CONDITION.HTTP_429,
          ],
        },
        {
          provider: 'fallback-residential-gb',
          maxAttempts: 1,
          timeoutMs: 20_000,
          retryOn: [
            RETRY_CONDITION.PROXY_TIMEOUT,
            RETRY_CONDITION.TARGET_NETWORK_ERROR,
          ],
        },
      ],
    },
  },
];

const defaultRoute: ProxyDefaultRouteConfig<ProxyPlanConfig, ProxyRouteRequirements> = {
  id: 'default-direct',
  plan: {
    kind: PROXY_PLAN_KIND.FALLBACK,
    attempts: [{ provider: 'direct-provider' }],
  },
};

const transport = manualRedirectDirectTransport; // Reuse or replace the TargetTransportPort from the Quick Start.

const gateway = createProxyGateway({
  providers,
  routes,
  defaultRoute,
  transport,
});
```

Higher-priority routes are checked first, and equal priority keeps declaration order. If no route matches and no `defaultRoute` is configured, the gateway returns a service-level routing error.

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

Built-in step names are available through `PIPELINE_STEP_TYPE` and can also be represented as strings in JSON configuration. Common built-ins include:

- `requirements.geo` for country/region/ASN requirements;
- `requirements.identity` for sticky or per-request identity requirements;
- `requirements.verification` for exit verification requirements;
- `providers.tags` for tag-based provider filtering;
- `providers.priority` for priority-based provider ordering;
- `providers.weighted` for weighted provider ordering;
- `plan.fallback` for fallback execution plans.

Example:

```ts
import {
  PIPELINE_STEP_TYPE,
  PROXY_GEO_STRICTNESS,
  RETRY_CONDITION,
  STRING_MATCHER_KIND,
  type ProxyPipelineConfig,
} from '@echospecter/proxy-gateway';

const pipelines: ProxyPipelineConfig[] = [
  {
    id: 'serp-gb',
    priority: 100,
    when: {
      host: { type: STRING_MATCHER_KIND.SUFFIX, value: 'google.com' },
    },
    require: [
      {
        use: PIPELINE_STEP_TYPE.REQUIREMENTS_GEO,
        args: {
          country: 'GB',
          strictness: PROXY_GEO_STRICTNESS.REQUIRED,
        },
      },
    ],
    select: [
      {
        use: PIPELINE_STEP_TYPE.PROVIDERS_TAGS,
        args: { tags: ['residential', 'gb'] },
      },
    ],
    rank: [
      {
        use: PIPELINE_STEP_TYPE.PROVIDERS_PRIORITY,
      },
    ],
    plan: [
      {
        use: PIPELINE_STEP_TYPE.PLAN_FALLBACK,
        args: {
          attempts: [
            {
              maxAttempts: 2,
              timeoutMs: 15_000,
              retryOn: [
                RETRY_CONDITION.PROXY_TIMEOUT,
                RETRY_CONDITION.TARGET_NETWORK_ERROR,
                RETRY_CONDITION.HTTP_429,
              ],
            },
          ],
        },
      },
    ],
  },
];
```

Route/default-route requirements feed pipelines as base requirements. Selected pipeline plans win over route/default/direct plans. If configured pipelines skip or complete without a plan, the gateway falls through to the selected route/default plan or direct `plan`. When `pipelines` is configured, the gateway does not silently pick the first enabled provider after pipeline fallthrough.

If you need fully custom routing, provide explicit plans or custom pipeline steps from application code.

## Sessions

Sticky-session behavior is configured through route or pipeline requirements and a session store.

```ts
import {
  createMemoryProxySessionStore,
  createProxyGateway,
  PROXY_PLAN_KIND,
  PROXY_IDENTITY_ISOLATION_SCOPE,
  PROXY_IDENTITY_ROTATION,
  STRING_MATCHER_KIND,
} from '@echospecter/proxy-gateway';

const stickyIdentity = {
  rotation: PROXY_IDENTITY_ROTATION.STICKY,
  stickySessionId: 'google-search-session',
  stickySessionTtlMs: 10 * 60 * 1000,
  isolationScope: [
    PROXY_IDENTITY_ISOLATION_SCOPE.TENANT,
    PROXY_IDENTITY_ISOLATION_SCOPE.FLOW,
    PROXY_IDENTITY_ISOLATION_SCOPE.ROUTE,
    PROXY_IDENTITY_ISOLATION_SCOPE.TARGET_HOST,
  ],
};

const transport = manualRedirectDirectTransport; // Reuse or replace the TargetTransportPort from the Quick Start.

const gateway = createProxyGateway({
  providers,
  transport,
  routes: [
    {
      id: 'sticky-search',
      match: { host: { type: STRING_MATCHER_KIND.SUFFIX, value: 'google.com' } },
      requirements: {
        identity: stickyIdentity,
      },
      plan: {
        kind: PROXY_PLAN_KIND.FALLBACK,
        attempts: [{ provider: 'primary-residential-gb' }],
      },
    },
  ],
  sessionStore: createMemoryProxySessionStore(),
});
```

Sticky-session records are read before planning and written after a successful attempt. Expired records are treated as misses and can be cleaned up by the gateway read path. `requestNewIdentity: true` bypasses an existing sticky record and replaces it after a successful attempt. Applications that need shared or durable sticky sessions can implement `ProxySessionStorePort`.

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
import { STRING_MATCHER_KIND } from '@echospecter/proxy-gateway';

const matcher = {
  type: STRING_MATCHER_KIND.REGEXP,
  source: '(^|\\.)google\\.com$',
  flags: 'i',
};
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
import {
  RETRY_CONDITION,
  type ProxyPlanAttemptConfig,
} from '@echospecter/proxy-gateway';

const attempt: ProxyPlanAttemptConfig = {
  provider: 'primary-residential-gb',
  maxAttempts: 3,
  timeoutMs: 15_000,
  retryOn: [
    RETRY_CONDITION.PROXY_TIMEOUT,
    RETRY_CONDITION.PROXY_CONNECTION_ERROR,
    RETRY_CONDITION.TARGET_NETWORK_ERROR,
    RETRY_CONDITION.HTTP_403,
    RETRY_CONDITION.HTTP_429,
  ],
};
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
  allowedHosts?: StringMatcher[];
  allowLocalhost?: boolean;
  allowOnionHosts?: boolean;
  allowLinkLocalIps?: boolean;
  allowPrivateIps?: boolean;
  allowedSchemes?: string[];
  deniedCidrs?: string[];
  deniedHosts?: StringMatcher[];
  onionRequiresNetworkType?: PROXY_NETWORK_TYPE.TOR;
}
```

Default policy should allow only `http:` and `https:` targets and deny localhost, private, link-local, and `.onion` targets. Redirect targets must be checked too.

Configure explicit allow rules only for trusted internal deployments and tests.

## Redaction

Logs, telemetry events, service errors, and diagnostics should not expose secrets.

```ts
export interface RedactionPolicy {
  headerNames?: readonly string[];
  metadataKeyNames?: readonly string[];
  queryParamNames?: readonly string[];
  replacement?: string;
}
```

Commonly redacted headers include `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-api-key`, and `x-auth-token`.

Commonly redacted query parameters include `api_key`, `access_token`, `token`, `password`, `secret`, and `key`.

## Tor and SOCKS5H

Tor is represented by ordinary provider adapters and route capabilities. There is no gateway-level `useTor` mode.

Tor-like providers should generally return `socks5h` routes with proxy DNS:

```ts
import {
  PROXY_DNS_MODE,
  PROXY_PROTOCOL,
  PROXY_ROUTE_AUTH_MODE,
  PROXY_ROUTE_KIND,
  type ForwardProxyRoute,
} from '@echospecter/proxy-gateway';

const torLikeRoute: ForwardProxyRoute = {
  kind: PROXY_ROUTE_KIND.FORWARD_PROXY,
  protocol: PROXY_PROTOCOL.SOCKS5H,
  host: '127.0.0.1',
  port: 9050,
  auth: { mode: PROXY_ROUTE_AUTH_MODE.NONE },
  dns: PROXY_DNS_MODE.PROXY,
};
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

The core package does not export Express, Fastify, or NestJS wrappers. Use `ProxyGateway.handle(request)` directly from your application, or use separate framework adapter packages when they are available. Framework routes must preserve the raw `proxy-fetch.v1` request body bytes before calling the gateway.

Provider adapter packages should stay framework-agnostic too. For example, a Bright Data adapter package should expose a plain `ProxyProviderAdapter`; a separate NestJS package can wrap configuration, dependency injection, lifecycle hooks, and module wiring around that universal adapter.

## Configuration

The gateway accepts plain JavaScript objects. It does not load `.env`, YAML, JSON5, TOML, secret stores, or process-level configuration by itself.

Typical application setup:

```ts
const config = loadAppConfigSomewhereElse();

const gateway = createProxyGateway({
  providers: createProviders(config.providers),
  pipelines: config.proxyGateway.pipelines,
  targetAccess: config.proxyGateway.targetAccess,
  transport: createTargetTransport(config.transport),
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
