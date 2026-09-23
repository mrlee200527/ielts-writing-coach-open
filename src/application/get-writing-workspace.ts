import type { EssaySessionRepository } from "./essay-session.repository";

export function getWritingWorkspace(repository: EssaySessionRepository, sessionId: string) {
  return repository.findWorkspace(sessionId);
}
