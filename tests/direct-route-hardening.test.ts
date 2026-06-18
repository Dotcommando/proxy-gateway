import { describe, expect, it } from '@jest/globals';

import {
  createProxyGateway,
  type GatewayTargetRequest,
  type GatewayTargetResponse,
  type ProxyAttemptResult,
  type ProxyProviderInstance,
  RESPONSE_CODE,
  type TargetTransportPort,
  WIRE_PROTOCOL_VERSION,
} from '../src';

describe('direct route execution hardening', () => {
  it('releases a lease with a failed attempt result when transport execution fails', async () => {
    const releasedResults: ProxyAttemptResult[] = [];
    const provider = directProvider({
      release: async (_lease, result) => {
        releasedResults.push(result);
      },
    });
    const gateway = createProxyGateway({
      providers: [provider],
      random: { createId: () => 'request-failure' },
      transport: {
        execute: async () => {
          throw new Error('socket closed');
        },
      },
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect(await response.json()).toEqual({
      error: {
        code: RESPONSE_CODE.TARGET_TRANSPORT_ERROR,
        message: 'Target transport execution failed.',
        retryable: true,
      },
      ok: false,
      version: WIRE_PROTOCOL_VERSION,
    });
    expect(releasedResults).toEqual([
      {
        error: {
          code: RESPONSE_CODE.TARGET_TRANSPORT_ERROR,
          message: 'Target transport execution failed.',
        },
        outcome: 'gateway-error',
      },
    ]);
  });

  it('treats provider release as best-effort after successful transport execution', async () => {
    const provider = directProvider({
      release: async () => {
        throw new Error('release failed');
      },
    });
    const gateway = createProxyGateway({
      providers: [provider],
      random: { createId: () => 'request-success-release-failure' },
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      response: {
        status: 200,
      },
      version: WIRE_PROTOCOL_VERSION,
    });
  });

  it('returns a stable service error when no provider is enabled', async () => {
    const gateway = createProxyGateway({
      providers: [
        directProvider({
          enabled: false,
        }),
      ],
      transport: okTransport(),
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: RESPONSE_CODE.NO_PROVIDER_AVAILABLE,
        message: 'No enabled proxy provider is available.',
      },
      ok: false,
      version: WIRE_PROTOCOL_VERSION,
    });
  });

  it('returns a stable service error when no target transport is configured', async () => {
    let acquired = false;
    const gateway = createProxyGateway({
      providers: [
        directProvider({
          acquire: async () => {
            acquired = true;

            return directLease();
          },
        }),
      ],
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect(acquired).toBe(false);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: RESPONSE_CODE.TRANSPORT_NOT_CONFIGURED,
        message: 'No target transport is configured.',
      },
      ok: false,
      version: WIRE_PROTOCOL_VERSION,
    });
  });

  it('passes the generated request id and buffered normalized target to direct route execution', async () => {
    const acquiredTargets: GatewayTargetRequest[] = [];
    const executedTargets: GatewayTargetRequest[] = [];
    const gateway = createProxyGateway({
      providers: [
        directProvider({
          acquire: async (input) => {
            expect(input.requestId).toBe('request-buffered');
            acquiredTargets.push(input.target);

            return directLease();
          },
        }),
      ],
      random: { createId: () => 'request-buffered' },
      transport: {
        execute: async (input) => {
          expect(input.requestId).toBe('request-buffered');
          executedTargets.push(input.target);

          return okTargetResponse();
        },
      },
    });
    const response = await gateway.handle(
      proxyFetchJsonRequest({
        request: {
          body: {
            data: 'AQIDBA==',
            kind: 'base64',
          },
          cache: 'no-store',
          headers: [
            ['content-type', 'application/octet-stream'],
            ['content-length', '999'],
          ],
          method: 'POST',
          redirect: 'manual',
          url: 'https://example.com/binary',
        },
      }),
    );

    expect((await response.json()).ok).toBe(true);
    expect(acquiredTargets).toHaveLength(1);
    expect(executedTargets).toHaveLength(1);
    expect(executedTargets[0]).toEqual(acquiredTargets[0]);
    expect(executedTargets[0]?.headers).toEqual([['content-type', 'application/octet-stream']]);
    expect(executedTargets[0]?.fetch).toEqual({
      cache: 'no-store',
      redirect: 'manual',
    });
    expect(executedTargets[0]?.body.kind).toBe('bytes');

    if (executedTargets[0]?.body.kind === 'bytes') {
      expect(Array.from(executedTargets[0].body.bytes)).toEqual([1, 2, 3, 4]);
    }
  });
});

function directProvider(
  overrides: Partial<ProxyProviderInstance> & {
    acquire?: ProxyProviderInstance['adapter']['acquire'];
    release?: NonNullable<ProxyProviderInstance['adapter']['release']>;
  } = {},
): ProxyProviderInstance {
  const { acquire, release, ...instanceOverrides } = overrides;

  return {
    id: 'direct-provider',
    adapter: {
      kind: 'test-direct',
      acquire: acquire ?? (async () => directLease()),
      getCapabilities: () => ({}),
      ...(release ? { release } : {}),
    },
    ...instanceOverrides,
  };
}

function directLease() {
  return {
    id: 'lease-1',
    providerInstanceId: 'direct-provider',
    providerKind: 'test-direct',
    route: { kind: 'direct' as const },
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

function proxyFetchJsonRequest(
  envelopePatch: {
    context?: Record<string, unknown>;
    request?: Record<string, unknown>;
  } = {},
): Request {
  return new Request('https://gateway.test/proxy', {
    body: JSON.stringify({
      version: WIRE_PROTOCOL_VERSION,
      request: {
        body: {
          kind: 'text',
          text: 'hello',
        },
        headers: [['content-type', 'text/plain']],
        method: 'POST',
        url: 'https://example.com/resource',
        ...envelopePatch.request,
      },
      context: envelopePatch.context ?? {},
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  });
}
