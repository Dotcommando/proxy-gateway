import type { PROXY_NETWORK_TYPE } from '../../constants';
import type { StringMatcher } from '../../domain';
import type { ProxyDefaultRouteConfig, ProxyRouteConfig } from '../../domain/routing';
import type {
  ProxyExitVerifierPort,
  ProxyPipelineConfig,
  ProxyPipelineStepRegistryPort,
  ProxyProviderInstance,
  ProxyRouteRequirements,
  ProxySessionStorePort,
  RandomPort,
  TargetTransportPort,
} from '../../ports/outbound';
import type { ProxyPlanConfig } from '../planning';
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
  defaultRoute?: ProxyDefaultRouteConfig<ProxyPlanConfig, ProxyRouteRequirements>;
  exitVerifier?: ProxyExitVerifierPort;
  plan?: ProxyPlanConfig;
  pipelines?: ProxyPipelineConfig[];
  providerSelection?: ProviderSelectionConfig;
  providers: ProxyProviderInstance[];
  random?: RandomPort;
  redaction?: RedactionPolicy;
  retrySafety?: RetrySafetyPolicy;
  routes?: Array<ProxyRouteConfig<ProxyPlanConfig, ProxyRouteRequirements>>;
  sessionStore?: ProxySessionStorePort;
  stepRegistry?: ProxyPipelineStepRegistryPort;
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
