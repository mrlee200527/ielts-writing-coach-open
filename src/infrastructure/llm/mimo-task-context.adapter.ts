import type { LlmRequest, LlmResult } from "../../ports/llm.port";
import type { TaskContextLLMPort, TaskContextLlmRequest, TaskContextLlmResult } from "../../ports/task-context-llm.port";
import { stableUuid } from "../../domain/shared/ids";
import type { MiMoClient } from "./mimo-client";
import { taskContextOutputJsonSchema } from "./task-context-output.schema";

type CompletionClient = Pick<MiMoClient, "complete">;

export class MiMoTaskContextAdapter implements TaskContextLLMPort {
  constructor(
    private readonly client: CompletionClient,
    private readonly model: string,
  ) {}

  execute(request: LlmRequest): Promise<LlmResult> {
    void request;
    return Promise.resolve({ ok: false, code: "TERMINAL" });
  }

  async executeTaskContext(request: TaskContextLlmRequest): Promise<TaskContextLlmResult> {
    try {
      const completion = await this.client.complete({
        responseFormat: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Return only valid JSON describing the IELTS Academic Task 1 image. Follow this JSON Schema exactly. " +
              JSON.stringify(taskContextOutputJsonSchema),
          },
          {
            role: "user",
            content: [
              { type: "text", text: request.promptText ?? "Analyze this IELTS Academic Task 1 image." },
              {
                type: "image_url",
                image_url: { url: `data:${request.image.mediaType};base64,${Buffer.from(request.image.bytes).toString("base64")}` },
              },
            ],
          },
        ],
      });
      if (completion.finishReason === "content_filter") return { ok: false, code: "REFUSAL" };
      if (completion.finishReason !== "stop" || !completion.content) return { ok: false, code: "INCOMPLETE" };
      try {
        return { ok: true, value: normalizeFactIdentifiers(JSON.parse(completion.content)), model: this.model, responseId: completion.responseId };
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

const factReferenceKeys = [
  "timeAxisFactIds",
  "seriesFactIds",
  "changeFactIds",
  "categoryFactIds",
  "comparisonFactIds",
  "stageFactIds",
  "edgeFactIds",
  "locationFactIds",
  "directionFactIds",
] as const;

function normalizeFactIdentifiers(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const context = value as Record<string, unknown>;
  if (!Array.isArray(context.facts) || !context.task || typeof context.task !== "object" || Array.isArray(context.task)) return value;

  const idMap = new Map<string, string>();
  for (const fact of context.facts) {
    if (fact && typeof fact === "object" && !Array.isArray(fact) && typeof (fact as Record<string, unknown>).factId === "string") {
      const original = (fact as Record<string, unknown>).factId as string;
      idMap.set(original, stableUuid(`mimo-task-context-fact:${original}`));
    }
  }
  const normalize = (id: unknown) => (typeof id === "string" ? idMap.get(id) ?? stableUuid(`mimo-task-context-fact:${id}`) : id);
  const task = context.task as Record<string, unknown>;
  const normalizedTask = { ...task };
  for (const key of factReferenceKeys) {
    if (Array.isArray(task[key])) normalizedTask[key] = task[key].map(normalize);
  }

  return {
    ...context,
    task: normalizedTask,
    facts: context.facts.map((fact) =>
      fact && typeof fact === "object" && !Array.isArray(fact)
        ? { ...fact, factId: normalize((fact as Record<string, unknown>).factId) }
        : fact,
    ),
  };
}
