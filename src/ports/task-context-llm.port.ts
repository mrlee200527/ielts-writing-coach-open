import type { LLMPort } from "./llm.port";
import type { AllowedTaskImageType } from "./blob.port";

export interface TaskContextLlmRequest {
  attemptId: string;
  correlationId: string;
  promptVersion: string;
  schemaVersion: 1;
  inputHash: string;
  image: { mediaType: AllowedTaskImageType; bytes: Uint8Array };
  promptText: string | null;
  mode: "ANALYZE" | "REPAIR";
}

export type TaskContextLlmResult =
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

export interface TaskContextLLMPort extends LLMPort {
  executeTaskContext(request: TaskContextLlmRequest): Promise<TaskContextLlmResult>;
}
