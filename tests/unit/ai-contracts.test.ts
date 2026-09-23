import { describe, expect, it } from "vitest";

import { aiConfigurationSourceSchema, aiRoleSchema, capabilityStateSchema, providerKindSchema } from "../../src/domain/ai/provider.schema";
import { createInvocationFingerprint, createVerificationFingerprint } from "../../src/domain/ai/fingerprint";
import { invocationSnapshotSchema } from "../../src/domain/ai/invocation-snapshot.schema";
import { verificationStateSchema } from "../../src/domain/ai/verification.schema";

describe("Phase 3.6 AI contracts", () => {
  it("rejects provider, role, capability, verification and configuration-source values outside the frozen contracts", () => {
    expect(providerKindSchema.options).toEqual(["OPENAI", "GEMINI", "ANTHROPIC", "OPENAI_COMPATIBLE"]);
    expect(aiRoleSchema.options).toEqual(["TASK_CONTEXT", "ESSAY_FEEDBACK"]);
    expect(capabilityStateSchema.options).toEqual(["SUPPORTED", "UNSUPPORTED", "UNKNOWN"]);
    expect(verificationStateSchema.options).toEqual(["UNVERIFIED", "VERIFYING", "VERIFIED", "FAILED", "INCOMPATIBLE"]);
    expect(aiConfigurationSourceSchema.options).toEqual(["UI", "ENV_DEV"]);
    expect(aiConfigurationSourceSchema.safeParse("ENV").success).toBe(false);
  });

  it("creates the same verification fingerprint regardless of object insertion order and changes it for every frozen dimension", () => {
    const base = {
      providerKind: "OPENAI" as const,
      normalizedEndpoint: "https://api.openai.com/v1",
      configRevision: 3,
      secretRevision: 4,
      modelId: "gpt-example-pinned",
      role: "TASK_CONTEXT" as const,
      canonicalSchemaVersion: "task-context-v1",
      probePromptVersion: "probe-v1",
      probeFixtureVersion: "fixture-v1",
      adapterContractVersion: "openai-v1",
    };
    const expected = "sha256:47686a1730725a7255a5f4b50daefc1cdcdd68484a1ae2ec5525b9b9a13b9efb";
    expect(createVerificationFingerprint(base)).toBe(expected);
    expect(createVerificationFingerprint({ ...base, modelId: "different" })).not.toBe(expected);
  });

  it("strictly parses a complete immutable invocation snapshot and rejects missing or extra routing data", () => {
    const input = {
      providerKind: "GEMINI",
      connectionId: "00000000-0000-4000-8000-000000000301",
      configRevision: 1,
      normalizedEndpoint: "https://generativelanguage.googleapis.com",
      secretRevision: 2,
      secretRef: "opaque:credential:reference",
      requestedModelId: "gemini-example-pinned",
      role: "ESSAY_FEEDBACK",
      verificationId: "00000000-0000-4000-8000-000000000302",
      verificationFingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      canonicalSchemaVersion: "essay-feedback-v1",
      promptVersion: "feedback-v1",
      fixtureVersion: "runtime",
      adapterContractVersion: "gemini-v1",
      invocationFingerprint: "sha256:e40f8014bb9fb0bea3f94794bd3e4f9dc4f9d03ffda5824c691a856300ee55e7",
    } as const;
    expect(invocationSnapshotSchema.parse(input)).toEqual(input);
    expect(invocationSnapshotSchema.safeParse({ ...input, secretRef: undefined }).success).toBe(false);
    expect(invocationSnapshotSchema.safeParse({ ...input, apiKey: "must-not-cross-contract" }).success).toBe(false);
    expect(createInvocationFingerprint(input)).toBe(input.invocationFingerprint);
  });
});
