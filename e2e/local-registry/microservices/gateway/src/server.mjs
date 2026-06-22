import { createServer } from 'node:http';

const port = Number.parseInt(process.env.MICRO_GATEWAY_PORT ?? '8080', 10);

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    writeJson(response, 200, {
      ok: true,
      service: 'micro-gateway',
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
