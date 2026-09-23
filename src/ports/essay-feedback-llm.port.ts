import type { LLMPort } from "./llm.port";

export interface EssayFeedbackLlmRequest {
  sessionId: string;
  promptVersion: string;
  inputHash: string;
  promptText: string;
  taskType?: "TASK_1" | "TASK_2";
}

export type EssayFeedbackLlmResult =
  | { ok: true; value: unknown; model: string; responseId: string }
  | {
      ok: false;
      code:
        | "TIMEOUT"
        | "NETWORK"
        | "INVALID_JSON"
        | "INVALID_STRUCTURE"
        | "REFUSAL"
        | "INCOMPLETE"
        | "TERMINAL";
    };

export interface EssayFeedbackLLMPort extends LLMPort {
  executeEssayFeedback(request: EssayFeedbackLlmRequest): Promise<EssayFeedbackLlmResult>;
}
