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

export interface GatewayTargetResponse {
  status: number;
  statusText: string;
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
  outcome: 'success' | 'gateway-error';
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

export type ProxyProviderCapabilities = Record<string, unknown>;

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
