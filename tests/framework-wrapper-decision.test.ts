import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import * as proxyGateway from '../src';

enum DEFERRED_FRAMEWORK_EXPORT {
  CREATE_EXPRESS_MIDDLEWARE = 'createExpressMiddleware',
  CREATE_FASTIFY_PLUGIN = 'createFastifyPlugin',
  CREATE_NEST_PROXY_GATEWAY_MODULE = 'createNestProxyGatewayModule',
}

enum CORE_INBOUND_EXPORT {
  CREATE_NODE_HTTP_HANDLER = 'createNodeHttpHandler',
}

enum FRAMEWORK_PACKAGE {
  EXPRESS = 'express',
  FASTIFY = 'fastify',
  NEST_COMMON = '@nestjs/common',
  NEST_CORE = '@nestjs/core',
  NEST_MICROSERVICES = '@nestjs/microservices',
  NEST_PLATFORM_EXPRESS = '@nestjs/platform-express',
  NEST_PLATFORM_FASTIFY = '@nestjs/platform-fastify',
}

interface IFrameworkImportMatch {
  filePath: string;
  packageName: string;
}

const README_PATH = join(process.cwd(), 'README.md');
const SOURCE_ROOT = join(process.cwd(), 'src');

describe('framework wrapper decision', () => {
  it('exports the Node HTTP handler and defers framework wrappers from the core API', () => {
    expect(CORE_INBOUND_EXPORT.CREATE_NODE_HTTP_HANDLER in proxyGateway).toBe(
      true,
    );

    for (const exportName of Object.values(DEFERRED_FRAMEWORK_EXPORT)) {
      expect(exportName in proxyGateway).toBe(false);
    }
  });

  it('documents framework wrappers as separate packages or future work', () => {
    const readme = readFileSync(README_PATH, 'utf8');

    expect(readme).toContain(
      'The core v0.1 package does not export Express, Fastify, or NestJS wrappers.',
    );
  });

  it('does not import framework packages from runtime source', () => {
    expect(findFrameworkImports(SOURCE_ROOT)).toEqual([]);
  });
});

function findFrameworkImports(sourceRoot: string): IFrameworkImportMatch[] {
  return listTypeScriptFiles(sourceRoot).flatMap((filePath) => {
    const source = readFileSync(filePath, 'utf8');

    return Object.values(FRAMEWORK_PACKAGE)
      .filter((packageName) => importsPackage(source, packageName))
      .map((packageName) => ({
        filePath: relative(process.cwd(), filePath),
        packageName,
      }));
  });
}

function listTypeScriptFiles(directoryPath: string): string[] {
  return readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directoryPath, entry.name);

    return entry.isDirectory()
      ? listTypeScriptFiles(entryPath)
      : entry.name.endsWith('.ts')
        ? [entryPath]
        : [];
  });
}

function importsPackage(source: string, packageName: string): boolean {
  const escapedPackageName = escapeRegExp(packageName);
  const staticImportPattern = new RegExp(
    `\\bfrom\\s+['"]${escapedPackageName}['"]`,
  );
  const dynamicImportPattern = new RegExp(
    `\\bimport\\s*\\(\\s*['"]${escapedPackageName}['"]\\s*\\)`,
  );
  const sideEffectImportPattern = new RegExp(
    `\\bimport\\s+['"]${escapedPackageName}['"]`,
  );

  return (
    staticImportPattern.test(source)
    || dynamicImportPattern.test(source)
    || sideEffectImportPattern.test(source)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
