import { z } from "zod";

import { uuidSchema } from "../shared/ids";
import { taskContextLimitationCodeSchema, taskContextSchema, type TaskContext } from "./task-context.schema";

export const taskContextVersionStatusSchema = z.enum(["READY", "DEGRADED", "UNAVAILABLE"]);

export function validateResolutionStatus(
  status: z.infer<typeof taskContextVersionStatusSchema>,
  context: TaskContext | null,
): void {
  const certainCount = context?.facts.filter((fact) => fact.certainty === "CERTAIN").length ?? 0;
  const hasNonCertain = context?.facts.some((fact) => fact.certainty !== "CERTAIN") ?? false;
  const hasLimitations = (context?.limitations.length ?? 0) > 0;
  if (status === "READY" && (!context || certainCount !== context.facts.length || hasLimitations)) {
    throw new Error("READY_INCONSISTENT");
  }
  if (status === "DEGRADED" && (!context || certainCount < 1 || (!hasNonCertain && !hasLimitations))) {
    throw new Error("DEGRADED_INCONSISTENT");
  }
  if (status === "UNAVAILABLE" && context !== null) {
    throw new Error("UNAVAILABLE_INCONSISTENT");
  }
}

export const taskContextVersionSchema = z.object({
  id: uuidSchema,
  taskId: uuidSchema,
  version: z.number().int().positive(),
  status: taskContextVersionStatusSchema,
  context: taskContextSchema.nullable(),
  schemaVersion: z.literal(1),
  sourceImageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  promptVersion: z.string().min(1),
  model: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }),
  limitations: z.array(taskContextLimitationCodeSchema),
}).strict().superRefine((version, context) => {
  try {
    validateResolutionStatus(version.status, version.context);
  } catch (error) {
    context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "STATUS_INCONSISTENT" });
  }
});

export type TaskContextVersionStatus = z.infer<typeof taskContextVersionStatusSchema>;
export type TaskContextVersion = z.infer<typeof taskContextVersionSchema>;

export function parseTaskContextVersion(input: unknown): TaskContextVersion {
  return taskContextVersionSchema.parse(input);
}
