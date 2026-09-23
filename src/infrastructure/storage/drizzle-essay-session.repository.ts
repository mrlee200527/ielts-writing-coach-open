import { and, desc, eq } from "drizzle-orm";
import type { EssaySessionRepository, SaveRevisionResult, WritingWorkspaceSnapshot } from "../../application/essay-session.repository";
import type { LocalDatabase } from "../database/client";
import { draftMutations, essayRevisions, essaySessions, writingTasks } from "../database/schema";
import { essaySessionSchema } from "../../domain/essay/essay.schema";
import { essayRevisionSchema } from "../../domain/essay/revision.schema";
import { writingTaskSchema } from "../../domain/essay/writing-task.schema";
import { createDomainEvent } from "../../domain/events/event-factory";
import { stableUuid } from "../../domain/shared/ids";
import { stableHash } from "../../domain/shared/hash";
import { domainEvents } from "../database/schema";
import type { EssayObservationSource } from "../../ports/test-observation.port";
import { domainEventSchema } from "../../domain/events/domain-event.schema";

export class DrizzleEssaySessionRepository implements EssaySessionRepository, EssayObservationSource {
  constructor(private readonly database: LocalDatabase) {}

  async findByClientRequestId(clientRequestId: string) {
    const row = this.database.db.select({ id: essaySessions.id }).from(essaySessions).where(eq(essaySessions.clientRequestId, clientRequestId)).get();
    return row ? this.findWorkspace(row.id) : undefined;
  }

  async create(input: WritingWorkspaceSnapshot & { clientRequestId: string }) {
    this.database.sqlite.transaction(() => {
      this.database.db.insert(writingTasks).values(input.task).run();
      this.database.db.insert(essayRevisions).values(this.revisionRow(input.revision)).run();
      this.database.db.insert(essaySessions).values({ id: input.session.id, userId: input.session.userId, taskId: input.session.taskId, status: input.session.status, currentRevisionId: input.revision.id, startedAt: input.session.startedAt, submittedAt: input.session.submittedAt, timerElapsedMs: input.timer.elapsedMs, timerRunningSince: input.timer.runningSince, clientRequestId: input.clientRequestId }).run();
      this.insertEvent(input.session.id, input.revision.id, "essay.session_created", "SESSION_STARTED", input.clientRequestId, input.session.startedAt);
    })();
  }

  async findWorkspace(sessionId: string): Promise<WritingWorkspaceSnapshot | undefined> {
    return this.findWorkspaceSync(sessionId);
  }

  async findMostRecentDraft(userId: string): Promise<WritingWorkspaceSnapshot | undefined> {
    const row = this.database.db.select({ id: essaySessions.id }).from(essaySessions).innerJoin(essayRevisions, eq(essayRevisions.id, essaySessions.currentRevisionId)).where(and(eq(essaySessions.userId, userId), eq(essaySessions.status, "DRAFT"))).orderBy(desc(essayRevisions.createdAt)).limit(1).get();
    return row ? this.findWorkspaceSync(row.id) : undefined;
  }

  async findMutation(sessionId: string, clientMutationId: string): Promise<SaveRevisionResult | undefined> {
    const mutation = this.database.db.select().from(draftMutations).where(and(eq(draftMutations.sessionId, sessionId), eq(draftMutations.id, clientMutationId))).get();
    if (!mutation) return undefined;
    if (mutation.status === "REVISION_CONFLICT") return { status: "REVISION_CONFLICT", currentRevisionId: mutation.currentRevisionId! };
    const revision = this.database.db.select().from(essayRevisions).where(eq(essayRevisions.id, mutation.revisionId!)).get();
    if (!revision) throw new Error("MUTATION_CORRUPT");
    return { status: mutation.status as "SAVED" | "ALREADY_SAVED", revision: essayRevisionSchema.parse({ ...revision, content: JSON.parse(revision.contentJson) }) };
  }

  async saveRevision(input: Parameters<EssaySessionRepository["saveRevision"]>[0]): Promise<SaveRevisionResult> {
    return this.database.sqlite.transaction(() => {
      const replay = this.findMutationSync(input.sessionId, input.clientMutationId);
      if (replay) return replay;
      const current = this.database.db.select({ id: essaySessions.currentRevisionId }).from(essaySessions).where(eq(essaySessions.id, input.sessionId)).get();
      if (!current) throw new Error("ESSAY_NOT_FOUND");
      if (current.id !== input.expectedRevisionId) {
        const result = { status: "REVISION_CONFLICT", currentRevisionId: current.id } as const;
        this.database.db.insert(draftMutations).values({ id: input.clientMutationId, sessionId: input.sessionId, status: result.status, currentRevisionId: result.currentRevisionId }).run();
        return result;
      }
      this.database.db.insert(essayRevisions).values(this.revisionRow(input.revision)).run();
      const changed = this.database.db.update(essaySessions).set({ currentRevisionId: input.revision.id, timerElapsedMs: input.timer.elapsedMs, timerRunningSince: input.timer.runningSince ?? null }).where(and(eq(essaySessions.id, input.sessionId), eq(essaySessions.currentRevisionId, input.expectedRevisionId))).run();
      if (changed.changes !== 1) throw new Error("REVISION_CONFLICT");
      this.database.db.insert(draftMutations).values({ id: input.clientMutationId, sessionId: input.sessionId, status: "SAVED", revisionId: input.revision.id }).run();
      this.insertEvent(input.sessionId, input.revision.id, "essay.revision_saved", "AUTOSAVE_SUCCEEDED", input.clientMutationId, input.revision.createdAt);
      return { status: "SAVED", revision: input.revision } as const;
    })();
  }

  currentRevisionSnapshot(sessionId: string) { return this.findWorkspaceSync(sessionId)?.revision; }

  revisionCountSnapshot(sessionId: string) {
    return this.database.db.select({ id: essayRevisions.id }).from(essayRevisions).where(eq(essayRevisions.sessionId, sessionId)).all().length;
  }

  domainEventSnapshots() {
    return this.database.db.select({ payloadJson: domainEvents.payloadJson }).from(domainEvents).all().map((row) => domainEventSchema.parse(JSON.parse(row.payloadJson)));
  }

  private revisionRow(revision: import("../../domain/essay/revision.schema").EssayRevision) {
    return { id: revision.id, sessionId: revision.sessionId, revisionNo: revision.revisionNo, plainText: revision.plainText, contentJson: JSON.stringify(revision.content), wordCount: revision.wordCount, textHash: revision.textHash, createdAt: revision.createdAt };
  }

  private findWorkspaceSync(sessionId: string): WritingWorkspaceSnapshot | undefined {
    const session = this.database.db.select().from(essaySessions).where(eq(essaySessions.id, sessionId)).get();
    if (!session) return undefined;
    const task = this.database.db.select().from(writingTasks).where(eq(writingTasks.id, session.taskId)).get();
    const revision = this.database.db.select().from(essayRevisions).where(eq(essayRevisions.id, session.currentRevisionId)).get();
    if (!task || !revision) throw new Error("WORKSPACE_CORRUPT");
    return {
      task: writingTaskSchema.parse(task),
      session: essaySessionSchema.parse({ id: session.id, userId: session.userId, taskId: session.taskId, status: session.status, currentRevisionId: session.currentRevisionId, startedAt: session.startedAt, submittedAt: session.submittedAt ?? undefined }),
      revision: essayRevisionSchema.parse({ id: revision.id, sessionId: revision.sessionId, revisionNo: revision.revisionNo, plainText: revision.plainText, content: JSON.parse(revision.contentJson), wordCount: revision.wordCount, textHash: revision.textHash, createdAt: revision.createdAt }),
      timer: { elapsedMs: session.timerElapsedMs, ...(session.timerRunningSince ? { runningSince: session.timerRunningSince } : {}) },
    };
  }

  private insertEvent(sessionId: string, revisionId: string, eventType: "essay.session_created" | "essay.revision_saved", reasonCode: "SESSION_STARTED" | "AUTOSAVE_SUCCEEDED", key: string, occurredAt: string) {
    const event = createDomainEvent({ eventType, aggregateType: "essay_session", aggregateId: stableUuid(sessionId), essayRevisionId: stableUuid(revisionId), occurredAt: new Date(occurredAt), correlationId: stableUuid(`correlation:${sessionId}`), causationId: stableUuid(`causation:${key}`), idempotencyKey: stableHash({ eventType, key }), reasonCode, payload: {} });
    this.database.db.insert(domainEvents).values({ id: event.eventId, aggregateType: event.aggregateType, aggregateId: event.aggregateId, eventType: event.eventType, payloadJson: JSON.stringify(event), occurredAt: event.occurredAt, correlationId: event.correlationId }).run();
  }

  private findMutationSync(sessionId: string, clientMutationId: string): SaveRevisionResult | undefined {
    const mutation = this.database.db.select().from(draftMutations).where(and(eq(draftMutations.sessionId, sessionId), eq(draftMutations.id, clientMutationId))).get();
    if (!mutation) return undefined;
    if (mutation.status === "REVISION_CONFLICT") return { status: "REVISION_CONFLICT", currentRevisionId: mutation.currentRevisionId! };
    const revision = this.database.db.select().from(essayRevisions).where(eq(essayRevisions.id, mutation.revisionId!)).get();
    if (!revision) throw new Error("MUTATION_CORRUPT");
    return { status: "ALREADY_SAVED", revision: essayRevisionSchema.parse({ ...revision, content: JSON.parse(revision.contentJson) }) };
  }
}
