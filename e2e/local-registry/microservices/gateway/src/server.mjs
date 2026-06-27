import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

import {
  createMemoryProxySessionStore,
  createNodeHttpHandler,
  createProxyGateway,
  PIPELINE_STEP_TYPE,
  PROXY_GEO_STRICTNESS,
  PROXY_IDENTITY_ROTATION,
  PROXY_PLAN_KIND,
  PROXY_PROTOCOL,
  PROXY_ROUTE_AUTH_MODE,
  PROXY_PROVIDER_GEO_MODE,
  PROXY_ROUTE_KIND,
  RETRY_CONDITION,
  STRING_MATCHER_KIND,
} from '@echospecter/proxy-gateway';

const port = Number.parseInt(process.env.MICRO_GATEWAY_PORT ?? '8080', 10);
const providerBaseUrl =
  process.env.MICRO_PROVIDER_BASE_URL ?? 'http://localhost:8081';
const observations = [];
const providerInstanceId = 'micro-provider';
const providerKind = 'mock-provider';
const sessionStore = createMemoryProxySessionStore();
const gatewayHandler = createNodeHttpHandler(createGateway());
const noRouteGatewayHandler = createNodeHttpHandler(createNoRouteGateway());

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    writeJson(response, 200, {
      ok: true,
      service: 'micro-gateway',
    });
    return;
  }

  if (request.method === 'GET' && request.url === '/package-source') {
    writePackageSource(response).catch((error) => {
      writeJson(response, 500, {
        error: 'package_source_unavailable',
        message: error instanceof Error ? error.message : 'unknown error',
      });
    });
    return;
  }

  if (request.method === 'GET' && request.url === '/observations') {
    writeJson(response, 200, {
      items: observations,
    });
    return;
  }

  if (request.method === 'POST' && request.url === '/observations/reset') {
    observations.length = 0;
    writeJson(response, 200, {
      ok: true,
    });
    return;
  }

  if (request.method === 'POST' && request.url === '/fetch') {
    if (request.headers['x-client-boundary-observe-service'] !== undefined) {
      observations.push({
        headers: readIncomingHeaders(request.headers),
        method: request.method,
        path: request.url,
        type: 'service-request',
      });
    }

    gatewayHandler(request, response).catch((error) => {
      writeJson(response, 500, {
        error: 'gateway_handler_failed',
        message: error instanceof Error ? error.message : 'unknown error',
      });
    });
    return;
  }

  if (request.method === 'POST' && request.url === '/fetch-no-route') {
    noRouteGatewayHandler(request, response).catch((error) => {
      writeJson(response, 500, {
        error: 'gateway_handler_failed',
        message: error instanceof Error ? error.message : 'unknown error',
      });
    });
    return;
  }

  writeJson(response, 404, {
    error: 'not_found',
  });
});

server.listen(port, '0.0.0.0');

process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});

function writeJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function readIncomingHeaders(headers) {
  return Object.entries(headers).flatMap(([name, value]) => {
    if (value === undefined) {
      return [];
    }
    if (Array.isArray(value)) {
      return value.map((entry) => [name, String(entry)]);
    }

    return [[name, String(value)]];
  });
}

async function writePackageSource(response) {
  const packageJsonUrl = new URL(
    '../node_modules/@echospecter/proxy-gateway/package.json',
    import.meta.url,
  );
  const packageJson = JSON.parse(await readFile(packageJsonUrl, 'utf8'));

  writeJson(response, 200, {
    name: packageJson.name,
    registry: process.env.NPM_CONFIG_REGISTRY ?? null,
    version: packageJson.version,
  });
}

function createNoRouteGateway() {
  return createProxyGateway({
    providers: createProviders(),
    routes: [
      {
        id: 'no-route-control',
        match: {
          host: 'matched.error-redaction.example.com',
        },
        plan: fallbackPlan(providerInstanceId, {
          policyRouteId: 'no-route-control',
        }),
      },
    ],
    transport: createTransport(),
  });
}

function createGateway() {
  return createProxyGateway({
    bodyBuffering: {
      bufferRequestStreamsForRetry: true,
      bufferResponsesBeforeReturn: true,
      maxBufferedRequestBodyBytes: 4096,
      maxBufferedResponseBodyBytes: 25 * 1024 * 1024,
      rejectWhenRequestBufferExceeded: false,
      rejectWhenResponseBufferExceeded: true,
    },
    defaultRoute: {
      id: 'gateway-policy-default',
      plan: fallbackPlan(providerInstanceId, {
        policyRouteId: 'gateway-policy-default',
      }),
    },
    pipelines: [
      {
        id: 'sticky-session-write',
        plan: [
          {
            args: {
              attempts: [
                {
                  provider: 'sticky-provider-a',
                  requirements: {
                    identity: stickySessionIdentity(),
                  },
                },
              ],
            },
            use: PIPELINE_STEP_TYPE.PLAN_FALLBACK,
          },
        ],
        select: [
          {
            args: {
              providerInstanceIds: ['sticky-provider-a', 'sticky-provider-b'],
            },
            use: PIPELINE_STEP_TYPE.PROVIDERS_INCLUDE,
          },
        ],
        when: {
          path: {
            type: STRING_MATCHER_KIND.PREFIX,
            value: '/write',
          },
        },
      },
      {
        id: 'sticky-session-read',
        plan: [
          {
            args: {
              attempts: [
                {
                  requirements: {
                    identity: stickySessionIdentity(),
                  },
                },
              ],
            },
            use: PIPELINE_STEP_TYPE.PLAN_FALLBACK,
          },
        ],
        rank: [
          {
            use: PIPELINE_STEP_TYPE.PROVIDERS_PRIORITY,
          },
        ],
        select: [
          {
            args: {
              providerInstanceIds: ['sticky-provider-a', 'sticky-provider-b'],
            },
            use: PIPELINE_STEP_TYPE.PROVIDERS_INCLUDE,
          },
        ],
        when: {
          path: {
            type: STRING_MATCHER_KIND.PREFIX,
            value: '/read',
          },
        },
      },
      {
        id: 'gateway-policy-gb',
        plan: [
          {
            args: {
              attempts: [
                {
                  metadata: {
                    pipelineId: 'gateway-policy-gb',
                  },
                },
              ],
            },
            use: PIPELINE_STEP_TYPE.PLAN_FALLBACK,
          },
        ],
        rank: [
          {
            use: PIPELINE_STEP_TYPE.PROVIDERS_PRIORITY,
          },
        ],
        require: [
          {
            args: {
              country: 'GB',
              strictness: PROXY_GEO_STRICTNESS.REQUIRED,
            },
            use: PIPELINE_STEP_TYPE.REQUIREMENTS_GEO,
          },
        ],
        select: [
          {
            args: {
              tags: ['residential', 'gb'],
            },
            use: PIPELINE_STEP_TYPE.PROVIDERS_TAGS,
          },
        ],
        when: {
          host: 'pipeline-gb.policy.example.com',
        },
      },
      {
        id: 'gateway-policy-fallback',
        plan: [
          {
            args: {
              attempts: [
                {
                  metadata: {
                    pipelineId: 'gateway-policy-fallback',
                    policyAttemptId: 'primary',
                  },
                  provider: 'fallback-primary-provider',
                  retryOn: [RETRY_CONDITION.TARGET_NETWORK_ERROR],
                },
                {
                  metadata: {
                    pipelineId: 'gateway-policy-fallback',
                    policyAttemptId: 'secondary',
                  },
                  provider: 'fallback-secondary-provider',
                },
              ],
            },
            use: PIPELINE_STEP_TYPE.PLAN_FALLBACK,
          },
        ],
        select: [
          {
            args: {
              providerInstanceIds: [
                'fallback-primary-provider',
                'fallback-secondary-provider',
              ],
            },
            use: PIPELINE_STEP_TYPE.PROVIDERS_INCLUDE,
          },
        ],
        when: {
          host: 'fallback.policy.example.com',
        },
      },
      {
        id: 'retry-fallback-replayable',
        plan: retryFallbackPlan(),
        when: {
          host: 'retry-fallback.policy.example.com',
          path: {
            type: STRING_MATCHER_KIND.PREFIX,
            value: '/replayable',
          },
        },
      },
      {
        id: 'retry-fallback-non-replayable',
        plan: retryFallbackPlan(),
        when: {
          host: 'retry-fallback.policy.example.com',
          path: {
            type: STRING_MATCHER_KIND.PREFIX,
            value: '/non-replayable',
          },
        },
      },
      {
        id: 'retry-fallback-unsafe',
        plan: retryFallbackPlan(),
        when: {
          host: 'retry-fallback.policy.example.com',
          path: {
            type: STRING_MATCHER_KIND.PREFIX,
            value: '/unsafe',
          },
        },
      },
      {
        id: 'buffering-limit-request-non-replayable',
        plan: retryFallbackPlan(),
        when: {
          host: 'buffering-limit.policy.example.com',
          path: {
            type: STRING_MATCHER_KIND.PREFIX,
            value: '/request-non-replayable',
          },
        },
      },
      {
        id: 'timeout-abort-local',
        plan: timeoutAbortFallbackPlan({
          pipelineId: 'timeout-abort',
        }),
        when: {
          host: 'timeout-abort.policy.example.com',
          path: {
            type: STRING_MATCHER_KIND.PREFIX,
            value: '/local',
          },
        },
      },
      {
        id: 'timeout-abort-total',
        plan: timeoutAbortFallbackPlan({
          pipelineId: 'timeout-abort',
        }),
        when: {
          host: 'timeout-abort.policy.example.com',
          path: {
            type: STRING_MATCHER_KIND.PREFIX,
            value: '/total',
          },
        },
      },
      {
        id: 'timeout-abort-caller',
        plan: timeoutAbortFallbackPlan({
          pipelineId: 'timeout-abort',
        }),
        when: {
          host: 'timeout-abort.policy.example.com',
          path: {
            type: STRING_MATCHER_KIND.PREFIX,
            value: '/caller',
          },
        },
      },
      {
        id: 'timeout-abort-attempt',
        plan: timeoutAbortFallbackPlan({
          pipelineId: 'timeout-abort',
          primaryTimeoutMs: 75,
          retryOn: [RETRY_CONDITION.TARGET_TIMEOUT],
        }),
        when: {
          host: 'timeout-abort.policy.example.com',
          path: {
            type: STRING_MATCHER_KIND.PREFIX,
            value: '/attempt',
          },
        },
      },
    ],
    providers: createProviders(),
    routes: [
      {
        id: 'gateway-policy-host',
        match: {
          host: 'host.policy.example.com',
        },
        plan: fallbackPlan('route-host-provider', {
          policyRouteId: 'gateway-policy-host',
        }),
      },
      {
        id: 'gateway-policy-priority-low',
        match: {
          host: 'priority.policy.example.com',
        },
        plan: fallbackPlan('route-low-provider', {
          policyRouteId: 'gateway-policy-priority-low',
        }),
        priority: 1,
      },
      {
        id: 'gateway-policy-priority-high',
        match: {
          host: 'priority.policy.example.com',
        },
        plan: fallbackPlan('route-priority-provider', {
          policyRouteId: 'gateway-policy-priority-high',
        }),
        priority: 10,
      },
      {
        exclude: {
          path: {
            type: STRING_MATCHER_KIND.PREFIX,
            value: '/admin',
          },
        },
        id: 'gateway-policy-public',
        match: {
          host: 'exclude.policy.example.com',
        },
        plan: fallbackPlan('route-public-provider', {
          policyRouteId: 'gateway-policy-public',
        }),
        priority: 10,
      },
      {
        id: 'gateway-policy-exclude-fallback',
        match: {
          host: 'exclude.policy.example.com',
        },
        plan: fallbackPlan('route-exclude-provider', {
          policyRouteId: 'gateway-policy-exclude-fallback',
        }),
        priority: 1,
      },
    ],
    sessionStore,
    transport: createTransport(),
  });
}

function createProviders() {
  return [
    createProvider(providerInstanceId),
    createProvider('route-host-provider'),
    createProvider('route-low-provider'),
    createProvider('route-priority-provider'),
    createProvider('route-public-provider'),
    createProvider('route-exclude-provider'),
    createProvider('gb-low-provider', {
      capabilities: gbCapabilities(),
      priority: 1,
      tags: ['residential', 'gb'],
    }),
    createProvider('gb-high-provider', {
      capabilities: gbCapabilities(),
      priority: 10,
      tags: ['residential', 'gb'],
    }),
    createProvider('us-high-provider', {
      capabilities: {
        geo: {
          countries: ['US'],
          mode: PROXY_PROVIDER_GEO_MODE.GUARANTEED,
        },
      },
      priority: 100,
      tags: ['residential', 'us'],
    }),
    createProvider('fallback-primary-provider'),
    createProvider('fallback-secondary-provider'),
    createProvider('sticky-provider-a', {
      priority: 1,
    }),
    createProvider('sticky-provider-b', {
      priority: 10,
    }),
  ];
}

function createProvider(id, options = {}) {
  return {
    adapter: {
      acquire: async (input) => {
        observations.push({
          attempt: input.attempt,
          context: input.context,
          planKind: PROXY_PLAN_KIND.FALLBACK,
          ...policyObservationForProvider(
            input.providerInstanceId,
            input.target.url,
          ),
          requestId: input.requestId,
          requirements: input.requirements,
          routeKind: PROXY_ROUTE_KIND.DIRECT,
          selectedProvider: input.providerInstanceId,
          session: {
            consistency: input.context.consistency ?? null,
            flowKey: input.context.flowKey ?? null,
          },
          targetUrl: input.target.url,
          type: 'provider-acquire',
        });

        return {
          id: `${input.providerInstanceId}-${input.requestId}`,
          providerInstanceId: input.providerInstanceId,
          providerKind,
          route: createLeaseRoute(input.providerInstanceId, input.target.url),
        };
      },
      getCapabilities: () => options.capabilities ?? {},
      kind: providerKind,
      release: async (lease, result) => {
        observations.push({
          outcome: result.outcome,
          providerInstanceId: lease.providerInstanceId,
          type: 'provider-release',
        });
      },
    },
    id,
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
    ...(options.priority === undefined ? {} : { priority: options.priority }),
    ...(options.tags === undefined ? {} : { tags: options.tags }),
  };
}

function fallbackPlan(provider, metadata = {}) {
  return {
    attempts: [
      {
        metadata,
        provider,
      },
    ],
    kind: PROXY_PLAN_KIND.FALLBACK,
  };
}

function retryFallbackPlan() {
  return timeoutAbortFallbackPlan({
    retryOn: [RETRY_CONDITION.TARGET_NETWORK_ERROR],
  });
}

function timeoutAbortFallbackPlan(options = {}) {
  const pipelineId = options.pipelineId ?? 'retry-fallback';

  return [
    {
      args: {
        attempts: [
          {
            metadata: {
              pipelineId,
              policyAttemptId: 'primary',
            },
            provider: 'fallback-primary-provider',
            retryOn: options.retryOn ?? [
              RETRY_CONDITION.GATEWAY_TIMEOUT,
              RETRY_CONDITION.TARGET_NETWORK_ERROR,
              RETRY_CONDITION.TARGET_TIMEOUT,
            ],
            ...(options.primaryTimeoutMs === undefined
              ? {}
              : { timeoutMs: options.primaryTimeoutMs }),
          },
          {
            metadata: {
              pipelineId,
              policyAttemptId: 'secondary',
            },
            provider: 'fallback-secondary-provider',
          },
        ],
      },
      use: PIPELINE_STEP_TYPE.PLAN_FALLBACK,
    },
  ];
}

function gbCapabilities() {
  return {
    geo: {
      countries: ['GB'],
      mode: PROXY_PROVIDER_GEO_MODE.GUARANTEED,
    },
  };
}

function stickySessionIdentity() {
  return {
    isolationKey: 'micro-sticky',
    rotation: PROXY_IDENTITY_ROTATION.STICKY,
    stickySessionId: 'micro-sticky-session',
    stickySessionTtlMs: 60_000,
  };
}

function policyObservationForProvider(id, targetUrl) {
  switch (id) {
    case providerInstanceId:
      return {
        policyRouteId: 'gateway-policy-default',
      };
    case 'route-host-provider':
      return {
        policyRouteId: 'gateway-policy-host',
      };
    case 'route-low-provider':
      return {
        policyRouteId: 'gateway-policy-priority-low',
      };
    case 'route-priority-provider':
      return {
        policyRouteId: 'gateway-policy-priority-high',
      };
    case 'route-public-provider':
      return {
        policyRouteId: 'gateway-policy-public',
      };
    case 'route-exclude-provider':
      return {
        policyRouteId: 'gateway-policy-exclude-fallback',
      };
    case 'gb-low-provider':
    case 'gb-high-provider':
      return {
        policyPipelineId: 'gateway-policy-gb',
      };
    case 'fallback-primary-provider':
      if (isRetryFallbackTarget(targetUrl)) {
        return {
          policyAttemptId: 'primary',
          policyPipelineId: 'retry-fallback',
        };
      }
      if (isTimeoutAbortTarget(targetUrl)) {
        return {
          policyAttemptId: 'primary',
          policyPipelineId: 'timeout-abort',
        };
      }

      return {
        policyAttemptId: 'primary',
        policyPipelineId: 'gateway-policy-fallback',
      };
    case 'fallback-secondary-provider':
      if (isRetryFallbackTarget(targetUrl)) {
        return {
          policyAttemptId: 'secondary',
          policyPipelineId: 'retry-fallback',
        };
      }
      if (isTimeoutAbortTarget(targetUrl)) {
        return {
          policyAttemptId: 'secondary',
          policyPipelineId: 'timeout-abort',
        };
      }

      return {
        policyAttemptId: 'secondary',
        policyPipelineId: 'gateway-policy-fallback',
      };
    case 'sticky-provider-a':
    case 'sticky-provider-b':
      return {
        policyPipelineId: 'sticky-session',
      };
    default:
      return {};
  }
}

function createLeaseRoute(providerInstanceId, targetUrl) {
  if (isErrorRedactionTarget(targetUrl)) {
    return {
      auth: {
        mode: PROXY_ROUTE_AUTH_MODE.USERNAME_PASSWORD,
        password: 'route-password',
        token: 'route-token',
        username: 'route-user',
      },
      host: 'proxy.example.com',
      kind: PROXY_ROUTE_KIND.FORWARD_PROXY,
      port: 8080,
      protocol: PROXY_PROTOCOL.HTTP,
    };
  }

  return {
    kind: PROXY_ROUTE_KIND.DIRECT,
    providerInstanceId,
  };
}

function isRetryFallbackTarget(targetUrl) {
  return isPolicyTarget(targetUrl, 'retry-fallback.policy.example.com');
}

function isTimeoutAbortTarget(targetUrl) {
  return isPolicyTarget(targetUrl, 'timeout-abort.policy.example.com');
}

function isErrorRedactionTarget(targetUrl) {
  return isPolicyTarget(targetUrl, 'error-redaction.policy.example.com');
}

function isPolicyTarget(targetUrl, hostname) {
  try {
    return new URL(targetUrl).hostname === hostname;
  } catch {
    return false;
  }
}

function createTransport() {
  return {
    execute: async (input) => {
      const mode = readMode(input.target.url);
      observations.push({
        requestId: input.requestId,
        routeProvider: input.route.providerInstanceId ?? null,
        targetBody: describeTargetBody(input.target.body),
        targetFetch: input.target.fetch,
        targetHeaders: input.target.headers,
        mode,
        targetMethod: input.target.method,
        targetUrl: input.target.url,
        type: 'transport-execute',
      });

      if (shouldFailPrimaryFallback(mode, input.route.providerInstanceId)) {
        throw new Error('gateway policy fallback primary failure');
      }

      if (mode === 'error-redaction-transport-failure') {
        throw new Error('deterministic target transport failure');
      }

      const specialResponse = createSpecialTargetResponse(mode);

      if (specialResponse !== undefined) {
        return specialResponse;
      }

      const bufferingLimitResponse = createBufferingLimitTargetResponse(mode);

      if (bufferingLimitResponse !== undefined) {
        return bufferingLimitResponse;
      }

      const timeoutAbortResponse = await createTimeoutAbortTargetResponse(mode, input);

      if (timeoutAbortResponse !== undefined) {
        return timeoutAbortResponse;
      }

      const providerResponse = await fetch(`${providerBaseUrl}/execute`, {
        body: JSON.stringify({
          delayMs: readDelayMs(input.target.url),
          mode,
          requestId: input.requestId,
          target: {
            body: serializeTargetBody(input.target.body),
            fetch: input.target.fetch,
            headers: input.target.headers,
            method: input.target.method,
            url: input.target.url,
          },
        }),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
        redirect: 'manual',
        signal: input.signal,
      });
      const bytes = new Uint8Array(await providerResponse.arrayBuffer());
      const finalUrlCheck = checkFinalUrl(input, providerResponse);

      if (finalUrlCheck !== undefined) {
        observations.push({
          baseUrl: input.target.url,
          location: providerResponse.headers.get('location'),
          mode,
          requestId: input.requestId,
          result: finalUrlCheck,
          type: 'final-url-check',
        });
      }

      return {
        body: createGatewayBody(providerResponse, bytes),
        headers: Array.from(providerResponse.headers.entries()),
        redirected: false,
        status: providerResponse.status,
        statusText: providerResponse.statusText,
        type: 'basic',
        url: input.target.url,
      };
    },
  };
}

function shouldFailPrimaryFallback(mode, providerId) {
  return (
    providerId === 'fallback-primary-provider'
    && (
      mode === 'gateway-policy-fallback'
      || mode === 'retry-fallback-non-replayable'
      || mode === 'retry-fallback-replayable'
      || mode === 'retry-fallback-unsafe'
      || mode === 'buffering-limit-request-non-replayable'
    )
  );
}

function readMode(targetUrl) {
  return new URL(targetUrl).searchParams.get('mode') ?? 'text';
}

function readDelayMs(targetUrl) {
  const value = new URL(targetUrl).searchParams.get('delayMs');

  if (value === null) {
    return undefined;
  }

  const delayMs = Number.parseInt(value, 10);

  return Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : undefined;
}

function checkFinalUrl(input, response) {
  const location = response.headers.get('location');

  if (location === null || input.finalUrlGuard === undefined) {
    return undefined;
  }

  return input.finalUrlGuard.check({
    baseUrl: input.target.url,
    url: location,
  });
}

function createSpecialTargetResponse(mode) {
  if (
    mode !== 'special-error'
    && mode !== 'special-opaque'
    && mode !== 'special-opaqueredirect'
  ) {
    return undefined;
  }

  return {
    body: {
      kind: 'none',
      replayability: 'replayable',
    },
    headers: [],
    redirected: false,
    status: 0,
    statusText: '',
    type: mode.replace('special-', ''),
    url: '',
  };
}

function createBufferingLimitTargetResponse(mode) {
  if (mode !== 'buffering-limit-response') {
    return undefined;
  }

  const sizeBytes = (25 * 1024 * 1024) + 1;

  return {
    body: {
      kind: 'stream',
      replayability: 'non-replayable',
      sizeBytes,
      stream: createByteStream(sizeBytes),
    },
    headers: [['content-type', 'application/octet-stream']],
    redirected: false,
    status: 200,
    statusText: 'OK',
    type: 'basic',
    url: 'https://buffering-limit.policy.example.com/response',
  };
}

async function createTimeoutAbortTargetResponse(mode, input) {
  if (
    mode !== 'timeout-abort-gateway-delay'
    && mode !== 'timeout-abort-attempt'
  ) {
    return undefined;
  }

  if (
    mode === 'timeout-abort-attempt'
    && input.route.providerInstanceId !== 'fallback-primary-provider'
  ) {
    return textTargetResponse(
      input.target.url,
      'attempt timeout fallback response',
    );
  }

  await abortableDelay(readDelayMs(input.target.url) ?? 500, input.signal);

  return textTargetResponse(input.target.url, 'timeout abort delayed response');
}

function textTargetResponse(url, text) {
  return {
    body: {
      kind: 'text',
      replayability: 'replayable',
      text,
    },
    headers: [['content-type', 'text/plain; charset=utf-8']],
    redirected: false,
    status: 200,
    statusText: 'OK',
    type: 'basic',
    url,
  };
}

function abortableDelay(ms, signal) {
  if (signal.aborted) {
    return Promise.reject(
      signal.reason ?? new DOMException('Operation aborted.', 'AbortError'),
    );
  }

  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
    };
    const timeout = setTimeout(() => {
      finish();
      resolve();
    }, ms);
    const abort = () => {
      finish();
      reject(signal.reason ?? new DOMException('Operation aborted.', 'AbortError'));
    };

    signal.addEventListener('abort', abort, {
      once: true,
    });
  });
}

function createByteStream(sizeBytes) {
  let remainingBytes = sizeBytes;

  return new ReadableStream({
    pull(controller) {
      if (remainingBytes <= 0) {
        controller.close();
        return;
      }

      const chunkSize = Math.min(remainingBytes, 64 * 1024);

      remainingBytes -= chunkSize;
      controller.enqueue(new Uint8Array(chunkSize));
    },
  });
}

function serializeTargetBody(body) {
  if (body.kind === 'none') {
    return bodySummary('none', new Uint8Array(), {});
  }

  if (body.kind === 'text') {
    const bytes = new TextEncoder().encode(body.text);

    return bodySummary('text', bytes, {
      text: body.text,
    });
  }

  if (body.kind === 'bytes') {
    return bodySummary('bytes', body.bytes, {
      base64: Buffer.from(body.bytes).toString('base64'),
    });
  }

  return {
    kind: 'stream',
    replayability: body.replayability,
    sizeBytes: body.sizeBytes ?? null,
  };
}

function describeTargetBody(body) {
  if (body.kind === 'stream') {
    return {
      kind: body.kind,
      replayability: body.replayability,
      sizeBytes: body.sizeBytes ?? null,
    };
  }

  return serializeTargetBody(body);
}

function bodySummary(kind, bytes, extra) {
  return {
    byteLength: bytes.byteLength,
    kind,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    ...extra,
  };
}

function createGatewayBody(response, bytes) {
  if (
    bytes.byteLength === 0
    || response.status === 204
    || response.status === 205
    || response.status === 304
  ) {
    return {
      kind: 'none',
      replayability: 'replayable',
    };
  }

  if ((response.headers.get('content-type') ?? '').startsWith('text/')) {
    return {
      kind: 'text',
      replayability: 'replayable',
      text: new TextDecoder().decode(bytes),
    };
  }

  return {
    bytes,
    kind: 'bytes',
    replayability: 'replayable',
  };
}
