"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { formatWritingTime } from "../../domain/essay/writing-timer";
import type { WritingTask } from "../../domain/essay/writing-task.schema";
import { TaskContextStatus } from "../task-intake/task-context-status";
import { TaskPromptMarkdown } from "./task-prompt-markdown";

export function PromptPanel({ task, wordCount, elapsedMs, onRetryTaskContext, retryingTaskContext, taskContextRetryError }: { task: WritingTask; wordCount: number; elapsedMs: number; onRetryTaskContext?: () => void; retryingTaskContext?: boolean; taskContextRetryError?: string }) {
  const [imageOpen, setImageOpen] = useState(false);
  const imageTriggerRef = useRef<HTMLButtonElement>(null);
  const isTask2 = task.imagePlaceholderKind === "TASK_2_NOT_REQUIRED";
  useEffect(() => {
    if (!imageOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setImageOpen(false); };
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("keydown", closeOnEscape); document.body.style.overflow = previousOverflow; imageTriggerRef.current?.focus({ preventScroll: true }); };
  }, [imageOpen]);
  const imageSrc = task.imageBlobId ? `/api/task-images/${task.imageBlobId}` : null;
  const taskTitle = task.txtFileName?.replace(/\.[^/.]+$/, "");
  const taskHint = task.intakeStatus === "READY"
    ? "题图理解已完成。全文反馈会在已识别的可靠信息范围内生成。"
    : task.intakeStatus === "DEGRADED"
      ? "题图部分信息存在不确定性，反馈会避免把不确定信息作为依据。"
      : task.intakeStatus === "FAILED"
        ? "题图分析未完成，暂不显示图表关键点。"
        : task.intakeStatus === "QUEUED" || task.intakeStatus === "PROCESSING"
          ? "正在分析题图，完成后将显示可靠提示。"
          : "完成题图分析后显示可靠提示。";
  return <aside className="panel prompt-panel" data-testid="prompt-scroll-panel">
    <p className="eyebrow">{isTask2 ? "Task prompt" : "Task and image"}</p>
    {taskTitle ? <p className="task-title" data-testid="task-title">{taskTitle}</p> : null}
    <div className="ielts-task-prompt" data-testid="task-prompt-markdown"><TaskPromptMarkdown source={task.promptText} /></div>
    {!isTask2 && (imageSrc ? <button ref={imageTriggerRef} type="button" className="task-image-trigger" aria-label="放大查看 Task 1 题图" onClick={() => setImageOpen(true)}><Image unoptimized className="task-prompt-image" width={640} height={480} data-testid="task-original-image" src={imageSrc} alt="Original IELTS Task 1 prompt" /><span>点击放大</span></button> : <div data-testid="task-image-placeholder" className="image-placeholder">题图将在后续导入</div>)}
    <TaskContextStatus task={task} onRetry={onRetryTaskContext} retrying={retryingTaskContext} retryError={taskContextRetryError} />
    {!isTask2 ? <section className="task-hints">
      <div className="section-heading"><strong>图表关键点提示</strong><span>AI</span></div>
      <p data-testid="task-context-hint">{taskHint}</p>
    </section> : null}
    <section className="writing-stats">
      <strong>字数统计</strong>
      <div><span data-testid="word-count">当前字数：{wordCount}</span><span data-testid="writing-time">用时：{formatWritingTime(elapsedMs)}</span></div>
      <p>建议字数：{isTask2 ? "250+" : "150+"}</p>
      <div className="word-progress"><i style={{ width: `${Math.min(100, (wordCount / (isTask2 ? 250 : 150)) * 100)}%` }} /></div>
    </section>
    {imageOpen && imageSrc ? createPortal(<div className="task-image-lightbox" role="dialog" aria-modal="true" aria-label="Task 1 题图大图" data-testid="task-image-lightbox-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setImageOpen(false); }}><button type="button" className="lightbox-close" aria-label="关闭大图" onClick={() => setImageOpen(false)}>×</button><Image unoptimized className="lightbox-image" width={1600} height={1200} src={imageSrc} alt="Enlarged IELTS Task 1 prompt" /></div>, document.body) : null}
  </aside>;
}
