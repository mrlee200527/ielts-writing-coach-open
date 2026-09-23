import type { TaskContext, TaskFact } from "./task-context.schema";

export interface TaskContextFactSource {
  context: TaskContext | null;
}

export function certainFacts(source: TaskContextFactSource): readonly TaskFact[] {
  return source.context?.facts.filter((fact) => fact.certainty === "CERTAIN") ?? [];
}

export function canUseAsSoleErrorEvidence(facts: readonly TaskFact[]): boolean {
  return facts.some((fact) => fact.certainty === "CERTAIN");
}
