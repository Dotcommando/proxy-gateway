import { RESPONSE_CODE, ROUTE_SELECTION_RESULT_KIND } from '../../constants';
import type { StringMatcher } from '../matching';
import { matchHost, matchPath, matchUrl } from '../matching';

export interface ProxyRouteMatch {
  host?: StringMatcher;
  method?: string | string[];
  path?: StringMatcher;
  url?: StringMatcher;
}

export interface ProxyRouteConfig<TPlan = unknown> {
  exclude?: ProxyRouteMatch;
  id: string;
  match: ProxyRouteMatch;
  plan: TPlan;
  priority?: number;
}

export interface ProxyDefaultRouteConfig<TPlan = unknown> {
  id: string;
  plan: TPlan;
}

export interface RouteSelectionTarget {
  method: string;
  url: string;
}

export interface RouteSelectionInput<TPlan = unknown> {
  defaultRoute?: ProxyDefaultRouteConfig<TPlan>;
  routes: Array<ProxyRouteConfig<TPlan>>;
  target: RouteSelectionTarget;
}

export type RouteSelectionResult<TPlan = unknown> =
  | {
      kind: ROUTE_SELECTION_RESULT_KIND.MATCHED;
      route: ProxyRouteConfig<TPlan>;
    }
  | {
      kind: ROUTE_SELECTION_RESULT_KIND.DEFAULT;
      route: ProxyDefaultRouteConfig<TPlan>;
    }
  | {
      code: RESPONSE_CODE.NO_ROUTE_MATCHED;
      kind: ROUTE_SELECTION_RESULT_KIND.NO_MATCH;
      message: string;
    };

export function selectRoute<TPlan>(input: RouteSelectionInput<TPlan>): RouteSelectionResult<TPlan> {
  const sortedRoutes = input.routes
    .map((route, index) => ({
      index,
      route,
    }))
    .sort((left, right) => {
      const priorityDelta = (right.route.priority ?? 0) - (left.route.priority ?? 0);

      return priorityDelta === 0 ? left.index - right.index : priorityDelta;
    });

  for (const { route } of sortedRoutes) {
    if (!matchesRoute(route.match, input.target)) {
      continue;
    }
    if (route.exclude !== undefined && matchesRoute(route.exclude, input.target)) {
      continue;
    }

    return {
      kind: ROUTE_SELECTION_RESULT_KIND.MATCHED,
      route,
    };
  }

  if (input.defaultRoute !== undefined) {
    return {
      kind: ROUTE_SELECTION_RESULT_KIND.DEFAULT,
      route: input.defaultRoute,
    };
  }

  return {
    code: RESPONSE_CODE.NO_ROUTE_MATCHED,
    kind: ROUTE_SELECTION_RESULT_KIND.NO_MATCH,
    message: 'No route matched the target request.',
  };
}

export function matchesRoute(match: ProxyRouteMatch, target: RouteSelectionTarget): boolean {
  if (match.method !== undefined && !matchesMethod(match.method, target.method)) {
    return false;
  }
  if (match.url !== undefined && !matchUrl(match.url, target.url)) {
    return false;
  }
  if (match.host !== undefined && !matchHost(match.host, target.url)) {
    return false;
  }
  if (match.path !== undefined && !matchPath(match.path, target.url)) {
    return false;
  }

  return true;
}

function matchesMethod(expected: string | string[], actual: string): boolean {
  const normalizedActual = actual.toUpperCase();
  const expectedMethods = Array.isArray(expected) ? expected : [expected];

  return expectedMethods.some((method) => method.toUpperCase() === normalizedActual);
}
