import { describe, expect, it } from '@jest/globals';

import {
  ACCEPT_HEADER_NAME,
  AUTHORIZATION_BEARER_PREFIX,
  AUTHORIZATION_HEADER_NAME,
  BINARY_BODY_PART_NAME,
  BINARY_BODY_TRANSPORT_JSON_BASE64,
  BINARY_BODY_TRANSPORT_MULTIPART,
  BODY_ENCODING_BASE64,
  BODY_KIND_BASE64,
  BODY_KIND_BINARY,
  BODY_KIND_TEXT,
  CONTENT_TYPE_HEADER_NAME,
  DEFAULT_TIMEOUT_MS,
  FORM_URLENCODED_CONTENT_TYPE,
  GRAPHQL_CONTENT_TYPE,
  HEADER_PAIR_LENGTH,
  INVALID_SERVICE_RESPONSE_CODE,
  JSON_CONTENT_TYPE,
  METADATA_PART_NAME,
  MULTIPART_CONTENT_TYPE_PREFIX,
  OCTET_STREAM_CONTENT_TYPE,
  SERVICE_ACCEPT_HEADER_VALUE,
  SERVICE_HTTP_ERROR_CODE,
  SERVICE_HTTP_METHOD,
  SERVICE_REQUEST_TRANSPORT_JSON,
  SERVICE_REQUEST_TRANSPORT_MULTIPART,
  STREAMING_MULTIPART_BOUNDARY_PREFIX,
  TEXT_CONTENT_TYPE_PREFIX,
  WIRE_PROTOCOL_VERSION,
  XML_CONTENT_TYPE,
} from '../src';

describe('proxy-fetch wire compatibility constants', () => {
  it('keeps the exact protocol and body constants used by @echospecter/proxy-fetch', () => {
    expect(WIRE_PROTOCOL_VERSION).toBe('proxy-fetch.v1');
    expect(DEFAULT_TIMEOUT_MS).toBe(360_000);
    expect(BODY_ENCODING_BASE64).toBe('base64');
    expect(BODY_KIND_TEXT).toBe('text');
    expect(BODY_KIND_BINARY).toBe('binary');
    expect(BODY_KIND_BASE64).toBe('base64');
    expect(BINARY_BODY_PART_NAME).toBe('body');
    expect(METADATA_PART_NAME).toBe('meta');
    expect(BINARY_BODY_TRANSPORT_MULTIPART).toBe('multipart');
    expect(BINARY_BODY_TRANSPORT_JSON_BASE64).toBe('json-base64');
    expect(SERVICE_REQUEST_TRANSPORT_JSON).toBe('json');
    expect(SERVICE_REQUEST_TRANSPORT_MULTIPART).toBe('multipart');
  });

  it('keeps the exact service transport constants used by @echospecter/proxy-fetch', () => {
    expect(SERVICE_HTTP_METHOD).toBe('POST');
    expect(JSON_CONTENT_TYPE).toBe('application/json');
    expect(MULTIPART_CONTENT_TYPE_PREFIX).toBe('multipart/form-data');
    expect(SERVICE_ACCEPT_HEADER_VALUE).toBe('application/json, multipart/form-data');
    expect(TEXT_CONTENT_TYPE_PREFIX).toBe('text/');
    expect(FORM_URLENCODED_CONTENT_TYPE).toBe('application/x-www-form-urlencoded');
    expect(XML_CONTENT_TYPE).toBe('application/xml');
    expect(GRAPHQL_CONTENT_TYPE).toBe('application/graphql');
    expect(ACCEPT_HEADER_NAME).toBe('accept');
    expect(AUTHORIZATION_HEADER_NAME).toBe('authorization');
    expect(CONTENT_TYPE_HEADER_NAME).toBe('content-type');
    expect(AUTHORIZATION_BEARER_PREFIX).toBe('Bearer ');
    expect(HEADER_PAIR_LENGTH).toBe(2);
    expect(SERVICE_HTTP_ERROR_CODE).toBe('SERVICE_HTTP_ERROR');
    expect(INVALID_SERVICE_RESPONSE_CODE).toBe('INVALID_SERVICE_RESPONSE');
    expect(STREAMING_MULTIPART_BOUNDARY_PREFIX).toBe('proxy-fetch-stream');
    expect(OCTET_STREAM_CONTENT_TYPE).toBe('application/octet-stream');
  });
});

describe('proxy-fetch body serialization compatibility matrix', () => {
  it('documents every client body shape as a gateway wire format', () => {
    const cases = [
      {
        clientBody: 'no body',
        defaultBodyKind: null,
        defaultTransport: SERVICE_REQUEST_TRANSPORT_JSON,
      },
      {
        clientBody: 'string',
        defaultBodyKind: BODY_KIND_TEXT,
        defaultTransport: SERVICE_REQUEST_TRANSPORT_JSON,
      },
      {
        clientBody: 'URLSearchParams',
        defaultBodyKind: BODY_KIND_TEXT,
        defaultTransport: SERVICE_REQUEST_TRANSPORT_JSON,
      },
      {
        clientBody: 'Blob',
        defaultBodyKind: BODY_KIND_BINARY,
        defaultTransport: SERVICE_REQUEST_TRANSPORT_MULTIPART,
        jsonBase64BodyKind: BODY_KIND_BASE64,
      },
      {
        clientBody: 'ArrayBuffer',
        defaultBodyKind: BODY_KIND_BINARY,
        defaultTransport: SERVICE_REQUEST_TRANSPORT_MULTIPART,
        jsonBase64BodyKind: BODY_KIND_BASE64,
      },
      {
        clientBody: 'typed array',
        defaultBodyKind: BODY_KIND_BINARY,
        defaultTransport: SERVICE_REQUEST_TRANSPORT_MULTIPART,
        jsonBase64BodyKind: BODY_KIND_BASE64,
      },
      {
        clientBody: 'FormData',
        defaultBodyKind: BODY_KIND_BINARY,
        defaultTransport: SERVICE_REQUEST_TRANSPORT_MULTIPART,
        jsonBase64BodyKind: BODY_KIND_BASE64,
      },
      {
        clientBody: 'ReadableStream with duplex half',
        defaultBodyKind: BODY_KIND_BINARY,
        defaultTransport: SERVICE_REQUEST_TRANSPORT_MULTIPART,
        streaming: true,
      },
      {
        clientBody: 'existing Request',
        defaultBodyKind: 'derived from request body',
        defaultTransport: 'derived from request body',
      },
      {
        clientBody: 'unknown body with textual content-type',
        defaultBodyKind: BODY_KIND_TEXT,
        defaultTransport: SERVICE_REQUEST_TRANSPORT_JSON,
      },
      {
        clientBody: 'unknown body with binary content-type',
        defaultBodyKind: BODY_KIND_BINARY,
        defaultTransport: SERVICE_REQUEST_TRANSPORT_MULTIPART,
        jsonBase64BodyKind: BODY_KIND_BASE64,
      },
    ];

    expect(cases).toEqual([
      expect.objectContaining({ clientBody: 'no body', defaultBodyKind: null }),
      expect.objectContaining({ clientBody: 'string', defaultBodyKind: BODY_KIND_TEXT }),
      expect.objectContaining({ clientBody: 'URLSearchParams', defaultBodyKind: BODY_KIND_TEXT }),
      expect.objectContaining({ clientBody: 'Blob', defaultBodyKind: BODY_KIND_BINARY }),
      expect.objectContaining({ clientBody: 'ArrayBuffer', defaultBodyKind: BODY_KIND_BINARY }),
      expect.objectContaining({ clientBody: 'typed array', defaultBodyKind: BODY_KIND_BINARY }),
      expect.objectContaining({ clientBody: 'FormData', defaultBodyKind: BODY_KIND_BINARY }),
      expect.objectContaining({
        clientBody: 'ReadableStream with duplex half',
        defaultBodyKind: BODY_KIND_BINARY,
        streaming: true,
      }),
      expect.objectContaining({ clientBody: 'existing Request' }),
      expect.objectContaining({ clientBody: 'unknown body with textual content-type', defaultBodyKind: BODY_KIND_TEXT }),
      expect.objectContaining({ clientBody: 'unknown body with binary content-type', defaultBodyKind: BODY_KIND_BINARY }),
    ]);
  });
});
