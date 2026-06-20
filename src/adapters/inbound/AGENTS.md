# AGENTS.md - Inbound Adapters

Inbound adapters are thin wrappers around `ProxyGateway.handle(request: Request): Promise<Response>`.

They translate external HTTP/framework shapes into Web Fetch API `Request` objects and translate the returned Web `Response` back to the framework/server shape.

Do not duplicate gateway logic across Node HTTP, Express, Fastify, NestJS, or Web Fetch handlers.

Runtime core must not depend on Express, Fastify, NestJS, or other web framework packages. Framework integrations in this package must be dependency-free structural wrappers or live in separate packages/dev-only tests.

Adapter contract tests must prove:

```txt
- raw JSON bodies are preserved;
- multipart bytes and boundary are preserved;
- response status, headers, and body are preserved;
- binary bodies are not corrupted;
- wrappers do not pre-read or JSON-parse the body before passing it to ProxyGateway.handle().
```

Framework/body-parser behavior must never corrupt proxy-fetch multipart service requests.
