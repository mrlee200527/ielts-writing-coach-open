import { describe, expect, it, vi } from "vitest";
import { InstantCheckController, type InstantCheckRequest, type InstantCheckResult, type InstantCheckSnapshot } from "../../src/presentation/writing/instant-check-controller";
import { ManualClock } from "../../src/testing/manual-clock";
import { ManualScheduler } from "../../src/testing/manual-scheduler";

class ControlledRequester {
  calls: Array<InstantCheckRequest & { inspectFull?: boolean }> = [];
  pending: Array<{ resolve: (value: InstantCheckResult) => void; reject: (error: Error) => void }> = [];
  request = (input: InstantCheckRequest) => {
    this.calls.push(input);
    return new Promise<InstantCheckResult>((resolve, reject) => this.pending.push({ resolve, reject }));
  };
}

const edit = (text: string, revisionId = "revision-1") => ({ text, revisionId, taskType: "TASK_1" as const });
const makeIssue = (fingerprint: string, targetText = fingerprint, kind: "language_error" | "ielts_coaching" = "language_error") => ({ type: "grammar" as const, subtype: "tense", severity: "medium" as const, targetText, messageZh: "这里检查一下？", labelEn: "Grammar · tense", fingerprint, kind });

describe.each(["TASK_1", "TASK_2"] as const)("Stable Prefix lifecycle parity for %s", (taskType) => {
  const value = (text: string, revisionId = "revision-1") => ({ text, revisionId, taskType });

  it("keeps the 15 second phase when edits happen at 3s, 7s, 11s and 14.9s", () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    controller.start();
    scheduler.advanceBy(3000); controller.edit(value("A,"));
    scheduler.advanceBy(4000); controller.edit(value("AB,"));
    scheduler.advanceBy(4000); controller.edit(value("ABC,"));
    scheduler.advanceBy(3900); controller.edit(value("ABCD,"));
    scheduler.advanceBy(99); expect(requester.calls).toHaveLength(0);
    scheduler.advanceBy(1); expect(requester.calls).toHaveLength(1);
    expect(requester.calls[0].currentText).toBe("ABCD,");
  });

  it("does not request without a boundary or when the accepted Stable Prefix has not advanced", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    controller.edit(value("unfinished tail")); scheduler.advanceBy(15000);
    expect(requester.calls).toHaveLength(0);
    controller.edit(value("Stable.")); scheduler.advanceBy(15000);
    requester.pending[0].resolve({ status: "no_high_value_issue", issues: [] }); await Promise.resolve();
    controller.edit(value("Stable. editable tail")); scheduler.advanceBy(15000);
    expect(requester.calls).toHaveLength(1);
  });

  it("skips an in-flight tick without cancel, catch-up or cadence reset", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    controller.edit(value("X.")); scheduler.advanceBy(15000);
    controller.edit(value("X. Y,")); scheduler.advanceBy(15000);
    expect(requester.calls).toHaveLength(1);
    scheduler.advanceBy(3000);
    requester.pending[0].resolve({ status: "no_high_value_issue", issues: [] }); await Promise.resolve();
    expect(requester.calls).toHaveLength(1);
    scheduler.advanceBy(11999); expect(requester.calls).toHaveLength(1);
    scheduler.advanceBy(1); expect(requester.calls).toHaveLength(2);
    expect(requester.calls[1].currentText).toBe("X. Y,");
  });

  it.each([
    ["tail append", "X. editable tail"],
    ["tail edit", "X. changed tail"],
    ["Stable Prefix extension", "X. Y,"],
  ])("accepts an owned prefix after %s and advances baseline only to the owned text", async (_case, latestText) => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester(); const diagnostic = vi.fn();
    const controller = new InstantCheckController(scheduler, requester.request, () => undefined, diagnostic);
    controller.edit(value("X.")); scheduler.advanceBy(15000);
    const firstId = requester.calls[0].requestId;
    controller.edit(value(latestText, "revision-2"));
    requester.pending[0].resolve({ status: "no_high_value_issue", issues: [] }); await Promise.resolve();
    expect(diagnostic).toHaveBeenCalledWith({ requestId: firstId, outcome: "ACCEPTED", finalLastResult: "no_high_value_issue" });
    scheduler.advanceBy(15000);
    if (latestText === "X. Y,") {
      expect(requester.calls).toHaveLength(2);
      expect(requester.calls[1]).toMatchObject({ currentText: "X. Y,", previousAnalyzedText: "X." });
    } else {
      expect(requester.calls).toHaveLength(1);
    }
  });

  it.each([
    ["owned character change", "Z."],
    ["owned boundary deletion", "X editable tail"],
    ["owned prefix shortening", ""],
  ])("silently stales success and failure after %s", async (_case, latestText) => {
    const scheduler = new ManualScheduler(new ManualClock()); const success = new ControlledRequester(); const diagnostic = vi.fn();
    const controller = new InstantCheckController(scheduler, success.request, () => undefined, diagnostic);
    controller.edit(value("X.")); scheduler.advanceBy(15000); const requestId = success.calls[0].requestId;
    controller.edit(value(latestText, "revision-2"));
    success.pending[0].resolve({ status: "issues_found", issues: [makeIssue("old", "X.")] }); await Promise.resolve();
    expect(diagnostic).toHaveBeenCalledWith({ requestId, outcome: "STALE", finalLastResult: null });
    expect(controller.snapshot.issues).toEqual([]);
    expect(controller.snapshot.lastResult).toBeUndefined();
    expect(controller.snapshot.error).toBeUndefined();

    const failure = new ControlledRequester(); const failed = new InstantCheckController(scheduler, failure.request);
    failed.edit(value("A.")); scheduler.advanceBy(15000); failed.edit(value("B.", "revision-3"));
    failure.pending[0].reject(new Error("network")); await Promise.resolve();
    expect(failed.snapshot.error).toBeUndefined();
  });

  it("sends only Stable Prefix text through FULL and DELTA baselines", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    const accept = async () => { requester.pending.at(-1)!.resolve({ status: "no_high_value_issue", issues: [] }); await Promise.resolve(); };
    const texts = ["A. tail", "A. B, tail", "A. B, C; tail", "A. B, C; D: tail", "A. B, C; D: E! tail"];
    for (const text of texts) { controller.edit(value(text)); scheduler.advanceBy(15000); await accept(); }
    expect(requester.calls.map(({ currentText, previousAnalyzedText, inspectFull }) => ({ currentText, previousAnalyzedText, inspectFull: inspectFull ?? false }))).toEqual([
      { currentText: "A.", previousAnalyzedText: "", inspectFull: true },
      { currentText: "A. B,", previousAnalyzedText: "A.", inspectFull: false },
      { currentText: "A. B, C;", previousAnalyzedText: "A. B,", inspectFull: false },
      { currentText: "A. B, C; D:", previousAnalyzedText: "A. B, C;", inspectFull: false },
      { currentText: "A. B, C; D: E!", previousAnalyzedText: "A. B, C; D:", inspectFull: true },
    ]);
  });

  it("keeps uniquely locatable Stable Prefix issues when only editableTail changes", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    controller.edit(value("The figure rise. tail")); scheduler.advanceBy(15000);
    requester.pending[0].resolve({ status: "issues_found", issues: [makeIssue("rise", "rise")] }); await Promise.resolve();
    controller.edit(value("The figure rise. completely different tail", "revision-2"));
    expect(controller.snapshot.issues.map((issue) => issue.fingerprint)).toEqual(["rise"]);
  });
});

describe("InstantCheckController state machine", () => {
  it("records the accepted UI lastResult for a completed round", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester(); const diagnostic = vi.fn();
    const controller = new InstantCheckController(scheduler, requester.request, () => undefined, diagnostic);
    controller.edit(edit("Clean sentence.")); scheduler.advanceBy(15000);
    const requestId = requester.calls[0].requestId;
    requester.pending[0].resolve({ status: "no_high_value_issue", issues: [] }); await Promise.resolve();
    expect(diagnostic).toHaveBeenCalledWith({ requestId, outcome: "ACCEPTED", finalLastResult: "no_high_value_issue" });
  });

  it("records failed rounds without inventing a lastResult", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester(); const diagnostic = vi.fn();
    const controller = new InstantCheckController(scheduler, requester.request, () => undefined, diagnostic);
    controller.edit(edit("The chart rises.")); scheduler.advanceBy(15000);
    const requestId = requester.calls[0].requestId;
    requester.pending[0].reject(new Error("failed")); await Promise.resolve();
    expect(diagnostic).toHaveBeenCalledWith({ requestId, outcome: "FAILED", finalLastResult: null });
  });
  it("uses fixed 15 second evaluation windows without resetting on input", () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    controller.edit(edit("First,")); scheduler.advanceBy(10000); controller.edit(edit("First continued,")); scheduler.advanceBy(4999);
    scheduler.advanceBy(1);
    expect(requester.calls).toHaveLength(1);
    expect(requester.calls[0].currentText).toBe("First continued,");
  });

  it("uses bootstrap FULL, then three DELTAs, then every fourth natural check as CADENCE_FULL", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    const complete = async () => { requester.pending.at(-1)!.resolve({ status: "no_high_value_issue", issues: [] }); await Promise.resolve(); };

    controller.edit(edit("bootstrap.")); scheduler.advanceBy(15000);
    expect(requester.calls[0].inspectFull).toBe(true); await complete();
    const expectedNatural = [false, false, false, true, false, false, false, true] as const;
    for (const [index, expectedFull] of expectedNatural.entries()) {
      controller.edit(edit(`natural-${index + 1}.`)); scheduler.advanceBy(15000);
      expect(requester.calls[index + 1].inspectFull ?? false).toBe(expectedFull);
      await complete();
    }
  });

  it("retries the same cadence FULL after failure or stale response", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    const accepted = async () => { requester.pending.at(-1)!.resolve({ status: "no_high_value_issue", issues: [] }); await Promise.resolve(); };
    controller.edit(edit("bootstrap.")); scheduler.advanceBy(15000); await accepted();
    for (const text of ["one.", "two.", "three."]) { controller.edit(edit(text)); scheduler.advanceBy(15000); await accepted(); }
    controller.edit(edit("four.")); scheduler.advanceBy(15000);
    expect(requester.calls[4].inspectFull).toBe(true);
    requester.pending[4].reject(new Error("failed")); await Promise.resolve();
    controller.edit(edit("four changed.")); scheduler.advanceBy(15000);
    expect(requester.calls[5].inspectFull).toBe(true);
    controller.edit(edit("four stale.", "revision-2"));
    requester.pending[5].resolve({ status: "no_high_value_issue", issues: [] }); await Promise.resolve();
    scheduler.advanceBy(15000);
    expect(requester.calls[6].inspectFull).toBe(true);
  });

  it("does not advance natural cadence for an explicit final check", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    const accepted = async () => { requester.pending.at(-1)!.resolve({ status: "no_high_value_issue", issues: [] }); await Promise.resolve(); };
    controller.edit(edit("bootstrap.")); scheduler.advanceBy(15000); await accepted();
    controller.edit(edit("one.")); scheduler.advanceBy(15000); await accepted();
    controller.edit(edit("two.")); scheduler.advanceBy(15000); await accepted();
    const final = controller.finalCheck(edit("final", "revision-2"));
    expect(requester.calls[3].inspectFull).toBe(true); await accepted(); await final;
    controller.edit(edit("three.")); scheduler.advanceBy(15000);
    expect(requester.calls[4].inspectFull ?? false).toBe(false);
  });

  it("does not let a final check consume the natural bootstrap FULL", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    const final = controller.finalCheck(edit("final draft", "revision-final"));
    requester.pending[0].resolve({ status: "no_high_value_issue", issues: [] }); await final;
    expect(controller.snapshot.lastResult).toBe("no_high_value_issue");

    controller.edit(edit("natural draft.", "revision-natural")); scheduler.advanceBy(15000);

    expect(requester.calls[1].inspectFull).toBe(true);
  });

  it("does not accept or advance cadence after stop", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    controller.edit(edit("bootstrap.")); scheduler.advanceBy(15000);
    controller.stop();
    requester.pending[0].resolve({ status: "no_high_value_issue", issues: [] }); await Promise.resolve();
    controller.edit(edit("after stop.", "revision-2")); scheduler.advanceBy(15000);
    expect(requester.calls[1].inspectFull).toBe(true);
  });

  it("keeps the new edit state when an older request rejects", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    controller.edit(edit("The chart rise.")); scheduler.advanceBy(15000);
    controller.edit(edit("The chart rises.", "revision-2"));
    const afterEdit = controller.snapshot;

    requester.pending[0].reject(new Error("network")); await Promise.resolve();

    expect(controller.snapshot).toEqual(afterEdit);
    expect(controller.snapshot.error).toBeUndefined();
    expect(controller.snapshot.lastResult).toBeUndefined();
    expect(controller.snapshot.state).toBe("COUNTING");
  });

  it("does not publish or change state when a stopped request rejects late", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester(); const observe = vi.fn();
    const controller = new InstantCheckController(scheduler, requester.request, observe);
    controller.edit(edit("The chart rises.")); scheduler.advanceBy(15000);
    controller.stop();
    const publishCount = observe.mock.calls.length;
    const stoppedSnapshot = controller.snapshot;

    requester.pending[0].reject(new Error("network")); await Promise.resolve();

    expect(observe).toHaveBeenCalledTimes(publishCount);
    expect(controller.snapshot).toEqual(stoppedSnapshot);
    expect(controller.snapshot.error).toBeUndefined();
    expect(controller.snapshot.state).toBe("ANALYZING");
  });

  it("does not publish for stale successes or stale failures", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const success = new ControlledRequester(); const observe = vi.fn();
    const controller = new InstantCheckController(scheduler, success.request, observe);
    controller.edit(edit("first.")); scheduler.advanceBy(15000); controller.edit(edit("second.", "revision-2"));
    const successPublishCount = observe.mock.calls.length;
    success.pending[0].resolve({ status: "issues_found", issues: [makeIssue("old", "first")] }); await Promise.resolve();
    expect(observe).toHaveBeenCalledTimes(successPublishCount);
    expect(controller.snapshot).toMatchObject({ state: "COUNTING" });

    const failure = new ControlledRequester(); const failureObserve = vi.fn();
    const failureController = new InstantCheckController(scheduler, failure.request, failureObserve);
    failureController.edit(edit("third.")); scheduler.advanceBy(15000); failureController.edit(edit("fourth.", "revision-4"));
    const failurePublishCount = failureObserve.mock.calls.length;
    failure.pending[0].reject(new Error("network")); await Promise.resolve();
    expect(failureObserve).toHaveBeenCalledTimes(failurePublishCount);
  });

  it("fires once, never overlaps analysis, and counts down edits made during analysis", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    controller.edit(edit("Round one.")); scheduler.advanceBy(15000); controller.edit(edit("Round one. Changed while analyzing,")); scheduler.advanceBy(60000);
    expect(requester.calls).toHaveLength(1);
    requester.pending[0].resolve({ status: "no_high_value_issue", issues: [] }); await Promise.resolve();
    scheduler.advanceBy(14999); expect(requester.calls).toHaveLength(1);
    scheduler.advanceBy(1); expect(requester.calls).toHaveLength(2);
    expect(requester.calls[1].previousAnalyzedText).toBe("Round one.");
    expect(requester.calls[1].inspectFull ?? false).toBe(false);
  });

  it("drops a stale analysis response and starts a fresh countdown for edits made while analyzing", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    controller.edit(edit("five district.")); scheduler.advanceBy(15000);
    controller.edit(edit("five districts.", "revision-2"));
    const staleIssue = makeIssue("stale", "five district");
    requester.pending[0].resolve({ status: "issues_found", issues: [staleIssue] }); await Promise.resolve();

    expect(controller.snapshot.state).toBe("COUNTING");
    expect(controller.snapshot.issues).toEqual([]);
    scheduler.advanceBy(14999); expect(requester.calls).toHaveLength(1);
    scheduler.advanceBy(1); expect(requester.calls).toHaveLength(2);
    expect(requester.calls[1].currentText).toBe("five districts.");
  });

  it("recovers from failure and dedupes duplicate issues within one result", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    controller.edit(edit("bad text.")); scheduler.advanceBy(15000); requester.pending[0].reject(new Error("network")); await Promise.resolve();
    expect(controller.snapshot.state).toBe("IDLE"); expect(controller.snapshot.error).toBeTruthy();
    controller.edit(edit("bad text changed.")); scheduler.advanceBy(15000);
    const issue = makeIssue("same", "increases");
    requester.pending[1].resolve({ status: "issues_found", issues: [issue, issue] }); await Promise.resolve();
    expect(controller.snapshot.issues).toHaveLength(1);
  });

  it("retries unchanged text at the next fixed window when the prior request was not accepted", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);

    controller.edit(edit("The chart rose sharply."));
    scheduler.advanceBy(15000);
    requester.pending[0].reject(new Error("network"));
    await Promise.resolve();

    expect(controller.snapshot.state).toBe("IDLE");
    scheduler.advanceBy(15000);

    expect(requester.calls).toHaveLength(2);
    expect(requester.calls[1].currentText).toBe("The chart rose sharply.");
    expect(requester.calls[1].previousAnalyzedText).toBe("");
  });

  it("waits for an in-flight natural check before running one explicit final check for the latest revision", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    controller.edit(edit("draft.", "revision-1")); scheduler.advanceBy(15000);
    const final = controller.finalCheck(edit("final draft", "revision-2"));
    expect(requester.calls).toHaveLength(1);
    requester.pending[0].resolve({ status: "no_high_value_issue", issues: [] }); await Promise.resolve(); await Promise.resolve();
    expect(requester.calls).toHaveLength(2);
    expect(requester.calls[1].currentText).toBe("final draft");
    requester.pending[1].resolve({ status: "no_high_value_issue", issues: [] }); await final;
    scheduler.advanceBy(60000);
    expect(requester.calls).toHaveLength(2);
  });
});

describe("InstantCheckController v3 active issue semantics", () => {
  it("rebuilds the complete active set from an accepted FULL result", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    controller.edit(edit("First issue. Second issue.")); scheduler.advanceBy(15000);
    requester.pending[0].resolve({ status: "issues_found", issues: [makeIssue("first", "First issue"), makeIssue("article", "")] }); await Promise.resolve();

    const full = controller.finalCheck(edit("First issue fixed. Second issue.", "revision-2"));
    requester.pending[1].resolve({ status: "issues_found", issues: [makeIssue("second", "Second issue")] }); await full;

    expect(controller.snapshot.issues.map((issue) => issue.fingerprint)).toEqual(["second"]);
  });
  it("checks at each fixed window during continuous writing", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    controller.edit(edit("0,")); scheduler.advanceBy(10000); controller.edit(edit("10,")); scheduler.advanceBy(5000);
    requester.pending[0].resolve({ status: "no_high_value_issue", issues: [] }); await Promise.resolve();
    controller.edit(edit("20,")); scheduler.advanceBy(15000);
    requester.pending[1].resolve({ status: "no_high_value_issue", issues: [] }); await Promise.resolve();
    controller.edit(edit("30,")); scheduler.advanceBy(15000);
    expect(requester.calls.map((call) => call.currentText)).toEqual(["10,", "20,", "30,"]);
  });

  it("does not request at fixed windows when the processed text is unchanged", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    controller.edit(edit("same.")); scheduler.advanceBy(15000);
    requester.pending[0].resolve({ status: "no_high_value_issue", issues: [] }); await Promise.resolve();
    scheduler.advanceBy(60000);
    expect(requester.calls).toHaveLength(1);
  });

  it("checks newly entered text at the next existing window after a long idle", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    controller.edit(edit("initial.")); scheduler.advanceBy(15000);
    requester.pending[0].resolve({ status: "no_high_value_issue", issues: [] }); await Promise.resolve();
    scheduler.advanceBy(60000); controller.edit(edit("resumed.")); scheduler.advanceBy(14999);
    expect(requester.calls).toHaveLength(1); scheduler.advanceBy(1);
    expect(requester.calls).toHaveLength(2);
    expect(requester.calls[1].currentText).toBe("resumed.");
  });

  it("keeps every issue from the analysis result with no count limit (10 issues)", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    controller.edit(edit("Text with many problems.")); scheduler.advanceBy(15000);
    const issues = Array.from({ length: 10 }, (_, index) => makeIssue(`fp-${index}`, `target-${index}`));
    requester.pending[0].resolve({ status: "issues_found", issues }); await Promise.resolve();
    expect(controller.snapshot.issues).toHaveLength(10);
    expect(new Set(controller.snapshot.issues.map((item) => item.fingerprint)).size).toBe(10);
  });

  it("does not limit the active set to eight cards", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    controller.edit(edit("First round.")); scheduler.advanceBy(15000);
    requester.pending[0].resolve({ status: "issues_found", issues: [makeIssue("a", "First round.")] }); await Promise.resolve();
    controller.edit(edit("First round. Second round.")); scheduler.advanceBy(15000);
    requester.pending[1].resolve({ status: "issues_found", issues: Array.from({ length: 9 }, (_, index) => makeIssue(`b-${index}`, `beta-${index}`)) }); await Promise.resolve();
    expect(controller.snapshot.issues).toHaveLength(10);
  });

  it("removes an active issue immediately when its evidence disappears from the text", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const publishes: InstantCheckSnapshot[] = [];
    const controller = new InstantCheckController(scheduler, requester.request, (snapshot) => publishes.push(snapshot));
    controller.edit(edit("The population of five district increased.")); scheduler.advanceBy(15000);
    requester.pending[0].resolve({ status: "issues_found", issues: [makeIssue("fp-x", "five district")] }); await Promise.resolve();
    expect(controller.snapshot.issues).toHaveLength(1);

    controller.edit(edit("The population grew steadily."));
    expect(controller.snapshot.state).toBe("COUNTING");
    expect(controller.snapshot.issues).toHaveLength(0);
    expect(publishes[publishes.length - 1].issues).toHaveLength(0);
  });

  it("keeps active issues outside the changed range and refreshes only the changed range", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    const round1 = "Old paragraph has a problem. New sentence one.";
    controller.edit(edit(round1)); scheduler.advanceBy(15000);
    requester.pending[0].resolve({ status: "issues_found", issues: [makeIssue("fp-old", "Old paragraph has a problem"), makeIssue("fp-new", "New sentence one")] }); await Promise.resolve();
    expect(controller.snapshot.issues).toHaveLength(2);

    controller.edit(edit("Old paragraph has a problem. New sentence two.")); scheduler.advanceBy(15000);
    requester.pending[1].resolve({ status: "issues_found", issues: [makeIssue("fp-new2", "New sentence two")] }); await Promise.resolve();

    expect(requester.calls).toHaveLength(2);
    expect(requester.calls[1].previousAnalyzedText).toBe(round1);
    const fingerprints = controller.snapshot.issues.map((item) => item.fingerprint);
    expect(fingerprints).toContain("fp-old");
    expect(fingerprints).toContain("fp-new2");
    expect(fingerprints).not.toContain("fp-new");
  });

  it("no_high_value_issue refreshes only the changed range and keeps outside active issues", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    controller.edit(edit("Old paragraph issue. New sentence one.")); scheduler.advanceBy(15000);
    requester.pending[0].resolve({ status: "issues_found", issues: [makeIssue("fp-old", "Old paragraph issue"), makeIssue("fp-new", "New sentence one")] }); await Promise.resolve();

    controller.edit(edit("Old paragraph issue. New sentence two.")); scheduler.advanceBy(15000);
    requester.pending[1].resolve({ status: "no_high_value_issue", issues: [] }); await Promise.resolve();

    expect(controller.snapshot.issues.map((item) => item.fingerprint)).toEqual(["fp-old"]);
  });

  it("does not stack duplicates when an unresolved issue keeps being reported inside the changed range", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    controller.edit(edit("The population of five district increased.")); scheduler.advanceBy(15000);
    requester.pending[0].resolve({ status: "issues_found", issues: [makeIssue("fp-x", "five district")] }); await Promise.resolve();
    controller.edit(edit("The population of five district increased sharply.")); scheduler.advanceBy(15000);
    requester.pending[1].resolve({ status: "issues_found", issues: [makeIssue("fp-x", "five district")] }); await Promise.resolve();
    controller.edit(edit("The population of five district increased very sharply.")); scheduler.advanceBy(15000);
    requester.pending[2].resolve({ status: "issues_found", issues: [makeIssue("fp-x", "five district")] }); await Promise.resolve();
    expect(controller.snapshot.issues.filter((item) => item.fingerprint === "fp-x")).toHaveLength(1);
  });

  it("re-reminds the exact same fingerprint after correction: three real rounds, no stale drop, no stacking", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    const pluralIssue = makeIssue("fp-plural", "five district");

    controller.edit(edit("five district."));
    scheduler.advanceBy(15000);
    requester.pending[0].resolve({ status: "issues_found", issues: [pluralIssue] });
    await Promise.resolve();
    expect(controller.snapshot.state).toBe("IDLE");
    expect(controller.snapshot.issues).toHaveLength(1);

    controller.edit(edit("five districts.", "revision-2"));
    scheduler.advanceBy(15000);
    requester.pending[1].resolve({ status: "no_high_value_issue", issues: [] });
    await Promise.resolve();
    expect(controller.snapshot.issues).toHaveLength(0);

    const reappeared = { ...pluralIssue };
    controller.edit(edit("five district.", "revision-3"));
    scheduler.advanceBy(15000);
    requester.pending[2].resolve({ status: "issues_found", issues: [reappeared] });
    await Promise.resolve();

    expect(requester.calls).toHaveLength(3);
    expect(requester.calls.map((call) => call.currentText)).toEqual(["five district.", "five districts.", "five district."]);
    expect(controller.snapshot.state).toBe("IDLE");
    expect(controller.snapshot.lastResult).toBe("issues_found");
    expect(controller.snapshot.issues).toHaveLength(1);
    expect(controller.snapshot.issues[0].fingerprint).toBe("fp-plural");
    expect(controller.snapshot.issues[0]).toBe(reappeared);
  });

  it("keeps an unresolved issue active across rounds without infinite duplicate cards", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    const pluralIssue = makeIssue("fp-plural", "five district");

    controller.edit(edit("five district."));
    scheduler.advanceBy(15000);
    requester.pending[0].resolve({ status: "issues_found", issues: [pluralIssue] });
    await Promise.resolve();
    expect(controller.snapshot.issues).toHaveLength(1);

    controller.edit(edit("five district remains.", "revision-2"));
    scheduler.advanceBy(15000);
    requester.pending[1].resolve({ status: "issues_found", issues: [{ ...pluralIssue }] });
    await Promise.resolve();
    expect(controller.snapshot.issues).toHaveLength(1);

    controller.edit(edit("five district still there.", "revision-3"));
    scheduler.advanceBy(15000);
    requester.pending[2].resolve({ status: "issues_found", issues: [{ ...pluralIssue }] });
    await Promise.resolve();

    expect(requester.calls).toHaveLength(3);
    expect(controller.snapshot.issues).toHaveLength(1);
  });

  it("does not treat issues invalidated by a no_high_value_issue round as active dedupe history", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const publishes: InstantCheckSnapshot[] = [];
    const controller = new InstantCheckController(scheduler, requester.request, (snapshot) => publishes.push(snapshot));
    const pluralIssue = makeIssue("fp-plural", "five district");

    controller.edit(edit("five district."));
    scheduler.advanceBy(15000);
    requester.pending[0].resolve({ status: "issues_found", issues: [pluralIssue] });
    await Promise.resolve();
    expect(controller.snapshot.issues).toHaveLength(1);

    controller.edit(edit("five districts.", "revision-2"));
    scheduler.advanceBy(15000);
    requester.pending[1].resolve({ status: "no_high_value_issue", issues: [] });
    await Promise.resolve();
    expect(controller.snapshot.issues).toHaveLength(0);

    const reappeared = { ...pluralIssue };
    controller.edit(edit("five district.", "revision-3"));
    scheduler.advanceBy(15000);
    requester.pending[2].resolve({ status: "issues_found", issues: [reappeared] });
    await Promise.resolve();

    const finalPublish = publishes[publishes.length - 1];
    expect(finalPublish.state).toBe("IDLE");
    expect(finalPublish.issues).toHaveLength(1);
    expect(finalPublish.issues[0]).toBe(reappeared);
  });

  it("keeps the prior panel untouched when a stale response arrives after newer edits", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    const pluralIssue = makeIssue("fp-plural", "five district");

    controller.edit(edit("five district."));
    scheduler.advanceBy(15000);
    requester.pending[0].resolve({ status: "issues_found", issues: [pluralIssue] });
    await Promise.resolve();
    expect(controller.snapshot.issues).toHaveLength(1);

    controller.edit(edit("five districts.", "revision-2"));
    scheduler.advanceBy(15000);
    controller.edit(edit("five districts more.", "revision-3"));
    requester.pending[1].resolve({ status: "issues_found", issues: [makeIssue("fp-other", "five districts")] });
    await Promise.resolve();

    expect(controller.snapshot.state).toBe("COUNTING");
    expect(controller.snapshot.issues).toHaveLength(1);
    expect(controller.snapshot.issues[0].fingerprint).toBe("fp-plural");
    scheduler.advanceBy(14999);
    expect(requester.calls).toHaveLength(2);
    scheduler.advanceBy(1);
    expect(requester.calls).toHaveLength(3);
    expect(requester.calls[2].currentText).toBe("five districts more.");
  });

  it("final check inspects the whole essay and replaces the active set", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    controller.edit(edit("Old sentence with a problem.")); scheduler.advanceBy(15000);
    requester.pending[0].resolve({ status: "issues_found", issues: [makeIssue("fp-old", "Old sentence with a problem")] }); await Promise.resolve();
    expect(controller.snapshot.issues).toHaveLength(1);

    const final = controller.finalCheck(edit("Old sentence with a problem. New sentence.", "revision-2"));
    expect(requester.calls).toHaveLength(2);
    expect(requester.calls[1].inspectFull).toBe(true);
    requester.pending[1].resolve({ status: "issues_found", issues: [makeIssue("fp-old", "Old sentence with a problem"), makeIssue("fp-new", "New sentence")] });
    await final;

    expect(controller.snapshot.issues.map((item) => item.fingerprint)).toEqual(["fp-old", "fp-new"]);
  });

  it("no_high_value_issue on the first round leaves the active set empty", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const requester = new ControlledRequester();
    const controller = new InstantCheckController(scheduler, requester.request);
    controller.edit(edit("Clean sentence.")); scheduler.advanceBy(15000);
    requester.pending[0].resolve({ status: "no_high_value_issue", issues: [] }); await Promise.resolve();
    expect(controller.snapshot.issues).toHaveLength(0);
    expect(controller.snapshot.lastResult).toBe("no_high_value_issue");
  });
});
