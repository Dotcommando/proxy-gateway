import { describe, expect, it } from '@jest/globals';

import {
  createProxyGateway,
  type GatewayTargetRequest,
  PROXY_ATTEMPT_RESULT_OUTCOME,
  type ProxyAttemptResult,
  type ProxyProviderInstance,
  type TargetTransportPort,
  WIRE_PROTOCOL_VERSION,
} from '../src';

describe('public API', () => {
  it('creates a gateway that handles a proxy-fetch.v1 JSON request through a direct provider', async () => {
    const acquiredTargets: GatewayTargetRequest[] = [];
    const requestIds: string[] = [];
    const releasedResults: ProxyAttemptResult[] = [];
    const provider: ProxyProviderInstance = {
      id: 'direct-provider',
      adapter: {
        kind: 'test-direct',
        getCapabilities: () => ({}),
        acquire: async (input) => {
          requestIds.push(input.requestId);
          acquiredTargets.push(input.target);

          return {
            id: 'lease-1',
            providerInstanceId: input.providerInstanceId,
            providerKind: 'test-direct',
            route: { kind: 'direct' },
          };
        },
        release: async (_lease, result) => {
          releasedResults.push(result);
        },
      },
    };
    const transport: TargetTransportPort = {
      execute: async (input) => {
        expect(input.requestId).toBe('request-id-1');
        expect(input.route).toEqual({ kind: 'direct' });
        expect(input.target.url).toBe('https://example.com/resource');
        expect(input.target.method).toBe('POST');
        expect(input.target.body).toEqual({
          kind: 'text',
          replayability: 'replayable',
          text: 'hello',
        });

        return {
          body: {
            kind: 'text',
            replayability: 'replayable',
            text: 'echo:hello',
          },
          headers: [['content-type', 'text/plain']],
          redirected: false,
          status: 201,
          statusText: 'Created',
          type: 'basic',
          url: 'https://example.com/resource',
        };
      },
    };
    const gateway = createProxyGateway({
      providers: [provider],
      random: {
        createId: () => 'request-id-1',
      },
      transport,
    });
    const response = await gateway.handle(
      new Request('https://gateway.test/proxy', {
        body: JSON.stringify({
          version: WIRE_PROTOCOL_VERSION,
          request: {
            url: 'https://example.com/resource',
            method: 'POST',
            headers: [['content-type', 'text/plain']],
            body: {
              kind: 'text',
              text: 'hello',
            },
            redirect: 'manual',
          },
          context: {
            tenantId: 'tenant-a',
          },
        }),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      }),
    );

    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get('content-type')).toContain('application/json');

    const envelope = await response.json();

    expect(envelope).toEqual({
      version: WIRE_PROTOCOL_VERSION,
      ok: true,
      response: {
        body: {
          kind: 'text',
          text: 'echo:hello',
        },
        headers: [['content-type', 'text/plain']],
        redirected: false,
        status: 201,
        statusText: 'Created',
        type: 'basic',
        url: 'https://example.com/resource',
      },
    });

    expect(acquiredTargets).toHaveLength(1);
    expect(requestIds).toEqual(['request-id-1']);
    expect(acquiredTargets[0]?.fetch).toEqual({ redirect: 'manual' });
    expect(releasedResults).toEqual([
      {
        outcome: PROXY_ATTEMPT_RESULT_OUTCOME.SUCCESS,
        response: {
          body: {
            kind: 'text',
            replayability: 'replayable',
            text: 'echo:hello',
          },
          headers: [['content-type', 'text/plain']],
          redirected: false,
          status: 201,
          statusText: 'Created',
          type: 'basic',
          url: 'https://example.com/resource',
        },
      },
    ]);
  });
});
