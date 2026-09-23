import type { ProviderKind } from "../domain/ai/provider.schema";

export type PutSecretInput = Readonly<{
  providerKind: ProviderKind;
  connectionId: string;
  secretRevision: number;
  secret: string;
}>;

export interface SecretStorePort {
  put(input: PutSecretInput): Promise<string>;
  read(secretRef: string): Promise<string | null>;
  delete(secretRef: string): Promise<void>;
}
