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

## Microservice E2E

Run the full microservice lab with one command:

```sh
npm run test:e2e:microservices
```

This runner:

- resets the local-registry and microservice Docker volumes;
- starts Verdaccio;
- publishes the current `@echospecter/proxy-gateway` package to Verdaccio with
  the `local` dist-tag;
- starts `micro-provider` and `micro-gateway`;
- runs the `micro-consumer` `node:test` suite through
  `@echospecter/proxy-fetch`;
- always runs `docker compose ... down -v` on exit.

The lab locally publishes only `@echospecter/proxy-gateway`.
`@echospecter/proxy-fetch` is installed from npmjs through Verdaccio's npmjs
uplink, so the containers still use one registry URL while the gateway package
comes from the local publish.

The microservice suite includes deterministic gateway/provider scenarios and a
small live public endpoint set. The live tests are not the deterministic
compatibility source of truth; they may skip strict assertions for temporary
upstream statuses `429`, `502`, `503`, and `504` after confirming that the
gateway/provider path was exercised.

Because this suite uses Docker and live public network endpoints, keep it out of
`npm test` and `prepublishOnly`. Run it explicitly before release or after
changes to package publishing, wire formats, gateway routing, retry/fallback,
timeouts, buffering, redaction, or proxy-fetch compatibility.

For focused microservice debugging, start the services and run a specific test
pattern:

```sh
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml up -d micro-provider micro-gateway
docker compose -p proxy-gateway-micro-e2e -f e2e/local-registry/docker-compose.microservices.yml run --rm micro-consumer sh -lc "npm install --package-lock=false --no-audit --no-fund && npm run test:e2e -- --test-name-pattern health"
```

If package internals changed, reset the registry and publish before starting
`micro-gateway`, otherwise the gateway container may install an older local
tarball for the same package version.

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
- v0.2 route/default-route config, route fallback, pipeline built-ins, sticky session reuse, `createMemoryProxySessionStore()` usage, and public type imports.
- Full microservice data flow:
  `@echospecter/proxy-fetch` consumer -> micro-gateway -> mock-provider ->
  deterministic or live public target response.
- Request/response formats, fetch metadata, client boundaries, policy routing,
  sticky sessions, retry/fallback, buffering limits, timeout/abort behavior,
  target access, redaction, and live public endpoint passthrough.

## Notes

The Verdaccio config allows anonymous publish only for local development. Do not expose this registry outside your machine.

Do not commit machine-local proxy-fetch checkout paths in docs, scripts, or
fixtures. The live endpoint scenarios were copied from the public proxy-fetch
test source:
`https://github.com/Dotcommando/proxy-fetch/blob/master/tests/live/live-endpoints.live-e2e.cjs`.

Open follow-ups after the initial microservice lab:

- decide whether `@echospecter/proxy-fetch` should stay on a semver range or be
  pinned to an exact npm version for release validation;
- decide whether to add a Node version matrix, including a Node 26 variant for
  proxy-fetch body compatibility;
- decide whether live endpoint logs should print by default or only on failure.
