import { describe, expect, it } from "vitest";
import { InMemoryEventRecorder } from "../../src/testing/in-memory-event-recorder";
import { createTestObservationAdapter } from "../../src/testing/test-observation.adapter";
import { InMemoryStorageFake } from "../../src/testing/in-memory-storage.fake";
import { SentenceCheckCoordinator } from "../../src/application/sentence-check-coordinator";
import { ManualClock } from "../../src/testing/manual-clock";
import { ManualScheduler } from "../../src/testing/manual-scheduler";
import { InMemoryEssaySessionRepository } from "../../src/testing/in-memory-essay-session.repository";
import { createEssaySessionUseCase } from "../../src/application/create-essay-session";
import { saveEssayDraft } from "../../src/application/save-essay-draft";

const event = (eventId: string, occurredAt: string) => ({
  eventId,
  eventType: "sentence.check_requested" as const,
  aggregateType: "essay_session",
  aggregateId: "00000000-0000-4000-8000-000000000001",
  occurredAt,
  correlationId: "00000000-0000-4000-8000-000000000002",
  causationId: "00000000-0000-4000-8000-000000000003",
  idempotencyKey: `key:${eventId}`,
  reasonCode: "SENTENCE_PUNCTUATION_STABLE" as const,
  payloadVersion: 1 as const,
  payload: {},
});

describe("test observation port", () => {
  it("returns ordered immutable snapshots by correlation id", () => {
    const recorder = new InMemoryEventRecorder();
    recorder.append(event("00000000-0000-4000-8000-000000000005", "2026-08-13T13:00:01.000Z"));
    recorder.append(event("00000000-0000-4000-8000-000000000004", "2026-08-13T13:00:00.000Z"));
    const observation = createTestObservationAdapter("test", recorder);
    const events = observation.eventsByCorrelation("00000000-0000-4000-8000-000000000002");
    expect(events.map((item) => item.eventId)).toEqual([
      "00000000-0000-4000-8000-000000000004",
      "00000000-0000-4000-8000-000000000005",
    ]);
    expect(Object.isFrozen(events[0])).toBe(true);
  });

  it("refuses non-test environment composition", () => {
    expect(() => createTestObservationAdapter("production", new InMemoryEventRecorder())).toThrow("TEST_OBSERVATION_DISABLED");
  });

  it("reads immutable state snapshots and resolves event conditions", async () => {
    const recorder = new InMemoryEventRecorder();
    const storage = new InMemoryStorageFake();
    storage.put("analysis", "a1", { status: "QUEUED" });
    const observation = createTestObservationAdapter("test", recorder, storage);
    const waiting = observation.waitForEvent((candidate) => candidate.eventType === "sentence.check_requested");
    recorder.append(event("00000000-0000-4000-8000-000000000004", "2026-08-13T13:00:00.000Z"));
    await expect(waiting).resolves.toMatchObject({ eventType: "sentence.check_requested" });
    const snapshot = observation.snapshot("analysis", "a1") as { status: string };
    expect(snapshot.status).toBe("QUEUED");
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("observes events emitted by a completion coordinator", () => {
    const recorder = new InMemoryEventRecorder();
    const clock = new ManualClock(Date.parse("2026-08-13T13:00:00.000Z"));
    const coordinator = new SentenceCheckCoordinator(new ManualScheduler(clock), recorder, clock);
    coordinator.complete({
      sessionId: "00000000-0000-4000-8000-000000000001",
      revisionId: "00000000-0000-4000-8000-000000000002",
      dependencySnapshot: {
        segmentId: "00000000-0000-4000-8000-000000000003",
        textHash: "sha256:text",
        boundaryHash: "sha256:boundary",
        contextHash: "sha256:context",
      },
    }, "CURSOR_LEFT");

    const observation = createTestObservationAdapter("test", recorder);
    expect(observation.eventsByAggregate("00000000-0000-4000-8000-000000000001")).toHaveLength(1);
  });

  it("observes current revision, revision count, and save events", async () => {
    const recorder = new InMemoryEventRecorder();
    const repository = new InMemoryEssaySessionRepository(recorder);
    const created = await createEssaySessionUseCase(repository, { clientRequestId: "create-observed", userId: "00000000-0000-4000-8000-000000000104", promptText: "Describe.", now: new Date("2026-08-14T01:00:00.000Z") });
    await saveEssayDraft(repository, { sessionId: created.session.id, expectedRevisionId: created.revision.id, plainText: "Observed.", content: {}, timer: { elapsedMs: 1 }, clientMutationId: "save-observed", now: new Date("2026-08-14T01:00:01.000Z") });
    const observation = createTestObservationAdapter("test", recorder, undefined, repository);
    expect((observation.currentRevision(created.session.id) as { plainText: string }).plainText).toBe("Observed.");
    expect(observation.revisionCount(created.session.id)).toBe(2);
    expect(observation.eventsByAggregate(created.session.id).map((item) => item.eventType)).toEqual(["essay.session_created", "essay.revision_saved"]);
  });
});
