# AGENTS.md - Inbound Adapters

Inbound adapters are thin wrappers around `ProxyGateway.handle(request: Request): Promise<Response>`.

They translate external HTTP/framework shapes into Web Fetch API `Request` objects and translate the returned Web `Response` back to the framework/server shape.

`createNodeHttpHandler(gateway)` is the built-in Node HTTP adapter. It may use only Node built-in modules and Web Fetch runtime objects. It must preserve raw request body bytes, request headers, response status, response headers, and response body bytes while delegating all gateway behavior to `ProxyGateway.handle()`.

Do not duplicate gateway logic across Node HTTP, Express, Fastify, NestJS, or Web Fetch handlers.

Runtime core must not depend on Express, Fastify, NestJS, or other web framework packages. For v0.1, Express, Fastify, and NestJS wrappers are deferred from the core API and must not be exported by this package. Framework integrations should live in separate packages or future phases unless the active task explicitly changes this public contract.

Adapter contract tests must prove:

```txt
- raw JSON bodies are preserved;
- multipart bytes and boundary are preserved;
- response status, headers, and body are preserved;
- binary bodies are not corrupted;
- wrappers do not pre-read or JSON-parse the body before passing it to ProxyGateway.handle().
```

Framework/body-parser behavior must never corrupt proxy-fetch multipart service requests.
