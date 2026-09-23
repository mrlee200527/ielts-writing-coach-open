import type { TaskContextLlmRequest, TaskContextLlmResult, TaskContextLLMPort } from "../ports/task-context-llm.port";
import { ControlledLlmFake } from "./controlled-llm.fake";

interface PendingTaskContextCall {
  request: TaskContextLlmRequest;
  resolve: (result: TaskContextLlmResult) => void;
}

export class ControlledTaskContextLlmFake extends ControlledLlmFake implements TaskContextLLMPort {
  private readonly taskContextPending = new Map<string, PendingTaskContextCall>();
  readonly taskContextCalls: TaskContextLlmRequest[] = [];

  executeTaskContext(request: TaskContextLlmRequest): Promise<TaskContextLlmResult> {
    this.taskContextCalls.push({ ...request, image: { ...request.image, bytes: request.image.bytes.slice() } });
    return new Promise((resolve) => {
      this.taskContextPending.set(request.correlationId, {
        request: { ...request, image: { ...request.image, bytes: request.image.bytes.slice() } },
        resolve,
      });
    });
  }

  request(correlationId: string): TaskContextLlmRequest | undefined {
    const pending = this.taskContextPending.get(correlationId);
    return pending
      ? { ...pending.request, image: { ...pending.request.image, bytes: pending.request.image.bytes.slice() } }
      : undefined;
  }

  succeed(correlationId: string, value: unknown, model = "fixed-model", responseId = "fixed-response"): void {
    const taskContextCall = this.taskContextPending.get(correlationId);
    if (!taskContextCall) {
      super.succeed(correlationId, value);
      return;
    }
    this.releaseTaskContext(correlationId, { ok: true, value, model, responseId });
  }

  fail(correlationId: string, code: Extract<TaskContextLlmResult, { ok: false }>["code"]): void {
    const taskContextCall = this.taskContextPending.get(correlationId);
    if (!taskContextCall && ["TIMEOUT", "NETWORK", "INVALID_STRUCTURE", "TERMINAL"].includes(code)) {
      super.fail(correlationId, code as "TIMEOUT" | "NETWORK" | "INVALID_STRUCTURE" | "TERMINAL");
      return;
    }
    this.releaseTaskContext(correlationId, { ok: false, code });
  }

  private releaseTaskContext(correlationId: string, result: TaskContextLlmResult): void {
    const call = this.taskContextPending.get(correlationId);
    if (!call) throw new Error("TASK_CONTEXT_LLM_CALL_NOT_PENDING");
    this.taskContextPending.delete(correlationId);
    call.resolve(result);
  }
}
