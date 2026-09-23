import { describe, expect, it } from "vitest";
import { ParagraphCheckCoordinator } from "../../src/application/paragraph-check-coordinator";
import { stableHash } from "../../src/domain/shared/hash";
import { ManualClock } from "../../src/testing/manual-clock";
import { ManualScheduler } from "../../src/testing/manual-scheduler";

const dependencySnapshot = {
  segmentId: "00000000-0000-4000-8000-000000000004",
  textHash: stableHash("The chart rose."),
  boundaryHash: "b1",
  adjacentSummaryHash: "a1",
  taskContextVersionId: "00000000-0000-4000-8000-000000000005",
  memoryProjectionVersion: 1,
};
const input = { sessionId: "e1", revisionId: "r1", text: "The chart rose.", dependencySnapshot };

describe("paragraph completion machine", () => {
  it("requests at 3000 ms but not 2999 ms", () => {
    const scheduler = new ManualScheduler(new ManualClock());
    const coordinator = new ParagraphCheckCoordinator(scheduler);
    coordinator.complete(input, "AUTO");
    scheduler.advanceBy(2999);
    expect(coordinator.requests).toHaveLength(0);
    scheduler.advanceBy(1);
    expect(coordinator.requests).toHaveLength(1);
  });

  it("skips incomplete automatic paragraphs", () => {
    const scheduler = new ManualScheduler(new ManualClock());
    const coordinator = new ParagraphCheckCoordinator(scheduler);
    coordinator.complete({ ...input, text: "placeholder", dependencySnapshot: { ...dependencySnapshot, textHash: stableHash("placeholder") } }, "AUTO");
    scheduler.advanceBy(3000);
    expect(coordinator.requests).toHaveLength(0);
    expect(coordinator.events.at(-1)).toMatchObject({ eventType: "paragraph.check_skipped", reasonCode: "INCOMPLETE" });
  });

  it("manual checks bypass completeness and waiting", () => {
    const coordinator = new ParagraphCheckCoordinator(new ManualScheduler(new ManualClock()));
    coordinator.complete({ ...input, text: "", dependencySnapshot: { ...dependencySnapshot, textHash: stableHash("") } }, "MANUAL");
    expect(coordinator.requests).toHaveLength(1);
  });

  it("cancels pending automatic checks", () => {
    const scheduler = new ManualScheduler(new ManualClock());
    const coordinator = new ParagraphCheckCoordinator(scheduler);
    coordinator.complete(input, "AUTO");
    coordinator.cancel(input.dependencySnapshot.segmentId, "PARAGRAPH_BOUNDARY_CHANGED");
    scheduler.advanceBy(3000);
    expect(coordinator.requests).toHaveLength(0);
  });

  it.each([
    "textHash",
    "boundaryHash",
    "adjacentSummaryHash",
    "taskContextVersionId",
    "memoryProjectionVersion",
  ] as const)("marks a changed %s stale", (field) => {
    const coordinator = new ParagraphCheckCoordinator(new ManualScheduler(new ManualClock()));
    coordinator.complete(input, "MANUAL");
    const changed = field === "memoryProjectionVersion"
      ? dependencySnapshot.memoryProjectionVersion + 1
      : field === "taskContextVersionId"
        ? "00000000-0000-4000-8000-000000000006"
        : field === "textHash"
          ? stableHash("The chart fell.")
          : `${field}:changed`;
    coordinator.acceptResult(input, {
      ...input,
      text: field === "textHash" ? "The chart fell." : input.text,
      dependencySnapshot: { ...dependencySnapshot, [field]: changed },
    }, "DRAFT");
    expect(coordinator.events.at(-1)).toMatchObject({ eventType: "paragraph.result_stale", reasonCode: "DEPENDENCY_CHANGED" });
  });

  it("does not stale unrelated revision or body changes", () => {
    const coordinator = new ParagraphCheckCoordinator(new ManualScheduler(new ManualClock()));
    coordinator.acceptResult(input, { ...input, revisionId: "r2", unrelatedBodyHash: "other" }, "DRAFT");
    expect(coordinator.events).toHaveLength(0);
  });

  it("rejects an invalid dependency snapshot before scheduling", () => {
    const coordinator = new ParagraphCheckCoordinator(new ManualScheduler(new ManualClock()));
    const invalid = { ...input, dependencySnapshot: { ...dependencySnapshot, memoryProjectionVersion: -1 } };
    expect(() => coordinator.complete(invalid, "MANUAL")).toThrow();
    expect(coordinator.requests).toHaveLength(0);
  });

  it("rejects a typed snapshot whose text hash does not match the target text", () => {
    const coordinator = new ParagraphCheckCoordinator(new ManualScheduler(new ManualClock()));
    expect(() => coordinator.complete({ ...input, text: "Different text." }, "MANUAL")).toThrow("PARAGRAPH_TEXT_HASH_MISMATCH");
    expect(coordinator.requests).toHaveLength(0);
  });
});
