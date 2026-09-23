import { z } from "zod";

import { uuidSchema } from "../shared/ids";

export const essayStatusSchema = z.enum(["DRAFT", "SUBMITTED", "DELETION_PENDING", "DELETED"]);

export const essaySessionSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  taskId: uuidSchema,
  status: essayStatusSchema,
  currentRevisionId: uuidSchema.optional(),
  startedAt: z.iso.datetime(),
  submittedAt: z.iso.datetime().optional(),
});

export type EssayStatus = z.infer<typeof essayStatusSchema>;
export type EssaySession = z.infer<typeof essaySessionSchema>;
