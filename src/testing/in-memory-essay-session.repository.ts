import type { EssaySessionRepository, SaveRevisionResult, WritingWorkspaceSnapshot } from "../application/essay-session.repository";
import type { EssayObservationSource } from "../ports/test-observation.port";
import { createDomainEvent } from "../domain/events/event-factory";
import { stableUuid } from "../domain/shared/ids";
import { stableHash } from "../domain/shared/hash";
import type { InMemoryEventRecorder } from "./in-memory-event-recorder";

export class InMemoryEssaySessionRepository implements EssaySessionRepository, EssayObservationSource {
  private readonly workspaces = new Map<string, WritingWorkspaceSnapshot>();
  private readonly requests = new Map<string, string>();
  private readonly mutations = new Map<string, SaveRevisionResult>();
  private readonly uncommitted = new Map<string, unknown[]>();
  private readonly revisions = new Map<string, unknown[]>();
  constructor(private readonly recorder?: InMemoryEventRecorder) {}

  async findByClientRequestId(clientRequestId: string) { const id = this.requests.get(clientRequestId); return id ? this.findWorkspace(id) : undefined; }
  async create(input: WritingWorkspaceSnapshot & { clientRequestId: string }) { if (this.requests.has(input.clientRequestId)) throw new Error("DUPLICATE_CLIENT_REQUEST"); this.workspaces.set(input.session.id, structuredClone(input)); this.revisions.set(input.session.id, [structuredClone(input.revision)]); this.requests.set(input.clientRequestId, input.session.id); this.emit(input.session.id, input.revision.id, "essay.session_created", "SESSION_STARTED", input.clientRequestId); }
  async findWorkspace(sessionId: string) { const value = this.workspaces.get(sessionId); return value ? structuredClone(value) : undefined; }
  async findMostRecentDraft(userId: string) { const drafts = [...this.workspaces.values()].filter((workspace) => workspace.session.userId === userId && workspace.session.status === "DRAFT").sort((left, right) => right.revision.createdAt.localeCompare(left.revision.createdAt)); return drafts[0] ? structuredClone(drafts[0]) : undefined; }
  async findMutation(sessionId: string, clientMutationId: string) { const value = this.mutations.get(`${sessionId}:${clientMutationId}`); return value ? structuredClone(value) : undefined; }
  async saveRevision(input: { sessionId: string; expectedRevisionId: string; revision: import("../domain/essay/revision.schema").EssayRevision; timer: import("../domain/essay/writing-timer").WritingTimerSnapshot; clientMutationId: string }) {
    const workspace = this.workspaces.get(input.sessionId);
    if (!workspace) throw new Error("ESSAY_NOT_FOUND");
    if (workspace.revision.id !== input.expectedRevisionId) return { status: "REVISION_CONFLICT", currentRevisionId: workspace.revision.id } as const;
    const updated = { ...workspace, revision: structuredClone(input.revision), session: { ...workspace.session, currentRevisionId: input.revision.id }, timer: structuredClone(input.timer) };
    this.workspaces.set(input.sessionId, updated);
    this.revisions.set(input.sessionId, [...(this.revisions.get(input.sessionId) ?? []), structuredClone(input.revision)]);
    const result = { status: "SAVED", revision: structuredClone(input.revision) } as const;
    this.mutations.set(`${input.sessionId}:${input.clientMutationId}`, result);
    this.emit(input.sessionId, input.revision.id, "essay.revision_saved", "AUTOSAVE_SUCCEEDED", input.clientMutationId);
    return result;
  }
  sessionCount() { return this.workspaces.size; }
  async seedUncommittedRevision(sessionId: string, value: unknown) { this.uncommitted.set(sessionId, [...(this.uncommitted.get(sessionId) ?? []), value]); }
  currentRevisionSnapshot(sessionId: string) { return this.workspaces.get(sessionId)?.revision; }
  revisionCountSnapshot(sessionId: string) { return this.revisions.get(sessionId)?.length ?? 0; }
  domainEventSnapshots() { return this.recorder?.all() ?? []; }
  private emit(sessionId: string, revisionId: string, eventType: "essay.session_created" | "essay.revision_saved", reasonCode: "SESSION_STARTED" | "AUTOSAVE_SUCCEEDED", key: string) {
    this.recorder?.append(createDomainEvent({ eventType, aggregateType: "essay_session", aggregateId: stableUuid(sessionId), essayRevisionId: stableUuid(revisionId), occurredAt: new Date(), correlationId: stableUuid(`correlation:${sessionId}`), causationId: stableUuid(`causation:${key}`), idempotencyKey: stableHash({ eventType, key }), reasonCode, payload: {} }));
  }
}
