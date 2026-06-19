import { domainToASCII } from 'node:url';

import { STRING_MATCHER_KIND } from '../../constants';
import { matchGlob } from './glob';

export interface ExactStringMatcher {
  type: STRING_MATCHER_KIND.EXACT;
  value: string;
}

export interface PrefixStringMatcher {
  type: STRING_MATCHER_KIND.PREFIX;
  value: string;
}

export interface SuffixStringMatcher {
  type: STRING_MATCHER_KIND.SUFFIX;
  value: string;
}

export interface GlobStringMatcher {
  type: STRING_MATCHER_KIND.GLOB;
  value: string;
}

export interface RegExpStringMatcher {
  flags?: string;
  source: string;
  type: STRING_MATCHER_KIND.REGEXP;
}

export type StringMatcherConfig =
  | ExactStringMatcher
  | GlobStringMatcher
  | PrefixStringMatcher
  | RegExpStringMatcher
  | SuffixStringMatcher;

export type StringMatcherPredicate = (value: string) => boolean;

export type StringMatcher =
  | RegExp
  | StringMatcherConfig
  | StringMatcherPredicate
  | string;

export interface StringMatchOptions {
  caseSensitive?: boolean;
}

export interface CompiledStringMatcher {
  matches(value: string): boolean;
}

export interface NormalizedHost {
  isOnion: boolean;
  value: string;
}

export interface NormalizedTargetUrl {
  host: string;
  isOnion: boolean;
  path: string;
  pathWithSearch: string;
  protocol: string;
  url: string;
}

export function compileStringMatcher(
  matcher: StringMatcher,
  options: StringMatchOptions = {},
): CompiledStringMatcher {
  if (typeof matcher === 'string') {
    return compileExactMatcher(matcher, options);
  }
  if (typeof matcher === 'function') {
    return {
      matches: matcher,
    };
  }
  if (matcher instanceof RegExp) {
    return compileRegExpMatcher(matcher);
  }

  switch (matcher.type) {
    case STRING_MATCHER_KIND.EXACT:
      return compileExactMatcher(matcher.value, options);
    case STRING_MATCHER_KIND.PREFIX:
      return compilePrefixMatcher(matcher.value, options);
    case STRING_MATCHER_KIND.SUFFIX:
      return compileSuffixMatcher(matcher.value, options);
    case STRING_MATCHER_KIND.GLOB:
      return {
        matches: (value) => matchGlob(matcher.value, value, options),
      };
    case STRING_MATCHER_KIND.REGEXP:
      return compileDeclarativeRegExpMatcher(matcher);
  }
}

export function matchString(
  matcher: StringMatcher,
  value: string,
  options: StringMatchOptions = {},
): boolean {
  return compileStringMatcher(matcher, options).matches(value);
}

export function normalizeHost(input: string | URL): NormalizedHost {
  const host = normalizeHostValue(extractHostInput(input));

  return {
    isOnion: host.endsWith('.onion'),
    value: host,
  };
}

export function isOnionHost(input: string | URL): boolean {
  return normalizeHost(input).isOnion;
}

export function normalizeTargetUrl(input: string | URL): NormalizedTargetUrl {
  const url = input instanceof URL ? input : new URL(input);
  const normalizedHost = normalizeHost(url);
  const port = url.port === '' ? '' : `:${url.port}`;
  const pathWithSearch = `${url.pathname}${url.search}`;

  return {
    host: normalizedHost.value,
    isOnion: normalizedHost.isOnion,
    path: url.pathname,
    pathWithSearch,
    protocol: url.protocol,
    url: `${url.protocol}//${formatHostForUrl(normalizedHost.value)}${port}${pathWithSearch}`,
  };
}

export function matchUrl(matcher: StringMatcher, input: string | URL): boolean {
  const normalizedUrl = normalizeTargetUrl(input).url;

  if (typeof matcher === 'string') {
    return normalizedUrl === normalizeTargetUrl(matcher).url;
  }
  if (isExactStringMatcher(matcher)) {
    return normalizedUrl === normalizeTargetUrl(matcher.value).url;
  }

  return matchString(matcher, normalizedUrl);
}

export function matchHost(matcher: StringMatcher, input: string | URL): boolean {
  const normalizedHost = normalizeHost(input).value;

  if (typeof matcher === 'string') {
    return normalizedHost === normalizeHost(matcher).value;
  }
  if (isExactStringMatcher(matcher)) {
    return normalizedHost === normalizeHost(matcher.value).value;
  }
  if (isSuffixStringMatcher(matcher)) {
    const suffix = normalizeHost(matcher.value).value;

    return normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`);
  }
  if (isPrefixStringMatcher(matcher)) {
    return normalizedHost.startsWith(normalizeHost(matcher.value).value);
  }
  if (isGlobStringMatcher(matcher)) {
    return matchGlob(normalizeHost(matcher.value).value, normalizedHost);
  }

  return matchString(matcher, normalizedHost);
}

export function matchPath(matcher: StringMatcher, input: string | URL): boolean {
  return matchString(matcher, extractPathInput(input));
}

function compileExactMatcher(
  expected: string,
  options: StringMatchOptions,
): CompiledStringMatcher {
  const normalizedExpected = normalizeCase(expected, options);

  return {
    matches: (value) => normalizeCase(value, options) === normalizedExpected,
  };
}

function compilePrefixMatcher(
  expectedPrefix: string,
  options: StringMatchOptions,
): CompiledStringMatcher {
  const normalizedPrefix = normalizeCase(expectedPrefix, options);

  return {
    matches: (value) => normalizeCase(value, options).startsWith(normalizedPrefix),
  };
}

function compileSuffixMatcher(
  expectedSuffix: string,
  options: StringMatchOptions,
): CompiledStringMatcher {
  const normalizedSuffix = normalizeCase(expectedSuffix, options);

  return {
    matches: (value) => normalizeCase(value, options).endsWith(normalizedSuffix),
  };
}

function compileDeclarativeRegExpMatcher(matcher: RegExpStringMatcher): CompiledStringMatcher {
  const flags = matcher.flags ?? '';

  if (flags.includes('g') || flags.includes('y')) {
    throw new Error('RegExp matcher flags must not include stateful flags: g, y');
  }

  try {
    return compileRegExpMatcher(new RegExp(matcher.source, flags));
  } catch (error) {
    throw new Error('Invalid regexp matcher', { cause: error });
  }
}

function compileRegExpMatcher(regexp: RegExp): CompiledStringMatcher {
  return {
    matches(value) {
      regexp.lastIndex = 0;

      try {
        return regexp.test(value);
      } finally {
        regexp.lastIndex = 0;
      }
    },
  };
}

function normalizeCase(value: string, options: StringMatchOptions): string {
  return options.caseSensitive === false ? value.toLowerCase() : value;
}

function extractHostInput(input: string | URL): string {
  if (input instanceof URL) {
    return input.hostname;
  }

  const trimmed = input.trim();

  if (hasUrlScheme(trimmed)) {
    return new URL(trimmed).hostname;
  }

  return extractHostWithoutUrlParsing(trimmed);
}

function extractHostWithoutUrlParsing(input: string): string {
  if (input.startsWith('[')) {
    const closingBracketIndex = input.indexOf(']');

    if (closingBracketIndex !== -1) {
      return input.slice(1, closingBracketIndex);
    }
  }

  const colonIndex = input.lastIndexOf(':');

  if (
    colonIndex !== -1
    && input.indexOf(':') === colonIndex
    && /^\d+$/.test(input.slice(colonIndex + 1))
  ) {
    return input.slice(0, colonIndex);
  }

  return input;
}

function normalizeHostValue(input: string): string {
  let host = input.toLowerCase();

  while (host.endsWith('.') && host.length > 1) {
    host = host.slice(0, -1);
  }

  const asciiHost = domainToASCII(host);

  return asciiHost === '' ? host : asciiHost;
}

function hasUrlScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function formatHostForUrl(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

function extractPathInput(input: string | URL): string {
  if (input instanceof URL) {
    return input.pathname;
  }

  try {
    return new URL(input).pathname;
  } catch {
    const queryIndex = input.indexOf('?');
    const hashIndex = input.indexOf('#');
    const endIndexes = [queryIndex, hashIndex].filter((index) => index !== -1);
    const endIndex = endIndexes.length === 0 ? input.length : Math.min(...endIndexes);

    return input.slice(0, endIndex);
  }
}

function isExactStringMatcher(matcher: StringMatcher): matcher is ExactStringMatcher {
  return isStringMatcherConfig(matcher) && matcher.type === STRING_MATCHER_KIND.EXACT;
}

function isPrefixStringMatcher(matcher: StringMatcher): matcher is PrefixStringMatcher {
  return isStringMatcherConfig(matcher) && matcher.type === STRING_MATCHER_KIND.PREFIX;
}

function isSuffixStringMatcher(matcher: StringMatcher): matcher is SuffixStringMatcher {
  return isStringMatcherConfig(matcher) && matcher.type === STRING_MATCHER_KIND.SUFFIX;
}

function isGlobStringMatcher(matcher: StringMatcher): matcher is GlobStringMatcher {
  return isStringMatcherConfig(matcher) && matcher.type === STRING_MATCHER_KIND.GLOB;
}

function isStringMatcherConfig(matcher: StringMatcher): matcher is StringMatcherConfig {
  return typeof matcher === 'object' && !(matcher instanceof RegExp);
}
