import { essaySessionSchema } from "./essay.schema";
import { createNextRevision } from "./revision-service";
import { writingTaskSchema } from "./writing-task.schema";

interface CreateEssaySessionInput {
  taskId: string;
  sessionId: string;
  revisionId: string;
  userId: string;
  promptText: string;
  txtFileName?: string | null;
  now: Date;
  taskType?: "TASK_1" | "TASK_2";
}

export function createEssaySession(input: CreateEssaySessionInput) {
  const task = writingTaskSchema.parse({ id: input.taskId, promptText: input.promptText, txtFileName: input.txtFileName, imagePlaceholderKind: input.taskType === "TASK_2" ? "TASK_2_NOT_REQUIRED" : "TASK_1_PENDING" });
  const revision = createNextRevision({
    id: input.revisionId,
    sessionId: input.sessionId,
    plainText: "",
    content: { type: "doc", content: [] },
    now: input.now,
  });
  const session = essaySessionSchema.parse({
    id: input.sessionId,
    userId: input.userId,
    taskId: input.taskId,
    status: "DRAFT",
    currentRevisionId: revision.id,
    startedAt: input.now.toISOString(),
  });
  return { task, session, revision, timer: { elapsedMs: 0, runningSince: input.now.toISOString() } } as const;
}
