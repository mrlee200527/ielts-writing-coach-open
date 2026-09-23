import { describe, expect, it, vi } from "vitest";

import { MiMoClient } from "../../src/infrastructure/llm/mimo-client";

describe("MiMoClient", () => {
  it("sends one authorized chat completion request and returns the assistant content", async () => {
    let captured: { input: string | URL | Request; init?: RequestInit } | undefined;
    const fetchStub = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      captured = { input, init };
      return Response.json({
        id: "response-1",
        choices: [{ finish_reason: "stop", message: { content: "{\"ok\":true}" } }],
      });
    });
    const client = new MiMoClient(
      { apiKey: "test-key", baseUrl: "https://example.test/v1", model: "mimo-v2.5" },
      { fetch: fetchStub },
    );

    const result = await client.complete({ messages: [{ role: "user", content: "hello" }] });

    expect(result).toEqual({ responseId: "response-1", finishReason: "stop", content: "{\"ok\":true}" });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(captured?.input).toBe("https://example.test/v1/chat/completions");
    const init = captured?.init;
    expect(init?.headers).toEqual({ authorization: "Bearer test-key", "content-type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "mimo-v2.5",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(init?.redirect).toBe("error");
  });

  it("sanitizes provider errors without exposing the key or response body", async () => {
    const fetchStub = vi.fn(async () => new Response("private provider detail", { status: 401 }));
    const client = new MiMoClient(
      { apiKey: "secret-value", baseUrl: "https://example.test/v1", model: "mimo-v2.5" },
      { fetch: fetchStub },
    );

    await expect(client.complete({ messages: [] })).rejects.toThrow("MIMO_HTTP_401");
    try {
      await client.complete({ messages: [] });
    } catch (error) {
      expect(String(error)).not.toContain("secret-value");
      expect(String(error)).not.toContain("private provider detail");
    }
  });
});
