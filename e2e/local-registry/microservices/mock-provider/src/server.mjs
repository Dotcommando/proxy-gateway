import { createServer } from 'node:http';

const port = Number.parseInt(process.env.MICRO_PROVIDER_PORT ?? '8081', 10);
const observations = [];

const server = createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    writeJson(response, 500, {
      error: 'provider_unhandled_error',
      message: error instanceof Error ? error.message : 'unknown error',
    });
  });
});

server.listen(port, '0.0.0.0');

process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});

async function handleRequest(request, response) {
  if (request.method === 'GET' && request.url === '/health') {
    writeJson(response, 200, {
      ok: true,
      service: 'micro-provider',
    });
    return;
  }

  if (request.method === 'POST' && request.url === '/execute') {
    await execute(request, response);
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

  writeJson(response, 404, {
    error: 'not_found',
  });
}

function writeJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(`${JSON.stringify(body)}\n`);
}

async function execute(request, response) {
  const body = await readJson(request);
  const mode = typeof body.mode === 'string' ? body.mode : 'text';
  const observedAt = new Date().toISOString();

  observations.push({
    bodyLength: JSON.stringify(body).length,
    method: request.method,
    mode,
    observedAt,
    path: request.url,
  });

  switch (mode) {
    case 'text':
      writeText(response, 200, 'deterministic text response');
      return;
    case 'json':
      writeJson(response, 200, {
        mode,
        ok: true,
      });
      return;
    case 'binary':
      writeBytes(response, 200, [0, 1, 2, 3, 254, 255]);
      return;
    case 'no-content-204':
      response.writeHead(204);
      response.end();
      return;
    case 'reset-content-205':
      response.writeHead(205);
      response.end();
      return;
    case 'not-modified-304':
      response.writeHead(304);
      response.end();
      return;
    case 'target-404':
      writeText(response, 404, 'deterministic target 404');
      return;
    case 'target-500':
      writeText(response, 500, 'deterministic target 500');
      return;
    case 'slow':
      await delay(typeof body.delayMs === 'number' ? body.delayMs : 250);
      writeText(response, 200, 'deterministic slow response');
      return;
    case 'provider-failure':
      writeJson(response, 503, {
        error: 'provider_failure',
        ok: false,
      });
      return;
    case 'redirect-safe':
      writeRedirect(response, 'https://example.com/final');
      return;
    case 'redirect-denied':
      writeRedirect(response, 'http://127.0.0.1/private');
      return;
    default:
      writeJson(response, 400, {
        error: 'unknown_mode',
        mode,
      });
  }
}

async function readJson(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function writeText(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'text/plain; charset=utf-8',
  });
  response.end(body);
}

function writeBytes(response, statusCode, bytes) {
  response.writeHead(statusCode, {
    'content-type': 'application/octet-stream',
  });
  response.end(Uint8Array.from(bytes));
}

function writeRedirect(response, location) {
  response.writeHead(302, {
    location,
  });
  response.end();
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
