import { randomUUID } from "node:crypto";

import { domainEventSchema, type DomainEvent } from "./domain-event.schema";

type EventInput = Omit<DomainEvent, "eventId" | "occurredAt" | "payloadVersion"> & {
  eventId?: string;
  occurredAt: Date;
};

export function createDomainEvent(input: EventInput): DomainEvent {
  return domainEventSchema.parse({
    ...input,
    eventId: input.eventId ?? randomUUID(),
    occurredAt: input.occurredAt.toISOString(),
    payloadVersion: 1,
  });
}
