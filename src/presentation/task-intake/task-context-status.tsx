import type { WritingTask } from "../../domain/essay/writing-task.schema";
export function TaskContextStatus({ task, onRetry, retrying = false, retryError }: { task: WritingTask; onRetry?: () => void; retrying?: boolean; retryError?: string }) {
  if (task.imagePlaceholderKind === "TASK_2_NOT_REQUIRED") return null;
  if (task.intakeStatus === "QUEUED" || task.intakeStatus === "PROCESSING") return <p data-testid="task-context-status">正在分析题图...</p>;
  if (task.intakeStatus === "FAILED") return <div data-testid="task-context-status"><p>题图暂时无法识别。你仍可继续写作，但后续反馈会受限。</p>{retryError ? <p className="feedback-error">{retryError}</p> : null}<button type="button" disabled={retrying} onClick={onRetry}>{retrying ? "正在重新分析…" : "重新分析题图"}</button></div>;
  if (task.intakeStatus === "DEGRADED") return <p data-testid="task-context-status">题图部分信息存在不确定性；你仍可继续写作。</p>;
  if (task.intakeStatus === "READY") return <p data-testid="task-context-status">题图理解已完成。</p>;
  return null;
}
