import { randomUUID } from "node:crypto";
import { createEssaySession } from "../domain/essay/essay-session-service";
import type { EssaySessionRepository } from "./essay-session.repository";

export async function createEssaySessionUseCase(repository: EssaySessionRepository, input: { clientRequestId: string; userId: string; promptText: string; taskType?: "TASK_1" | "TASK_2"; txtFileName?: string; now: Date }) {
  const existing = await repository.findByClientRequestId(input.clientRequestId);
  if (existing) return existing;
  const created = createEssaySession({ taskId: randomUUID(), sessionId: randomUUID(), revisionId: randomUUID(), userId: input.userId, promptText: input.promptText, taskType: input.taskType, txtFileName: input.txtFileName, now: input.now });
  try { await repository.create({ ...created, clientRequestId: input.clientRequestId }); }
  catch (error) {
    const concurrent = await repository.findByClientRequestId(input.clientRequestId);
    if (concurrent) return concurrent;
    throw error;
  }
  return created;
}
