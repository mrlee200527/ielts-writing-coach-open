// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FeedbackPanel } from "../../src/presentation/writing/feedback-panel";

const validFeedback = {
  overallBand: 6.5,
  criteria: { taskAchievement: 6, coherenceCohesion: 6.5, lexicalResource: 6, grammaticalRangeAccuracy: 5.5 },
  strengths: ["Clear structure", "Good range of vocabulary"],
  improvements: ["Develop main ideas further", "Check article usage"],
  priorityImprovement: "Develop main ideas further",
};

function mockFetchOnce(response: { status: number; body: unknown }) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(response.body), { status: response.status }));
}

describe("feedback panel", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("shows the button, the non-official disclaimer and a hint under 150 words", () => {
    render(<FeedbackPanel sessionId="00000000-0000-4000-8000-000000000102" wordCount={120} saveStatus="已保存" />);
    expect(screen.getByText("获取反馈")).toBeTruthy();
    expect(screen.getByText("非官方估计，仅供练习参考")).toBeTruthy();
    expect(screen.getByText(/作文字数偏少，反馈可能不准确/)).toBeTruthy();
    expect(screen.getByText("已保存")).toBeTruthy();
    expect(screen.getByText("完成全文分析后显示分数预测。")).toBeTruthy();
    expect(screen.getByText("完成全文分析后显示优先改进建议。")).toBeTruthy();
    expect(screen.queryByText(/总分估计：/)).toBeNull();
  });

  it("posts to the feedback endpoint without a clientRequestId and renders the feedback", async () => {
    const fetchMock = mockFetchOnce({ status: 200, body: { feedback: validFeedback, revisionId: "revision-1", textHash: "hash-1" } });
    render(<FeedbackPanel sessionId="00000000-0000-4000-8000-000000000102" wordCount={152} saveStatus="已保存" />);
    fireEvent.click(screen.getByText("获取反馈"));
    await waitFor(() => expect(screen.getByTestId("feedback-result")).toBeTruthy());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/essays/00000000-0000-4000-8000-000000000102/feedback");
    expect(init?.method).toBe("POST");
    expect(JSON.stringify(init?.body ?? "")).not.toContain("clientRequestId");
    expect(screen.getByTestId("feedback-overall").textContent).toContain("6.5");
    expect(screen.getByText(/任务完成度/).textContent).toContain("6");
    expect(screen.getByText(/Clear structure/)).toBeTruthy();
    expect(screen.getByText(/最优先改进/).textContent).toContain("Develop main ideas further");
    expect(screen.getByText("分数预测")).toBeTruthy();
    expect(screen.getByText("优先改进")).toBeTruthy();
  });

  it("disables the button while the request is in flight", async () => {
    let resolveFetch!: (value: Response) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    render(<FeedbackPanel sessionId="00000000-0000-4000-8000-000000000102" wordCount={152} saveStatus="已保存" />);
    const button = screen.getByText("获取反馈") as HTMLButtonElement;
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    resolveFetch(new Response(JSON.stringify({ feedback: validFeedback, revisionId: "revision-1", textHash: "hash-1" }), { status: 200 }));
    await waitFor(() => expect((screen.getByText("获取反馈") as HTMLButtonElement).disabled).toBe(false));
  });

  it("renders the stable Chinese error message on a 502 response", async () => {
    mockFetchOnce({ status: 502, body: { error: "FEEDBACK_LLM_FAILED", message: "反馈生成失败，请稍后重试。" } });
    render(<FeedbackPanel sessionId="00000000-0000-4000-8000-000000000102" wordCount={152} saveStatus="已保存" />);
    fireEvent.click(screen.getByText("获取反馈"));
    await waitFor(() => expect(screen.getByTestId("feedback-error").textContent).toContain("反馈生成失败"));
    expect(screen.queryByText("TASK_TYPE_AMBIGUOUS")).toBeNull();
  });

  it("shows a generic message when the network fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    render(<FeedbackPanel sessionId="00000000-0000-4000-8000-000000000102" wordCount={152} saveStatus="已保存" />);
    fireEvent.click(screen.getByText("获取反馈"));
    await waitFor(() => expect(screen.getByTestId("feedback-error").textContent).toContain("暂时不可用"));
  });

  it("renders Instant Check state and Socratic issues without updating score", () => {
    render(<FeedbackPanel sessionId="s" wordCount={42} saveStatus="已保存" instant={{ state: "COUNTING", issues: [{ type: "grammar", subtype: "tense", severity: "medium", targetText: "increases in 1900", messageZh: "这里描述的是过去，这个动词的时态是不是可以再检查一下？", labelEn: "Grammar · tense", fingerprint: "fp", kind: "language_error" }] }} />);
    expect(screen.getByText("下一个固定 15 秒判定点检查本轮内容。")).toBeTruthy();
    expect(screen.getByText("Grammar · tense")).toBeTruthy();
    expect(screen.getByText(/是不是可以再检查一下/)).toBeTruthy();
    expect(screen.getByText("完成全文分析后显示分数预测。")).toBeTruthy();
  });

  it("shows an Instant Check failure instead of stale no-issue success", () => {
    render(<FeedbackPanel sessionId="s" wordCount={42} saveStatus="已保存" instant={{ state: "IDLE", issues: [], error: "本轮 AI 检查失败，将在下一轮重试。写作不会受到影响。", lastResult: "no_high_value_issue" }} />);
    expect(screen.getByText("本轮 AI 检查失败，将在下一轮重试。写作不会受到影响。")).toBeTruthy();
    expect(screen.queryByText("这一轮没有需要打断你的问题")).toBeNull();
  });

  it("still shows no-issue success when the check succeeds with zero visible issues", () => {
    render(<FeedbackPanel sessionId="s" wordCount={42} saveStatus="已保存" instant={{ state: "IDLE", issues: [], lastResult: "no_high_value_issue" }} />);
    expect(screen.getByText("这一轮没有需要打断你的问题")).toBeTruthy();
    expect(screen.queryByText("本轮 AI 检查失败，将在下一轮重试。写作不会受到影响。")).toBeNull();
  });

  it("activates a feedback card and reports its fingerprint when clicked", () => {
    const onIssueClick = vi.fn();
    const instant = { state: "IDLE" as const, issues: [{ type: "grammar" as const, subtype: "tense", severity: "medium" as const, targetText: "increases", messageZh: "这里的时态合适吗？", labelEn: "Grammar · tense", fingerprint: "fp", kind: "language_error" as const }] };
    render(<FeedbackPanel sessionId="s" wordCount={160} saveStatus="已保存" instant={instant} activeInstantFingerprint="fp" onInstantIssueClick={onIssueClick} />);
    const card = screen.getByTestId("instant-feedback-fp");
    expect(card.classList.contains("is-active")).toBe(true);
    expect(card.classList.contains("feedback-tone-orange")).toBe(true);
    fireEvent.click(card);
    expect(onIssueClick).toHaveBeenCalledWith("fp");
  });

  it("renders an article-level issue without fake or empty quoted evidence", () => {
    const instant = { state: "IDLE" as const, issues: [{ type: "task_relevance" as const, subtype: "overall position", severity: "high" as const, targetText: "", messageZh: "这篇文章的立场是否足够清楚？", labelEn: "Task relevance", fingerprint: "article", kind: "ielts_coaching" as const }] };
    render(<FeedbackPanel sessionId="s" wordCount={160} saveStatus="已保存" instant={instant} />);
    const card = screen.getByTestId("instant-feedback-article");
    expect(card.textContent).toContain("这篇文章的立场是否足够清楚？");
    expect(card.textContent).not.toContain("“”");
  });

  it("distinguishes language errors from IELTS coaching issues and shows every active issue without a cap", () => {
    const issues = Array.from({ length: 10 }, (_, index) => ({
      type: (index % 2 === 0 ? "grammar" : "clarity") as "grammar" | "clarity",
      subtype: index % 2 === 0 ? "tense" : "unclear reference",
      severity: "medium" as const,
      targetText: `target ${index}`,
      messageZh: `检查第 ${index} 处。`,
      labelEn: index % 2 === 0 ? "Grammar · tense" : "Clarity",
      fingerprint: `fp-${index}`,
      kind: (index % 2 === 0 ? "language_error" : "ielts_coaching") as "language_error" | "ielts_coaching",
    }));
    const onTargetBandChange = vi.fn();
    render(<FeedbackPanel sessionId="s" wordCount={260} saveStatus="已保存" targetBand="7.5" onTargetBandChange={onTargetBandChange} instant={{ state: "IDLE", issues }} />);
    const targetBand = screen.getByRole("combobox", { name: "目标分数" }) as HTMLSelectElement;
    expect(targetBand.value).toBe("7.5");
    expect([...targetBand.options].map((option) => option.value)).toEqual(["6.0", "6.5", "7.0", "7.5"]);
    fireEvent.change(targetBand, { target: { value: "6.0" } });
    expect(onTargetBandChange).toHaveBeenCalledWith("6.0");
    expect(screen.getByTestId("instant-feedback-fp-0").getAttribute("data-kind")).toBe("language_error");
    expect(screen.getByTestId("instant-feedback-fp-1").getAttribute("data-kind")).toBe("ielts_coaching");
    expect(screen.getAllByText("明确语言错误")).toHaveLength(5);
    expect(screen.getAllByText("IELTS 辅导")).toHaveLength(5);
    expect(screen.getAllByTestId(/^instant-feedback-/)).toHaveLength(10);
  });

  it("renders each Instant Issue kind with its explicit Chinese label", () => {
    const issues = [
      { type: "grammar" as const, subtype: "tense", severity: "medium" as const, targetText: "rose", messageZh: "检查时态。", labelEn: "Grammar", fingerprint: "language", kind: "language_error" as const },
      { type: "task_accuracy" as const, subtype: "fact", severity: "high" as const, targetText: "50%", messageZh: "检查数据。", labelEn: "Fact", fingerprint: "confirmed", kind: "confirmed_error" as const },
      { type: "clarity" as const, subtype: "cohesion", severity: "low" as const, targetText: "this", messageZh: "检查衔接。", labelEn: "Clarity", fingerprint: "coaching", kind: "ielts_coaching" as const },
    ];
    render(<FeedbackPanel sessionId="s" wordCount={260} saveStatus="已保存" instant={{ state: "IDLE", issues }} />);

    expect(screen.getByTestId("instant-feedback-language").getAttribute("data-kind")).toBe("language_error");
    expect(screen.getByTestId("instant-feedback-confirmed").getAttribute("data-kind")).toBe("confirmed_error");
    expect(screen.getByTestId("instant-feedback-coaching").getAttribute("data-kind")).toBe("ielts_coaching");
    expect(screen.getByTestId("instant-feedback-language").textContent).toContain("明确语言错误");
    expect(screen.getByTestId("instant-feedback-confirmed").textContent).toContain("已确认事实错误");
    expect(screen.getByTestId("instant-feedback-coaching").textContent).toContain("IELTS 辅导");
  });

  it("offers Task 2 full analysis and labels its first criterion as Task Response", async () => {
    mockFetchOnce({ status: 200, body: { feedback: { ...validFeedback, criteria: { taskResponse: 6, coherenceCohesion: 6.5, lexicalResource: 6, grammaticalRangeAccuracy: 5.5 } }, revisionId: "revision-1", textHash: "hash-1" } });
    render(<FeedbackPanel sessionId="s" wordCount={260} saveStatus="已保存" taskType="TASK_2" />);
    fireEvent.click(screen.getByRole("button", { name: "获取反馈" }));
    await waitFor(() => expect(screen.getByTestId("feedback-result")).toBeTruthy());
    expect(screen.getByText(/Task Response/).textContent).toContain("6");
    expect(screen.queryByText(/任务完成度/)).toBeNull();
  });

  it("does not run a full Instant Check when requesting Full Analysis", async () => {
    let resolveFull!: (value: Response) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise<Response>((resolve) => { resolveFull = resolve; }));
    render(<FeedbackPanel sessionId="s" wordCount={260} saveStatus="已保存" taskType="TASK_2" />);
    fireEvent.click(screen.getByRole("button", { name: "获取反馈" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/essays/s/feedback", { method: "POST" });
    resolveFull(new Response(JSON.stringify({ feedback: { ...validFeedback, criteria: { taskResponse: 6, coherenceCohesion: 6.5, lexicalResource: 6, grammaticalRangeAccuracy: 5.5 } }, revisionId: "revision-1", textHash: "hash-1" }), { status: 200 }));
    await waitFor(() => expect(screen.getByTestId("feedback-result")).toBeTruthy());
  });

  it("expires displayed feedback when the essay changes", async () => {
    mockFetchOnce({ status: 200, body: { feedback: validFeedback, revisionId: "revision-1", textHash: "hash-1" } });
    const { rerender } = render(<FeedbackPanel sessionId="s" wordCount={200} saveStatus="已保存" contentVersion={0} />);
    fireEvent.click(screen.getByText("获取反馈"));
    await waitFor(() => expect(screen.getByTestId("feedback-result")).toBeTruthy());
    rerender(<FeedbackPanel sessionId="s" wordCount={201} saveStatus="待保存" contentVersion={1} />);
    expect(screen.getByTestId("feedback-expired").textContent).toContain("作文已修改");
    expect(screen.queryByTestId("feedback-result")).toBeNull();
  });

  it("does not accept a response after the essay changed in flight", async () => {
    let resolveFetch!: (value: Response) => void;
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    const { rerender } = render(<FeedbackPanel sessionId="s" wordCount={200} saveStatus="已保存" contentVersion={0} />);
    fireEvent.click(screen.getByText("获取反馈"));
    rerender(<FeedbackPanel sessionId="s" wordCount={201} saveStatus="待保存" contentVersion={1} />);
    resolveFetch(new Response(JSON.stringify({ feedback: validFeedback, revisionId: "revision-1", textHash: "hash-1" }), { status: 200 }));
    await waitFor(() => expect(screen.getByText("获取反馈")).toBeTruthy());
    expect(screen.queryByTestId("feedback-result")).toBeNull();
    expect(screen.queryByTestId("feedback-expired")).toBeNull();
  });

  it("expires a response whose revisionId/textHash owner tuple is not the current saved draft", async () => {
    mockFetchOnce({ status: 200, body: { feedback: validFeedback, revisionId: "revision-old", textHash: "hash-old" } });
    render(<FeedbackPanel sessionId="s" wordCount={200} saveStatus="已保存" contentVersion={0} ownerTuple={{ revisionId: "revision-current", textHash: "hash-current" }} />);
    fireEvent.click(screen.getByText("获取反馈"));

    await waitFor(() => expect(screen.getByTestId("feedback-expired").textContent).toContain("作文已修改"));
    expect(screen.queryByTestId("feedback-result")).toBeNull();
  });

  it("restores valid feedback after requesting it for the current essay version", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ feedback: validFeedback, revisionId: "revision-1", textHash: "hash-1" }), { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ feedback: validFeedback, revisionId: "revision-2", textHash: "hash-2" }), { status: 200 }));
    const { rerender } = render(<FeedbackPanel sessionId="s" wordCount={200} saveStatus="已保存" contentVersion={0} />);
    fireEvent.click(screen.getByText("获取反馈"));
    await waitFor(() => expect(screen.getByTestId("feedback-result")).toBeTruthy());
    rerender(<FeedbackPanel sessionId="s" wordCount={201} saveStatus="已保存" contentVersion={1} />);
    expect(screen.getByTestId("feedback-expired")).toBeTruthy();
    fireEvent.click(screen.getByText("获取反馈"));
    await waitFor(() => expect(screen.getByTestId("feedback-result")).toBeTruthy());
    expect(screen.queryByTestId("feedback-expired")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
