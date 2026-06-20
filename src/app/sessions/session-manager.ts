import type {
  GatewayExecutionContext,
  ProxyIdentityRequirements,
  ProxyProviderInstance,
  ProxySessionRecord,
  ProxySessionStorePort,
} from '../../ports/outbound';
import type { ISessionKeyDerivation } from './session-key-factory';
import { SessionKeyFactory } from './session-key-factory';

export enum SESSION_MANAGER_READ_RESULT_KIND {
  HIT = 'hit',
  MISS = 'miss',
  REQUEST_NEW_IDENTITY = 'request-new-identity',
}

export interface ISessionManagerOptions {
  keyFactory?: SessionKeyFactory;
  store: ProxySessionStorePort;
}

export interface ISessionManagerReadInput {
  cleanupExpired?: boolean;
  context: GatewayExecutionContext;
  identity?: ProxyIdentityRequirements;
  now: Date;
  providers: ProxyProviderInstance[];
  targetUrl: string;
}

export interface ISessionManagerReadResult {
  key?: string;
  kind: SESSION_MANAGER_READ_RESULT_KIND;
  providerInstanceId?: string;
  providerKind?: string;
  record?: ProxySessionRecord;
}

interface IDerivedSessionKey {
  key: string;
}

export class SessionManager {
  readonly #keyFactory: SessionKeyFactory;

  readonly #store: ProxySessionStorePort;

  constructor(options: ISessionManagerOptions) {
    this.#keyFactory = options.keyFactory ?? new SessionKeyFactory();
    this.#store = options.store;
  }

  async read(input: ISessionManagerReadInput): Promise<ISessionManagerReadResult> {
    if (input.identity?.requestNewIdentity === true) {
      return {
        kind: SESSION_MANAGER_READ_RESULT_KIND.REQUEST_NEW_IDENTITY,
      };
    }

    const derivedKeys = this.#deriveKeys(input);
    const records = await this.#store.getMany(derivedKeys.map((derivedKey) => derivedKey.key));
    const expiredKeys: string[] = [];
    const enabledProviderIds = new Set(
      input.providers
        .filter((provider) => provider.enabled !== false)
        .map((provider) => provider.id),
    );
    let hit: ISessionManagerReadResult | undefined;

    for (const record of records) {
      if (record.expiresAt.getTime() <= input.now.getTime()) {
        expiredKeys.push(record.key);
        continue;
      }
      if (!enabledProviderIds.has(record.providerInstanceId)) {
        continue;
      }

      hit = {
        key: record.key,
        kind: SESSION_MANAGER_READ_RESULT_KIND.HIT,
        providerInstanceId: record.providerInstanceId,
        providerKind: record.providerKind,
        record,
      };
      break;
    }

    if (input.cleanupExpired === true && expiredKeys.length > 0) {
      await this.#store.deleteMany(expiredKeys);
    }

    return hit ?? {
      kind: SESSION_MANAGER_READ_RESULT_KIND.MISS,
    };
  }

  #deriveKeys(input: ISessionManagerReadInput): IDerivedSessionKey[] {
    const providerIds = [
      undefined,
      ...input.providers.map((provider) => provider.id),
    ];
    const seenKeys = new Set<string>();
    const derivedKeys: IDerivedSessionKey[] = [];

    for (const providerInstanceId of providerIds) {
      const derivation = this.#keyFactory.derive({
        context: input.context,
        ...(input.identity === undefined ? {} : { identity: input.identity }),
        ...(providerInstanceId === undefined ? {} : { providerInstanceId }),
        targetUrl: input.targetUrl,
      });

      if (!seenKeys.has(derivation.key)) {
        seenKeys.add(derivation.key);
        derivedKeys.push(toDerivedSessionKey(derivation));
      }
    }

    return derivedKeys;
  }
}

function toDerivedSessionKey(derivation: ISessionKeyDerivation): IDerivedSessionKey {
  return {
    key: derivation.key,
  };
}
