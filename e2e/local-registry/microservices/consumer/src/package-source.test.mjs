import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { waitForJson } from './helpers/http.mjs';

const gatewayBaseUrl =
  process.env.MICRO_GATEWAY_BASE_URL ?? 'http://localhost:8080';

test('package sources resolve through Verdaccio and npmjs uplink', async () => {
  const proxyFetchPackage = await readInstalledPackageJson(
    '@echospecter/proxy-fetch',
  );
  const gatewayPackage = await waitForJson(`${gatewayBaseUrl}/package-source`);

  assert.equal(proxyFetchPackage.name, '@echospecter/proxy-fetch');
  assert.match(proxyFetchPackage.version, /^0\.1\.\d+$/u);
  assert.equal(gatewayPackage.name, '@echospecter/proxy-gateway');
  assert.match(gatewayPackage.version, /^\d+\.\d+\.\d+$/u);
  assert.equal(gatewayPackage.registry, 'http://verdaccio:4873');
});

async function readInstalledPackageJson(packageName) {
  const packageJsonUrl = new URL(
    `../node_modules/${packageName}/package.json`,
    import.meta.url,
  );
  const json = await readFile(packageJsonUrl, 'utf8');

  return JSON.parse(json);
}
