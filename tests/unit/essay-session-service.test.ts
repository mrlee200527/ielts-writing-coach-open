import { describe, expect, it } from "vitest";
import { createEssaySession } from "../../src/domain/essay/essay-session-service";

describe("essay session service", () => {
  it("creates a draft session with placeholder task and empty first revision", () => {
    const result = createEssaySession({
      taskId: "00000000-0000-4000-8000-000000000101",
      sessionId: "00000000-0000-4000-8000-000000000102",
      revisionId: "00000000-0000-4000-8000-000000000103",
      userId: "00000000-0000-4000-8000-000000000104",
      promptText: "Summarise the information by selecting and reporting the main features.",
      now: new Date("2026-08-14T01:00:00.000Z"),
    });
    expect(result.task.imagePlaceholderKind).toBe("TASK_1_PENDING");
    expect(result.session).toMatchObject({ status: "DRAFT", currentRevisionId: result.revision.id });
    expect(result.revision).toMatchObject({ revisionNo: 1, plainText: "", wordCount: 0 });
    expect(result.timer).toEqual({ elapsedMs: 0, runningSince: "2026-08-14T01:00:00.000Z" });
  });
});
