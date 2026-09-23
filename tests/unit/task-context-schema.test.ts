import { describe, expect, it } from "vitest";

import { parseTaskContext } from "../../src/domain/task-context/task-context.schema";
import { parseTaskContextVersion } from "../../src/domain/task-context/task-context-version.schema";
import { stableUuid } from "../../src/domain/shared/ids";
import {
  dynamicTaskContextFixture,
  mapTaskContextFixture,
  processTaskContextFixture,
  staticTaskContextFixture,
  taskContextFixtures,
} from "../../src/testing/task-context-fixtures";

describe("task context schema", () => {
  it.each([
    ["DYNAMIC_CHART", dynamicTaskContextFixture, "timeAxisFactIds"],
    ["STATIC_CHART", staticTaskContextFixture, "categoryFactIds"],
    ["PROCESS", processTaskContextFixture, "stageFactIds"],
    ["MAP", mapTaskContextFixture, "locationFactIds"],
  ])("parses %s with its exclusive fact references", (kind, fixture, referenceField) => {
    const parsed = parseTaskContext(fixture);
    expect(parsed.task.kind).toBe(kind);
    expect(parsed.task).toHaveProperty(referenceField);
    expect(parsed.facts.every((item) => /^[0-9a-f-]{36}$/.test(item.factId))).toBe(true);
  });

  it("rejects extra fields at the root and task boundaries", () => {
    expect(() => parseTaskContext({ ...dynamicTaskContextFixture, unexpected: true })).toThrow();
    expect(() => parseTaskContext({
      ...dynamicTaskContextFixture,
      task: { ...dynamicTaskContextFixture.task, stageFactIds: [] },
    })).toThrow();
    expect(() => parseTaskContext({
      ...mapTaskContextFixture,
      task: { ...mapTaskContextFixture.task, chartType: "LINE" },
    })).toThrow();
  });

  it("rejects duplicate and dangling fact IDs", () => {
    const duplicate = {
      ...dynamicTaskContextFixture,
      facts: [dynamicTaskContextFixture.facts[0], dynamicTaskContextFixture.facts[0]],
    };
    expect(() => parseTaskContext(duplicate)).toThrow("DUPLICATE_FACT_ID");

    const dangling = {
      ...dynamicTaskContextFixture,
      task: { ...dynamicTaskContextFixture.task, changeFactIds: [stableUuid("missing-fact")] },
    };
    expect(() => parseTaskContext(dangling)).toThrow("DANGLING_FACT_REFERENCE");
  });

  it("rejects duplicate references", () => {
    const factId = dynamicTaskContextFixture.task.changeFactIds[0];
    expect(() => parseTaskContext({
      ...dynamicTaskContextFixture,
      task: { ...dynamicTaskContextFixture.task, changeFactIds: [factId, factId] },
    })).toThrow("DUPLICATE_FACT_REFERENCE");
  });

  it("enforces READY, DEGRADED, and UNAVAILABLE version semantics", () => {
    const base = {
      id: stableUuid("context-version"),
      taskId: stableUuid("task"),
      version: 1,
      schemaVersion: 1 as const,
      sourceImageSha256: "a".repeat(64),
      promptVersion: "task-context-v1",
      model: "fixed-replay",
      createdAt: "2026-08-14T13:48:34+08:00",
      limitations: [] as string[],
    };
    expect(parseTaskContextVersion({ ...base, status: "READY", context: dynamicTaskContextFixture }).status).toBe("READY");

    const uncertainContext = {
      ...dynamicTaskContextFixture,
      facts: dynamicTaskContextFixture.facts.map((item, index) => index === 0 ? {
        ...item,
        certainty: "UNCERTAIN",
        uncertaintyCategory: "TIME_RANGE_AMBIGUOUS",
      } : item),
      limitations: ["TIME_RANGE_UNCLEAR"],
    };
    expect(parseTaskContextVersion({
      ...base,
      status: "DEGRADED",
      context: uncertainContext,
      limitations: ["TIME_RANGE_UNCLEAR"],
    }).status).toBe("DEGRADED");
    expect(parseTaskContextVersion({
      ...base,
      status: "UNAVAILABLE",
      context: null,
      limitations: ["NO_SAFE_CONTEXT"],
    }).status).toBe("UNAVAILABLE");

    expect(() => parseTaskContextVersion({ ...base, status: "UNAVAILABLE", context: dynamicTaskContextFixture })).toThrow("UNAVAILABLE_INCONSISTENT");
    expect(() => parseTaskContextVersion({ ...base, status: "READY", context: uncertainContext })).toThrow("READY_INCONSISTENT");
    expect(() => parseTaskContextVersion({ ...base, status: "DEGRADED", context: taskContextFixtures[1] })).toThrow("DEGRADED_INCONSISTENT");
  });
});
