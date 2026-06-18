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
  providers: ProxyProviderInstance[];
  random?: RandomPort;
  transport?: TargetTransportPort;
}
