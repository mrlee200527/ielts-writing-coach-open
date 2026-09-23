import type { ScheduledTask, Scheduler } from "../../domain/shared/clock";
import { computeChangedSpan } from "../../domain/feedback/changed-span";
import { locateInstantEvidence } from "./instant-feedback-location";
import { detectStablePrefix } from "./stable-prefix";

export type InstantIssueKind = "language_error" | "confirmed_error" | "ielts_coaching";
export type InstantIssue = {
  type: "grammar" | "spelling" | "vocabulary" | "task_accuracy" | "task_relevance" | "comparison" | "clarity" | "positive";
  subtype: string;
  severity: "high" | "medium" | "low";
  targetText: string;
  messageZh: string;
  labelEn: string;
  fingerprint: string;
  kind: InstantIssueKind;
};
export type InstantCheckResult = { status: "issues_found" | "no_high_value_issue"; issues: InstantIssue[] };
export type InstantCheckRequest = { currentText: string; previousAnalyzedText: string; revisionId: string; taskType: "TASK_1" | "TASK_2"; requestId: string; inspectFull?: boolean };
type Edit = { text: string; revisionId: string; taskType: "TASK_1" | "TASK_2" };
export type InstantCheckSnapshot = { state: "IDLE" | "COUNTING" | "ANALYZING"; issues: InstantIssue[]; error?: string; lastResult?: "issues_found" | "no_high_value_issue" };
export type InstantCheckControllerDiagnostic = { requestId: string; outcome: "ACCEPTED" | "STALE" | "FAILED"; finalLastResult: InstantCheckSnapshot["lastResult"] | null };
export type InFlightOwnership = { requestId: string; ownedStablePrefix: string; lifecycleGeneration: number };

/** An active issue stays only while its evidence is uniquely locatable in the current text (article-level issues have no locatable evidence and are kept). */
const keepActive = (issue: InstantIssue, text: string) => issue.targetText === "" || locateInstantEvidence(text, [issue]).length === 1;
/** Whether the issue's evidence lies inside the changed span (the region the latest analysis owns). */
const overlapsSpan = (issue: InstantIssue, text: string, span: { targetStart: number; targetEnd: number }) => {
  if (!issue.targetText) return false;
  const locations = locateInstantEvidence(text, [issue]);
  if (locations.length !== 1) return false;
  return locations[0].from < span.targetEnd && locations[0].to > span.targetStart;
};

export class InstantCheckController {
  snapshot: InstantCheckSnapshot = { state: "IDLE", issues: [] };
  private timer?: ScheduledTask;
  private latest?: Edit;
  private editVersion = 0;
  private inFlight?: Promise<void>;
  private inFlightOwnership?: InFlightOwnership;
  private acceptedStablePrefix = "";
  private hasAcceptedBaseline = false;
  private acceptedNaturalChecks = 0;
  private started = false;
  private lifecycleGeneration = 0;
  constructor(private readonly scheduler: Scheduler, private readonly request: (input: InstantCheckRequest) => Promise<InstantCheckResult>, private readonly observe: (snapshot: InstantCheckSnapshot) => void = () => undefined, private readonly diagnostic: (event: InstantCheckControllerDiagnostic) => void = () => undefined) {}
  private publish(next: InstantCheckSnapshot) { this.snapshot = next; this.observe({ ...next, issues: [...next.issues] }); }
  private scheduleNextTick() {
    this.timer = this.scheduler.schedule(15_000, () => {
      this.timer = undefined;
      this.scheduleNextTick();
      void this.evaluateWindow();
    });
  }
  start() { if (this.started) return; this.started = true; this.scheduleNextTick(); }
  stop() {
    if (this.timer) this.scheduler.cancel(this.timer);
    this.timer = undefined;
    this.started = false;
    this.editVersion += 1;
    this.lifecycleGeneration += 1;
  }
  edit(value: Edit) {
    this.start();
    this.latest = value;
    this.editVersion += 1;
    // Every editor change re-validates the active set: issues whose evidence no longer
    // exists immediately exit so decorations, bubble and cards disappear right away.
    const active = this.snapshot.issues.filter((issue) => keepActive(issue, value.text));
    const ownedRequestIsCurrent = this.inFlightOwnership
      ? detectStablePrefix(value.text).stablePrefix.startsWith(this.inFlightOwnership.ownedStablePrefix)
      : false;
    this.publish({ ...this.snapshot, issues: active, state: this.inFlight && ownedRequestIsCurrent ? "ANALYZING" : "COUNTING", error: undefined });
  }
  async finalCheck(value: Edit) {
    this.start();
    this.latest = value;
    this.editVersion += 1;
    if (this.inFlight) await this.inFlight;
    await this.analyze(true);
  }
  private async evaluateWindow() {
    if (!this.latest || this.inFlight) {
      if (!this.inFlight) this.publish({ ...this.snapshot, state: "COUNTING" });
      return;
    }
    const currentStablePrefix = detectStablePrefix(this.latest.text).stablePrefix;
    if (!currentStablePrefix || currentStablePrefix === this.acceptedStablePrefix) {
      this.publish({ ...this.snapshot, state: "COUNTING" });
      return;
    }
    const previousText = this.acceptedStablePrefix;
    const inspectFull = !this.hasAcceptedBaseline || (this.acceptedNaturalChecks + 1) % 4 === 0;
    await this.analyze(inspectFull, previousText, true, currentStablePrefix);
  }
  private async analyze(inspectFull = false, previousText = "", natural = false, ownedText?: string) {
    if (!this.latest) return;
    const target = this.latest;
    const targetVersion = this.editVersion;
    const targetLifecycle = this.lifecycleGeneration;
    const currentText = ownedText ?? target.text;
    const bootstrap = !this.hasAcceptedBaseline;
    const requestId = globalThis.crypto.randomUUID();
    const ownership: InFlightOwnership = { requestId, ownedStablePrefix: currentText, lifecycleGeneration: targetLifecycle };
    this.inFlightOwnership = ownership;
    this.publish({ ...this.snapshot, state: "ANALYZING", error: undefined });
    const operation = (async () => {
      try {
      const result = await this.request({ currentText, previousAnalyzedText: previousText, revisionId: target.revisionId, taskType: target.taskType, requestId, inspectFull });
      if (!this.isCurrentRequest(ownership, natural, targetVersion)) { this.diagnostic({ requestId, outcome: "STALE", finalLastResult: this.snapshot.lastResult ?? null }); return; }
      // The analysis owns the changed span: issues inside it are refreshed by the new
      // result; issues outside remain only while their evidence is still real.
      const span = inspectFull || !previousText
        ? { targetStart: 0, targetEnd: currentText.length }
        : computeChangedSpan(previousText, currentText);
      const resultFps = new Set<string>();
      const fresh: InstantIssue[] = [];
      for (const issue of result.issues) {
        if (resultFps.has(issue.fingerprint)) continue;
        resultFps.add(issue.fingerprint);
        fresh.push(issue);
      }
      const kept = inspectFull
        ? []
        : this.snapshot.issues.filter((issue) =>
          keepActive(issue, this.latest!.text) && !resultFps.has(issue.fingerprint) && !overlapsSpan(issue, currentText, span));
      this.publish({ state: "IDLE", issues: [...fresh, ...kept], lastResult: result.status });
      if (natural) {
        this.acceptedStablePrefix = currentText;
        this.hasAcceptedBaseline = true;
        if (!bootstrap) this.acceptedNaturalChecks += 1;
      }
      this.diagnostic({ requestId, outcome: "ACCEPTED", finalLastResult: result.status });
    } catch {
      if (!this.isCurrentRequest(ownership, natural, targetVersion)) {
        this.diagnostic({ requestId, outcome: "STALE", finalLastResult: this.snapshot.lastResult ?? null });
        return;
      }
      this.publish({ ...this.snapshot, state: "IDLE", error: "本轮 AI 检查失败，将在下一轮重试。写作不会受到影响。" });
      this.diagnostic({ requestId, outcome: "FAILED", finalLastResult: null });
    } finally {
      this.inFlight = undefined;
      if (this.inFlightOwnership?.requestId === requestId) this.inFlightOwnership = undefined;
    } })();
    this.inFlight = operation;
    await operation;
  }
  private isCurrentRequest(ownership: InFlightOwnership, natural: boolean, editVersion: number) {
    if (!this.started || this.lifecycleGeneration !== ownership.lifecycleGeneration) return false;
    return natural
      ? detectStablePrefix(this.latest?.text ?? "").stablePrefix.startsWith(ownership.ownedStablePrefix)
      : this.editVersion === editVersion;
  }
}
