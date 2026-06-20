# AGENTS.md - Tests

Use TDD for phase work: write a failing test first, implement the smallest change that makes it pass, then refactor with tests green.

Every step in the active top-level phase/task markdown file should be testable and should include Red/Green/Verify notes.

Prefer focused unit/contract tests for narrow behavior. Add broader integration tests when behavior crosses parser, normalizer, planner, executor, retry, target access, redaction, and envelope-building boundaries.

For proxy-fetch compatibility, keep deterministic tests for each supported wire body/response format:

```txt
- JSON null body;
- JSON text body;
- JSON base64 body;
- multipart meta/body request;
- streaming multipart shape where applicable;
- JSON text/null/base64 response;
- multipart binary response;
- special response types;
- null-body statuses 204, 205, 304.
```

Do not rely on live public network tests as the compatibility source of truth.

When a step changes public contracts or exported types, run:

```sh
npm run typecheck
npm run lint
npm test
npm run pack:check
```

Package contract tests should verify build artifacts, public ESM/CJS entrypoints, zero runtime dependency fields, and `npm pack --dry-run` contents. They must never publish the package. Packed package contents should include README, LICENSE, built ESM/CJS/types, and package metadata, and should not include `src/` or `tests/`.
