import { describe, expect, it } from "vitest";

import {
  canonicalParagraphDependencyHash,
  canonicalSentenceDependencyHash,
  parseParagraphDependencySnapshot,
  parseSentenceDependencySnapshot,
} from "../../src/domain/essay/dependency-snapshot.schema";

const segmentId = "00000000-0000-4000-8000-000000000003";

describe("typed dependency snapshots", () => {
  it("rejects missing and invalid sentence dependencies", () => {
    expect(() => parseSentenceDependencySnapshot({ segmentId, textHash: "text", boundaryHash: "boundary" })).toThrow();
    expect(() => parseSentenceDependencySnapshot({ segmentId: "not-a-uuid", textHash: "text", boundaryHash: "boundary", contextHash: "context" })).toThrow();
  });

  it("produces the same canonical hash for equivalent field order", () => {
    const ordered = { segmentId, textHash: "text", boundaryHash: "boundary", contextHash: "context" };
    const reordered = { contextHash: "context", boundaryHash: "boundary", textHash: "text", segmentId };

    expect(canonicalSentenceDependencyHash(ordered)).toBe(canonicalSentenceDependencyHash(reordered));
  });

  it("validates and canonically hashes every paragraph dependency", () => {
    const ordered = {
      segmentId,
      textHash: "text",
      boundaryHash: "boundary",
      adjacentSummaryHash: "adjacent",
      taskContextVersionId: "00000000-0000-4000-8000-000000000005",
      memoryProjectionVersion: 1,
    };
    const reordered = {
      memoryProjectionVersion: 1,
      taskContextVersionId: "00000000-0000-4000-8000-000000000005",
      adjacentSummaryHash: "adjacent",
      boundaryHash: "boundary",
      textHash: "text",
      segmentId,
    };

    expect(parseParagraphDependencySnapshot(ordered)).toEqual(ordered);
    expect(canonicalParagraphDependencyHash(ordered)).toBe(canonicalParagraphDependencyHash(reordered));
    expect(() => parseParagraphDependencySnapshot({ ...ordered, memoryProjectionVersion: -1 })).toThrow();
  });
});
