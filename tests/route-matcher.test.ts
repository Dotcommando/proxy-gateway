import { describe, expect, it } from '@jest/globals';

import { STRING_MATCHER_KIND } from '../src/constants';
import {
  compileStringMatcher,
  isOnionHost,
  matchHost,
  matchPath,
  matchString,
  matchUrl,
  normalizeHost,
  normalizeTargetUrl,
} from '../src/domain/matching';

describe('host normalization', () => {
  it('normalizes case, port, and trailing dots before host matching', () => {
    expect(normalizeHost('API.Example.COM.:443')).toEqual({
      isOnion: false,
      value: 'api.example.com',
    });
    expect(matchHost('api.example.com', 'https://API.Example.COM.:443/v1')).toBe(true);
  });

  it('detects onion hosts after normalization', () => {
    expect(normalizeHost('HiddenService.ONION.')).toEqual({
      isOnion: true,
      value: 'hiddenservice.onion',
    });
    expect(isOnionHost('https://HiddenService.ONION./v1')).toBe(true);
    expect(isOnionHost('https://example-onion.test/v1')).toBe(false);
  });
});

describe('target URL normalization', () => {
  it('normalizes URL hosts while preserving path and query data', () => {
    expect(normalizeTargetUrl('https://API.Example.COM.:8443/v1/models?limit=10')).toEqual({
      host: 'api.example.com',
      isOnion: false,
      path: '/v1/models',
      pathWithSearch: '/v1/models?limit=10',
      protocol: 'https:',
      url: 'https://api.example.com:8443/v1/models?limit=10',
    });
  });

  it('matches exact URLs against the normalized URL form', () => {
    expect(
      matchUrl(
        'https://api.example.com/v1/models?limit=10',
        'https://API.Example.COM./v1/models?limit=10',
      ),
    ).toBe(true);
  });
});

describe('host matchers', () => {
  it('matches exact hosts with normalized case and trailing dots', () => {
    expect(
      matchHost(
        {
          type: STRING_MATCHER_KIND.EXACT,
          value: 'api.example.com',
        },
        'API.Example.COM.',
      ),
    ).toBe(true);
  });

  it('matches suffix hosts by DNS label boundary', () => {
    const matcher = {
      type: STRING_MATCHER_KIND.SUFFIX,
      value: 'example.com',
    } as const;

    expect(matchHost(matcher, 'example.com')).toBe(true);
    expect(matchHost(matcher, 'api.example.com')).toBe(true);
    expect(matchHost(matcher, 'badexample.com')).toBe(false);
  });
});

describe('path matchers', () => {
  it('matches glob path patterns against URL pathnames', () => {
    const matcher = {
      type: STRING_MATCHER_KIND.GLOB,
      value: '/v*/**/models',
    } as const;

    expect(matchPath(matcher, 'https://api.example.com/v1/models?limit=10')).toBe(true);
    expect(matchPath(matcher, 'https://api.example.com/v1/chat/models')).toBe(true);
    expect(matchPath(matcher, 'https://api.example.com/v1/chat/completions')).toBe(false);
  });
});

describe('regexp matchers', () => {
  it('supports declarative regexp matchers', () => {
    const matcher = {
      flags: 'i',
      source: '^/v[0-9]+/models$',
      type: STRING_MATCHER_KIND.REGEXP,
    } as const;

    expect(matchString(matcher, '/V2/models')).toBe(true);
    expect(matchString(matcher, '/latest/models')).toBe(false);
  });

  it('supports programmatic RegExp matchers without leaking lastIndex state', () => {
    const matcher = /\/v[0-9]+\/models/g;

    matcher.lastIndex = 5;

    expect(matchString(matcher, '/v2/models')).toBe(true);
    expect(matchString(matcher, '/v2/models')).toBe(true);
    expect(matcher.lastIndex).toBe(0);
  });

  it('rejects invalid declarative regexp matchers', () => {
    expect(() =>
      compileStringMatcher({
        source: '[',
        type: STRING_MATCHER_KIND.REGEXP,
      }),
    ).toThrow('Invalid regexp matcher');
    expect(() =>
      compileStringMatcher({
        flags: 'g',
        source: '^/v1$',
        type: STRING_MATCHER_KIND.REGEXP,
      }),
    ).toThrow('RegExp matcher flags must not include stateful flags');
  });
});
