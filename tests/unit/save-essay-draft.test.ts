import { describe, expect, it } from "vitest";
import { createEssaySessionUseCase } from "../../src/application/create-essay-session";
import { saveEssayDraft } from "../../src/application/save-essay-draft";
import { InMemoryEssaySessionRepository } from "../../src/testing/in-memory-essay-session.repository";

describe("save essay draft", () => {
  it("saves immutable revisions, replays mutations, and rejects stale expected revisions", async () => {
    const repository = new InMemoryEssaySessionRepository();
    const created = await createEssaySessionUseCase(repository, { clientRequestId: "create", userId: "00000000-0000-4000-8000-000000000104", promptText: "Describe.", now: new Date("2026-08-14T01:00:00.000Z") });
    const input = { sessionId: created.session.id, expectedRevisionId: created.revision.id, plainText: "The chart rose.", content: { type: "doc" }, timer: { elapsedMs: 1000 }, clientMutationId: "save-1", now: new Date("2026-08-14T01:00:01.000Z") };
    const saved = await saveEssayDraft(repository, input);
    const replay = await saveEssayDraft(repository, input);
    const conflict = await saveEssayDraft(repository, { ...input, clientMutationId: "save-2", plainText: "Old overwrite" });
    expect(saved.status).toBe("SAVED");
    expect(replay).toEqual(saved);
    expect(conflict.status).toBe("REVISION_CONFLICT");
    expect((await repository.findWorkspace(created.session.id))?.revision.plainText).toBe("The chart rose.");
  });
});
