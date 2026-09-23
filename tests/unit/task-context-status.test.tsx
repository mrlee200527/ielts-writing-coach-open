// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { WritingTask } from "../../src/domain/essay/writing-task.schema";
import { TaskContextStatus } from "../../src/presentation/task-intake/task-context-status";

const task: WritingTask = {
  id: "00000000-0000-4000-8000-000000000101", promptText: "Describe the chart.", txtFileName: null, imagePlaceholderKind: "TASK_1_PENDING",
  imageBlobId: null, imageMediaType: null, imageSha256: null, intakeStatus: null, activeAttemptId: null, currentTaskContextVersionId: null,
};

describe("task context status", () => {
  afterEach(cleanup);
  it.each([
    ["PROCESSING", "正在分析题图"],
    ["READY", "题图理解已完成"],
    ["DEGRADED", "部分信息存在不确定性"],
    ["FAILED", "题图暂时无法识别"],
  ] as const)("maps %s to an honest Task 1 status", (intakeStatus, message) => {
    render(<TaskContextStatus task={{ ...task, intakeStatus }} />);
    expect(screen.getByTestId("task-context-status").textContent).toContain(message);
  });

  it("never shows Task 1 image status for Task 2", () => {
    render(<TaskContextStatus task={{ ...task, imagePlaceholderKind: "TASK_2_NOT_REQUIRED", intakeStatus: "READY" }} />);
    expect(screen.queryByTestId("task-context-status")).toBeNull();
  });

  it("disables duplicate retries from FAILED", () => {
    const onRetry = vi.fn();
    render(<TaskContextStatus task={{ ...task, intakeStatus: "FAILED" }} onRetry={onRetry} retrying />);
    const retry = screen.getByRole("button", { name: "正在重新分析…" }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    fireEvent.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
  });
});
