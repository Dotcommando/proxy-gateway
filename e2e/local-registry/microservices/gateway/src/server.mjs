import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

import {
  createNodeHttpHandler,
  createProxyGateway,
  PROXY_PLAN_KIND,
  PROXY_ROUTE_KIND,
} from '@echospecter/proxy-gateway';

const port = Number.parseInt(process.env.MICRO_GATEWAY_PORT ?? '8080', 10);
const providerBaseUrl =
  process.env.MICRO_PROVIDER_BASE_URL ?? 'http://localhost:8081';
const observations = [];
const providerInstanceId = 'micro-provider';
const providerKind = 'mock-provider';
const gatewayHandler = createNodeHttpHandler(createGateway());

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    writeJson(response, 200, {
      ok: true,
      service: 'micro-gateway',
    });
    return;
  }

  if (request.method === 'GET' && request.url === '/package-source') {
    writePackageSource(response).catch((error) => {
      writeJson(response, 500, {
        error: 'package_source_unavailable',
        message: error instanceof Error ? error.message : 'unknown error',
      });
    });
    return;
  }

  if (request.method === 'GET' && request.url === '/observations') {
    writeJson(response, 200, {
      items: observations,
    });
    return;
  }

  if (request.method === 'POST' && request.url === '/observations/reset') {
    observations.length = 0;
    writeJson(response, 200, {
      ok: true,
    });
    return;
  }

  if (request.method === 'POST' && request.url === '/fetch') {
    gatewayHandler(request, response).catch((error) => {
      writeJson(response, 500, {
        error: 'gateway_handler_failed',
        message: error instanceof Error ? error.message : 'unknown error',
      });
    });
    return;
  }

  writeJson(response, 404, {
    error: 'not_found',
  });
});

server.listen(port, '0.0.0.0');

process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});

function writeJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(`${JSON.stringify(body)}\n`);
}

async function writePackageSource(response) {
  const packageJsonUrl = new URL(
    '../node_modules/@echospecter/proxy-gateway/package.json',
    import.meta.url,
  );
  const packageJson = JSON.parse(await readFile(packageJsonUrl, 'utf8'));

  writeJson(response, 200, {
    name: packageJson.name,
    registry: process.env.NPM_CONFIG_REGISTRY ?? null,
    version: packageJson.version,
  });
}

function createGateway() {
  return createProxyGateway({
    plan: {
      attempts: [
        {
          provider: providerInstanceId,
        },
      ],
      kind: PROXY_PLAN_KIND.FALLBACK,
    },
    providers: [createProvider()],
    transport: createTransport(),
  });
}

function createProvider() {
  return {
    adapter: {
      acquire: async (input) => {
        observations.push({
          planKind: PROXY_PLAN_KIND.FALLBACK,
          routeKind: PROXY_ROUTE_KIND.DIRECT,
          selectedProvider: input.providerInstanceId,
          session: {
            consistency: input.context.consistency ?? null,
            flowKey: input.context.flowKey ?? null,
          },
          type: 'provider-acquire',
        });

        return {
          id: `${input.providerInstanceId}-${input.requestId}`,
          providerInstanceId: input.providerInstanceId,
          providerKind,
          route: {
            kind: PROXY_ROUTE_KIND.DIRECT,
          },
        };
      },
      getCapabilities: () => ({}),
      kind: providerKind,
      release: async (lease, result) => {
        observations.push({
          outcome: result.outcome,
          providerInstanceId: lease.providerInstanceId,
          type: 'provider-release',
        });
      },
    },
    id: providerInstanceId,
  };
}

function createTransport() {
  return {
    execute: async (input) => {
      const mode = readMode(input.target.url);
      observations.push({
        targetBody: describeTargetBody(input.target.body),
        mode,
        targetMethod: input.target.method,
        targetUrl: input.target.url,
        type: 'transport-execute',
      });

      const providerResponse = await fetch(`${providerBaseUrl}/execute`, {
        body: JSON.stringify({
          mode,
          target: {
            body: serializeTargetBody(input.target.body),
            headers: input.target.headers,
            method: input.target.method,
            url: input.target.url,
          },
        }),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
        redirect: 'manual',
        signal: input.signal,
      });
      const bytes = new Uint8Array(await providerResponse.arrayBuffer());

      return {
        body: createGatewayBody(providerResponse, bytes),
        headers: Array.from(providerResponse.headers.entries()),
        redirected: false,
        status: providerResponse.status,
        statusText: providerResponse.statusText,
        type: 'basic',
        url: input.target.url,
      };
    },
  };
}

function readMode(targetUrl) {
  return new URL(targetUrl).searchParams.get('mode') ?? 'text';
}

function serializeTargetBody(body) {
  if (body.kind === 'none') {
    return bodySummary('none', new Uint8Array(), {});
  }

  if (body.kind === 'text') {
    const bytes = new TextEncoder().encode(body.text);

    return bodySummary('text', bytes, {
      text: body.text,
    });
  }

  if (body.kind === 'bytes') {
    return bodySummary('bytes', body.bytes, {
      base64: Buffer.from(body.bytes).toString('base64'),
    });
  }

  return {
    kind: 'stream',
    replayability: body.replayability,
    sizeBytes: body.sizeBytes ?? null,
  };
}

function describeTargetBody(body) {
  if (body.kind === 'stream') {
    return {
      kind: body.kind,
      replayability: body.replayability,
      sizeBytes: body.sizeBytes ?? null,
    };
  }

  return serializeTargetBody(body);
}

function bodySummary(kind, bytes, extra) {
  return {
    byteLength: bytes.byteLength,
    kind,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    ...extra,
  };
}

function createGatewayBody(response, bytes) {
  if (
    bytes.byteLength === 0
    || response.status === 204
    || response.status === 205
    || response.status === 304
  ) {
    return {
      kind: 'none',
      replayability: 'replayable',
    };
  }

  if ((response.headers.get('content-type') ?? '').startsWith('text/')) {
    return {
      kind: 'text',
      replayability: 'replayable',
      text: new TextDecoder().decode(bytes),
    };
  }

  return {
    bytes,
    kind: 'bytes',
    replayability: 'replayable',
  };
}
