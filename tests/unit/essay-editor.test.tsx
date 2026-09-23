// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EssayEditor } from "../../src/presentation/writing/essay-editor";
import type { EssayEditorHandle } from "../../src/presentation/writing/essay-editor";
import type { InstantIssue } from "../../src/presentation/writing/instant-check-controller";

afterEach(() => { vi.useRealTimers(); cleanup(); });

const grammarIssue: InstantIssue = {
  type: "grammar",
  subtype: "agreement",
  severity: "medium",
  targetText: "population rise",
  messageZh: "这里的主谓一致是不是需要再检查一下？",
  labelEn: "Grammar · agreement",
  fingerprint: "grammar-1",
  kind: "language_error",
};

describe("EssayEditor instant evidence", () => {
  it("renders a clickable decoration without changing or saving the essay", async () => {
    const onChange = vi.fn();
    const onMarkerClick = vi.fn();
    render(<EssayEditor value="The population rise quickly." onChange={onChange} instantIssues={[grammarIssue]} activeInstantFingerprint={null} onInstantMarkerClick={onMarkerClick} />);

    const marker = await waitFor(() => screen.getByTestId("instant-evidence-grammar-1"));
    expect(marker.textContent).toBe("population rise");
    expect(screen.getByTestId("essay-editor").textContent).toBe("The population rise quickly.");
    expect(onChange).not.toHaveBeenCalled();

    marker.addEventListener("mousedown", (event) => event.stopPropagation());
    expect(fireEvent.mouseDown(marker)).toBe(true);
    fireEvent.click(marker);
    expect(onMarkerClick).toHaveBeenCalledWith("grammar-1");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not decorate ambiguous evidence", async () => {
    render(<EssayEditor value="population rose, then population fell." onChange={() => undefined} instantIssues={[{ ...grammarIssue, targetText: "population" }]} activeInstantFingerprint={null} onInstantMarkerClick={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId("essay-editor")).toBeTruthy());
    expect(screen.queryByTestId("instant-evidence-grammar-1")).toBeNull();
  });

  it("activates and reveals a requested evidence marker without moving essay content", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const ref = createRef<EssayEditorHandle>();
    const { rerender } = render(<EssayEditor ref={ref} value="The population rise quickly." onChange={() => undefined} instantIssues={[grammarIssue]} activeInstantFingerprint={null} />);
    const marker = await waitFor(() => screen.getByTestId("instant-evidence-grammar-1"));

    rerender(<EssayEditor ref={ref} value="The population rise quickly." onChange={() => undefined} instantIssues={[grammarIssue]} activeInstantFingerprint="grammar-1" />);
    await waitFor(() => expect(marker.classList.contains("is-active")).toBe(true));
    ref.current?.revealFeedback("grammar-1");

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(screen.getByTestId("essay-editor").textContent).toBe("The population rise quickly.");
  });

  it("keeps the bubble body non-interactive and links only its small action to the sidebar", async () => {
    const onChange = vi.fn();
    const onMarkerClick = vi.fn();
    const vocabularyIssue: InstantIssue = { ...grammarIssue, type: "vocabulary", targetText: "quickly", messageZh: "这个词放在这里是不是有点奇怪？", fingerprint: "vocab-1" };
    render(<EssayEditor value="The population rise quickly." onChange={onChange} instantIssues={[grammarIssue, vocabularyIssue]} activeInstantFingerprint={null} onInstantMarkerClick={onMarkerClick} />);

    const bubble = await waitFor(() => screen.getByTestId("instant-coaching-bubble-grammar-1"));
    expect(screen.queryByTestId("instant-coaching-bubble-vocab-1")).toBeNull();
    expect(bubble.getAttribute("data-message")).toBe(grammarIssue.messageZh);
    expect(bubble.closest('[data-testid="essay-editor"]')).toBeNull();
    expect(bubble.classList.contains("feedback-tone-orange")).toBe(true);
    expect(screen.getByTestId("instant-evidence-grammar-1").classList.contains("feedback-tone-orange")).toBe(true);
    expect(screen.getByTestId("essay-editor").textContent).toBe("The population rise quickly.");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(bubble);
    expect(onMarkerClick).not.toHaveBeenCalled();

    const action = screen.getByRole("button", { name: "查看对应反馈" });
    expect(action.closest('[data-testid="instant-coaching-bubble-grammar-1"]')).toBe(bubble);
    expect(fireEvent.mouseDown(action)).toBe(false);
    fireEvent.click(action);
    expect(onMarkerClick).toHaveBeenCalledWith("grammar-1");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("auto-hides after three seconds and lets the evidence text toggle it without restarting a timer", async () => {
    vi.useFakeTimers();
    const { rerender } = render(<EssayEditor value="The population rise quickly." onChange={() => undefined} instantIssues={[grammarIssue]} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("instant-coaching-bubble-grammar-1")).toBeTruthy();

    act(() => { vi.advanceTimersByTime(2999); });
    expect(screen.getByTestId("instant-coaching-bubble-grammar-1")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByTestId("instant-coaching-bubble-grammar-1")).toBeNull();

    const marker = screen.getByTestId("instant-evidence-grammar-1");
    fireEvent.click(marker);
    expect(screen.getByTestId("instant-coaching-bubble-grammar-1")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(10000); });
    expect(screen.getByTestId("instant-coaching-bubble-grammar-1")).toBeTruthy();
    fireEvent.click(marker);
    expect(screen.queryByTestId("instant-coaching-bubble-grammar-1")).toBeNull();

    rerender(<EssayEditor value="The population rise quickly." onChange={() => undefined} instantIssues={[{ ...grammarIssue, messageZh: "实时更新后的提示" }]} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("instant-coaching-bubble-grammar-1")).toBeTruthy();
    vi.useRealTimers();
  });

  it("removes the coaching bubble when evidence becomes invalid and never guesses an ambiguous location", async () => {
    const { rerender } = render(<EssayEditor value="The population rise quickly." onChange={() => undefined} instantIssues={[grammarIssue]} />);
    await waitFor(() => expect(screen.getByTestId("instant-coaching-bubble-grammar-1")).toBeTruthy());

    rerender(<EssayEditor value="The population changed quickly." onChange={() => undefined} instantIssues={[grammarIssue]} />);
    await waitFor(() => expect(screen.queryByTestId("instant-coaching-bubble-grammar-1")).toBeNull());

    rerender(<EssayEditor value="population rise, then population rise." onChange={() => undefined} instantIssues={[grammarIssue]} />);
    await waitFor(() => expect(screen.queryByTestId("instant-coaching-bubble-grammar-1")).toBeNull());
  });
});
