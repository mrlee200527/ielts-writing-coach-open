import { stableHash } from "../shared/hash";

import type { InvocationSnapshotInput } from "./invocation-snapshot.schema";
import { verificationFingerprintInputSchema, type VerificationFingerprintInput } from "./verification.schema";

export type VerificationFingerprint = `sha256:${string}`;

export function createVerificationFingerprint(input: VerificationFingerprintInput): VerificationFingerprint {
  return stableHash(verificationFingerprintInputSchema.parse(input)) as VerificationFingerprint;
}

export function createInvocationFingerprint(input: InvocationSnapshotInput): VerificationFingerprint {
  return stableHash({
    providerKind: input.providerKind,
    connectionId: input.connectionId,
    configRevision: input.configRevision,
    normalizedEndpoint: input.normalizedEndpoint,
    secretRevision: input.secretRevision,
    secretRef: input.secretRef,
    requestedModelId: input.requestedModelId,
    role: input.role,
    verificationId: input.verificationId,
    verificationFingerprint: input.verificationFingerprint,
    canonicalSchemaVersion: input.canonicalSchemaVersion,
    promptVersion: input.promptVersion,
    fixtureVersion: input.fixtureVersion,
    adapterContractVersion: input.adapterContractVersion,
  }) as VerificationFingerprint;
}
