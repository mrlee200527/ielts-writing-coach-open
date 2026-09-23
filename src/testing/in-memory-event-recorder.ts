import { domainEventSchema, type DomainEvent } from "../domain/events/domain-event.schema";
import { deepFreeze } from "../domain/shared/deep-freeze";

export class InMemoryEventRecorder {
  private readonly events: DomainEvent[] = [];
  private readonly listeners = new Set<(event: DomainEvent) => void>();

  append(event: DomainEvent): void {
    const recorded = deepFreeze(structuredClone(domainEventSchema.parse(event))) as DomainEvent;
    this.events.push(recorded);
    for (const listener of this.listeners) listener(recorded);
  }

  all(): readonly DomainEvent[] {
    return this.events;
  }

  subscribe(listener: (event: DomainEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
