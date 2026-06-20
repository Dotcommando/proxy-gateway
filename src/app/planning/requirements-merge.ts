import type {
  ProxyDnsRequirements,
  ProxyGeoRequirements,
  ProxyIdentityRequirements,
  ProxyRouteRequirements,
  ProxyVerificationRequirements,
} from '../../ports/outbound';
import type { ProxyPlanConfig } from './execution-planner';

export function mergeRouteRequirementsIntoPlan(
  plan: ProxyPlanConfig,
  routeRequirements: ProxyRouteRequirements | undefined,
): ProxyPlanConfig {
  if (routeRequirements === undefined) {
    return plan;
  }

  return {
    ...plan,
    attempts: plan.attempts.map((attempt) => {
      const requirements = mergeProxyRouteRequirements(routeRequirements, attempt.requirements);

      return {
        ...attempt,
        ...(requirements === undefined ? {} : { requirements }),
      };
    }),
  };
}

export function mergeProxyRouteRequirements(
  routeRequirements: ProxyRouteRequirements | undefined,
  attemptRequirements: ProxyRouteRequirements | undefined,
): ProxyRouteRequirements | undefined {
  if (routeRequirements === undefined) {
    return attemptRequirements;
  }
  if (attemptRequirements === undefined) {
    return routeRequirements;
  }

  const dns = mergeDnsRequirements(routeRequirements.dns, attemptRequirements.dns);
  const geo = mergeGeoRequirements(routeRequirements.geo, attemptRequirements.geo);
  const identity = mergeIdentityRequirements(routeRequirements.identity, attemptRequirements.identity);
  const verification = mergeVerificationRequirements(routeRequirements.verification, attemptRequirements.verification);

  return {
    ...routeRequirements,
    ...attemptRequirements,
    ...(dns === undefined ? {} : { dns }),
    ...(geo === undefined ? {} : { geo }),
    ...(identity === undefined ? {} : { identity }),
    ...(verification === undefined ? {} : { verification }),
  };
}

function mergeDnsRequirements(
  routeRequirements: ProxyDnsRequirements | undefined,
  attemptRequirements: ProxyDnsRequirements | undefined,
): ProxyDnsRequirements | undefined {
  return mergeOptionalRequirements(routeRequirements, attemptRequirements);
}

function mergeGeoRequirements(
  routeRequirements: ProxyGeoRequirements | undefined,
  attemptRequirements: ProxyGeoRequirements | undefined,
): ProxyGeoRequirements | undefined {
  return mergeOptionalRequirements(routeRequirements, attemptRequirements);
}

function mergeIdentityRequirements(
  routeRequirements: ProxyIdentityRequirements | undefined,
  attemptRequirements: ProxyIdentityRequirements | undefined,
): ProxyIdentityRequirements | undefined {
  return mergeOptionalRequirements(routeRequirements, attemptRequirements);
}

function mergeVerificationRequirements(
  routeRequirements: ProxyVerificationRequirements | undefined,
  attemptRequirements: ProxyVerificationRequirements | undefined,
): ProxyVerificationRequirements | undefined {
  return mergeOptionalRequirements(routeRequirements, attemptRequirements);
}

function mergeOptionalRequirements<TRequirement>(
  routeRequirements: TRequirement | undefined,
  attemptRequirements: TRequirement | undefined,
): TRequirement | undefined {
  if (routeRequirements === undefined) {
    return attemptRequirements;
  }
  if (attemptRequirements === undefined) {
    return routeRequirements;
  }

  return {
    ...routeRequirements,
    ...attemptRequirements,
  };
}
