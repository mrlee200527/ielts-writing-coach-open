import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { canUseAsSoleErrorEvidence, certainFacts } from "../../src/domain/task-context/fact-certainty";
import { stableUuid } from "../../src/domain/shared/ids";
import { parseTaskContext, type TaskContext } from "../../src/domain/task-context/task-context.schema";
import { parseTaskContextVersion } from "../../src/domain/task-context/task-context-version.schema";
import {
  DeterministicTaskContextReplay,
  embeddedGoldenFixtureId,
  taskContextGoldenCases,
} from "../fixtures/task-context-golden/cases";

function referencedFactIds(context: TaskContext): string[] {
  switch (context.task.kind) {
    case "DYNAMIC_CHART":
      return [...context.task.timeAxisFactIds, ...context.task.seriesFactIds, ...context.task.changeFactIds];
    case "STATIC_CHART":
      return [...context.task.categoryFactIds, ...context.task.seriesFactIds, ...context.task.comparisonFactIds];
    case "PROCESS":
      return [...context.task.stageFactIds, ...context.task.edgeFactIds];
    case "MAP":
      return [...context.task.locationFactIds, ...context.task.changeFactIds, ...context.task.directionFactIds];
  }
}

describe("deterministic task context golden suite", () => {
  it("contains exactly four kinds by three outcomes", () => {
    expect(taskContextGoldenCases).toHaveLength(12);
    expect(new Set(taskContextGoldenCases.map((golden) => golden.metadata.kind))).toEqual(
      new Set(["DYNAMIC_CHART", "STATIC_CHART", "PROCESS", "MAP"]),
    );
    expect(new Set(taskContextGoldenCases.map((golden) => golden.metadata.expectedStatus))).toEqual(
      new Set(["READY", "DEGRADED", "UNAVAILABLE"]),
    );
    expect(new Set(taskContextGoldenCases.map((golden) => golden.metadata.sha256)).size).toBe(12);
  });

  it.each(taskContextGoldenCases)("validates $metadata.fixtureId image, replay, schema, references and certainty", async (golden) => {
    const replay = new DeterministicTaskContextReplay(taskContextGoldenCases);
    const actualSha256 = createHash("sha256").update(golden.pngBytes).digest("hex");
    expect([...golden.pngBytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(actualSha256).toBe(golden.metadata.sha256);
    expect(embeddedGoldenFixtureId(golden.pngBytes)).toBe(golden.metadata.fixtureId);
    expect(golden.metadata.schemaVersion).toBe(1);
    expect(golden.metadata.promptVersion).toBe("task-context-v1");
    expect(await replay.execute(golden.pngBytes)).toEqual(golden.replay);

    const result = await replay.execute(golden.pngBytes);
    if (!result.ok) {
      expect(golden.metadata.expectedStatus).toBe("UNAVAILABLE");
      expect(result.code).toBe("TERMINAL");
      expect(golden.metadata.expectedCertainFacts).toBe(0);
      expect(golden.metadata.expectedUncertaintyCategories).toEqual([]);
      expect(certainFacts({ context: null })).toEqual([]);
      expect(canUseAsSoleErrorEvidence([])).toBe(false);
      expect(
        parseTaskContextVersion({
          id: stableUuid(`golden-version:${golden.metadata.fixtureId}`),
          taskId: stableUuid(`golden-task:${golden.metadata.fixtureId}`),
          version: 1,
          status: "UNAVAILABLE",
          context: null,
          schemaVersion: 1,
          sourceImageSha256: actualSha256,
          promptVersion: golden.metadata.promptVersion,
          model: "fixed-golden-replay",
          createdAt: "2026-08-14T08:00:00.000Z",
          limitations: golden.metadata.expectedLimitationCodes,
        }).context,
      ).toBeNull();
      const replayText = JSON.stringify(result).toLowerCase();
      for (const forbiddenClaim of golden.metadata.forbiddenClaims) {
        expect(replayText).not.toContain(forbiddenClaim.toLowerCase());
      }
      return;
    }

    const context = parseTaskContext(result.value);
    expect(context.task.kind).toBe(golden.metadata.kind);
    const factIds = new Set(context.facts.map((fact) => fact.factId));
    const references = referencedFactIds(context);
    expect(references.every((factId) => factIds.has(factId))).toBe(true);
    expect(new Set(references)).toEqual(factIds);
    expect(certainFacts({ context })).toHaveLength(golden.metadata.expectedCertainFacts);
    expect(
      context.facts.flatMap((fact) => fact.uncertaintyCategory === null ? [] : [fact.uncertaintyCategory]).sort(),
    ).toEqual([...golden.metadata.expectedUncertaintyCategories].sort());
    expect(context.limitations).toEqual(golden.metadata.expectedLimitationCodes);

    const certainText = certainFacts({ context }).map((fact) => fact.statement.toLowerCase()).join(" ");
    const nonCertainText = context.facts.filter((fact) => fact.certainty !== "CERTAIN").map((fact) => fact.statement.toLowerCase()).join(" ");
    for (const forbiddenClaim of golden.metadata.forbiddenClaims) {
      expect(certainText).not.toContain(forbiddenClaim.toLowerCase());
      expect(nonCertainText).toContain(forbiddenClaim.toLowerCase());
    }
    const nonCertainFacts = context.facts.filter((fact) => fact.certainty !== "CERTAIN");
    if (nonCertainFacts.length > 0) expect(canUseAsSoleErrorEvidence(nonCertainFacts)).toBe(false);

    expect(
      parseTaskContextVersion({
        id: stableUuid(`golden-version:${golden.metadata.fixtureId}`),
        taskId: stableUuid(`golden-task:${golden.metadata.fixtureId}`),
        version: 1,
        status: golden.metadata.expectedStatus,
        context,
        schemaVersion: 1,
        sourceImageSha256: actualSha256,
        promptVersion: golden.metadata.promptVersion,
        model: result.model,
        createdAt: "2026-08-14T08:00:00.000Z",
        limitations: context.limitations,
      }).status,
    ).toBe(golden.metadata.expectedStatus);
  });
});
