import type { WritingWorkspaceSnapshot } from "../essay-session.repository";
import type { TaskIntakeStatus } from "../../domain/task-context/task-intake-state-machine";
import type { TaskContext, TaskContextLimitationCode } from "../../domain/task-context/task-context.schema";
import type { TaskContextVersion, TaskContextVersionStatus } from "../../domain/task-context/task-context-version.schema";
import type { AllowedTaskImageType } from "../../ports/blob.port";

export interface TaskIntakeAttempt {
  id: string;
  taskId: string;
  inputHash: string;
  idempotencyKey: string;
  status: "ACTIVE" | "ACCEPTED" | "FAILED";
  callCount: number;
  promptVersion: string;
  schemaVersion: 1;
}

export interface CreateTaskIntakeTransaction {
  requestIdempotencyKey: string;
  workspace: WritingWorkspaceSnapshot;
  attempt: TaskIntakeAttempt;
}

export interface PublishTaskContextVersion {
  taskId: string;
  attemptId: string;
  inputHash: string;
  status: TaskContextVersionStatus;
  context: TaskContext | null;
  sourceImageSha256: string;
  promptVersion: string;
  model: string;
  limitations: TaskContextLimitationCode[];
  createdAt: Date;
}

export interface TaskContextResolution {
  taskId: string;
  image: { blobId: string; mediaType: AllowedTaskImageType; sha256: string };
  processingStatus: TaskIntakeStatus;
  taskContextVersionId: string | null;
  taskContextVersion: number | null;
  availability: "PENDING" | "READY" | "DEGRADED" | "UNAVAILABLE";
  context: TaskContext | null;
  limitationCodes: readonly TaskContextLimitationCode[];
  publicLimitationMessages: readonly string[];
}

export interface TaskIntakeRecord {
  workspace: WritingWorkspaceSnapshot;
  attempt: TaskIntakeAttempt;
}

export interface TaskIntakeRepository {
  createIntake(input: CreateTaskIntakeTransaction): Promise<"CREATED" | "ALREADY_EXISTS">;
  findByRequestIdempotencyKey(key: string): Promise<TaskIntakeRecord | undefined>;
  findAttempt(taskId: string, attemptId: string): Promise<TaskIntakeRecord | undefined>;
  createRetryAttempt(input: { taskId: string; attempt: TaskIntakeAttempt }): Promise<"CREATED" | "ALREADY_EXISTS">;
  claimAttempt(input: { taskId: string; attemptId: string; inputHash: string; idempotencyKey: string }): Promise<"CLAIMED" | "STALE" | "DUPLICATE">;
  claimLlmCall(input: { taskId: string; attemptId: string; inputHash: string; expectedCallCount: 0 | 1 }): Promise<"CLAIMED" | "BUDGET_EXHAUSTED" | "STALE">;
  publishAcceptedAttempt(input: PublishTaskContextVersion): Promise<"PUBLISHED" | "STALE" | "DUPLICATE">;
  markQueued(taskId: string, attemptId: string, jobId: string): Promise<void>;
  findResolution(taskId: string): Promise<TaskContextResolution | undefined>;
  isBlobReferenced(blobId: string): Promise<boolean>;
  findAccessibleTaskByBlobId(blobId: string, userId: string): Promise<{ taskId: string } | undefined>;
  versions(taskId: string): readonly TaskContextVersion[];
  eventCount(taskId: string): number;
}
