import { describe, expect, it } from "vitest";
import { AutosaveController } from "../../src/presentation/writing/autosave-controller";
import { ControlledDraftSaveFake } from "../../src/testing/controlled-draft-save.fake";
import { ManualClock } from "../../src/testing/manual-clock";
import { ManualScheduler } from "../../src/testing/manual-scheduler";

const draft = (plainText: string, revisionId = "00000000-0000-4000-8000-000000000001") => ({ expectedRevisionId: revisionId, plainText, content: { type: "doc" }, timer: { elapsedMs: 0 } });

describe("autosave controller", () => {
  it("debounces at 800ms and keeps only one request in flight", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const saver = new ControlledDraftSaveFake();
    const controller = new AutosaveController(scheduler, saver);
    controller.change(draft("first")); scheduler.advanceBy(799); expect(saver.calls).toHaveLength(0);
    scheduler.advanceBy(1); expect(saver.calls).toHaveLength(1); expect(controller.state).toBe("SAVING");
    controller.change(draft("latest")); scheduler.advanceBy(800); expect(saver.calls).toHaveLength(1);
    saver.complete(0, { status: "SAVED", revisionId: "00000000-0000-4000-8000-000000000002" }); await Promise.resolve();
    expect(saver.calls).toHaveLength(2); expect(saver.calls[1].draft.plainText).toBe("latest");
    expect(saver.calls[1].draft.expectedRevisionId).toBe("00000000-0000-4000-8000-000000000002");
    saver.complete(1, { status: "SAVED", revisionId: "00000000-0000-4000-8000-000000000003" }); await Promise.resolve();
    expect(controller.state).toBe("SAVED");
  });

  it("keeps editing available across failure, retry, and conflict", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const saver = new ControlledDraftSaveFake();
    const controller = new AutosaveController(scheduler, saver);
    controller.change(draft("text")); scheduler.advanceBy(800); saver.fail(0); await Promise.resolve(); expect(controller.state).toBe("SAVE_FAILED");
    const failedMutationId = saver.calls[0].mutationId;
    controller.retry(); expect(saver.calls).toHaveLength(2); saver.complete(1, { status: "REVISION_CONFLICT", currentRevisionId: "00000000-0000-4000-8000-000000000003" }); await Promise.resolve();
    expect(saver.calls[1].mutationId).toBe(failedMutationId);
    expect(controller.state).toBe("CONFLICT"); expect(controller.currentDraft.plainText).toBe("text");
  });

  it("does not save new edits with an obsolete baseline after a revision conflict", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const saver = new ControlledDraftSaveFake();
    const controller = new AutosaveController(scheduler, saver);
    controller.change(draft("before conflict")); scheduler.advanceBy(800);
    saver.complete(0, { status: "REVISION_CONFLICT", currentRevisionId: "00000000-0000-4000-8000-000000000099" }); await Promise.resolve();
    controller.change(draft("local follow-up")); scheduler.advanceBy(800);

    expect(controller.state).toBe("CONFLICT");
    expect(saver.calls).toHaveLength(1);
  });

  it("reloads the server snapshot as the new saved baseline after a conflict", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const saver = new ControlledDraftSaveFake();
    const controller = new AutosaveController(scheduler, saver);
    controller.change(draft("local draft")); scheduler.advanceBy(800);
    saver.complete(0, { status: "REVISION_CONFLICT", currentRevisionId: "00000000-0000-4000-8000-000000000099" }); await Promise.resolve();

    controller.reload(draft("server draft", "00000000-0000-4000-8000-000000000100"));

    expect(controller.state).toBe("SAVED");
    expect(controller.currentDraft).toMatchObject({ plainText: "server draft", expectedRevisionId: "00000000-0000-4000-8000-000000000100" });
    controller.change(draft("server draft plus edit", controller.currentDraft.expectedRevisionId)); scheduler.advanceBy(800);
    expect(saver.calls[1].draft.expectedRevisionId).toBe("00000000-0000-4000-8000-000000000100");
  });

  it("publishes state and revision changes to a UI subscriber", async () => {
    const scheduler = new ManualScheduler(new ManualClock()); const saver = new ControlledDraftSaveFake(); const states: string[] = [];
    const controller = new AutosaveController(scheduler, saver, (state) => states.push(state));
    controller.change(draft("text")); scheduler.advanceBy(800); saver.complete(0, { status: "SAVED", revisionId: "00000000-0000-4000-8000-000000000002" }); await Promise.resolve();
    expect(states).toEqual(["DIRTY", "SAVING", "SAVED"]);
    expect(controller.currentDraft.expectedRevisionId).toBe("00000000-0000-4000-8000-000000000002");
  });

  it("queues a paused timer snapshot even without a text change", () => {
    const scheduler = new ManualScheduler(new ManualClock()); const saver = new ControlledDraftSaveFake();
    const controller = new AutosaveController(scheduler, saver);
    controller.initialize(draft("saved"));
    controller.updateTimer({ elapsedMs: 2500 });
    void controller.flush();
    expect(saver.calls[0].draft.timer).toEqual({ elapsedMs: 2500 });
  });
});
