# AGENTS.md - Domain Layer

The domain layer holds provider-agnostic models, value objects, matching primitives, route models, and pure rules. It must not depend on app use-cases, ports, adapters, framework packages, provider packages, config loading, DNS/GeoIP libraries, or network calls.

Do not create a generic `src/utils` bucket for domain behavior. If a helper represents a gateway concept or rule, place it in the narrow domain module that owns that concept.

## Matching

Dependency-free matchers support:

```txt
- exact
- prefix
- suffix
- glob
- regexp
- predicate in programmatic APIs
```

Use real `RegExp` only in programmatic APIs. JSON-friendly config uses `{ type: "regexp", source, flags }`.

Normalize URL/host before matching. Detect `.onion` hosts in normalized metadata.

Glob support is intentionally focused on route-matching needs: literal segments, `*`, `?`, full-segment `**`, character classes/ranges, negated classes, escaping, and explicit case-insensitive matching. Brace expansion and extglob stay unsupported/literal unless deliberately added with tests.

## Routing

Route selection is a pure domain rule:

```txt
- higher priority wins;
- equal priority preserves declaration order;
- exclude is evaluated after positive match;
- default route is used only when no configured route matches;
- no route and no default route returns NO_ROUTE_MATCHED.
```

Route selection should not perform provider acquire, transport execution, DNS, GeoIP, target probing, or policy pipeline execution.

Route/default-route configs may carry opaque generic requirements so the app layer can bind them to `ProxyRouteRequirements`. Domain routing must preserve those values but not import outbound ports or interpret provider, protocol, geo, DNS, verification, or identity requirements.
