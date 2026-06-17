import type { ProxyProviderInstance, TargetTransportPort } from '../../ports/outbound';

export interface ProxyGatewayOptions {
  providers: ProxyProviderInstance[];
  transport?: TargetTransportPort;
}
