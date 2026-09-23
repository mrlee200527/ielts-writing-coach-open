import { describe, expect, it } from "vitest";

import { canUseAsSoleErrorEvidence, certainFacts } from "../../src/domain/task-context/fact-certainty";
import { parseTaskContext } from "../../src/domain/task-context/task-context.schema";
import { dynamicTaskContextFixture } from "../../src/testing/task-context-fixtures";

describe("fact certainty guard", () => {
  it("requires a category for every non-certain fact", () => {
    const invalid = {
      ...dynamicTaskContextFixture,
      facts: [{ ...dynamicTaskContextFixture.facts[0], certainty: "UNCERTAIN", uncertaintyCategory: null }],
    };
    expect(() => parseTaskContext(invalid)).toThrow("UNCERTAINTY_CATEGORY_REQUIRED");
  });

  it("forbids an uncertainty category on a certain fact", () => {
    const invalid = {
      ...dynamicTaskContextFixture,
      facts: [{
        ...dynamicTaskContextFixture.facts[0],
        uncertaintyCategory: "VALUE_AMBIGUOUS",
      }],
    };
    expect(() => parseTaskContext(invalid)).toThrow("CERTAIN_FACT_CATEGORY_MUST_BE_NULL");
  });

  it("exposes only certain facts to downstream evidence consumers", () => {
    const facts = [
      dynamicTaskContextFixture.facts[0],
      {
        ...dynamicTaskContextFixture.facts[1],
        certainty: "UNCERTAIN" as const,
        uncertaintyCategory: "LEGEND_AMBIGUOUS" as const,
      },
      {
        ...dynamicTaskContextFixture.facts[2],
        certainty: "UNAVAILABLE" as const,
        uncertaintyCategory: "VALUE_AMBIGUOUS" as const,
      },
    ];
    const resolution = { context: { ...dynamicTaskContextFixture, facts } };
    expect(certainFacts(resolution)).toEqual([facts[0]]);
    expect(canUseAsSoleErrorEvidence(facts)).toBe(true);
    expect(canUseAsSoleErrorEvidence(facts.slice(1))).toBe(false);
  });
});
