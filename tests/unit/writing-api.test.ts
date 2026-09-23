import { describe, expect, it } from "vitest";
import { createEssayRouteHandlers } from "../../src/presentation/writing/route-handlers";
import { InMemoryEssaySessionRepository } from "../../src/testing/in-memory-essay-session.repository";

describe("writing API handlers", () => {
  it("creates, restores, and saves a session with stable status codes", async () => {
    const handlers = createEssayRouteHandlers(new InMemoryEssaySessionRepository(), () => new Date("2026-08-14T01:00:00.000Z"));
    const created = await handlers.create(new Request("http://local/api/essays", { method: "POST", body: JSON.stringify({ clientRequestId: "create", promptText: "Describe." }) }));
    expect(created.status).toBe(201);
    const creation = await created.json();
    const restored = await handlers.get(creation.sessionId);
    expect(restored.status).toBe(200);
    const workspace = await restored.json();
    const saved = await handlers.save(creation.sessionId, new Request("http://local/draft", { method: "PUT", body: JSON.stringify({ expectedRevisionId: workspace.revision.id, plainText: "The chart rose.", content: { type: "doc" }, clientMutationId: "save", timer: { elapsedMs: 1000 } }) }));
    expect(saved.status).toBe(200);
  });

  it("persists a Task 2 TXT filename through create and workspace reload", async () => {
    const handlers = createEssayRouteHandlers(new InMemoryEssaySessionRepository(), () => new Date("2026-08-24T01:00:00.000Z"));
    const created = await handlers.create(new Request("http://local/api/essays", {
      method: "POST",
      body: JSON.stringify({
        clientRequestId: "task-2-txt-create",
        taskType: "TASK_2",
        txtFileName: "C5-T2-T1.txt",
        promptText: "Discuss both views and give your opinion.",
      }),
    }));

    expect(created.status).toBe(201);
    const { sessionId } = await created.json();
    const reloaded = await handlers.get(sessionId);
    expect(reloaded.status).toBe(200);
    await expect(reloaded.json()).resolves.toMatchObject({
      task: {
        imagePlaceholderKind: "TASK_2_NOT_REQUIRED",
        txtFileName: "C5-T2-T1.txt",
        promptText: "Discuss both views and give your opinion.",
      },
    });
  });

  it("returns stable validation, missing, and conflict responses", async () => {
    const handlers = createEssayRouteHandlers(new InMemoryEssaySessionRepository(), () => new Date());
    expect((await handlers.create(new Request("http://local", { method: "POST", body: "{}" }))).status).toBe(400);
    expect((await handlers.create(new Request("http://local", { method: "POST", body: "{" }))).status).toBe(400);
    expect((await handlers.save("00000000-0000-4000-8000-000000000999", new Request("http://local", { method: "PUT", body: "{" }))).status).toBe(400);
    expect((await handlers.get("00000000-0000-4000-8000-000000000999")).status).toBe(404);
  });

  it("returns 409 for stale revisions and 503 for storage failure", async () => {
    const repository = new InMemoryEssaySessionRepository();
    const handlers = createEssayRouteHandlers(repository, () => new Date("2026-08-14T01:00:00.000Z"));
    const created = await handlers.create(new Request("http://local", { method: "POST", body: JSON.stringify({ clientRequestId: "conflict", promptText: "Describe." }) }));
    const { sessionId } = await created.json();
    const workspace = await (await handlers.get(sessionId)).json();
    const body = { expectedRevisionId: workspace.revision.id, plainText: "First", content: { type: "doc" }, clientMutationId: "first", timer: { elapsedMs: 1 } };
    expect((await handlers.save(sessionId, new Request("http://local", { method: "PUT", body: JSON.stringify(body) }))).status).toBe(200);
    const conflict = await handlers.save(sessionId, new Request("http://local", { method: "PUT", body: JSON.stringify({ ...body, clientMutationId: "stale" }) }));
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ status: "REVISION_CONFLICT" });

    const unavailable = createEssayRouteHandlers(Object.assign(repository, { findWorkspace: async () => { throw new Error("DOWN"); } }));
    expect((await unavailable.get(sessionId)).status).toBe(503);
  });
});
