# AGENTS.md - Local Registry E2E

This lab verifies publish/install behavior without publishing to npmjs.org.

Use Verdaccio only as a local registry simulation:

```sh
docker compose -f e2e/local-registry/docker-compose.yml up -d verdaccio
./e2e/local-registry/scripts/publish-local.sh .
docker compose -f e2e/local-registry/docker-compose.yml run --rm consumer
```

Reset before republishing the same package version:

```sh
./e2e/local-registry/scripts/reset-registry.sh
```

Rules:

```txt
- Never publish to npmjs.org from this lab.
- `publish-local.sh` must publish only to `http://localhost:4873`.
- Do not add `always-auth`; current npm warns on that config.
- `.npmrc.local-registry` is generated local state and must stay ignored.
- The consumer should install with `--package-lock=false` so Verdaccio tarball URLs are not committed.
- The existing consumer should depend on `@echospecter/proxy-gateway` through the `local` dist-tag produced by `publish-local.sh`, not a hard-coded package version.
- Keep the consumer on the minimum supported Node line unless explicitly testing a version matrix.
- Root lint may cover consumer JS test files, but consumer TS type contract files compile through the consumer `test:types` script.
- Existing and new consumer scenarios should run through `node:test` with `node:assert/strict`; shell scripts and Docker Compose should only orchestrate publishing, installing, and test command execution.
- Microservice lab packages live under `e2e/local-registry/microservices/consumer`, `gateway`, and `mock-provider`; Docker Compose service names may still use `micro-consumer`, `micro-gateway`, and `micro-provider`.
- The microservice compose lab must use a dedicated project name, distinct `micro-*` volumes, and no fixed `container_name` values so it can coexist with the existing local-registry lab.
```

Consumer test coverage should include:

```txt
- public runtime exports and deferred framework wrapper absence;
- TypeScript type resolution from the published package;
- ESM import from `exports.import`;
- CJS require from `exports.require`;
- Node HTTP handler wiring through a real node:http server;
- JSON Base64 body handling;
- multipart request body handling;
- v0.2 route/default-route config, route fallback, pipeline built-ins (`requirements.*`, provider filtering/ranking, `plan.fallback`), sticky session reuse, memory session store usage, and related public type imports.
```
