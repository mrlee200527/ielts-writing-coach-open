import { describe, expect, it } from "vitest";
import { buildOfficialRubricContext, targetBands, type TargetBand } from "../../src/domain/feedback/ielts-rubric";

const band6Marker = "A relevant overview is attempted";
const band7Marker = "clear overview, the data are appropriately categorised";
const band8Marker = "Key features are skilfully selected";
const task2Band6Marker = "although the conclusions drawn may be unclear";
const task2Band8Marker = "well-developed position is presented";

describe("buildOfficialRubricContext", () => {
  it("maps 6.0 to the official Band 6 descriptor only", () => {
    const context = buildOfficialRubricContext("TASK_1", "6.0");
    expect(context).toContain(band6Marker);
    expect(context).not.toContain(band7Marker);
    expect(context).not.toContain(band8Marker);
  });

  it("maps 6.5 to Band 6 + Band 7 official descriptors without inventing a 6.5 descriptor", () => {
    const context = buildOfficialRubricContext("TASK_1", "6.5");
    expect(context).toContain(band6Marker);
    expect(context).toContain(band7Marker);
    expect(context).not.toContain(band8Marker);
    expect(context.toLowerCase()).not.toContain("band 6.5");
    expect(context.toLowerCase()).not.toContain("official band 6.5");
  });

  it("maps 7.0 to the official Band 7 descriptor only", () => {
    const context = buildOfficialRubricContext("TASK_1", "7.0");
    expect(context).not.toContain(band6Marker);
    expect(context).toContain(band7Marker);
    expect(context).not.toContain(band8Marker);
  });

  it("maps 7.5 to Band 7 + Band 8 official descriptors without inventing a 7.5 descriptor", () => {
    const context = buildOfficialRubricContext("TASK_1", "7.5");
    expect(context).not.toContain(band6Marker);
    expect(context).toContain(band7Marker);
    expect(context).toContain(band8Marker);
    expect(context.toLowerCase()).not.toContain("band 7.5");
  });

  it("labels every descriptor band explicitly so the model never invents meanings", () => {
    for (const band of targetBands) {
      const context = buildOfficialRubricContext("TASK_1", band);
      expect(context).toMatch(/Band \d/);
    }
  });

  it("never mixes Task 1 Task Achievement into Task 2 context and vice versa", () => {
    const task1 = buildOfficialRubricContext("TASK_1", "6.5");
    const task2 = buildOfficialRubricContext("TASK_2", "7.5");
    const task2Low = buildOfficialRubricContext("TASK_2", "6.0");
    expect(task1).toContain("Task Achievement");
    expect(task1).not.toContain("Task Response");
    expect(task2).toContain("Task Response");
    expect(task2).not.toContain("Task Achievement");
    expect(task2Low).toContain(task2Band6Marker);
    expect(task2).toContain(task2Band8Marker);
  });

  it("accepts only the four target bands", () => {
    expect(targetBands).toEqual(["6.0", "6.5", "7.0", "7.5"]);
  });

  it("covers all four official criteria for Task 1 and Task 2", () => {
    for (const band of targetBands) {
      const task1 = buildOfficialRubricContext("TASK_1", band);
      expect(task1).toContain("Coherence");
      expect(task1).toContain("Lexical Resource");
      expect(task1).toContain("Grammatical Range");
      const task2 = buildOfficialRubricContext("TASK_2", band);
      expect(task2).toContain("Coherence");
      expect(task2).toContain("Lexical Resource");
      expect(task2).toContain("Grammatical Range");
    }
  });
});

describe("TargetBand type", () => {
  it("is a strict four-value union", () => {
    const bands: readonly TargetBand[] = ["6.0", "6.5", "7.0", "7.5"];
    expect(bands).toHaveLength(4);
  });
});
