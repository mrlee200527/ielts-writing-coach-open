import { describe, expect, it } from "vitest";
import { SentenceCheckCoordinator } from "../../src/application/sentence-check-coordinator";
import { ManualClock } from "../../src/testing/manual-clock";
import { ManualScheduler } from "../../src/testing/manual-scheduler";

const dependencySnapshot = {
  segmentId: "00000000-0000-4000-8000-000000000003",
  textHash: "t1",
  boundaryHash: "b1",
  contextHash: "c1",
};
const input = { sessionId: "e1", revisionId: "r1", dependencySnapshot };

describe("sentence completion machine", () => {
  it("requests once at 1500 ms but not 1499 ms", () => {
    const clock = new ManualClock();
    const scheduler = new ManualScheduler(clock);
    const coordinator = new SentenceCheckCoordinator(scheduler);
    coordinator.complete(input, "PUNCTUATION_PAUSE");
    scheduler.advanceBy(1499);
    expect(coordinator.requests).toHaveLength(0);
    scheduler.advanceBy(1);
    expect(coordinator.requests).toHaveLength(1);
    coordinator.complete(input, "PUNCTUATION_PAUSE");
    scheduler.advanceBy(1500);
    expect(coordinator.requests).toHaveLength(1);
  });

  it("requests immediately for cursor and next sentence triggers", () => {
    const coordinator = new SentenceCheckCoordinator(new ManualScheduler(new ManualClock()));
    coordinator.complete(input, "CURSOR_LEFT");
    coordinator.complete({ ...input, dependencySnapshot: { ...dependencySnapshot, textHash: "t2" } }, "NEXT_SENTENCE_STARTED");
    expect(coordinator.requests).toHaveLength(2);
    expect(coordinator.events.map((event) => event.reasonCode)).toEqual(["SENTENCE_CURSOR_LEFT", "SENTENCE_NEXT_STARTED"]);
  });

  it("cancels waiting work when text changes", () => {
    const scheduler = new ManualScheduler(new ManualClock());
    const coordinator = new SentenceCheckCoordinator(scheduler);
    coordinator.complete(input, "PUNCTUATION_PAUSE");
    coordinator.cancel(input.dependencySnapshot.segmentId, "SENTENCE_TEXT_CHANGED");
    scheduler.advanceBy(1500);
    expect(coordinator.requests).toHaveLength(0);
    expect(coordinator.events.at(-1)?.eventType).toBe("sentence.check_cancelled");
  });

  it.each(["textHash", "boundaryHash", "contextHash"] as const)("marks a changed %s stale", (field) => {
    const coordinator = new SentenceCheckCoordinator(new ManualScheduler(new ManualClock()));
    coordinator.complete(input, "CURSOR_LEFT");
    coordinator.acceptResult(input, { ...input, dependencySnapshot: { ...dependencySnapshot, [field]: `${field}:changed` } }, "DRAFT");
    expect(coordinator.events.at(-1)).toMatchObject({ eventType: "sentence.result_stale", reasonCode: "DEPENDENCY_CHANGED" });
  });

  it("does not stale unrelated revision or body changes", () => {
    const coordinator = new SentenceCheckCoordinator(new ManualScheduler(new ManualClock()));
    coordinator.acceptResult(input, { ...input, revisionId: "r2", unrelatedBodyHash: "other" }, "DRAFT");
    expect(coordinator.events).toHaveLength(0);
  });

  it("rejects an invalid dependency snapshot before scheduling", () => {
    const coordinator = new SentenceCheckCoordinator(new ManualScheduler(new ManualClock()));
    const invalid = { ...input, dependencySnapshot: { ...dependencySnapshot, contextHash: "" } };
    expect(() => coordinator.complete(invalid, "CURSOR_LEFT")).toThrow();
    expect(coordinator.requests).toHaveLength(0);
  });
});
