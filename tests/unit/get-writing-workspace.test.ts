import { describe, expect, it } from "vitest";
import { createEssaySessionUseCase } from "../../src/application/create-essay-session";
import { getWritingWorkspace } from "../../src/application/get-writing-workspace";
import { InMemoryEssaySessionRepository } from "../../src/testing/in-memory-essay-session.repository";

describe("get writing workspace", () => {
  it("returns only the current successful revision", async () => {
    const repository = new InMemoryEssaySessionRepository();
    const created = await createEssaySessionUseCase(repository, { clientRequestId: "create", userId: "00000000-0000-4000-8000-000000000104", promptText: "Describe.", now: new Date("2026-08-14T01:00:00.000Z") });
    await repository.seedUncommittedRevision(created.session.id, "not visible");
    expect((await getWritingWorkspace(repository, created.session.id))?.revision.plainText).toBe("");
    expect(await getWritingWorkspace(repository, "00000000-0000-4000-8000-000000000999")).toBeUndefined();
  });
});
