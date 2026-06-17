import { describe, expect, it } from '@jest/globals';

import {
  createProxyGateway,
  type GatewayTargetRequest,
  type ProxyAttemptResult,
  type ProxyProviderInstance,
  type TargetTransportPort,
} from '../src/index';

describe('public API', () => {
  it('creates a gateway that handles a proxy-fetch.v1 JSON request through a direct provider', async () => {
    const acquiredTargets: GatewayTargetRequest[] = [];
    const releasedResults: ProxyAttemptResult[] = [];
    const provider: ProxyProviderInstance = {
      id: 'direct-provider',
      adapter: {
        kind: 'test-direct',
        getCapabilities: () => ({}),
        acquire: async (input) => {
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
        expect(input.route).toEqual({ kind: 'direct' });
        expect(input.target.url).toBe('https://example.com/resource');
        expect(input.target.method).toBe('POST');
        expect(input.target.body).toEqual({
          kind: 'text',
          replayability: 'replayable',
          text: 'hello',
        });

        return {
          status: 201,
          statusText: 'Created',
          headers: [['content-type', 'text/plain']],
          body: {
            kind: 'text',
            replayability: 'replayable',
            text: 'echo:hello',
          },
        };
      },
    };
    const gateway = createProxyGateway({
      providers: [provider],
      transport,
    });
    const response = await gateway.handle(
      new Request('https://gateway.test/proxy', {
        body: JSON.stringify({
          version: 'proxy-fetch.v1',
          target: {
            url: 'https://example.com/resource',
            method: 'POST',
            headers: [['content-type', 'text/plain']],
            body: {
              kind: 'text',
              text: 'hello',
            },
            fetch: {
              redirect: 'manual',
            },
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
      version: 'proxy-fetch.v1',
      ok: true,
      response: {
        status: 201,
        statusText: 'Created',
        headers: [['content-type', 'text/plain']],
        body: {
          kind: 'text',
          text: 'echo:hello',
        },
      },
    });

    expect(acquiredTargets).toHaveLength(1);
    expect(acquiredTargets[0]?.fetch).toEqual({ redirect: 'manual' });
    expect(releasedResults).toEqual([
      {
        outcome: 'success',
        response: {
          status: 201,
          statusText: 'Created',
          headers: [['content-type', 'text/plain']],
          body: {
            kind: 'text',
            replayability: 'replayable',
            text: 'echo:hello',
          },
        },
      },
    ]);
  });
});
