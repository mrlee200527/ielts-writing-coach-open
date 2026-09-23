import type { ReasonCode } from "../domain/events/reason-codes";
import type { ScheduledTask, Scheduler } from "../domain/shared/clock";
import { isParagraphComplete } from "../domain/completion/paragraph-completeness";
import { paragraphTransition, type ParagraphTrigger } from "../domain/completion/paragraph-completion-machine";
import { evaluateStaleness } from "../domain/analysis/stale-result-policy";
import type { EssayStatus } from "../domain/essay/essay.schema";
import type { Clock } from "../domain/shared/clock";
import { stableHash } from "../domain/shared/hash";
import { CompletionEventEmitter, type EventRecorder } from "./completion-event-emitter";
import type { DomainEvent } from "../domain/events/domain-event.schema";
import {
  canonicalParagraphDependencyHash,
  parseParagraphDependencySnapshot,
  type ParagraphDependencySnapshot,
} from "../domain/essay/dependency-snapshot.schema";
import { DomainError } from "../domain/shared/errors";

export interface ParagraphCheckInput {
  sessionId: string;
  revisionId: string;
  text: string;
  dependencySnapshot: ParagraphDependencySnapshot;
  [key: string]: unknown;
}

const systemClock: Clock = { now: () => new Date() };

export class ParagraphCheckCoordinator {
  readonly requests: ParagraphCheckInput[] = [];
  get events(): readonly DomainEvent[] { return this.eventEmitter.events; }
  private readonly pending = new Map<string, { task: ScheduledTask; input: ParagraphCheckInput }>();
  private readonly requestedKeys = new Set<string>();
  private readonly eventEmitter: CompletionEventEmitter;

  constructor(private readonly scheduler: Scheduler, recorder?: EventRecorder, clock: Clock = systemClock) {
    this.eventEmitter = new CompletionEventEmitter(clock, recorder);
  }

  complete(input: ParagraphCheckInput, trigger: ParagraphTrigger): void {
    const normalized = this.normalize(input);
    if (paragraphTransition(trigger) === "REQUESTED") {
      this.cancelPending(normalized.dependencySnapshot.segmentId);
      this.request(normalized, "PARAGRAPH_MANUAL_REQUEST");
      return;
    }
    this.cancelPending(normalized.dependencySnapshot.segmentId);
    this.pending.set(normalized.dependencySnapshot.segmentId, { input: normalized, task: this.scheduler.schedule(3000, () => {
      if (!isParagraphComplete(normalized.text)) {
        this.pending.delete(normalized.dependencySnapshot.segmentId);
        this.eventEmitter.emit(this.eventInput(normalized), "paragraph.check_skipped", "INCOMPLETE");
        return;
      }
      this.request(normalized, "PARAGRAPH_STABLE");
    }) });
  }

  cancel(segmentId: string, reasonCode: Extract<ReasonCode, "PARAGRAPH_TEXT_CHANGED" | "PARAGRAPH_BOUNDARY_CHANGED" | "ESSAY_NOT_DRAFT">): void {
    const pending = this.pending.get(segmentId);
    this.cancelPending(segmentId);
    if (pending) this.eventEmitter.emit(this.eventInput(pending.input), "paragraph.check_cancelled", reasonCode);
  }

  acceptResult(expected: ParagraphCheckInput, actual: ParagraphCheckInput, essayStatus: EssayStatus): void {
    const normalizedExpected = this.normalize(expected);
    const normalizedActual = this.normalize(actual);
    const result = evaluateStaleness(essayStatus, normalizedExpected.dependencySnapshot, normalizedActual.dependencySnapshot);
    if (result.stale) this.eventEmitter.emit(this.eventInput(normalizedExpected), "paragraph.result_stale", result.reasonCode);
  }

  private request(input: ParagraphCheckInput, reasonCode: Extract<ReasonCode, "PARAGRAPH_STABLE" | "PARAGRAPH_MANUAL_REQUEST">): void {
    const normalized = this.normalize(input);
    this.pending.delete(normalized.dependencySnapshot.segmentId);
    const requestKey = `${normalized.dependencySnapshot.segmentId}:${canonicalParagraphDependencyHash(normalized.dependencySnapshot)}`;
    if (this.requestedKeys.has(requestKey)) return;
    this.requestedKeys.add(requestKey);
    this.requests.push(normalized);
    this.eventEmitter.emit(this.eventInput(normalized), "paragraph.check_requested", reasonCode);
  }

  private cancelPending(segmentId: string): void {
    const pending = this.pending.get(segmentId);
    if (pending) this.scheduler.cancel(pending.task);
    this.pending.delete(segmentId);
  }

  private normalize(input: ParagraphCheckInput): ParagraphCheckInput {
    const dependencySnapshot = parseParagraphDependencySnapshot(input.dependencySnapshot);
    if (dependencySnapshot.textHash !== stableHash(input.text)) throw new DomainError("PARAGRAPH_TEXT_HASH_MISMATCH");
    return { ...input, dependencySnapshot };
  }

  private eventInput(input: ParagraphCheckInput) {
    return {
      sessionId: input.sessionId,
      revisionId: input.revisionId,
      segmentId: input.dependencySnapshot.segmentId,
      textHash: input.dependencySnapshot.textHash,
      dependencyHash: canonicalParagraphDependencyHash(input.dependencySnapshot),
    };
  }
}
