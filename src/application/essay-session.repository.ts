import type { EssaySession } from "../domain/essay/essay.schema";
import type { EssayRevision } from "../domain/essay/revision.schema";
import type { WritingTask } from "../domain/essay/writing-task.schema";
import type { WritingTimerSnapshot } from "../domain/essay/writing-timer";

export interface WritingWorkspaceSnapshot {
  task: WritingTask;
  session: EssaySession;
  revision: EssayRevision;
  timer: WritingTimerSnapshot;
}

export interface EssaySessionRepository {
  findByClientRequestId(clientRequestId: string): Promise<WritingWorkspaceSnapshot | undefined>;
  create(input: WritingWorkspaceSnapshot & { clientRequestId: string }): Promise<void>;
  findWorkspace(sessionId: string): Promise<WritingWorkspaceSnapshot | undefined>;
  findMostRecentDraft(userId: string): Promise<WritingWorkspaceSnapshot | undefined>;
  findMutation(sessionId: string, clientMutationId: string): Promise<SaveRevisionResult | undefined>;
  saveRevision(input: { sessionId: string; expectedRevisionId: string; revision: EssayRevision; timer: WritingTimerSnapshot; clientMutationId: string }): Promise<SaveRevisionResult>;
}

export type SaveRevisionResult =
  | { status: "SAVED"; revision: EssayRevision }
  | { status: "ALREADY_SAVED"; revision: EssayRevision }
  | { status: "REVISION_CONFLICT"; currentRevisionId: string };
