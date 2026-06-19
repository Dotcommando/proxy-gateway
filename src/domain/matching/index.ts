export type { GlobMatchOptions } from './glob';
export { hasGlobMagic, matchGlob } from './glob';
export type {
  CompiledStringMatcher,
  ExactStringMatcher,
  GlobStringMatcher,
  NormalizedHost,
  NormalizedTargetUrl,
  PrefixStringMatcher,
  RegExpStringMatcher,
  StringMatcher,
  StringMatcherConfig,
  StringMatcherPredicate,
  StringMatchOptions,
  SuffixStringMatcher,
} from './string-matcher';
export {
  compileStringMatcher,
  isOnionHost,
  matchHost,
  matchPath,
  matchString,
  matchUrl,
  normalizeHost,
  normalizeTargetUrl,
} from './string-matcher';
