import type { StoragePort, StorageTransaction } from "../ports/storage.port";

type Collections = Map<string, Map<string, unknown>>;

function cloneCollections(source: Collections): Collections {
  return new Map([...source].map(([name, values]) => [name, new Map([...values].map(([id, value]) => [id, structuredClone(value)]))]));
}

export class InMemoryStorageFake implements StoragePort {
  private collections: Collections = new Map();

  put(collection: string, id: string, value: unknown): void {
    const values = this.collections.get(collection) ?? new Map<string, unknown>();
    values.set(id, structuredClone(value));
    this.collections.set(collection, values);
  }

  get(collection: string, id: string): unknown {
    const value = this.collections.get(collection)?.get(id);
    return value === undefined ? undefined : structuredClone(value);
  }

  async transaction<T>(work: (transaction: StorageTransaction) => Promise<T> | T): Promise<T> {
    const original = this.collections;
    this.collections = cloneCollections(original);
    try {
      return await work(this);
    } catch (error) {
      this.collections = original;
      throw error;
    }
  }
}
