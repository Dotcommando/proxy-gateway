import { describe, expect, it } from '@jest/globals';

import {
  createProxyGateway,
  type GatewayTargetResponse,
  PROXY_ATTEMPT_RESULT_OUTCOME,
  PROXY_DNS_MODE,
  PROXY_PROTOCOL,
  PROXY_ROUTE_AUTH_MODE,
  PROXY_ROUTE_HOP_KIND,
  PROXY_ROUTE_KIND,
  type ProxyAttemptResult,
  type ProxyProviderInstance,
  type ProxyRoute,
  RESPONSE_CODE,
  WIRE_PROTOCOL_VERSION,
} from '../src';
import { createRouteDiagnostic } from '../src/domain/routing';

describe('proxy route model', () => {
  it('uses package enums for route kinds, hop kinds, protocols, DNS modes, and auth modes', () => {
    expect(PROXY_ROUTE_KIND.DIRECT).toBe('direct');
    expect(PROXY_ROUTE_KIND.FORWARD_PROXY).toBe('forward-proxy');
    expect(PROXY_ROUTE_KIND.ROUTE_CHAIN).toBe('route-chain');
    expect(PROXY_ROUTE_KIND.CUSTOM_TRANSPORT).toBe('custom-transport');
    expect(PROXY_ROUTE_HOP_KIND.FORWARD_PROXY).toBe('forward-proxy-hop');
    expect(PROXY_ROUTE_HOP_KIND.TOR_CLIENT).toBe('tor-client-hop');
    expect(PROXY_ROUTE_HOP_KIND.CUSTOM_TRANSPORT).toBe('custom-transport-hop');
    expect(PROXY_PROTOCOL.SOCKS5H).toBe('socks5h');
    expect(PROXY_DNS_MODE.PROXY).toBe('proxy');
    expect(PROXY_ROUTE_AUTH_MODE.USERNAME_PASSWORD).toBe('username-password');
    expect(RESPONSE_CODE.UNSUPPORTED_ROUTE).toBe('UNSUPPORTED_ROUTE');
    expect(PROXY_ATTEMPT_RESULT_OUTCOME.UNSUPPORTED_ROUTE).toBe('unsupported-route');
  });

  it('passes forward-proxy routes to the target transport unchanged', async () => {
    const route: ProxyRoute = {
      host: 'proxy.example.com',
      kind: PROXY_ROUTE_KIND.FORWARD_PROXY,
      port: 8080,
      protocol: PROXY_PROTOCOL.HTTP,
    };
    const executedRoutes: ProxyRoute[] = [];
    const gateway = createProxyGateway({
      providers: [provider(route)],
      transport: {
        execute: async (input) => {
          executedRoutes.push(input.route);

          return okTargetResponse();
        },
      },
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(executedRoutes).toEqual([route]);
  });

  it('preserves socks5h routes with proxy DNS mode', async () => {
    const route: ProxyRoute = {
      dns: PROXY_DNS_MODE.PROXY,
      host: '127.0.0.1',
      kind: PROXY_ROUTE_KIND.FORWARD_PROXY,
      port: 9050,
      protocol: PROXY_PROTOCOL.SOCKS5H,
    };
    let executedRoute: ProxyRoute | undefined;
    const gateway = createProxyGateway({
      providers: [provider(route)],
      transport: {
        execute: async (input) => {
          executedRoute = input.route;

          return okTargetResponse();
        },
      },
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(executedRoute).toEqual(route);
  });

  it('returns a stable unsupported-route service error before calling unsupported transports', async () => {
    const releasedResults: ProxyAttemptResult[] = [];
    const route: ProxyRoute = {
      hops: [
        {
          host: 'proxy.example.com',
          kind: PROXY_ROUTE_HOP_KIND.FORWARD_PROXY,
          port: 8080,
          protocol: PROXY_PROTOCOL.HTTP,
        },
      ],
      kind: PROXY_ROUTE_KIND.ROUTE_CHAIN,
    };
    const gateway = createProxyGateway({
      providers: [
        provider(route, {
          release: async (_lease, result) => {
            releasedResults.push(result);
          },
        }),
      ],
      transport: {
        execute: async () => {
          throw new Error('transport should not execute unsupported route');
        },
        supportsRoute: (candidate) => candidate.kind !== PROXY_ROUTE_KIND.ROUTE_CHAIN,
      },
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: {
        code: RESPONSE_CODE.UNSUPPORTED_ROUTE,
        details: {
          route: {
            hops: [
              {
                host: 'proxy.example.com',
                kind: PROXY_ROUTE_HOP_KIND.FORWARD_PROXY,
                port: 8080,
                protocol: PROXY_PROTOCOL.HTTP,
              },
            ],
            kind: PROXY_ROUTE_KIND.ROUTE_CHAIN,
          },
          target: {
            headers: [],
            method: 'GET',
            url: 'https://example.com/resource',
          },
        },
        message: 'Target transport does not support route kind: route-chain.',
        retryable: false,
      },
      ok: false,
      version: WIRE_PROTOCOL_VERSION,
    });
    expect(releasedResults).toEqual([
      {
        error: {
          code: RESPONSE_CODE.UNSUPPORTED_ROUTE,
          message: 'Target transport does not support route kind: route-chain.',
        },
        outcome: PROXY_ATTEMPT_RESULT_OUTCOME.UNSUPPORTED_ROUTE,
      },
    ]);
  });

  it('allows custom transport routes to execute through the common route model', async () => {
    const route: ProxyRoute = {
      execute: async (input) => ({
        body: {
          kind: 'text',
          replayability: 'replayable',
          text: input.requestId,
        },
        headers: [],
        status: 200,
        statusText: 'OK',
      }),
      kind: PROXY_ROUTE_KIND.CUSTOM_TRANSPORT,
    };
    const response = await route.execute({
      requestId: 'custom-route-request',
      signal: new AbortController().signal,
      target: {
        body: {
          kind: 'none',
          replayability: 'replayable',
        },
        fetch: {},
        headers: [],
        method: 'GET',
        url: 'https://example.com/custom',
      },
    });

    expect(response.body).toEqual({
      kind: 'text',
      replayability: 'replayable',
      text: 'custom-route-request',
    });
  });

  it('omits route credentials from diagnostics', () => {
    const route: ProxyRoute = {
      auth: {
        mode: PROXY_ROUTE_AUTH_MODE.USERNAME_PASSWORD,
        password: 'super-secret',
        username: 'gateway-user',
      },
      dns: PROXY_DNS_MODE.PROXY,
      host: 'proxy.example.com',
      kind: PROXY_ROUTE_KIND.FORWARD_PROXY,
      port: 8080,
      protocol: PROXY_PROTOCOL.HTTP,
    };

    expect(createRouteDiagnostic(route)).toEqual({
      auth: {
        mode: PROXY_ROUTE_AUTH_MODE.USERNAME_PASSWORD,
      },
      dns: PROXY_DNS_MODE.PROXY,
      host: 'proxy.example.com',
      kind: PROXY_ROUTE_KIND.FORWARD_PROXY,
      port: 8080,
      protocol: PROXY_PROTOCOL.HTTP,
    });
    expect(JSON.stringify(createRouteDiagnostic(route))).not.toContain('super-secret');
    expect(JSON.stringify(createRouteDiagnostic(route))).not.toContain('gateway-user');
  });
});

function provider(
  route: ProxyRoute,
  overrides: {
    release?: NonNullable<ProxyProviderInstance['adapter']['release']>;
  } = {},
): ProxyProviderInstance {
  return {
    adapter: {
      acquire: async () => ({
        id: 'lease-1',
        providerInstanceId: 'provider-a',
        providerKind: 'test-provider',
        route,
      }),
      getCapabilities: () => ({}),
      kind: 'test-provider',
      ...(overrides.release === undefined ? {} : { release: overrides.release }),
    },
    id: 'provider-a',
  };
}

function okTargetResponse(): GatewayTargetResponse {
  return {
    body: {
      kind: 'text',
      replayability: 'replayable',
      text: 'ok',
    },
    headers: [['content-type', 'text/plain']],
    status: 200,
    statusText: 'OK',
    url: 'https://example.com/resource',
  };
}

function proxyFetchJsonRequest(): Request {
  return new Request('https://gateway.test/proxy', {
    body: JSON.stringify({
      context: {},
      request: {
        body: null,
        headers: [],
        method: 'GET',
        url: 'https://example.com/resource',
      },
      version: WIRE_PROTOCOL_VERSION,
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  });
}
