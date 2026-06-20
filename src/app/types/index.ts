import type { ProxyProviderInstance, RandomPort, TargetTransportPort } from '../../ports/outbound';

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
  allowLocalhost?: boolean;
  allowOnionTargets?: boolean;
  allowPrivateNetworks?: boolean;
  allowedSchemes?: string[];
}
