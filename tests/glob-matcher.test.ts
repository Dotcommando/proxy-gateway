import { describe, expect, it } from '@jest/globals';

import { hasGlobMagic, matchGlob } from '../src/domain/matching';

describe('matchGlob', () => {
  it('matches literal paths exactly', () => {
    expect(matchGlob('/api/v1/models', '/api/v1/models')).toBe(true);
    expect(matchGlob('/api/v1/models', '/api/v1/model')).toBe(false);
  });

  it('matches star within a single path segment only', () => {
    expect(matchGlob('/api/*/models', '/api/v1/models')).toBe(true);
    expect(matchGlob('/api/*/models', '/api/v1/chat/models')).toBe(false);
    expect(matchGlob('/api/*.json', '/api/data.json')).toBe(true);
    expect(matchGlob('/api/*.json', '/api/nested/data.json')).toBe(false);
  });

  it('matches question mark as exactly one character inside a segment', () => {
    expect(matchGlob('/v?/models', '/v1/models')).toBe(true);
    expect(matchGlob('/v?/models', '/v12/models')).toBe(false);
    expect(matchGlob('/v?/models', '/v//models')).toBe(false);
  });

  it('matches globstar across zero or more complete path segments', () => {
    expect(matchGlob('/api/**/models', '/api/models')).toBe(true);
    expect(matchGlob('/api/**/models', '/api/v1/models')).toBe(true);
    expect(matchGlob('/api/**/models', '/api/v1/chat/models')).toBe(true);
    expect(matchGlob('/api/**', '/api')).toBe(true);
    expect(matchGlob('**/models', 'models')).toBe(true);
    expect(matchGlob('**/models', 'api/v1/models')).toBe(true);
  });

  it('matches character classes and ranges inside a segment', () => {
    expect(matchGlob('/v[12]/models', '/v1/models')).toBe(true);
    expect(matchGlob('/v[12]/models', '/v3/models')).toBe(false);
    expect(matchGlob('/v[1-3]/models', '/v2/models')).toBe(true);
    expect(matchGlob('/v[!3]/models', '/v2/models')).toBe(true);
    expect(matchGlob('/v[!3]/models', '/v3/models')).toBe(false);
  });

  it('supports escaping magic characters', () => {
    expect(matchGlob('/files/\\*.json', '/files/*.json')).toBe(true);
    expect(matchGlob('/files/\\?.json', '/files/?.json')).toBe(true);
    expect(matchGlob('/files/\\[draft\\].json', '/files/[draft].json')).toBe(true);
    expect(matchGlob('/files/\\*.json', '/files/data.json')).toBe(false);
  });

  it('treats unsupported brace and extglob syntax as literal text', () => {
    expect(matchGlob('/api/{v1,v2}/models', '/api/{v1,v2}/models')).toBe(true);
    expect(matchGlob('/api/{v1,v2}/models', '/api/v1/models')).toBe(false);
    expect(matchGlob('/api/+(v1|v2)/models', '/api/+(v1|v2)/models')).toBe(true);
    expect(matchGlob('/api/+(v1|v2)/models', '/api/v1/models')).toBe(false);
  });

  it('can match case-insensitively when requested', () => {
    expect(matchGlob('/API/*', '/api/models')).toBe(false);
    expect(matchGlob('/API/*', '/api/models', { caseSensitive: false })).toBe(true);
  });
});

describe('hasGlobMagic', () => {
  it('detects unescaped glob magic supported by the matcher', () => {
    expect(hasGlobMagic('/api/models')).toBe(false);
    expect(hasGlobMagic('/api/*')).toBe(true);
    expect(hasGlobMagic('/api/?')).toBe(true);
    expect(hasGlobMagic('/api/**/models')).toBe(true);
    expect(hasGlobMagic('/api/v[12]/models')).toBe(true);
  });

  it('ignores escaped magic and unsupported syntax', () => {
    expect(hasGlobMagic('/api/\\*/models')).toBe(false);
    expect(hasGlobMagic('/api/\\?/models')).toBe(false);
    expect(hasGlobMagic('/api/\\[draft\\]/models')).toBe(false);
    expect(hasGlobMagic('/api/{v1,v2}/models')).toBe(false);
    expect(hasGlobMagic('/api/+(v1|v2)/models')).toBe(false);
  });
});
