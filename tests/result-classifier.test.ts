import { describe, expect, it } from '@jest/globals';

import {
  createProxyGateway,
  type GatewayTargetRequest,
  type GatewayTargetResponse,
  PROXY_ATTEMPT_RESULT_OUTCOME,
  PROXY_DNS_MODE,
  PROXY_PROTOCOL,
  PROXY_ROUTE_AUTH_MODE,
  PROXY_ROUTE_KIND,
  type ProxyAttemptResult,
  type ProxyProviderInstance,
  type ProxyRoute,
  REDACTED_VALUE,
  RESPONSE_CODE,
  RETRY_CONDITION,
  type TargetTransportPort,
  WIRE_PROTOCOL_VERSION,
} from '../src';
import { ResultClassifier } from '../src/app/classification';

describe('ResultClassifier', () => {
  it('uses package enums for outcomes and retry conditions', () => {
    expect(PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_HTTP_ERROR).toBe('target-http-error');
    expect(PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_NETWORK_ERROR).toBe('target-network-error');
    expect(PROXY_ATTEMPT_RESULT_OUTCOME.GATEWAY_TIMEOUT).toBe('gateway-timeout');
    expect(RETRY_CONDITION.HTTP_429).toBe('http-429');
    expect(RETRY_CONDITION.TARGET_NETWORK_ERROR).toBe('target-network-error');
    expect(RETRY_CONDITION.PROXY_CONNECTION_ERROR).toBe('proxy-connection-error');
  });

  it('classifies successful target responses without retry condition or service error', () => {
    const classified = new ResultClassifier().classifyTargetResponse(targetResponse({ status: 200 }));

    expect(classified.attemptResult).toEqual({
      outcome: PROXY_ATTEMPT_RESULT_OUTCOME.SUCCESS,
      response: targetResponse({ status: 200 }),
    });
    expect(classified.retryCondition).toBeUndefined();
    expect(classified.serviceError).toBeUndefined();
  });

  it('classifies target HTTP errors as normal target responses with retry-condition hints', () => {
    const response = targetResponse({ status: 429, statusText: 'Too Many Requests' });
    const classified = new ResultClassifier().classifyTargetResponse(response);

    expect(classified.attemptResult).toEqual({
      outcome: PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_HTTP_ERROR,
      response,
    });
    expect(classified.retryCondition).toBe(RETRY_CONDITION.HTTP_429);
    expect(classified.serviceError).toBeUndefined();
  });

  it('does not create retry-condition hints for unlisted target HTTP statuses', () => {
    const classified = new ResultClassifier().classifyTargetResponse(targetResponse({ status: 418 }));

    expect(classified.attemptResult.outcome).toBe(PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_HTTP_ERROR);
    expect(classified.retryCondition).toBeUndefined();
    expect(classified.serviceError).toBeUndefined();
  });

  it('maps target and proxy failures into stable service-level errors', () => {
    const classifier = new ResultClassifier();

    expect(
      classifier.classifyFailure({
        message: 'Target transport execution failed.',
        outcome: PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_NETWORK_ERROR,
      }),
    ).toMatchObject({
      attemptResult: {
        error: {
          code: RESPONSE_CODE.TARGET_TRANSPORT_ERROR,
          message: 'Target transport execution failed.',
        },
        outcome: PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_NETWORK_ERROR,
      },
      retryCondition: RETRY_CONDITION.TARGET_NETWORK_ERROR,
      serviceError: {
        code: RESPONSE_CODE.TARGET_TRANSPORT_ERROR,
        retryable: true,
        status: 502,
      },
    });

    expect(
      classifier.classifyFailure({
        outcome: PROXY_ATTEMPT_RESULT_OUTCOME.PROXY_AUTH_ERROR,
      }),
    ).toMatchObject({
      retryCondition: RETRY_CONDITION.PROXY_AUTH_ERROR,
      serviceError: {
        code: RESPONSE_CODE.PROXY_AUTH_ERROR,
        retryable: false,
        status: 502,
      },
    });

    expect(
      classifier.classifyFailure({
        outcome: PROXY_ATTEMPT_RESULT_OUTCOME.PROXY_CONNECTION_ERROR,
      }),
    ).toMatchObject({
      retryCondition: RETRY_CONDITION.PROXY_CONNECTION_ERROR,
      serviceError: {
        code: RESPONSE_CODE.PROXY_CONNECTION_ERROR,
        retryable: true,
        status: 502,
      },
    });
  });

  it('maps timeout, abort, policy, replayability, streaming, and unsupported-route failures', () => {
    const classifier = new ResultClassifier();

    expect(classifier.classifyFailure({ outcome: PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_TIMEOUT })).toMatchObject({
      retryCondition: RETRY_CONDITION.TARGET_TIMEOUT,
      serviceError: {
        code: RESPONSE_CODE.TARGET_TIMEOUT,
        retryable: true,
        status: 504,
      },
    });
    expect(classifier.classifyFailure({ outcome: PROXY_ATTEMPT_RESULT_OUTCOME.GATEWAY_TIMEOUT })).toMatchObject({
      retryCondition: RETRY_CONDITION.GATEWAY_TIMEOUT,
      serviceError: {
        code: RESPONSE_CODE.GATEWAY_TIMEOUT,
        retryable: false,
        status: 504,
      },
    });
    const aborted = classifier.classifyFailure({ outcome: PROXY_ATTEMPT_RESULT_OUTCOME.ABORTED });

    expect(aborted.retryCondition).toBeUndefined();
    expect(aborted).toMatchObject({
      serviceError: {
        code: RESPONSE_CODE.REQUEST_ABORTED,
        retryable: false,
        status: 499,
      },
    });
    expect(classifier.classifyFailure({ outcome: PROXY_ATTEMPT_RESULT_OUTCOME.REJECTED_BY_POLICY })).toMatchObject({
      serviceError: {
        code: RESPONSE_CODE.REJECTED_BY_POLICY,
        retryable: false,
        status: 403,
      },
    });
    expect(
      classifier.classifyFailure({
        outcome: PROXY_ATTEMPT_RESULT_OUTCOME.REQUEST_BODY_NOT_REPLAYABLE,
      }),
    ).toMatchObject({
      serviceError: {
        code: RESPONSE_CODE.REQUEST_BODY_NOT_REPLAYABLE,
        retryable: false,
        status: 500,
      },
    });
    expect(
      classifier.classifyFailure({
        outcome: PROXY_ATTEMPT_RESULT_OUTCOME.RESPONSE_STREAM_ALREADY_STARTED,
      }),
    ).toMatchObject({
      serviceError: {
        code: RESPONSE_CODE.RESPONSE_STREAM_ALREADY_STARTED,
        retryable: false,
        status: 500,
      },
    });
    expect(classifier.classifyFailure({ outcome: PROXY_ATTEMPT_RESULT_OUTCOME.UNSUPPORTED_ROUTE })).toMatchObject({
      serviceError: {
        code: RESPONSE_CODE.UNSUPPORTED_ROUTE,
        retryable: false,
        status: 502,
      },
    });
  });

  it('redacts route credentials, sensitive target headers, and target URL secrets in diagnostics', () => {
    const route: ProxyRoute = {
      auth: {
        mode: PROXY_ROUTE_AUTH_MODE.USERNAME_PASSWORD,
        password: 'route-password',
        token: 'route-token',
        username: 'route-user',
      },
      dns: PROXY_DNS_MODE.PROXY,
      host: 'proxy.example.com',
      kind: PROXY_ROUTE_KIND.FORWARD_PROXY,
      port: 8080,
      protocol: PROXY_PROTOCOL.SOCKS5H,
    };
    const target = targetRequest({
      headers: [
        ['Authorization', 'Bearer target-secret'],
        ['cookie', 'session=secret-cookie'],
        ['Set-Cookie', 'session=secret-cookie'],
        ['x-api-key', 'target-api-key'],
        ['accept', 'application/json'],
      ],
      url: 'https://api.example.com/models?api_key=target-api-key&name=model&token=target-token',
    });
    const classified = new ResultClassifier().classifyFailure({
      outcome: PROXY_ATTEMPT_RESULT_OUTCOME.PROXY_CONNECTION_ERROR,
      route,
      target,
    });
    const serializedDiagnostics = JSON.stringify(classified.diagnostics);

    expect(classified.diagnostics).toMatchObject({
      route: {
        auth: {
          mode: PROXY_ROUTE_AUTH_MODE.USERNAME_PASSWORD,
        },
        host: 'proxy.example.com',
        protocol: PROXY_PROTOCOL.SOCKS5H,
      },
      target: {
        headers: [
          ['Authorization', REDACTED_VALUE],
          ['cookie', REDACTED_VALUE],
          ['Set-Cookie', REDACTED_VALUE],
          ['x-api-key', REDACTED_VALUE],
          ['accept', 'application/json'],
        ],
        url: expect.stringContaining(`api_key=${encodeURIComponent(REDACTED_VALUE)}`),
      },
    });
    expect(serializedDiagnostics).not.toContain('route-password');
    expect(serializedDiagnostics).not.toContain('route-token');
    expect(serializedDiagnostics).not.toContain('route-user');
    expect(serializedDiagnostics).not.toContain('target-secret');
    expect(serializedDiagnostics).not.toContain('secret-cookie');
    expect(serializedDiagnostics).not.toContain('target-api-key');
    expect(serializedDiagnostics).not.toContain('target-token');
  });

  it('direct execution releases classified target-network failures', async () => {
    const releasedResults: ProxyAttemptResult[] = [];
    const provider: ProxyProviderInstance = {
      adapter: {
        acquire: async (input) => ({
          id: 'lease-1',
          providerInstanceId: input.providerInstanceId,
          providerKind: 'test-direct',
          route: { kind: PROXY_ROUTE_KIND.DIRECT },
        }),
        getCapabilities: () => ({}),
        kind: 'test-direct',
        release: async (_lease, result) => {
          releasedResults.push(result);
        },
      },
      id: 'direct-provider',
    };
    const transport: TargetTransportPort = {
      execute: async () => {
        throw new Error('socket closed');
      },
    };
    const gateway = createProxyGateway({
      providers: [provider],
      transport,
    });
    const response = await gateway.handle(proxyFetchJsonRequest());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: RESPONSE_CODE.TARGET_TRANSPORT_ERROR,
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
        outcome: PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_NETWORK_ERROR,
      },
    ]);
  });
});

function targetResponse(overrides: Partial<GatewayTargetResponse> = {}): GatewayTargetResponse {
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
    ...overrides,
  };
}

function targetRequest(overrides: Partial<GatewayTargetRequest> = {}): GatewayTargetRequest {
  return {
    body: {
      kind: 'none',
      replayability: 'replayable',
    },
    fetch: {},
    headers: [],
    method: 'GET',
    url: 'https://example.com/resource',
    ...overrides,
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
