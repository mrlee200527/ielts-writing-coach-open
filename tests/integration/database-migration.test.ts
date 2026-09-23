import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];

afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

describe("formal database migrations", () => {
  it("runs 0002 through Drizzle and preserves a non-empty Phase 2 database", () => {
    const directory = mkdtempSync(join(tmpdir(), "phase-2-upgrade-"));
    directories.push(directory);
    const databasePath = join(directory, "phase-2.sqlite");
    const phase2Migrations = join(directory, "phase-2-migrations");
    const sourceMigrations = resolve("src/infrastructure/database/migrations");
    mkdirSync(join(phase2Migrations, "meta"), { recursive: true });
    for (const tag of ["0000_aspiring_thanos", "0001_lively_sleeper"]) {
      writeFileSync(join(phase2Migrations, `${tag}.sql`), readFileSync(join(sourceMigrations, `${tag}.sql`)));
    }
    const journal = JSON.parse(readFileSync(join(sourceMigrations, "meta/_journal.json"), "utf8")) as {
      entries: Array<{ idx: number; tag: string; when: number }>;
    };
    writeFileSync(
      join(phase2Migrations, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, 2) }),
    );

    const phase2Sqlite = new BetterSqlite3(databasePath);
    migrate(drizzle(phase2Sqlite), { migrationsFolder: phase2Migrations });
    phase2Sqlite
      .prepare("INSERT INTO writing_tasks (id, prompt_text, image_placeholder_kind) VALUES (?, ?, ?)")
      .run("00000000-0000-4000-8000-000000000201", "Historical Phase 2 task", "TASK_1_PENDING");
    phase2Sqlite.close();

    const command = process.platform === "win32" ? "npm.cmd" : "npm";
    const result = spawnSync(command, ["run", "db:migrate"], {
      cwd: process.cwd(),
      env: { ...process.env, LOCAL_DATABASE_PATH: databasePath },
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    expect(result.status, `${result.error?.message ?? ""}\n${result.stdout}\n${result.stderr}`).toBe(0);

    const upgraded = new BetterSqlite3(databasePath, { readonly: true });
    try {
      const historical = upgraded
        .prepare("SELECT * FROM writing_tasks WHERE id = ?")
        .get("00000000-0000-4000-8000-000000000201") as Record<string, unknown>;
      expect(historical.prompt_text).toBe("Historical Phase 2 task");
      expect(historical.txt_file_name).toBeNull();
      expect([
        historical.image_blob_id,
        historical.image_media_type,
        historical.image_sha256,
        historical.intake_status,
        historical.active_attempt_id,
        historical.current_task_context_version_id,
      ]).toEqual([null, null, null, null, null, null]);
      expect(
        upgraded
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'ai_%' ORDER BY name")
          .all(),
      ).toEqual([
        { name: "ai_model_verifications" },
        { name: "ai_probe_requests" },
        { name: "ai_provider_connections" },
        { name: "ai_role_selections" },
      ]);
      const attemptColumns = upgraded.prepare("PRAGMA table_info(task_context_attempts)").all() as Array<{ name: string }>;
      expect(attemptColumns.map(({ name }) => name)).toEqual(expect.arrayContaining([
        "provider_kind", "connection_id", "config_revision", "normalized_endpoint", "secret_revision", "secret_ref",
        "requested_model_id", "verification_id", "verification_fingerprint", "adapter_contract_version", "invocation_fingerprint",
      ]));
      const versionColumns = upgraded.prepare("PRAGMA table_info(task_context_versions)").all() as Array<{ name: string }>;
      expect(versionColumns.map(({ name }) => name)).toEqual(expect.arrayContaining([
        "source_attempt_id", "provider_kind", "connection_id", "config_revision", "requested_model_id", "verification_id", "verification_fingerprint",
      ]));
      const applied = upgraded.prepare("SELECT created_at FROM __drizzle_migrations ORDER BY created_at").all() as Array<{ created_at: number }>;
      expect(applied.map((entry) => Number(entry.created_at))).toEqual(journal.entries.map((entry) => entry.when));
      expect(journal.entries.at(-1)?.tag).not.toBe("0002_perpetual_virginia_dare");
    } finally {
      upgraded.close();
    }
  });
});
