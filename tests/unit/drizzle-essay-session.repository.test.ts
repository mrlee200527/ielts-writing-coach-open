import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createEssaySessionUseCase } from "../../src/application/create-essay-session";
import { saveEssayDraft } from "../../src/application/save-essay-draft";
import { createLocalDatabase } from "../../src/infrastructure/database/client";
import { DrizzleEssaySessionRepository } from "../../src/infrastructure/storage/drizzle-essay-session.repository";
import { domainEvents, essayRevisions, essaySessions } from "../../src/infrastructure/database/schema";
import { eq } from "drizzle-orm";
import { createTestObservationAdapter } from "../../src/testing/test-observation.adapter";
import { InMemoryEventRecorder } from "../../src/testing/in-memory-event-recorder";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

describe("drizzle essay session repository", () => {
  it("persists the latest successful revision across reconnects", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ielts-phase2-")); directories.push(directory);
    const path = join(directory, "test.sqlite");
    let database = createLocalDatabase(path);
    try {
      let repository = new DrizzleEssaySessionRepository(database);
      const created = await createEssaySessionUseCase(repository, { clientRequestId: "create", userId: "00000000-0000-4000-8000-000000000104", promptText: "Describe.", now: new Date("2026-08-14T01:00:00.000Z") });
      const saved = await saveEssayDraft(repository, { sessionId: created.session.id, expectedRevisionId: created.revision.id, plainText: "Persisted text.", content: { type: "doc" }, timer: { elapsedMs: 2000 }, clientMutationId: "save", now: new Date("2026-08-14T01:00:02.000Z") });
      database.close(); database = createLocalDatabase(path); repository = new DrizzleEssaySessionRepository(database);
      expect((await repository.findWorkspace(created.session.id))?.revision.plainText).toBe("Persisted text.");
      const replay = await repository.findMutation(created.session.id, "save");
      expect(replay?.status).toBe("SAVED");
      if (saved.status === "REVISION_CONFLICT" || !replay || replay.status === "REVISION_CONFLICT") throw new Error("expected saved revision");
      expect(replay.revision.id).toBe(saved.revision.id);
      expect(database.db.select().from(domainEvents).all().map((event) => event.eventType)).toEqual(["essay.session_created", "essay.revision_saved"]);
    } finally { database.close(); }
  });

  it("scopes mutation idempotency to a session and replays concurrent requests", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ielts-phase2-")); directories.push(directory);
    const database = createLocalDatabase(join(directory, "test.sqlite"));
    try {
      const repository = new DrizzleEssaySessionRepository(database);
      const first = await createEssaySessionUseCase(repository, { clientRequestId: "create-a", userId: "00000000-0000-4000-8000-000000000104", promptText: "A", now: new Date("2026-08-14T01:00:00.000Z") });
      const second = await createEssaySessionUseCase(repository, { clientRequestId: "create-b", userId: "00000000-0000-4000-8000-000000000104", promptText: "B", now: new Date("2026-08-14T01:00:00.000Z") });
      const save = (sessionId: string, revisionId: string, plainText: string) => saveEssayDraft(repository, { sessionId, expectedRevisionId: revisionId, plainText, content: { type: "doc" }, timer: { elapsedMs: 1 }, clientMutationId: "shared", now: new Date("2026-08-14T01:00:01.000Z") });
      const [saved, replay] = await Promise.all([save(first.session.id, first.revision.id, "First"), save(first.session.id, first.revision.id, "First")]);
      expect(replay.status).toBe("ALREADY_SAVED");
      if (saved.status === "REVISION_CONFLICT" || replay.status === "REVISION_CONFLICT") throw new Error("expected saved revision");
      expect(replay.revision.id).toBe(saved.revision.id);
      expect((await save(second.session.id, second.revision.id, "Second")).status).toBe("SAVED");
      expect((await repository.findWorkspace(second.session.id))?.revision.plainText).toBe("Second");
    } finally { database.close(); }
  });

  it("returns only the user's most recently written DRAFT", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ielts-phase2-")); directories.push(directory);
    const database = createLocalDatabase(join(directory, "test.sqlite"));
    try {
      const repository = new DrizzleEssaySessionRepository(database);
      const userId = "00000000-0000-4000-8000-000000000104";
      const first = await createEssaySessionUseCase(repository, { clientRequestId: "recent-first", userId, promptText: "First", now: new Date("2026-08-14T01:00:00.000Z") });
      await saveEssayDraft(repository, { sessionId: first.session.id, expectedRevisionId: first.revision.id, plainText: "First saved", content: {}, timer: { elapsedMs: 1 }, clientMutationId: "recent-first-save", now: new Date("2026-08-14T03:00:00.000Z") });
      const latest = await createEssaySessionUseCase(repository, { clientRequestId: "recent-latest", userId, promptText: "Latest", now: new Date("2026-08-14T02:00:00.000Z") });
      const latestSave = await saveEssayDraft(repository, { sessionId: latest.session.id, expectedRevisionId: latest.revision.id, plainText: "Latest saved", content: {}, timer: { elapsedMs: 1 }, clientMutationId: "recent-latest-save", now: new Date("2026-08-14T04:00:00.000Z") });
      const otherUser = await createEssaySessionUseCase(repository, { clientRequestId: "recent-other", userId: "00000000-0000-4000-8000-000000000105", promptText: "Other", now: new Date("2026-08-14T05:00:00.000Z") });
      const submitted = await createEssaySessionUseCase(repository, { clientRequestId: "recent-submitted", userId, promptText: "Submitted", now: new Date("2026-08-14T06:00:00.000Z") });
      database.db.update(essaySessions).set({ status: "SUBMITTED" }).where(eq(essaySessions.id, submitted.session.id)).run();
      if (latestSave.status === "REVISION_CONFLICT") throw new Error("expected saved revision");
      expect((await repository.findMostRecentDraft(userId))?.session.id).toBe(latest.session.id);
      expect((await repository.findMostRecentDraft(userId))?.revision.id).toBe(latestSave.revision.id);
      expect((await repository.findMostRecentDraft("00000000-0000-4000-8000-000000000105"))?.session.id).toBe(otherUser.session.id);
      expect(await repository.findMostRecentDraft("00000000-0000-4000-8000-000000000106")).toBeUndefined();
    } finally { database.close(); }
  });

  it("returns one session for concurrent duplicate create requests", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ielts-phase2-")); directories.push(directory);
    const database = createLocalDatabase(join(directory, "test.sqlite"));
    try {
      const repository = new DrizzleEssaySessionRepository(database);
      const input = { clientRequestId: "same-create", userId: "00000000-0000-4000-8000-000000000104", promptText: "Describe.", now: new Date("2026-08-14T01:00:00.000Z") };
      const [first, second] = await Promise.all([createEssaySessionUseCase(repository, input), createEssaySessionUseCase(repository, input)]);
      expect(second.session.id).toBe(first.session.id);
    } finally { database.close(); }
  });

  it("rolls back revision and pointer when event insertion fails", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ielts-phase2-")); directories.push(directory);
    const database = createLocalDatabase(join(directory, "test.sqlite"));
    try {
      const repository = new DrizzleEssaySessionRepository(database);
      const created = await createEssaySessionUseCase(repository, { clientRequestId: "rollback", userId: "00000000-0000-4000-8000-000000000104", promptText: "Describe.", now: new Date("2026-08-14T01:00:00.000Z") });
      database.sqlite.exec("CREATE TRIGGER fail_revision_event BEFORE INSERT ON domain_events WHEN NEW.event_type = 'essay.revision_saved' BEGIN SELECT RAISE(ABORT, 'event failed'); END;");
      await expect(saveEssayDraft(repository, { sessionId: created.session.id, expectedRevisionId: created.revision.id, plainText: "Must roll back", content: {}, timer: { elapsedMs: 1 }, clientMutationId: "rollback-save", now: new Date("2026-08-14T01:00:01.000Z") })).rejects.toThrow();
      expect((await repository.findWorkspace(created.session.id))?.revision.id).toBe(created.revision.id);
      expect(database.db.select().from(essayRevisions).all()).toHaveLength(1);
    } finally { database.close(); }
  });

  it("exposes committed SQLite revisions and events through TestObservationPort", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ielts-phase2-")); directories.push(directory);
    const database = createLocalDatabase(join(directory, "test.sqlite"));
    try {
      const repository = new DrizzleEssaySessionRepository(database);
      const created = await createEssaySessionUseCase(repository, { clientRequestId: "observe", userId: "00000000-0000-4000-8000-000000000104", promptText: "Describe.", now: new Date("2026-08-14T01:00:00.000Z") });
      await saveEssayDraft(repository, { sessionId: created.session.id, expectedRevisionId: created.revision.id, plainText: "Observed", content: {}, timer: { elapsedMs: 1 }, clientMutationId: "observe-save", now: new Date("2026-08-14T01:00:01.000Z") });
      const observation = createTestObservationAdapter("test", new InMemoryEventRecorder(), undefined, repository);
      expect((observation.currentRevision(created.session.id) as { plainText: string }).plainText).toBe("Observed");
      expect(observation.revisionCount(created.session.id)).toBe(2);
      expect(observation.eventsByAggregate(created.session.id).map((event) => event.eventType)).toEqual(["essay.session_created", "essay.revision_saved"]);
      expect(Object.isFrozen(observation.currentRevision(created.session.id))).toBe(true);
    } finally { database.close(); }
  });
});
