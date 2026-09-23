import type { MiMoConfig } from "./mimo-config";

export type MiMoMessage = Readonly<{
  role: "system" | "user" | "assistant";
  content: unknown;
}>;

export type MiMoCompletionRequest = Readonly<{
  messages: readonly MiMoMessage[];
  responseFormat?: unknown;
}>;

export type MiMoCompletion = Readonly<{
  responseId: string;
  finishReason: string | null;
  content: string | null;
}>;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class MiMoClient {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: MiMoConfig,
    options: Readonly<{ fetch?: FetchLike; timeoutMs?: number }> = {},
  ) {
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async complete(request: MiMoCompletionRequest): Promise<MiMoCompletion> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.config.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          messages: request.messages,
          ...(request.responseFormat === undefined ? {} : { response_format: request.responseFormat }),
        }),
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`MIMO_HTTP_${response.status}`);

      const body = (await response.json()) as {
        id?: unknown;
        choices?: Array<{ finish_reason?: unknown; message?: { content?: unknown } }>;
      };
      const first = body.choices?.[0];
      return {
        responseId: typeof body.id === "string" ? body.id : "",
        finishReason: typeof first?.finish_reason === "string" ? first.finish_reason : null,
        content: typeof first?.message?.content === "string" ? first.message.content : null,
      };
    } catch (error) {
      if (error instanceof Error && /^MIMO_HTTP_\d+$/.test(error.message)) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new Error("MIMO_TIMEOUT");
      throw new Error("MIMO_NETWORK");
    } finally {
      clearTimeout(timeout);
    }
  }
}
