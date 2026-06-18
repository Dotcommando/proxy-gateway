import { describe, expect, it } from '@jest/globals';

import { GatewayRequestNormalizer } from '../src/app/normalization/gateway-request-normalizer';

const normalizer = new GatewayRequestNormalizer();

describe('GatewayRequestNormalizer', () => {
  it('normalizes a target request with no body', () => {
    const target = normalizer.normalize({
      body: null,
      headers: [['accept', 'text/plain']],
      method: 'GET',
      url: 'https://example.com/no-body',
    });

    expect(target).toEqual({
      body: {
        kind: 'none',
        replayability: 'replayable',
      },
      fetch: {},
      headers: [['accept', 'text/plain']],
      method: 'GET',
      url: 'https://example.com/no-body',
    });
  });

  it('normalizes a target request with a text body', () => {
    const target = normalizer.normalize({
      body: {
        kind: 'text',
        text: 'hello',
      },
      headers: [['content-type', 'text/plain']],
      method: 'POST',
      url: 'https://example.com/text',
    });

    expect(target.body).toEqual({
      kind: 'text',
      replayability: 'replayable',
      text: 'hello',
    });
  });

  it('normalizes a target request with a base64 body', () => {
    const target = normalizer.normalize({
      body: {
        base64: 'AQIDBA==',
        kind: 'base64',
      },
      method: 'POST',
      url: 'https://example.com/base64',
    });

    expect(target.body.kind).toBe('bytes');
    expect(target.body.replayability).toBe('replayable');

    if (target.body.kind === 'bytes') {
      expect(Array.from(target.body.bytes)).toEqual([1, 2, 3, 4]);
    }
  });

  it('preserves target headers and Fetch metadata', () => {
    const target = normalizer.normalize({
      fetch: {
        cache: 'reload',
        credentials: 'include',
        duplex: 'half',
        integrity: 'sha256-test',
        keepalive: true,
        mode: 'cors',
        redirect: 'manual',
        referrer: 'https://referrer.example/',
        referrerPolicy: 'strict-origin',
      },
      headers: [
        ['accept', 'application/json'],
        ['x-custom', 'yes'],
      ],
      method: 'GET',
      url: 'https://example.com/metadata',
    });

    expect(target.headers).toEqual([
      ['accept', 'application/json'],
      ['x-custom', 'yes'],
    ]);
    expect(target.fetch).toEqual({
      cache: 'reload',
      credentials: 'include',
      duplex: 'half',
      integrity: 'sha256-test',
      keepalive: true,
      mode: 'cors',
      redirect: 'manual',
      referrer: 'https://referrer.example/',
      referrerPolicy: 'strict-origin',
    });
  });

  it('removes stale body framing headers after body normalization', () => {
    const target = normalizer.normalize({
      body: {
        kind: 'text',
        text: 'changed body',
      },
      headers: [
        ['content-type', 'text/plain'],
        ['Content-Length', '999'],
        ['transfer-encoding', 'chunked'],
        ['x-custom', 'yes'],
      ],
      method: 'POST',
      url: 'https://example.com/stale-headers',
    });

    expect(target.headers).toEqual([
      ['content-type', 'text/plain'],
      ['x-custom', 'yes'],
    ]);
  });
});
