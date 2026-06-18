import type { ProxyProviderInstance, RandomPort, TargetTransportPort } from '../../ports/outbound';

export interface ProxyGatewayOptions {
  providers: ProxyProviderInstance[];
  random?: RandomPort;
  transport?: TargetTransportPort;
}
