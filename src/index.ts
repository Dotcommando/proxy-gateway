export { createProxyGateway } from './app/create-proxy-gateway';
export type { ProxyGatewayOptions } from './app/types';
export type { ProxyGateway } from './ports/inbound';
export type {
  DirectRoute,
  GatewayBody,
  GatewayExecutionContext,
  GatewayFetchMetadata,
  GatewayTargetRequest,
  GatewayTargetResponse,
  ProxyAcquireInput,
  ProxyAttemptContext,
  ProxyAttemptResult,
  ProxyLease,
  ProxyProviderAdapter,
  ProxyProviderCapabilities,
  ProxyProviderInstance,
  ProxyRoute,
  TargetTransportExecuteInput,
  TargetTransportPort,
} from './ports/outbound';
