import {
  DEFAULT_ALLOWED_TARGET_SCHEMES,
  type IpCidrRange,
  LINK_LOCAL_IPV4_CIDR_RANGES,
  LINK_LOCAL_IPV6_CIDR_RANGES,
  LOOPBACK_IPV4_CIDR_RANGES,
  LOOPBACK_IPV6_CIDR_RANGES,
  PRIVATE_IPV4_CIDR_RANGES,
  PRIVATE_IPV6_CIDR_RANGES,
  RESERVED_IPV4_CIDR_RANGES,
  RESERVED_IPV6_CIDR_RANGES,
  RESPONSE_CODE,
  TARGET_ACCESS_DENIED_MESSAGE,
  TARGET_ACCESS_REJECTION_REASON,
  TARGET_ACCESS_RESULT_KIND,
} from '../../constants';
import { matchHost } from '../../domain';
import type { GatewayFacts, GatewayTargetRequest } from '../../ports/outbound';
import type { TargetAccessPolicy } from '../types';

export interface TargetAccessCheckInput {
  facts?: GatewayFacts;
  target: GatewayTargetRequest;
}

export type TargetAccessResult =
  | {
      kind: TARGET_ACCESS_RESULT_KIND.ALLOWED;
    }
  | {
      code: RESPONSE_CODE.TARGET_ACCESS_DENIED;
      kind: TARGET_ACCESS_RESULT_KIND.REJECTED;
      message: typeof TARGET_ACCESS_DENIED_MESSAGE;
      reason: TARGET_ACCESS_REJECTION_REASON;
      status: 403;
    };

export class TargetAccessGuard {
  readonly #policy: TargetAccessPolicy;

  constructor(policy: TargetAccessPolicy = {}) {
    this.#policy = policy;
  }

  check(input: TargetAccessCheckInput): TargetAccessResult {
    const targetResult = this.checkUrl(input.target.url);

    if (targetResult.kind === TARGET_ACCESS_RESULT_KIND.REJECTED) {
      return targetResult;
    }

    for (const resolvedIp of input.facts?.target?.resolvedIps ?? []) {
      const resolvedResult = this.#checkIpAddress(resolvedIp, true);

      if (resolvedResult.kind === TARGET_ACCESS_RESULT_KIND.REJECTED) {
        return resolvedResult;
      }
    }

    return allowed();
  }

  checkRedirectUrl(url: string, baseUrl?: string): TargetAccessResult {
    if (baseUrl === undefined) {
      return this.checkUrl(url);
    }

    try {
      return this.checkUrl(new URL(url, baseUrl).toString());
    } catch {
      return rejected(TARGET_ACCESS_REJECTION_REASON.INVALID_URL);
    }
  }

  checkUrl(url: string): TargetAccessResult {
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(url);
    } catch {
      return rejected(TARGET_ACCESS_REJECTION_REASON.INVALID_URL);
    }

    if (!this.#allowedSchemes().includes(parsedUrl.protocol)) {
      return rejected(TARGET_ACCESS_REJECTION_REASON.UNSUPPORTED_SCHEME);
    }

    const hostname = normalizeHostname(parsedUrl.hostname);
    const ipResult = this.#checkIpAddress(hostname, false);

    if (ipResult.kind === TARGET_ACCESS_RESULT_KIND.REJECTED) {
      return ipResult;
    }
    if (this.#isDeniedHost(hostname)) {
      return rejected(TARGET_ACCESS_REJECTION_REASON.DENIED_HOST);
    }
    if (this.#hasAllowedHosts() && !this.#isAllowedHost(hostname)) {
      return rejected(TARGET_ACCESS_REJECTION_REASON.HOST_NOT_ALLOWED);
    }
    if (!this.#policy.allowOnionHosts && hostname.endsWith('.onion')) {
      return rejected(TARGET_ACCESS_REJECTION_REASON.ONION_NOT_ALLOWED);
    }
    if (!this.#policy.allowLocalhost && isLocalHostname(hostname)) {
      return rejected(TARGET_ACCESS_REJECTION_REASON.LOCAL_HOSTNAME);
    }

    return allowed();
  }

  #allowedSchemes(): readonly string[] {
    return this.#policy.allowedSchemes ?? DEFAULT_ALLOWED_TARGET_SCHEMES;
  }

  #checkIpAddress(value: string, resolved: boolean): TargetAccessResult {
    if (this.#isDeniedByCustomCidr(value)) {
      return rejected(TARGET_ACCESS_REJECTION_REASON.DENIED_CIDR_RANGE);
    }

    const classification = classifyDeniedIpAddress(value);

    if (classification === undefined) {
      return allowed();
    }
    if (classification === TARGET_IP_RANGE_KIND.LOOPBACK && this.#policy.allowLocalhost === true) {
      return allowed();
    }
    if (classification === TARGET_IP_RANGE_KIND.PRIVATE && this.#policy.allowPrivateIps === true) {
      return allowed();
    }
    if (classification === TARGET_IP_RANGE_KIND.LINK_LOCAL && this.#policy.allowLinkLocalIps === true) {
      return allowed();
    }

    return rejected(rejectionReasonForIpRange(classification, resolved));
  }

  #hasAllowedHosts(): boolean {
    return (this.#policy.allowedHosts?.length ?? 0) > 0;
  }

  #isAllowedHost(hostname: string): boolean {
    return this.#policy.allowedHosts?.some((matcher) => matchHost(matcher, hostname)) ?? true;
  }

  #isDeniedHost(hostname: string): boolean {
    return this.#policy.deniedHosts?.some((matcher) => matchHost(matcher, hostname)) ?? false;
  }

  #isDeniedByCustomCidr(value: string): boolean {
    return this.#policy.deniedCidrs?.some((cidr) => ipAddressInCidr(value, cidr)) ?? false;
  }
}

function allowed(): TargetAccessResult {
  return {
    kind: TARGET_ACCESS_RESULT_KIND.ALLOWED,
  };
}

function rejected(reason: TARGET_ACCESS_REJECTION_REASON): TargetAccessResult {
  return {
    code: RESPONSE_CODE.TARGET_ACCESS_DENIED,
    kind: TARGET_ACCESS_RESULT_KIND.REJECTED,
    message: TARGET_ACCESS_DENIED_MESSAGE,
    reason,
    status: 403,
  };
}

function normalizeHostname(hostname: string): string {
  const withoutBrackets = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;

  return withoutBrackets.toLowerCase().replace(/\.$/, '');
}

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost');
}

enum TARGET_IP_RANGE_KIND {
  LINK_LOCAL = 'link-local',
  LOOPBACK = 'loopback',
  PRIVATE = 'private',
  RESERVED = 'reserved',
}

function classifyDeniedIpAddress(value: string): TARGET_IP_RANGE_KIND | undefined {
  return classifyDeniedIpv4Address(value) ?? classifyDeniedIpv6Address(value);
}

function classifyDeniedIpv4Address(value: string): TARGET_IP_RANGE_KIND | undefined {
  const address = parseIpv4Address(value);

  if (address === undefined) {
    return undefined;
  }
  if (LOOPBACK_IPV4_CIDR_RANGES.some((range) => ipv4AddressInRange(address, range))) {
    return TARGET_IP_RANGE_KIND.LOOPBACK;
  }
  if (PRIVATE_IPV4_CIDR_RANGES.some((range) => ipv4AddressInRange(address, range))) {
    return TARGET_IP_RANGE_KIND.PRIVATE;
  }
  if (LINK_LOCAL_IPV4_CIDR_RANGES.some((range) => ipv4AddressInRange(address, range))) {
    return TARGET_IP_RANGE_KIND.LINK_LOCAL;
  }
  if (RESERVED_IPV4_CIDR_RANGES.some((range) => ipv4AddressInRange(address, range))) {
    return TARGET_IP_RANGE_KIND.RESERVED;
  }

  return undefined;
}

function classifyDeniedIpv6Address(value: string): TARGET_IP_RANGE_KIND | undefined {
  const address = parseIpv6Address(value);

  if (address === undefined) {
    return undefined;
  }
  if (LOOPBACK_IPV6_CIDR_RANGES.some((range) => ipv6AddressInRange(address, range))) {
    return TARGET_IP_RANGE_KIND.LOOPBACK;
  }
  if (PRIVATE_IPV6_CIDR_RANGES.some((range) => ipv6AddressInRange(address, range))) {
    return TARGET_IP_RANGE_KIND.PRIVATE;
  }
  if (LINK_LOCAL_IPV6_CIDR_RANGES.some((range) => ipv6AddressInRange(address, range))) {
    return TARGET_IP_RANGE_KIND.LINK_LOCAL;
  }
  if (RESERVED_IPV6_CIDR_RANGES.some((range) => ipv6AddressInRange(address, range))) {
    return TARGET_IP_RANGE_KIND.RESERVED;
  }

  return undefined;
}

function rejectionReasonForIpRange(
  kind: TARGET_IP_RANGE_KIND,
  resolved: boolean,
): TARGET_ACCESS_REJECTION_REASON {
  if (kind === TARGET_IP_RANGE_KIND.LOOPBACK) {
    return TARGET_ACCESS_REJECTION_REASON.LOCAL_HOSTNAME;
  }
  if (kind === TARGET_IP_RANGE_KIND.PRIVATE) {
    return resolved
      ? TARGET_ACCESS_REJECTION_REASON.RESOLVED_PRIVATE_IP_RANGE
      : TARGET_ACCESS_REJECTION_REASON.PRIVATE_IP_RANGE;
  }
  if (kind === TARGET_IP_RANGE_KIND.LINK_LOCAL) {
    return resolved
      ? TARGET_ACCESS_REJECTION_REASON.RESOLVED_LINK_LOCAL_IP_RANGE
      : TARGET_ACCESS_REJECTION_REASON.LINK_LOCAL_IP_RANGE;
  }

  return resolved
    ? TARGET_ACCESS_REJECTION_REASON.RESOLVED_RESERVED_IP_RANGE
    : TARGET_ACCESS_REJECTION_REASON.RESERVED_IP_RANGE;
}

function ipAddressInCidr(value: string, cidr: string): boolean {
  return ipv4AddressInCidr(value, cidr) || ipv6AddressInCidr(value, cidr);
}

function ipv4AddressInCidr(value: string, cidr: string): boolean {
  const address = parseIpv4Address(value);
  const range = parseIpv4CidrRange(cidr);

  return address !== undefined && range !== undefined && ipv4AddressInRange(address, range);
}

function ipv6AddressInCidr(value: string, cidr: string): boolean {
  const address = parseIpv6Address(value);
  const range = parseIpv6CidrRange(cidr);

  return address !== undefined && range !== undefined && ipv6AddressInRange(address, range);
}

function parseIpv4CidrRange(cidr: string): IpCidrRange | undefined {
  const [base, rawPrefixLength] = cidr.split('/');
  const prefixLength = rawPrefixLength === undefined ? 32 : Number(rawPrefixLength);

  if (base === undefined || parseIpv4Address(base) === undefined) {
    return undefined;
  }
  if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > 32) {
    return undefined;
  }

  return {
    base,
    prefixLength,
  };
}

function parseIpv6CidrRange(cidr: string): IpCidrRange | undefined {
  const [base, rawPrefixLength] = cidr.split('/');
  const prefixLength = rawPrefixLength === undefined ? 128 : Number(rawPrefixLength);

  if (base === undefined || parseIpv6Address(base) === undefined) {
    return undefined;
  }
  if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > 128) {
    return undefined;
  }

  return {
    base,
    prefixLength,
  };
}

function parseIpv4Address(value: string): number | undefined {
  const octets = value.split('.');

  if (octets.length !== 4) {
    return undefined;
  }

  let address = 0;

  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) {
      return undefined;
    }

    const parsedOctet = Number(octet);

    if (!Number.isInteger(parsedOctet) || parsedOctet < 0 || parsedOctet > 255) {
      return undefined;
    }

    address = (address << 8) + parsedOctet;
  }

  return address >>> 0;
}

function ipv4AddressInRange(address: number, range: IpCidrRange): boolean {
  const rangeBase = parseIpv4Address(range.base);

  if (rangeBase === undefined) {
    return false;
  }

  const mask = range.prefixLength === 0 ? 0 : (0xffffffff << (32 - range.prefixLength)) >>> 0;

  return (address & mask) === (rangeBase & mask);
}

function parseIpv6Address(value: string): bigint | undefined {
  const normalizedValue = normalizeHostname(value).split('%')[0] ?? '';

  if (!normalizedValue.includes(':')) {
    return undefined;
  }

  const embeddedIpv4 = extractEmbeddedIpv4(normalizedValue);
  const ipv6Value = embeddedIpv4?.ipv6Value ?? normalizedValue;
  const pieces = ipv6Value.split('::');

  if (pieces.length > 2) {
    return undefined;
  }

  const left = parseIpv6Hextets(pieces[0] ?? '');
  const right = parseIpv6Hextets(pieces[1] ?? '');

  if (left === undefined || right === undefined) {
    return undefined;
  }

  const embeddedHextets = embeddedIpv4?.hextets ?? [];
  const missingCount = 8 - left.length - right.length - embeddedHextets.length;

  if (pieces.length === 1 && missingCount !== 0) {
    return undefined;
  }
  if (pieces.length === 2 && missingCount < 0) {
    return undefined;
  }

  const hextets = [
    ...left,
    ...Array.from({ length: pieces.length === 2 ? missingCount : 0 }, () => 0),
    ...right,
    ...embeddedHextets,
  ];

  if (hextets.length !== 8) {
    return undefined;
  }

  return hextets.reduce((address, hextet) => (address << 16n) + BigInt(hextet), 0n);
}

function extractEmbeddedIpv4(value: string): { hextets: number[]; ipv6Value: string } | undefined {
  const lastColonIndex = value.lastIndexOf(':');
  const candidate = lastColonIndex === -1 ? '' : value.slice(lastColonIndex + 1);
  const ipv4Address = parseIpv4Address(candidate);

  if (ipv4Address === undefined) {
    return undefined;
  }

  return {
    hextets: [(ipv4Address >>> 16) & 0xffff, ipv4Address & 0xffff],
    ipv6Value: value.slice(0, lastColonIndex),
  };
}

function parseIpv6Hextets(value: string): number[] | undefined {
  if (value === '') {
    return [];
  }

  const hextets: number[] = [];

  for (const segment of value.split(':')) {
    if (!/^[0-9a-f]{1,4}$/i.test(segment)) {
      return undefined;
    }

    hextets.push(Number.parseInt(segment, 16));
  }

  return hextets;
}

function ipv6AddressInRange(address: bigint, range: IpCidrRange): boolean {
  const rangeBase = parseIpv6Address(range.base);

  if (rangeBase === undefined) {
    return false;
  }
  if (range.prefixLength === 0) {
    return true;
  }

  const shift = BigInt(128 - range.prefixLength);

  return (address >> shift) === (rangeBase >> shift);
}
