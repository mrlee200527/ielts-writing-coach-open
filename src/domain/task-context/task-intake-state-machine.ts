import { DomainError } from "../shared/errors";
import { z } from "zod";

export const taskIntakeStatusSchema = z.enum(["UPLOADED", "QUEUED", "PROCESSING", "READY", "DEGRADED", "FAILED"]);
export type TaskIntakeStatus = z.infer<typeof taskIntakeStatusSchema>;
export type TaskIntakeCommand = "QUEUE" | "START_PROCESSING" | "PUBLISH_READY" | "PUBLISH_DEGRADED" | "FAIL";

export function transitionTaskIntake(status: TaskIntakeStatus, command: TaskIntakeCommand): TaskIntakeStatus {
  if (status === "UPLOADED" && command === "QUEUE") return "QUEUED";
  if (status === "QUEUED" && command === "START_PROCESSING") return "PROCESSING";
  if (status === "PROCESSING" && command === "PUBLISH_READY") return "READY";
  if (status === "PROCESSING" && command === "PUBLISH_DEGRADED") return "DEGRADED";
  if (status === "PROCESSING" && command === "FAIL") return "FAILED";
  throw new DomainError("INVALID_TASK_INTAKE_TRANSITION");
}
