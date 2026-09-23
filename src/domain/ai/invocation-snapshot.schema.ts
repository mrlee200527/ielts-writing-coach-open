import { z } from "zod";

import { aiRoleSchema, providerKindSchema } from "./provider.schema";

const fingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const invocationSnapshotSchema = z.object({
  providerKind: providerKindSchema,
  connectionId: z.uuid(),
  configRevision: z.number().int().positive(),
  normalizedEndpoint: z.url(),
  secretRevision: z.number().int().positive(),
  secretRef: z.string().min(1),
  requestedModelId: z.string().min(1),
  role: aiRoleSchema,
  verificationId: z.uuid(),
  verificationFingerprint: fingerprintSchema,
  canonicalSchemaVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  fixtureVersion: z.string().min(1),
  adapterContractVersion: z.string().min(1),
  invocationFingerprint: fingerprintSchema,
}).strict().readonly();

export type InvocationSnapshot = z.infer<typeof invocationSnapshotSchema>;
export type InvocationSnapshotInput = z.input<typeof invocationSnapshotSchema>;
