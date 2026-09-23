import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createLocalDatabase } from "../../src/infrastructure/database/client";
import { DrizzleTaskIntakeRepository } from "../../src/infrastructure/storage/drizzle-task-intake.repository";
import { createTaskIntake } from "../../src/application/task-intake/create-task-intake";
import { InMemoryBlobFake } from "../../src/testing/in-memory-blob.fake";
import { ControlledJobFake } from "../../src/testing/controlled-job.fake";
import { dynamicTaskContextFixture } from "../../src/testing/task-context-fixtures";
import { stableUuid } from "../../src/domain/shared/ids";
import { eventTypeSchema } from "../../src/domain/events/event-types";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

describe("drizzle task intake repository", () => {
  it("adds txt_file_name to an existing bootstrap database without a Drizzle journal", () => {
    const directory = mkdtempSync(join(tmpdir(), "task-intake-db-")); directories.push(directory);
    const path = join(directory, "legacy.sqlite");
    const legacy = new BetterSqlite3(path);
    legacy.exec("CREATE TABLE writing_tasks (id TEXT PRIMARY KEY, prompt_text TEXT NOT NULL, image_placeholder_kind TEXT NOT NULL); CREATE TABLE task_context_attempts (id TEXT PRIMARY KEY); CREATE TABLE task_context_versions (id TEXT PRIMARY KEY)");
    legacy.close();
    const database = createLocalDatabase(path);
    try {
      const columns = database.sqlite.prepare("PRAGMA table_info(writing_tasks)").all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toContain("txt_file_name");
    } finally { database.close(); }
  });

  it("persists six nullable columns without changing historical placeholder semantics", () => {
    const directory = mkdtempSync(join(tmpdir(), "task-intake-db-")); directories.push(directory);
    const database = createLocalDatabase(join(directory, "test.sqlite"));
    try {
      const columns = database.sqlite.prepare("PRAGMA table_info(writing_tasks)").all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(["image_blob_id", "image_media_type", "image_sha256", "intake_status", "active_attempt_id", "current_task_context_version_id"]));
      database.sqlite.prepare("INSERT INTO writing_tasks (id,prompt_text,image_placeholder_kind) VALUES (?,?,?)").run(stableUuid("old-task"), "Old", "TASK_1_PENDING");
      const row = database.sqlite.prepare("SELECT * FROM writing_tasks WHERE id=?").get(stableUuid("old-task")) as Record<string, unknown>;
      expect([row.image_blob_id, row.image_media_type, row.image_sha256, row.intake_status, row.active_attempt_id, row.current_task_context_version_id]).toEqual([null, null, null, null, null, null]);
    } finally { database.close(); }
  });

  it("publishes version, pointer, attempt, and event atomically and deduplicates callback", async () => {
    const directory = mkdtempSync(join(tmpdir(), "task-intake-db-")); directories.push(directory);
    const database = createLocalDatabase(join(directory, "test.sqlite"));
    try {
      const repository = new DrizzleTaskIntakeRepository(database);
      const created = await createTaskIntake({ repository, blobs: new InMemoryBlobFake(), jobs: new ControlledJobFake() }, { requestIdempotencyKey: "db-create", userId: stableUuid("user"), promptText: null, imageBytes: new Uint8Array([1]), mediaType: "image/png", now: new Date("2026-08-14T06:00:00Z") });
      await repository.claimAttempt({ taskId: created.workspace.task.id, attemptId: created.attempt.id, inputHash: created.attempt.inputHash, idempotencyKey: created.attempt.idempotencyKey });
      const input = { taskId: created.workspace.task.id, attemptId: created.attempt.id, inputHash: created.attempt.inputHash, status: "READY" as const, context: dynamicTaskContextFixture, sourceImageSha256: created.workspace.task.imageSha256!, promptVersion: "task-context-v1", model: "fixed", limitations: [], createdAt: new Date("2026-08-14T06:01:00Z") };
      await expect(repository.publishAcceptedAttempt(input)).resolves.toBe("PUBLISHED");
      await expect(repository.publishAcceptedAttempt(input)).resolves.toBe("DUPLICATE");
      expect(repository.versions(created.workspace.task.id)).toHaveLength(1);
      expect(repository.eventCount(created.workspace.task.id)).toBe(1);
      expect((await repository.findResolution(created.workspace.task.id))?.availability).toBe("READY");
    } finally { database.close(); }
  });

  it("publishes UNAVAILABLE with a failure-terminal event and rolls all writes back if that event fails", async () => {
    expect(eventTypeSchema.parse("task.context_unavailable")).toBe("task.context_unavailable");
    const directory = mkdtempSync(join(tmpdir(), "task-intake-db-")); directories.push(directory);
    const database = createLocalDatabase(join(directory, "test.sqlite"));
    try {
      const repository = new DrizzleTaskIntakeRepository(database);
      const createUnavailable = async (requestIdempotencyKey: string) => {
        const created = await createTaskIntake({ repository, blobs: new InMemoryBlobFake(), jobs: new ControlledJobFake() }, { requestIdempotencyKey, userId: stableUuid("user"), promptText: null, imageBytes: new Uint8Array([1]), mediaType: "image/png", now: new Date("2026-08-14T06:00:00Z") });
        await repository.claimAttempt({ taskId: created.workspace.task.id, attemptId: created.attempt.id, inputHash: created.attempt.inputHash, idempotencyKey: created.attempt.idempotencyKey });
        return { created, input: { taskId: created.workspace.task.id, attemptId: created.attempt.id, inputHash: created.attempt.inputHash, status: "UNAVAILABLE" as const, context: null, sourceImageSha256: created.workspace.task.imageSha256!, promptVersion: "task-context-v1", model: "fixed", limitations: ["IMAGE_UNREADABLE" as const], createdAt: new Date("2026-08-14T06:01:00Z") } };
      };

      const accepted = await createUnavailable("db-unavailable");
      await expect(repository.publishAcceptedAttempt(accepted.input)).resolves.toBe("PUBLISHED");
      await expect(repository.publishAcceptedAttempt(accepted.input)).resolves.toBe("DUPLICATE");
      const events = database.sqlite.prepare("SELECT event_type FROM domain_events WHERE aggregate_id = ?").all(accepted.created.workspace.task.id) as Array<{ event_type: string }>;
      expect(events.map((event) => event.event_type)).toEqual(["task.context_unavailable"]);
      expect(events.some((event) => event.event_type === "task.context_ready")).toBe(false);
      expect(repository.versions(accepted.created.workspace.task.id)).toHaveLength(1);
      expect(await repository.findResolution(accepted.created.workspace.task.id)).toMatchObject({ availability: "UNAVAILABLE", processingStatus: "FAILED", context: null });

      const rollback = await createUnavailable("db-unavailable-rollback");
      database.sqlite.exec("CREATE TRIGGER fail_unavailable_event BEFORE INSERT ON domain_events WHEN NEW.event_type = 'task.context_unavailable' BEGIN SELECT RAISE(ABORT, 'event failed'); END;");
      await expect(repository.publishAcceptedAttempt(rollback.input)).rejects.toThrow();
      expect(repository.versions(rollback.created.workspace.task.id)).toHaveLength(0);
      const task = database.sqlite.prepare("SELECT intake_status, current_task_context_version_id FROM writing_tasks WHERE id = ?").get(rollback.created.workspace.task.id) as { intake_status: string; current_task_context_version_id: string | null };
      const attempt = database.sqlite.prepare("SELECT state FROM task_context_attempts WHERE id = ?").get(rollback.created.attempt.id) as { state: string };
      expect(task).toEqual({ intake_status: "PROCESSING", current_task_context_version_id: null });
      expect(attempt.state).toBe("ACTIVE");
    } finally { database.close(); }
  });
});
import BetterSqlite3 from "better-sqlite3";
