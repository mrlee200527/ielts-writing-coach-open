import type { TestObservationPort } from "../ports/test-observation.port";
import type { DomainEvent } from "../domain/events/domain-event.schema";
import { InMemoryEventRecorder } from "./in-memory-event-recorder";
import type { StoragePort } from "../ports/storage.port";
import { deepFreeze, type DeepReadonly } from "../domain/shared/deep-freeze";
import type { EssayObservationSource, TaskIntakeObservationSource } from "../ports/test-observation.port";

function frozenCopy<T>(value: T): DeepReadonly<T> {
  return deepFreeze(structuredClone(value));
}

export function createTestObservationAdapter(environment: string | undefined, recorder: InMemoryEventRecorder, storage?: StoragePort, essays?: EssayObservationSource, taskIntakes?: TaskIntakeObservationSource): TestObservationPort {
  if (environment !== "test") throw new Error("TEST_OBSERVATION_DISABLED");
  const allEvents = () => essays?.domainEventSnapshots() ?? recorder.all();
  const ordered = (events: readonly DomainEvent[]) => events
    .slice()
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId))
    .map(frozenCopy);
  return {
    eventsByCorrelation: (correlationId) => ordered(allEvents().filter((event) => event.correlationId === correlationId)),
    eventsByAggregate: (aggregateId) => ordered(allEvents().filter((event) => event.aggregateId === aggregateId)),
    snapshot: (collection, id) => {
      const value = storage?.get(collection, id);
      return value === undefined ? undefined : frozenCopy(value);
    },
    currentRevision: (sessionId) => { const value = essays?.currentRevisionSnapshot(sessionId); return value === undefined ? undefined : frozenCopy(value); },
    revisionCount: (sessionId) => essays?.revisionCountSnapshot(sessionId) ?? 0,
    taskIntake: (taskId) => { const value = taskIntakes?.taskIntakeSnapshot(taskId); return value === undefined ? undefined : frozenCopy(value); },
    taskContextVersions: (taskId) => frozenCopy(taskIntakes?.taskContextVersionSnapshots(taskId) ?? []),
    analysisAttempts: (taskId) => frozenCopy(taskIntakes?.analysisAttemptSnapshots(taskId) ?? []),
    waitForEvent: (predicate) => {
      const existing = allEvents().find(predicate);
      if (existing) return Promise.resolve(frozenCopy(existing));
      return new Promise((resolve) => {
        const unsubscribe = recorder.subscribe((event) => {
          if (!predicate(event)) return;
          unsubscribe();
          resolve(frozenCopy(event));
        });
      });
    },
  };
}
