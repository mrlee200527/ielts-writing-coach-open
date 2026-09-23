import { describe, expect, it } from "vitest";
import { OpenAiEssayFeedbackAdapter } from "../../src/infrastructure/llm/openai-essay-feedback.adapter";
import type { ResponsesClient } from "../../src/infrastructure/llm/openai-task-context.adapter";
import { essayFeedbackOutputJsonSchema } from "../../src/infrastructure/llm/essay-feedback-output.schema";

const validOutput = JSON.stringify({
  overallBand: 6.5,
  criteria: { taskAchievement: 6, coherenceCohesion: 6.5, lexicalResource: 6, grammaticalRangeAccuracy: 5.5 },
  strengths: ["Clear structure", "Good range of vocabulary"],
  improvements: ["Develop main ideas further", "Check article usage"],
  priorityImprovement: "Develop main ideas further",
});

function fakeClient(overrides: Partial<{ id: string; status: string; output_text?: string; refusal?: string }> = {}) {
  const calls: unknown[] = [];
  const client: ResponsesClient = {
    responses: {
      create: async (input: unknown) => {
        calls.push(input);
        return {
          id: "resp_1",
          status: "completed",
          output_text: validOutput,
          ...overrides,
        };
      },
    },
  };
  return { client, calls };
}

describe("openai essay feedback adapter", () => {
  it("returns ok with parsed value, model and responseId on completed output", async () => {
    const { client, calls } = fakeClient();
    const adapter = new OpenAiEssayFeedbackAdapter(client);
    const result = await adapter.executeEssayFeedback({ sessionId: "s", promptVersion: "essay-feedback-v1", inputHash: "hash", promptText: "Analyze." });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toMatchObject({ overallBand: 6.5 });
    expect(result.model).toBe("gpt-5.6-luna");
    expect(result.responseId).toBe("resp_1");
    const request = calls[0] as { model: string; reasoning: { effort: string }; text: { format: { type: string; name: string; strict: boolean; schema: unknown } }; input: Array<{ role: string; content: Array<{ type: string; text: string }> }> };
    expect(request.model).toBe("gpt-5.6-luna");
    expect(request.reasoning).toEqual({ effort: "low" });
    expect(request.text.format).toMatchObject({ type: "json_schema", name: "essay_feedback", strict: true });
    expect(request.text.format.schema).toEqual(essayFeedbackOutputJsonSchema);
    expect(request.input[0].content[0]).toMatchObject({ type: "input_text", text: "Analyze." });
  });

  it("honors OPENAI_MODEL override and returns TERMINAL from execute()", async () => {
    const { client } = fakeClient();
    const adapter = new OpenAiEssayFeedbackAdapter(client, "custom-model");
    const result = await adapter.executeEssayFeedback({ sessionId: "s", promptVersion: "p", inputHash: "h", promptText: "t" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.model).toBe("custom-model");
    const legacy = await adapter.execute({ task: "SENTENCE", fixtureId: "f", promptVersion: "p", inputHash: "h" });
    expect(legacy).toEqual({ ok: false, code: "TERMINAL" });
  });

  it("maps refusal, incomplete and missing output to stable failure codes", async () => {
    const refusal = new OpenAiEssayFeedbackAdapter(fakeClient({ refusal: "no" }).client);
    expect(await refusal.executeEssayFeedback({ sessionId: "s", promptVersion: "p", inputHash: "h", promptText: "t" })).toEqual({ ok: false, code: "REFUSAL" });
    const incomplete = new OpenAiEssayFeedbackAdapter(fakeClient({ status: "in_progress" }).client);
    expect(await incomplete.executeEssayFeedback({ sessionId: "s", promptVersion: "p", inputHash: "h", promptText: "t" })).toEqual({ ok: false, code: "INCOMPLETE" });
    const noText = new OpenAiEssayFeedbackAdapter(fakeClient({ output_text: undefined }).client);
    expect(await noText.executeEssayFeedback({ sessionId: "s", promptVersion: "p", inputHash: "h", promptText: "t" })).toEqual({ ok: false, code: "INVALID_JSON" });
  });

  it("maps JSON decode failure to INVALID_JSON (owner: adapter)", async () => {
    const malformed = new OpenAiEssayFeedbackAdapter(fakeClient({ output_text: "{not json" }).client);
    expect(await malformed.executeEssayFeedback({ sessionId: "s", promptVersion: "p", inputHash: "h", promptText: "t" })).toEqual({ ok: false, code: "INVALID_JSON" });
  });

  it("maps transport errors to NETWORK and timeout to TIMEOUT", async () => {
    const network: ResponsesClient = { responses: { create: async () => { throw new Error("fetch failed"); } } };
    const timeout: ResponsesClient = { responses: { create: async () => { throw new Error("request timeout after 10s"); } } };
    expect(await new OpenAiEssayFeedbackAdapter(network).executeEssayFeedback({ sessionId: "s", promptVersion: "p", inputHash: "h", promptText: "t" })).toEqual({ ok: false, code: "NETWORK" });
    expect(await new OpenAiEssayFeedbackAdapter(timeout).executeEssayFeedback({ sessionId: "s", promptVersion: "p", inputHash: "h", promptText: "t" })).toEqual({ ok: false, code: "TIMEOUT" });
  });
});
