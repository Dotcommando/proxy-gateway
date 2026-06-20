export const WIRE_PROTOCOL_VERSION = 'proxy-fetch.v1';

export const DEFAULT_TIMEOUT_MS = 360_000;

export const BODY_ENCODING_BASE64 = 'base64';

export const BODY_KIND_TEXT = 'text';

export const BODY_KIND_BINARY = 'binary';

export const BODY_KIND_BASE64 = 'base64';

export const BINARY_BODY_PART_NAME = 'body';

export const METADATA_PART_NAME = 'meta';

export const BINARY_BODY_TRANSPORT_MULTIPART = 'multipart';

export const BINARY_BODY_TRANSPORT_JSON_BASE64 = 'json-base64';

export const SERVICE_REQUEST_TRANSPORT_JSON = 'json';

export const SERVICE_REQUEST_TRANSPORT_MULTIPART = 'multipart';

export const SERVICE_HTTP_METHOD = 'POST';

export const JSON_CONTENT_TYPE = 'application/json';

export const MULTIPART_CONTENT_TYPE_PREFIX = 'multipart/form-data';

export const SERVICE_ACCEPT_HEADER_VALUE = `${JSON_CONTENT_TYPE}, ${MULTIPART_CONTENT_TYPE_PREFIX}`;

export const TEXT_CONTENT_TYPE_PREFIX = 'text/';

export const FORM_URLENCODED_CONTENT_TYPE = 'application/x-www-form-urlencoded';

export const XML_CONTENT_TYPE = 'application/xml';

export const GRAPHQL_CONTENT_TYPE = 'application/graphql';

export const ACCEPT_HEADER_NAME = 'accept';

export const AUTHORIZATION_HEADER_NAME = 'authorization';

export const CONTENT_TYPE_HEADER_NAME = 'content-type';

export const AUTHORIZATION_BEARER_PREFIX = 'Bearer ';

export const HEADER_PAIR_LENGTH = 2;

export const SERVICE_HTTP_ERROR_CODE = 'SERVICE_HTTP_ERROR';

export const INVALID_SERVICE_RESPONSE_CODE = 'INVALID_SERVICE_RESPONSE';

export const STREAMING_MULTIPART_BOUNDARY_PREFIX = 'proxy-fetch-stream';

export const OCTET_STREAM_CONTENT_TYPE = 'application/octet-stream';

export const GATEWAY_TIMEOUT_MESSAGE = 'Gateway request timed out.';

export const TARGET_TIMEOUT_MESSAGE = 'Target request timed out.';

export const REQUEST_ABORTED_MESSAGE = 'Request was aborted.';

export const TARGET_ACCESS_DENIED_MESSAGE = 'Target access is denied by gateway policy.';

export const PIPELINE_WHEN_NOT_MATCHED_REASON = 'pipeline-when-not-matched';

export const REDACTED_VALUE = '<redacted>';

export const DEFAULT_REDACTED_HEADER_NAMES = [
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
] as const;

export const DEFAULT_REDACTED_QUERY_PARAM_NAMES = [
  'access_token',
  'api_key',
  'key',
  'password',
  'secret',
  'token',
] as const;

export const DEFAULT_REDACTED_METADATA_KEY_NAMES = [
  'access_token',
  'api_key',
  'authorization',
  'cookie',
  'key',
  'password',
  'proxy_authorization',
  'secret',
  'set_cookie',
  'token',
  'x_api_key',
  'x_auth_token',
] as const;

export const DEFAULT_ALLOWED_TARGET_SCHEMES = ['http:', 'https:'] as const;

export interface IpCidrRange {
  base: string;
  prefixLength: number;
}

export const LOOPBACK_IPV4_CIDR_RANGES: readonly IpCidrRange[] = [
  { base: '0.0.0.0', prefixLength: 8 },
  { base: '127.0.0.0', prefixLength: 8 },
] as const;

export const PRIVATE_IPV4_CIDR_RANGES: readonly IpCidrRange[] = [
  { base: '10.0.0.0', prefixLength: 8 },
  { base: '100.64.0.0', prefixLength: 10 },
  { base: '172.16.0.0', prefixLength: 12 },
  { base: '192.168.0.0', prefixLength: 16 },
] as const;

export const LINK_LOCAL_IPV4_CIDR_RANGES: readonly IpCidrRange[] = [
  { base: '169.254.0.0', prefixLength: 16 },
] as const;

export const RESERVED_IPV4_CIDR_RANGES: readonly IpCidrRange[] = [
  { base: '224.0.0.0', prefixLength: 4 },
  { base: '240.0.0.0', prefixLength: 4 },
] as const;

export const DENIED_IPV4_CIDR_RANGES: readonly IpCidrRange[] = [
  ...LOOPBACK_IPV4_CIDR_RANGES,
  ...PRIVATE_IPV4_CIDR_RANGES,
  ...LINK_LOCAL_IPV4_CIDR_RANGES,
  ...RESERVED_IPV4_CIDR_RANGES,
] as const;

export const LOOPBACK_IPV6_CIDR_RANGES: readonly IpCidrRange[] = [
  { base: '::', prefixLength: 128 },
  { base: '::1', prefixLength: 128 },
] as const;

export const PRIVATE_IPV6_CIDR_RANGES: readonly IpCidrRange[] = [
  { base: 'fc00::', prefixLength: 7 },
] as const;

export const LINK_LOCAL_IPV6_CIDR_RANGES: readonly IpCidrRange[] = [
  { base: 'fe80::', prefixLength: 10 },
] as const;

export const RESERVED_IPV6_CIDR_RANGES: readonly IpCidrRange[] = [
  { base: 'ff00::', prefixLength: 8 },
] as const;

export const DENIED_IPV6_CIDR_RANGES: readonly IpCidrRange[] = [
  ...LOOPBACK_IPV6_CIDR_RANGES,
  ...PRIVATE_IPV6_CIDR_RANGES,
  ...LINK_LOCAL_IPV6_CIDR_RANGES,
  ...RESERVED_IPV6_CIDR_RANGES,
] as const;

export enum RESPONSE_CODE {
  EXIT_VERIFICATION_FAILED = 'EXIT_VERIFICATION_FAILED',
  GATEWAY_TIMEOUT = 'GATEWAY_TIMEOUT',
  INVALID_PROXY_FETCH_REQUEST = 'INVALID_PROXY_FETCH_REQUEST',
  NO_PROVIDER_AVAILABLE = 'NO_PROVIDER_AVAILABLE',
  NO_PLANNABLE_PROVIDER = 'NO_PLANNABLE_PROVIDER',
  NO_ROUTE_MATCHED = 'NO_ROUTE_MATCHED',
  PIPELINE_STEP_ALREADY_REGISTERED = 'PIPELINE_STEP_ALREADY_REGISTERED',
  PIPELINE_STEP_NOT_FOUND = 'PIPELINE_STEP_NOT_FOUND',
  PROXY_AUTH_ERROR = 'PROXY_AUTH_ERROR',
  PROXY_CONNECTION_ERROR = 'PROXY_CONNECTION_ERROR',
  PROXY_GEO_MISMATCH = 'PROXY_GEO_MISMATCH',
  PROXY_TIMEOUT = 'PROXY_TIMEOUT',
  PROVIDER_INSTANCE_NOT_FOUND = 'PROVIDER_INSTANCE_NOT_FOUND',
  REJECTED_BY_POLICY = 'REJECTED_BY_POLICY',
  REQUEST_ABORTED = 'REQUEST_ABORTED',
  REQUEST_BODY_NOT_REPLAYABLE = 'REQUEST_BODY_NOT_REPLAYABLE',
  RESPONSE_STREAM_ALREADY_STARTED = 'RESPONSE_STREAM_ALREADY_STARTED',
  TARGET_ACCESS_DENIED = 'TARGET_ACCESS_DENIED',
  TARGET_TIMEOUT = 'TARGET_TIMEOUT',
  TARGET_TRANSPORT_ERROR = 'TARGET_TRANSPORT_ERROR',
  TRANSPORT_NOT_CONFIGURED = 'TRANSPORT_NOT_CONFIGURED',
  UNSUPPORTED_ROUTE = 'UNSUPPORTED_ROUTE',
}

export enum PROVIDER_SELECTION_RESULT_KIND {
  NONE_ENABLED = 'none-enabled',
  NOT_FOUND = 'not-found',
  SELECTED = 'selected',
}

export enum PROXY_ATTEMPT_RESULT_OUTCOME {
  ABORTED = 'aborted',
  EXIT_VERIFICATION_FAILED = 'exit-verification-failed',
  GATEWAY_ERROR = 'gateway-error',
  GATEWAY_TIMEOUT = 'gateway-timeout',
  PROXY_AUTH_ERROR = 'proxy-auth-error',
  PROXY_CONNECTION_ERROR = 'proxy-connection-error',
  PROXY_GEO_MISMATCH = 'proxy-geo-mismatch',
  PROXY_TIMEOUT = 'proxy-timeout',
  REJECTED_BY_POLICY = 'rejected-by-policy',
  REQUEST_BODY_NOT_REPLAYABLE = 'request-body-not-replayable',
  RESPONSE_STREAM_ALREADY_STARTED = 'response-stream-already-started',
  SUCCESS = 'success',
  TARGET_HTTP_ERROR = 'target-http-error',
  TARGET_NETWORK_ERROR = 'target-network-error',
  TARGET_TIMEOUT = 'target-timeout',
  UNSUPPORTED_ROUTE = 'unsupported-route',
}

export enum RETRY_CONDITION {
  EXIT_VERIFICATION_FAILED = 'exit-verification-failed',
  GATEWAY_TIMEOUT = 'gateway-timeout',
  HTTP_403 = 'http-403',
  HTTP_407 = 'http-407',
  HTTP_408 = 'http-408',
  HTTP_409 = 'http-409',
  HTTP_425 = 'http-425',
  HTTP_429 = 'http-429',
  HTTP_500 = 'http-500',
  HTTP_502 = 'http-502',
  HTTP_503 = 'http-503',
  HTTP_504 = 'http-504',
  PROXY_AUTH_ERROR = 'proxy-auth-error',
  PROXY_CONNECTION_ERROR = 'proxy-connection-error',
  PROXY_GEO_MISMATCH = 'proxy-geo-mismatch',
  PROXY_TIMEOUT = 'proxy-timeout',
  TARGET_NETWORK_ERROR = 'target-network-error',
  TARGET_TIMEOUT = 'target-timeout',
}

export enum RETRY_DECISION_KIND {
  DO_NOT_RETRY = 'do-not-retry',
  FALLBACK_TO_NEXT_ATTEMPT = 'fallback-to-next-attempt',
  RETRY_SAME_ATTEMPT = 'retry-same-attempt',
}

export enum RETRY_DECISION_REASON {
  ATTEMPT_NOT_FOUND = 'attempt-not-found',
  IDEMPOTENCY_KEY_REQUIRED = 'idempotency-key-required',
  NO_FALLBACK_ATTEMPT_AVAILABLE = 'no-fallback-attempt-available',
  NO_RETRY_CONDITION = 'no-retry-condition',
  NON_RETRYABLE_OUTCOME = 'non-retryable-outcome',
  REQUEST_BODY_NOT_REPLAYABLE = 'request-body-not-replayable',
  RETRY_CONDITION_NOT_CONFIGURED = 'retry-condition-not-configured',
  UNSAFE_METHOD = 'unsafe-method',
}

export enum TIMEOUT_OBSERVATION_KIND {
  ATTEMPT_TIMEOUT = 'attempt-timeout',
  CALLER_ABORTED = 'caller-aborted',
  TOTAL_TIMEOUT = 'total-timeout',
}

export enum TARGET_ACCESS_RESULT_KIND {
  ALLOWED = 'allowed',
  REJECTED = 'rejected',
}

export enum TARGET_ACCESS_REJECTION_REASON {
  DENIED_CIDR_RANGE = 'denied-cidr-range',
  DENIED_HOST = 'denied-host',
  HOST_NOT_ALLOWED = 'host-not-allowed',
  INVALID_URL = 'invalid-url',
  LINK_LOCAL_IP_RANGE = 'link-local-ip-range',
  LOCAL_HOSTNAME = 'local-hostname',
  ONION_NOT_ALLOWED = 'onion-not-allowed',
  PRIVATE_IP_RANGE = 'private-ip-range',
  RESERVED_IP_RANGE = 'reserved-ip-range',
  RESOLVED_LINK_LOCAL_IP_RANGE = 'resolved-link-local-ip-range',
  RESOLVED_PRIVATE_IP_RANGE = 'resolved-private-ip-range',
  RESOLVED_RESERVED_IP_RANGE = 'resolved-reserved-ip-range',
  UNSUPPORTED_SCHEME = 'unsupported-scheme',
}

export enum STRING_MATCHER_KIND {
  EXACT = 'exact',
  GLOB = 'glob',
  PREFIX = 'prefix',
  REGEXP = 'regexp',
  SUFFIX = 'suffix',
}

export enum ROUTE_SELECTION_RESULT_KIND {
  DEFAULT = 'default',
  MATCHED = 'matched',
  NO_MATCH = 'no-match',
}

export enum PIPELINE_PHASE {
  ENRICH = 'enrich',
  MATCH = 'match',
  PLAN = 'plan',
  RANK = 'rank',
  REQUIRE = 'require',
  SELECT = 'select',
  VERIFY = 'verify',
}

export enum PIPELINE_DECISION_KIND {
  CONTINUE = 'continue',
  REJECT = 'reject',
  SKIP_PIPELINE = 'skip-pipeline',
  USE_PLAN = 'use-plan',
}

export enum PIPELINE_RESULT_KIND {
  COMPLETED = 'completed',
  PLAN_SELECTED = 'plan-selected',
  REJECTED = 'rejected',
  SKIPPED = 'skipped',
  STEP_NOT_FOUND = 'step-not-found',
}

export enum PLANNER_RESULT_KIND {
  PLANNED = 'planned',
  REJECTED = 'rejected',
}

export enum PROXY_PLAN_KIND {
  FALLBACK = 'fallback',
}

export enum PROXY_PROTOCOL {
  HTTP = 'http',
  HTTPS = 'https',
  SOCKS4 = 'socks4',
  SOCKS5 = 'socks5',
  SOCKS5H = 'socks5h',
}

export enum PROXY_DNS_MODE {
  ANY = 'any',
  GATEWAY = 'gateway',
  PROXY = 'proxy',
}

export enum PROXY_NETWORK_TYPE {
  CUSTOM = 'custom',
  DATACENTER = 'datacenter',
  DIRECT = 'direct',
  ISP = 'isp',
  MOBILE = 'mobile',
  RESIDENTIAL = 'residential',
  STATIC_RESIDENTIAL = 'static-residential',
  TOR = 'tor',
}

export enum PROXY_ROUTE_KIND {
  CUSTOM_TRANSPORT = 'custom-transport',
  DIRECT = 'direct',
  FORWARD_PROXY = 'forward-proxy',
  ROUTE_CHAIN = 'route-chain',
}

export enum PROXY_ROUTE_HOP_KIND {
  CUSTOM_TRANSPORT = 'custom-transport-hop',
  FORWARD_PROXY = 'forward-proxy-hop',
  TOR_CLIENT = 'tor-client-hop',
}

export enum PROXY_ROUTE_AUTH_MODE {
  IP_WHITELIST = 'ip-whitelist',
  NONE = 'none',
  TOKEN = 'token',
  USERNAME_PASSWORD = 'username-password',
}
