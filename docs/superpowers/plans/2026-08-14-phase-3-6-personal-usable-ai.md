# Phase 3.6 Personal Usable AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 让总指挥无需终端或配置文件，即可在本机 UI 配置自己的 Provider/API Key，分别验证并选择题图识别与作文反馈模型，完成一次真实 IELTS Academic Task 1 识图、写作和非官方反馈。

**Architecture:** 保留 Phase 3 的 TaskContextLLMPort 与 Phase 3.5 的 EssayFeedbackLLMPort。新增 server-only Secret Store、连接/目录/验证/角色选择层，通过 RoleBindingResolver + ProviderRegistry 根据冻结 invocation snapshot 创建具体 Provider adapter；不建立通用 generate 接口，不改变已 Accepted 的业务 Port、Schema、调用预算和错误 owner。

**Tech Stack:** Next.js App Router、TypeScript、Zod、Drizzle ORM、SQLite、Node.js server runtime、Windows Credential Manager Node-API bridge、Vitest、Playwright。

## Global Constraints

- 实施依据为 docs/PHASE_3_6_ARCHITECTURE_DELTA.md、docs/ARCHITECTURE.md §4.12 和当前 branch 代码。
- Provider 仅限 OPENAI、GEMINI、ANTHROPIC、OPENAI_COMPATIBLE；角色仅限 TASK_CONTEXT、ESSAY_FEEDBACK。
- Personal MVP 仅面向总指挥本人、当前 Windows 用户与可信本机；server 只监听 127.0.0.1。
- Credential 只进入同源 PUT request body、server memory 与 Windows Credential Manager；不得进入 SQLite、浏览器持久存储、GET DTO、日志、测试 snapshot 或进程命令行。
- 默认配置源为 UI；ENV_DEV 只有显式开发配置时可用，不能静默接管 UI 配置。
- 所有自动化测试必须 fake/offline；真实 Provider 调用只允许在总指挥明确授权的最终 Human Smoke Test。
- 禁止自动 fallback、费用统计、模型市场、realtime Coach、Student Memory、formal Assessment、Task 2、Teacher KB 与 Phase 4。
- 禁止 LocalSessionGate、named pipe bootstrap、current-SID verification、PID↔listener binding、跨 Windows 用户隔离、port squatting、fake pipe、fake health 与第二 Windows 用户攻击测试。
- Pre-release Hardening 不属于本计划的实现或验收门禁。

## Dependency Order

    Gate 1: DTO/Migration/SecretStore + Credential Manager clean-machine spike
      -> Task 2: Connection/Secret/API
      -> Task 3: Catalog/Verification/Paid Probe
      -> Task 4: ProviderRegistry/RoleBindingResolver
      -> Task 5: Provider Adapters
      -> Task 6: Settings UI
      -> Task 7: Task/Feedback Snapshot + AI-ready Gate
      -> Task 8: Full Offline Regression
      -> Human Smoke Test

---

### Task 1: DTO、状态、Additive Migration、SecretStorePort 与首个实现 Gate

**Files:**

- Create: src/domain/ai/provider.schema.ts
- Create: src/domain/ai/verification.schema.ts
- Create: src/domain/ai/fingerprint.ts
- Create: src/domain/ai/ai-error.ts
- Create: src/domain/ai/invocation-snapshot.schema.ts
- Create: src/ports/secret-store.port.ts
- Create: src/testing/fake-secret-store.ts
- Modify: src/infrastructure/database/schema.ts
- Generate: next Drizzle migration plus meta snapshot/journal
- Create: native/credential-manager/binding.gyp
- Create: native/credential-manager/credential_manager.cc
- Create: scripts/spikes/credential-manager-clean-machine.ps1
- Test: tests/unit/ai-contracts.test.ts
- Test: tests/unit/secret-store.contract.test.ts
- Modify: tests/integration/database-migration.test.ts

**Interfaces:**

- Produces ProviderKind, AiRole, CapabilityState, VerificationState, VerificationFingerprint and InvocationSnapshot.
- SecretStorePort exposes put/read/delete and returns opaque secretRef values.
- InvocationSnapshot contains providerKind, connectionId, configRevision, normalizedEndpoint, secretRevision, secretRef, requestedModelId, role, verificationId, verificationFingerprint, canonicalSchemaVersion, promptVersion, fixtureVersion, adapterContractVersion and invocationFingerprint.
- VerificationFingerprint contains providerKind, normalizedEndpoint, configRevision, secretRevision, modelId, role, canonicalSchemaVersion, probePromptVersion, probeFixtureVersion and adapterContractVersion.

- [ ] **Step 1: Write contract tests and observe RED**

  Assert exact Provider/role enums, deterministic fingerprints, strict snapshot parsing, rejected unknown configuration sources and fake SecretStore read/write/delete behavior.

    npm test -- --run tests/unit/ai-contracts.test.ts tests/unit/secret-store.contract.test.ts

- [ ] **Step 2: Implement minimum contracts**

  Keep secretRef opaque. Do not expose Provider, endpoint or secret types through TaskContextLLMPort or EssayFeedbackLLMPort.

- [ ] **Step 3: Define the complete additive schema and generate migration**

  Add ai_provider_connections, ai_probe_requests, ai_model_verifications and ai_role_selections. Add Provider/connection/secret revision/model/verification/adapter/invocation snapshot columns to task_context_attempts, plus sourceAttemptId and Provider/verification traceability to task_context_versions. Existing rows remain readable through nullable fields or safe defaults. Never store Key, prompt, image, essay or raw Provider response.

    npm run db:generate
    npm test -- --run tests/integration/database-migration.test.ts

- [ ] **Step 4: Implement the first-party Node-API bridge**

  Use CRED_TYPE_GENERIC + CRED_PERSIST_LOCAL_MACHINE with CredWriteW, CredReadW and CredDeleteW. Do not use machine-scope DPAPI, PasswordVault, plaintext SQLite, JSON or env fallback.

- [ ] **Step 5: Execute the clean-machine feasibility spike**

  On a clean Windows machine, build the bridge; write/read/delete a generated test credential; restart the Node process and read it again under the same interactive user. Confirm no secret appears in files, SQLite, logs or command line. Do not perform a second-user attack test and do not call a Provider.

- [ ] **Step 6: Apply Gate 1**

  PASS only if clean-machine build plus write/read/delete/restart-read succeeds. On failure, stop Phase 3.6 and report the blocker; do not proceed to Task 2 or add a fallback secret store.

- [ ] **Step 7: Commit**

    git add src/domain/ai src/ports/secret-store.port.ts src/testing/fake-secret-store.ts src/infrastructure/database/schema.ts src/infrastructure/database/migrations native/credential-manager scripts/spikes tests/unit/ai-contracts.test.ts tests/unit/secret-store.contract.test.ts tests/integration/database-migration.test.ts
    git commit -m "feat: establish phase 3.6 credential and data contracts"

**Completion:** Gate 1 evidence exists, migration upgrade passes, fake SecretStore contract passes, and no later task started before the gate result.

---

### Task 2: Server-only Connection Repository、Credential Rotation、配置源与安全 API

**Files:**

- Create: src/application/ai/ai-settings.repository.ts
- Create: src/application/ai/connection-service.ts
- Create: src/infrastructure/storage/drizzle-ai-settings.repository.ts
- Create: src/infrastructure/secrets/windows-credential-manager.adapter.ts
- Create: src/infrastructure/ai/config-source.ts
- Create: src/presentation/ai/request-origin.ts
- Create: src/presentation/ai/ai-settings-route-handlers.ts
- Create: app/api/ai/settings/route.ts
- Create: app/api/ai/connections/[providerKind]/route.ts
- Modify: .env.example
- Test: tests/unit/ai-connection-service.test.ts
- Test: tests/unit/ai-settings-api.test.ts
- Test: tests/unit/request-origin.test.ts

**Interfaces:**

- AiSettingsRepository persists non-secret metadata and opaque secretRef only.
- GET settings returns configurationSource, non-secret connection summaries, keyConfigured/keyStatus, verification summaries, role selections and last-success metadata.
- ConnectionService owns versioned credential rotation and cleanup state.

- [ ] **Step 1: Write RED tests for create, update, rotate and delete**

  Cover first Key required, omitted replacement Key preserving current secret, empty Key rejected, database switch failure deleting the new credential, active attempt/probe delaying old cleanup and cleanup failure preserving the current valid configuration.

- [ ] **Step 2: Implement repository and versioned rotation**

  Write the new credential first, transactionally switch secretRef/secretRevision/configRevision, then clean the old credential only after no unfinished attempt or live CLAIMED probe references it.

- [ ] **Step 3: Implement configuration-source tests and behavior**

  Default and Launcher behavior is UI. Only explicit AI_CONFIG_SOURCE=ENV_DEV enables the existing OpenAI env path. Unknown values fail closed. UI failures never switch source.

- [ ] **Step 4: Implement settings and connection routes**

  GET is no-store and side-effect free. PUT/DELETE run in Node runtime, do not log bodies and never return Key or secretRef.

- [ ] **Step 5: Add Personal MVP request protection**

  Unsafe methods require expected local Host, exact Origin, JSON where applicable and the basic CSRF contract. Do not add LocalSessionGate, cookies, named pipes or bootstrap exchange.

- [ ] **Step 6: Verify and commit**

    npm test -- --run tests/unit/ai-connection-service.test.ts tests/unit/ai-settings-api.test.ts tests/unit/request-origin.test.ts
    npm run typecheck
    git add src/application/ai src/infrastructure/storage/drizzle-ai-settings.repository.ts src/infrastructure/secrets src/infrastructure/ai/config-source.ts src/presentation/ai app/api/ai .env.example tests/unit/ai-connection-service.test.ts tests/unit/ai-settings-api.test.ts tests/unit/request-origin.test.ts
    git commit -m "feat: add secure local AI connections"

**Completion:** Secrets stay server-only, UI is the fail-closed default, settings APIs are safe, and this task performs zero inference.

---

### Task 3: Catalog、Capability、Verification、Role Selection 与 Paid Probe

**Files:**

- Create: src/application/ai/model-catalog.service.ts
- Create: src/application/ai/model-verification.service.ts
- Create: src/application/ai/role-selection.service.ts
- Create: src/application/ai/paid-probe.service.ts
- Create: src/infrastructure/ai/known-model-catalog.ts
- Create: src/infrastructure/ai/fake-provider-driver.ts
- Create: src/presentation/ai/model-route-handlers.ts
- Create: app/api/ai/connections/[providerKind]/models/route.ts
- Create: app/api/ai/connections/[providerKind]/test/route.ts
- Create: app/api/ai/model-verifications/route.ts
- Create: app/api/ai/role-selections/[role]/route.ts
- Test: tests/unit/model-catalog.service.test.ts
- Test: tests/unit/model-verification.service.test.ts
- Test: tests/unit/paid-probe-idempotency.test.ts
- Test: tests/unit/role-selection.service.test.ts

**Interfaces:**

- Verification transitions are UNVERIFIED -> VERIFYING -> VERIFIED | FAILED | INCOMPATIBLE.
- STALE is fingerprint-derived; INDETERMINATE represents unknown completion after restart/lease loss.
- Each result dimension is PASS | FAIL | NOT_TESTED | UNKNOWN.

- [ ] **Step 1: Write RED state and capability tests**

  Assert SUPPORTED/UNSUPPORTED/UNKNOWN, separate role verification, stale fingerprints, INDETERMINATE recovery and verified-only role dropdown eligibility.

- [ ] **Step 2: Implement the small versioned known catalog**

  For each official Provider include only exact stable/pinned candidates with catalogVersion, reviewedAt and evidenceUrl supported by official evidence on implementation day. Leave a list empty if evidence is insufficient; never use preview/latest or infer from model names.

- [ ] **Step 3: Implement connection-test semantics with fake drivers**

  Official Providers only call authenticated model list/get and perform zero inference. Custom calls /models first; only explicit 404/405 or valid not-implemented may proceed to one paid structured-text request after consent. Auth, permission, DNS/TLS, timeout, 429, 5xx and invalid responses end without inference fallback.

- [ ] **Step 4: Implement requestId idempotency and live-claim concurrency**

  Persist and claim before inference. Same requestId + same fingerprint returns the stored result; different parameters return AI_IDEMPOTENCY_CONFLICT. Another live request for the same operation returns AI_PROBE_IN_PROGRESS. Unknown exit becomes INDETERMINATE and never retries automatically.

- [ ] **Step 5: Implement role verification and selection**

  TASK_CONTEXT uses the fixed small PNG, real Task Context schema and local validation. ESSAY_FEEDBACK uses a fixed synthetic essay, real feedback schema and Zod. Selection accepts only exact current-fingerprint VERIFIED for that role.

- [ ] **Step 6: Verify and commit**

    npm test -- --run tests/unit/model-catalog.service.test.ts tests/unit/model-verification.service.test.ts tests/unit/paid-probe-idempotency.test.ts tests/unit/role-selection.service.test.ts
    git add src/application/ai src/infrastructure/ai src/presentation/ai app/api/ai tests/unit/model-catalog.service.test.ts tests/unit/model-verification.service.test.ts tests/unit/paid-probe-idempotency.test.ts tests/unit/role-selection.service.test.ts
    git commit -m "feat: add model verification and paid probe controls"

**Completion:** Verification and paid-probe semantics are proven with fakes, one role never authorizes another, and no Provider network call occurs.

---

### Task 4: ProviderRegistry 与 RoleBindingResolver

**Files:**

- Create: src/application/ai/role-binding-resolver.ts
- Create: src/infrastructure/llm/provider-driver.ts
- Create: src/infrastructure/llm/provider-registry.ts
- Create: src/testing/fake-provider-registry.ts
- Test: tests/unit/role-binding-resolver.test.ts
- Test: tests/unit/provider-registry.test.ts

**Interfaces:**

- ProviderDriver exposes testConnection, listModels, verifyRole, createTaskContextPort and createEssayFeedbackPort; it has no generic generate method.
- RoleBindingResolver.resolve(role, now) returns an immutable InvocationSnapshot or Provider-agnostic AI_NOT_READY.
- ProviderRegistry creates only TaskContextLLMPort or EssayFeedbackLLMPort from a frozen snapshot.

- [ ] **Step 1: Write RED resolver tests**

  Current VERIFIED selection succeeds; missing selection, stale verification, wrong role and unavailable secret fail before adapter creation.

- [ ] **Step 2: Write RED no-fallback tests**

  Another Provider, another model, ENV_DEV and last-success are never consulted when the current UI selection is not ready.

- [ ] **Step 3: Implement resolver and registry**

  Keep Provider/endpoint/secret knowledge outside the two business Ports. Registry factories are keyed only by the four frozen Provider kinds.

- [ ] **Step 4: Prove Port zero-change and commit**

    git diff --exit-code -- src/ports/llm.port.ts src/ports/task-context-llm.port.ts src/ports/essay-feedback-llm.port.ts
    npm test -- --run tests/unit/port-contracts.test.ts tests/unit/role-binding-resolver.test.ts tests/unit/provider-registry.test.ts
    git add src/application/ai/role-binding-resolver.ts src/infrastructure/llm/provider-driver.ts src/infrastructure/llm/provider-registry.ts src/testing/fake-provider-registry.ts tests/unit/role-binding-resolver.test.ts tests/unit/provider-registry.test.ts
    git commit -m "feat: resolve verified AI role bindings"

**Completion:** Registry/resolver work with fakes, introduce no general AI gateway and leave all existing LLM Port files unchanged.

---

### Task 5: 四类 Provider Adapter 与 Offline Contract Tests

**Files:**

- Modify internally: src/infrastructure/llm/openai-task-context.adapter.ts
- Modify internally: src/infrastructure/llm/openai-essay-feedback.adapter.ts
- Create: src/infrastructure/llm/provider-failure.ts
- Create: src/infrastructure/llm/provider-schema-projection.ts
- Create: src/infrastructure/llm/gemini-task-context.adapter.ts
- Create: src/infrastructure/llm/gemini-essay-feedback.adapter.ts
- Create: src/infrastructure/llm/anthropic-task-context.adapter.ts
- Create: src/infrastructure/llm/anthropic-essay-feedback.adapter.ts
- Create: src/infrastructure/llm/openai-compatible-task-context.adapter.ts
- Create: src/infrastructure/llm/openai-compatible-essay-feedback.adapter.ts
- Create: Provider-private transport modules under src/infrastructure/llm/providers/
- Test: tests/unit/provider-adapter.contract.test.ts
- Test: Provider-specific adapter tests under tests/unit/

**Reuse:** Reuse existing canonical schemas, OpenAI Responses request encoding, refusal/incomplete handling, local Zod/domain validation and existing failure owner. Refactor only transport construction and secret/model injection required by snapshots.

- [ ] **Step 1: Write shared offline contract tests**

  Cover exactly one transport call, explicit timeout, no redirects, image encoding, schema projection, refusal/safety, incomplete/max-token, timeout/network, auth/permission, transient rate limit, hard quota, model missing, unsupported schema, invalid JSON and valid output.

- [ ] **Step 2: Refactor OpenAI internals without changing accepted behavior**

  Inject snapshot/client/secret rather than reading env in UI mode. Keep env construction only behind explicit ENV_DEV.

- [ ] **Step 3: Implement Gemini adapters**

  Use inline image bytes, project const to type plus single-value enum, retain local UUID validation and configure one attempt/no SDK retry.

- [ ] **Step 4: Implement Anthropic adapters**

  Use Base64 image content, output_config.format and machine-readable refusal/stop/max-token handling. Model metadata remains basic evidence only.

- [ ] **Step 5: Implement narrow OpenAI-compatible adapters**

  Support only POST normalizedBaseUrl/responses and optional GET normalizedBaseUrl/models. Reject URL credentials/query/fragment/dot segments, redirects, metadata/link-local/private non-loopback destinations and DNS rebinding. Do not add Chat Completions, prompt-only JSON, custom headers or vendor patches.

- [ ] **Step 6: Verify offline and commit**

    npm test -- --run tests/unit/provider-adapter.contract.test.ts tests/unit/openai-task-context.adapter.test.ts tests/unit/openai-essay-feedback.adapter.test.ts
    npm run typecheck
    git add src/infrastructure/llm tests/unit/provider-adapter.contract.test.ts tests/unit/*adapter*.test.ts
    git commit -m "feat: add phase 3.6 provider adapters"

**Completion:** All Provider × role adapters pass fake transport contracts, retries are disabled and existing business Ports/Schemas remain intact.

---

### Task 6: Settings API/UI 与现有页面接入

**Files:**

- Create: src/presentation/ai/settings.types.ts
- Create: src/presentation/ai/ai-settings-panel.tsx
- Create: src/presentation/ai/model-verification-panel.tsx
- Create: app/settings/page.tsx
- Modify: app/page.tsx
- Modify: src/presentation/task-intake/task-intake-form.tsx
- Modify: src/presentation/task-intake/task-context-status.tsx
- Modify: src/presentation/writing/writing-workspace.tsx
- Modify: src/presentation/writing/feedback-panel.tsx
- Test: tests/unit/ai-settings-panel.test.tsx
- Test: tests/unit/model-verification-panel.test.tsx
- Create: tests/e2e/phase-3-6-settings.spec.ts

**Interfaces:** UI consumes safe API DTOs only. SecretStorePort, Provider SDK, secretRef and API Key never enter React props or the browser bundle.

- [ ] **Step 1: Write RED component tests**

  Verify password input, clearing after successful PUT, no Key echo, keyConfigured-only state, UI/ENV_DEV source display and stable error recovery.

- [ ] **Step 2: Implement settings page and navigation**

  Display connection status, verification dimensions and role selection without altering editor/autosave behavior.

- [ ] **Step 3: Implement distinct connection and paid-verification controls**

  Require explicit possible-charge consent for any inference-capable action, generate requestId, disable the running button and show only stable safe errors.

- [ ] **Step 4: Implement verified-only selectors**

  Exclude UNKNOWN, UNVERIFIED, VERIFYING, FAILED, INCOMPATIBLE, STALE and INDETERMINATE. Never select or fall back automatically.

- [ ] **Step 5: Apply approved layout delta**

  Reorganize upload UI into vertical groups and make the smallest approved Version 1 alignment in Writing Workspace. Preserve Task Context status, editor, timer, autosave and non-official feedback.

- [ ] **Step 6: Verify with fake E2E and commit**

    npm test -- --run tests/unit/ai-settings-panel.test.tsx tests/unit/model-verification-panel.test.tsx tests/unit/task-intake-form.test.tsx tests/unit/writing-workspace.test.tsx
    npm run test:e2e
    git add app/page.tsx app/settings src/presentation/ai src/presentation/task-intake src/presentation/writing tests/unit/ai-settings-panel.test.tsx tests/unit/model-verification-panel.test.tsx tests/e2e/phase-3-6-settings.spec.ts
    git commit -m "feat: add personal AI settings experience"

**Completion:** UI configures/verifies models without exposing secrets or hidden inference; existing upload/writing/feedback paths remain usable.

---

### Task 7: Task Context / Feedback Snapshot 与 AI-ready Gate

**Files:**

- Modify: src/application/task-intake/create-task-intake.ts
- Modify: src/application/task-intake/retry-task-intake.ts
- Modify: src/application/task-intake/process-task-context.ts
- Modify: src/application/request-essay-feedback.ts
- Modify: src/application/task-intake/task-intake.repository.ts
- Modify: src/infrastructure/storage/drizzle-task-intake.repository.ts
- Modify: src/infrastructure/database/repository-factory.ts
- Modify: src/presentation/task-intake/task-intake-route-handlers.ts
- Modify: src/presentation/writing/feedback-route-handlers.ts
- Modify: app/api/task-intakes/route.ts
- Modify: app/api/task-intakes/[taskId]/route.ts
- Modify: app/api/essays/[sessionId]/feedback/route.ts
- Test: tests/unit/task-context-invocation-snapshot.test.ts
- Test: tests/unit/feedback-ai-ready.test.ts
- Test: tests/unit/task-intake-ai-ready.test.ts
- Test: tests/unit/provider-rotation-concurrency.test.ts
- Modify: tests/unit/process-task-context.test.ts
- Modify: tests/unit/request-essay-feedback.test.ts

- [ ] **Step 1: Write RED Task Context readiness tests**

  Enforce file/form validation -> resolve TASK_CONTEXT -> Blob/attempt/job. Not ready returns 409 TASK_CONTEXT_AI_NOT_READY before Blob write, attempt creation or queueing.

- [ ] **Step 2: Persist Task Context snapshot atomically**

  Read current selection/connection revision and create the attempt in one SQLite transaction. Persist all snapshot fields and invocationFingerprint. Retry creates a new attempt from the then-current verified selection.

- [ ] **Step 3: Build the job adapter lazily from stored snapshot**

  Never re-read current selection. Adapter/secret construction failure must return within executeTaskContext using existing failure codes. Keep the existing two-call application budget and non-authoritative JobPort.

- [ ] **Step 4: Write RED Feedback precedence/readiness tests**

  Preserve ESSAY_NOT_FOUND -> TASK_CONTEXT_PENDING/TASK_CONTEXT_UNAVAILABLE -> AI-ready -> LLM. Not ready returns 409 FEEDBACK_AI_NOT_READY with the existing Phase 3.5 envelope and cannot override prior 404/409/422.

- [ ] **Step 5: Freeze Feedback snapshot in server memory**

  Atomically read selection, verification, endpoint, model and secret at request start. Setting changes affect only the next request. Keep feedback non-persistent. Update lastSuccessfulSnapshot only on matching fingerprint; a conditional miss cannot fail successful feedback.

- [ ] **Step 6: Test rotation/deletion/concurrency**

  Cover both transaction orderings, old credential retention during active attempt/probe, no dangling reference, next-request-only changes and no fallback.

- [ ] **Step 7: Run Phase 3/3.5 regression and commit**

    npm test -- --run tests/unit/process-task-context.test.ts tests/unit/request-essay-feedback.test.ts tests/unit/task-intake-api.test.ts tests/unit/feedback-api.test.ts tests/unit/openai-task-context.adapter.test.ts tests/unit/openai-essay-feedback.adapter.test.ts
    npm run typecheck
    git add src/application src/infrastructure/storage/drizzle-task-intake.repository.ts src/infrastructure/database/repository-factory.ts src/presentation app/api/task-intakes app/api/essays tests/unit
    git commit -m "feat: bind AI calls to verified snapshots"

**Completion:** Task Context uses a persistent attempt snapshot, Feedback uses an in-memory request snapshot, existing Ports remain unchanged and both paths fail before any paid call when not ready.

---

### Task 8: 全量 Offline Gate、Test AI 交接与 Human Smoke

**Files:**

- Create: tests/integration/ai-settings-migration.test.ts
- Create: tests/integration/ai-provider-boundary.test.ts
- Create: tests/e2e/phase-3-6-personal-mvp.spec.ts
- Test AI deliverable: docs/PHASE_3_6_ACCEPTANCE_REPORT.md
- Do not create or modify Pre-release Hardening implementation/test files.

- [ ] **Step 1: Add an outbound-network guard**

  Automated Provider tests fail on unstubbed network. Credential unit/integration tests use a fake; only the separate Gate 1 spike uses real Credential Manager.

- [ ] **Step 2: Run security and leak checks**

  Verify Key absence from SQLite, browser storage, JSON, GET/error responses, logs, test snapshots and command line. Verify secret-store unavailable fail-closed, loopback/no-CORS/no-store and basic same-origin/CSRF. Do not run second-user/pipe/PID/listener/port-squatting/fake-health tests.

- [ ] **Step 3: Run cost/concurrency checks**

  Prove GET/load/save/list/select and official connection tests produce zero inference. Prove one inference per requestId, one live claim per operation fingerprint, no SDK retry, no automatic fallback and no background validation.

- [ ] **Step 4: Run Provider boundary checks**

  Cover four Provider kinds, both roles, schema projection, failure classification, Custom fail-closed, unknown model exclusion, stale verification and UI/ENV_DEV separation entirely with fakes.

- [ ] **Step 5: Run all gates**

    npm run typecheck
    npm run lint
    npm test -- --run
    npm run test:e2e
    npm run build
    npm run db:migrate
    npm audit --omit=dev
    git diff --check

  Phase 1/2/3/3.5 regressions must pass; no command may contact a Provider.

- [ ] **Step 6: Hand off to Test AI**

  Test AI independently verifies architecture §13 and records docs/PHASE_3_6_ACCEPTANCE_REPORT.md. Programmer results are evidence, not acceptance.

- [ ] **Step 7: Prepare but do not execute Human Smoke**

  After offline gates and Test Acceptance, total commander may explicitly authorize: configure one Provider/API Key in UI; run connection test; separately consent to TASK_CONTEXT and ESSAY_FEEDBACK verification; select roles; upload a real Task 1 image; write; request non-official feedback. Record Provider/model/role/requestId/call counts/stable results, never Key/raw image/full essay.

- [ ] **Step 8: Stop before live call**

  Automated implementation ends here. Real Provider use occurs only through the authorized Human Smoke Test.

**Completion:** Full offline regression and independent Test Acceptance pass, no live Provider was called automatically, and Human Smoke is the only remaining live action.

## Reuse Matrix

| Existing Accepted capability | Phase 3.6 treatment |
|---|---|
| TaskContextLLMPort and Task Context schemas | Reuse unchanged |
| Phase 3 attempt claim, two-call budget, repair and terminal ownership | Reuse; add frozen invocation columns only |
| Task image Blob and Task Context versioning | Reuse; add AI-ready check before Blob/attempt |
| EssayFeedbackLLMPort and Essay Feedback schema | Reuse unchanged |
| Phase 3.5 validation and 404/409/422/502/503 semantics | Reuse; add FEEDBACK_AI_NOT_READY after existing context checks |
| Existing OpenAI adapters | Reuse request/schema/error behavior; refactor secret/model construction only |
| Writing editor, timer and autosave | Reuse unchanged |
| Launcher health/start behavior | Reuse unchanged; no LocalSessionGate or IPC |
| Existing env OpenAI path | Preserve only as explicit ENV_DEV |

## Final Self-Review

- §12 steps 1–8 map exactly to Tasks 1–8.
- Credential Manager clean-machine feasibility is the first implementation gate; failure stops all later work.
- Verification/paid-probe behavior is proven with fakes before Provider adapters are wired.
- Provider adapters depend on Registry/Resolver; UI depends on connection/catalog/verification; invocation snapshots are integrated only after those layers exist.
- All automated tests are fake/offline; real Provider use is reserved for Human Smoke.
- No Pre-release Hardening work appears in implementation tasks or gates.
- No realtime Coach, Student Memory, formal Assessment, Task 2, Teacher KB, automatic fallback, fee statistics or Phase 4 work is included.
- Existing architecture contracts are implemented, not redesigned.

Plan execution must not begin until the total commander approves this document.
