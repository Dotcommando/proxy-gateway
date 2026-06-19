import { describe, expect, it } from '@jest/globals';

import {
  createProxyGateway,
  type GatewayTargetResponse,
  PROXY_ROUTE_KIND,
  type ProxyAcquireInput,
  type ProxyProviderInstance,
  RESPONSE_CODE,
  type TargetTransportPort,
  WIRE_PROTOCOL_VERSION,
} from '../src';

describe('multiple provider instances', () => {
  it('selects a configured provider instance even when another instance has the same adapter kind', async () => {
    const acquired: Array<{ id: string; input: ProxyAcquireInput }> = [];
    const gateway = createProxyGateway({
      providerSelection: {
        providerInstanceId: 'static-secondary',
      },
      providers: [
        providerInstance('static-primary', acquired),
        providerInstance('static-secondary', acquired),
      ],
      random: { createId: () => 'request-provider-selection' },
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(acquired).toHaveLength(1);
    expect(acquired[0]?.id).toBe('static-secondary');
    expect(acquired[0]?.input.providerInstanceId).toBe('static-secondary');
    expect(acquired[0]?.input.requestId).toBe('request-provider-selection');
  });

  it('does not select disabled provider instances', async () => {
    const acquired: Array<{ id: string; input: ProxyAcquireInput }> = [];
    const gateway = createProxyGateway({
      providers: [
        providerInstance('disabled-primary', acquired, { enabled: false }),
        providerInstance('enabled-secondary', acquired),
      ],
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(acquired).toHaveLength(1);
    expect(acquired[0]?.id).toBe('enabled-secondary');
  });

  it('returns a stable service error when provider selection references an unknown provider instance', async () => {
    const acquired: Array<{ id: string; input: ProxyAcquireInput }> = [];
    const gateway = createProxyGateway({
      providerSelection: {
        providerInstanceId: 'missing-provider',
      },
      providers: [providerInstance('available-provider', acquired)],
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: RESPONSE_CODE.PROVIDER_INSTANCE_NOT_FOUND,
        message: 'Provider instance "missing-provider" was not found or is disabled.',
      },
      ok: false,
      version: WIRE_PROTOCOL_VERSION,
    });
    expect(acquired).toEqual([]);
  });

  it('captures selected provider capabilities before acquisition', async () => {
    const acquired: ProxyAcquireInput[] = [];
    let capabilitySnapshots = 0;
    const gateway = createProxyGateway({
      providers: [
        {
          id: 'capability-provider',
          adapter: {
            kind: 'static-forward-proxy',
            acquire: async (input) => {
              acquired.push(input);

              return {
                id: 'capability-provider-lease',
                providerInstanceId: 'capability-provider',
                providerKind: 'static-forward-proxy',
                route: { kind: PROXY_ROUTE_KIND.DIRECT },
              };
            },
            getCapabilities: () => {
              capabilitySnapshots += 1;

              return {
                protocols: ['http'],
              };
            },
          },
        },
      ],
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect((await response.json()).ok).toBe(true);
    expect(capabilitySnapshots).toBe(1);
    expect(acquired).toHaveLength(1);
  });
});

function providerInstance(
  id: string,
  acquired: Array<{ id: string; input: ProxyAcquireInput }>,
  overrides: {
    enabled?: boolean;
  } = {},
): ProxyProviderInstance {
  return {
    id,
    adapter: {
      kind: 'static-forward-proxy',
      acquire: async (input) => {
        acquired.push({ id, input });

        return {
          id: `${id}-lease`,
          providerInstanceId: id,
          providerKind: 'static-forward-proxy',
          route: { kind: PROXY_ROUTE_KIND.DIRECT },
        };
      },
      getCapabilities: () => ({}),
    },
    ...(overrides.enabled === undefined ? {} : { enabled: overrides.enabled }),
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
      version: WIRE_PROTOCOL_VERSION,
      request: {
        body: null,
        headers: [],
        method: 'GET',
        url: 'https://example.com/resource',
      },
      context: {},
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  });
}
