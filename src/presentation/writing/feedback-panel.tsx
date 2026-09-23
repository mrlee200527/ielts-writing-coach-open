"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EssayFeedback } from "../../domain/feedback/essay-feedback.schema";
import { targetBands, type TargetBand } from "../../domain/feedback/ielts-rubric";
import type { InstantCheckSnapshot } from "./instant-check-controller";
import { instantFeedbackTone } from "./instant-feedback-location";

const emptyInstant: InstantCheckSnapshot = { state: "IDLE", issues: [] };
export type FeedbackOwnerTuple = { revisionId: string; textHash: string };
const hasMatchingOwner = (left: FeedbackOwnerTuple, right: FeedbackOwnerTuple) => left.revisionId === right.revisionId && left.textHash === right.textHash;
export function FeedbackPanel({ sessionId, wordCount, saveStatus, contentVersion = 0, ownerTuple, taskType = "TASK_1", targetBand = "6.5", onTargetBandChange = () => undefined, instant = emptyInstant, activeInstantFingerprint = null, onInstantIssueClick = () => undefined }: { sessionId: string; wordCount: number; saveStatus: string; contentVersion?: number; ownerTuple?: FeedbackOwnerTuple | null; taskType?: "TASK_1" | "TASK_2"; targetBand?: TargetBand; onTargetBandChange?: (targetBand: TargetBand) => void; instant?: InstantCheckSnapshot; activeInstantFingerprint?: string | null; onInstantIssueClick?: (fingerprint: string) => void }) {
  const [feedbackResult, setFeedbackResult] = useState<{ feedback: EssayFeedback; revisionId: string; textHash: string; contentVersion: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const contentVersionRef = useRef(contentVersion);

  useLayoutEffect(() => { contentVersionRef.current = contentVersion; }, [contentVersion]);

  useEffect(() => {
    if (!activeInstantFingerprint) return;
    const card = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("[data-feedback-id]") ?? []).find((element) => element.dataset.feedbackId === activeInstantFingerprint);
    if (typeof card?.scrollIntoView === "function") card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeInstantFingerprint]);

  const request = async () => {
    setLoading(true);
    setError(null);
    const requestedContentVersion = contentVersion;
    try {
      const response = await fetch(`/api/essays/${sessionId}/feedback`, { method: "POST" });
      const body = (await response.json()) as { feedback?: EssayFeedback; revisionId?: string; textHash?: string; message?: string };
      if (!response.ok || !body.feedback || !body.revisionId || !body.textHash) {
        setError(body.message ?? "反馈生成失败，请稍后重试。");
        return;
      }
      if (requestedContentVersion === contentVersionRef.current) setFeedbackResult({ feedback: body.feedback, revisionId: body.revisionId, textHash: body.textHash, contentVersion: requestedContentVersion });
    } catch {
      setError("反馈服务暂时不可用，请稍后再试。");
    } finally {
      setLoading(false);
    }
  };
  const feedback = feedbackResult?.contentVersion === contentVersion && (!ownerTuple || hasMatchingOwner(ownerTuple, feedbackResult)) ? feedbackResult.feedback : null;
  const feedbackExpired = feedbackResult !== null && feedback === null;

  return (
    <aside className="feedback-column" ref={panelRef} data-testid="feedback-scroll-panel">
      <section className="panel feedback-card realtime-card">
        <div className="section-heading"><p className="eyebrow">实时反馈</p><span className="feedback-count">{instant.issues.length}</span></div>
        <label className="target-band-control">目标分数<select aria-label="目标分数" value={targetBand} onChange={(event) => onTargetBandChange(event.target.value as TargetBand)}>{targetBands.map((band) => <option key={band} value={band}>{band}</option>)}</select></label>
        <div className="feedback-state-row"><span data-testid="save-status" className="save-badge">{saveStatus}</span><span>{instant.state === "COUNTING" ? "下一个固定 15 秒判定点检查本轮内容。" : instant.state === "ANALYZING" ? "正在检查刚才的内容..." : "继续写作，新输入会在下一个固定判定点检查"}</span></div>
        <p className="feedback-disclaimer">非官方估计，仅供练习参考</p>
        {wordCount < 150 ? <p className="feedback-hint">作文字数偏少，反馈可能不准确</p> : null}
        {error ? <p data-testid="feedback-error" className="feedback-error">{error}</p> : null}
        {feedbackExpired ? <p data-testid="feedback-expired" className="feedback-hint">作文已修改，请重新获取反馈。</p> : null}
        {instant.error ? <p className="feedback-error">{instant.error}</p> : null}
        {instant.error ? null : instant.issues.length > 0 ? <div className="realtime-list">
          {instant.issues.map((issue) => <button type="button" data-testid={`instant-feedback-${issue.fingerprint}`} data-feedback-id={issue.fingerprint} data-kind={issue.kind} className={`feedback-item feedback-tone-${instantFeedbackTone(issue.type)}${activeInstantFingerprint === issue.fingerprint ? " is-active" : ""}`} key={issue.fingerprint} onClick={() => onInstantIssueClick(issue.fingerprint)}><i /><p><strong>{issue.labelEn}</strong>{issue.targetText ? <span>“{issue.targetText}”</span> : null}<span>{issue.messageZh}</span></p><small className={`issue-kind issue-kind-${issue.kind}`}>{issue.kind === "language_error" ? "明确语言错误" : issue.kind === "confirmed_error" ? "已确认事实错误" : "IELTS 辅导"}</small></button>)}
        </div> : instant.lastResult === "no_high_value_issue" ? <div className="analysis-empty"><strong>这一轮没有需要打断你的问题</strong><p>继续写吧。</p></div> : feedback ? (
          <div className="realtime-list">
            {feedback.strengths.slice(0, 2).map((strength) => <div className="feedback-item strength" key={strength}><i /> <p><strong>做得很好</strong><span>{strength}</span></p></div>)}
            {feedback.improvements.slice(0, 2).map((improvement) => <div className="feedback-item improvement" key={improvement}><i /> <p><strong>可以改进</strong><span>{improvement}</span></p></div>)}
          </div>
        ) : <div className="analysis-empty"><strong>等待全文分析</strong><p>写完后获取真实 MiMo 反馈，这里不会显示模拟建议。</p></div>}
        <button className="primary-action" data-testid="request-feedback" type="button" disabled={loading || saveStatus !== "已保存" || ownerTuple === null} onClick={() => void request()}>{loading ? "获取中…" : "获取反馈"}</button>
      </section>

      <section className="panel feedback-card score-card">
        <p className="eyebrow">分数预测</p>
        {feedback ? <div data-testid="feedback-result" className="feedback-result">
          <div className="overall-score"><span>总体预测</span><strong data-testid="feedback-overall">{feedback.overallBand}</strong></div>
          <ul>
            <li>{"taskResponse" in feedback.criteria ? "Task Response" : "任务完成度"} <strong>{"taskResponse" in feedback.criteria ? feedback.criteria.taskResponse : feedback.criteria.taskAchievement}</strong></li>
            <li>连贯与衔接 <strong>{feedback.criteria.coherenceCohesion}</strong></li>
            <li>词汇资源 <strong>{feedback.criteria.lexicalResource}</strong></li>
            <li>语法范围与准确性 <strong>{feedback.criteria.grammaticalRangeAccuracy}</strong></li>
          </ul>
        </div> : <div className="analysis-empty compact"><strong>尚无预测</strong><p>完成全文分析后显示分数预测。</p></div>}
      </section>

      <section className="panel feedback-card priority-card">
        <p className="eyebrow">优先改进</p>
        {feedback ? <div className="priority-result"><span>1</span><p>最优先改进：{feedback.priorityImprovement}</p><div><strong>其他建议</strong><p>{feedback.improvements.join("；")}</p></div></div> : <div className="analysis-empty compact"><strong>等待建议</strong><p>完成全文分析后显示优先改进建议。</p></div>}
      </section>
    </aside>
  );
}
