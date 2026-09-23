# MiMo v2.5 Working MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the narrow real-user loop “upload IELTS Academic Task 1 image → MiMo v2.5 Task Context → existing editor/autosave → MiMo v2.5 non-official Essay Feedback” without continuing the paused Phase 3.6 Provider platform.

**Architecture:** Keep the accepted `TaskContextLLMPort`, `EssayFeedbackLLMPort`, Task Context processor, editor/autosave, feedback use case and their domain schemas unchanged. Add one server-only MiMo configuration/client boundary and two thin MiMo adapters. Configuration is local environment input only; no settings UI or credential persistence is introduced.

**Tech Stack:** Next.js 16 Node runtime, TypeScript 6, native `fetch`, Zod 4, Vitest, Playwright, existing SQLite/blob/autosave implementation, Xiaomi MiMo v2.5 OpenAI-compatible API.

## Global Constraints

- The full Phase 3.6 Provider platform is paused. Preserve all uncommitted Task 1 files and the Credential Manager blocker; never reset, clean, stash or overwrite them.
- Do not implement Credential Manager, multi-Provider abstractions, Gemini, Anthropic, Custom Provider, model catalog, capability verification, Provider marketplace or Pre-release Hardening.
- Do not modify the existing `TaskContextLLMPort` or `EssayFeedbackLLMPort` contracts and do not rewrite accepted editor/autosave or application orchestration.
- MiMo credentials remain in a git-ignored local `.env`; the browser, response DTOs, application logs, test evidence and committed files must never contain the API key.
- `MIMO_API_KEY`, `MIMO_BASE_URL` and `MIMO_MODEL` have no guessed production defaults. The operator copies the exact values shown by the MiMo console into `.env`.
- Xiaomi's public platform currently states that V2.5 includes a multimodal lineup and uses an API Key/Base URL configuration. Exact account-visible model ID and endpoint are therefore runtime inputs, and Gate B is the binding feasibility proof.
- Gates are strictly ordered A → B → C → D → E. Before each implementation step, its executable validation command and expected result must be recorded in CHANGELOG. A failed gate stops execution immediately; no later gate may begin or depend on unverified work.
- Gates B and D are the only scripted real Provider probes and each performs exactly one MiMo request per run. They require total-commander approval and a configured paid account. Automated regression remains fake/offline.
- Gate E is a Human Smoke Test performed through the actual launcher/browser flow. Programmer self-test does not replace the final Test AI independent acceptance after Gate E.
- Evidence may contain timestamp, gate, pass/fail, configured model ID, response ID/hash, schema version, HTTP classification and call count. It must not contain the key, Authorization header, raw image, full prompt, full essay or raw Provider response.

## Reuse Map

| Working MVP need | Reuse without rewrite |
|---|---|
| Task upload/blob/attempt lifecycle | `create-task-intake`, `process-task-context`, repositories and local job adapter from Phase 3 |
| Task Context validation/publication | Existing Task Context Zod/domain validation and two-call application budget from Phase 3 |
| Writing workspace | Accepted Phase 3.5 editor, timer, word count and routing |
| Autosave | Accepted `autosave-controller` and draft mutation/revision persistence |
| Feedback request/result | Existing `requestEssayFeedback`, `EssayFeedbackLLMPort`, feedback schema, route and panel |
| Stable degraded behavior | Existing seven LLM failure codes and current HTTP/UI mappings |

---

### Gate A: Server-only MiMo Configuration and Secret Boundary

**Files:**

- Create: `src/infrastructure/llm/mimo-config.ts`
- Create: `src/infrastructure/llm/mimo-client.ts`
- Modify: `.env.example`
- Test: `tests/unit/mimo-config.test.ts`
- Test: `tests/unit/mimo-client.test.ts`
- Test: `tests/unit/mimo-secret-boundary.test.ts`

**Interfaces:**

- Produces: `loadMiMoConfig(env): Readonly<{ apiKey: string; baseUrl: string; model: string }>`.
- Produces: `MiMoClient.complete(request): Promise<{ responseId: string; finishReason: string | null; content: string | null }>`.
- `MiMoClient` accepts an injected `fetch` for offline tests; production construction is server-only.
- Later gates may use this client only after Gate A PASS.

- [ ] **Step 1: Record validation before implementation**

  Append the exact command and expected result to CHANGELOG:

  ```powershell
  node node_modules/vitest/vitest.mjs --run tests/unit/mimo-config.test.ts tests/unit/mimo-client.test.ts tests/unit/mimo-secret-boundary.test.ts
  ```

  Expected: tests prove fail-closed missing/invalid env, exact configured values, one Authorization header only at the outbound MiMo request, sanitized errors, and no key in browser-facing/static artifacts or captured logs.

- [ ] **Step 2: Write tests and observe RED**

  Use the literal sentinel `mimo-secret-must-never-reach-browser-7f31` only in test process memory. Assert:

  ```ts
  expect(() => loadMiMoConfig({})).toThrow("MIMO_CONFIGURATION_MISSING");
  expect(() => loadMiMoConfig({ MIMO_API_KEY: "x", MIMO_BASE_URL: "http://remote.example", MIMO_MODEL: "m" })).toThrow("MIMO_CONFIGURATION_INVALID");
  expect(capturedRequest.headers.authorization).toBe("Bearer test-key");
  expect(JSON.stringify(capturedLogs)).not.toContain("test-key");
  expect(browserStaticArtifacts).not.toContain("mimo-secret-must-never-reach-browser-7f31");
  ```

- [ ] **Step 3: Implement the minimum server-only boundary**

  `.env.example` contains empty, non-secret placeholders:

  ```dotenv
  MIMO_API_KEY=
  MIMO_BASE_URL=
  MIMO_MODEL=
  ```

  `loadMiMoConfig` rejects missing values, URL credentials, query, fragment and non-HTTPS remote URLs. The client posts only to the configured Base URL's fixed OpenAI-compatible chat-completions path, uses `Authorization: Bearer`, disables redirects, applies an explicit timeout, and maps errors without response bodies or headers.

- [ ] **Step 4: Run Gate A verification**

  Run the Step 1 command plus:

  ```powershell
  git grep -n "MIMO_API_KEY" -- app src | Select-String -NotMatch "mimo-config.ts"
  git diff --check
  ```

  PASS requires all tests green, no client/UI import of the key reader, no secret sentinel in browser artifacts/log captures, and diff check exit 0. Otherwise stop.

---

### Gate B: Real MiMo Task 1 Image → Existing Task Context Schema

**Files:**

- Create: `src/infrastructure/llm/mimo-task-context.adapter.ts`
- Modify: `src/infrastructure/database/repository-factory.ts`
- Create: `scripts/spikes/mimo-task-context-gate.ts`
- Test: `tests/unit/mimo-task-context.adapter.test.ts`
- Evidence: `docs/evidence/working-mvp/gate-b-task-context.md`

**Interfaces:**

- Consumes: verified Gate A `MiMoClient` and unchanged `TaskContextLLMPort`.
- Produces: `MiMoTaskContextAdapter implements TaskContextLLMPort`.
- Uses fixed test image `数据/剑雅作文材料/图片/C20-T1-T1.jpg` and existing Task Context schema/domain parser.

- [ ] **Step 1: Record validation before implementation**

  Offline command:

  ```powershell
  node node_modules/vitest/vitest.mjs --run tests/unit/mimo-task-context.adapter.test.ts tests/unit/process-task-context.test.ts
  ```

  Real single-call command, executed only with explicit authorization and configured `.env`:

  ```powershell
  node --import tsx scripts/spikes/mimo-task-context-gate.ts
  ```

  Expected real output: `GATE_B=PASS`, `CALL_COUNT=1`, configured model ID, non-secret response ID hash and `TASK_CONTEXT_SCHEMA=PASS`.

- [ ] **Step 2: Write adapter tests and observe RED**

  Assert one request containing one text part and one Base64 image part, configured model, JSON-only instruction, no retry inside the adapter, successful JSON parsing, and mapping for timeout/network/malformed JSON/refusal-or-stop conditions into the existing seven codes.

- [ ] **Step 3: Implement the thin adapter and composition change**

  Encode local bytes as a data URL accepted by the configured MiMo OpenAI-compatible endpoint. Ask for JSON only and pass the decoded value to the existing processor; do not weaken or duplicate the Task Context schema. Replace only the production Task Context adapter construction in `repository-factory.ts`; preserve the job, attempt, retry budget and publication transaction.

- [ ] **Step 4: Pass offline verification before any real call**

  Run the offline command and `git diff --check`. Failure stops Gate B without a paid call.

- [ ] **Step 5: Execute exactly one real Gate B call**

  The spike loads the fixed image, calls the adapter once, parses the value through the existing Task Context schema/domain validation, and writes only the allowed evidence fields. It must not print raw request/response/image/key.

- [ ] **Step 6: Apply Gate B**

  PASS requires HTTP success, `CALL_COUNT=1`, valid JSON, full existing Task Context schema/domain validation and redacted evidence. Any API incompatibility, invalid structure, auth/network error or missing exact model/base configuration is Gate B FAIL; stop before Gate C.

---

### Gate C: Existing Editor and Autosave Regression

**Files:**

- Modify only if a regression is proven: existing editor/autosave composition files
- Test: existing `tests/unit/autosave-controller.test.ts`
- Test: existing writing workspace/API tests
- Test: existing `tests/e2e/writing-main-flow.spec.ts`
- Evidence: `docs/evidence/working-mvp/gate-c-editor-autosave.md`

**Interfaces:**

- Consumes: Gate B published Task Context through existing repositories/routes.
- Produces no new AI interface; this gate certifies the accepted editor/autosave remains usable.

- [ ] **Step 1: Record validation before implementation**

  ```powershell
  node node_modules/vitest/vitest.mjs --run tests/unit/autosave-controller.test.ts tests/unit/save-essay-draft.test.ts tests/unit/writing-api.test.ts tests/unit/writing-workspace.test.tsx
  npm run test:e2e -- tests/e2e/writing-main-flow.spec.ts
  ```

  Expected: editor loads, typed text survives autosave/reload, revision rules remain valid and no AI availability blocks editing.

- [ ] **Step 2: Run the existing regression without changing production code**

  If all checks pass, record Gate C PASS and make no editor/autosave changes. If a regression fails, stop, diagnose separately, define a new RED test before any minimal repair, and rerun the entire Gate C command. Never rewrite accepted behavior speculatively.

- [ ] **Step 3: Apply Gate C**

  PASS requires all listed unit/integration/UI checks green and evidence showing autosave persistence. Failure stops before Gate D.

---

### Gate D: Real Fixed Essay → Existing Essay Feedback Schema

**Files:**

- Create: `src/infrastructure/llm/mimo-essay-feedback.adapter.ts`
- Modify: `app/api/essays/[sessionId]/feedback/route.ts`
- Create: `scripts/spikes/mimo-essay-feedback-gate.ts`
- Test: `tests/unit/mimo-essay-feedback.adapter.test.ts`
- Test: existing `tests/unit/request-essay-feedback.test.ts`
- Evidence: `docs/evidence/working-mvp/gate-d-essay-feedback.md`

**Interfaces:**

- Consumes: verified Gate A `MiMoClient`, unchanged `EssayFeedbackLLMPort`, and Gate C editor persistence.
- Produces: `MiMoEssayFeedbackAdapter implements EssayFeedbackLLMPort`.
- Uses one fixed synthetic IELTS Task 1 essay of at least 150 words embedded in the spike, never a user's private essay.

- [ ] **Step 1: Record validation before implementation**

  Offline command:

  ```powershell
  node node_modules/vitest/vitest.mjs --run tests/unit/mimo-essay-feedback.adapter.test.ts tests/unit/request-essay-feedback.test.ts tests/unit/feedback-api.test.ts tests/unit/feedback-panel.test.tsx
  ```

  Real single-call command:

  ```powershell
  node --import tsx scripts/spikes/mimo-essay-feedback-gate.ts
  ```

  Expected real output: `GATE_D=PASS`, `CALL_COUNT=1`, configured model ID, response ID hash and `ESSAY_FEEDBACK_SCHEMA=PASS`.

- [ ] **Step 2: Write adapter tests and observe RED**

  Assert one text-only request, configured model, JSON-only instruction, no adapter retry, JSON decoding and existing seven-code error normalization. Validate successful fixtures with the real `essayFeedbackSchema`, not a duplicate schema.

- [ ] **Step 3: Implement the thin adapter and route composition**

  Construct the MiMo adapter server-side in the existing feedback route. Preserve `requestEssayFeedback` ordering, word-count warning, non-persistence of feedback content, stable error envelopes and “非官方估计” UI copy.

- [ ] **Step 4: Pass offline verification before any real call**

  Run the offline command and `git diff --check`. Failure stops Gate D without a paid call.

- [ ] **Step 5: Execute exactly one real Gate D call**

  The spike sends the fixed synthetic essay once, parses the result with the existing Essay Feedback schema and writes only allowed evidence metadata.

- [ ] **Step 6: Apply Gate D**

  PASS requires HTTP success, `CALL_COUNT=1`, valid JSON, full existing Essay Feedback schema validation and redacted evidence. Failure stops before Gate E.

---

### Gate E: Complete Human Smoke and Independent Acceptance Handoff

**Files:**

- Modify: `CHANGELOG.md` only for execution evidence/status
- Evidence: `docs/evidence/working-mvp/gate-e-human-smoke.md`

**Interfaces:**

- Consumes only Gate A–D verified results.
- Produces a Human Smoke conclusion and then a handoff package for Test AI independent acceptance.

- [ ] **Step 1: Record the Human Smoke procedure before execution**

  With the actual launcher and configured local `.env`, the human performs:

  1. Launch the application and open the real page.
  2. Upload `C20-T1-T1.jpg` through the UI.
  3. Wait for Task Context READY and visually confirm the displayed task information corresponds to the chart.
  4. Enter a real Task 1 essay, wait for autosave, reload and confirm the essay remains.
  5. Request feedback once and confirm the non-official feedback panel renders all required schema fields.
  6. Inspect browser DevTools network/storage and application console: no API key or Authorization value is visible or logged.

- [ ] **Step 2: Run pre-smoke automated regression**

  ```powershell
  npm run typecheck
  npm run lint
  node node_modules/vitest/vitest.mjs --run
  npm run test:e2e
  npm run build
  git diff --check
  ```

  All commands must exit 0 before the human begins. Provider adapter unit tests remain fake/offline; do not rerun paid Gate B/D probes merely as regression.

- [ ] **Step 3: Execute the Human Smoke**

  Record timestamps, configured model ID, Task Context outcome, autosave/reload outcome, feedback outcome, call counts and secret inspection outcome. Do not record raw image, essay, prompts, responses or credentials.

- [ ] **Step 4: Apply Gate E and stop**

  PASS requires the entire UI journey and secret inspection to succeed. Any failure is Gate E FAIL and must be logged without claiming Working MVP usability.

- [ ] **Step 5: Handoff to Test AI**

  Only after Gate E PASS, provide Test AI with Gate A–E evidence, changed-file inventory, test commands/results, known limitations and the explicit exclusion list. Programmer self-test and Human Smoke do not substitute for Test AI's independent stage acceptance. Stop and await that verdict.

## Completion Definition

The Working MVP is not “available” until Gate A, B, C, D and E all have actual PASS evidence and Test AI subsequently gives independent stage acceptance. A plan approval, compiled implementation, fake test pass or programmer claim alone is insufficient. The paused Phase 3.6 Credential Manager blocker remains unresolved and must not be described as fixed by this Working MVP.

## External Reference

- Xiaomi MiMo Open Platform: `https://platform.xiaomimimo.com/token-plan` (checked 2026-08-14; confirms the V2.5 text/multimodal lineup and operator-provided API Key/Base URL setup, but does not replace Gate B's account-specific endpoint/model feasibility proof).
