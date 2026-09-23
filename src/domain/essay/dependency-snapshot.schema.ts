import { z } from "zod";

import { uuidSchema } from "../shared/ids";
import { stableHash } from "../shared/hash";

export const sentenceDependencySnapshotSchema = z.object({
  segmentId: uuidSchema,
  textHash: z.string().min(1),
  boundaryHash: z.string().min(1),
  contextHash: z.string().min(1),
}).strict();

export const paragraphDependencySnapshotSchema = z.object({
  segmentId: uuidSchema,
  textHash: z.string().min(1),
  boundaryHash: z.string().min(1),
  adjacentSummaryHash: z.string().min(1),
  taskContextVersionId: uuidSchema,
  memoryProjectionVersion: z.number().int().nonnegative(),
}).strict();

export type SentenceDependencySnapshot = z.infer<typeof sentenceDependencySnapshotSchema>;
export type ParagraphDependencySnapshot = z.infer<typeof paragraphDependencySnapshotSchema>;

export function parseSentenceDependencySnapshot(input: unknown): SentenceDependencySnapshot {
  return sentenceDependencySnapshotSchema.parse(input);
}

export function parseParagraphDependencySnapshot(input: unknown): ParagraphDependencySnapshot {
  return paragraphDependencySnapshotSchema.parse(input);
}

export function canonicalSentenceDependencyHash(input: unknown): string {
  return stableHash(parseSentenceDependencySnapshot(input));
}

export function canonicalParagraphDependencyHash(input: unknown): string {
  return stableHash(parseParagraphDependencySnapshot(input));
}
