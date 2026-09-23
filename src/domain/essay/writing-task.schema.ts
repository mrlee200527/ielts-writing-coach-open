import { z } from "zod";
import { uuidSchema } from "../shared/ids";
import { allowedTaskImageTypes } from "../../ports/blob.port";
import { taskIntakeStatusSchema } from "../task-context/task-intake-state-machine";

export const writingTaskSchema = z.object({
  id: uuidSchema,
  promptText: z.string().min(1),
  txtFileName: z.string().min(1).nullable().default(null),
  imagePlaceholderKind: z.enum(["TASK_1_PENDING", "TASK_2_NOT_REQUIRED"]),
  imageBlobId: uuidSchema.nullable().default(null),
  imageMediaType: z.enum(allowedTaskImageTypes).nullable().default(null),
  imageSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  intakeStatus: taskIntakeStatusSchema.nullable().default(null),
  activeAttemptId: uuidSchema.nullable().default(null),
  currentTaskContextVersionId: uuidSchema.nullable().default(null),
});

export type WritingTask = z.infer<typeof writingTaskSchema>;
