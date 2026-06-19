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

export enum RESPONSE_CODE {
  EXIT_VERIFICATION_FAILED = 'EXIT_VERIFICATION_FAILED',
  GATEWAY_TIMEOUT = 'GATEWAY_TIMEOUT',
  INVALID_PROXY_FETCH_REQUEST = 'INVALID_PROXY_FETCH_REQUEST',
  NO_PROVIDER_AVAILABLE = 'NO_PROVIDER_AVAILABLE',
  NO_PLANNABLE_PROVIDER = 'NO_PLANNABLE_PROVIDER',
  NO_ROUTE_MATCHED = 'NO_ROUTE_MATCHED',
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
