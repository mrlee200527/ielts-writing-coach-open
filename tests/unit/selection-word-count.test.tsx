// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const editorCallbacks = vi.hoisted(() => ({ onSelectionChange: undefined as undefined | ((text: string) => void) }));

vi.mock("../../src/presentation/writing/essay-editor", () => ({
  EssayEditor: ({ onSelectionChange }: { onSelectionChange?: (text: string) => void }) => {
    editorCallbacks.onSelectionChange = onSelectionChange;
    return <div data-testid="essay-editor" />;
  },
}));

import { WritingWorkspace } from "../../src/presentation/writing/writing-workspace";

const text = "One two three.\nFour five six!";
const snapshot = {
  task: { id: "00000000-0000-4000-8000-000000000101", promptText: "Describe the chart.", txtFileName: null, imagePlaceholderKind: "TASK_1_PENDING" as const, imageBlobId: null, imageMediaType: null, imageSha256: null, intakeStatus: null, activeAttemptId: null, currentTaskContextVersionId: null },
  session: { id: "00000000-0000-4000-8000-000000000102", userId: "00000000-0000-4000-8000-000000000100", taskId: "00000000-0000-4000-8000-000000000101", status: "DRAFT" as const, currentRevisionId: "00000000-0000-4000-8000-000000000103", startedAt: "2026-08-14T01:00:00.000Z" },
  revision: { id: "00000000-0000-4000-8000-000000000103", sessionId: "00000000-0000-4000-8000-000000000102", revisionNo: 1, plainText: text, content: { type: "doc", content: [] }, wordCount: 6, textHash: "hash", createdAt: "2026-08-14T01:00:00.000Z" },
  timer: { elapsedMs: 0 },
};

const footer = () => screen.getByTestId("editor-word-count").textContent;
const select = (value: string) => act(() => editorCallbacks.onSelectionChange?.(value));

describe("selection word count", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); editorCallbacks.onSelectionChange = undefined; });

  it("keeps the total count without an editor selection and ignores page selections", () => {
    render(<WritingWorkspace initial={snapshot} />);
    expect(footer()).toBe("6 个单词");

    fireEvent.mouseUp(screen.getByText("Describe the chart."));
    expect(footer()).toBe("6 个单词");
  });

  it("shows, updates, and clears the selected count using the normal word-count rules", () => {
    render(<WritingWorkspace initial={snapshot} />);

    select(" two, three.\nFour ");
    expect(footer()).toBe("3 / 6 个单词");

    select("One two three.\nFour five");
    expect(footer()).toBe("5 / 6 个单词");

    select("");
    expect(footer()).toBe("6 个单词");
  });

  it.each(["TASK_1_PENDING", "TASK_2_NOT_REQUIRED"] as const)("uses the same selection display for %s", (imagePlaceholderKind) => {
    render(<WritingWorkspace initial={{ ...snapshot, task: { ...snapshot.task, imagePlaceholderKind } }} />);

    select("two three");
    expect(footer()).toBe("2 / 6 个单词");
  });
});
