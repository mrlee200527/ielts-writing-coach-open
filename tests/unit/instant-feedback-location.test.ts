import { describe, expect, it } from "vitest";
import { locateInstantEvidence } from "../../src/presentation/writing/instant-feedback-location";
import type { InstantIssue } from "../../src/presentation/writing/instant-check-controller";

const issue = (targetText: string, fingerprint = "feedback-1"): InstantIssue => ({
  type: "grammar",
  subtype: "agreement",
  severity: "medium",
  targetText,
  messageZh: "这里的主谓一致是不是需要再检查一下？",
  labelEn: "Grammar · agreement",
  fingerprint,
  kind: "language_error",
});

describe("locateInstantEvidence", () => {
  it("returns literal zero-based offsets for unique exact evidence", () => {
    expect(locateInstantEvidence("The population rise quickly.", [issue("population rise")])).toEqual([
      { fingerprint: "feedback-1", type: "grammar", severity: "medium", from: 4, to: 19 },
    ]);
  });

  it("omits duplicate, missing, and empty evidence instead of guessing", () => {
    const text = "population rose, but population later fell.";
    expect(locateInstantEvidence(text, [issue("population"), issue("missing", "feedback-2"), issue("", "feedback-3")])).toEqual([]);
  });
});
