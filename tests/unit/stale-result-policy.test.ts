import { describe, expect, it } from "vitest";
import { evaluateStaleness } from "../../src/domain/analysis/stale-result-policy";

const sentence = { segmentId: "s1", textHash: "t1", boundaryHash: "b1", contextHash: "c1" };
const paragraph = { segmentId: "p1", textHash: "t1", boundaryHash: "b1", adjacentSummaryHash: "a1", taskContextVersionId: "tc1", memoryProjectionVersion: 0 };

describe("stale result policy", () => {
  it("does not stale a sentence for unrelated edits", () => {
    expect(evaluateStaleness("DRAFT", sentence, { ...sentence })).toEqual({ stale: false });
  });

  it("stales changed dependencies and non-draft essays", () => {
    expect(evaluateStaleness("DRAFT", paragraph, { ...paragraph, adjacentSummaryHash: "a2" }).stale).toBe(true);
    expect(evaluateStaleness("SUBMITTED", sentence, sentence)).toMatchObject({ stale: true, reasonCode: "ESSAY_NOT_DRAFT" });
  });
});
