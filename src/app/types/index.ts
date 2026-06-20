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
