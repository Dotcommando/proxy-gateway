import { PROXY_ROUTE_KIND } from '../../constants';
import type {
  ForwardProxyRoute,
  ProxyRoute,
  ProxyRouteAuth,
  ProxyRouteHop,
  RouteChain,
} from '../../ports/outbound';

export type RouteDiagnostic = Record<string, unknown>;

export function createRouteDiagnostic(route: ProxyRoute): RouteDiagnostic {
  if (route.kind === PROXY_ROUTE_KIND.FORWARD_PROXY) {
    return createForwardProxyRouteDiagnostic(route);
  }
  if (route.kind === PROXY_ROUTE_KIND.ROUTE_CHAIN) {
    return createRouteChainDiagnostic(route);
  }

  return {
    kind: route.kind,
  };
}

function createForwardProxyRouteDiagnostic(route: ForwardProxyRoute): RouteDiagnostic {
  return removeUndefinedValues({
    auth: route.auth === undefined ? undefined : createRouteAuthDiagnostic(route.auth),
    dns: route.dns,
    host: route.host,
    kind: route.kind,
    port: route.port,
    protocol: route.protocol,
  });
}

function createRouteChainDiagnostic(route: RouteChain): RouteDiagnostic {
  return removeUndefinedValues({
    dns: route.dns,
    hops: route.hops.map(createRouteHopDiagnostic),
    kind: route.kind,
  });
}

function createRouteHopDiagnostic(hop: ProxyRouteHop): RouteDiagnostic {
  if ('host' in hop) {
    return removeUndefinedValues({
      auth: hop.auth === undefined ? undefined : createRouteAuthDiagnostic(hop.auth),
      dns: hop.dns,
      host: hop.host,
      kind: hop.kind,
      port: hop.port,
      protocol: hop.protocol,
    });
  }

  return {
    kind: hop.kind,
  };
}

function createRouteAuthDiagnostic(auth: ProxyRouteAuth): RouteDiagnostic {
  return {
    mode: auth.mode,
  };
}

function removeUndefinedValues(value: RouteDiagnostic): RouteDiagnostic {
  return Object.fromEntries(Object.entries(value).filter((entry) => entry[1] !== undefined));
}
