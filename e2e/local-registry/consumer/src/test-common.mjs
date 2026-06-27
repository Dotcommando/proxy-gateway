import assert from 'node:assert/strict';

export function createProvider() {
  return {
    id: 'local-direct-provider',
    enabled: true,
    adapter: {
      kind: 'local-direct',
      async getCapabilities() {
        return {};
      },
      async acquire(input) {
        return {
          id: `lease-${input.requestId}`,
          route: {
            kind: 'direct'
          }
        };
      },
      async release() {}
    }
  };
}

export function createTransport() {
  return {
    async execute(input) {
      const finalUrlCheck = input.finalUrlGuard?.check({
        baseUrl: 'https://example.test/base/path',
        url: '/safe-final-url'
      });

      if (finalUrlCheck?.kind === 'rejected') {
        throw new Error('finalUrlGuard unexpectedly rejected a safe relative URL');
      }

      const targetUrl = input.target.url instanceof URL
        ? input.target.url.href
        : String(input.target.url);

      return {
        body: {
          kind: 'text',
          text: `local consumer reached target: ${input.target.method} ${targetUrl}`
        },
        headers: [
          ['content-type', 'text/plain; charset=utf-8'],
          ['x-local-consumer', 'ok']
        ],
        redirected: false,
        status: 200,
        statusText: 'OK',
        type: 'basic',
        url: targetUrl
      };
    }
  };
}

export function createProxyFetchEnvelope() {
  return {
    version: 'proxy-fetch.v1',
    request: {
      url: 'https://example.test/hello?visible=1',
      method: 'POST',
      headers: [
        ['content-type', 'text/plain; charset=utf-8'],
        ['idempotency-key', 'local-test-1']
      ],
      body: {
        kind: 'text',
        text: 'hello from consumer'
      },
      redirect: 'manual'
    },
    context: {
      useCase: 'local-registry-test',
      metadata: {
        source: 'docker-consumer'
      }
    },
    options: {
      timeoutMs: 5000
    }
  };
}

export async function assertGatewayResponse(createProxyGateway) {
  const gateway = createProxyGateway({
    plan: {
      attempts: [
        {
          provider: 'local-direct-provider'
        }
      ],
      kind: 'fallback'
    },
    providers: [createProvider()],
    transport: createTransport()
  });

  const response = await gateway.handle(new Request('http://local-gateway/proxy-fetch', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json'
    },
    body: JSON.stringify(createProxyFetchEnvelope())
  }));

  const envelope = await response.json();

  assert.equal(response.status, 200);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.response?.status, 200);
  assert.equal(envelope.response?.body?.kind, 'text');
  assert.match(envelope.response.body.text, /local consumer reached target: POST/);
}
