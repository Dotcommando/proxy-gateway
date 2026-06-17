import type { ProxyGateway } from '../ports/inbound';
import type { ProxyGatewayOptions } from './types';
import { HandleProxyFetchRequestUseCase } from './use-cases/handle-proxy-fetch-request.use-case';

export function createProxyGateway(options: ProxyGatewayOptions): ProxyGateway {
  return new HandleProxyFetchRequestUseCase(options);
}
