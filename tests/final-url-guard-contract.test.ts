import { describe, expect, it } from '@jest/globals';

import {
  BODY_KIND_TEXT,
  createProxyGateway,
  type GatewayTargetResponse,
  PROXY_PLAN_KIND,
  PROXY_ROUTE_KIND,
  type ProxyProviderInstance,
  RESPONSE_CODE,
  TARGET_ACCESS_DENIED_MESSAGE,
  TARGET_ACCESS_REJECTION_REASON,
  TARGET_ACCESS_RESULT_KIND,
  type TargetFinalUrlGuardPort,
  type TargetTransportPort,
  WIRE_PROTOCOL_VERSION,
} from '../src';

const TEST_PROVIDER_KIND = 'test-provider';

describe('final URL guard contract', () => {
  it('passes a target final URL guard to target transports without app-layer imports', async () => {
    const observedResults: Array<ReturnType<TargetFinalUrlGuardPort['check']>> = [];
    const transport: TargetTransportPort = {
      execute: async (input) => {
        const guard = input.finalUrlGuard;

        if (guard === undefined) {
          throw new Error('Expected final URL guard.');
        }

        observedResults.push(
          guard.check({
            baseUrl: input.target.url,
            url: '/safe-final',
          }),
          guard.check({
            baseUrl: input.target.url,
            url: '//127.0.0.1/admin',
          }),
        );

        return okTargetResponse();
      },
    };
    const gateway = createGateway(transport);
    const response = await gateway.handle(proxyFetchJsonRequest({
      url: 'https://example.com/start',
    }));

    expect((await response.json()).ok).toBe(true);
    expect(observedResults).toEqual([
      {
        kind: TARGET_ACCESS_RESULT_KIND.ALLOWED,
      },
      {
        code: RESPONSE_CODE.TARGET_ACCESS_DENIED,
        kind: TARGET_ACCESS_RESULT_KIND.REJECTED,
        message: TARGET_ACCESS_DENIED_MESSAGE,
        reason: TARGET_ACCESS_REJECTION_REASON.LOCAL_HOSTNAME,
        status: 403,
      },
    ]);
  });

  it('keeps initial target access denial before final URL guard or transport execution', async () => {
    let capabilityCalls = 0;
    let acquireCalls = 0;
    let transportCalls = 0;
    const gateway = createProxyGateway({
      plan: {
        attempts: [
          {
            provider: 'provider-a',
          },
        ],
        kind: PROXY_PLAN_KIND.FALLBACK,
      },
      providers: [
        provider({
          acquire: async (input) => {
            acquireCalls += 1;

            return {
              id: 'provider-a-lease',
              providerInstanceId: input.providerInstanceId,
              providerKind: TEST_PROVIDER_KIND,
              route: { kind: PROXY_ROUTE_KIND.DIRECT },
            };
          },
          getCapabilities: () => {
            capabilityCalls += 1;

            return {};
          },
        }),
      ],
      transport: {
        execute: async () => {
          transportCalls += 1;

          return okTargetResponse();
        },
      },
    });
    const response = await gateway.handle(proxyFetchJsonRequest({
      url: 'http://127.0.0.1/private',
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: {
        code: RESPONSE_CODE.TARGET_ACCESS_DENIED,
      },
      ok: false,
      version: WIRE_PROTOCOL_VERSION,
    });
    expect(capabilityCalls).toBe(0);
    expect(acquireCalls).toBe(0);
    expect(transportCalls).toBe(0);
  });
});

interface IProviderOverrides {
  acquire?: ProxyProviderInstance['adapter']['acquire'];
  getCapabilities?: ProxyProviderInstance['adapter']['getCapabilities'];
}

interface IProxyFetchJsonRequestOptions {
  url: string;
}

function createGateway(transport: TargetTransportPort): {
  handle(request: Request): Promise<Response>;
} {
  return createProxyGateway({
    plan: {
      attempts: [
        {
          provider: 'provider-a',
        },
      ],
      kind: PROXY_PLAN_KIND.FALLBACK,
    },
    providers: [
      provider(),
    ],
    transport,
  });
}

function provider(overrides: IProviderOverrides = {}): ProxyProviderInstance {
  return {
    adapter: {
      acquire:
        overrides.acquire
        ?? (async (input) => ({
          id: 'provider-a-lease',
          providerInstanceId: input.providerInstanceId,
          providerKind: TEST_PROVIDER_KIND,
          route: { kind: PROXY_ROUTE_KIND.DIRECT },
        })),
      getCapabilities: overrides.getCapabilities ?? (() => ({})),
      kind: TEST_PROVIDER_KIND,
    },
    id: 'provider-a',
  };
}

function okTargetResponse(): GatewayTargetResponse {
  return {
    body: {
      kind: BODY_KIND_TEXT,
      replayability: 'replayable',
      text: 'ok',
    },
    headers: [['content-type', 'text/plain']],
    status: 200,
    statusText: 'OK',
    url: 'https://example.com/final',
  };
}

function proxyFetchJsonRequest(options: IProxyFetchJsonRequestOptions): Request {
  return new Request('https://gateway.test/proxy', {
    body: JSON.stringify({
      context: {},
      request: {
        body: null,
        headers: [],
        method: 'GET',
        url: options.url,
      },
      version: WIRE_PROTOCOL_VERSION,
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  });
}
