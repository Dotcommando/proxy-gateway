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
- The microservice consumer should use Node test discovery in its `test:e2e` script so npm can append focused filters such as `--test-name-pattern health`.
- Verdaccio config must list the `@echospecter/proxy-fetch` npmjs uplink rule before the broader local-only `@echospecter/*` package rule.
- Focused `micro-consumer` compose runs that require installed packages should execute `npm install --package-lock=false --no-audit --no-fund` before `npm run test:e2e -- --test-name-pattern ...`.
- Focused `micro-consumer` compose runs that exercise the gateway data path should start `micro-provider` and `micro-gateway` first; the full runner owns clean setup, but focused commands may assume those services are already running.
- `reset-registry.sh` must reset both the existing local-registry compose lab and the microservice compose lab volumes.
- The mock-provider deterministic API is `POST /execute` plus `GET /observations` and `POST /observations/reset`; deterministic tests should use it before adding live public endpoint coverage.
- Focused Node test patterns must be specific enough to avoid running unrelated scenario files in parallel.
- The micro-gateway deterministic path is `POST /fetch` through `createNodeHttpHandler(createProxyGateway(...))`; keep health, package-source, and observations endpoints as thin side endpoints around that gateway path.
- Target body observations should use the shared summary shape `{ kind, byteLength, sha256 }`, adding `text` or `base64` only when needed for format-specific assertions.
- Binary request tests should assert byte preservation by reconstructing observed `base64` bodies, and preflight rejection tests must assert the micro-gateway observations stay empty.
- Response format tests should assert native client `Response` behavior and may capture service response `content-type` through a `fetchImpl` wrapper when distinguishing multipart from JSON base64 service transport.
- Special response tests should send valid special envelopes through deterministic micro-gateway modes; invalid service response fixtures should stay consumer-only and assert gateway observations remain empty.
- Client boundary tests may opt into service-header observations with a dedicated service request header; API keys must be asserted on service headers and absent from target headers.
- Fetch metadata tests should assert normalized `targetFetch` at both micro-gateway and mock-provider boundaries, and should use explicit `final-url-check` observations for redirect/final URL guard coverage.
- Gateway policy tests should use declarative `defaultRoute`, `routes`, and `pipelines` config and assert selected route, pipeline, provider, requirements, and fallback sequence through e2e observations instead of package internals.
- Sticky session and parallel microservice tests should correlate gateway and mock-provider observations by gateway `requestId`; assert isolation through context fields that `@echospecter/proxy-fetch` actually serializes, and use target-host isolation when tenant or route keys are not present at the client boundary.
- Retry/fallback replayability tests should keep parser-limit failures separate from target-body replayability decisions; use JSON base64 transport when a large binary target body must reach gateway planning and become `non-replayable`.
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
