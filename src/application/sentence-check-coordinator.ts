import type { ReasonCode } from "../domain/events/reason-codes";
import type { ScheduledTask, Scheduler } from "../domain/shared/clock";
import { sentenceTransition, type SentenceTrigger } from "../domain/completion/sentence-completion-machine";
import { evaluateStaleness } from "../domain/analysis/stale-result-policy";
import type { EssayStatus } from "../domain/essay/essay.schema";
import type { Clock } from "../domain/shared/clock";
import { CompletionEventEmitter, type EventRecorder } from "./completion-event-emitter";
import type { DomainEvent } from "../domain/events/domain-event.schema";
import {
  canonicalSentenceDependencyHash,
  parseSentenceDependencySnapshot,
  type SentenceDependencySnapshot,
} from "../domain/essay/dependency-snapshot.schema";

export interface SentenceCheckInput {
  sessionId: string;
  revisionId: string;
  dependencySnapshot: SentenceDependencySnapshot;
  [key: string]: unknown;
}

const systemClock: Clock = { now: () => new Date() };

export class SentenceCheckCoordinator {
  readonly requests: SentenceCheckInput[] = [];
  get events(): readonly DomainEvent[] { return this.eventEmitter.events; }
  private readonly pending = new Map<string, { task: ScheduledTask; input: SentenceCheckInput }>();
  private readonly requestedKeys = new Set<string>();
  private readonly eventEmitter: CompletionEventEmitter;

  constructor(private readonly scheduler: Scheduler, recorder?: EventRecorder, clock: Clock = systemClock) {
    this.eventEmitter = new CompletionEventEmitter(clock, recorder);
  }

  complete(input: SentenceCheckInput, trigger: SentenceTrigger): void {
    const normalized = this.normalize(input);
    const state = sentenceTransition(trigger);
    if (state === "WAITING") {
      this.cancelPending(normalized.dependencySnapshot.segmentId);
      this.pending.set(normalized.dependencySnapshot.segmentId, { task: this.scheduler.schedule(1500, () => this.request(normalized)), input: normalized });
      return;
    }
    const reasonCode = trigger === "CURSOR_LEFT" ? "SENTENCE_CURSOR_LEFT" : "SENTENCE_NEXT_STARTED";
    this.request(normalized, reasonCode);
  }

  cancel(segmentId: string, reasonCode: Extract<ReasonCode, "SENTENCE_TEXT_CHANGED" | "SENTENCE_BOUNDARY_CHANGED" | "ESSAY_NOT_DRAFT">): void {
    const pending = this.pending.get(segmentId);
    this.cancelPending(segmentId);
    if (pending) this.eventEmitter.emit(this.eventInput(pending.input), "sentence.check_cancelled", reasonCode);
  }

  acceptResult(expected: SentenceCheckInput, actual: SentenceCheckInput, essayStatus: EssayStatus): void {
    const normalizedExpected = this.normalize(expected);
    const normalizedActual = this.normalize(actual);
    const result = evaluateStaleness(essayStatus, normalizedExpected.dependencySnapshot, normalizedActual.dependencySnapshot);
    if (result.stale) this.eventEmitter.emit(this.eventInput(normalizedExpected), "sentence.result_stale", result.reasonCode);
  }

  private request(input: SentenceCheckInput, reasonCode: Extract<ReasonCode, "SENTENCE_PUNCTUATION_STABLE" | "SENTENCE_CURSOR_LEFT" | "SENTENCE_NEXT_STARTED"> = "SENTENCE_PUNCTUATION_STABLE"): void {
    const normalized = this.normalize(input);
    this.pending.delete(normalized.dependencySnapshot.segmentId);
    const requestKey = `${normalized.dependencySnapshot.segmentId}:${canonicalSentenceDependencyHash(normalized.dependencySnapshot)}`;
    if (this.requestedKeys.has(requestKey)) return;
    this.requestedKeys.add(requestKey);
    this.requests.push(normalized);
    this.eventEmitter.emit(this.eventInput(normalized), "sentence.check_requested", reasonCode);
  }

  private cancelPending(segmentId: string): void {
    const pending = this.pending.get(segmentId);
    if (pending) this.scheduler.cancel(pending.task);
    this.pending.delete(segmentId);
  }

  private normalize(input: SentenceCheckInput): SentenceCheckInput {
    return { ...input, dependencySnapshot: parseSentenceDependencySnapshot(input.dependencySnapshot) };
  }

  private eventInput(input: SentenceCheckInput) {
    const dependencySnapshot = parseSentenceDependencySnapshot(input.dependencySnapshot);
    return {
      sessionId: input.sessionId,
      revisionId: input.revisionId,
      segmentId: dependencySnapshot.segmentId,
      textHash: dependencySnapshot.textHash,
      dependencyHash: canonicalSentenceDependencyHash(dependencySnapshot),
    };
  }
}
