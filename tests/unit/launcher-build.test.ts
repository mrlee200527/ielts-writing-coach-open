import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

describe("launcher build and local scripts", () => {
  it("defines dev:local bound to 127.0.0.1:3000", () => {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["dev:local"]).toBe("next dev -H 127.0.0.1 -p 3000");
  });

  it("provides .env.example with the three required MiMo settings", () => {
    const env = readFileSync(resolve(".env.example"), "utf8");
    expect(env).toContain("MIMO_API_KEY");
    expect(env).toContain("MIMO_BASE_URL");
    expect(env).toContain("MIMO_MODEL");
  });

  it("builds IELTS Writing Coach.exe via the PowerShell script", () => {
    const script = resolve("scripts/build-launcher.ps1");
    const result = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], { encoding: "utf8" });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const exe = resolve("dist/IELTS Writing Coach.exe");
    expect(existsSync(exe)).toBe(true);
    expect(statSync(exe).size).toBeGreaterThan(0);
  });

  it("resolves the project root when the exe lives in dist (L-01a AppRoot)", () => {
    const exe = resolve("dist/IELTS Writing Coach.exe");
    expect(existsSync(exe)).toBe(true);
    const marker = join(tmpdir(), "ielts-writing-coach-launcher-root.txt");
    rmSync(marker, { force: true });
    const result = spawnSync(exe, ["--print-root"], { encoding: "utf8" });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const printed = readFileSync(marker, "utf8");
    rmSync(marker, { force: true });
    expect(printed.trim()).toBe(resolve("."));
  });
});
