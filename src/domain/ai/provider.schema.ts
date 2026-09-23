import { z } from "zod";

export const providerKindSchema = z.enum(["OPENAI", "GEMINI", "ANTHROPIC", "OPENAI_COMPATIBLE"]);
export type ProviderKind = z.infer<typeof providerKindSchema>;

export const aiRoleSchema = z.enum(["TASK_CONTEXT", "ESSAY_FEEDBACK"]);
export type AiRole = z.infer<typeof aiRoleSchema>;

export const capabilityStateSchema = z.enum(["SUPPORTED", "UNSUPPORTED", "UNKNOWN"]);
export type CapabilityState = z.infer<typeof capabilityStateSchema>;

export const aiConfigurationSourceSchema = z.enum(["UI", "ENV_DEV"]);
export type AiConfigurationSource = z.infer<typeof aiConfigurationSourceSchema>;
