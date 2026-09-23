import { describe, expect, it } from "vitest";

import type { SecretStorePort } from "../../src/ports/secret-store.port";
import { FakeSecretStore } from "../../src/testing/fake-secret-store";

function exerciseSecretStore(createStore: () => SecretStorePort) {
  it("keeps references opaque and supports put/read/delete without exposing the secret in the reference", async () => {
    const store = createStore();
    const secret = "phase-3-6-test-secret";
    const secretRef = await store.put({ providerKind: "OPENAI", connectionId: "connection-1", secretRevision: 1, secret });

    expect(secretRef).not.toContain(secret);
    await expect(store.read(secretRef)).resolves.toBe(secret);
    await store.delete(secretRef);
    await expect(store.read(secretRef)).resolves.toBeNull();
  });

  it("replaces only the addressed opaque reference", async () => {
    const store = createStore();
    const first = await store.put({ providerKind: "OPENAI", connectionId: "connection-1", secretRevision: 1, secret: "first" });
    const second = await store.put({ providerKind: "OPENAI", connectionId: "connection-1", secretRevision: 2, secret: "second" });
    await store.delete(first);
    await expect(store.read(second)).resolves.toBe("second");
  });
}

describe("FakeSecretStore SecretStorePort contract", () => exerciseSecretStore(() => new FakeSecretStore()));
