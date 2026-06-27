import assert from 'node:assert/strict';
import test from 'node:test';

import { createProxyFetch } from '@echospecter/proxy-fetch';

import { waitForJson } from './helpers/http.mjs';

const gatewayBaseUrl =
  process.env.MICRO_GATEWAY_BASE_URL ?? 'http://localhost:8080';
const providerBaseUrl =
  process.env.MICRO_PROVIDER_BASE_URL ?? 'http://localhost:8081';
const serviceUrl = `${gatewayBaseUrl}/fetch`;
const streamLineCount = 10;
const streamByteLength = 1024;
const worldBankMinJsonItems = 2;
const temporaryUpstreamFailureStatuses = new Set([429, 502, 503, 504]);
const proxyFetch = createProxyFetch({
  serviceUrl,
  timeoutMs: 60_000,
});

const liveEndpoints = {
  githubReadme: 'https://api.github.com/repos/nodejs/node/readme',
  httpbinBase64: 'https://httpbin.org/base64/SGVsbG8sIGZldGNoIQ==',
  httpbinGzip: 'https://httpbin.org/gzip',
  httpbinPost: 'https://httpbin.org/post',
  httpbinStream: `https://httpbin.org/stream/${streamLineCount}`,
  httpbinStreamBytes: `https://httpbin.org/stream-bytes/${streamByteLength}?chunk_size=128`,
  jsonPlaceholder: 'https://jsonplaceholder.typicode.com/posts/1',
  openMeteo:
    'https://api.open-meteo.com/v1/forecast?latitude=34.6851&longitude=33.0442&current=temperature_2m,wind_speed_10m',
  picsumImage: 'https://picsum.photos/200/300',
  worldBankJson:
    'https://api.worldbank.org/v2/country/cyp/indicator/NY.GDP.MKTP.CD?date=2023&format=json',
  worldBankXml:
    'https://api.worldbank.org/v2/country/cyp/indicator/NY.GDP.MKTP.CD?date=2023',
};

test('live-endpoints JSONPlaceholder simple JSON GET', async (context) => {
  const response = await executeLiveFetch(liveEndpoints.jsonPlaceholder);

  if (skipStrictChecksForTemporaryUpstreamFailure(context, 'JSONPlaceholder', response)) {
    return;
  }

  const data = await response.json();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/u);
  assert.equal(data.id, 1);
  assert.equal(typeof data.title, 'string');
  assert.equal(typeof data.body, 'string');
});

test('live-endpoints Open-Meteo JSON API without API key', async (context) => {
  const response = await executeLiveFetch(liveEndpoints.openMeteo);

  if (skipStrictChecksForTemporaryUpstreamFailure(context, 'Open-Meteo', response)) {
    return;
  }

  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(typeof data.latitude, 'number');
  assert.equal(typeof data.longitude, 'number');
  assert.equal(typeof data.current, 'object');
  assert.equal(typeof data.current.temperature_2m, 'number');
  assert.equal(typeof data.current.wind_speed_10m, 'number');
});

test('live-endpoints GitHub REST API JSON with base64 file content', async (context) => {
  const response = await executeLiveFetch(liveEndpoints.githubReadme, {
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  const data = await response.json();

  if (response.status === 403) {
    context.diagnostic(`GitHub strict assertions skipped after 403: ${data.message}`);
    return;
  }
  if (skipStrictChecksForTemporaryUpstreamFailure(context, 'GitHub README', response)) {
    return;
  }

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /json/u);
  assert.equal(data.name, 'README.md');
  assert.equal(data.encoding, 'base64');
  assert.equal(typeof data.content, 'string');
  assert.ok(Buffer.from(data.content.replace(/\n/gu, ''), 'base64').toString('utf8').length > 0);
});

test('live-endpoints httpbin base64 decoded text response', async (context) => {
  const response = await executeLiveFetch(liveEndpoints.httpbinBase64);

  if (skipStrictChecksForTemporaryUpstreamFailure(context, 'httpbin base64', response)) {
    return;
  }

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'Hello, fetch!');
});

test('live-endpoints httpbin streaming JSON lines', async (context) => {
  const response = await executeLiveFetch(liveEndpoints.httpbinStream);

  if (skipStrictChecksForTemporaryUpstreamFailure(context, 'httpbin stream', response)) {
    return;
  }

  const lines = (await response.text()).trim().split('\n');

  assert.equal(response.status, 200);
  assert.equal(lines.length, streamLineCount);

  for (const line of lines) {
    assert.doesNotThrow(() => JSON.parse(line));
  }
});

test('live-endpoints httpbin streamed random binary bytes', async (context) => {
  const response = await executeLiveFetch(liveEndpoints.httpbinStreamBytes);

  if (skipStrictChecksForTemporaryUpstreamFailure(context, 'httpbin stream bytes', response)) {
    return;
  }

  assert.equal(response.status, 200);
  assert.equal((await response.arrayBuffer()).byteLength, streamByteLength);
});

test('live-endpoints httpbin multipart form-data POST echo', async (context) => {
  const formData = new FormData();

  formData.set('name', 'proxy-fetch');
  formData.set(
    'file',
    new Blob(['hello from file'], {
      type: 'text/plain',
    }),
    'hello.txt',
  );

  const response = await executeLiveFetch(liveEndpoints.httpbinPost, {
    body: formData,
    method: 'POST',
  });

  if (skipStrictChecksForTemporaryUpstreamFailure(context, 'httpbin multipart', response)) {
    return;
  }

  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.form.name, 'proxy-fetch');
  assert.equal(data.files.file, 'hello from file');
  assert.match(data.headers['Content-Type'], /multipart\/form-data/u);
});

test('live-endpoints httpbin gzip response', async (context) => {
  const response = await executeLiveFetch(liveEndpoints.httpbinGzip);

  if (skipStrictChecksForTemporaryUpstreamFailure(context, 'httpbin gzip', response)) {
    return;
  }

  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.gzipped, true);
  assert.equal(typeof data.headers, 'object');
});

test('live-endpoints Picsum binary image response with redirect', async (context) => {
  const response = await executeLiveFetch(liveEndpoints.picsumImage);

  if (skipStrictChecksForTemporaryUpstreamFailure(context, 'Picsum image', response)) {
    return;
  }

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /image\/jpeg/u);
  assert.ok((await response.arrayBuffer()).byteLength > 1);
});

test('live-endpoints World Bank XML and JSON variants', async (context) => {
  const xmlResponse = await executeLiveFetch(liveEndpoints.worldBankXml);

  if (skipStrictChecksForTemporaryUpstreamFailure(context, 'World Bank XML', xmlResponse)) {
    return;
  }

  assert.equal(xmlResponse.status, 200);
  assert.match(await xmlResponse.text(), /<\?xml/u);

  const jsonResponse = await executeLiveFetch(liveEndpoints.worldBankJson);

  if (skipStrictChecksForTemporaryUpstreamFailure(context, 'World Bank JSON', jsonResponse)) {
    return;
  }

  const json = await jsonResponse.json();

  assert.equal(jsonResponse.status, 200);
  assert.equal(Array.isArray(json), true);
  assert.ok(json.length >= worldBankMinJsonItems);
});

async function executeLiveFetch(url, init = {}) {
  await resetAllObservations();

  const response = await proxyFetch(url, {
    ...init,
    headers: liveHeaders(init.headers),
  });
  const observations = await readAllObservations();

  assert.equal(
    observations.gateway.items.some(
      (item) => item.type === 'transport-execute' && item.mode === 'live-public',
    ),
    true,
  );
  assert.equal(
    observations.provider.items.some((item) => item.mode === 'live-public'),
    true,
  );

  return response;
}

function liveHeaders(headers = {}) {
  return {
    ...headers,
    'x-micro-mode': 'live-public',
  };
}

function skipStrictChecksForTemporaryUpstreamFailure(context, label, response) {
  if (!temporaryUpstreamFailureStatuses.has(response.status)) {
    return false;
  }

  context.diagnostic(
    `${label} strict live assertions skipped after temporary upstream status ${response.status}.`,
  );

  return true;
}

async function resetAllObservations() {
  await Promise.all([
    resetObservations(gatewayBaseUrl),
    resetObservations(providerBaseUrl),
  ]);
}

async function resetObservations(baseUrl) {
  const response = await fetch(`${baseUrl}/observations/reset`, {
    method: 'POST',
  });
  assert.equal(response.status, 200);
}

async function readAllObservations() {
  const [gateway, provider] = await Promise.all([
    waitForJson(`${gatewayBaseUrl}/observations`),
    waitForJson(`${providerBaseUrl}/observations`),
  ]);

  return {
    gateway,
    provider,
  };
}
