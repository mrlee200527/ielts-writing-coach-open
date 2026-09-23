import { randomUUID } from "node:crypto";
import { createNextRevision } from "../domain/essay/revision-service";
import type { EssaySessionRepository } from "./essay-session.repository";
import type { WritingTimerSnapshot } from "../domain/essay/writing-timer";

export async function saveEssayDraft(repository: EssaySessionRepository, input: { sessionId: string; expectedRevisionId: string; plainText: string; content: unknown; timer: WritingTimerSnapshot; clientMutationId: string; now: Date }) {
  const replay = await repository.findMutation(input.sessionId, input.clientMutationId);
  if (replay) return replay;
  const workspace = await repository.findWorkspace(input.sessionId);
  if (!workspace) throw new Error("ESSAY_NOT_FOUND");
  if (workspace.session.status !== "DRAFT") throw new Error("ESSAY_NOT_DRAFT");
  const revision = createNextRevision({ id: randomUUID(), sessionId: input.sessionId, previous: workspace.revision, plainText: input.plainText, content: input.content, now: input.now });
  return repository.saveRevision({ sessionId: input.sessionId, expectedRevisionId: input.expectedRevisionId, revision, timer: input.timer, clientMutationId: input.clientMutationId });
}
