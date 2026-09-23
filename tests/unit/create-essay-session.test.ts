import { describe, expect, it } from "vitest";
import { createEssaySessionUseCase } from "../../src/application/create-essay-session";
import { InMemoryEssaySessionRepository } from "../../src/testing/in-memory-essay-session.repository";

describe("create essay session", () => {
  it("creates atomically and replays the same client request id", async () => {
    const repository = new InMemoryEssaySessionRepository();
    const input = { clientRequestId: "request-1", userId: "00000000-0000-4000-8000-000000000104", promptText: "Describe the chart.", now: new Date("2026-08-14T01:00:00.000Z") };
    const first = await createEssaySessionUseCase(repository, input);
    const replay = await createEssaySessionUseCase(repository, { ...input, now: new Date("2026-08-14T02:00:00.000Z") });
    expect(replay.session.id).toBe(first.session.id);
    expect(repository.sessionCount()).toBe(1);
  });

  it("persists Task 2 without requiring an image migration", async () => {
    const repository = new InMemoryEssaySessionRepository();
    const created = await createEssaySessionUseCase(repository, {
      clientRequestId: "task-2-request",
      userId: "00000000-0000-4000-8000-000000000104",
      promptText: "Some people believe public transport should be free. Discuss both views and give your opinion.",
      taskType: "TASK_2",
      txtFileName: "C5-T2-T1.txt",
      now: new Date("2026-08-15T01:00:00.000Z"),
    });

    expect(created.task.imagePlaceholderKind).toBe("TASK_2_NOT_REQUIRED");
    expect(created.task.imageBlobId).toBeNull();
    expect(created.task.txtFileName).toBe("C5-T2-T1.txt");
    await expect(repository.findWorkspace(created.session.id)).resolves.toMatchObject({
      task: { txtFileName: "C5-T2-T1.txt", promptText: "Some people believe public transport should be free. Discuss both views and give your opinion." },
    });
  });
});
