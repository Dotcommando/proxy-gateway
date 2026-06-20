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
        ['idempotency-key', 'local-smoke-1']
      ],
      body: {
        kind: 'text',
        text: 'hello from consumer'
      },
      redirect: 'manual'
    },
    context: {
      useCase: 'local-registry-smoke',
      metadata: {
        source: 'docker-consumer'
      }
    },
    options: {
      timeoutMs: 5000
    }
  };
}

export async function assertGatewaySmoke(createProxyGateway, label) {
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

  if (response.status !== 200) {
    throw new Error(`${label}: expected HTTP 200 service response, got ${response.status}`);
  }
  if (envelope.ok !== true) {
    throw new Error(`${label}: expected ok=true service envelope: ${JSON.stringify(envelope)}`);
  }
  if (envelope.response?.status !== 200) {
    throw new Error(`${label}: expected target status 200: ${JSON.stringify(envelope)}`);
  }
  if (envelope.response?.body?.kind !== 'text') {
    throw new Error(`${label}: expected text body: ${JSON.stringify(envelope)}`);
  }
  if (!envelope.response.body.text.includes('local consumer reached target: POST')) {
    throw new Error(`${label}: unexpected target body: ${envelope.response.body.text}`);
  }

  console.log(`${label}: ok`);
}
