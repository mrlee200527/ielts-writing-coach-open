import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const path = process.env.LOCAL_DATABASE_PATH ?? ".data/local.sqlite";
mkdirSync(dirname(path), { recursive: true });
const sqlite = new BetterSqlite3(path);

try {
  sqlite.pragma("journal_mode = WAL");
  migrate(drizzle(sqlite), {
    migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), "migrations"),
  });
} finally {
  sqlite.close();
}
