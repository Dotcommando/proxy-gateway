import { PROXY_IDENTITY_ISOLATION_SCOPE } from '../../constants';
import type {
  GatewayExecutionContext,
  ProxyIdentityRequirements,
} from '../../ports/outbound';

const SESSION_KEY_VERSION = 'proxy-session-key.v1';

enum SESSION_KEY_COMPONENT_NAME {
  ATTEMPT_INDEX = 'attemptIndex',
  FLOW_KEY = 'flowKey',
  ISOLATION_KEY = 'isolationKey',
  PROVIDER_INSTANCE_ID = 'providerInstanceId',
  ROUTE_KEY = 'routeKey',
  STICKY_SESSION_ID = 'stickySessionId',
  TARGET_HOST = 'targetHost',
  TENANT_ID = 'tenantId',
}

const DEFAULT_ISOLATION_SCOPE: PROXY_IDENTITY_ISOLATION_SCOPE[] = [
  PROXY_IDENTITY_ISOLATION_SCOPE.TENANT,
  PROXY_IDENTITY_ISOLATION_SCOPE.FLOW,
  PROXY_IDENTITY_ISOLATION_SCOPE.ROUTE,
  PROXY_IDENTITY_ISOLATION_SCOPE.PROVIDER,
  PROXY_IDENTITY_ISOLATION_SCOPE.TARGET_HOST,
];

export interface ISessionKeyFactoryInput {
  attemptIndex?: number;
  context: GatewayExecutionContext;
  identity?: ProxyIdentityRequirements;
  providerInstanceId?: string;
  targetUrl: string;
}

export interface ISessionKeyComponent {
  name: string;
  value: string | null;
}

export interface ISessionKeyDerivation {
  components: ISessionKeyComponent[];
  key: string;
}

export class SessionKeyFactory {
  derive(input: ISessionKeyFactoryInput): ISessionKeyDerivation {
    const components = [
      createComponent(
        SESSION_KEY_COMPONENT_NAME.STICKY_SESSION_ID,
        input.identity?.stickySessionId,
      ),
      createComponent(
        SESSION_KEY_COMPONENT_NAME.ISOLATION_KEY,
        input.identity?.isolationKey,
      ),
      ...deriveScopedComponents(input),
    ];

    return {
      components,
      key: JSON.stringify({
        components,
        version: SESSION_KEY_VERSION,
      }),
    };
  }
}

function deriveScopedComponents(input: ISessionKeyFactoryInput): ISessionKeyComponent[] {
  return getIsolationScope(input.identity).map((scope) => {
    switch (scope) {
      case PROXY_IDENTITY_ISOLATION_SCOPE.TENANT:
        return createComponent(SESSION_KEY_COMPONENT_NAME.TENANT_ID, input.context.tenantId);

      case PROXY_IDENTITY_ISOLATION_SCOPE.FLOW:
        return createComponent(SESSION_KEY_COMPONENT_NAME.FLOW_KEY, input.context.flowKey);

      case PROXY_IDENTITY_ISOLATION_SCOPE.ROUTE:
        return createComponent(SESSION_KEY_COMPONENT_NAME.ROUTE_KEY, input.context.routeKey);

      case PROXY_IDENTITY_ISOLATION_SCOPE.PROVIDER:
        return createComponent(
          SESSION_KEY_COMPONENT_NAME.PROVIDER_INSTANCE_ID,
          input.providerInstanceId,
        );

      case PROXY_IDENTITY_ISOLATION_SCOPE.TARGET_HOST:
        return createComponent(
          SESSION_KEY_COMPONENT_NAME.TARGET_HOST,
          normalizeTargetHost(input.targetUrl),
        );

      case PROXY_IDENTITY_ISOLATION_SCOPE.ATTEMPT:
        return createComponent(SESSION_KEY_COMPONENT_NAME.ATTEMPT_INDEX, input.attemptIndex);
    }
  });
}

function getIsolationScope(
  identity: ProxyIdentityRequirements | undefined,
): PROXY_IDENTITY_ISOLATION_SCOPE[] {
  return identity?.isolationScope ?? DEFAULT_ISOLATION_SCOPE;
}

function createComponent(
  name: SESSION_KEY_COMPONENT_NAME,
  value: number | string | undefined,
): ISessionKeyComponent {
  return {
    name,
    value: value === undefined ? null : String(value),
  };
}

function normalizeTargetHost(targetUrl: string): string {
  try {
    return normalizeHost(new URL(targetUrl).hostname);
  } catch {
    return normalizeHost(targetUrl);
  }
}

function normalizeHost(host: string): string {
  let normalizedHost = host.trim().toLowerCase();

  while (normalizedHost.endsWith('.')) {
    normalizedHost = normalizedHost.slice(0, -1);
  }

  return normalizedHost;
}
