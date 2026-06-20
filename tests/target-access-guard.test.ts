import { describe, expect, it } from '@jest/globals';

import {
  createProxyGateway,
  DEFAULT_ALLOWED_TARGET_SCHEMES,
  DENIED_IPV4_CIDR_RANGES,
  DENIED_IPV6_CIDR_RANGES,
  type GatewayTargetRequest,
  PROXY_NETWORK_TYPE,
  type ProxyProviderInstance,
  RESPONSE_CODE,
  TARGET_ACCESS_REJECTION_REASON,
  TARGET_ACCESS_RESULT_KIND,
  type TargetAccessPolicy,
  WIRE_PROTOCOL_VERSION,
} from '../src';
import { TargetAccessGuard } from '../src/app/security';

describe('TargetAccessGuard', () => {
  it('uses package constants and enums for default schemes, denied ranges, result kinds, and rejection reasons', () => {
    expect(DEFAULT_ALLOWED_TARGET_SCHEMES).toEqual(['http:', 'https:']);
    expect(DENIED_IPV4_CIDR_RANGES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ base: '127.0.0.0', prefixLength: 8 }),
        expect.objectContaining({ base: '192.168.0.0', prefixLength: 16 }),
      ]),
    );
    expect(DENIED_IPV6_CIDR_RANGES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ base: '::1', prefixLength: 128 }),
        expect.objectContaining({ base: 'fc00::', prefixLength: 7 }),
      ]),
    );
    expect(TARGET_ACCESS_RESULT_KIND.ALLOWED).toBe('allowed');
    expect(TARGET_ACCESS_RESULT_KIND.REJECTED).toBe('rejected');
    expect(TARGET_ACCESS_REJECTION_REASON.PRIVATE_IP_RANGE).toBe('private-ip-range');
    expect(TARGET_ACCESS_REJECTION_REASON.LINK_LOCAL_IP_RANGE).toBe('link-local-ip-range');
    expect(TARGET_ACCESS_REJECTION_REASON.RESERVED_IP_RANGE).toBe('reserved-ip-range');
  });

  it('exposes the v0.1 target access policy field names without legacy aliases', () => {
    const acceptsPolicy = (policy: TargetAccessPolicy): TargetAccessPolicy => policy;

    acceptsPolicy({
      allowLinkLocalIps: true,
      allowLocalhost: true,
      allowOnionHosts: true,
      allowPrivateIps: true,
      allowedHosts: ['example.com'],
      allowedSchemes: ['https:'],
      deniedCidrs: ['203.0.113.0/24'],
      deniedHosts: ['blocked.example.com'],
      onionRequiresNetworkType: PROXY_NETWORK_TYPE.TOR,
    });

    // @ts-expect-error v0.1 uses allowPrivateIps instead.
    acceptsPolicy({ allowPrivateNetworks: true });
    // @ts-expect-error v0.1 uses allowOnionHosts instead.
    acceptsPolicy({ allowOnionTargets: true });
  });

  it('allows ordinary HTTP and HTTPS public targets', () => {
    const guard = new TargetAccessGuard();

    expect(guard.check({ target: targetRequest('https://example.com/resource') })).toEqual({
      kind: TARGET_ACCESS_RESULT_KIND.ALLOWED,
    });
    expect(guard.check({ target: targetRequest('http://93.184.216.34/resource') })).toEqual({
      kind: TARGET_ACCESS_RESULT_KIND.ALLOWED,
    });
  });

  it('rejects unsupported schemes by default', () => {
    const guard = new TargetAccessGuard();

    for (const url of ['file:///etc/passwd', 'ftp://example.com/file', 'data:text/plain,hello']) {
      expect(guard.checkUrl(url)).toMatchObject({
        kind: TARGET_ACCESS_RESULT_KIND.REJECTED,
        reason: TARGET_ACCESS_REJECTION_REASON.UNSUPPORTED_SCHEME,
      });
    }
  });

  it('rejects localhost-style hostnames by default', () => {
    const guard = new TargetAccessGuard();

    for (const url of ['http://localhost/status', 'http://api.localhost/status']) {
      expect(guard.checkUrl(url)).toMatchObject({
        kind: TARGET_ACCESS_RESULT_KIND.REJECTED,
        reason: TARGET_ACCESS_REJECTION_REASON.LOCAL_HOSTNAME,
      });
    }
  });

  it('rejects denied IPv4 ranges by CIDR rather than exact host equality', () => {
    const guard = new TargetAccessGuard();

    for (const [url, reason] of [
      ['http://0.0.0.0/', TARGET_ACCESS_REJECTION_REASON.LOCAL_HOSTNAME],
      ['http://10.2.3.4/', TARGET_ACCESS_REJECTION_REASON.PRIVATE_IP_RANGE],
      ['http://100.64.0.1/', TARGET_ACCESS_REJECTION_REASON.PRIVATE_IP_RANGE],
      ['http://127.0.0.1/', TARGET_ACCESS_REJECTION_REASON.LOCAL_HOSTNAME],
      ['http://169.254.10.20/', TARGET_ACCESS_REJECTION_REASON.LINK_LOCAL_IP_RANGE],
      ['http://172.16.0.1/', TARGET_ACCESS_REJECTION_REASON.PRIVATE_IP_RANGE],
      ['http://172.31.255.255/', TARGET_ACCESS_REJECTION_REASON.PRIVATE_IP_RANGE],
      ['http://192.168.0.1/', TARGET_ACCESS_REJECTION_REASON.PRIVATE_IP_RANGE],
      ['http://224.0.0.1/', TARGET_ACCESS_REJECTION_REASON.RESERVED_IP_RANGE],
    ] as const) {
      expect(guard.checkUrl(url)).toMatchObject({
        kind: TARGET_ACCESS_RESULT_KIND.REJECTED,
        reason,
      });
    }
  });

  it('rejects denied IPv6 ranges by CIDR', () => {
    const guard = new TargetAccessGuard();

    for (const [url, reason] of [
      ['http://[::]/', TARGET_ACCESS_REJECTION_REASON.LOCAL_HOSTNAME],
      ['http://[::1]/', TARGET_ACCESS_REJECTION_REASON.LOCAL_HOSTNAME],
      ['http://[fc00::1]/', TARGET_ACCESS_REJECTION_REASON.PRIVATE_IP_RANGE],
      ['http://[fe80::1]/', TARGET_ACCESS_REJECTION_REASON.LINK_LOCAL_IP_RANGE],
    ] as const) {
      expect(guard.checkUrl(url)).toMatchObject({
        kind: TARGET_ACCESS_RESULT_KIND.REJECTED,
        reason,
      });
    }
  });

  it('can explicitly allow local, private, link-local, and onion targets', () => {
    const guard = new TargetAccessGuard({
      allowLinkLocalIps: true,
      allowLocalhost: true,
      allowOnionHosts: true,
      allowPrivateIps: true,
    });

    expect(guard.checkUrl('http://localhost/status')).toEqual({
      kind: TARGET_ACCESS_RESULT_KIND.ALLOWED,
    });
    expect(guard.checkUrl('http://192.168.0.1/status')).toEqual({
      kind: TARGET_ACCESS_RESULT_KIND.ALLOWED,
    });
    expect(guard.checkUrl('http://169.254.10.20/status')).toEqual({
      kind: TARGET_ACCESS_RESULT_KIND.ALLOWED,
    });
    expect(guard.checkUrl('http://exampleonionaddress.onion/status')).toEqual({
      kind: TARGET_ACCESS_RESULT_KIND.ALLOWED,
    });
  });

  it('rejects onion targets by default', () => {
    expect(new TargetAccessGuard().checkUrl('http://exampleonionaddress.onion/status')).toMatchObject({
      kind: TARGET_ACCESS_RESULT_KIND.REJECTED,
      reason: TARGET_ACCESS_REJECTION_REASON.ONION_NOT_ALLOWED,
    });
  });

  it('rejects already-resolved private IP facts even for public-looking hostnames', () => {
    const result = new TargetAccessGuard().check({
      facts: {
        target: {
          resolvedIps: ['192.168.1.10'],
        },
      },
      target: targetRequest('https://api.example.com/resource'),
    });

    expect(result).toMatchObject({
      kind: TARGET_ACCESS_RESULT_KIND.REJECTED,
      reason: TARGET_ACCESS_REJECTION_REASON.RESOLVED_PRIVATE_IP_RANGE,
    });
  });

  it('applies explicit private and link-local allow flags to already-resolved IP facts', () => {
    const guard = new TargetAccessGuard({
      allowLinkLocalIps: true,
      allowPrivateIps: true,
    });

    expect(
      guard.check({
        facts: {
          target: {
            resolvedIps: ['192.168.1.10', '169.254.10.20'],
          },
        },
        target: targetRequest('https://api.example.com/resource'),
      }),
    ).toEqual({
      kind: TARGET_ACCESS_RESULT_KIND.ALLOWED,
    });
  });

  it('keeps private and link-local allow flags separate for resolved IP facts', () => {
    const privateOnlyGuard = new TargetAccessGuard({
      allowPrivateIps: true,
    });
    const linkLocalOnlyGuard = new TargetAccessGuard({
      allowLinkLocalIps: true,
    });

    expect(
      privateOnlyGuard.check({
        facts: {
          target: {
            resolvedIps: ['169.254.10.20'],
          },
        },
        target: targetRequest('https://api.example.com/resource'),
      }),
    ).toMatchObject({
      kind: TARGET_ACCESS_RESULT_KIND.REJECTED,
      reason: TARGET_ACCESS_REJECTION_REASON.RESOLVED_LINK_LOCAL_IP_RANGE,
    });
    expect(
      linkLocalOnlyGuard.check({
        facts: {
          target: {
            resolvedIps: ['192.168.1.10'],
          },
        },
        target: targetRequest('https://api.example.com/resource'),
      }),
    ).toMatchObject({
      kind: TARGET_ACCESS_RESULT_KIND.REJECTED,
      reason: TARGET_ACCESS_REJECTION_REASON.RESOLVED_PRIVATE_IP_RANGE,
    });
  });

  it('applies explicit host allow/deny lists and custom denied CIDR ranges', () => {
    const guard = new TargetAccessGuard({
      allowedHosts: ['api.example.com'],
      deniedCidrs: ['203.0.113.0/24'],
      deniedHosts: ['blocked.example.com'],
    });

    expect(guard.checkUrl('https://api.example.com/resource')).toEqual({
      kind: TARGET_ACCESS_RESULT_KIND.ALLOWED,
    });
    expect(guard.checkUrl('https://blocked.example.com/resource')).toMatchObject({
      kind: TARGET_ACCESS_RESULT_KIND.REJECTED,
      reason: TARGET_ACCESS_REJECTION_REASON.DENIED_HOST,
    });
    expect(guard.checkUrl('https://other.example.com/resource')).toMatchObject({
      kind: TARGET_ACCESS_RESULT_KIND.REJECTED,
      reason: TARGET_ACCESS_REJECTION_REASON.HOST_NOT_ALLOWED,
    });
    expect(guard.checkUrl('http://203.0.113.42/resource')).toMatchObject({
      kind: TARGET_ACCESS_RESULT_KIND.REJECTED,
      reason: TARGET_ACCESS_REJECTION_REASON.DENIED_CIDR_RANGE,
    });
  });

  it('can validate supplied redirect or final URLs without target transport redirect integration', () => {
    const guard = new TargetAccessGuard();

    expect(guard.checkRedirectUrl('https://example.com/final')).toEqual({
      kind: TARGET_ACCESS_RESULT_KIND.ALLOWED,
    });
    expect(guard.checkRedirectUrl('/final', 'https://example.com/current')).toEqual({
      kind: TARGET_ACCESS_RESULT_KIND.ALLOWED,
    });
    expect(guard.checkRedirectUrl('http://127.0.0.1/final')).toMatchObject({
      kind: TARGET_ACCESS_RESULT_KIND.REJECTED,
      reason: TARGET_ACCESS_REJECTION_REASON.LOCAL_HOSTNAME,
    });
    expect(guard.checkRedirectUrl('//127.0.0.1/admin', 'https://example.com/current')).toMatchObject({
      kind: TARGET_ACCESS_RESULT_KIND.REJECTED,
      reason: TARGET_ACCESS_REJECTION_REASON.LOCAL_HOSTNAME,
    });
    expect(guard.checkRedirectUrl('file:///etc/passwd', 'https://example.com/current')).toMatchObject({
      kind: TARGET_ACCESS_RESULT_KIND.REJECTED,
      reason: TARGET_ACCESS_REJECTION_REASON.UNSUPPORTED_SCHEME,
    });
  });

  it('direct gateway flow rejects denied targets before provider acquisition', async () => {
    let acquired = false;
    const provider: ProxyProviderInstance = {
      adapter: {
        acquire: async () => {
          acquired = true;

          throw new Error('provider should not be acquired');
        },
        getCapabilities: () => ({}),
        kind: 'test-direct',
      },
      id: 'provider-a',
    };
    const gateway = createProxyGateway({
      providers: [provider],
      transport: {
        execute: async () => {
          throw new Error('transport should not execute');
        },
      },
    });
    const response = await gateway.handle(proxyFetchJsonRequest('http://127.0.0.1/private'));

    expect(acquired).toBe(false);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: RESPONSE_CODE.TARGET_ACCESS_DENIED,
        retryable: false,
      },
      ok: false,
      version: WIRE_PROTOCOL_VERSION,
    });
  });
});

function targetRequest(url: string): GatewayTargetRequest {
  return {
    body: {
      kind: 'none',
      replayability: 'replayable',
    },
    fetch: {},
    headers: [],
    method: 'GET',
    url,
  };
}

function proxyFetchJsonRequest(url: string): Request {
  return new Request('https://gateway.test/proxy', {
    body: JSON.stringify({
      context: {},
      request: {
        body: null,
        headers: [],
        method: 'GET',
        url,
      },
      version: WIRE_PROTOCOL_VERSION,
    }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  });
}
