import { describe, expect, it } from "vitest";

import { parseEssayFeedback } from "../../src/domain/feedback/essay-feedback.schema";
import type { MiMoCompletionRequest } from "../../src/infrastructure/llm/mimo-client";
import { MiMoEssayFeedbackAdapter } from "../../src/infrastructure/llm/mimo-essay-feedback.adapter";

const validFeedback = {
  overallBand: 6.5,
  criteria: { taskAchievement: 6, coherenceCohesion: 6.5, lexicalResource: 6, grammaticalRangeAccuracy: 5.5 },
  strengths: ["Clear overview", "Relevant comparisons"],
  improvements: ["Use more precise data", "Check articles"],
  priorityImprovement: "Support comparisons with figures",
};
const request = { sessionId: "session", promptVersion: "essay-feedback-v1", inputHash: "hash", promptText: "Analyze this essay." };

describe("MiMoEssayFeedbackAdapter", () => {
  it("makes one JSON-only text request and returns schema-compatible feedback", async () => {
    const calls: MiMoCompletionRequest[] = [];
    const adapter = new MiMoEssayFeedbackAdapter(
      {
        complete: async (input) => {
          calls.push(input);
          return { responseId: "mimo-feedback", finishReason: "stop", content: JSON.stringify(validFeedback) };
        },
      },
      "mimo-v2.5",
    );

    const result = await adapter.executeEssayFeedback(request);

    expect(result).toEqual({ ok: true, value: validFeedback, model: "mimo-v2.5", responseId: "mimo-feedback" });
    if (result.ok) expect(parseEssayFeedback(result.value)).toEqual(validFeedback);
    expect(calls).toHaveLength(1);
    expect(calls[0].responseFormat).toEqual({ type: "json_object" });
    expect(calls[0].messages).toEqual([
      expect.objectContaining({ role: "system", content: expect.stringContaining('"overallBand"') }),
      { role: "user", content: "Analyze this essay." },
    ]);
  });

  it("uses the independent strict Task 2 schema with Task Response", async () => {
    const calls: MiMoCompletionRequest[] = [];
    const task2Feedback = { ...validFeedback, criteria: { taskResponse: 6, coherenceCohesion: 6.5, lexicalResource: 6, grammaticalRangeAccuracy: 5.5 } };
    const adapter = new MiMoEssayFeedbackAdapter({ complete: async (input) => { calls.push(input); return { responseId: "task2", finishReason: "stop", content: JSON.stringify(task2Feedback) }; } }, "mimo-v2.5");
    const result = await adapter.executeEssayFeedback({ ...request, taskType: "TASK_2", promptVersion: "essay-feedback-task2-v1" });
    expect(result.ok).toBe(true);
    expect(calls[0].responseFormat).toMatchObject({ type: "json_schema", json_schema: { name: "task2_essay_feedback", strict: true } });
    expect(JSON.stringify(calls[0].responseFormat)).toContain("taskResponse");
    expect(JSON.stringify(calls[0].responseFormat)).not.toContain("taskAchievement");
  });

  it.each([
    [{ responseId: "r", finishReason: "stop", content: "not-json" }, "INVALID_JSON"],
    [{ responseId: "r", finishReason: "length", content: null }, "INCOMPLETE"],
    [{ responseId: "r", finishReason: "content_filter", content: null }, "REFUSAL"],
  ] as const)("maps unsuccessful completion %# without retry", async (completion, code) => {
    let callCount = 0;
    const adapter = new MiMoEssayFeedbackAdapter({ complete: async () => (callCount++, completion) }, "mimo-v2.5");
    expect(await adapter.executeEssayFeedback(request)).toEqual({ ok: false, code });
    expect(callCount).toBe(1);
  });

  it.each([
    [new Error("MIMO_TIMEOUT"), "TIMEOUT"],
    [new Error("MIMO_NETWORK"), "NETWORK"],
    [new Error("MIMO_HTTP_401"), "TERMINAL"],
  ] as const)("maps client error %s", async (error, code) => {
    const adapter = new MiMoEssayFeedbackAdapter({ complete: async () => Promise.reject(error) }, "mimo-v2.5");
    expect(await adapter.executeEssayFeedback(request)).toEqual({ ok: false, code });
  });
});
