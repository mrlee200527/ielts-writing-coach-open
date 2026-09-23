import { createHash, randomUUID } from "node:crypto";

import type { JobPort } from "../../ports/job.port";
import type { TaskIntakeRepository } from "./task-intake.repository";

export async function retryTaskIntake(
  dependencies: { repository: TaskIntakeRepository; jobs: JobPort },
  input: { taskId: string; requestIdempotencyKey: string },
) {
  const replay = await dependencies.repository.findByRequestIdempotencyKey(input.requestIdempotencyKey);
  if (replay) return replay;
  const resolution = await dependencies.repository.findResolution(input.taskId);
  if (!resolution) throw new Error("TASK_INTAKE_NOT_FOUND");
  const attemptId = randomUUID();
  const attempt = {
    id: attemptId,
    taskId: input.taskId,
    inputHash: createHash("sha256").update(JSON.stringify({ imageSha256: resolution.image.sha256, promptVersion: "task-context-v1", schemaVersion: 1 })).digest("hex"),
    idempotencyKey: input.requestIdempotencyKey,
    status: "ACTIVE" as const,
    callCount: 0,
    promptVersion: "task-context-v1",
    schemaVersion: 1 as const,
  };
  await dependencies.repository.createRetryAttempt({ taskId: input.taskId, attempt });
  const record = await dependencies.repository.findAttempt(input.taskId, attemptId);
  if (!record) throw new Error("RETRY_ATTEMPT_NOT_FOUND");
  try {
    const job = dependencies.jobs.enqueue({ name: "task-context", idempotencyKey: input.requestIdempotencyKey, payload: { taskId: input.taskId, attemptId } });
    await dependencies.repository.markQueued(input.taskId, attemptId, job.id);
  } catch {
    return (await dependencies.repository.findAttempt(input.taskId, attemptId)) ?? record;
  }
  return (await dependencies.repository.findAttempt(input.taskId, attemptId)) ?? record;
}
