# v0.2 Implementation Plan

Source: v0.1 implementation state, `README.md`, and the architectural rules in `AGENTS.md`.

This phase turns the v0.1 core vertical slice into a configurable gateway:

- full sticky/session behavior;
- declarative routes and default route wiring;
- pipeline wiring with built-in steps;
- removal or narrowing of the temporary direct `providerSelection` bridge;
- release-level e2e coverage through the local Verdaccio registry lab.

## Phase-Specific Layout

- Add `src/app/sessions` for app-level sticky/session coordination.
- Use `src/adapters/outbound` for the dependency-free in-memory session store if it becomes public API.

## Per-Step Maintenance

After completing each step, review the next three steps before moving on. Update them when completed work changes their assumptions, contracts, scope, or Red/Green/Verify notes. If an earlier step already introduced part of a later contract or implementation, narrow the later step to the remaining work; if a planned contract no longer matches the code, correct it; if planned work became unnecessary, remove or mark it as already covered.

## Completion Criteria

- v0.2 public API is reflected in README and package exports.
- Sticky/session behavior is fully implemented, not just modelled.
- Declarative route/default-route configuration works through `createProxyGateway()`.
- Pipeline configuration works through `createProxyGateway()` with useful built-in steps.
- Temporary `providerSelection.providerInstanceId` is removed with tests.

## 1. v0.2 Contract Baseline - Completed

Purpose:
- Capture the current public API gaps before implementation.
- Make the v0.2 target explicit in failing tests.

Red:
- Add public contract tests proving `ProxyGatewayOptions` should accept `routes`, `defaultRoute`, `pipelines`, `stepRegistry`, and `sessionStore`.
- Add type-level tests proving `ProxyRouteRequirements.identity` is a structured identity requirement, not just accepted by the index signature.
- Add tests proving `ProxySessionStorePort` and memory session-store factory are intended public exports.
- Add tests proving real provider/framework/Tor adapters are not exported by this package.
- Add README/API alignment baseline tests for v0.2 route, pipeline, and session examples. In this step, these tests should prove the documented public contract names exist and remain dependency-free; later behavior-specific README alignment belongs to step 23.

Green:
- Add only the minimum public type placeholders required to make the tests compile when the step is intentionally about contract shape.
- Do not wire runtime behavior in this step unless a test requires it.

Verify:
- `npm test -- --runTestsByPath tests/public-api.test.ts tests/public-contract-types.test.ts`
- `npm run typecheck`

Progress:
- Added public contract tests for v0.2 route/default-route, pipeline/step-registry, structured identity, session-store, memory session-store factory, forbidden provider/framework/Tor exports, and README/API baseline names.
- Added minimal public contracts only: `ProxyGatewayOptions.routes`, `defaultRoute`, `pipelines`, `stepRegistry`, `sessionStore`; `ProxyIdentityRequirements`; `ProxySessionRecord`; `ProxySessionStorePort`; `ProxySessionTouch`; and `createMemoryProxySessionStore()`.
- Updated README public API baseline to name route, pipeline, and session contracts without documenting completed runtime behavior for later v0.2 steps.
- Checked nested AGENTS files and updated `src/ports/outbound/AGENTS.md` plus `src/adapters/outbound/AGENTS.md` for the durable session-store ownership rule.

Next three steps reassessment:
- Step 2 is ready. It should replace the placeholder string identity fields with package enums and fully specified `ProxyIdentityRequirements` semantics.
- Step 3 is ready after Step 2. Keep key derivation in `src/app/sessions` and route/host normalization helpers in domain only if they become reusable.
- Step 4 is partly started by the baseline port shape. Its Red/Green work should now focus on behavior contracts, record metadata/identity snapshots, and proving expiry handling belongs to the app-level session manager rather than each store.

## 2. Identity Requirement Model - Completed

Purpose:
- Replace the implicit identity requirements index-signature use with explicit public contracts.

Red:
- Add tests for `ProxyIdentityRequirements` fields:
  - `rotation`;
  - `stickySessionId`;
  - `stickySessionTtlMs`;
  - `isolationKey`;
  - `isolationScope`;
  - `requestNewIdentity`.
- Add tests that identity enum values come from package enums, not inline string literal unions.
- Add tests that `ProxyRouteRequirements.identity` preserves identity fields through planner input/output.

Green:
- Add package enums for identity rotation and isolation-scope values.
- Add `ProxyIdentityRequirements`.
- Add `identity?: ProxyIdentityRequirements` to `ProxyRouteRequirements`.
- Export the new public contracts from the package root.

Verify:
- Identity requirement tests pass.
- Existing planner and provider acquire tests still pass.

Progress:
- Added package enums `PROXY_IDENTITY_ROTATION` and `PROXY_IDENTITY_ISOLATION_SCOPE`.
- Tightened `ProxyIdentityRequirements.rotation` to `PROXY_IDENTITY_ROTATION` and `isolationScope` to `PROXY_IDENTITY_ISOLATION_SCOPE[]`.
- Added public type tests covering `rotation`, `stickySessionId`, `stickySessionTtlMs`, `isolationKey`, `isolationScope`, and `requestNewIdentity`.
- Added planner coverage proving `ProxyRouteRequirements.identity` is preserved from plan config to executable attempts.
- Checked nested AGENTS files and updated `src/ports/outbound/AGENTS.md` for the durable identity requirements contract.

Next three steps reassessment:
- Step 3 is ready. It should use `PROXY_IDENTITY_ISOLATION_SCOPE` directly when deriving deterministic session keys.
- Step 4 is ready but should avoid redefining identity fields; session records should snapshot `ProxyIdentityRequirements`.
- Step 5 remains ready after Step 4. The memory store already exists as a public factory baseline, so Step 5 should focus on behavior coverage, deterministic time inputs where needed, overwrite semantics, and leakage prevention.

## 3. Session Key Derivation - Completed

Purpose:
- Make sticky-session key derivation deterministic, testable, and provider-agnostic.

Red:
- Add domain/app tests for deriving a session key from:
  - explicit `stickySessionId`;
  - `isolationKey`;
  - `tenantId`;
  - `flowKey`;
  - `routeKey`;
  - provider instance id;
  - target host;
  - attempt index when requested.
- Add tests for default scope behavior.
- Add tests that missing scope components are represented deterministically and do not collapse unrelated sessions.
- Add tests for target host normalization before it contributes to the key.

Green:
- Add `src/app/sessions/SessionKeyFactory` or equivalent narrow app collaborator.
- Keep pure URL/host normalization in domain modules if it is reusable by routing.
- Use package enums for isolation scope values.

Verify:
- Session key tests pass.
- Existing target access/routing matcher tests still pass.

Progress:
- Added `src/app/sessions/SessionKeyFactory` with deterministic key derivation.
- Covered explicit `stickySessionId`, `isolationKey`, default isolation scope, explicit `PROXY_IDENTITY_ISOLATION_SCOPE`, tenant/flow/route/provider/target-host components, attempt index when requested, missing component markers, and target host normalization.
- Kept session key derivation app-level and provider-agnostic; no session-store reads/writes or gateway flow wiring were added in this step.
- Checked nested AGENTS files and added session ownership rules to `src/app/AGENTS.md` plus `src/app/sessions/AGENTS.md`.

Next three steps reassessment:
- Step 4 is already partially covered by Step 1. It should focus on locking the existing port and record contracts with behavior/type tests instead of re-adding the port or gateway option.
- Step 5 is already partially covered by Step 1. It should focus on full memory-store behavior tests and implementation hardening instead of creating the factory from scratch.
- Step 6 should use `SessionKeyFactory` for read-path lookup and should keep expiry interpretation and provider compatibility checks in app-level session coordination.

## 4. Session Store Port - Completed

Purpose:
- Add the outbound port that application code or dependency-free adapters can implement.

Red:
- Add port contract tests for batch-oriented session read/write/delete/touch behavior against the existing `ProxySessionStorePort` shape.
- Add type tests for session record fields:
  - session key;
  - provider instance id;
  - provider kind;
  - expiration;
  - identity requirements snapshot;
  - metadata.
- Move expired-record read-path behavior to Step 6, where the app-level session manager exists.

Green:
- Keep the existing `ProxySessionStorePort` in `src/ports/outbound` and refine it only if the contract tests expose a gap.
- Prefer batch-oriented methods where practical, for example `getMany`, `setMany`, `deleteMany`.
- Keep `ProxyGatewayOptions.sessionStore` and package-root exports aligned with the finalized port and record contracts.

Verify:
- Port type tests pass.
- Package public export tests pass.

Progress:
- Added port contract tests for batch `setMany`, `getMany`, `touchMany`, and `deleteMany`.
- Added public type coverage for session key, provider instance id, provider kind, required expiration, identity requirements snapshot, and metadata.
- Tightened `ProxySessionRecord.expiresAt` from optional to required.
- Checked nested AGENTS files and updated `src/ports/outbound/AGENTS.md` for the required expiration field and app-owned expiry interpretation.

Next three steps reassessment:
- Step 5 is partially covered by Step 4's basic batch behavior test. It should focus on memory-store-specific behavior: overwrite semantics, multi-record touch/delete edge cases, deterministic expiry storage, and no cross-session leakage.
- Step 6 is ready. It should treat expired records as missing in the app-level session manager, using the required `expiresAt` field rather than pushing expiry filtering into stores.
- Step 7 is ready after Step 6. It should consume session-manager provider pins without changing the `ProxySessionStorePort` contract.

## 5. Dependency-Free Memory Session Store - Completed

Purpose:
- Provide a useful built-in store for tests, local apps, and simple deployments without adding runtime dependencies.

Red:
- Add tests for `createMemoryProxySessionStore()` in `src/adapters/outbound`.
- Cover set/get/delete/touch for multiple records.
- Cover TTL expiration using an injected clock or deterministic timestamp input.
- Cover overwrite behavior for the same session key.
- Cover no cross-session leakage.

Green:
- Complete the existing dependency-free memory session store in `src/adapters/outbound`.
- Export it from `src/adapters/outbound` and the package root only if intended as public API.
- Do not read globals for time if a clock/now input is available through the port.

Verify:
- Memory store tests pass.
- Package runtime dependency tests still prove zero runtime dependencies.

Progress:
- Added memory-store-specific tests for overwrite behavior, partial touch/delete batches, missing keys, expiration timestamp storage without expiry filtering, and object-reference isolation.
- Hardened `createMemoryProxySessionStore()` to clone records on set/get/touch, including `Date`, identity isolation scope arrays, and metadata objects.
- Verified package runtime dependency checks still pass through `tests/package-contract.test.ts`.
- Checked nested AGENTS files and updated `src/adapters/outbound/AGENTS.md` for no-expiry-interpretation and no-reference-leakage rules.

Next three steps reassessment:
- Step 6 is ready. It should use `SessionKeyFactory`, `ProxySessionStorePort`, required `expiresAt`, and provider-instance validation to return or reject provider pins.
- Step 7 is ready after Step 6. It should consume the session manager output in planner input without changing memory-store semantics.
- Step 8 is ready after Step 7. It should persist records through `ProxySessionStorePort.setMany()` and rely on the store's no-reference-leak behavior rather than adding extra cloning in the write path.

## 6. Session Manager Read Path - Completed

Purpose:
- Resolve existing sticky sessions before provider planning/acquire.

Red:
- Add `SessionManager` tests that:
  - read existing records by derived session key;
  - ignore expired records;
  - delete or replace expired records when policy requires cleanup;
  - return a provider pin when the session record points to an enabled provider;
  - reject or ignore records pointing to disabled/unknown providers;
  - respect `requestNewIdentity`.

Green:
- Add `src/app/sessions/SessionManager`.
- Use `SessionKeyFactory` for all session key derivation.
- Keep provider validation provider-agnostic and based on provider instance id.
- Do not call provider adapters from the session manager.

Verify:
- Session manager read-path tests pass.
- Planner tests still pass.

Progress:
- Added `SessionManager` in `src/app/sessions` for read-path coordination.
- Covered derived-key reads, enabled-provider pins, expired-record misses, optional expired-record cleanup, disabled/unknown provider misses, `requestNewIdentity`, and proof that provider adapters are not called.
- `SessionManager` uses `SessionKeyFactory`, `ProxySessionStorePort`, required `expiresAt`, and provider-instance enabled state only.
- Checked nested AGENTS files and updated `src/app/sessions/AGENTS.md` for read-path ownership and adapter-call restrictions.

Next three steps reassessment:
- Step 7 is ready. It should wire `SessionManager.read()` before planner provider selection and convert `HIT` results into provider constraints without changing planner capability validation.
- Step 8 is ready after Step 7. It should write records using the same key derivation inputs that Step 7 reads, including provider instance id where provider-scoped keys are in use.
- Step 9 remains ready. It should verify that identity requirements survive session-derived provider pinning and still reach `ProxyAcquireInput.requirements.identity`.

## 7. Session-Aware Planning - Completed

Purpose:
- Make sticky sessions influence provider selection and attempt planning.

Red:
- Add planner/use-case tests proving an existing sticky session pins the first attempt to the stored provider instance.
- Add tests proving explicit route/provider constraints can reject an incompatible sticky provider.
- Add tests proving fallback attempts remain available when policy allows them.
- Add tests proving `requestNewIdentity` bypasses the stored provider.

Green:
- Wire session resolution into planning input before `ExecutionPlanner` selects providers.
- Use `SessionManager.read()` for the read path and translate `HIT` into a provider-instance constraint.
- Preserve provider capability checks for pinned providers.
- Keep route/pipeline requirements structured.

Verify:
- Session-aware planning tests pass.
- Existing route/planner retry/fallback tests still pass.

Progress:
- Added gateway integration tests for session-derived first-attempt pinning, incompatible explicit provider rejection, fallback preservation, and `requestNewIdentity` bypass.
- Wired `SessionManager.read()` into configured `ProxyGatewayOptions.plan` flow before `ExecutionPlanner`.
- Translated session `HIT` results into first-attempt provider constraints while preserving fallback attempts and planner capability checks.
- Checked nested AGENTS files and updated `src/app/use-cases/AGENTS.md` for session read-path planning ownership.

Next three steps reassessment:
- Step 8 is ready. It must write session records after successful attempts using the same key inputs used by Step 7; if provider-scoped keys are present, write with the successful provider instance id.
- Step 9 remains ready. It should explicitly cover that Step 7 pinning does not remove `requirements.identity` before provider `acquire()`.
- Step 10 is still mostly public contract work, but it should account for the fact that direct `options.plan` now has session read-path behavior while declarative routes are not wired yet.

## 8. Session Write Path After Successful Attempt - Completed

Purpose:
- Persist sticky-session provider choice after successful execution.

Red:
- Add gateway integration tests proving successful attempts write a session record with provider instance id and expiration.
- Add tests proving failed attempts do not overwrite an existing successful sticky session unless policy explicitly says so.
- Add tests proving fallback success updates the sticky provider to the fallback provider.
- Add tests proving `stickySessionTtlMs` controls record expiration.
- Add tests proving session write failures are best-effort and do not mask a successful target response.

Green:
- Add session write coordination after `AttemptExecutor` completes successfully.
- Treat session writes as best-effort for v0.2: write failures should become safe gateway events/diagnostics later, but must not replace the target response.
- Ensure `AttemptExecutor` or the use-case exposes the successful provider instance id needed to write the session record without parsing provider-specific lease metadata.
- Keep target response building independent of session-store serialization.

Verify:
- Gateway session write tests pass.
- Attempt executor tests still pass.

Progress:
- Added gateway session write tests for successful write, failed-attempt non-overwrite, fallback success updating the sticky provider, `stickySessionTtlMs` expiration, and best-effort write failures.
- Added best-effort session write coordination after completed `SUCCESS` attempts in the configured `options.plan` flow.
- Writes use `SessionKeyFactory` with the successful provider instance id, write required `expiresAt`, and delete stale candidate keys before storing the winning provider record.
- Checked nested AGENTS files and updated `src/app/use-cases/AGENTS.md` for session write ownership and best-effort behavior.

Next three steps reassessment:
- Step 9 is ready and should now explicitly verify both read-path pinning and write-path fallback success preserve `requirements.identity` into provider acquire.
- Step 10 remains route contract hardening. It should avoid touching direct-plan session behavior unless route-level requirements need the same identity shape.
- Step 11 remains route selection wiring. It should reuse the existing direct-plan planning/session helpers so route-selected plans get the same read/write behavior.

## 9. Provider Acquire Identity Handoff - Completed

Purpose:
- Ensure provider adapters receive identity/sticky/isolation requirements needed to implement provider-specific sessions.

Red:
- Add tests proving `ProxyAcquireInput.requirements.identity` reaches provider `acquire()`.
- Cover sticky, fixed, per-request, isolation key, isolation scope, and request-new-identity fields.
- Add tests proving session-derived provider pinning does not erase identity requirements.
- Add tests proving fallback attempts keep their own identity requirements after a session-pinned first attempt.

Green:
- Preserve `requirements.identity` through route selection, pipeline merging, planning, and attempt execution.
- Avoid provider-specific interpretation inside core.

Verify:
- Provider acquire handoff tests pass.
- Session read/write tests still pass.

Progress:
- Added provider acquire handoff coverage proving sticky, fixed, per-request, isolation key, isolation scope, and request-new-identity fields reach `ProxyAcquireInput.requirements.identity`.
- Covered session-derived provider pinning plus fallback attempts, proving pinning does not erase first-attempt identity and fallback attempts keep their own identity requirements.
- No production code changes were needed because Steps 7-8 already preserved structured requirements through planning and execution.
- Checked nested AGENTS files; no updates were needed for this test-only step.

Next three steps reassessment:
- Step 10 is ready. It should harden route/default-route contracts and decide whether route-level `requirements` remain part of v0.2.
- Step 11 depends on Step 10's route contract shape and should reuse the existing direct-plan session read/write helpers.
- Step 12 should be deleted or sharply narrowed if Step 10 decides not to add route-level requirements.

## 10. Route Config Public API Hardening - Completed

Purpose:
- Finish and harden the public route/default-route config contracts already introduced in Step 1, without runtime wiring yet.

Red:
- Add type tests for the existing `routes?: ProxyRouteConfig[]` and `defaultRoute?: ProxyDefaultRouteConfig` options so Step 1 coverage is not only baseline.
- Add tests that route configs use existing matcher contracts from `src/domain/routing`.
- Add tests that plan configs attached to routes reuse `ProxyPlanConfig`.
- Add tests for route/default-route `requirements?: ProxyRouteRequirements` if route-level defaults are still intended for Step 12.

Green:
- Keep existing route/default-route options on `ProxyGatewayOptions`; refine them only where tests expose gaps.
- Add route/default-route requirements fields only if Step 12 still needs route-level requirement merging.
- Keep package-root route config exports aligned with the finalized contracts.

Verify:
- Public type tests pass.
- Existing routing tests pass.

Progress:
- Added public type coverage proving `ProxyGatewayOptions.routes` and `defaultRoute` accept route/default configs bound to `ProxyPlanConfig` and `ProxyRouteRequirements`.
- Added contract coverage that route matches use the existing `ProxyRouteMatch`/matcher enum shapes from domain routing.
- Added `requirements?: TRequirements` to route/default-route config contracts as an opaque generic preserved by domain route selection.
- Bound `ProxyGatewayOptions` route/default-route requirements to the outbound `ProxyRouteRequirements` public contract without making `src/domain/routing` depend on outbound ports.
- Checked nested AGENTS files and updated `src/domain/AGENTS.md` for the durable opaque-requirements routing rule.

Next three steps reassessment:
- Step 11 is ready. Route selection wiring should use the selected route/default plan and preserve selected route/default requirements for Step 12, but it should not duplicate requirements merge logic.
- Step 12 is confirmed and should implement the merge of route/default requirements with per-attempt requirements. The merge rule must be explicit, especially for array fields such as provider include/exclude ids, protocols, and network types.
- Step 13 remains ready after route wiring and requirements merge. Its tests should verify `providerSelection` is no longer the normal documented path once route/default route config can select providers through plan/requirements.

## 11. Route Selection Wiring - Completed

Purpose:
- Use declarative `routes` in the actual gateway request flow.

Red:
- Add gateway integration tests:
  - matching route by host/path/method;
  - priority ordering;
  - `exclude` after match;
  - default route fallback;
  - `NO_ROUTE_MATCHED` when no route/default exists.
- Add tests proving route matching sees the normalized target request.
- Add tests proving target access still runs before route selection side effects.

Green:
- Wire `selectRoute()` into `HandleProxyFetchRequestUseCase`.
- Convert selected route/default route plan into planner input.
- Preserve selected route/default requirements for the Step 12 merge path.
- Reuse the existing direct `options.plan` planning/session path where possible instead of creating a second planner flow.

Verify:
- Route wiring integration tests pass.
- Existing direct `options.plan` tests still pass.

Progress:
- Added gateway integration tests for route matching by host/path/method, priority ordering, exclude handling, default route fallback, `NO_ROUTE_MATCHED`, normalized target matching, and target-access-before-planning behavior.
- Wired `selectRoute()` into `HandleProxyFetchRequestUseCase` when `routes` or `defaultRoute` are configured.
- Routed selected route/default `plan` through the same configured-plan path used by direct `options.plan`, including session pinning and `ExecutionPlanner` validation.
- Kept the temporary `providerSelection.providerInstanceId` path as no-plan fallback only.
- Checked nested AGENTS files and updated `src/app/use-cases/AGENTS.md` for route/default route planning ownership.

Next three steps reassessment:
- Step 12 is ready and now has a real route-selected planning path to extend. It should merge selected route/default `requirements` into each selected-plan attempt before session pinning and planner validation.
- Step 13 remains ready. Route/default configs now replace the normal `providerSelection` path for configured gateways, so Step 13 should decide whether to remove `providerSelection` or explicitly confine it to no-plan compatibility.
- Step 14 remains ready after Step 13. Pipeline wiring should account for the route-selected configured-plan path rather than adding a third independent planning path.

## 12. Route Requirements Merge - Completed

Purpose:
- Combine route-level requirements and attempt-level requirements predictably.

Precondition:
- Step 10 added `requirements?: ProxyRouteRequirements` to route/default-route configs through the app-level public options binding.

Red:
- Add tests for merging:
  - provider include/exclude ids;
  - protocols;
  - DNS requirements;
  - geo requirements;
  - verification requirements;
  - identity requirements.
- Add tests proving attempt-level fields override route defaults where intended.
- Add tests proving arrays are replaced or merged according to an explicit rule.

Green:
- Implement a narrow requirements merge collaborator in app/planning or domain if pure.
- Document the merge rule in tests and README.
- Merge selected route/default requirements into each selected-plan attempt before planner capability validation.

Verify:
- Requirements merge tests pass.
- Planner capability tests still pass.

Progress:
- Added focused merge tests for provider include/exclude ids, protocols, network types, DNS, geo, verification, identity, custom fields, array replacement, and no-mutation behavior.
- Added gateway route/default-route integration tests proving selected route/default requirements are merged into implicit plan attempts before planning.
- Added `mergeProxyRouteRequirements()` and `mergeRouteRequirementsIntoPlan()` in `src/app/planning`.
- Wired route/default requirements merge before session pinning and `ExecutionPlanner` validation, so route-level identity defaults can participate in sticky-session behavior.
- Documented the merge rule in README: nested `dns`, `geo`, `verification`, and `identity` merge by field; attempt-level arrays replace route/default arrays.
- Checked nested AGENTS files and updated `src/app/planning/AGENTS.md` plus `src/app/use-cases/AGENTS.md` for the durable merge ownership and ordering rules.

Next three steps reassessment:
- Step 13 is ready. Since route/default configs now cover provider selection through plan and requirements, `providerSelection` should either be removed from public options or explicitly constrained to the no-plan/no-routes/no-default/no-pipeline compatibility path.
- Step 14 is ready after Step 13. Pipeline wiring should reuse the configured-plan helper and the requirements merge helper where pipeline output creates or modifies requirements.
- Step 15 remains useful. Built-in `requirements.merge` should reuse or match the Step 12 merge semantics instead of defining a second array/object merge rule.

## 13. Remove Or Narrow Provider Selection Bridge - Completed

Purpose:
- Stop relying on `providerSelection.providerInstanceId` as the normal user path.

Red:
- Add tests proving route/default-route config can replace the existing direct provider-selection hook.
- Add tests proving `providerSelection` is either removed from public exports or only works when no `plan`, `routes`, `defaultRoute`, or `pipelines` are configured.
- Add README/API tests reflecting the chosen public contract.

Green:
- Remove `providerSelection` from public options if feasible.
- If retained, mark it as a legacy/no-plan bridge in tests and AGENTS.
- Ensure all documented examples use routes/defaultRoute/pipelines instead.

Verify:
- Public API tests pass.
- Local registry consumer does not rely on `providerSelection` after this step if route/default-route config can replace it.

Progress:
- Removed `ProxyGatewayOptions.providerSelection` and the root `ProviderSelectionConfig` type export.
- Removed runtime support for selecting a specific provider through the old provider-selection bridge.
- Kept no-plan fallback limited to automatic first-enabled-provider selection when no `plan`, `routes`, `defaultRoute`, or non-empty `pipelines` are configured.
- Added contract tests proving `providerSelection` is no longer accepted by `ProxyGatewayOptions` and is not documented in README.
- Added gateway tests proving explicit provider choice now goes through configured `plan`, `routes`, or `defaultRoute`.
- Updated local registry consumer smoke files to use configured plans instead of `providerSelection`.
- Checked nested AGENTS files and updated `src/app/AGENTS.md` plus `src/app/use-cases/AGENTS.md` for the durable removal rule.

Next three steps reassessment:
- Step 14 is ready. Since non-empty `pipelines` now block no-plan fallback, pipeline wiring must produce an executable configured plan or a stable service error instead of falling through to direct provider selection.
- Step 15 remains ready. Built-in requirement steps should reuse the Step 12 merge semantics where applicable.
- Step 16 remains ready after Step 15. Provider selection/ranking built-ins must select provider instance ids for planner attempts, not resurrect a separate gateway-level provider-selection option.

## 14. Pipeline Options Wiring - Completed

Purpose:
- Make configured pipelines participate in gateway planning.

Red:
- Add tests proving `ProxyGatewayOptions.pipelines` and `stepRegistry` are accepted and used.
- Add tests proving `when` filters pipelines before phase execution.
- Add tests proving `match` phase runs only after `when` matches.
- Add tests for multiple pipelines with priority/order behavior.

Green:
- Wire `ProxyPipelineEngine` into the gateway use-case after target access and before planning.
- Build initial `ProxyDecisionState` from target, context, facts, requirements, candidates, and metadata.
- Keep built-in and custom steps behind `ProxyPipelineStepRegistryPort`.

Verify:
- Pipeline wiring tests pass.
- Existing pipeline engine unit tests still pass.

Progress:
- Added gateway integration tests proving configured `pipelines` and `stepRegistry` are used to select an executable plan.
- Covered `when` prefilter behavior, `match` phase ordering after matching `when`, and stable pipeline priority/declaration-order selection.
- Wired non-empty `ProxyGatewayOptions.pipelines` into `HandleProxyFetchRequestUseCase` after target access and before route/default/direct planning.
- Built initial `ProxyDecisionState` from target, context, empty facts/requirements/metadata, and enabled provider candidates.
- Kept pipeline steps behind `ProxyPipelineStepRegistryPort`; missing step types now return `PIPELINE_STEP_NOT_FOUND` instead of falling through to no-plan provider fallback.
- Checked nested AGENTS files and added `src/app/pipeline/AGENTS.md` plus updated `src/app/use-cases/AGENTS.md` for pipeline flow ownership.

Next three steps reassessment:
- Step 15 is ready. Built-in requirement steps can now be exercised through both the unit step tests and the Step 14 gateway pipeline wiring.
- Step 16 remains ready after Step 15. Provider selection/ranking steps should update pipeline state candidates/requirements and feed plan steps; they must not reintroduce a top-level provider-selection option.
- Step 17 remains ready. `plan.fallback` should produce executable plans through `ExecutionPlanner` so pipeline-selected plans get provider capability validation.

## 15. Built-In Requirements Pipeline Steps - Completed

Purpose:
- Provide useful declarative steps without requiring users to implement common boilerplate.

Red:
- Add tests for built-in steps:
  - `requirements.set`;
  - `requirements.merge`;
  - `requirements.identity`;
  - `requirements.geo`;
  - `requirements.verification`.
- Add tests for invalid args returning stable errors.
- Add tests that built-in step names are constants/enums, not scattered strings.

Green:
- Add built-in pipeline step implementations under `src/app/pipeline`.
- Register built-ins by default unless a user registry intentionally overrides according to a documented rule.
- Keep arbitrary JS execution out of declarative config.

Verify:
- Built-in requirement step tests pass.
- Pipeline wiring tests still pass.

Progress:
- Added package enum `PIPELINE_STEP_TYPE` for built-in requirement step names and `PIPELINE_STEP_INVALID_ARGS` for stable invalid-args rejection.
- Added built-in requirement steps: `requirements.set`, `requirements.merge`, `requirements.identity`, `requirements.geo`, and `requirements.verification`.
- Reused Step 12 requirement merge semantics for `requirements.merge` and group-specific requirement steps.
- Added validation for built-in args with stable `PIPELINE_STEP_INVALID_ARGS` reject decisions.
- Composed built-ins into gateway pipeline execution by default while allowing user `stepRegistry` entries to intentionally override built-ins by type.
- Added unit and gateway tests proving built-ins, invalid args, default registration, and override behavior.
- Checked nested AGENTS files and updated `src/app/pipeline/AGENTS.md` for built-in step ownership and override rules.

Next three steps reassessment:
- Step 16 is ready. Provider selection/ranking built-ins should follow the same built-in registry composition and enum naming pattern introduced here.
- Step 17 remains ready. `plan.fallback` should be a built-in step enum value and should use `ExecutionPlanner` rather than hand-building executable attempts.
- Step 18 remains ready after Step 16-17. It should define final precedence now that route/default config, pipeline wiring, and built-in requirement steps all exist.

## 16. Built-In Provider Selection And Ranking Steps - Completed

Purpose:
- Let pipelines declaratively include, exclude, and rank providers.

Red:
- Add tests for built-in steps:
  - provider include ids;
  - provider exclude ids;
  - tag filtering;
  - priority ranking;
  - weighted ordering where deterministic random is injected.
- Add tests that disabled providers are never selected by built-ins.

Green:
- Implement provider selection/ranking steps in app/pipeline.
- Use provider instance id as routing identity.
- Do not inspect provider-specific config.

Verify:
- Provider built-in step tests pass.
- Multiple-provider tests still pass.

Progress:
- Added package enum values for provider built-ins: `providers.include`, `providers.exclude`, `providers.tags`, `providers.priority`, and `providers.weighted`.
- Added built-in provider steps that filter or rank `ProxyDecisionState.candidates` by provider instance id, tags, priority, and weighted deterministic ordering.
- Extended provider candidates with public `tags` copied from enabled provider instances; disabled providers are omitted from initial pipeline candidates.
- Extended `RandomPort` with optional `nextFloat()` and passed configured `random` into pipeline services so weighted ranking can be deterministic in tests and user code.
- Added unit and gateway tests for include/exclude/tag filtering, priority ranking, weighted ordering, invalid args, and disabled provider exclusion.
- Checked nested AGENTS files and updated `src/app/pipeline/AGENTS.md` for provider built-in ownership and adapter-call restrictions.

Next three steps reassessment:
- Step 17 is ready, but should now consume the candidate list produced by Step 16. `plan.fallback` should default to current `state.candidates` when attempts do not specify providers, and should use `ExecutionPlanner` for provider validation/capability checks rather than trusting candidate order alone.
- Step 18 is still needed. It should explicitly decide whether skipped pipelines fall through to route/default planning or whether any configured pipeline set is authoritative; current Step 14 behavior returns no-plan after all configured pipelines skip or complete without a plan.
- Step 19 remains useful after Step 17 because route-level verification already merges into plans, but pipeline-produced verification needs a built-in plan path that can carry requirements into executable attempts.

## 17. Built-In Plan Steps - Completed

Purpose:
- Let pipelines produce executable plan configs.

Red:
- Add tests for `plan.fallback`.
- Add tests for per-attempt provider id, max attempts, timeout, retryOn, requirements, and verification.
- Add tests for malformed attempts and unknown provider references producing stable errors.

Green:
- Implement `plan.fallback` built-in step.
- Use current pipeline candidates as the default provider order when attempt args do not specify provider ids.
- Reuse `ExecutionPlanner` for provider capability validation.
- Keep retry/fallback behavior in `AttemptExecutor` and `RetryDecider`.

Verify:
- Built-in plan tests pass.
- Retry/fallback gateway tests still pass.

Progress:
- Added package enum value `PIPELINE_STEP_TYPE.PLAN_FALLBACK = 'plan.fallback'`.
- Added built-in `plan.fallback` pipeline step that parses fallback plan args, merges current `state.requirements`, constrains implicit attempts to current candidates, and delegates executable planning to an injected planner service backed by `ExecutionPlanner`.
- The gateway pipeline service now orders providers by current pipeline candidates before calling `ExecutionPlanner`, so provider ranking/filtering built-ins influence implicit planning without exposing provider-specific config.
- Added validation for malformed plan args with `PIPELINE_STEP_INVALID_ARGS` and stable planner rejection propagation for unknown provider references.
- Added unit and gateway tests for default candidate-based planning, explicit provider/maxAttempts/timeout/retryOn/requirements/verification args, malformed attempts, unknown providers, and ranked gateway execution.
- Updated the old provider-selection removal test to use a genuinely unregistered plan step now that `plan.fallback` is built in.
- Checked nested AGENTS files and updated `src/app/pipeline/AGENTS.md` plus `src/app/use-cases/AGENTS.md` for planner-service ownership and restrictions.

Next three steps reassessment:
- Step 18 is ready and more important now: pipelines can produce executable plans, so precedence must decide whether skipped/no-plan pipelines fall through to route/default planning or remain authoritative. It should also decide how route/default requirements interact with pipeline plans, since current flow runs pipelines before route selection.
- Step 19 is ready but can be narrowed: `plan.fallback` already accepts per-attempt `verification` args and passes them through requirements. Step 19 should focus on end-to-end verifier invocation, mismatch retry/fallback, and no-verifier rejection through route and pipeline paths.
- Step 20 remains needed. Direct and route/default plans have session read/write helpers, but pipeline-selected executable plans currently do not apply session read-path pinning before planner execution; Step 20 should either add that or document a deliberate difference.

## 18. Pipeline And Route Precedence - Completed

Purpose:
- Define how routes, default routes, and pipelines interact.

Red:
- Add integration tests for:
  - direct `options.plan` with session read/write;
  - route plan only;
  - pipeline plan only;
  - route requirements plus pipeline plan;
  - pipeline rejection before route planning;
  - configured-pipeline skip behavior, either falling through to default route or producing a stable no-plan error according to the finalized precedence rule;
  - no plan after pipelines and no default route.
- Add tests for stable service errors when precedence produces no executable plan.

Green:
- Implement a single decision flow in the use-case.
- Avoid duplicate planning logic between route and pipeline paths.
- Decide whether configured pipelines are authoritative even when skipped, or whether skipped pipelines fall through to route/default planning.
- Define whether direct `options.plan` bypasses route/pipeline config or is rejected when declarative config is present, then align Step 13 docs/tests with that choice.

Verify:
- Route/pipeline precedence tests pass.
- Existing route selection and pipeline engine tests still pass.

Progress:
- Chose and implemented precedence: route/default selection runs first to provide base requirements, pipeline plans have priority when selected, skipped/no-plan pipelines fall through to route/default or direct `options.plan`, and configured pipelines never fall through to the no-plan provider fallback.
- Added route/pipeline precedence integration tests for route requirements constraining a pipeline-selected plan, pipeline rejection before route/default planning, default-route fallthrough after skipped pipelines, direct-plan fallthrough after skipped pipelines, and stable no-plan errors after skipped pipelines without route/default/direct plan.
- Refactored `HandleProxyFetchRequestUseCase` into a single decision flow that selects route/default context once, passes route/default requirements into the initial pipeline state, and reuses the configured-plan path for fallthrough route/default/direct plans.
- Checked nested AGENTS files and updated `src/app/use-cases/AGENTS.md` for the durable route/pipeline precedence rule.

Next three steps reassessment:
- Step 19 is ready. It should verify that route/default verification requirements and pipeline `plan.fallback` verification args both reach `ExecutionPlanner` and `AttemptExecutor`, including mismatch retry/fallback and no-verifier rejection.
- Step 20 remains needed. The final precedence flow now gives route/default requirements to pipelines, but pipeline-selected executable plans still do not get sticky-session read-path pinning before planner execution; Step 20 should unify session behavior for route and pipeline declarative paths.
- Step 21 remains ready. Its target-access tests should include the new precedence behavior: target access must still run before route selection, pipeline execution, session reads/writes, planner capability lookup, provider acquire, verifier, and transport.

## 19. Verification Flags Through Declarative Config - Completed

Purpose:
- Ensure route and pipeline config can require exit verification.

Red:
- Add gateway tests proving route-level verification triggers `ProxyExitVerifierPort`.
- Add gateway tests proving pipeline-produced verification triggers verifier.
- Add mismatch retry/fallback tests through declarative routes/pipelines.
- Add tests proving no verifier produces stable rejection when strict verification requires one.

Green:
- Preserve verification requirements through merge, built-in `plan.fallback`, planner, and executor.

Verify:
- Verification declarative integration tests pass.
- Existing attempt executor verification tests still pass.

Progress:
- Added declarative verification gateway tests for route-level geo verification requirements invoking `ProxyExitVerifierPort`.
- Added pipeline `plan.fallback` verification tests proving per-attempt `verification` args and geo requirements trigger verifier execution.
- Added declarative pipeline fallback coverage for geo mismatch retry/fallback, proving failed verification prevents transport execution for the mismatched provider and falls back when `retryOn` allows it.
- Added no-verifier rejection coverage for route-level verified-after-acquire geo, proving planner rejects before provider acquire/transport.
- No production code changes were needed because route/default requirement merge, built-in `plan.fallback`, `ExecutionPlanner`, and `AttemptExecutor` already preserved and executed verification requirements.
- Checked nested AGENTS files; no updates were needed for this test-only step.

Next three steps reassessment:
- Step 20 is ready. It should unify sticky-session read-path behavior for pipeline-selected executable plans with the existing route/default/direct configured-plan path, while preserving the write path already shared after successful attempts.
- Step 21 remains ready. Its regression tests should include the route/default + pipeline precedence path from Step 18 and the declarative verification path from Step 19.
- Step 22 remains ready after Steps 20-21 and should include smoke coverage for route/default config, pipeline built-ins including `plan.fallback`, verification flags where practical, sticky sessions, and memory session store imports.

## 20. Sticky Sessions Through Declarative Routes - Completed

Purpose:
- Prove full sticky/session behavior through the public v0.2 configuration path.

Red:
- Add gateway integration tests:
  - first request through route/pipeline config selects provider and writes sticky session;
  - second request through route/pipeline config with same flow/identity reuses provider;
  - different flow/tenant gets a different session;
  - TTL expiration selects a new provider;
  - requestNewIdentity replaces session;
  - fallback success updates session.

Green:
- Wire session manager into the final route/pipeline planning flow, including pipeline-selected executable plans.
- Reuse the direct-plan session read/write helpers from Steps 7-8; do not duplicate session logic for declarative routes/pipelines.
- Keep provider adapters generic and only pass identity requirements.

Verify:
- Sticky session gateway tests pass.
- Memory store tests still pass.

Progress:
- Added declarative sticky-session gateway tests covering route-config session reuse and pipeline-config write/reuse behavior.
- Added pipeline coverage for different flow isolation, expired-session cleanup, `requestNewIdentity` replacement, and fallback success updating the sticky provider.
- Refactored session pinning in `HandleProxyFetchRequestUseCase` so built-in pipeline planning applies the same `SessionManager.read()` path before calling `ExecutionPlanner`.
- Kept the post-success session write path shared for direct, route/default, and pipeline-selected attempts.
- Checked nested AGENTS files and updated `src/app/use-cases/AGENTS.md` for the durable pipeline planner session-pin rule.

Next three steps reassessment:
- Step 21 is ready. It should verify target access still short-circuits before route selection, pipeline execution, session reads/writes, planner capability lookup, provider acquire, verifier, and transport across the final declarative flow.
- Step 22 is ready after Step 21. Consumer smoke should include route/default config, pipeline built-ins (`requirements.*`, provider selection/ranking, `plan.fallback`), sticky session reuse with `createMemoryProxySessionStore()`, and public type imports.
- Step 23 remains ready after e2e coverage; README examples should reflect the final precedence and sticky-session behavior rather than the earlier pipeline-authoritative draft.

## 21. Target Access And Redaction Regression For Declarative Flow - Completed

Purpose:
- Ensure the new route/pipeline/session flow does not weaken v0.1 security behavior.

Red:
- Add integration tests proving denied initial targets still return before:
  - session-store reads/writes;
  - route planning side effects;
  - pipeline side effects;
  - provider capability lookup;
  - provider acquire;
  - verifier;
  - transport execution.
- Add tests proving service error diagnostics from declarative flow remain redacted.

Green:
- Keep target access guard before route/pipeline planning.
- Reuse `ResultClassifier` diagnostics for service errors.

Verify:
- Security regression tests pass.
- Existing target access and redaction tests still pass.

Progress:
- Added declarative security regression tests proving denied targets return before session-store reads/writes, pipeline step execution, provider capability lookup, provider acquire, verifier, and transport execution.
- Added declarative route+pipeline service-error diagnostics coverage proving target headers/URL secrets and route credentials remain redacted after target transport failure.
- No production code changes were needed because target access already runs before declarative planning and service-error details already flow through `ResultClassifier` diagnostics.
- Checked nested AGENTS files; no updates were needed for this test-only step.

Next three steps reassessment:
- Step 22 is ready. It should now exercise the final public v0.2 behavior through the installed package: route/default config, route fallback, pipeline built-ins including requirements/provider ranking/`plan.fallback`, sticky session reuse with `createMemoryProxySessionStore()`, and public type imports.
- Step 23 is ready after Step 22. README examples should document the final precedence rule: route/default requirements feed pipelines, selected pipeline plans win, skipped/no-plan pipelines fall through to route/default/direct plan, and no-plan fallback is disabled when pipelines are configured.
- Step 24 remains useful after README/e2e because it should audit nested AGENTS for any remaining gaps from route/pipeline/e2e work rather than revisiting session rules already captured.

## 22. Local Registry Consumer E2E For v0.2 Config - Completed

Purpose:
- Prove the published package works for v0.2 user-facing config after installation from a registry.

Red:
- Extend `e2e/local-registry/consumer` smoke tests for:
  - route/default-route config;
  - route fallback;
  - pipeline built-in requirements;
  - sticky session reuse;
  - `createMemoryProxySessionStore()` usage;
  - TypeScript type imports for new public contracts.

Green:
- Update consumer smoke scripts.
- Keep `npm install --package-lock=false`.

Verify:
- Local registry publish/install e2e passes:
  - `./e2e/local-registry/scripts/reset-registry.sh`
  - `docker compose -f e2e/local-registry/docker-compose.yml up -d verdaccio`
  - `./e2e/local-registry/scripts/publish-local.sh .`
  - `docker compose -f e2e/local-registry/docker-compose.yml run --rm consumer`

Progress:
- Added installed-consumer v0.2 smoke coverage for route/default-route config, default route fallback, pipeline built-ins (`requirements.geo`, `providers.tags`, `providers.priority`, `plan.fallback`), sticky session reuse, and `createMemoryProxySessionStore()` usage.
- Extended consumer type smoke to import and compile public v0.2 contracts/enums for route/default-route config, pipeline config, plan config, provider capabilities/candidates/instances, identity requirements, route requirements, and session-store usage.
- Extended consumer export smoke for v0.2 runtime exports and updated local registry e2e docs/contracts for the new smoke coverage.
- Kept the consumer install command on `npm install --package-lock=false`.
- Checked nested AGENTS files and updated `e2e/local-registry/AGENTS.md` for the durable v0.2 local-registry smoke coverage rule.

Verify:
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run pack:check`
- `./e2e/local-registry/scripts/reset-registry.sh`
- `docker compose -f e2e/local-registry/docker-compose.yml up -d verdaccio`
- `./e2e/local-registry/scripts/publish-local.sh .`
- `docker compose -f e2e/local-registry/docker-compose.yml run --rm consumer`

Next three steps reassessment:
- Step 23 is ready. README alignment should document the final user-facing behavior already proven by the installed consumer: route/default fallback, pipeline built-ins, sticky session reuse, memory session store, local Node HTTP integration, and out-of-scope framework/provider adapters. It should also mention the final precedence rule from Step 18.
- Step 24 is still useful but can be narrow. Session and local-registry rules were already updated during earlier steps; audit remaining AGENTS gaps around README-facing route/pipeline precedence, built-in steps, and release-gate expectations rather than duplicating existing session-store rules.
- Step 25 remains ready. It should treat the consumer e2e from Step 22 as an established release-gate command and focus on final export/package checks plus removal or documentation of any leftover temporary APIs.

## 23. README And Public API Alignment

Purpose:
- Make README describe the actual v0.2 public behavior.

Red:
- Add README/API alignment tests for:
  - route config example;
  - pipeline built-ins;
  - sticky session config;
  - memory session store;
  - local Node HTTP integration;
  - out-of-scope adapter packages.

Green:
- Update README user-facing docs.
- Do not copy AGENTS-level internal architecture into README unless package users need it.

Verify:
- README/API tests pass.
- `npm run typecheck`

## 24. Nested AGENTS.md Updates

Purpose:
- Preserve durable v0.2 architecture decisions before deleting this phase file.

Red:
- Inspect decisions from completed v0.2 steps and compare them with nested `AGENTS.md`.
- Add missing rules for sessions, route/pipeline flow, built-in steps, and local registry e2e.
- Treat session rules from Steps 1-8 as already mostly captured; focus this step on gaps from route/pipeline/built-in/e2e work.

Green:
- Update only relevant nested `AGENTS.md` files.
- Keep root `AGENTS.md` compact.

Verify:
- Manual diff review.

## 25. v0.2 Release Gate

Purpose:
- Final package check for the phase.

Red:
- Add any missing package/public export tests discovered during README alignment.
- Add package contract checks for new public exports.

Green:
- Finalize exports.
- Remove obsolete temporary APIs or document intentionally retained bridge APIs.
- Ensure package contents include only intended files.

Verify:
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run pack:check`
- `npm run prepublishOnly`
- Local registry publish/install e2e passes.

## Remaining PR Order

1. README and public API alignment.
2. Nested AGENTS.md audit for remaining route/pipeline/e2e/release rules.
3. v0.2 release gate.
