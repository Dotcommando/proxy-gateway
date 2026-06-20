import type {
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

      return record === undefined ? [] : [record];
    });
  }

  async setMany(records: ProxySessionRecord[]): Promise<void> {
    for (const record of records) {
      this.#records.set(record.key, record);
    }
  }

  async touchMany(touches: ProxySessionTouch[]): Promise<void> {
    for (const touch of touches) {
      const record = this.#records.get(touch.key);

      if (record !== undefined) {
        this.#records.set(touch.key, {
          ...record,
          expiresAt: touch.expiresAt,
        });
      }
    }
  }
}
