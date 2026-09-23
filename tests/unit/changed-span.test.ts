import { describe, expect, it } from "vitest";
import { computeChangedSpan } from "../../src/domain/feedback/changed-span";

describe("computeChangedSpan", () => {
  it("targets only the appended sentence and keeps the previous sentence as surrounding context", () => {
    const span = computeChangedSpan("Manhattan had 60,000 residents.", "Manhattan had 60,000 residents. The population increased across five district.");
    expect(span.target).toBe("The population increased across five district.");
    expect(span.surroundingBefore).toBe("Manhattan had 60,000 residents.");
    expect(span.surroundingAfter).toBe("");
  });

  it("targets the edited sentence when a change is made in the middle of the text", () => {
    const span = computeChangedSpan("The chart show the population. It increased slowly.", "The chart show the population. It increased sharply.");
    expect(span.target).toBe("It increased sharply.");
    expect(span.surroundingBefore).toBe("The chart show the population.");
    expect(span.surroundingAfter).toBe("");
  });

  it("spans every changed sentence when edits touch multiple places", () => {
    const span = computeChangedSpan("One. Two. Three.", "One changed. Two. Three changed.");
    expect(span.target).toBe("One changed. Two. Three changed.");
  });

  it("treats the whole text as the target on the first analysis (no previous baseline)", () => {
    const span = computeChangedSpan("", "The population of five district increased.");
    expect(span.target).toBe("The population of five district increased.");
    expect(span.surroundingBefore).toBe("");
    expect(span.surroundingAfter).toBe("");
  });

  it("returns an empty target when the text is unchanged", () => {
    const span = computeChangedSpan("Same text.", "Same text.");
    expect(span.target).toBe("");
  });

  it("keeps paragraph breaks as boundaries and attaches the previous paragraph as context", () => {
    const span = computeChangedSpan("First paragraph.\nSecond paragraph unchanged.", "First paragraph.\nSecond paragraph with a new error.");
    expect(span.target).toBe("Second paragraph with a new error.");
    expect(span.surroundingBefore).toBe("First paragraph.");
  });

  it("exposes the target offsets for overlap checks against the current text", () => {
    const previous = "Old sentence.";
    const current = "Old sentence. New changed sentence.";
    const span = computeChangedSpan(previous, current);
    expect(current.slice(span.targetStart, span.targetEnd)).toContain("New changed sentence.");
    expect(span.targetStart).toBeGreaterThan(previous.length);
  });
});
