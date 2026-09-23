import type { EssayFeedbackLLMPort, EssayFeedbackLlmRequest, EssayFeedbackLlmResult } from "../../ports/essay-feedback-llm.port";
import type { LlmRequest, LlmResult } from "../../ports/llm.port";
import type { ResponsesClient } from "./openai-task-context.adapter";
import { task1EssayFeedbackOutputJsonSchema, task2EssayFeedbackOutputJsonSchema } from "./essay-feedback-output.schema";

export class OpenAiEssayFeedbackAdapter implements EssayFeedbackLLMPort {
  constructor(private readonly client: ResponsesClient, private readonly model = process.env.OPENAI_MODEL ?? "gpt-5.6-luna") {}

  execute(request: LlmRequest): Promise<LlmResult> {
    void request;
    return Promise.resolve({ ok: false, code: "TERMINAL" });
  }

  async executeEssayFeedback(request: EssayFeedbackLlmRequest): Promise<EssayFeedbackLlmResult> {
    try {
      const task2 = request.taskType === "TASK_2";
      const schema = task2 ? task2EssayFeedbackOutputJsonSchema : task1EssayFeedbackOutputJsonSchema;
      const response = await this.client.responses.create({
        model: this.model,
        reasoning: { effort: "low" },
        input: [{ role: "user", content: [{ type: "input_text", text: request.promptText }] }],
        text: { format: { type: "json_schema", name: task2 ? "task2_essay_feedback" : "essay_feedback", strict: true, schema } },
      });
      if (response.refusal) return { ok: false, code: "REFUSAL" };
      if (response.status !== "completed") return { ok: false, code: "INCOMPLETE" };
      if (!response.output_text) return { ok: false, code: "INVALID_JSON" };
      try {
        return { ok: true, value: JSON.parse(response.output_text), model: this.model, responseId: response.id };
      } catch {
        return { ok: false, code: "INVALID_JSON" };
      }
    } catch (error) {
      return { ok: false, code: error instanceof Error && /timeout/i.test(error.message) ? "TIMEOUT" : "NETWORK" };
    }
  }
}
