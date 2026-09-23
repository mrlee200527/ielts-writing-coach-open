import { describe, expect, it } from "vitest";
import { InMemoryEssaySessionRepository } from "../../src/testing/in-memory-essay-session.repository";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createEssayRouteHandlers } from "../../src/presentation/writing/route-handlers";

describe("writing main flow AI isolation", () => {
  it("creates, saves, and restores without invoking AI ports", async () => {
    const repository = new InMemoryEssaySessionRepository();
    const handlers = createEssayRouteHandlers(repository, () => new Date("2026-08-14T01:00:00.000Z"));
    const createdResponse = await handlers.create(new Request("http://local", { method: "POST", body: JSON.stringify({ clientRequestId: "create", promptText: "Describe." }) }));
    const { sessionId } = await createdResponse.json();
    const workspace = await (await handlers.get(sessionId)).json();
    await handlers.save(sessionId, new Request("http://local", { method: "PUT", body: JSON.stringify({ expectedRevisionId: workspace.revision.id, plainText: "Works without AI.", content: {}, timer: { elapsedMs: 1 }, clientMutationId: "save" }) }));
    expect((await repository.findWorkspace(sessionId))?.revision.plainText).toBe("Works without AI.");

    const productionComposition = [
      "app/api/essays/route.ts",
      "app/api/essays/[sessionId]/route.ts",
      "app/api/essays/[sessionId]/draft/route.ts",
      "src/presentation/writing/route-handlers.ts",
    ].map((path) => readFileSync(resolve(path), "utf8")).join("\n");
    expect(productionComposition).not.toMatch(/LLMPort|JobPort|llm\.port|job\.port|CheckCoordinator/);
  });
});
