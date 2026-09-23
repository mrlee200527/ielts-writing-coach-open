import { stableUuid } from "../../domain/shared/ids";
import { parseTaskContext, type TaskContext, type TaskContextLimitationCode } from "../../domain/task-context/task-context.schema";
import { validateResolutionStatus, type TaskContextVersionStatus } from "../../domain/task-context/task-context-version.schema";
import type { BlobPort } from "../../ports/blob.port";
import type { TaskContextLLMPort, TaskContextLlmResult } from "../../ports/task-context-llm.port";
import type { TaskIntakeRepository } from "./task-intake.repository";

export interface ProcessTaskContextInput { taskId: string; attemptId: string; now: Date }

export async function processTaskContext(
  dependencies: { repository: TaskIntakeRepository; blobs: BlobPort; llm: TaskContextLLMPort },
  input: ProcessTaskContextInput,
): Promise<{ status: "PUBLISHED" | "STALE" | "DUPLICATE" }> {
  const record = await dependencies.repository.findAttempt(input.taskId, input.attemptId);
  if (!record || record.attempt.status !== "ACTIVE") return { status: record ? "DUPLICATE" : "STALE" };
  const claimed = await dependencies.repository.claimAttempt({ taskId: input.taskId, attemptId: input.attemptId, inputHash: record.attempt.inputHash, idempotencyKey: record.attempt.idempotencyKey });
  if (claimed !== "CLAIMED") return { status: claimed === "DUPLICATE" ? "DUPLICATE" : "STALE" };
  const blobId = record.workspace.task.imageBlobId;
  const mediaType = record.workspace.task.imageMediaType;
  const imageSha256 = record.workspace.task.imageSha256;
  if (!blobId || !mediaType || !imageSha256) return publishUnavailable(dependencies.repository, record, input.now, ["NO_SAFE_CONTEXT"]);
  const image = await dependencies.blobs.read(blobId);
  if (image.status === "NOT_FOUND") return publishUnavailable(dependencies.repository, record, input.now, ["IMAGE_UNREADABLE"]);

  let mode: "ANALYZE" | "REPAIR" = "ANALYZE";
  let lastFailure: Extract<TaskContextLlmResult, { ok: false }>["code"] | "INVALID_STRUCTURE" = "TERMINAL";
  for (const expectedCallCount of [0, 1] as const) {
    const budget = await dependencies.repository.claimLlmCall({ taskId: input.taskId, attemptId: input.attemptId, inputHash: record.attempt.inputHash, expectedCallCount });
    if (budget !== "CLAIMED") return { status: budget === "STALE" ? "STALE" : "DUPLICATE" };
    const result = await dependencies.llm.executeTaskContext({
      attemptId: input.attemptId,
      correlationId: stableUuid(`task-context-call:${input.attemptId}:${expectedCallCount + 1}`),
      promptVersion: record.attempt.promptVersion,
      schemaVersion: 1,
      inputHash: record.attempt.inputHash,
      image: { mediaType, bytes: image.bytes },
      promptText: record.workspace.task.promptText === "Task 1 image" ? null : record.workspace.task.promptText,
      mode,
    });
    if (result.ok) {
      try {
        const context = parseTaskContext(result.value);
        const status = resolutionStatus(context);
        return { status: await dependencies.repository.publishAcceptedAttempt({ taskId: input.taskId, attemptId: input.attemptId, inputHash: record.attempt.inputHash, status, context, sourceImageSha256: imageSha256, promptVersion: record.attempt.promptVersion, model: result.model, limitations: [...context.limitations], createdAt: input.now }) };
      } catch {
        lastFailure = "INVALID_STRUCTURE";
        mode = "REPAIR";
      }
    } else {
      lastFailure = result.code;
      if (result.code === "INVALID_JSON" || result.code === "INVALID_STRUCTURE") mode = "REPAIR";
      else if (result.code === "TIMEOUT" || result.code === "NETWORK") mode = "ANALYZE";
      else break;
    }
  }
  return publishUnavailable(dependencies.repository, record, input.now, limitationFor(lastFailure));
}

function resolutionStatus(context: TaskContext): Exclude<TaskContextVersionStatus, "UNAVAILABLE"> {
  const allCertain = context.facts.every((fact) => fact.certainty === "CERTAIN");
  const status = allCertain && context.limitations.length === 0 ? "READY" : "DEGRADED";
  validateResolutionStatus(status, context);
  return status;
}

function limitationFor(code: string): TaskContextLimitationCode[] {
  return code === "INVALID_STRUCTURE" || code === "INVALID_JSON" ? ["NO_SAFE_CONTEXT"] : ["IMAGE_UNREADABLE"];
}

async function publishUnavailable(
  repository: TaskIntakeRepository,
  record: Awaited<ReturnType<TaskIntakeRepository["findAttempt"]>> & {},
  now: Date,
  limitations: TaskContextLimitationCode[],
) {
  const status = await repository.publishAcceptedAttempt({ taskId: record.workspace.task.id, attemptId: record.attempt.id, inputHash: record.attempt.inputHash, status: "UNAVAILABLE", context: null, sourceImageSha256: record.workspace.task.imageSha256 ?? "0".repeat(64), promptVersion: record.attempt.promptVersion, model: "unavailable", limitations, createdAt: now });
  return { status } as { status: "PUBLISHED" | "STALE" | "DUPLICATE" };
}
