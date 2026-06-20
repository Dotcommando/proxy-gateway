# AGENTS.md - Proxy-Fetch Envelopes

This folder owns the `proxy-fetch.v1` wire parser/builder. It must stay compatible with `@echospecter/proxy-fetch`.

## Constants

Wire compatibility constants copied from `@echospecter/proxy-fetch/src/constants.ts` must keep the same names and values unless the client package contract changes. `WIRE_PROTOCOL_VERSION` must keep the same name and value.

Do not copy env/config-loading constants such as `PROXY_FETCH_SERVICE_URL_ENV` or `PROXY_FETCH_DEFAULT_TIMEOUT_MS_ENV` into the gateway runtime.

## Request Formats

Supported service request formats:

```txt
- JSON envelope with request.body: null;
- JSON envelope with request.body.kind: "text";
- JSON envelope with request.body.kind: "base64" and request.body.data;
- multipart/form-data with part "meta" and raw binary part "body";
- multipart meta request.body.kind: "binary" and request.body.partName: "body";
- streaming multipart bodies with proxy-fetch-stream-* boundary, meta part first, body part second.
```

Text-like fallback bodies are detected by target content type:

```txt
- text/*
- application/json
- application/x-www-form-urlencoded
- application/xml
- application/graphql
```

Preserve service `context` fields including `useCase`, `flowKey`, `consistency`, and `metadata`.

Preserve serialized Fetch metadata from `request`: `mode`, `credentials`, `cache`, `redirect`, `referrer`, `referrerPolicy`, `integrity`, `keepalive`, and `duplex`.

`options.timeoutMs` belongs at the service envelope level.

## Response Formats

Supported service response formats:

```txt
- JSON envelope with text response body;
- JSON envelope with null body;
- JSON envelope with base64 body using body.data;
- multipart/form-data response with part "meta" and raw binary part "body";
- multipart meta response.body.kind: "binary" and response.body.partName: "body";
- special response shapes for type: "error", "opaque", and "opaqueredirect".
```

Preserve `response.url`, `response.redirected`, `response.type`, `response.status`, `response.statusText`, `response.headers`, and `response.body`.

Statuses `204`, `205`, and `304` have null-body semantics. Do not emit or honor a body for those statuses.

Target HTTP errors are normal target responses. A target `404`, `403`, `429`, `500`, or `503` is returned as `ok: true` unless route policy explicitly retries/classifies it as retryable.

Service-level failures use `ok: false`. Service-error envelopes remain JSON and do not use multipart.

## Format Negotiation

Use service request headers for service response negotiation. Do not use target request headers serialized inside the proxy-fetch target request.

Normalize or remove stale body-related headers when the service response body is transformed.
