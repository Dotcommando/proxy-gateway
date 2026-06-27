import {
  createNodeHttpHandler,
  createMemoryProxySessionStore,
  createProxyGateway,
  PIPELINE_STEP_TYPE,
  PROXY_GEO_STRICTNESS,
  PROXY_IDENTITY_ISOLATION_SCOPE,
  PROXY_IDENTITY_ROTATION,
  PROXY_PLAN_KIND,
  PROXY_PROVIDER_COUNTRY_SELECTION,
  PROXY_PROVIDER_GEO_MODE,
  PROXY_ROUTE_KIND,
  TARGET_ACCESS_RESULT_KIND,
  type GatewayTargetResponse,
  type NodeHttpHandler,
  type ProxyDefaultRouteConfig,
  type ProxyGateway,
  type ProxyGatewayOptions,
  type ProxyIdentityRequirements,
  type ProxyPipelineConfig,
  type ProxyPlanConfig,
  type ProxyProviderCapabilities,
  type ProxyProviderCandidate,
  type ProxyProviderInstance,
  type ProxyRouteConfig,
  type ProxyRouteRequirements,
  type ProxySessionStorePort,
  type TargetFinalUrlGuardPort,
  type TargetTransportExecuteInput,
  type TargetTransportPort,
} from '@echospecter/proxy-gateway';

const targetResponse: GatewayTargetResponse = {
  body: {
    kind: 'text',
    replayability: 'replayable',
    text: 'typed response',
  },
  headers: [['content-type', 'text/plain']],
  redirected: false,
  status: 200,
  statusText: 'OK',
  type: 'basic',
  url: 'https://example.test/typed',
};
const finalUrlGuard: TargetFinalUrlGuardPort = {
  check: () => ({
    kind: TARGET_ACCESS_RESULT_KIND.ALLOWED,
  }),
};
const transport: TargetTransportPort = {
  execute: async (input: TargetTransportExecuteInput) => {
    input.finalUrlGuard?.check({
      url: 'https://example.test/final',
    });

    return targetResponse;
  },
};
const identity: ProxyIdentityRequirements = {
  isolationKey: 'typed-market',
  isolationScope: [
    PROXY_IDENTITY_ISOLATION_SCOPE.TENANT,
    PROXY_IDENTITY_ISOLATION_SCOPE.FLOW,
    PROXY_IDENTITY_ISOLATION_SCOPE.ROUTE,
  ],
  rotation: PROXY_IDENTITY_ROTATION.STICKY,
  stickySessionId: 'typed-session',
  stickySessionTtlMs: 60_000,
};
const identityStepArgs: Record<string, unknown> = {
  isolationKey: identity.isolationKey,
  isolationScope: identity.isolationScope,
  rotation: identity.rotation,
  stickySessionId: identity.stickySessionId,
  stickySessionTtlMs: identity.stickySessionTtlMs,
};
const routeRequirements: ProxyRouteRequirements = {
  geo: {
    country: 'DE',
    strictness: PROXY_GEO_STRICTNESS.REQUIRED,
  },
  identity,
  providerInstanceIds: ['typed-provider'],
};
const plan: ProxyPlanConfig = {
  attempts: [
    {
      requirements: routeRequirements,
    },
  ],
  kind: PROXY_PLAN_KIND.FALLBACK,
};
const route: ProxyRouteConfig<ProxyPlanConfig, ProxyRouteRequirements> = {
  id: 'typed-route',
  match: {
    host: 'example.test',
  },
  plan,
  requirements: routeRequirements,
};
const defaultRoute: ProxyDefaultRouteConfig<ProxyPlanConfig, ProxyRouteRequirements> = {
  id: 'typed-default',
  plan,
};
const pipeline: ProxyPipelineConfig = {
  id: 'typed-pipeline',
  plan: [
    {
      use: PIPELINE_STEP_TYPE.PLAN_FALLBACK,
    },
  ],
  require: [
    {
      args: {
        country: 'DE',
        strictness: PROXY_GEO_STRICTNESS.REQUIRED,
      },
      use: PIPELINE_STEP_TYPE.REQUIREMENTS_GEO,
    },
    {
      args: identityStepArgs,
      use: PIPELINE_STEP_TYPE.REQUIREMENTS_IDENTITY,
    },
  ],
  select: [
    {
      args: {
        tags: ['typed'],
      },
      use: PIPELINE_STEP_TYPE.PROVIDERS_TAGS,
    },
  ],
};
const providerCapabilities: ProxyProviderCapabilities = {
  geo: {
    countries: ['DE'],
    countrySelection: PROXY_PROVIDER_COUNTRY_SELECTION.PROVIDER_CONFIG,
    mode: PROXY_PROVIDER_GEO_MODE.GUARANTEED,
  },
};
const providerCandidate: ProxyProviderCandidate = {
  capabilities: providerCapabilities,
  providerInstanceId: 'typed-provider',
  providerKind: 'typed',
  tags: ['typed'],
};
const providerInstance: ProxyProviderInstance = {
  adapter: {
    acquire: async () => ({
      id: 'typed-lease',
      providerInstanceId: 'typed-provider',
      providerKind: 'typed',
      route: {
        kind: PROXY_ROUTE_KIND.DIRECT,
      },
    }),
    getCapabilities: () => providerCapabilities,
    kind: 'typed',
  },
  id: 'typed-provider',
  tags: ['typed'],
};
const sessionStore: ProxySessionStorePort = createMemoryProxySessionStore();
const options: ProxyGatewayOptions = {
  defaultRoute,
  pipelines: [pipeline],
  providers: [providerInstance],
  routes: [route],
  sessionStore,
  transport,
};
const gateway: ProxyGateway = createProxyGateway(options);
const handler: NodeHttpHandler = createNodeHttpHandler(gateway);

finalUrlGuard.check({
  url: 'https://example.test/final',
});

void handler;
void providerCandidate;
