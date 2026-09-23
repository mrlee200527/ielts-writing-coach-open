import { stableUuid } from "../domain/shared/ids";
import type { TaskContextVersion } from "../domain/task-context/task-context-version.schema";
import type {
  CreateTaskIntakeTransaction,
  PublishTaskContextVersion,
  TaskContextResolution,
  TaskIntakeRecord,
  TaskIntakeRepository,
} from "../application/task-intake/task-intake.repository";

export class InMemoryTaskIntakeRepository implements TaskIntakeRepository {
  createCount = 0;
  failNextCreate = false;
  readonly blobReferenceChecks: string[] = [];
  private readonly requests = new Map<string, TaskIntakeRecord>();
  private readonly byTask = new Map<string, TaskIntakeRecord>();
  private readonly versionRows = new Map<string, TaskContextVersion[]>();
  private readonly events = new Map<string, number>();

  async createIntake(input: CreateTaskIntakeTransaction) {
    const existing = this.requests.get(input.requestIdempotencyKey);
    if (existing) return "ALREADY_EXISTS" as const;
    this.createCount += 1;
    if (this.failNextCreate) { this.failNextCreate = false; throw new Error("CREATE_INTAKE_FAILED"); }
    const record = structuredClone({ workspace: input.workspace, attempt: input.attempt });
    this.requests.set(input.requestIdempotencyKey, record);
    this.byTask.set(input.workspace.task.id, record);
    return "CREATED" as const;
  }

  async findByRequestIdempotencyKey(key: string) { const value = this.requests.get(key); return value ? structuredClone(value) : undefined; }
  async findAttempt(taskId: string, attemptId: string) { const value = this.byTask.get(taskId); return value?.attempt.id === attemptId ? structuredClone(value) : undefined; }
  async createRetryAttempt(input: { taskId: string; attempt: import("../application/task-intake/task-intake.repository").TaskIntakeAttempt }) {
    const replay = this.requests.get(input.attempt.idempotencyKey);
    if (replay) return "ALREADY_EXISTS" as const;
    const current = this.byTask.get(input.taskId);
    if (!current) throw new Error("TASK_INTAKE_NOT_FOUND");
    const record = structuredClone({ workspace: { ...current.workspace, task: { ...current.workspace.task, activeAttemptId: input.attempt.id, intakeStatus: "UPLOADED" as const } }, attempt: input.attempt });
    this.byTask.set(input.taskId, record);
    this.requests.set(input.attempt.idempotencyKey, record);
    return "CREATED" as const;
  }
  async claimAttempt(input: { taskId: string; attemptId: string; inputHash: string; idempotencyKey: string }) {
    const record = this.byTask.get(input.taskId);
    if (!record || record.attempt.id !== input.attemptId || record.attempt.inputHash !== input.inputHash) return "STALE" as const;
    if (record.attempt.status !== "ACTIVE") return "DUPLICATE" as const;
    record.workspace.task.intakeStatus = "PROCESSING";
    return "CLAIMED" as const;
  }
  async claimLlmCall(input: { taskId: string; attemptId: string; inputHash: string; expectedCallCount: 0 | 1 }) {
    const record = this.byTask.get(input.taskId);
    if (!record || record.attempt.id !== input.attemptId || record.attempt.inputHash !== input.inputHash || record.attempt.status !== "ACTIVE") return "STALE" as const;
    if (record.attempt.callCount !== input.expectedCallCount || record.attempt.callCount >= 2) return "BUDGET_EXHAUSTED" as const;
    record.attempt.callCount += 1;
    return "CLAIMED" as const;
  }
  async publishAcceptedAttempt(input: PublishTaskContextVersion) {
    const record = this.byTask.get(input.taskId);
    if (!record || record.attempt.id !== input.attemptId || record.attempt.inputHash !== input.inputHash) return "STALE" as const;
    if (record.attempt.status !== "ACTIVE") return "DUPLICATE" as const;
    const rows = this.versionRows.get(input.taskId) ?? [];
    const version: TaskContextVersion = {
      id: stableUuid(`task-context-version:${input.taskId}:${rows.length + 1}`), taskId: input.taskId,
      version: rows.length + 1, status: input.status, context: structuredClone(input.context), schemaVersion: 1,
      sourceImageSha256: input.sourceImageSha256, promptVersion: input.promptVersion, model: input.model,
      createdAt: input.createdAt.toISOString(), limitations: [...input.limitations],
    };
    this.versionRows.set(input.taskId, [...rows, version]);
    record.attempt.status = input.status === "UNAVAILABLE" ? "FAILED" : "ACCEPTED";
    record.workspace.task.currentTaskContextVersionId = version.id;
    record.workspace.task.intakeStatus = input.status === "UNAVAILABLE" ? "FAILED" : input.status;
    this.events.set(input.taskId, (this.events.get(input.taskId) ?? 0) + 1);
    return "PUBLISHED" as const;
  }
  async markQueued(taskId: string, attemptId: string, jobId: string) { void jobId; const record = this.byTask.get(taskId); if (record?.attempt.id === attemptId && record.workspace.task.intakeStatus === "UPLOADED") record.workspace.task.intakeStatus = "QUEUED"; }
  async findResolution(taskId: string): Promise<TaskContextResolution | undefined> {
    const record = this.byTask.get(taskId); if (!record || !record.workspace.task.imageBlobId || !record.workspace.task.imageMediaType || !record.workspace.task.imageSha256) return undefined;
    const row = this.versionRows.get(taskId)?.at(-1);
    return structuredClone({ taskId, image: { blobId: record.workspace.task.imageBlobId, mediaType: record.workspace.task.imageMediaType, sha256: record.workspace.task.imageSha256 }, processingStatus: record.workspace.task.intakeStatus!, taskContextVersionId: row?.id ?? null, taskContextVersion: row?.version ?? null, availability: row?.status ?? "PENDING", context: row?.context ?? null, limitationCodes: row?.limitations ?? [], publicLimitationMessages: [] });
  }
  async isBlobReferenced(blobId: string) { this.blobReferenceChecks.push(blobId); return [...this.byTask.values()].some((record) => record.workspace.task.imageBlobId === blobId); }
  async findAccessibleTaskByBlobId(blobId: string, userId: string) { const record = [...this.byTask.values()].find((item) => item.workspace.task.imageBlobId === blobId && item.workspace.session.userId === userId); return record ? { taskId: record.workspace.task.id } : undefined; }
  versions(taskId: string) { return structuredClone(this.versionRows.get(taskId) ?? []); }
  eventCount(taskId: string) { return this.events.get(taskId) ?? 0; }
  taskIntakeSnapshot(taskId: string) { return this.byTask.get(taskId); }
  taskContextVersionSnapshots(taskId: string) { return this.versions(taskId); }
  analysisAttemptSnapshots(taskId: string) { const record = this.byTask.get(taskId); return record ? [structuredClone(record.attempt)] : []; }
}
