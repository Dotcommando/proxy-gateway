export { createProxyGateway, type ProxyGatewayOptions } from './app/use-cases/handle-proxy-fetch-request.use-case';
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
