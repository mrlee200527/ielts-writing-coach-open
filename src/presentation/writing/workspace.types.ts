import { z } from "zod";

export const createEssayRequestSchema = z.object({ clientRequestId: z.string().min(1), promptText: z.string().min(1), taskType: z.enum(["TASK_1", "TASK_2"]).default("TASK_1"), txtFileName: z.string().min(1).optional() });
export const saveDraftRequestSchema = z.object({
  expectedRevisionId: z.uuid(), plainText: z.string(), content: z.unknown(), clientMutationId: z.string().min(1),
  timer: z.object({ elapsedMs: z.number().nonnegative(), runningSince: z.iso.datetime().optional() }),
});
