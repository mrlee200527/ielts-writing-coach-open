// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskPromptMarkdown } from "../../src/presentation/writing/task-prompt-markdown";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("TaskPromptMarkdown", () => {
  it("renders safe Markdown while preserving English evidence and data", () => {
    const { container } = render(<TaskPromptMarkdown source={'# IELTS Academic Task 1\n\n**Population** reached 8 million.\n\n- Manhattan\n- Brooklyn\n\n> Summarise the main features.\n\nUse `over a hundred-fold increase`.\n\n```text\n79,000 → 8 million\n```\n\n[IELTS](https://ielts.org)\n\n<script>alert("unsafe")</script>'} />);

    expect(screen.getByRole("heading", { name: "IELTS Academic Task 1" })).toBeTruthy();
    expect(screen.getByText("Population").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Summarise the main features.").closest("blockquote")).toBeTruthy();
    expect(screen.getByText("over a hundred-fold increase").tagName).toBe("CODE");
    expect(screen.getByText(/79,000 → 8 million/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "IELTS" }).getAttribute("rel")).toBe("noreferrer noopener");
    expect(container.querySelector("script")).toBeNull();
  });

  it("falls back to the original plain text when Markdown rendering fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const source = "# Original wording\n\nKeep **these markers**.";
    render(<TaskPromptMarkdown source={source} renderMarkdown={() => { throw new Error("render failed"); }} />);

    expect(screen.getByTestId("task-prompt-plain-fallback").textContent).toBe(source);
  });
});
