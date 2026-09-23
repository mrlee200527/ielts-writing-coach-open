import { describe, expect, it } from "vitest";

import { createDomainEvent } from "../../src/domain/events/event-factory";
import { domainEventSchema } from "../../src/domain/events/domain-event.schema";
import { analysisRunSchema } from "../../src/domain/analysis/analysis.schema";
import { essaySessionSchema } from "../../src/domain/essay/essay.schema";
import { feedbackItemSchema } from "../../src/domain/feedback/feedback.schema";

const ids = {
  aggregateId: "00000000-0000-4000-8000-000000000001",
  correlationId: "00000000-0000-4000-8000-000000000002",
  causationId: "00000000-0000-4000-8000-000000000003",
  eventId: "00000000-0000-4000-8000-000000000004",
  revisionId: "00000000-0000-4000-8000-000000000005",
  segmentId: "00000000-0000-4000-8000-000000000006",
};

describe("domain schemas", () => {
  it("parses a versioned sentence event envelope", () => {
    const event = createDomainEvent({
      ...ids,
      eventType: "sentence.check_requested",
      aggregateType: "essay_session",
      essayRevisionId: ids.revisionId,
      segmentId: ids.segmentId,
      textHash: "sha256:sentence",
      dependencyHash: "sha256:dependencies",
      occurredAt: new Date("2026-08-13T13:00:00.000Z"),
      idempotencyKey: "sentence:key",
      reasonCode: "SENTENCE_PUNCTUATION_STABLE",
      payload: { trigger: "PUNCTUATION_PAUSE" },
    });

    expect(domainEventSchema.parse(event)).toEqual(event);
    expect(event.payloadVersion).toBe(1);
  });

  it("rejects missing correlation metadata", () => {
    const result = domainEventSchema.safeParse({
      eventId: ids.eventId,
      eventType: "sentence.check_requested",
      aggregateType: "essay_session",
      aggregateId: ids.aggregateId,
      occurredAt: "2026-08-13T13:00:00.000Z",
      payloadVersion: 1,
      idempotencyKey: "sentence:key",
      reasonCode: "SENTENCE_PUNCTUATION_STABLE",
      payload: {},
    });

    expect(result.success).toBe(false);
  });

  it("rejects free-text reason codes and unknown payload versions", () => {
    const base = {
      ...ids,
      eventType: "sentence.check_cancelled",
      aggregateType: "essay_session",
      occurredAt: "2026-08-13T13:00:00.000Z",
      idempotencyKey: "sentence:key",
      payload: {},
    };

    expect(
      domainEventSchema.safeParse({ ...base, payloadVersion: 1, reasonCode: "user changed it" }).success,
    ).toBe(false);
    expect(
      domainEventSchema.safeParse({ ...base, payloadVersion: 2, reasonCode: "SENTENCE_TEXT_CHANGED" }).success,
    ).toBe(false);
  });

  it("accepts explicit essay, analysis and feedback states", () => {
    expect(
      essaySessionSchema.parse({
        id: ids.aggregateId,
        userId: ids.correlationId,
        taskId: ids.eventId,
        status: "DRAFT",
        currentRevisionId: ids.revisionId,
        startedAt: "2026-08-13T13:00:00.000Z",
      }).status,
    ).toBe("DRAFT");

    expect(
      analysisRunSchema.parse({
        id: ids.eventId,
        sessionId: ids.aggregateId,
        revisionId: ids.revisionId,
        scope: "SENTENCE",
        status: "STALE",
        promptVersion: "sentence-v1",
        inputHash: "sha256:input",
        idempotencyKey: "sentence:key",
        createdAt: "2026-08-13T13:00:00.000Z",
      }).status,
    ).toBe("STALE");

    expect(
      feedbackItemSchema.parse({
        id: ids.eventId,
        analysisRunId: ids.causationId,
        segmentId: ids.segmentId,
        issueKey: "grammar:agreement:sentence-1",
        category: "GRAMMAR",
        state: "SUPPRESSED",
        createdAt: "2026-08-13T13:00:00.000Z",
      }).state,
    ).toBe("SUPPRESSED");
  });
});
