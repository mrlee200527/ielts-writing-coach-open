import type { LlmRequest, LlmResult } from "../../ports/llm.port";
import type { EssayFeedbackLLMPort, EssayFeedbackLlmRequest, EssayFeedbackLlmResult } from "../../ports/essay-feedback-llm.port";
import type { MiMoClient } from "./mimo-client";
import { task1EssayFeedbackOutputJsonSchema, task2EssayFeedbackOutputJsonSchema } from "./essay-feedback-output.schema";

type CompletionClient = Pick<MiMoClient, "complete">;

export class MiMoEssayFeedbackAdapter implements EssayFeedbackLLMPort {
  constructor(
    private readonly client: CompletionClient,
    private readonly model: string,
  ) {}

  execute(request: LlmRequest): Promise<LlmResult> {
    void request;
    return Promise.resolve({ ok: false, code: "TERMINAL" });
  }

  async executeEssayFeedback(request: EssayFeedbackLlmRequest): Promise<EssayFeedbackLlmResult> {
    try {
      const task2 = request.taskType === "TASK_2";
      const schema = task2 ? task2EssayFeedbackOutputJsonSchema : task1EssayFeedbackOutputJsonSchema;
      const completion = await this.client.complete({
        responseFormat: task2 ? { type: "json_schema", json_schema: { name: "task2_essay_feedback", strict: true, schema } } : { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              `Return only valid JSON for non-official IELTS Academic Writing ${task2 ? "Task 2" : "Task 1"} feedback. Follow this JSON Schema exactly. ` + JSON.stringify(schema),
          },
          { role: "user", content: request.promptText },
        ],
      });
      if (completion.finishReason === "content_filter") return { ok: false, code: "REFUSAL" };
      if (completion.finishReason !== "stop" || !completion.content) return { ok: false, code: "INCOMPLETE" };
      try {
        return { ok: true, value: JSON.parse(completion.content), model: this.model, responseId: completion.responseId };
      } catch {
        return { ok: false, code: "INVALID_JSON" };
      }
    } catch (error) {
      if (error instanceof Error && error.message === "MIMO_TIMEOUT") return { ok: false, code: "TIMEOUT" };
      if (error instanceof Error && error.message === "MIMO_NETWORK") return { ok: false, code: "NETWORK" };
      return { ok: false, code: "TERMINAL" };
    }
  }
}
