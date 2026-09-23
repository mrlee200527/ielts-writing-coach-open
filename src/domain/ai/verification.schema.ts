import { z } from "zod";

import { aiRoleSchema, providerKindSchema } from "./provider.schema";

export const verificationStateSchema = z.enum(["UNVERIFIED", "VERIFYING", "VERIFIED", "FAILED", "INCOMPATIBLE"]);
export type VerificationState = z.infer<typeof verificationStateSchema>;

export const verificationFingerprintInputSchema = z.object({
  providerKind: providerKindSchema,
  normalizedEndpoint: z.string().min(1),
  configRevision: z.number().int().positive(),
  secretRevision: z.number().int().positive(),
  modelId: z.string().min(1),
  role: aiRoleSchema,
  canonicalSchemaVersion: z.string().min(1),
  probePromptVersion: z.string().min(1),
  probeFixtureVersion: z.string().min(1),
  adapterContractVersion: z.string().min(1),
}).strict();

export type VerificationFingerprintInput = z.infer<typeof verificationFingerprintInputSchema>;
