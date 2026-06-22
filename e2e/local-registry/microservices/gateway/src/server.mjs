import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number.parseInt(process.env.MICRO_GATEWAY_PORT ?? '8080', 10);

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
