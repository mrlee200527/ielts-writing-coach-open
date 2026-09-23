import type { ScheduledTask, Scheduler } from "../../domain/shared/clock";
import type { WritingTimerSnapshot } from "../../domain/essay/writing-timer";

export interface DraftSnapshot { expectedRevisionId: string; plainText: string; content: unknown; timer: WritingTimerSnapshot }
export type DraftSaveResult = { status: "SAVED"; revisionId: string } | { status: "REVISION_CONFLICT"; currentRevisionId: string };
export interface DraftSaver { save(input: { mutationId: string; draft: DraftSnapshot }): Promise<DraftSaveResult> }
export type AutosaveState = "IDLE" | "DIRTY" | "SAVING" | "SAVED" | "SAVE_FAILED" | "CONFLICT";

interface SaveAttempt { mutationId: string; draft: DraftSnapshot }

export class AutosaveController {
  state: AutosaveState = "IDLE";
  currentDraft!: DraftSnapshot;
  private pending?: DraftSnapshot;
  private retryAttempt?: SaveAttempt;
  private failedAttempt?: SaveAttempt;
  private task?: ScheduledTask;
  private saving = false;

  constructor(private readonly scheduler: Scheduler, private readonly saver: DraftSaver, private readonly observe: (state: AutosaveState) => void = () => undefined) {}

  private setState(state: AutosaveState) { this.state = state; this.observe(state); }

  initialize(draft: DraftSnapshot) { this.currentDraft = structuredClone(draft); }

  updateTimer(timer: WritingTimerSnapshot) {
    if (!this.currentDraft) return;
    this.currentDraft = { ...this.currentDraft, timer: structuredClone(timer) };
    if (this.state === "CONFLICT") return;
    this.pending = this.pending
      ? { ...this.pending, timer: structuredClone(timer) }
      : structuredClone(this.currentDraft);
    this.setState("DIRTY");
  }

  private advancePendingRevision(revisionId: string) {
    if (this.pending) this.pending = { ...this.pending, expectedRevisionId: revisionId };
  }

  change(draft: DraftSnapshot) {
    this.currentDraft = structuredClone(draft);
    if (this.state === "CONFLICT") return;
    this.pending = structuredClone(draft); this.failedAttempt = undefined; this.retryAttempt = undefined; this.setState("DIRTY");
    if (this.task) this.scheduler.cancel(this.task);
    this.task = this.scheduler.schedule(800, () => { this.task = undefined; void this.flush(); });
  }

  retry() {
    if (this.state === "CONFLICT") return;
    if (this.failedAttempt) this.retryAttempt = structuredClone(this.failedAttempt);
    else if (this.currentDraft) this.pending = structuredClone(this.currentDraft);
    void this.flush();
  }

  reload(draft: DraftSnapshot) {
    if (this.task) this.scheduler.cancel(this.task);
    this.task = undefined;
    this.pending = undefined;
    this.retryAttempt = undefined;
    this.failedAttempt = undefined;
    this.currentDraft = structuredClone(draft);
    this.setState("SAVED");
  }

  async flush() {
    if (this.saving || (!this.pending && !this.retryAttempt)) return;
    const attempt = this.retryAttempt ?? { mutationId: globalThis.crypto.randomUUID(), draft: this.pending! };
    this.retryAttempt = undefined; this.pending = undefined; this.saving = true; this.setState("SAVING");
    try {
      const result = await this.saver.save(attempt);
      if (result.status === "REVISION_CONFLICT") this.setState("CONFLICT");
      else {
        this.failedAttempt = undefined;
        this.currentDraft = { ...this.currentDraft, expectedRevisionId: result.revisionId };
        this.advancePendingRevision(result.revisionId);
        this.setState("SAVED");
      }
    } catch { this.failedAttempt = structuredClone(attempt); this.setState("SAVE_FAILED"); }
    finally {
      this.saving = false;
      if ((this.pending || this.retryAttempt) && this.state !== "CONFLICT") void this.flush();
    }
  }
}
