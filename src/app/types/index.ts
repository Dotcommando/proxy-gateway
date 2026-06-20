import type { PROXY_NETWORK_TYPE } from '../../constants';
import type { StringMatcher } from '../../domain';
import type { ProxyProviderInstance, RandomPort, TargetTransportPort } from '../../ports/outbound';
import type { RedactionPolicy } from '../redaction';

export interface BodyBufferingPolicy {
  maxBufferedRequestBodyBytes: number;
  maxBufferedResponseBodyBytes: number;
  bufferRequestStreamsForRetry: boolean;
  bufferResponsesBeforeReturn: boolean;
  rejectWhenRequestBufferExceeded: boolean;
  rejectWhenResponseBufferExceeded: boolean;
}

export interface ProxyGatewayOptions {
  bodyBuffering?: BodyBufferingPolicy;
  providerSelection?: ProviderSelectionConfig;
  providers: ProxyProviderInstance[];
  random?: RandomPort;
  redaction?: RedactionPolicy;
  retrySafety?: RetrySafetyPolicy;
  targetAccess?: TargetAccessPolicy;
  timeouts?: TimeoutPolicy;
  transport?: TargetTransportPort;
}

export interface ProviderSelectionConfig {
  providerInstanceId?: string;
}

export interface RetrySafetyPolicy {
  requireIdempotencyKeyForUnsafeRetries?: boolean;
  retryUnsafeMethods?: boolean;
  unsafeMethods?: string[];
}

export interface TimeoutPolicy {
  attemptTimeoutMs?: number;
  totalTimeoutMs?: number;
}

export interface TargetAccessPolicy {
  allowedHosts?: StringMatcher[];
  allowLocalhost?: boolean;
  allowOnionHosts?: boolean;
  allowLinkLocalIps?: boolean;
  allowPrivateIps?: boolean;
  allowedSchemes?: string[];
  deniedCidrs?: string[];
  deniedHosts?: StringMatcher[];
  onionRequiresNetworkType?: PROXY_NETWORK_TYPE.TOR;
}
