import {
  DEFAULT_REDACTED_HEADER_NAMES,
  DEFAULT_REDACTED_METADATA_KEY_NAMES,
  DEFAULT_REDACTED_QUERY_PARAM_NAMES,
  REDACTED_VALUE,
} from '../../constants';
import { createRouteDiagnostic, type RouteDiagnostic } from '../../domain/routing';
import type { ProxyRoute } from '../../ports/outbound';

export interface RedactionPolicy {
  headerNames?: readonly string[];
  metadataKeyNames?: readonly string[];
  queryParamNames?: readonly string[];
  replacement?: string;
}

export class RedactionService {
  readonly #headerNames: ReadonlySet<string>;
  readonly #metadataKeyNames: ReadonlySet<string>;
  readonly #queryParamNames: ReadonlySet<string>;
  readonly #replacement: string;

  constructor(policy: RedactionPolicy = {}) {
    this.#headerNames = normalizeNames(policy.headerNames ?? DEFAULT_REDACTED_HEADER_NAMES);
    this.#metadataKeyNames = normalizeNames(policy.metadataKeyNames ?? DEFAULT_REDACTED_METADATA_KEY_NAMES);
    this.#queryParamNames = normalizeNames(policy.queryParamNames ?? DEFAULT_REDACTED_QUERY_PARAM_NAMES);
    this.#replacement = policy.replacement ?? REDACTED_VALUE;
  }

  redactHeader(header: [string, string]): [string, string] {
    const [name, value] = header;

    return this.#isSensitiveHeaderName(name) ? [name, this.#redactScalar(value)] : [name, value];
  }

  redactHeaders(headers: Array<[string, string]>): Array<[string, string]> {
    return headers.map((header) => this.redactHeader(header));
  }

  redactUrl(value: string): string {
    let url: URL;

    try {
      url = new URL(value);
    } catch {
      return this.#replacement;
    }

    const queryEntries = Array.from(url.searchParams.entries());

    if (queryEntries.length === 0) {
      return url.toString();
    }

    url.search = '';

    for (const [name, queryValue] of queryEntries) {
      url.searchParams.append(
        name,
        this.#isSensitiveQueryParamName(name) ? this.#redactScalar(queryValue) : queryValue,
      );
    }

    return url.toString();
  }

  redactRoute(route: ProxyRoute): RouteDiagnostic {
    const diagnostic = this.redactMetadata(createRouteDiagnostic(route));

    return isRecord(diagnostic) ? diagnostic : {};
  }

  redactMetadata(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.redactMetadata(item));
    }
    if (!isRecord(value)) {
      return value;
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        this.#isSensitiveMetadataKey(key) ? this.#redactScalar(entryValue) : this.redactMetadata(entryValue),
      ]),
    );
  }

  #isSensitiveHeaderName(name: string): boolean {
    return this.#headerNames.has(normalizeName(name));
  }

  #isSensitiveQueryParamName(name: string): boolean {
    return this.#queryParamNames.has(normalizeName(name));
  }

  #isSensitiveMetadataKey(name: string): boolean {
    const normalizedName = normalizeName(name);
    const compactName = compactNameForComparison(name);

    return (
      this.#metadataKeyNames.has(normalizedName)
      || compactName.includes('authorization')
      || compactName === 'cookie'
      || compactName === 'setcookie'
      || compactName.includes('secret')
      || compactName.includes('password')
      || compactName.endsWith('token')
      || compactName.endsWith('apikey')
      || compactName.endsWith('authkey')
      || compactName.endsWith('privatekey')
    );
  }

  #redactScalar(value: unknown): string {
    return value === this.#replacement ? this.#replacement : this.#replacement;
  }
}

function normalizeNames(names: readonly string[]): ReadonlySet<string> {
  return new Set(names.map(normalizeName));
}

function normalizeName(name: string): string {
  return name.toLowerCase();
}

function compactNameForComparison(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer);
}
