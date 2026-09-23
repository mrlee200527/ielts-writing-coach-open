export type InstantCheckLlmRequest = { sessionId: string; requestId: string; revisionId: string; promptVersion: string; promptText: string };
export type InstantCheckLlmResult = { ok: true; value: unknown; model: string; responseId: string } | { ok: false; code: "TIMEOUT" | "NETWORK" | "INVALID_JSON" | "INVALID_STRUCTURE" | "REFUSAL" | "INCOMPLETE" | "TERMINAL"; diagnostic?: string };
export type GatekeeperDecision = { fingerprint: string; decision: "SHOW" | "HOLD" | "REJECT" };
export type InstantCheckGatekeeperResult = { ok: true; decisions: GatekeeperDecision[]; model: string; responseId: string } | Exclude<InstantCheckLlmResult, { ok: true }>;
export interface InstantCheckLLMPort {
  executeInstantCheck(request: InstantCheckLlmRequest): Promise<InstantCheckLlmResult>;
  executeInstantCheckGatekeeper?(request: InstantCheckLlmRequest): Promise<InstantCheckGatekeeperResult>;
}
