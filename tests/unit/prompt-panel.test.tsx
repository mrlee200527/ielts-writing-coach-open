// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { WritingTask } from "../../src/domain/essay/writing-task.schema";
import { PromptPanel } from "../../src/presentation/writing/prompt-panel";
import { createEssayRouteHandlers } from "../../src/presentation/writing/route-handlers";
import { InMemoryEssaySessionRepository } from "../../src/testing/in-memory-essay-session.repository";

const baseTask: WritingTask = {
  id: "00000000-0000-4000-8000-000000000101",
  promptText: "",
  txtFileName: null,
  imagePlaceholderKind: "TASK_1_PENDING",
  imageBlobId: null,
  imageMediaType: null,
  imageSha256: null,
  intakeStatus: null,
  activeAttemptId: null,
  currentTaskContextVersionId: null,
};

function renderPrompt(promptText: string) {
  render(<PromptPanel task={{ ...baseTask, promptText }} wordCount={0} elapsedMs={0} />);
}

describe("Task 1 prompt presentation", () => {
  afterEach(cleanup);

  it("renders Markdown task wording beside the existing Task 1 image and context UI", () => {
    render(<PromptPanel task={{ ...baseTask, imageBlobId: "00000000-0000-4000-8000-000000000202", promptText: "# IELTS Academic Task 1\n\n**Population** reached 8 million.\n\n- Manhattan\n- Brooklyn" }} wordCount={0} elapsedMs={0} />);

    expect(screen.getByRole("heading", { name: "IELTS Academic Task 1" })).toBeTruthy();
    expect(screen.getByText("Population").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "放大查看 Task 1 题图" })).toBeTruthy();
    expect(screen.getByText("图表关键点提示")).toBeTruthy();
    expect(screen.getByTestId("word-count")).toBeTruthy();
  });

  it("renders a standard plain-text prompt without changing its wording", () => {
    const description = "The chart below shows average household energy use in four countries.";
    const instruction = "Summarise the information by selecting and reporting the main features, and make comparisons where relevant.";
    const requirement = "Write at least 150 words.";
    renderPrompt(`${description}\n\n${instruction}\n\n${requirement}`);

    expect(screen.getByText(description)).toBeTruthy();
    expect(screen.getByText(instruction)).toBeTruthy();
    expect(screen.getByText(requirement)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "IELTS Academic Task 1" })).toBeNull();
  });

  it("keeps a single-paragraph process prompt intact", () => {
    const description = "The diagram below shows how used glass bottles are recycled.";
    const instruction = "Summarise the information by selecting and reporting the main features, and make comparisons where relevant.";
    const requirement = "Write at least 150 words.";
    renderPrompt(`${description} ${instruction} ${requirement}`);

    expect(screen.getByText(`${description} ${instruction} ${requirement}`)).toBeTruthy();
  });

  it("keeps an unstructured prompt intact as the description", () => {
    const prompt = "Describe the map and identify its most important changes.";
    renderPrompt(prompt);

    expect(screen.getByText(prompt)).toBeTruthy();
  });

  it("shows real writing stats and an honest task-hints empty state", () => {
    render(<PromptPanel task={{ ...baseTask, promptText: "Describe the map." }} wordCount={86} elapsedMs={125000} />);

    expect(screen.getByTestId("word-count").textContent).toContain("86");
    expect(screen.getByText("建议字数：150+")).toBeTruthy();
    expect(screen.getByTestId("writing-time").textContent).toContain("02:05");
    expect(screen.getByText("图表关键点提示")).toBeTruthy();
    expect(screen.getByText("完成题图分析后显示可靠提示。")).toBeTruthy();
  });

  it.each([
    ["PROCESSING", "正在分析题图，完成后将显示可靠提示。"],
    ["READY", "题图理解已完成。全文反馈会在已识别的可靠信息范围内生成。"],
    ["DEGRADED", "题图部分信息存在不确定性，反馈会避免把不确定信息作为依据。"],
    ["FAILED", "题图分析未完成，暂不显示图表关键点。"],
  ] as const)("maps Task 1 %s hints without contradictory pending copy", (intakeStatus, hint) => {
    render(<PromptPanel task={{ ...baseTask, intakeStatus }} wordCount={0} elapsedMs={0} />);
    expect(screen.getByTestId("task-context-hint").textContent).toBe(hint);
  });

  it("renders Task 2 prompt without image region or chart hints", () => {
    render(<PromptPanel task={{ ...baseTask, imagePlaceholderKind: "TASK_2_NOT_REQUIRED", promptText: "To what extent do you agree?" }} wordCount={0} elapsedMs={0} />);

    expect(screen.getByText("To what extent do you agree?")).toBeTruthy();
    expect(screen.queryByTestId("task-image-placeholder")).toBeNull();
    expect(screen.queryByText("图表关键点提示")).toBeNull();
    expect(screen.getByText("Task prompt")).toBeTruthy();
    expect(screen.getByText("建议字数：250+")).toBeTruthy();
    expect(screen.queryByTestId("task-title")).toBeNull();
  });

  it("renders a Task 1 TXT title without changing its image presentation", () => {
    render(<PromptPanel task={{ ...baseTask, txtFileName: "Task 1 chart.txt", promptText: "Describe the chart." }} wordCount={0} elapsedMs={0} />);

    expect(screen.getByTestId("task-title").textContent).toBe("Task 1 chart");
    expect(screen.getByText("图表关键点提示")).toBeTruthy();
  });

  it("renders the same task title for Task 2 while keeping its image-free layout", () => {
    render(<PromptPanel task={{ ...baseTask, imagePlaceholderKind: "TASK_2_NOT_REQUIRED", txtFileName: "Task 2 Urban transport.txt", promptText: "Discuss both views." }} wordCount={0} elapsedMs={0} />);

    expect(screen.getByTestId("task-title").textContent).toBe("Task 2 Urban transport");
    expect(screen.queryByTestId("task-image-placeholder")).toBeNull();
    expect(screen.queryByText("图表关键点提示")).toBeNull();
  });

  it("renders the reloaded Task 2 TXT title from the real create-session chain", async () => {
    const handlers = createEssayRouteHandlers(new InMemoryEssaySessionRepository(), () => new Date("2026-08-24T01:00:00.000Z"));
    const created = await handlers.create(new Request("http://local/api/essays", {
      method: "POST",
      body: JSON.stringify({ clientRequestId: "title-chain", taskType: "TASK_2", txtFileName: "C5-T2-T1.txt", promptText: "Discuss both views." }),
    }));
    const { sessionId } = await created.json();
    const workspace = await (await handlers.get(sessionId)).json();

    render(<PromptPanel task={workspace.task} wordCount={0} elapsedMs={0} />);

    expect(screen.getByTestId("task-title").textContent).toBe("C5-T2-T1");
    expect(screen.queryByTestId("task-image-placeholder")).toBeNull();
    expect(screen.queryByText("图表关键点提示")).toBeNull();
    expect(screen.queryByRole("button", { name: "重新分析题图" })).toBeNull();
  });

  it("uses the global Markdown renderer for Task 2 wording", () => {
    render(<PromptPanel task={{ ...baseTask, imagePlaceholderKind: "TASK_2_NOT_REQUIRED", promptText: "# Task 2\n\n**Discuss both views.**" }} wordCount={0} elapsedMs={0} />);

    expect(screen.getByRole("heading", { name: "Task 2" })).toBeTruthy();
    expect(screen.getByText("Discuss both views.").tagName).toBe("STRONG");
    expect(screen.queryByTestId("task-image-placeholder")).toBeNull();
    expect(screen.queryByText("图表关键点提示")).toBeNull();
  });

  it("opens the Task 1 image in a modal and closes by button, backdrop, or Escape while restoring body scrolling", () => {
    const task = { ...baseTask, imageBlobId: "00000000-0000-4000-8000-000000000202", promptText: "Describe the chart." };
    const { rerender } = render(<PromptPanel task={task} wordCount={0} elapsedMs={0} />);

    fireEvent.click(screen.getByRole("button", { name: "放大查看 Task 1 题图" }));
    expect(screen.getByRole("dialog", { name: "Task 1 题图大图" })).toBeTruthy();
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: "关闭大图" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "放大查看 Task 1 题图" }));
    fireEvent.click(screen.getByTestId("task-image-lightbox-backdrop"));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "放大查看 Task 1 题图" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(<PromptPanel task={{ ...task, imagePlaceholderKind: "TASK_2_NOT_REQUIRED" }} wordCount={0} elapsedMs={0} />);
    expect(screen.queryByRole("button", { name: "放大查看 Task 1 题图" })).toBeNull();
  });
});
