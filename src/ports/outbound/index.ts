import {
  PIPELINE_DECISION_KIND,
  PROXY_ATTEMPT_RESULT_OUTCOME,
  PROXY_DNS_MODE,
  PROXY_NETWORK_TYPE,
  PROXY_PLAN_KIND,
  PROXY_PROTOCOL,
} from '../../constants';

export interface GatewayExecutionContext {
  tenantId?: string;
  useCase?: string;
  flowKey?: string;
  consistency?: string;
  routeKey?: string;
  marketCountry?: string;
  metadata?: Record<string, unknown>;
}

export interface GatewayFetchMetadata {
  mode?: RequestMode;
  credentials?: RequestCredentials;
  cache?: RequestCache;
  redirect?: RequestRedirect;
  referrer?: string;
  referrerPolicy?: ReferrerPolicy;
  integrity?: string;
  keepalive?: boolean;
  duplex?: 'half';
}

export type GatewayBody =
  | { kind: 'none'; replayability: 'replayable' }
  | { kind: 'text'; replayability: 'replayable'; text: string }
  | { bytes: Uint8Array; kind: 'bytes'; replayability: 'replayable' | 'buffered-replayable' }
  | {
      kind: 'stream';
      replayability: 'non-replayable' | 'buffered-replayable';
      sizeBytes?: number;
      stream: ReadableStream<Uint8Array>;
    };

export interface GatewayTargetRequest {
  url: string;
  method: string;
  headers: Array<[string, string]>;
  body: GatewayBody;
  fetch: GatewayFetchMetadata;
}

export type ProxyProtocol = PROXY_PROTOCOL | (string & {});

export type ProxyDnsMode = PROXY_DNS_MODE | (string & {});

export type ProxyNetworkType = PROXY_NETWORK_TYPE | (string & {});

export interface ProxyDnsRequirements {
  forbidLocalDnsLeak?: boolean;
  resolution: ProxyDnsMode;
}

export interface ProxyRouteRequirements {
  dns?: ProxyDnsRequirements;
  excludeProviderInstanceIds?: string[];
  networkTypes?: ProxyNetworkType[];
  protocols?: ProxyProtocol[];
  providerInstanceIds?: string[];
  [requirementName: string]: unknown;
}

export interface GatewayFacts {
  client?: {
    country?: string;
    ip?: string;
  };
  custom?: Record<string, unknown>;
  proxyExit?: {
    asn?: number;
    country?: string;
    ip?: string;
    isTor?: boolean;
  };
  target?: {
    asns?: number[];
    countries?: string[];
    host?: string;
    isOnion?: boolean;
    primaryCountry?: string;
    resolvedIps?: string[];
  };
}

export interface ProxyProviderCandidate {
  capabilities?: ProxyProviderCapabilities;
  metadata?: Record<string, unknown>;
  priority?: number;
  providerInstanceId: string;
  providerKind: string;
  weight?: number;
}

export interface ProxyExecutionAttempt {
  capabilities?: ProxyProviderCapabilities;
  maxAttempts?: number;
  metadata?: Record<string, unknown>;
  providerInstanceId: string;
  providerKind?: string;
  requirements?: ProxyRouteRequirements;
  timeoutMs?: number;
}

export interface ProxyExecutionPlan {
  attempts: ProxyExecutionAttempt[];
  kind: PROXY_PLAN_KIND;
  metadata?: Record<string, unknown>;
  stopOnTargetHttpError?: boolean;
  totalTimeoutMs?: number;
}

export interface GatewayEvent {
  message?: string;
  metadata?: Record<string, unknown>;
  type: string;
}

export interface ProxyDecisionState {
  candidates: ProxyProviderCandidate[];
  context: GatewayExecutionContext;
  facts: GatewayFacts;
  metadata: Record<string, unknown>;
  plan?: ProxyExecutionPlan;
  requirements: ProxyRouteRequirements;
  target: GatewayTargetRequest;
}

export interface ProxyDecisionStatePatch {
  candidates?: ProxyProviderCandidate[];
  context?: Partial<GatewayExecutionContext>;
  facts?: Partial<GatewayFacts>;
  metadata?: Record<string, unknown>;
  plan?: ProxyExecutionPlan;
  requirements?: ProxyRouteRequirements;
  target?: GatewayTargetRequest;
}

export interface ProxyPipelineStepConfig {
  args?: Record<string, unknown>;
  use: string;
}

export interface ProxyPipelineConfig {
  enrich?: ProxyPipelineStepConfig[];
  id: string;
  match?: ProxyPipelineStepConfig[];
  plan: ProxyPipelineStepConfig[];
  priority?: number;
  rank?: ProxyPipelineStepConfig[];
  require?: ProxyPipelineStepConfig[];
  select?: ProxyPipelineStepConfig[];
  verify?: ProxyPipelineStepConfig[];
}

export type ProxyPipelineDecision =
  | {
      kind: PIPELINE_DECISION_KIND.CONTINUE;
    }
  | {
      code: string;
      kind: PIPELINE_DECISION_KIND.REJECT;
      message: string;
      status?: number;
    }
  | {
      kind: PIPELINE_DECISION_KIND.USE_PLAN;
      plan: ProxyExecutionPlan;
    }
  | {
      kind: PIPELINE_DECISION_KIND.SKIP_PIPELINE;
      reason?: string;
    };

export interface ProxyGatewayServices {
  [serviceName: string]: unknown;
}

export interface ProxyPipelineStepInput {
  args: Record<string, unknown>;
  requestId: string;
  services: ProxyGatewayServices;
  signal: AbortSignal;
  state: ProxyDecisionState;
}

export interface ProxyPipelineStepResult {
  decision?: ProxyPipelineDecision;
  events?: GatewayEvent[];
  statePatch?: ProxyDecisionStatePatch;
}

export interface ProxyPipelineStep {
  readonly type: string;
  execute(input: ProxyPipelineStepInput): Promise<ProxyPipelineStepResult>;
}

export interface ProxyPipelineStepRegistryPort {
  get(type: string): ProxyPipelineStep | undefined;
}

export interface GatewayTargetResponse {
  url?: string;
  status: number;
  statusText: string;
  redirected?: boolean;
  type?: ResponseType;
  headers: Array<[string, string]>;
  body: GatewayBody;
}

export interface DirectRoute {
  kind: 'direct';
}

export type ProxyRoute = DirectRoute;

export interface ProxyLease {
  id: string;
  providerInstanceId: string;
  providerKind: string;
  route: ProxyRoute;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface ProxyAttemptContext {
  index: number;
}

export interface ProxyAttemptResult {
  outcome: PROXY_ATTEMPT_RESULT_OUTCOME;
  response?: GatewayTargetResponse;
  error?: {
    code: string;
    message: string;
  };
}

export interface ProxyAcquireInput {
  requestId: string;
  providerInstanceId: string;
  attempt: ProxyAttemptContext;
  target: GatewayTargetRequest;
  requirements: Record<string, unknown>;
  context: GatewayExecutionContext;
  signal: AbortSignal;
}

export interface ProxyProviderDnsCapabilities {
  modes?: ProxyDnsMode[];
  remoteRequired?: boolean;
}

export interface ProxyProviderCapabilities {
  dns?: ProxyProviderDnsCapabilities;
  networkTypes?: ProxyNetworkType[];
  protocols?: ProxyProtocol[];
  [capabilityName: string]: unknown;
}

export interface ProxyProviderAdapter {
  readonly kind: string;
  getCapabilities(): ProxyProviderCapabilities | Promise<ProxyProviderCapabilities>;
  acquire(input: ProxyAcquireInput): Promise<ProxyLease>;
  release?(lease: ProxyLease, result: ProxyAttemptResult): void | Promise<void>;
}

export interface ProxyProviderInstance {
  id: string;
  adapter: ProxyProviderAdapter;
  enabled?: boolean;
  weight?: number;
  priority?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface RandomPort {
  createId(): string;
}

export interface TargetTransportExecuteInput {
  requestId: string;
  target: GatewayTargetRequest;
  route: ProxyRoute;
  signal: AbortSignal;
}

export interface TargetTransportPort {
  execute(input: TargetTransportExecuteInput): Promise<GatewayTargetResponse>;
}
