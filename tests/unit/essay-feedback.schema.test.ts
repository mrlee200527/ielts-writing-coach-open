import { describe, expect, it } from "vitest";
import { essayFeedbackSchema, parseEssayFeedback } from "../../src/domain/feedback/essay-feedback.schema";

const validFeedback = {
  overallBand: 6.5,
  criteria: { taskAchievement: 6, coherenceCohesion: 6.5, lexicalResource: 6, grammaticalRangeAccuracy: 5.5 },
  strengths: ["Clear structure", "Good range of vocabulary"],
  improvements: ["Develop main ideas further", "Check article usage"],
  priorityImprovement: "Develop main ideas further",
};

describe("essay feedback schema", () => {
  it("accepts a valid half-step band feedback object", () => {
    expect(() => parseEssayFeedback(validFeedback)).not.toThrow();
    const parsed = parseEssayFeedback(validFeedback);
    expect(parsed.overallBand).toBe(6.5);
    expect(parsed.criteria.lexicalResource).toBe(6);
  });

  it.each([
    ["overallBand", 6.3],
    ["overallBand", 6.8],
    ["overallBand", 0.2],
    ["overallBand", 9.5],
  ])("rejects non-half-step or out-of-range overallBand %s = %s", (_field, value) => {
    expect(() => parseEssayFeedback({ ...validFeedback, overallBand: value })).toThrow();
  });

  it.each([
    "taskAchievement",
    "coherenceCohesion",
    "lexicalResource",
    "grammaticalRangeAccuracy",
  ])("rejects non-half-step criteria %s", (field) => {
    expect(() =>
      parseEssayFeedback({ ...validFeedback, criteria: { ...validFeedback.criteria, [field]: 6.3 } }),
    ).toThrow();
  });

  it.each([0, 6, 6.5, 9])("accepts half-step boundary bands including 0 and 9", (value) => {
    expect(() => parseEssayFeedback({ ...validFeedback, overallBand: value })).not.toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => parseEssayFeedback({ criteria: validFeedback.criteria, strengths: validFeedback.strengths, improvements: validFeedback.improvements, priorityImprovement: validFeedback.priorityImprovement })).toThrow();
    expect(() => parseEssayFeedback({ ...validFeedback, criteria: { taskAchievement: 6, coherenceCohesion: 6, lexicalResource: 6 } })).toThrow();
    expect(() => parseEssayFeedback({ ...validFeedback, strengths: [] })).toThrow();
    expect(() => parseEssayFeedback({ ...validFeedback, improvements: [] })).toThrow();
    expect(() => parseEssayFeedback({ ...validFeedback, priorityImprovement: "" })).toThrow();
  });

  it("rejects too many strengths or improvements and extra strict keys", () => {
    expect(() => parseEssayFeedback({ ...validFeedback, strengths: ["a", "b", "c", "d"] })).toThrow();
    expect(() => parseEssayFeedback({ ...validFeedback, improvements: ["a", "b", "c", "d"] })).toThrow();
    expect(() => parseEssayFeedback({ ...validFeedback, extra: true })).toThrow();
    expect(() => parseEssayFeedback({ ...validFeedback, criteria: { ...validFeedback.criteria, extra: 6 } })).toThrow();
  });

  it("exposes the schema type for downstream consumption", () => {
    expect(essayFeedbackSchema.safeParse(validFeedback).success).toBe(true);
  });
});
