export interface StorageTransaction {
  put(collection: string, id: string, value: unknown): void;
  get(collection: string, id: string): unknown;
}

export interface StoragePort extends StorageTransaction {
  transaction<T>(work: (transaction: StorageTransaction) => Promise<T> | T): Promise<T>;
}
