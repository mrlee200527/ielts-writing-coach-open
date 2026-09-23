export interface LlmRequest {
  task: "SENTENCE" | "PARAGRAPH" | "TASK_CONTEXT" | "ASSESSMENT";
  fixtureId: string;
  promptVersion: string;
  inputHash: string;
}

export type LlmResult = { ok: true; value: unknown } | { ok: false; code: "TIMEOUT" | "NETWORK" | "INVALID_STRUCTURE" | "TERMINAL" };

export interface LLMPort {
  execute(request: LlmRequest): Promise<LlmResult>;
}
