import { createHash, randomUUID } from "node:crypto";

import { createEssaySession } from "../../domain/essay/essay-session-service";
import type { AllowedTaskImageType, BlobPort } from "../../ports/blob.port";
import type { JobPort } from "../../ports/job.port";
import type { TaskIntakeRepository, TaskIntakeRecord } from "./task-intake.repository";

const MAX_TASK_IMAGE_BYTES = 10 * 1024 * 1024;

export interface CreateTaskIntakeInput {
  requestIdempotencyKey: string;
  userId: string;
  promptText: string | null;
  txtFileName?: string | null;
  imageBytes: Uint8Array;
  mediaType: AllowedTaskImageType;
  now: Date;
  blobId?: string;
}

export async function createTaskIntake(
  dependencies: { repository: TaskIntakeRepository; blobs: BlobPort; jobs: JobPort },
  input: CreateTaskIntakeInput,
): Promise<TaskIntakeRecord> {
  const replay = await dependencies.repository.findByRequestIdempotencyKey(input.requestIdempotencyKey);
  if (replay) return replay;
  if (input.imageBytes.byteLength < 1 || input.imageBytes.byteLength > MAX_TASK_IMAGE_BYTES) throw new Error("INVALID_IMAGE_SIZE");

  const imageSha256 = createHash("sha256").update(input.imageBytes).digest("hex");
  const blobId = input.blobId ?? randomUUID();
  const taskId = randomUUID();
  const attemptId = randomUUID();
  const session = createEssaySession({
    taskId,
    sessionId: randomUUID(),
    revisionId: randomUUID(),
    userId: input.userId,
    promptText: input.promptText?.trim() || "Task 1 image",
    txtFileName: input.txtFileName?.trim() || null,
    now: input.now,
  });
  const workspace = {
    ...session,
    task: {
      ...session.task,
      imageBlobId: blobId,
      imageMediaType: input.mediaType,
      imageSha256,
      intakeStatus: "UPLOADED" as const,
      activeAttemptId: attemptId,
      currentTaskContextVersionId: null,
    },
  };
  const inputHash = createHash("sha256").update(JSON.stringify({ imageSha256, promptText: input.promptText, promptVersion: "task-context-v1", schemaVersion: 1 })).digest("hex");
  const attempt = { id: attemptId, taskId, inputHash, idempotencyKey: input.requestIdempotencyKey, status: "ACTIVE" as const, callCount: 0, promptVersion: "task-context-v1", schemaVersion: 1 as const };
  const put = await dependencies.blobs.put({ blobId, bytes: input.imageBytes, metadata: { size: input.imageBytes.byteLength, mediaType: input.mediaType, sha256: imageSha256 } });

  try {
    await dependencies.repository.createIntake({ requestIdempotencyKey: input.requestIdempotencyKey, workspace, attempt });
  } catch (error) {
    if (put.status === "CREATED") {
      try {
        if (!(await dependencies.repository.isBlobReferenced(blobId))) await dependencies.blobs.delete(blobId);
      } catch {
        // A failed reference check must preserve the blob for safe later reconciliation.
      }
    }
    throw error;
  }

  try {
    const job = dependencies.jobs.enqueue({ name: "task-context", idempotencyKey: input.requestIdempotencyKey, payload: { taskId, attemptId } });
    await dependencies.repository.markQueued(taskId, attemptId, job.id);
  } catch {
    return (await dependencies.repository.findAttempt(taskId, attemptId)) ?? { workspace, attempt };
  }
  return (await dependencies.repository.findAttempt(taskId, attemptId)) ?? { workspace, attempt };
}
