import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type {
  CreateTaskIntakeTransaction,
  PublishTaskContextVersion,
  TaskContextResolution,
  TaskIntakeAttempt,
  TaskIntakeRepository,
  TaskIntakeRecord,
} from "../../application/task-intake/task-intake.repository";
import { essaySessionSchema } from "../../domain/essay/essay.schema";
import { essayRevisionSchema } from "../../domain/essay/revision.schema";
import { writingTaskSchema } from "../../domain/essay/writing-task.schema";
import { stableUuid } from "../../domain/shared/ids";
import { taskIntakeStatusSchema } from "../../domain/task-context/task-intake-state-machine";
import { taskContextLimitationCodeSchema, taskContextSchema } from "../../domain/task-context/task-context.schema";
import { taskContextVersionStatusSchema, type TaskContextVersion } from "../../domain/task-context/task-context-version.schema";
import { allowedTaskImageTypes } from "../../ports/blob.port";
import type { LocalDatabase } from "../database/client";
import { domainEvents, essayRevisions, essaySessions, taskContextAttempts, taskContextVersions, writingTasks } from "../database/schema";

const mvpAttemptColumns = {
  id: taskContextAttempts.id,
  taskId: taskContextAttempts.taskId,
  inputHash: taskContextAttempts.inputHash,
  promptVersion: taskContextAttempts.promptVersion,
  schemaVersion: taskContextAttempts.schemaVersion,
  idempotencyKey: taskContextAttempts.idempotencyKey,
  state: taskContextAttempts.state,
  callCount: taskContextAttempts.callCount,
  jobId: taskContextAttempts.jobId,
  failureCode: taskContextAttempts.failureCode,
  startedAt: taskContextAttempts.startedAt,
  finishedAt: taskContextAttempts.finishedAt,
};

const mvpVersionColumns = {
  id: taskContextVersions.id,
  taskId: taskContextVersions.taskId,
  version: taskContextVersions.version,
  status: taskContextVersions.status,
  contextJson: taskContextVersions.contextJson,
  limitationsJson: taskContextVersions.limitationsJson,
  sourceImageSha256: taskContextVersions.sourceImageSha256,
  promptVersion: taskContextVersions.promptVersion,
  schemaVersion: taskContextVersions.schemaVersion,
  model: taskContextVersions.model,
  createdAt: taskContextVersions.createdAt,
};

export class DrizzleTaskIntakeRepository implements TaskIntakeRepository {
  constructor(private readonly database: LocalDatabase) {}

  async createIntake(input: CreateTaskIntakeTransaction) {
    try {
      this.database.sqlite.transaction(() => {
        this.database.db.insert(writingTasks).values(input.workspace.task).run();
        this.database.db.insert(essayRevisions).values({ ...input.workspace.revision, contentJson: JSON.stringify(input.workspace.revision.content) }).run();
        this.database.db.insert(essaySessions).values({ ...input.workspace.session, currentRevisionId: input.workspace.revision.id, timerElapsedMs: input.workspace.timer.elapsedMs, timerRunningSince: input.workspace.timer.runningSince, clientRequestId: input.requestIdempotencyKey }).run();
        this.database.db.insert(taskContextAttempts).values({ id: input.attempt.id, taskId: input.attempt.taskId, inputHash: input.attempt.inputHash, promptVersion: input.attempt.promptVersion, schemaVersion: 1, idempotencyKey: input.attempt.idempotencyKey, state: input.attempt.status, callCount: 0, startedAt: input.workspace.session.startedAt }).run();
      })();
      return "CREATED" as const;
    } catch (error) {
      if (await this.findByRequestIdempotencyKey(input.requestIdempotencyKey)) return "ALREADY_EXISTS" as const;
      throw new Error("CREATE_INTAKE_FAILED", { cause: error });
    }
  }

  async findByRequestIdempotencyKey(key: string) {
    const attempt = this.database.db.select(mvpAttemptColumns).from(taskContextAttempts).where(eq(taskContextAttempts.idempotencyKey, key)).get();
    return attempt ? this.findAttempt(attempt.taskId, attempt.id) : undefined;
  }

  async findAttempt(taskId: string, attemptId: string): Promise<TaskIntakeRecord | undefined> {
    const attempt = this.database.db.select(mvpAttemptColumns).from(taskContextAttempts).where(and(eq(taskContextAttempts.taskId, taskId), eq(taskContextAttempts.id, attemptId))).get();
    const task = this.database.db.select().from(writingTasks).where(eq(writingTasks.id, taskId)).get();
    const session = this.database.db.select().from(essaySessions).where(eq(essaySessions.taskId, taskId)).get();
    if (!attempt || !task || !session) return undefined;
    if (attempt.schemaVersion !== 1) throw new Error("UNSUPPORTED_TASK_CONTEXT_SCHEMA");
    const revision = this.database.db.select().from(essayRevisions).where(eq(essayRevisions.id, session.currentRevisionId)).get();
    if (!revision) return undefined;
    return {
      workspace: {
        task: writingTaskSchema.parse(task),
        session: essaySessionSchema.parse({ ...session, submittedAt: session.submittedAt ?? undefined }),
        revision: essayRevisionSchema.parse({ ...revision, content: JSON.parse(revision.contentJson) }),
        timer: { elapsedMs: session.timerElapsedMs, ...(session.timerRunningSince ? { runningSince: session.timerRunningSince } : {}) },
      },
      attempt: { id: attempt.id, taskId: attempt.taskId, inputHash: attempt.inputHash, idempotencyKey: attempt.idempotencyKey, status: z.enum(["ACTIVE", "ACCEPTED", "FAILED"]).parse(attempt.state), callCount: attempt.callCount, promptVersion: attempt.promptVersion, schemaVersion: 1 },
    };
  }

  async createRetryAttempt(input: { taskId: string; attempt: TaskIntakeAttempt }) {
    if (!this.database.db.select().from(writingTasks).where(eq(writingTasks.id, input.taskId)).get()) throw new Error("TASK_INTAKE_NOT_FOUND");
    try {
      this.database.sqlite.transaction(() => {
        this.database.db.insert(taskContextAttempts).values({ ...input.attempt, state: "ACTIVE", startedAt: new Date().toISOString() }).run();
        this.database.db.update(writingTasks).set({ activeAttemptId: input.attempt.id, intakeStatus: "UPLOADED" }).where(eq(writingTasks.id, input.taskId)).run();
      })();
      return "CREATED" as const;
    } catch {
      return "ALREADY_EXISTS" as const;
    }
  }

  async claimAttempt(input: Parameters<TaskIntakeRepository["claimAttempt"]>[0]) {
    const attempt = this.database.db.select(mvpAttemptColumns).from(taskContextAttempts).where(eq(taskContextAttempts.id, input.attemptId)).get();
    if (!attempt || attempt.taskId !== input.taskId || attempt.inputHash !== input.inputHash) return "STALE" as const;
    if (attempt.state !== "ACTIVE") return "DUPLICATE" as const;
    const changed = this.database.db.update(writingTasks).set({ intakeStatus: "PROCESSING" }).where(and(eq(writingTasks.id, input.taskId), eq(writingTasks.activeAttemptId, input.attemptId))).run();
    return changed.changes === 1 ? "CLAIMED" as const : "STALE" as const;
  }

  async claimLlmCall(input: Parameters<TaskIntakeRepository["claimLlmCall"]>[0]) {
    const changed = this.database.db.update(taskContextAttempts).set({ callCount: input.expectedCallCount + 1 }).where(and(eq(taskContextAttempts.id, input.attemptId), eq(taskContextAttempts.inputHash, input.inputHash), eq(taskContextAttempts.callCount, input.expectedCallCount), eq(taskContextAttempts.state, "ACTIVE"))).run();
    if (changed.changes === 1) return "CLAIMED" as const;
    const count = this.database.db.select({ callCount: taskContextAttempts.callCount }).from(taskContextAttempts).where(eq(taskContextAttempts.id, input.attemptId)).get()?.callCount ?? 2;
    return count >= 2 ? "BUDGET_EXHAUSTED" as const : "STALE" as const;
  }

  async publishAcceptedAttempt(input: PublishTaskContextVersion) {
    return this.database.sqlite.transaction(() => {
      const attempt = this.database.db.select(mvpAttemptColumns).from(taskContextAttempts).where(eq(taskContextAttempts.id, input.attemptId)).get();
      if (!attempt || attempt.taskId !== input.taskId || attempt.inputHash !== input.inputHash) return "STALE" as const;
      if (attempt.state !== "ACTIVE") return "DUPLICATE" as const;
      const task = this.database.db.select().from(writingTasks).where(eq(writingTasks.id, input.taskId)).get();
      if (task?.activeAttemptId !== input.attemptId) return "STALE" as const;
      const maxVersion = this.database.db.select({ value: sql<number>`coalesce(max(${taskContextVersions.version}), 0)` }).from(taskContextVersions).where(eq(taskContextVersions.taskId, input.taskId)).get()?.value ?? 0;
      const versionId = stableUuid(`task-context-version:${input.taskId}:${maxVersion + 1}`);
      this.database.db.insert(taskContextVersions).values({ id: versionId, taskId: input.taskId, version: maxVersion + 1, status: input.status, contextJson: input.context ? JSON.stringify(input.context) : null, limitationsJson: JSON.stringify(input.limitations), sourceImageSha256: input.sourceImageSha256, promptVersion: input.promptVersion, schemaVersion: 1, model: input.model, createdAt: input.createdAt.toISOString() }).run();
      this.database.db.update(writingTasks).set({ currentTaskContextVersionId: versionId, intakeStatus: input.status === "UNAVAILABLE" ? "FAILED" : input.status }).where(eq(writingTasks.id, input.taskId)).run();
      this.database.db.update(taskContextAttempts).set({ state: input.status === "UNAVAILABLE" ? "FAILED" : "ACCEPTED", finishedAt: input.createdAt.toISOString() }).where(eq(taskContextAttempts.id, input.attemptId)).run();
      const eventType = input.status === "READY" ? "task.context_ready" : input.status === "DEGRADED" ? "task.context_degraded" : "task.context_unavailable";
      this.database.db.insert(domainEvents).values({ id: stableUuid(`task-context-event:${input.attemptId}`), aggregateType: "writing_task", aggregateId: input.taskId, eventType, payloadJson: JSON.stringify({ status: input.status }), occurredAt: input.createdAt.toISOString(), correlationId: input.attemptId }).run();
      return "PUBLISHED" as const;
    })();
  }

  async markQueued(taskId: string, attemptId: string, jobId: string) {
    this.database.sqlite.transaction(() => {
      this.database.db.update(taskContextAttempts).set({ jobId }).where(eq(taskContextAttempts.id, attemptId)).run();
      this.database.db.update(writingTasks).set({ intakeStatus: "QUEUED" }).where(and(eq(writingTasks.id, taskId), eq(writingTasks.activeAttemptId, attemptId), eq(writingTasks.intakeStatus, "UPLOADED"))).run();
    })();
  }

  async findResolution(taskId: string): Promise<TaskContextResolution | undefined> {
    const task = this.database.db.select().from(writingTasks).where(eq(writingTasks.id, taskId)).get();
    if (!task?.imageBlobId || !task.imageMediaType || !task.imageSha256 || !task.intakeStatus) return undefined;
    const version = task.currentTaskContextVersionId ? this.database.db.select(mvpVersionColumns).from(taskContextVersions).where(eq(taskContextVersions.id, task.currentTaskContextVersionId)).get() : undefined;
    return { taskId, image: { blobId: task.imageBlobId, mediaType: z.enum(allowedTaskImageTypes).parse(task.imageMediaType), sha256: task.imageSha256 }, processingStatus: taskIntakeStatusSchema.parse(task.intakeStatus), taskContextVersionId: version?.id ?? null, taskContextVersion: version?.version ?? null, availability: version ? taskContextVersionStatusSchema.parse(version.status) : "PENDING", context: version?.contextJson ? taskContextSchema.parse(JSON.parse(version.contextJson)) : null, limitationCodes: version ? z.array(taskContextLimitationCodeSchema).parse(JSON.parse(version.limitationsJson)) : [], publicLimitationMessages: [] };
  }

  async isBlobReferenced(blobId: string) { return Boolean(this.database.db.select().from(writingTasks).where(eq(writingTasks.imageBlobId, blobId)).get()); }

  async findAccessibleTaskByBlobId(blobId: string, userId: string) {
    const task = this.database.db.select({ taskId: writingTasks.id }).from(writingTasks).innerJoin(essaySessions, eq(essaySessions.taskId, writingTasks.id)).where(and(eq(writingTasks.imageBlobId, blobId), eq(essaySessions.userId, userId))).get();
    return task;
  }

  versions(taskId: string): readonly TaskContextVersion[] {
    return this.database.db.select(mvpVersionColumns).from(taskContextVersions).where(eq(taskContextVersions.taskId, taskId)).all().map((row) => ({ id: row.id, taskId: row.taskId, version: row.version, status: taskContextVersionStatusSchema.parse(row.status), context: row.contextJson ? taskContextSchema.parse(JSON.parse(row.contextJson)) : null, schemaVersion: z.literal(1).parse(row.schemaVersion), sourceImageSha256: row.sourceImageSha256, promptVersion: row.promptVersion, model: row.model, createdAt: row.createdAt, limitations: z.array(taskContextLimitationCodeSchema).parse(JSON.parse(row.limitationsJson)) }));
  }

  eventCount(taskId: string) { return this.database.db.select().from(domainEvents).where(and(eq(domainEvents.aggregateType, "writing_task"), eq(domainEvents.aggregateId, taskId))).all().length; }
}
