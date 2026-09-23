import { randomUUID } from "node:crypto";

import type { PutSecretInput, SecretStorePort } from "../ports/secret-store.port";

export class FakeSecretStore implements SecretStorePort {
  readonly #secrets = new Map<string, string>();

  async put(input: PutSecretInput): Promise<string> {
    const secretRef = `fake-secret://${randomUUID()}`;
    this.#secrets.set(secretRef, input.secret);
    return secretRef;
  }

  async read(secretRef: string): Promise<string | null> {
    return this.#secrets.get(secretRef) ?? null;
  }

  async delete(secretRef: string): Promise<void> {
    this.#secrets.delete(secretRef);
  }
}
