# proxy-gateway local registry lab

This lab simulates a real npm publish/install cycle without publishing to npmjs.com.
It starts Verdaccio as a local npm registry, publishes `@echospecter/proxy-gateway` into it, then starts a separate Node.js consumer container that installs the package by name and checks runtime and type-level package consumption.

## Usage

From the root of the `@echospecter/proxy-gateway` repository:

```sh
docker compose -f e2e/local-registry/docker-compose.yml up -d verdaccio
```

```sh
./e2e/local-registry/scripts/publish-local.sh .
```

```sh
docker compose -f e2e/local-registry/docker-compose.yml run --rm consumer
```

Open Verdaccio UI at `http://localhost:4873` if you want to inspect the local package.

If you need to publish the same package version again, reset the registry volume:

```sh
./e2e/local-registry/scripts/reset-registry.sh
```

Then start Verdaccio and publish again.

## What this checks

- `npm publish` against a real registry endpoint.
- Package contents produced by the package `files` contract.
- Installation by package name from another project.
- Public runtime exports and deferred framework wrapper absence.
- TypeScript type resolution from the published package.
- ESM import from `exports.import`.
- CJS require from `exports.require`.
- Node HTTP handler wiring through a real `node:http` server.
- JSON Base64 request/response body handling.
- Multipart request body handling.
- Basic `createProxyGateway()` execution through public API only.

## Notes

The Verdaccio config allows anonymous publish only for local development. Do not expose this registry outside your machine.
