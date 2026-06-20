import type {
  ProxyIdentityRequirements,
  ProxySessionRecord,
  ProxySessionStorePort,
  ProxySessionTouch,
} from '../../ports/outbound';

export function createMemoryProxySessionStore(): ProxySessionStorePort {
  return new MemoryProxySessionStore();
}

class MemoryProxySessionStore implements ProxySessionStorePort {
  readonly #records = new Map<string, ProxySessionRecord>();

  async deleteMany(keys: string[]): Promise<void> {
    for (const key of keys) {
      this.#records.delete(key);
    }
  }

  async getMany(keys: string[]): Promise<ProxySessionRecord[]> {
    return keys.flatMap((key) => {
      const record = this.#records.get(key);

      return record === undefined ? [] : [cloneRecord(record)];
    });
  }

  async setMany(records: ProxySessionRecord[]): Promise<void> {
    for (const record of records) {
      this.#records.set(record.key, cloneRecord(record));
    }
  }

  async touchMany(touches: ProxySessionTouch[]): Promise<void> {
    for (const touch of touches) {
      const record = this.#records.get(touch.key);

      if (record !== undefined) {
        this.#records.set(touch.key, cloneRecord({
          ...record,
          expiresAt: touch.expiresAt,
        }));
      }
    }
  }
}

function cloneRecord(record: ProxySessionRecord): ProxySessionRecord {
  return {
    expiresAt: new Date(record.expiresAt.getTime()),
    key: record.key,
    providerInstanceId: record.providerInstanceId,
    providerKind: record.providerKind,
    ...(record.identity === undefined ? {} : { identity: cloneIdentity(record.identity) }),
    ...(record.metadata === undefined ? {} : { metadata: { ...record.metadata } }),
  };
}

function cloneIdentity(identity: ProxyIdentityRequirements): ProxyIdentityRequirements {
  return {
    ...identity,
    ...(identity.isolationScope === undefined
      ? {}
      : { isolationScope: [...identity.isolationScope] }),
  };
}
