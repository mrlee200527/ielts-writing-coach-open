import { spawn, spawnSync } from "node:child_process";

const environment = {
  ...process.env,
  LOCAL_DATABASE_PATH: process.env.LOCAL_DATABASE_PATH ?? ".data/playwright.sqlite",
  // Automated E2E is intentionally offline. Real MiMo calls are isolated in the paid Gate B/D scripts.
  MIMO_API_KEY: "",
  MIMO_BASE_URL: "",
  MIMO_MODEL: "",
};
const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3100"], { env: environment, stdio: "inherit" });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { const response = await fetch("http://127.0.0.1:3100"); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("PLAYWRIGHT_SERVER_TIMEOUT");
}

function runPlaywright() {
  const args = ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)];
  return new Promise((resolve) => spawn(process.execPath, args, { env: environment, stdio: "inherit" }).on("exit", (code) => resolve(code ?? 1)));
}

let exitCode = 1;
try {
  await waitForServer();
  exitCode = await runPlaywright();
} finally {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(next.pid), "/T", "/F"], { stdio: "ignore" });
  else next.kill("SIGTERM");
}
process.exit(exitCode);
