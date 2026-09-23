import type { TaskIntakeRepository } from "./task-intake.repository";

const limitationMessages: Record<string, string> = {
  IMAGE_UNREADABLE: "The image could not be read reliably.",
  NO_SAFE_CONTEXT: "No reliable task context is available.",
};

export async function getTaskIntake(repository: TaskIntakeRepository, taskId: string) {
  const resolution = await repository.findResolution(taskId);
  return resolution ? { ...resolution, publicLimitationMessages: resolution.limitationCodes.map((code) => limitationMessages[code] ?? "Some task details may be unavailable.") } : undefined;
}
