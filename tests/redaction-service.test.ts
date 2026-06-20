import { describe, expect, it } from '@jest/globals';

import {
  DEFAULT_REDACTED_HEADER_NAMES,
  DEFAULT_REDACTED_METADATA_KEY_NAMES,
  DEFAULT_REDACTED_QUERY_PARAM_NAMES,
  PROXY_DNS_MODE,
  PROXY_PROTOCOL,
  PROXY_ROUTE_AUTH_MODE,
  PROXY_ROUTE_KIND,
  type ProxyRoute,
  REDACTED_VALUE,
} from '../src';
import { RedactionService } from '../src/app/redaction';

describe('RedactionService', () => {
  it('uses package constants for defaults and the replacement value', () => {
    expect(REDACTED_VALUE).toBe('<redacted>');
    expect(DEFAULT_REDACTED_HEADER_NAMES).toEqual(
      expect.arrayContaining(['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key']),
    );
    expect(DEFAULT_REDACTED_QUERY_PARAM_NAMES).toEqual(
      expect.arrayContaining(['token', 'access_token', 'api_key', 'key', 'secret', 'password']),
    );
    expect(DEFAULT_REDACTED_METADATA_KEY_NAMES).toEqual(
      expect.arrayContaining(['token', 'authorization', 'secret', 'password']),
    );
  });

  it('redacts sensitive headers case-insensitively', () => {
    const redaction = new RedactionService();

    expect(
      redaction.redactHeaders([
        ['Authorization', 'Bearer secret'],
        ['Proxy-Authorization', 'Basic proxy-secret'],
        ['Cookie', 'sid=secret'],
        ['Set-Cookie', 'sid=secret'],
        ['X-API-Key', 'api-secret'],
        ['accept', 'application/json'],
      ]),
    ).toEqual([
      ['Authorization', REDACTED_VALUE],
      ['Proxy-Authorization', REDACTED_VALUE],
      ['Cookie', REDACTED_VALUE],
      ['Set-Cookie', REDACTED_VALUE],
      ['X-API-Key', REDACTED_VALUE],
      ['accept', 'application/json'],
    ]);
  });

  it('redacts sensitive query parameters while preserving non-sensitive URL parts', () => {
    const redaction = new RedactionService();
    const redacted = redaction.redactUrl(
      'https://api.example.com/v1/models?api_key=secret-key&name=model&token=secret-token#section',
    );

    expect(redacted).toContain('https://api.example.com/v1/models?');
    expect(redacted).toContain('api_key=%3Credacted%3E');
    expect(redacted).toContain('name=model');
    expect(redacted).toContain('token=%3Credacted%3E');
    expect(redacted).toContain('#section');
    expect(redacted).not.toContain('secret-key');
    expect(redacted).not.toContain('secret-token');
  });

  it('redacts route auth and secret-like nested metadata without losing useful route diagnostics', () => {
    const redaction = new RedactionService();
    const route: ProxyRoute = {
      auth: {
        mode: PROXY_ROUTE_AUTH_MODE.USERNAME_PASSWORD,
        password: 'route-password',
        token: 'route-token',
        username: 'route-user',
      },
      dns: PROXY_DNS_MODE.PROXY,
      host: 'proxy.example.com',
      kind: PROXY_ROUTE_KIND.FORWARD_PROXY,
      metadata: {
        providerPassword: 'metadata-password',
      },
      port: 8080,
      protocol: PROXY_PROTOCOL.SOCKS5H,
    };
    const routeDiagnostic = redaction.redactRoute(route);
    const metadataDiagnostic = redaction.redactMetadata({
      nested: {
        providerPassword: 'metadata-password',
        'proxy-authorization': 'metadata-proxy-auth',
        publicValue: 'visible',
        token: 'metadata-token',
      },
    });
    const serializedDiagnostics = JSON.stringify({ metadataDiagnostic, routeDiagnostic });

    expect(routeDiagnostic).toMatchObject({
      auth: {
        mode: PROXY_ROUTE_AUTH_MODE.USERNAME_PASSWORD,
      },
      host: 'proxy.example.com',
      port: 8080,
      protocol: PROXY_PROTOCOL.SOCKS5H,
    });
    expect(metadataDiagnostic).toEqual({
      nested: {
        providerPassword: REDACTED_VALUE,
        'proxy-authorization': REDACTED_VALUE,
        publicValue: 'visible',
        token: REDACTED_VALUE,
      },
    });
    expect(serializedDiagnostics).not.toContain('route-password');
    expect(serializedDiagnostics).not.toContain('route-token');
    expect(serializedDiagnostics).not.toContain('route-user');
    expect(serializedDiagnostics).not.toContain('metadata-password');
    expect(serializedDiagnostics).not.toContain('metadata-proxy-auth');
    expect(serializedDiagnostics).not.toContain('metadata-token');
  });

  it('is idempotent for already redacted values', () => {
    const redaction = new RedactionService();

    expect(redaction.redactHeaders([['authorization', REDACTED_VALUE]])).toEqual([
      ['authorization', REDACTED_VALUE],
    ]);
    expect(
      redaction.redactMetadata({
        token: REDACTED_VALUE,
      }),
    ).toEqual({
      token: REDACTED_VALUE,
    });
  });
});
