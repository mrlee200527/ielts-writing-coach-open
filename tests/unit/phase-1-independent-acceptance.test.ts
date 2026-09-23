import { describe, expect, it } from "vitest";

import { ParagraphCheckCoordinator } from "../../src/application/paragraph-check-coordinator";
import { SentenceCheckCoordinator } from "../../src/application/sentence-check-coordinator";
import { domainEventSchema } from "../../src/domain/events/domain-event.schema";
import { createNextRevision } from "../../src/domain/essay/revision-service";
import { stableHash } from "../../src/domain/shared/hash";
import { ControlledJobFake } from "../../src/testing/controlled-job.fake";
import { InMemoryEventRecorder } from "../../src/testing/in-memory-event-recorder";
import { InMemoryStorageFake } from "../../src/testing/in-memory-storage.fake";
import { ManualClock } from "../../src/testing/manual-clock";
import { ManualScheduler } from "../../src/testing/manual-scheduler";
import { createTestObservationAdapter } from "../../src/testing/test-observation.adapter";

const sentence = {
  sessionId: "00000000-0000-4000-8000-000000000001",
  revisionId: "00000000-0000-4000-8000-000000000002",
  dependencySnapshot: {
    segmentId: "00000000-0000-4000-8000-000000000003",
    textHash: "sha256:sentence",
    boundaryHash: "sha256:sentence-boundary",
    contextHash: "sha256:sentence-context",
  },
};

const paragraph = {
  sessionId: sentence.sessionId,
  revisionId: sentence.revisionId,
  text: "The chart rose.",
  dependencySnapshot: {
    segmentId: "00000000-0000-4000-8000-000000000004",
    textHash: stableHash("The chart rose."),
    boundaryHash: "sha256:paragraph-boundary",
    adjacentSummaryHash: "sha256:adjacent-summary",
    taskContextVersionId: "00000000-0000-4000-8000-000000000009",
    memoryProjectionVersion: 0,
  },
};

const event = {
  eventId: "00000000-0000-4000-8000-000000000005",
  eventType: "sentence.check_requested" as const,
  aggregateType: "essay_session",
  aggregateId: sentence.sessionId,
  essayRevisionId: sentence.revisionId,
  segmentId: sentence.dependencySnapshot.segmentId,
  textHash: sentence.dependencySnapshot.textHash,
  dependencyHash: "sha256:dependencies",
  occurredAt: "2026-08-13T13:00:00.000Z",
  correlationId: "00000000-0000-4000-8000-000000000006",
  causationId: "00000000-0000-4000-8000-000000000007",
  idempotencyKey: "sentence:key",
  reasonCode: "SENTENCE_PUNCTUATION_STABLE" as const,
  payloadVersion: 1 as const,
  payload: { dependency: { hash: "sha256:dependencies" } },
};

describe("Phase 1 independent acceptance", () => {
  it("AT-06 does not stale a result when only an unrelated revision changes", () => {
    const coordinator = new SentenceCheckCoordinator(new ManualScheduler(new ManualClock()));
    coordinator.complete(sentence, "CURSOR_LEFT");

    coordinator.acceptResult(
      sentence,
      { ...sentence, revisionId: "00000000-0000-4000-8000-000000000008" },
      "DRAFT",
    );

    expect(coordinator.events.filter((item) => item.eventType === "sentence.result_stale")).toHaveLength(0);
  });

  it("AT-07 coalesces duplicate paragraph candidates into one request", () => {
    const scheduler = new ManualScheduler(new ManualClock());
    const coordinator = new ParagraphCheckCoordinator(scheduler);

    coordinator.complete(paragraph, "AUTO");
    coordinator.complete(paragraph, "AUTO");
    scheduler.advanceBy(3000);

    expect(coordinator.requests).toHaveLength(1);
  });

  it("AT-04 cancels every pending timer for the same sentence segment", () => {
    const scheduler = new ManualScheduler(new ManualClock());
    const coordinator = new SentenceCheckCoordinator(scheduler);

    coordinator.complete(sentence, "PUNCTUATION_PAUSE");
    coordinator.complete(sentence, "PUNCTUATION_PAUSE");
    coordinator.cancel(sentence.dependencySnapshot.segmentId, "SENTENCE_TEXT_CHANGED");
    scheduler.advanceBy(1500);

    expect(coordinator.requests).toHaveLength(0);
  });

  it("emits observable events that satisfy the frozen event envelope", () => {
    const coordinator = new SentenceCheckCoordinator(new ManualScheduler(new ManualClock()));
    coordinator.complete(sentence, "CURSOR_LEFT");

    expect(domainEventSchema.safeParse(coordinator.events[0]).success).toBe(true);
  });

  it("keeps revision snapshots deeply immutable", () => {
    const revision = createNextRevision({
      id: sentence.revisionId,
      sessionId: sentence.sessionId,
      plainText: "The chart rose.",
      content: { blocks: [{ text: "original" }] },
      now: new Date("2026-08-13T13:00:00.000Z"),
    });
    const content = revision.content as { blocks: Array<{ text: string }> };

    expect(Object.isFrozen(content)).toBe(true);
    expect(Object.isFrozen(content.blocks)).toBe(true);
    expect(Object.isFrozen(content.blocks[0])).toBe(true);
  });

  it("returns deeply frozen observation payloads", () => {
    const recorder = new InMemoryEventRecorder();
    recorder.append(event);
    const observation = createTestObservationAdapter("test", recorder);
    const observed = observation.eventsByCorrelation(event.correlationId)[0];

    const payload = observed.payload as { dependency: { hash: string } };
    expect(Object.isFrozen(payload)).toBe(true);
    expect(Object.isFrozen(payload.dependency)).toBe(true);
  });

  it("rejects late and duplicate job completions from changing a terminal state", () => {
    const jobs = new ControlledJobFake();
    const job = jobs.enqueue({ name: "sentence-check", idempotencyKey: "same", payload: {} });
    jobs.start(job.id);
    jobs.complete(job.id, { analysisId: "first" });
    jobs.complete(job.id, { analysisId: "late-duplicate" });

    expect(jobs.status(job.id)).toEqual({ state: "COMPLETED", result: { analysisId: "first" } });
  });

  it("rolls back failed writes without corrupting prior state", async () => {
    const storage = new InMemoryStorageFake();
    storage.put("analysis", "existing", { status: "QUEUED" });

    await expect(storage.transaction((transaction) => {
      transaction.put("analysis", "existing", { status: "RUNNING" });
      transaction.put("analysis", "partial", { status: "QUEUED" });
      throw new Error("forced rollback");
    })).rejects.toThrow("forced rollback");

    expect(storage.get("analysis", "existing")).toEqual({ status: "QUEUED" });
    expect(storage.get("analysis", "partial")).toBeUndefined();
  });
});
