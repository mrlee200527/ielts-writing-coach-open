"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WritingWorkspaceSnapshot } from "../../application/essay-session.repository";
import { PromptPanel } from "./prompt-panel";
import { EssayEditor, type EssayEditorHandle } from "./essay-editor";
import { FeedbackPanel } from "./feedback-panel";
import type { FeedbackOwnerTuple } from "./feedback-panel";
import { useWritingTimer } from "./use-writing-timer";
import { AutosaveController, type AutosaveState, type DraftSaver } from "./autosave-controller";
import { LearningMemory, WorkspaceHeader, WritingJourney } from "./workspace-sections";
import { InstantCheckController, type InstantCheckRequest, type InstantCheckResult, type InstantCheckSnapshot } from "./instant-check-controller";
import { targetBands, type TargetBand } from "../../domain/feedback/ielts-rubric";

const countWords = (text: string) => text.trim().match(/\S+/g)?.length ?? 0;
const targetBandKey = (sessionId: string) => `target-band:${sessionId}`;
const readTargetBand = (sessionId: string): TargetBand => {
  try {
    const stored = localStorage.getItem(targetBandKey(sessionId));
    return targetBands.find((band) => band === stored) ?? "6.5";
  } catch {
    return "6.5";
  }
};
const stableTextHash = async (text: string) => {
  const bytes = new TextEncoder().encode(JSON.stringify(text));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
};
export const logInstantCheckDegradation = (diagnostic: { code: string; structure: string | null }) => {
  console.warn(`[instant-check] safe failure diagnostic ${JSON.stringify(diagnostic)}`);
};
export const acceptsTaskContextPoll = (pollGeneration: number, currentGeneration: number, pollAttemptId: string | null, currentAttemptId: string | null) => pollGeneration === currentGeneration && pollAttemptId === currentAttemptId;
export type InstantCheckControllerLike = Pick<InstantCheckController, "start" | "stop" | "edit">;
export type InstantControllerFactory = (input: { scheduler: { schedule: (delayMs: number, callback: () => void) => { id: string }; cancel: (scheduled: { id: string }) => void }; request: (request: InstantCheckRequest) => Promise<InstantCheckResult>; observe: (snapshot: InstantCheckSnapshot) => void; diagnostic: (event: { requestId: string; outcome: "ACCEPTED" | "STALE" | "FAILED"; finalLastResult: InstantCheckSnapshot["lastResult"] | null }) => void }) => InstantCheckControllerLike;

export function WritingWorkspace({ initial, initialAutosaveState = "SAVED", instantControllerFactory }: { initial: WritingWorkspaceSnapshot; initialAutosaveState?: AutosaveState; instantControllerFactory?: InstantControllerFactory }) {
  const [text, setText] = useState(initial.revision.plainText); const [editorRevisionId, setEditorRevisionId] = useState(initial.revision.id); const [contentVersion, setContentVersion] = useState(0); const [feedbackOwner, setFeedbackOwner] = useState<FeedbackOwnerTuple | null>({ revisionId: initial.revision.id, textHash: initial.revision.textHash }); const [saveStatus, setSaveStatus] = useState(initialAutosaveState === "CONFLICT" ? "保存冲突" : "已保存"); const [autosaveState, setAutosaveState] = useState<AutosaveState>(initialAutosaveState); const [reloadingConflict, setReloadingConflict] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const [task, setTask] = useState(initial.task);
  const [retryingTaskContext, setRetryingTaskContext] = useState(false);
  const [taskContextRetryError, setTaskContextRetryError] = useState<string | undefined>();
  const [instant, setInstant] = useState<InstantCheckSnapshot>({ state: "IDLE", issues: [] });
  const [activeInstantFingerprint, setActiveInstantFingerprint] = useState<string | null>(null);
  const [targetBand, setTargetBand] = useState<TargetBand>(() => readTargetBand(initial.session.id));
  const editorRef = useRef<EssayEditorHandle>(null);
  const activeTimerRef = useRef<number | null>(null);
  const taskPollGeneration = useRef(0);
  const writingTimer = useWritingTimer(initial.timer);
  const { pause, resume } = writingTimer;
  const controller = useMemo(() => {
    const scheduler = { schedule: (delayMs: number, callback: () => void) => ({ id: String(window.setTimeout(callback, delayMs)) }), cancel: (task: { id: string }) => window.clearTimeout(Number(task.id)) };
    const saver: DraftSaver = { save: async ({ mutationId, draft }) => { const response = await fetch(`/api/essays/${initial.session.id}/draft`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...draft, clientMutationId: mutationId }) }); if (response.status === 409) { const result = await response.json(); return { status: "REVISION_CONFLICT", currentRevisionId: result.currentRevisionId }; } if (!response.ok) throw new Error("SAVE_FAILED"); const result = await response.json(); return { status: "SAVED", revisionId: result.revision.id }; } };
    const labels: Record<AutosaveState, string> = { IDLE: "已保存", DIRTY: "待保存", SAVING: "保存中", SAVED: "已保存", SAVE_FAILED: "保存失败", CONFLICT: "保存冲突" };
    const autosave = new AutosaveController(scheduler, saver, (state) => { setAutosaveState(state); setSaveStatus(labels[state]); });
    autosave.initialize({ expectedRevisionId: initial.revision.id, plainText: initial.revision.plainText, content: initial.revision.content, timer: initial.timer });
    return autosave;
  }, [initial.revision.content, initial.revision.id, initial.revision.plainText, initial.session.id, initial.timer]);
  useEffect(() => {
    if (autosaveState !== "SAVED") return;
    const draft = controller.currentDraft;
    if (!draft || feedbackOwner?.revisionId === draft.expectedRevisionId) return;
    const { expectedRevisionId: revisionId, plainText } = draft;
    void Promise.resolve().then(() => {
      setContentVersion((current) => current + 1);
      return stableTextHash(plainText);
    }).then((textHash) => {
      if (controller.currentDraft?.expectedRevisionId === revisionId && controller.currentDraft.plainText === plainText) setFeedbackOwner({ revisionId, textHash });
    });
  }, [autosaveState, controller, feedbackOwner?.revisionId]);
  const taskType = task.imagePlaceholderKind === "TASK_2_NOT_REQUIRED" ? "TASK_2" : "TASK_1";
  const instantController = useMemo(() => {
    const scheduler = { schedule: (delayMs: number, callback: () => void) => ({ id: String(window.setTimeout(callback, delayMs)) }), cancel: (scheduled: { id: string }) => window.clearTimeout(Number(scheduled.id)) };
    const request = async (request: InstantCheckRequest) => {
      const response = await fetch(`/api/essays/${initial.session.id}/instant-check`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...request, targetBand }) });
      const body = await response.json() as { feedback?: InstantCheckResult; error?: string; diagnostic?: string };
      if (!response.ok || !body.feedback) {
        logInstantCheckDegradation({ code: body.error ?? "UNKNOWN", structure: body.diagnostic ?? null });
        throw new Error("INSTANT_CHECK_FAILED");
      }
      return body.feedback;
    };
    const diagnostic = (event: { requestId: string; outcome: "ACCEPTED" | "STALE" | "FAILED"; finalLastResult: InstantCheckSnapshot["lastResult"] | null }) => console.info(`[instant-check] controller diagnostic ${JSON.stringify({ sessionId: initial.session.id, ...event })}`);
    return instantControllerFactory ? instantControllerFactory({ scheduler, request, observe: setInstant, diagnostic }) : new InstantCheckController(scheduler, request, setInstant, diagnostic);
  }, [initial.session.id, targetBand, instantControllerFactory]);
  useEffect(() => { instantController.start(); return () => instantController.stop(); }, [instantController]);
  const activateInstantFeedback = useCallback((fingerprint: string, revealEditor: boolean) => {
    setActiveInstantFingerprint(fingerprint);
    if (revealEditor) editorRef.current?.revealFeedback(fingerprint);
    if (activeTimerRef.current !== null) window.clearTimeout(activeTimerRef.current);
    activeTimerRef.current = window.setTimeout(() => { setActiveInstantFingerprint(null); activeTimerRef.current = null; }, 1500);
  }, []);
  useEffect(() => () => { if (activeTimerRef.current !== null) window.clearTimeout(activeTimerRef.current); }, []);
  useEffect(() => {
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        controller.updateTimer(pause());
        void controller.flush();
      } else resume();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [controller, pause, resume]);
  useEffect(() => {
    if (task.intakeStatus !== "QUEUED" && task.intakeStatus !== "PROCESSING") return;
    const generation = taskPollGeneration.current;
    const attemptId = task.activeAttemptId;
    const timer = window.setInterval(async () => {
      try { const response = await fetch(`/api/task-intakes/${task.id}`); if (!response.ok) return; const resolution = await response.json(); setTask((current) => !acceptsTaskContextPoll(generation, taskPollGeneration.current, attemptId, current.activeAttemptId) ? current : { ...current, intakeStatus: resolution.processingStatus, currentTaskContextVersionId: resolution.taskContextVersionId }); } catch { return; }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [task.id, task.intakeStatus, task.activeAttemptId]);
  const retryTaskContext = useCallback(async () => {
    if (retryingTaskContext || task.intakeStatus !== "FAILED" || task.imagePlaceholderKind === "TASK_2_NOT_REQUIRED") return;
    setRetryingTaskContext(true); setTaskContextRetryError(undefined);
    try {
      const response = await fetch(`/api/task-intakes/${task.id}?action=retry`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() } });
      const body = await response.json() as { attemptId?: string; status?: "QUEUED" | "PROCESSING"; error?: string };
      if (!response.ok || !body.attemptId || (body.status !== "QUEUED" && body.status !== "PROCESSING")) throw new Error(body.error ?? "TASK_INTAKE_UNAVAILABLE");
      taskPollGeneration.current += 1;
      setTask((current) => ({ ...current, activeAttemptId: body.attemptId!, intakeStatus: body.status! }));
    } catch {
      setTaskContextRetryError("重新分析暂时无法启动，请稍后重试。");
    } finally { setRetryingTaskContext(false); }
  }, [retryingTaskContext, task.id, task.imagePlaceholderKind, task.intakeStatus]);
  const change = (value: string, content: unknown) => {
    const textChanged = value !== text;
    setText(value); setSelectedText(""); if (textChanged) { setContentVersion((current) => current + 1); setFeedbackOwner(null); } controller.change({ expectedRevisionId: controller.currentDraft?.expectedRevisionId ?? initial.revision.id, plainText: value, content, timer: writingTimer.timer });
    if (textChanged) instantController.edit({ text: value, revisionId: controller.currentDraft?.expectedRevisionId ?? initial.revision.id, taskType });
  };
  const reloadServerDraft = useCallback(async () => {
    if (autosaveState !== "CONFLICT" || reloadingConflict) return;
    setReloadingConflict(true);
    try {
      const response = await fetch(`/api/essays/${initial.session.id}`);
      const latest = await response.json() as WritingWorkspaceSnapshot;
      if (!response.ok || !latest.revision) throw new Error("LOAD_FAILED");
      controller.reload({ expectedRevisionId: latest.revision.id, plainText: latest.revision.plainText, content: latest.revision.content, timer: latest.timer }); setFeedbackOwner({ revisionId: latest.revision.id, textHash: latest.revision.textHash });
      setText(latest.revision.plainText); setEditorRevisionId(latest.revision.id); setSelectedText(""); setContentVersion((value) => value + 1); setTask(latest.task);
    } finally { setReloadingConflict(false); }
  }, [autosaveState, controller, initial.session.id, reloadingConflict]);
  const wordCount = countWords(text);
  const selectionWordCount = countWords(selectedText);
  const changeTargetBand = (nextTargetBand: TargetBand) => {
    setTargetBand(nextTargetBand);
    try { localStorage.setItem(targetBandKey(initial.session.id), nextTargetBand); } catch {}
  };
  return <main className="writing-app">
    <WorkspaceHeader />
    <div className="workspace-content">
      <section className="workspace-grid">
        <PromptPanel task={task} wordCount={wordCount} elapsedMs={writingTimer.elapsedMs} onRetryTaskContext={retryTaskContext} retryingTaskContext={retryingTaskContext} taskContextRetryError={taskContextRetryError} />
        <section className="panel editor-panel" data-testid="editor-scroll-panel">
          <div className="editor-heading"><span className="eyebrow">写作编辑区</span><span className="editor-save-state"><i />{saveStatus}</span></div>
          {autosaveState === "CONFLICT" ? <div className="feedback-error" data-testid="autosave-conflict">当前草稿与另一个更新版本发生冲突。<button type="button" onClick={() => void reloadServerDraft()} disabled={reloadingConflict}>{reloadingConflict ? "正在重新加载…" : "重新加载服务端最新草稿"}</button></div> : null}
          <EssayEditor key={editorRevisionId} ref={editorRef} value={text} onChange={change} onSelectionChange={setSelectedText} instantIssues={instant.issues} activeInstantFingerprint={activeInstantFingerprint} onInstantMarkerClick={(fingerprint) => activateInstantFeedback(fingerprint, false)} />
          <div className="editor-footer"><span>专注写作模式</span><span data-testid="editor-word-count">{selectionWordCount ? `${selectionWordCount} / ${wordCount} 个单词` : `${wordCount} 个单词`}</span></div>
        </section>
        <FeedbackPanel sessionId={initial.session.id} wordCount={wordCount} saveStatus={saveStatus} contentVersion={contentVersion} ownerTuple={feedbackOwner} taskType={taskType} targetBand={targetBand} onTargetBandChange={changeTargetBand} instant={instant} activeInstantFingerprint={activeInstantFingerprint} onInstantIssueClick={(fingerprint) => activateInstantFeedback(fingerprint, true)} />
      </section>
      <WritingJourney taskType={taskType} />
      <LearningMemory />
    </div>
  </main>;
}
