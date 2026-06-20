import { describe, expect, it } from '@jest/globals';

import {
  createProxyGateway,
  type GatewayTargetResponse,
  PROXY_PLAN_KIND,
  PROXY_ROUTE_KIND,
  type ProxyAcquireInput,
  type ProxyProviderInstance,
  RESPONSE_CODE,
  type TargetTransportPort,
  WIRE_PROTOCOL_VERSION,
} from '../src';

describe('providerSelection removal', () => {
  it('uses a configured plan for explicit provider selection', async () => {
    const acquired: ProxyAcquireInput[] = [];
    const gateway = createProxyGateway({
      plan: fallbackPlan('provider-b'),
      providers: [
        provider('provider-a', acquired),
        provider('provider-b', acquired),
      ],
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(acquired.map((input) => input.providerInstanceId)).toEqual(['provider-b']);
  });

  it('uses route config for explicit provider selection', async () => {
    const acquired: ProxyAcquireInput[] = [];
    const gateway = createProxyGateway({
      providers: [
        provider('provider-a', acquired),
        provider('provider-b', acquired),
      ],
      routes: [
        {
          id: 'api',
          match: {
            host: 'example.com',
          },
          plan: fallbackPlan('provider-b'),
        },
      ],
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(acquired.map((input) => input.providerInstanceId)).toEqual(['provider-b']);
  });

  it('uses defaultRoute config for explicit provider selection', async () => {
    const acquired: ProxyAcquireInput[] = [];
    const gateway = createProxyGateway({
      defaultRoute: {
        id: 'default',
        plan: fallbackPlan('provider-b'),
      },
      providers: [
        provider('provider-a', acquired),
        provider('provider-b', acquired),
      ],
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(acquired.map((input) => input.providerInstanceId)).toEqual(['provider-b']);
  });

  it('does not silently use no-plan fallback when pipelines are configured', async () => {
    const acquired: ProxyAcquireInput[] = [];
    const gateway = createProxyGateway({
      pipelines: [
        {
          id: 'pipeline',
          plan: [{ use: 'plan.fallback' }],
        },
      ],
      providers: [provider('provider-a', acquired)],
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: {
        code: RESPONSE_CODE.PIPELINE_STEP_NOT_FOUND,
      },
      ok: false,
      version: WIRE_PROTOCOL_VERSION,
    });
    expect(acquired).toEqual([]);
  });
});

function provider(id: string, acquired: ProxyAcquireInput[]): ProxyProviderInstance {
  return {
    id,
    adapter: {
      acquire: async (input) => {
        acquired.push(input);

        return {
          id: `${id}-lease`,
          providerInstanceId: id,
          providerKind: 'test-provider',
          route: { kind: PROXY_ROUTE_KIND.DIRECT },
        };
      },
      getCapabilities: () => ({}),
      kind: 'test-provider',
    },
  };
}

function fallbackPlan(providerId: string) {
  return {
    attempts: [
      {
        provider: providerId,
      },
    ],
    kind: PROXY_PLAN_KIND.FALLBACK,
  };
}

function okTransport(): TargetTransportPort {
  return {
    execute: async () => okTargetResponse(),
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
