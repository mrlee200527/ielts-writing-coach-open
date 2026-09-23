import { describe, expect, it } from "vitest";
import { transitionEssay } from "../../src/domain/essay/essay-state-machine";

describe("essay state machine", () => {
  it("allows the confirmed lifecycle", () => {
    expect(transitionEssay("DRAFT", "SUBMIT")).toBe("SUBMITTED");
    expect(transitionEssay("SUBMITTED", "START_DELETION")).toBe("DELETION_PENDING");
    expect(transitionEssay("DELETION_PENDING", "COMPLETE_DELETION")).toBe("DELETED");
  });

  it("rejects analysis outside draft and illegal transitions", () => {
    expect(transitionEssay("DRAFT", "REQUEST_ANALYSIS")).toBe("DRAFT");
    expect(transitionEssay("DRAFT", "START_DELETION")).toBe("DELETION_PENDING");
    expect(() => transitionEssay("SUBMITTED", "REQUEST_ANALYSIS")).toThrowError("ESSAY_NOT_DRAFT");
    expect(() => transitionEssay("DELETED", "SUBMIT")).toThrowError("INVALID_ESSAY_TRANSITION");
  });
});
