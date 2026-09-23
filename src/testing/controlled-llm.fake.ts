import type { LLMPort, LlmRequest, LlmResult } from "../ports/llm.port";

interface PendingCall { resolve: (result: LlmResult) => void }

export class ControlledLlmFake implements LLMPort {
  private readonly pending = new Map<string, PendingCall>();

  execute(request: LlmRequest): Promise<LlmResult> {
    return new Promise((resolve) => this.pending.set(request.fixtureId, { resolve }));
  }

  succeed(fixtureId: string, value: unknown): void {
    this.release(fixtureId, { ok: true, value });
  }

  fail(fixtureId: string, code: Extract<LlmResult, { ok: false }>["code"]): void {
    this.release(fixtureId, { ok: false, code });
  }

  private release(fixtureId: string, result: LlmResult): void {
    const call = this.pending.get(fixtureId);
    if (!call) throw new Error("LLM_CALL_NOT_PENDING");
    this.pending.delete(fixtureId);
    call.resolve(result);
  }
}
