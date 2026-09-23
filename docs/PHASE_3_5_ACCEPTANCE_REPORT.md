# Phase 3.5 Independent Acceptance Report

## Conclusion

**Phase 3.5 Not Accepted.** All eight core feedback/health contracts and the full regression pass, but the Launcher — the top-priority deliverable of Phase 3.5 — cannot start the local service on this machine because of one P1 defect (two compounding root causes). No business code or Acceptance Criteria were modified during this review.

## Baseline

- Branch: `phase-3-5-usable-mvp`
- Architecture amendment: `94f16aa` (`docs: freeze phase 3.5 contracts in architecture 4.11`)
- Implementation under test: `18ebdaed6bcfbbffb5d522c9221d774e4a4eeb88` (`feat: complete phase 3.5 usable mvp`)
- Phase 3 Accepted baseline: `934e11434c8aa0ff9dec8c13d23276875446a69f`
- Mode: offline; no live OpenAI golden test, no real OpenAI API call, no API cost.
- Programmer handoff results were used as reference only; all numbers below are fresh independent runs.

## Defect

### P1 — L-01: Launcher cannot start the local service (server-start path broken)

The launcher's primary behavior — double-click the exe when no service is running → start `npm run dev:local` hidden → open the browser — fails on this machine. The exe polls `/api/health` for the full 60 s, the server never becomes healthy, and the failure path (MessageBox + log path) triggers. The server log (`%LOCALAPPDATA%\IELTS Writing Coach\server.log`) contains the npm failure:

```
Error: Cannot find module 'C:\Users\Administrator\Desktop\雅思作文助手\dist\node_modules\npm\bin\npm-prefix.js'
code: 'MODULE_NOT_FOUND'
```

Two compounding root causes were isolated by independent reproduction:

**L-01a (universal logic bug) — `AppRoot()` returns the `dist` directory instead of the project root.**

`launcher/Program.cs` computes `AppRoot()` as `Directory.GetParent(AppDomain.CurrentDomain.BaseDirectory).FullName`. `AppDomain.CurrentDomain.BaseDirectory` always ends with a directory separator (`...\dist\`), and `Directory.GetParent("...\dist\")` returns `...\dist` (the path itself), not `...\雅思作文助手`. Verified directly:

```
GetParent('C:\Users\Administrator\Desktop\雅思作文助手\dist\') = C:\Users\Administrator\Desktop\雅思作文助手\dist
GetParent('C:\Users\Administrator\Desktop\雅思作文助手\dist')   = C:\Users\Administrator\Desktop\雅思作文助手
```

Consequence: `StartServer` sets `WorkingDirectory = <root>\dist`, so npm runs from the wrong directory (the exe log path `...\dist\node_modules\npm\bin\npm-prefix.js` confirms cwd = `dist`). This fails on every machine regardless of npm version.

**L-01b (machine-reproducible spawn bug) — bare `npm.cmd` with `UseShellExecute = false` breaks npm's prefix resolution.**

Even with the correct working directory, spawning `npm.cmd` by bare name via `System.Diagnostics.ProcessStartInfo { UseShellExecute = false }` (exactly what `StartServer` does, including with `CreateNoWindow` and with/without redirected output) reproducibly fails: the executed batch resolves `%~dp0` to the working directory, so npm's shim looks for `npm-prefix.js` at `<workingDirectory>\node_modules\npm\bin\npm-prefix.js` and node exits with `MODULE_NOT_FOUND`.

Controlled reproductions (all on this machine):

| Spawn variant (UseShellExecute=false, WorkingDirectory=<root>) | Result |
|---|---|
| `npm.cmd run --version` from project root | FAIL — `MODULE_NOT_FOUND ...\node_modules\npm\bin\npm-prefix.js` |
| `npm.cmd run --version` from Desktop (no node_modules) | FAIL — `MODULE_NOT_FOUND ...\node_modules\npm\bin\npm-prefix.js` |
| `C:\Program Files\nodejs\npm.cmd run dev:local` (full path) | SUCCESS (server started) |
| `C:\Users\Administrator\AppData\Roaming\npm\npm.cmd run dev:local` (full path) | SUCCESS (server started) |
| `cmd.exe /c npm run dev:local` | SUCCESS (server started) |
| `npm.cmd` with `UseShellExecute = true` | SUCCESS |

The failure is independent of PATH content (reproduced with both the harness PATH and the raw registry machine+user PATH) and of redirection; it is specific to the bare-name `.cmd` spawn with `UseShellExecute=false`, which the launcher requires for hidden-window + log redirection.

**End-to-end exe evidence** (fresh build via `scripts/build-launcher.ps1`, server stopped, exe launched):
- Exe ran ~67 s (60 s health poll), server never became healthy, exit without user interaction on the failure path; log contained the npm-prefix error above.
- With a healthy server already running, the exe detects health, does NOT start a second Node/Next instance, and exits in ~175 ms (node process count unchanged 7→7) — this part works.

**Expected**: double-click starts the hidden `npm run dev:local` from the project root and opens the browser (Human Smoke Test path "关掉服务后双击 exe → 自动重新启动服务并打开页面").
**Actual**: npm fails immediately (`npm-prefix.js` not found), health never becomes 200, the 60 s poll times out and the failure MessageBox path triggers.
**Violated contract**: `docs/ARCHITECTURE.md` §4.11 launcher contract; `docs/PHASE_3_5_DESIGN.md` §3.2 steps 3–5; Implementation Plan DoD item 1; acceptance item "Launcher 独立验收 — 必须能够实际构建 … 正常运行不弹 console … 启动失败中文 MessageBox + 日志路径" (the launcher must actually be able to start the service).

**Fix direction (for Programmer AI, not implemented here)**: (1) compute the project root without the trailing-separator pitfall, e.g. `Directory.GetParent(Path.TrimEndingDirectorySeparator(AppDomain.CurrentDomain.BaseDirectory))` or `Directory.GetCurrentDirectory`-independent explicit parent-of-dist logic; (2) start npm through a full-path `npm.cmd` (resolve via PATH with `where.exe npm.cmd` / `Path.Combine(ProgramFiles, "nodejs", "npm.cmd")` fallback) or via `cmd.exe /c npm run dev:local`, keeping `UseShellExecute=false` + redirection.

## Passed evidence (Phase 3.5 core + regression)

- **1. `/api/health`** — GET returns 200 with body exactly `{ ok: true }`; no side effects; no key/path/provider/stack leakage (unit test + live probe while dev server was running).
- **2. EssayFeedback schema** — strict root and criteria; all bands 0–9 in 0.5 steps; 6.5 accepted, 6.3 rejected (also 6.8/0.2/9.5 rejected, boundaries 0 and 9 accepted); `strengths`/`improvements` 1–3; `priorityImprovement` required; extra keys rejected.
- **3. EssayFeedbackLLMPort** — additive `extends LLMPort` with independent `executeEssayFeedback`; `src/ports/llm.port.ts`, `src/ports/task-context-llm.port.ts`, `src/infrastructure/llm/openai-task-context.adapter.ts` verified zero business diff against the Phase 3 baseline (`git diff 934e114 18ebdae` empty); feedback adapter's inherited `execute()` returns TERMINAL (never serves feedback production calls); JSON decode failure → `INVALID_JSON` (owner=adapter); domain/Zod failure → `INVALID_STRUCTURE` (owner=use case); strict JSON Schema uses the 0.5-step band enum, `reasoning.effort=low`, model default `gpt-5.6-luna` with env override; no retry.
- **4. Narrow read-only dependency** — `request-essay-feedback` depends on `EssayFeedbackTaskContextSource { findResolution(taskId) }` only; the use case obtains no `createIntake/claimAttempt/publishAcceptedAttempt/retry` write capability (TS-enforced by the parameter type; verified by source review and the fake shape in tests).
- **5. CERTAIN-only prompt** — prompt contains every CERTAIN fact statement, never any UNCERTAIN/UNAVAILABLE statement text, includes `limitationCodes`, and explicitly requires "不得因题图信息受限而扣分或判错"; DEGRADED context still yields feedback; PENDING and UNAVAILABLE block without any LLM call; <150 words is allowed.
- **6. HTTP error matrix** — 404 `ESSAY_NOT_FOUND`, 409 `TASK_CONTEXT_PENDING`, 422 `TASK_CONTEXT_UNAVAILABLE`, 503 `FEEDBACK_LLM_UNAVAILABLE` (NETWORK/TIMEOUT), 502 `FEEDBACK_LLM_FAILED` (REFUSAL/INCOMPLETE/INVALID_JSON/INVALID_STRUCTURE/TERMINAL); every error body is `{ error, message }` with Chinese message; no stack, no raw provider response, no key (asserted in tests).
- **7. Feedback ≠ Assessment red line** — feedback writes nothing: no `essay_assessments`, no Student Memory, no domain events, no persistence, no scoring history, no change to the formal Assessment schema (source review: the use case has no write calls; no assessment references in new code); UI shows「非官方估计，仅供练习参考」.
- **8. Feedback UI** — right panel shows「获取反馈」; button disabled during the request (double-click protection tested); <150 words shows a hint without blocking; success renders overall band, four criteria, strengths, improvements and priority improvement; failures render the stable Chinese message, never a stack/raw error; no `clientRequestId` in the request.
- **Launcher (partial)** — `scripts/build-launcher.ps1` builds `dist\IELTS Writing Coach.exe` with the system `csc.exe` (verified by fresh build); PE header: subsystem = 2 (Windows GUI → no console); health probe at `http://127.0.0.1:3000/api/health` works (body `{"ok":true}`); when the service is already healthy the exe does not start a second server and exits quickly; failure UX is by code inspection a Chinese MessageBox + log path without stack. **Server-start path fails — see P1 L-01.**
- **E2E (offline deterministic fake)** — full user flow (home → upload → workspace → write → autosave → feedback button → fake feedback → sidebar render) plus the 502 error case pass; Phase 3 intake, Phase 2 autosave/recovery and Phase 1 domain foundation flows are retained; backend contracts are covered by independent unit/integration tests (not masked by route interception alone).

## Regression evidence (fresh runs)

- Phase 3.5 targeted (8 files): 61/61.
- Phase 3 regression (16 files): 67/67.
- Phase 2 regression (12 files): 25/25.
- Phase 1 independent acceptance: 8/8.
- Full Vitest: 45 files, 197/197.
- Coverage: statements 86.63%, branches 75.71%, functions 91.02%, lines 94.46%.
- Playwright: 5/5, repeated for 3 consecutive cold-start rounds (fresh `.data/playwright.sqlite` each round): 15/15 total, no failures.
- typecheck, lint, production build (routes include `/api/health` and `/api/essays/[sessionId]/feedback`), `git diff --check`: all passed.
- `npm audit --omit=dev`: 0 vulnerabilities.

## Known observation (non-blocking)

**Cold-start draft 404 (not reproduced).** The programmer reported a one-off `PUT /api/essays/[sessionId]/draft` 404 during the first cold full-suite run, not reproduced on re-run. Three independent cold-start full-suite rounds under this review (fresh DB each round) reproduced nothing: 15/15 green. Root-cause hypothesis from code review: `saveEssayDraft` throws `ESSAY_NOT_FOUND` only when the session row is absent; the only plausible window is a Next.js dev-mode cold-compile race (route not yet registered when the very first draft request arrives) — a dev-only artifact, not a backend contract defect. Recorded as a known observation; does not block acceptance.

## Handoff

Return to Programmer AI. Fix P1 L-01 (launcher server-start path): correct the project-root computation (L-01a) and start npm via a full-path `npm.cmd` or `cmd.exe /c npm run dev:local` (L-01b), then re-verify with the exe: service stopped → double-click → server starts hidden → health 200 → browser opens; repeat double-click while healthy → no second server. All other Phase 3.5 items passed this review. After the fix, Test AI re-verifies; the final Phase 3.5 gate remains the 总指挥's Human Smoke Test. Do not begin Phase 4.

---

# L-01 Re-verification after Repair (round 2)

## Conclusion (round 2)

**L-01 CLOSED. Phase 3.5 Test Acceptance Passed — awaiting Human Smoke Test.**

The P1 launcher defect is fixed by commit `02ede2945ac84fa43058f4f33a849e9255bdf7c9` and independently re-verified on all seven narrow-scope items below. The round-1 "Not Accepted" conclusion above is preserved as history and is superseded by this round for release gating. No business code was modified during this review; offline only, no live OpenAI, no API cost.

## Baseline (round 2)

- Branch: `phase-3-5-usable-mvp`
- Commit under test: `02ede2945ac84fa43058f4f33a849e9255bdf7c9` (`fix: repair launcher L-01 server start path`)
- Fix scope: `launcher/Program.cs` (AppRoot trailing-separator fix + `--print-root` hook; `cmd.exe /d /s /c "npm run dev:local >> log 2>&1"` via ComSpec; redirection moved inside cmd so no exe-held pipes), `tests/unit/launcher-build.test.ts` (AppRoot auto-verification), `CHANGELOG.md`.
- Scope of this round: L-01 only. Feedback / schema / CERTAIN-only / HTTP error matrix / other passed Phase 3.5 items were NOT re-reviewed.

## Item-by-item verification (fresh, independent)

1. **Service-stopped start path** — PASS. Port 3000 free, fresh exe launched: server became healthy in ~5 s (exe exited after health, browser-open path), health body exactly `{"ok":true}`; after the exe exited, health remained 200. `server.log` head shows `npm run dev:local` → `next dev -H 127.0.0.1 -p 3000` → `Ready in 730ms`, proving npm ran from the project root (a `dist` working directory would have failed with missing `package.json`).
2. **AppRoot** — PASS. `--print-root` from two unrelated working directories (`C:\Windows\Temp`, `C:\Windows`) wrote the marker file with exactly `C:\Users\Administrator\Desktop\雅思作文助手` (UTF-8 verified); the launcher's root resolution is cwd-independent. Also covered by `launcher-build.test.ts` (4/4).
3. **npm / cmd start path** — PASS. The bare `npm.cmd` + `UseShellExecute=false` combination is gone; the fix uses `cmd.exe /d /s /c "npm run dev:local >> <log> 2>&1"` (ComSpec), which reproducibly starts the dev server (the previously failing npm-prefix `MODULE_NOT_FOUND` no longer occurs).
4. **stdout/stderr lifecycle** — PASS. After the launcher exited, the dev server kept serving `/api/health` 200 and `server.log` kept growing (2,242 → 2,310 bytes across two samples taken after exe exit): no pipe break, no block.
5. **Already-healthy state** — PASS. With the server running, a second exe run exited in 196 ms, the Node process count stayed 7 → 7 (no second Node/Next instance), and health remained 200.
6. **Failure UX** — PASS (code inspection; the interactive MessageBox cannot be clicked by automation). The Chinese MessageBox + log-path contract is preserved in both failure branches (`StartServer` exception: "无法启动 IELTS Writing Coach 服务。\n\n日志路径：…" and timeout: "IELTS Writing Coach 服务未能及时启动，请查看日志：…"); no stack is shown.
7. **Runs** — PASS. Launcher targeted tests 4/4 (fresh build via `scripts/build-launcher.ps1` + AppRoot assertion), `npm run typecheck` clean, `git diff --check` clean.

## Regression notes (L-01 scope)

- Launcher targeted (`tests/unit/launcher-build.test.ts`): 4/4.
- Launcher build: fresh `dist\IELTS Writing Coach.exe` built via the system `csc.exe`; PE subsystem = 2 (Windows GUI, no console).
- typecheck, `git diff --check`: passed.
- No other Phase 3.5 item was re-run this round (out of narrow scope); the previous full regression (Phase 3.5 targeted 61/61, Phase 3 67/67, Phase 2 25/25, Phase 1 8/8, full Vitest 197/197, Playwright 15/15 across 3 cold rounds, coverage 86.63/75.71/91.02/94.46, audit 0) stands from round 1.

## Final status

- **Phase 3.5 Test Acceptance Passed — awaiting Human Smoke Test.**
- The final Phase 3.5 gate remains the 总指挥's Human Smoke Test (double-click `dist\IELTS Writing Coach.exe` → `http://ieltswriting.localhost:3000` → upload a Task 1 image → write 150+ words → click 获取反馈; the only real-OpenAI step, with cost awareness). Test AI does not perform it.
- Do not begin Phase 4 until commanded.
