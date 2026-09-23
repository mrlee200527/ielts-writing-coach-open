import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe("project test configuration", () => {
  it("runs unit tests in the Node environment", () => {
    expect(typeof process.version).toBe("string");
  });

  it("defines Phase 2 persistence and browser test tooling", () => {
    expect(packageJson.scripts).toMatchObject({
      "test:unit": "vitest --run",
      "test:e2e": "node scripts/run-playwright.mjs",
      "db:generate": "drizzle-kit generate",
      "db:migrate": "tsx src/infrastructure/database/migrate.ts",
    });
    expect(packageJson.dependencies).toHaveProperty("@tiptap/react");
    expect(packageJson.dependencies).toHaveProperty("drizzle-orm");
    expect(packageJson.dependencies).toHaveProperty("better-sqlite3");
    expect(packageJson.devDependencies).toHaveProperty("@playwright/test");
    expect(packageJson.devDependencies).toHaveProperty("drizzle-kit");
  });

  it("does not install deferred external integrations", () => {
    const allDependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    expect(Object.keys(allDependencies).some((name) => /openai|supabase|trigger/i.test(name))).toBe(false);
  });
});
