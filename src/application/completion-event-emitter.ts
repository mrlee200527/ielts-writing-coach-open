import type { Clock } from "../domain/shared/clock";
import { stableUuid } from "../domain/shared/ids";
import { createDomainEvent } from "../domain/events/event-factory";
import type { EventType } from "../domain/events/event-types";
import type { ReasonCode } from "../domain/events/reason-codes";
import type { DomainEvent } from "../domain/events/domain-event.schema";
import { stableHash } from "../domain/shared/hash";

export interface EventRecorder {
  append(event: DomainEvent): void;
}

export interface CompletionEventInput {
  sessionId: string;
  revisionId: string;
  segmentId: string;
  textHash: string;
  dependencyHash: string;
}

export class CompletionEventEmitter {
  readonly events: DomainEvent[] = [];

  constructor(private readonly clock: Clock, private readonly recorder?: EventRecorder) {}

  emit(input: CompletionEventInput, eventType: EventType, reasonCode: ReasonCode, payload: Record<string, unknown> = {}): void {
    const idempotencyKey = stableHash({ eventType, segmentId: input.segmentId, textHash: input.textHash, dependencyHash: input.dependencyHash });
    const event = createDomainEvent({
      eventType,
      aggregateType: "essay_session",
      aggregateId: stableUuid(input.sessionId),
      essayRevisionId: stableUuid(input.revisionId),
      segmentId: stableUuid(input.segmentId),
      textHash: input.textHash,
      dependencyHash: input.dependencyHash,
      occurredAt: this.clock.now(),
      correlationId: stableUuid(`correlation:${input.sessionId}`),
      causationId: stableUuid(`causation:${input.revisionId}:${input.segmentId}`),
      idempotencyKey,
      reasonCode,
      payload,
    });
    this.events.push(event);
    this.recorder?.append(event);
  }
}
