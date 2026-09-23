import { z } from "zod";

import { uuidSchema } from "../shared/ids";

export const feedbackStateSchema = z.enum([
  "CANDIDATE",
  "DEFERRED",
  "SHOWN",
  "SUPPRESSED",
  "STALE",
  "ACTED",
  "IGNORED",
  "DISMISSED",
]);

export const feedbackItemSchema = z.object({
  id: uuidSchema,
  analysisRunId: uuidSchema,
  segmentId: uuidSchema,
  issueKey: z.string().min(1),
  category: z.string().min(1),
  state: feedbackStateSchema,
  createdAt: z.iso.datetime(),
});

export type FeedbackItem = z.infer<typeof feedbackItemSchema>;
