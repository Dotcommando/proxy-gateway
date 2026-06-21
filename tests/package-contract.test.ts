import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

enum PACKAGE_FILE {
  CJS_ENTRY = 'dist/index.cjs',
  CJS_TYPES = 'dist/index.d.cts',
  ESM_ENTRY = 'dist/index.js',
  ESM_TYPES = 'dist/index.d.ts',
  LICENSE = 'LICENSE',
  PACKAGE_JSON = 'package.json',
  README = 'README.md',
}

enum PACKAGE_FIELD {
  DEPENDENCIES = 'dependencies',
  OPTIONAL_DEPENDENCIES = 'optionalDependencies',
}

enum PUBLIC_RUNTIME_EXPORT {
  CREATE_NODE_HTTP_HANDLER = 'createNodeHttpHandler',
  CREATE_MEMORY_PROXY_SESSION_STORE = 'createMemoryProxySessionStore',
  CREATE_PROXY_GATEWAY = 'createProxyGateway',
  PIPELINE_STEP_TYPE = 'PIPELINE_STEP_TYPE',
  PROXY_GEO_STRICTNESS = 'PROXY_GEO_STRICTNESS',
  PROXY_IDENTITY_ISOLATION_SCOPE = 'PROXY_IDENTITY_ISOLATION_SCOPE',
  PROXY_IDENTITY_ROTATION = 'PROXY_IDENTITY_ROTATION',
  PROXY_PLAN_KIND = 'PROXY_PLAN_KIND',
  PROXY_PROVIDER_COUNTRY_SELECTION = 'PROXY_PROVIDER_COUNTRY_SELECTION',
  PROXY_PROVIDER_GEO_MODE = 'PROXY_PROVIDER_GEO_MODE',
  WIRE_PROTOCOL_VERSION = 'WIRE_PROTOCOL_VERSION',
}

enum DEFERRED_FRAMEWORK_EXPORT {
  CREATE_EXPRESS_MIDDLEWARE = 'createExpressMiddleware',
  CREATE_FASTIFY_PLUGIN = 'createFastifyPlugin',
  CREATE_NEST_PROXY_GATEWAY_MODULE = 'createNestProxyGatewayModule',
}

enum PACK_FORBIDDEN_PATH_PREFIX {
  SRC = 'src/',
  TESTS = 'tests/',
}

const PACKAGE_JSON_PATH = join(process.cwd(), PACKAGE_FILE.PACKAGE_JSON);

describe('package contract', () => {
  it('has no runtime dependency fields', () => {
    expect(readRuntimeDependencyNames()).toEqual([]);
  });

  it('contains the documented files in npm pack dry-run output', () => {
    const paths = readPackedFilePaths();

    expect(paths).toEqual(expect.arrayContaining(Object.values(PACKAGE_FILE)));
    expect(
      paths.filter((path) =>
        Object.values(PACK_FORBIDDEN_PATH_PREFIX).some((prefix) =>
          path.startsWith(prefix),
        ),
      ),
    ).toEqual([]);
  });

  it('has build artifacts before package smoke checks run', () => {
    for (const filePath of [
      PACKAGE_FILE.CJS_ENTRY,
      PACKAGE_FILE.CJS_TYPES,
      PACKAGE_FILE.ESM_ENTRY,
      PACKAGE_FILE.ESM_TYPES,
    ]) {
      expect(existsSync(join(process.cwd(), filePath))).toBe(true);
    }
  });

  it('loads the built ESM entrypoint', () => {
    expect(runNodeScript(createEsmSmokeScript())).toBe('ok');
  });

  it('loads the built CJS entrypoint', () => {
    expect(runNodeScript(createCjsSmokeScript())).toBe('ok');
  });
});

function readRuntimeDependencyNames(): string[] {
  const packageJson: unknown = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8'));

  return Object.values(PACKAGE_FIELD).flatMap((fieldName) =>
    readObjectKeys(readProperty(packageJson, fieldName)),
  );
}

function readPackedFilePaths(): string[] {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  const parsed: unknown = JSON.parse(output);
  const firstEntry = Array.isArray(parsed) ? parsed[0] : undefined;
  const files = readProperty(firstEntry, 'files');

  return Array.isArray(files)
    ? files.flatMap((file) => {
        const path = readProperty(file, 'path');

        return typeof path === 'string' ? [path] : [];
      })
    : [];
}

function readProperty(value: unknown, propertyName: string): unknown {
  return value !== null && typeof value === 'object'
    ? Reflect.get(value, propertyName)
    : undefined;
}

function readObjectKeys(value: unknown): string[] {
  return value !== null && typeof value === 'object' ? Object.keys(value) : [];
}

function runNodeScript(script: string): string {
  return execFileSync(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
  }).trim();
}

function createEsmSmokeScript(): string {
  return [
    "import('./dist/index.js').then((gateway) => {",
    createRuntimeExportAssertionScript('gateway'),
    '  console.log("ok");',
    '}).catch((error) => {',
    '  console.error(error);',
    '  process.exit(1);',
    '});',
  ].join('\n');
}

function createCjsSmokeScript(): string {
  return [
    "const gateway = require('./dist/index.cjs');",
    createRuntimeExportAssertionScript('gateway'),
    'console.log("ok");',
  ].join('\n');
}

function createRuntimeExportAssertionScript(namespaceName: string): string {
  return [
    `  if (typeof ${namespaceName}.${PUBLIC_RUNTIME_EXPORT.CREATE_PROXY_GATEWAY} !== 'function') throw new Error('${PUBLIC_RUNTIME_EXPORT.CREATE_PROXY_GATEWAY} missing');`,
    `  if (typeof ${namespaceName}.${PUBLIC_RUNTIME_EXPORT.CREATE_NODE_HTTP_HANDLER} !== 'function') throw new Error('${PUBLIC_RUNTIME_EXPORT.CREATE_NODE_HTTP_HANDLER} missing');`,
    `  if (typeof ${namespaceName}.${PUBLIC_RUNTIME_EXPORT.CREATE_MEMORY_PROXY_SESSION_STORE} !== 'function') throw new Error('${PUBLIC_RUNTIME_EXPORT.CREATE_MEMORY_PROXY_SESSION_STORE} missing');`,
    `  if (${namespaceName}.${PUBLIC_RUNTIME_EXPORT.WIRE_PROTOCOL_VERSION} !== 'proxy-fetch.v1') throw new Error('${PUBLIC_RUNTIME_EXPORT.WIRE_PROTOCOL_VERSION} mismatch');`,
    `  if (${namespaceName}.${PUBLIC_RUNTIME_EXPORT.PIPELINE_STEP_TYPE}.PLAN_FALLBACK !== 'plan.fallback') throw new Error('${PUBLIC_RUNTIME_EXPORT.PIPELINE_STEP_TYPE} mismatch');`,
    `  if (${namespaceName}.${PUBLIC_RUNTIME_EXPORT.PROXY_GEO_STRICTNESS}.REQUIRED !== 'required') throw new Error('${PUBLIC_RUNTIME_EXPORT.PROXY_GEO_STRICTNESS} mismatch');`,
    `  if (${namespaceName}.${PUBLIC_RUNTIME_EXPORT.PROXY_IDENTITY_ISOLATION_SCOPE}.TENANT !== 'tenant') throw new Error('${PUBLIC_RUNTIME_EXPORT.PROXY_IDENTITY_ISOLATION_SCOPE} mismatch');`,
    `  if (${namespaceName}.${PUBLIC_RUNTIME_EXPORT.PROXY_IDENTITY_ROTATION}.STICKY !== 'sticky') throw new Error('${PUBLIC_RUNTIME_EXPORT.PROXY_IDENTITY_ROTATION} mismatch');`,
    `  if (${namespaceName}.${PUBLIC_RUNTIME_EXPORT.PROXY_PLAN_KIND}.FALLBACK !== 'fallback') throw new Error('${PUBLIC_RUNTIME_EXPORT.PROXY_PLAN_KIND} mismatch');`,
    `  if (${namespaceName}.${PUBLIC_RUNTIME_EXPORT.PROXY_PROVIDER_COUNTRY_SELECTION}.PROVIDER_CONFIG !== 'provider-config') throw new Error('${PUBLIC_RUNTIME_EXPORT.PROXY_PROVIDER_COUNTRY_SELECTION} mismatch');`,
    `  if (${namespaceName}.${PUBLIC_RUNTIME_EXPORT.PROXY_PROVIDER_GEO_MODE}.GUARANTEED !== 'guaranteed') throw new Error('${PUBLIC_RUNTIME_EXPORT.PROXY_PROVIDER_GEO_MODE} mismatch');`,
    `  if ('${DEFERRED_FRAMEWORK_EXPORT.CREATE_EXPRESS_MIDDLEWARE}' in ${namespaceName}) throw new Error('${DEFERRED_FRAMEWORK_EXPORT.CREATE_EXPRESS_MIDDLEWARE} should not be exported');`,
    `  if ('${DEFERRED_FRAMEWORK_EXPORT.CREATE_FASTIFY_PLUGIN}' in ${namespaceName}) throw new Error('${DEFERRED_FRAMEWORK_EXPORT.CREATE_FASTIFY_PLUGIN} should not be exported');`,
    `  if ('${DEFERRED_FRAMEWORK_EXPORT.CREATE_NEST_PROXY_GATEWAY_MODULE}' in ${namespaceName}) throw new Error('${DEFERRED_FRAMEWORK_EXPORT.CREATE_NEST_PROXY_GATEWAY_MODULE} should not be exported');`,
  ].join('\n');
}
