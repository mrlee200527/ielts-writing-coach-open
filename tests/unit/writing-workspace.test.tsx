// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { acceptsTaskContextPoll, logInstantCheckDegradation, type InstantControllerFactory, WritingWorkspace } from "../../src/presentation/writing/writing-workspace";

const snapshot = {
  task: { id: "00000000-0000-4000-8000-000000000101", promptText: "Describe the chart.", txtFileName: null, imagePlaceholderKind: "TASK_1_PENDING" as const, imageBlobId: null, imageMediaType: null, imageSha256: null, intakeStatus: null, activeAttemptId: null, currentTaskContextVersionId: null },
  session: { id: "00000000-0000-4000-8000-000000000102", userId: "00000000-0000-4000-8000-000000000100", taskId: "00000000-0000-4000-8000-000000000101", status: "DRAFT" as const, currentRevisionId: "00000000-0000-4000-8000-000000000103", startedAt: "2026-08-14T01:00:00.000Z" },
  revision: { id: "00000000-0000-4000-8000-000000000103", sessionId: "00000000-0000-4000-8000-000000000102", revisionNo: 1, plainText: "", content: { type: "doc", content: [] }, wordCount: 0, textHash: "hash", createdAt: "2026-08-14T01:00:00.000Z" },
  timer: { elapsedMs: 0 },
};

describe("writing workspace", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
  it("shows three-column content and reflects the revision word count", () => {
    render(<WritingWorkspace initial={{ ...snapshot, revision: { ...snapshot.revision, plainText: "The chart rose sharply.", wordCount: 4 } }} />);
    expect(screen.getByText("题图将在后续导入")).toBeTruthy();
    expect(screen.getByText("获取反馈")).toBeTruthy();
    expect(screen.getByText("非官方估计，仅供练习参考")).toBeTruthy();
    expect(screen.getByTestId("word-count").textContent).toContain("4");
  });

  it.each(["TASK_1", "TASK_2"] as const)("wires %s standard controller snapshots to the same FeedbackPanel copy", (taskType) => {
    let observe!: Parameters<InstantControllerFactory>[0]["observe"];
    const factory: InstantControllerFactory = ({ observe: next }) => { observe = next; return { start: () => undefined, stop: () => undefined, edit: () => undefined }; };
    render(<WritingWorkspace initial={{ ...snapshot, task: { ...snapshot.task, imagePlaceholderKind: taskType === "TASK_2" ? "TASK_2_NOT_REQUIRED" : "TASK_1_PENDING" } }} instantControllerFactory={factory} />);
    act(() => observe({ state: "ANALYZING", issues: [] }));
    expect(screen.getByText("正在检查刚才的内容...")).toBeTruthy();
    act(() => observe({ state: "COUNTING", issues: [] }));
    expect(screen.getByText("下一个固定 15 秒判定点检查本轮内容。")).toBeTruthy();
    if (taskType === "TASK_2") {
      expect(screen.queryByText("图表关键点提示")).toBeNull();
      expect(screen.queryByTestId("task-image-placeholder")).toBeNull();
      expect(screen.queryByRole("button", { name: "重新分析题图" })).toBeNull();
    }
  });

  it("presents the functional workspace modes and honest learning journey", () => {
    render(<WritingWorkspace initial={snapshot} />);

    expect(screen.getByRole("button", { name: "实时助手模式" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("button", { name: /段落分析模式/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /模拟考试模式/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("AI 如何陪伴你写作")).toBeTruthy();
    expect(screen.getByText("学习记忆将在持续练习后显示在这里。")).toBeTruthy();
    expect(screen.getByText("输入内容")).toBeTruthy();
    expect(screen.getAllByText("即将推出").length).toBeGreaterThan(0);
  });

  it("keeps Task 1 journey context out of the Task 2 workspace", () => {
    const { unmount } = render(<WritingWorkspace initial={snapshot} />);
    expect(screen.getByText("在编辑区完成 Task 1")).toBeTruthy();
    expect(screen.getByText("题图理解")).toBeTruthy();
    expect(screen.getByText("使用真实 Task Context")).toBeTruthy();
    unmount();

    render(<WritingWorkspace initial={{ ...snapshot, task: { ...snapshot.task, imagePlaceholderKind: "TASK_2_NOT_REQUIRED", promptText: "Discuss both views." } }} />);
    expect(screen.queryByText("在编辑区完成 Task 1")).toBeNull();
    expect(screen.queryByText("题图理解")).toBeNull();
    expect(screen.queryByText("使用真实 Task Context")).toBeNull();
  });

  it("pauses the timer before flushing when the page becomes hidden", async () => {
    let visibilityState: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibilityState);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ revision: { id: "00000000-0000-4000-8000-000000000104" } }), { status: 200 }));
    render(<WritingWorkspace initial={{ ...snapshot, timer: { elapsedMs: 1000, runningSince: new Date(Date.now() - 1000).toISOString() } }} />);
    visibilityState = "hidden";
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(request.body as string);
    expect(body.timer.elapsedMs).toBeGreaterThanOrEqual(1900);
    expect(body.timer.runningSince).toBeUndefined();
  });
  it("keeps the original image visible while processing",()=>{render(<WritingWorkspace initial={{...snapshot,task:{...snapshot.task,imageBlobId:"00000000-0000-4000-8000-000000000199",imageMediaType:"image/png",imageSha256:"a".repeat(64),intakeStatus:"PROCESSING",activeAttemptId:"00000000-0000-4000-8000-000000000198"}}}/>);expect(screen.getByTestId("task-original-image")).toBeTruthy();expect(screen.getByText("正在分析题图...")).toBeTruthy();});
  it("keeps writing available when recognition fails",()=>{render(<WritingWorkspace initial={{...snapshot,task:{...snapshot.task,imageBlobId:"00000000-0000-4000-8000-000000000199",imageMediaType:"image/png",imageSha256:"a".repeat(64),intakeStatus:"FAILED",activeAttemptId:"00000000-0000-4000-8000-000000000198"}}}/>);expect(screen.getByText(/题图暂时无法识别/)).toBeTruthy();expect(screen.getByTestId("essay-editor")).toBeTruthy();});

  it("submits one FAILED retry and only changes state after the server accepts it", async () => {
    let resolveRetry!: (response: Response) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      if (String(input).includes("/api/task-intakes/") && init?.method === "POST") return new Promise<Response>((resolve) => { resolveRetry = resolve; });
      return Promise.resolve(Response.json({ revision: { id: snapshot.revision.id } }));
    });
    render(<WritingWorkspace initial={{ ...snapshot, task: { ...snapshot.task, imageBlobId: "00000000-0000-4000-8000-000000000199", imageMediaType: "image/png", imageSha256: "a".repeat(64), intakeStatus: "FAILED", activeAttemptId: "00000000-0000-4000-8000-000000000198" } }} />);
    const retry = screen.getByRole("button", { name: "重新分析题图" });
    fireEvent.click(retry); fireEvent.click(retry);
    expect(fetchMock.mock.calls.filter(([input, init]) => String(input).includes("/api/task-intakes/") && init?.method === "POST")).toHaveLength(1);
    expect(screen.getByText(/正在重新分析/)).toBeTruthy();
    resolveRetry(Response.json({ attemptId: "00000000-0000-4000-8000-000000000201", status: "QUEUED" }, { status: 202 }));
    await waitFor(() => expect(screen.getByText("正在分析题图...")).toBeTruthy());
  });

  it("keeps FAILED and re-enables retry after a retry API failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "TASK_INTAKE_UNAVAILABLE" }, { status: 503 }));
    render(<WritingWorkspace initial={{ ...snapshot, task: { ...snapshot.task, intakeStatus: "FAILED", activeAttemptId: "00000000-0000-4000-8000-000000000198" } }} />);
    fireEvent.click(screen.getByRole("button", { name: "重新分析题图" }));
    await waitFor(() => expect(screen.getByText("重新分析暂时无法启动，请稍后重试。")).toBeTruthy());
    expect((screen.getByRole("button", { name: "重新分析题图" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/题图暂时无法识别/)).toBeTruthy();
  });

  it("drops attempt A's late poll after attempt B replaces it, while accepting B's poll", () => {
    const attemptA = "00000000-0000-4000-8000-000000000198";
    const attemptB = "00000000-0000-4000-8000-000000000201";
    const generationA = 4;
    const generationB = 5;

    expect(acceptsTaskContextPoll(generationA, generationB, attemptA, attemptB)).toBe(false);
    expect(acceptsTaskContextPoll(generationB, generationB, attemptB, attemptB)).toBe(true);
  });

  it("uses one session target-band source, persists changes, and does not request MiMo immediately", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    localStorage.setItem("target-band:00000000-0000-4000-8000-000000000102", "7.0");
    const { unmount } = render(<WritingWorkspace initial={snapshot} />);
    const persisted = screen.getByRole("combobox", { name: "目标分数" }) as HTMLSelectElement;
    expect(persisted.value).toBe("7.0");
    fireEvent.change(persisted, { target: { value: "7.5" } });
    expect(localStorage.getItem("target-band:00000000-0000-4000-8000-000000000102")).toBe("7.5");
    expect(fetchMock).not.toHaveBeenCalled();
    unmount();
    localStorage.removeItem("target-band:00000000-0000-4000-8000-000000000102");

    render(<WritingWorkspace initial={snapshot} />);
    expect((screen.getByRole("combobox", { name: "目标分数" }) as HTMLSelectElement).value).toBe("6.5");
  });

  it("logs expected Instant Check degradation without triggering a console error overlay", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    logInstantCheckDegradation({ code: "INVALID_JSON", structure: null });

    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('"code":"INVALID_JSON"'));
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("keeps fixed-window Instant Check eligible after an unaccepted request", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/instant-check")) return Response.json({ error: "INVALID_JSON" }, { status: 502 });
      return Response.json({ revision: { id: snapshot.revision.id } }, { status: 200 });
    });
    render(<WritingWorkspace initial={snapshot} />);
    await vi.advanceTimersByTimeAsync(0);
    const editor = screen.getByTestId("essay-editor");
    fireEvent.input(editor, { target: { textContent: "The chart rose sharply." } });
    await vi.advanceTimersByTimeAsync(15000);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/instant-check"))).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(15000);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/instant-check"))).toHaveLength(2);
  });

  it("shows conflict recovery and reloads the latest server draft", async () => {
    const latest = { ...snapshot, revision: { ...snapshot.revision, id: "00000000-0000-4000-8000-000000000199", plainText: "server draft" } };
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      if (String(input).endsWith("/draft")) return Promise.resolve(Response.json({ currentRevisionId: latest.revision.id }, { status: 409 }));
      if (String(input) === `/api/essays/${snapshot.session.id}`) return Promise.resolve(Response.json(latest));
      return Promise.resolve(Response.json({ revision: { id: snapshot.revision.id } }));
    });
    render(<WritingWorkspace initial={snapshot} initialAutosaveState="CONFLICT" />);
    expect(screen.getByTestId("autosave-conflict").textContent).toContain("当前草稿与另一个更新版本发生冲突");
    expect((screen.getByRole("button", { name: "获取反馈" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "重新加载服务端最新草稿" }));
    await waitFor(() => expect(screen.queryByTestId("autosave-conflict")).toBeNull());
    expect(screen.getByTestId("essay-editor").textContent).toContain("server draft");
    expect(screen.getByTestId("save-status").textContent).toBe("已保存");
  });
});
