import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("MiMo secret boundary", () => {
  it("does not place the secret sentinel in browser-facing source", async () => {
    const sentinel = "mimo-secret-must-never-reach-browser-7f31";
    const browserFiles = [
      "app/page.tsx",
      "src/presentation/task-intake/task-intake-form.tsx",
      "src/presentation/writing/writing-workspace.tsx",
      "src/presentation/writing/feedback-panel.tsx",
    ];
    const sources = await Promise.all(browserFiles.map((file) => readFile(resolve(file), "utf8")));
    expect(sources.join("\n")).not.toContain(sentinel);
  });
});
