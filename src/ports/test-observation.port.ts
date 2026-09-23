import type { DomainEvent } from "../domain/events/domain-event.schema";

export interface TestObservationPort {
  eventsByCorrelation(correlationId: string): readonly Readonly<DomainEvent>[];
  eventsByAggregate(aggregateId: string): readonly Readonly<DomainEvent>[];
  snapshot(collection: string, id: string): unknown | undefined;
  currentRevision(sessionId: string): unknown | undefined;
  revisionCount(sessionId: string): number;
  taskIntake(taskId: string): unknown | undefined;
  taskContextVersions(taskId: string): readonly unknown[];
  analysisAttempts(taskId: string): readonly unknown[];
  waitForEvent(predicate: (event: Readonly<DomainEvent>) => boolean): Promise<Readonly<DomainEvent>>;
}

export interface TaskIntakeObservationSource {
  taskIntakeSnapshot(taskId: string): unknown | undefined;
  taskContextVersionSnapshots(taskId: string): readonly unknown[];
  analysisAttemptSnapshots(taskId: string): readonly unknown[];
}

export interface EssayObservationSource {
  currentRevisionSnapshot(sessionId: string): unknown | undefined;
  revisionCountSnapshot(sessionId: string): number;
  domainEventSnapshots(): readonly DomainEvent[];
}
