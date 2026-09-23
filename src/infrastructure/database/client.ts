import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const migration = `
CREATE TABLE IF NOT EXISTS writing_tasks (id TEXT PRIMARY KEY, prompt_text TEXT NOT NULL, image_placeholder_kind TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS essay_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, task_id TEXT NOT NULL, status TEXT NOT NULL, current_revision_id TEXT NOT NULL, started_at TEXT NOT NULL, submitted_at TEXT, timer_elapsed_ms INTEGER NOT NULL, timer_running_since TEXT, client_request_id TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS essay_revisions (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, revision_no INTEGER NOT NULL, plain_text TEXT NOT NULL, content_json TEXT NOT NULL, word_count INTEGER NOT NULL, text_hash TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(session_id, revision_no));
CREATE TABLE IF NOT EXISTS draft_mutations (id TEXT NOT NULL, session_id TEXT NOT NULL, status TEXT NOT NULL, revision_id TEXT, current_revision_id TEXT, PRIMARY KEY(session_id, id));
CREATE TABLE IF NOT EXISTS domain_events (id TEXT PRIMARY KEY, aggregate_type TEXT NOT NULL, aggregate_id TEXT NOT NULL, event_type TEXT NOT NULL, payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL, correlation_id TEXT NOT NULL);`;

export function createLocalDatabase(path: string) {
  const sqlite = new BetterSqlite3(path);
  sqlite.pragma("journal_mode = WAL");
  const hasApplicationSchema = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations' LIMIT 1").get();
  if (!hasApplicationSchema) {
    sqlite.exec(migration);
    const eventColumns = sqlite.prepare("PRAGMA table_info(domain_events)").all() as Array<{ name: string }>;
    if (!eventColumns.some((column) => column.name === "aggregate_type")) sqlite.exec("ALTER TABLE domain_events ADD COLUMN aggregate_type TEXT NOT NULL DEFAULT 'essay_session'");
    const taskColumns = sqlite.prepare("PRAGMA table_info(writing_tasks)").all() as Array<{ name: string }>;
    for (const column of ["image_blob_id", "image_media_type", "image_sha256", "intake_status", "active_attempt_id", "current_task_context_version_id"]) if (!taskColumns.some((item) => item.name === column)) sqlite.exec(`ALTER TABLE writing_tasks ADD COLUMN ${column} TEXT`);
    sqlite.exec(`CREATE TABLE IF NOT EXISTS task_context_attempts (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, input_hash TEXT NOT NULL, prompt_version TEXT NOT NULL, schema_version INTEGER NOT NULL, idempotency_key TEXT NOT NULL, state TEXT NOT NULL, call_count INTEGER NOT NULL, job_id TEXT, failure_code TEXT, started_at TEXT NOT NULL, finished_at TEXT, UNIQUE(task_id,idempotency_key)); CREATE TABLE IF NOT EXISTS task_context_versions (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL, context_json TEXT, limitations_json TEXT NOT NULL, source_image_sha256 TEXT NOT NULL, prompt_version TEXT NOT NULL, schema_version INTEGER NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(task_id,version));`);
  }
  ensureNullableColumns(sqlite, "writing_tasks", [["txt_file_name", "TEXT"]]);
  ensureNullableColumns(sqlite, "task_context_attempts", [
    ["provider_kind", "TEXT"],
    ["connection_id", "TEXT"],
    ["config_revision", "INTEGER"],
    ["normalized_endpoint", "TEXT"],
    ["secret_revision", "INTEGER"],
    ["secret_ref", "TEXT"],
    ["requested_model_id", "TEXT"],
    ["verification_id", "TEXT"],
    ["verification_fingerprint", "TEXT"],
    ["adapter_contract_version", "TEXT"],
    ["invocation_fingerprint", "TEXT"],
  ]);
  ensureNullableColumns(sqlite, "task_context_versions", [
    ["source_attempt_id", "TEXT"],
    ["provider_kind", "TEXT"],
    ["connection_id", "TEXT"],
    ["config_revision", "INTEGER"],
    ["normalized_endpoint", "TEXT"],
    ["secret_revision", "INTEGER"],
    ["requested_model_id", "TEXT"],
    ["verification_id", "TEXT"],
    ["verification_fingerprint", "TEXT"],
    ["adapter_contract_version", "TEXT"],
    ["invocation_fingerprint", "TEXT"],
  ]);
  return { sqlite, db: drizzle(sqlite, { schema }), close: () => sqlite.close() };
}

function ensureNullableColumns(sqlite: BetterSqlite3.Database, table: string, columns: ReadonlyArray<readonly [string, "TEXT" | "INTEGER"]>) {
  const existing = new Set((sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name));
  for (const [name, type] of columns) if (!existing.has(name)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
}

export type LocalDatabase = ReturnType<typeof createLocalDatabase>;
