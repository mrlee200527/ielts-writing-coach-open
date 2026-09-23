import { z } from "zod";

import { uuidSchema } from "../shared/ids";

export const analysisStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "RETRYABLE_FAILED",
  "TERMINAL_FAILED",
  "CANCELLED",
  "STALE",
]);

export const analysisRunSchema = z.object({
  id: uuidSchema,
  sessionId: uuidSchema,
  revisionId: uuidSchema,
  scope: z.enum(["SENTENCE", "PARAGRAPH", "TASK_CONTEXT", "ASSESSMENT"]),
  status: analysisStatusSchema,
  promptVersion: z.string().min(1),
  inputHash: z.string().min(1),
  idempotencyKey: z.string().min(1),
  createdAt: z.iso.datetime(),
});

export type AnalysisRun = z.infer<typeof analysisRunSchema>;
