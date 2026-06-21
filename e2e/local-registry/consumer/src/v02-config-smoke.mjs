import {
  createMemoryProxySessionStore,
  createProxyGateway,
  PIPELINE_STEP_TYPE,
  PROXY_GEO_STRICTNESS,
  PROXY_IDENTITY_ROTATION,
  PROXY_PLAN_KIND,
  PROXY_PROVIDER_COUNTRY_SELECTION,
  PROXY_PROVIDER_GEO_MODE,
  PROXY_ROUTE_KIND,
  WIRE_PROTOCOL_VERSION
} from '@echospecter/proxy-gateway';

const stickyIdentity = {
  isolationKey: 'consumer-market',
  rotation: PROXY_IDENTITY_ROTATION.STICKY,
  stickySessionId: 'consumer-session',
  stickySessionTtlMs: 60_000
};
const targetUrl = 'https://api.example.test/v1/resource';
const requestContext = {
  flowKey: 'flow-a',
  routeKey: 'route-a',
  tenantId: 'tenant-a'
};

await assertRouteAndDefaultRouteConfig();
await assertPipelineBuiltInsConfig();
await assertStickySessionReuse();

console.log('v0.2 config: ok');

async function assertRouteAndDefaultRouteConfig() {
  const acquiredProviderIds = [];
  const gateway = createProxyGateway({
    defaultRoute: {
      id: 'default',
      plan: fallbackPlan('default-provider')
    },
    providers: [
      provider('route-provider', acquiredProviderIds),
      provider('default-provider', acquiredProviderIds)
    ],
    routes: [
      {
        id: 'api',
        match: {
          host: 'api.example.test'
        },
        plan: fallbackPlan('route-provider')
      }
    ],
    transport: okTransport()
  });

  await expectOk(gateway, proxyFetchJsonRequest({
    url: targetUrl
  }), 'route/default route config matched route');
  await expectOk(gateway, proxyFetchJsonRequest({
    url: 'https://unknown.example.test/v1/resource'
  }), 'route/default route config used default route');

  expectEqual(acquiredProviderIds, ['route-provider', 'default-provider'], 'route/default route provider order');
}

async function assertPipelineBuiltInsConfig() {
  const acquiredProviderIds = [];
  const gateway = createProxyGateway({
    pipelines: [
      {
        id: 'pipeline-built-ins',
        plan: [
          {
            use: PIPELINE_STEP_TYPE.PLAN_FALLBACK
          }
        ],
        rank: [
          {
            use: PIPELINE_STEP_TYPE.PROVIDERS_PRIORITY
          }
        ],
        require: [
          {
            args: {
              country: 'DE',
              strictness: PROXY_GEO_STRICTNESS.REQUIRED
            },
            use: PIPELINE_STEP_TYPE.REQUIREMENTS_GEO
          }
        ],
        select: [
          {
            args: {
              tags: ['residential']
            },
            use: PIPELINE_STEP_TYPE.PROVIDERS_TAGS
          }
        ]
      }
    ],
    providers: [
      provider('datacenter-provider', acquiredProviderIds, {
        priority: 100,
        tags: ['datacenter']
      }),
      provider('residential-low', acquiredProviderIds, {
        priority: 1,
        tags: ['residential']
      }),
      provider('residential-high', acquiredProviderIds, {
        priority: 10,
        tags: ['residential']
      })
    ],
    transport: okTransport()
  });

  await expectOk(gateway, proxyFetchJsonRequest(), 'pipeline built-ins config');

  expectEqual(acquiredProviderIds, ['residential-high'], 'pipeline selected highest priority residential provider');
}

async function assertStickySessionReuse() {
  const sessionStore = createMemoryProxySessionStore();
  const firstAcquiredProviderIds = [];
  const secondAcquiredProviderIds = [];
  const firstGateway = createProxyGateway({
    pipelines: [
      {
        id: 'sticky-write',
        plan: [
          {
            args: {
              attempts: [
                {
                  provider: 'sticky-provider-b',
                  requirements: {
                    identity: stickyIdentity
                  }
                }
              ]
            },
            use: PIPELINE_STEP_TYPE.PLAN_FALLBACK
          }
        ]
      }
    ],
    providers: [
      provider('sticky-provider-a', firstAcquiredProviderIds),
      provider('sticky-provider-b', firstAcquiredProviderIds)
    ],
    sessionStore,
    transport: okTransport()
  });

  await expectOk(firstGateway, proxyFetchJsonRequest(), 'sticky session initial write');
  expectEqual(firstAcquiredProviderIds, ['sticky-provider-b'], 'sticky initial provider');

  const secondGateway = createProxyGateway({
    pipelines: [
      {
        id: 'sticky-read',
        plan: [
          {
            args: {
              attempts: [
                {
                  requirements: {
                    identity: stickyIdentity
                  }
                }
              ]
            },
            use: PIPELINE_STEP_TYPE.PLAN_FALLBACK
          }
        ]
      }
    ],
    providers: [
      provider('sticky-provider-a', secondAcquiredProviderIds),
      provider('sticky-provider-b', secondAcquiredProviderIds)
    ],
    sessionStore,
    transport: okTransport()
  });

  await expectOk(secondGateway, proxyFetchJsonRequest(), 'sticky session reuse');
  expectEqual(secondAcquiredProviderIds, ['sticky-provider-b'], 'sticky reused provider');
}

function fallbackPlan(providerInstanceId) {
  return {
    attempts: [
      {
        provider: providerInstanceId
      }
    ],
    kind: PROXY_PLAN_KIND.FALLBACK
  };
}

function provider(id, acquiredProviderIds, options = {}) {
  return {
    adapter: {
      async acquire() {
        acquiredProviderIds.push(id);

        return {
          id: `${id}-lease`,
          providerInstanceId: id,
          providerKind: 'local-consumer',
          route: {
            kind: PROXY_ROUTE_KIND.DIRECT
          }
        };
      },
      async getCapabilities() {
        return options.capabilities ?? geoCapabilities();
      },
      kind: 'local-consumer'
    },
    id,
    ...(options.priority === undefined ? {} : { priority: options.priority }),
    ...(options.tags === undefined ? {} : { tags: options.tags })
  };
}

function geoCapabilities() {
  return {
    geo: {
      countries: ['DE'],
      countrySelection: PROXY_PROVIDER_COUNTRY_SELECTION.PROVIDER_CONFIG,
      mode: PROXY_PROVIDER_GEO_MODE.GUARANTEED
    }
  };
}

function okTransport() {
  return {
    async execute(input) {
      const targetUrlValue = input.target.url instanceof URL
        ? input.target.url.href
        : String(input.target.url);

      return {
        body: {
          kind: 'text',
          text: `v0.2 config reached target: ${targetUrlValue}`
        },
        headers: [
          ['content-type', 'text/plain; charset=utf-8']
        ],
        redirected: false,
        status: 200,
        statusText: 'OK',
        type: 'basic',
        url: targetUrlValue
      };
    }
  };
}

function proxyFetchJsonRequest(overrides = {}) {
  return new Request('http://local-gateway/proxy-fetch', {
    body: JSON.stringify({
      context: overrides.context ?? requestContext,
      options: {
        timeoutMs: 5000
      },
      request: {
        body: null,
        headers: [],
        method: overrides.method ?? 'GET',
        url: overrides.url ?? targetUrl
      },
      version: WIRE_PROTOCOL_VERSION
    }),
    headers: {
      accept: 'application/json',
      'content-type': 'application/json'
    },
    method: 'POST'
  });
}

async function expectOk(gateway, request, label) {
  const response = await gateway.handle(request);
  const envelope = await response.json();

  if (response.status !== 200) {
    throw new Error(`${label}: expected HTTP 200 service response, got ${response.status}: ${JSON.stringify(envelope)}`);
  }
  if (envelope.ok !== true) {
    throw new Error(`${label}: expected ok=true service envelope: ${JSON.stringify(envelope)}`);
  }
  if (envelope.response?.status !== 200) {
    throw new Error(`${label}: expected target status 200: ${JSON.stringify(envelope)}`);
  }
}

function expectEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
