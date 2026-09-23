// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContinueDraftLink } from "../../src/presentation/home/continue-draft-link";

describe("continue draft link", () => {
  it("links the most recent draft directly to its workspace", () => {
    render(<ContinueDraftLink sessionId="00000000-0000-4000-8000-000000000102" />);
    expect(screen.getByRole("link", { name: "继续最近一次作文" }).getAttribute("href")).toBe("/write/00000000-0000-4000-8000-000000000102");
  });

  it("does not render when there is no draft", () => {
    const { container } = render(<ContinueDraftLink />);
    expect(container.innerHTML).toBe("");
  });
});
