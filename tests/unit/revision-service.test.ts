import { describe, expect, it } from "vitest";
import { createNextRevision } from "../../src/domain/essay/revision-service";

describe("revision service", () => {
  it("creates an immutable monotonic snapshot", () => {
    const previous = { revisionNo: 2 };
    const revision = createNextRevision({
      id: "00000000-0000-4000-8000-000000000001",
      sessionId: "00000000-0000-4000-8000-000000000002",
      previous,
      plainText: "The chart shows growth.",
      content: { type: "doc" },
      now: new Date("2026-08-13T13:00:00Z"),
    });

    expect(revision.revisionNo).toBe(3);
    expect(revision.wordCount).toBe(4);
    expect(revision.textHash).toMatch(/^sha256:/);
    expect(Object.isFrozen(revision)).toBe(true);
    expect(previous).toEqual({ revisionNo: 2 });
  });
});
