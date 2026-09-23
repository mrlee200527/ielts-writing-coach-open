import { describe, expect, it } from "vitest";

import { stableUuid } from "../../src/domain/shared/ids";
import { parseTaskContext } from "../../src/domain/task-context/task-context.schema";
import type { MiMoCompletionRequest } from "../../src/infrastructure/llm/mimo-client";
import { MiMoTaskContextAdapter } from "../../src/infrastructure/llm/mimo-task-context.adapter";

const request = {
  attemptId: stableUuid("mimo-attempt"),
  correlationId: stableUuid("mimo-correlation"),
  promptVersion: "task-context-v1",
  schemaVersion: 1 as const,
  inputHash: "hash",
  image: { mediaType: "image/jpeg" as const, bytes: new Uint8Array([1, 2, 3]) },
  promptText: "Analyze this IELTS Task 1 chart.",
  mode: "ANALYZE" as const,
};

describe("MiMoTaskContextAdapter", () => {
  it("makes one JSON-only multimodal request and parses the response", async () => {
    const calls: MiMoCompletionRequest[] = [];
    const adapter = new MiMoTaskContextAdapter(
      {
        complete: async (input) => {
          calls.push(input);
          return { responseId: "mimo-response", finishReason: "stop", content: '{"schemaVersion":1}' };
        },
      },
      "mimo-v2.5",
    );

    await expect(adapter.executeTaskContext(request)).resolves.toEqual({
      ok: true,
      value: { schemaVersion: 1 },
      model: "mimo-v2.5",
      responseId: "mimo-response",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].responseFormat).toEqual({ type: "json_object" });
    expect(calls[0].messages).toEqual([
      expect.objectContaining({ role: "system", content: expect.stringContaining('"schemaVersion"') }),
      {
        role: "user",
        content: [
          { type: "text", text: "Analyze this IELTS Task 1 chart." },
          { type: "image_url", image_url: { url: "data:image/jpeg;base64,AQID" } },
        ],
      },
    ]);
  });

  it("normalizes model-generated fact identifiers while preserving internal references", async () => {
    const modelValue = {
      schemaVersion: 1,
      task: {
        kind: "STATIC_CHART",
        chartType: "BAR",
        categoryFactIds: ["category-1"],
        seriesFactIds: ["550e8400-e29b-01d4-a716-446655440000"],
        comparisonFactIds: ["comparison-1"],
      },
      title: "Chart",
      units: ["percent"],
      facts: [
        { factId: "category-1", statement: "A is a category.", certainty: "CERTAIN", uncertaintyCategory: null, evidence: { regionLabel: "A", sourceText: "A" } },
        { factId: "550e8400-e29b-01d4-a716-446655440000", statement: "The bars are percentages.", certainty: "CERTAIN", uncertaintyCategory: null, evidence: { regionLabel: "axis", sourceText: "%" } },
        { factId: "comparison-1", statement: "A is larger than B.", certainty: "CERTAIN", uncertaintyCategory: null, evidence: { regionLabel: "bars", sourceText: "A, B" } },
      ],
      limitations: [],
    };
    const adapter = new MiMoTaskContextAdapter(
      { complete: async () => ({ responseId: "r", finishReason: "stop", content: JSON.stringify(modelValue) }) },
      "mimo-v2.5",
    );

    const result = await adapter.executeTaskContext(request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = parseTaskContext(result.value);
    expect(parsed.task.kind).toBe("STATIC_CHART");
    if (parsed.task.kind !== "STATIC_CHART") throw new Error("expected static chart");
    expect(new Set(parsed.facts.map((fact) => fact.factId))).toEqual(new Set(parsed.task.categoryFactIds.concat(parsed.task.seriesFactIds, parsed.task.comparisonFactIds)));
  });

  it.each([
    [{ responseId: "r", finishReason: "stop", content: "not-json" }, "INVALID_JSON"],
    [{ responseId: "r", finishReason: "length", content: null }, "INCOMPLETE"],
    [{ responseId: "r", finishReason: "content_filter", content: null }, "REFUSAL"],
  ] as const)("maps unsuccessful completion %# without retry", async (completion, code) => {
    let callCount = 0;
    const adapter = new MiMoTaskContextAdapter(
      { complete: async () => (callCount++, completion) },
      "mimo-v2.5",
    );
    expect(await adapter.executeTaskContext(request)).toEqual({ ok: false, code });
    expect(callCount).toBe(1);
  });

  it.each([
    [new Error("MIMO_TIMEOUT"), "TIMEOUT"],
    [new Error("MIMO_NETWORK"), "NETWORK"],
    [new Error("MIMO_HTTP_401"), "TERMINAL"],
  ] as const)("maps client error %s", async (error, code) => {
    const adapter = new MiMoTaskContextAdapter({ complete: async () => Promise.reject(error) }, "mimo-v2.5");
    expect(await adapter.executeTaskContext(request)).toEqual({ ok: false, code });
  });
});
