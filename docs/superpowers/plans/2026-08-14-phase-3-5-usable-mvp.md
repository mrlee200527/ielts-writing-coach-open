# Phase 3.5 — Usable MVP Implementation Plan

> 状态：**已获总指挥批准**（架构 AI 实现前复核通过，无 blocker，不再进行二轮 re-review）。
> 依据 `docs/PHASE_3_5_DESIGN.md` 与 `docs/ARCHITECTURE.md` §4.11 冻结契约；按本计划 Task 1→9 测试先行实现，不编码外内容。

## 1. 范围

- **做**：A. 一键启动器（C# 薄 exe + `/api/health`）；C. 一次性全文反馈（新 `EssayFeedbackLLMPort` + feedback 路由 + 右栏面板）；B. Human Smoke Test 说明与交接；配套 `.env.example`、`dev:local` 脚本。
- **不做**：sentence/paragraph realtime、Intervention Policy、Student Memory、教师知识库、反馈持久化/评分历史、`essay_assessments`、assessment 事件、Electron/安装器/hosts/代理、多用户、Phase 4。

## 2. 固定决策（含总指挥批准修订）

1. Launcher = `launcher/Program.cs` + `scripts/build-launcher.ps1`（Windows 自带 .NET Framework `csc.exe`）→ `dist\IELTS Writing Coach.exe`；隐藏窗口启动 `npm run dev:local`；轮询 `http://127.0.0.1:3000/api/health`；默认浏览器打开 `http://ieltswriting.localhost:3000`；失败弹 MessageBox 中文提示 + `%LOCALAPPDATA%\IELTS Writing Coach\server.log` 路径；重复双击不重复启动。不引入 Electron/installer/proxy/hosts 修改；不隐藏 `:3000`。
2. **A. 窄依赖**：`request-essay-feedback` 不依赖完整 `TaskIntakeRepository`；feedback 模块内部只读窄接口 `EssayFeedbackTaskContextSource { findResolution(taskId): Promise<TaskContextResolution | undefined> }`；use case 不得获得 create/publish/claim 写能力。Essay repository 依赖保持只读，不重构现有模块。
3. **B. 无 clientRequestId**：feedback HTTP 请求不携带 `clientRequestId`（不持久化、不建幂等表、不发领域事件、不引入 correlationId）；前端请求期间禁用"获取反馈"按钮防重复点击。
4. **C. INVALID_STRUCTURE owner**：OpenAI adapter 的 JSON decode 失败 → `INVALID_JSON`；use case 的 Zod/domain schema 校验失败 → `INVALID_STRUCTURE`；单一 owner，各自补测试。
5. **D. band 0.5 步进**：`overallBand` 与四维分数只允许 `0/0.5/1.0/…/9.0`；Structured Output JSON Schema 与领域 Zod 校验一致；测试覆盖 6.5 accepted、6.3 rejected。
6. **E. CERTAIN-only prompt**：prompt 只含全部 CERTAIN fact statements + limitationCodes；禁止 UNCERTAIN/UNAVAILABLE statement 原文作为事实输入；prompt 明确要求不得因受限题图信息扣分或判错；测试断言包含全部 CERTAIN statements、不含任何 UNCERTAIN statement 原文、包含 limitationCodes、prompt 含"不得因受限信息扣分"要求。
7. **F. HTTP 错误码冻结**：404 `ESSAY_NOT_FOUND`；409 `TASK_CONTEXT_PENDING`；422 `TASK_CONTEXT_UNAVAILABLE`；503 `FEEDBACK_LLM_UNAVAILABLE`（NETWORK/TIMEOUT）；502 `FEEDBACK_LLM_FAILED`（REFUSAL/INCOMPLETE/INVALID_JSON/INVALID_STRUCTURE/TERMINAL）；body `{ error, message }`（中文文案），无 stack/raw response/key。
8. **G. 红线**：Phase 3.5 Essay Feedback ≠ 正式 IELTS Assessment；UI 显示「非官方估计，仅供练习参考」；禁止写 `essay_assessments`、写 Student Memory、feedback 持久化、评分历史、assessment 事件、复用/修改正式 Assessment schema。
9. **H. 既有 LLM 契约保护**：`src/ports/llm.port.ts`、`src/ports/task-context-llm.port.ts`、`src/infrastructure/llm/openai-task-context.adapter.ts` 零业务 diff；新增 `EssayFeedbackLLMPort extends LLMPort` + 独立 adapter；实现完成后 `git diff --exit-code` 验证三个既有文件未修改。
10. 反馈 Schema：`overallBand` + `criteria`(TA/CC/LR/GRA) + `strengths[1..3]` + `improvements[1..3]` + `priorityImprovement`，全 required、strict。
11. 反馈不持久化、不写 Memory、不发新领域事件；少于 150 词允许请求但前端提示。
12. 默认 OFFLINE：所有测试用 deterministic fake/mocked transport；真实 OpenAI 仅限总指挥人工 Human Smoke Test；自动测试绝不调用真实 OpenAI、不产生 API 费用。
13. 每 Task 严格 Red → Green → Refactor；不修改 PRD、Acceptance Criteria；`docs/ARCHITECTURE.md` 仅新增 §4.11（已完成），不触碰其他章节。

## 3. 文件拆分

- 新增：`launcher/Program.cs`、`scripts/build-launcher.ps1`、`.env.example`、`app/api/health/route.ts`、`src/ports/essay-feedback-llm.port.ts`（含窄接口类型）、`src/domain/feedback/essay-feedback.schema.ts`、`src/infrastructure/llm/openai-essay-feedback.adapter.ts`、`src/application/request-essay-feedback.ts`、`src/presentation/writing/feedback-route-handlers.ts`、`src/presentation/writing/feedback-panel.tsx`、`app/api/essays/[sessionId]/feedback/route.ts`、测试若干、`docs/PHASE_3_5_DESIGN.md`（已建）。
- 修改：`src/presentation/writing/writing-workspace.tsx`（右栏接入）、`src/infrastructure/database/repository-factory.ts`（装配 feedback adapter）、`package.json`（`dev:local`）、`CHANGELOG.md`、`docs/ARCHITECTURE.md`（仅 §4.11，已建）。
- 提交边界：`dist\IELTS Writing Coach.exe` 构建产物不提交；`launcher/Program.cs` 与构建脚本提交。

## 4. Tasks（每 Task 先失败测试→最小实现→回归）

### Task 1：health endpoint

- **Files**：`app/api/health/route.ts`、`tests/unit/health-api.test.ts`
- **Steps**：先写测试断言 GET `/api/health` 返回 200 且 body `{ ok: true }`（调用 route handler）→ RED → 实现 `Response.json({ ok: true })` → GREEN。断言无业务副作用（不写库）。
- **Expected**：health 测试通过；typecheck/lint 通过。

### Task 2：essay-feedback schema

- **Files**：`src/domain/feedback/essay-feedback.schema.ts`、`tests/unit/essay-feedback.schema.test.ts`
- **Steps**：失败测试覆盖——合法对象通过；缺任一 required 字段拒绝；strict 拒绝多余字段；分数越界（<0、>9）拒绝；**非 0.5 步进拒绝（6.3 rejected）**、**0.5 步进接受（6.5 accepted）**（overallBand 与四维逐一覆盖）；strengths/improvements 空数组或 >3 拒绝；priorityImprovement 空拒绝；`parseEssayFeedback` 返回类型正确。
- **Expected**：schema 测试全绿。

### Task 3：EssayFeedbackLLMPort + OpenAI adapter

- **Files**：`src/ports/essay-feedback-llm.port.ts`（含 `EssayFeedbackTaskContextSource` 窄接口类型）、`src/infrastructure/llm/openai-essay-feedback.adapter.ts`、`tests/unit/openai-essay-feedback.adapter.test.ts`（fake `ResponsesClient`）
- **Steps**：测试覆盖——成功（completed + output_text → ok，model/responseId 透传）；`refusal` → REFUSAL；非 completed → INCOMPLETE；无 output_text → INVALID_JSON；**JSON decode 失败 → INVALID_JSON（owner=adapter）**；fetch 抛错 → NETWORK；timeout 字样 → TIMEOUT；请求体含 strict json_schema 与 reasoning low 断言；模型默认 `gpt-5.6-luna` 可被 env 覆盖；`execute()` 返回 TERMINAL（与 Task Context adapter 一致）。断言 `git diff --exit-code` 对三个既有 LLM 文件为零。
- **Expected**：adapter 测试全绿；`llm.port.ts`/`task-context-llm.port.ts`/`openai-task-context.adapter.ts` 零 diff。

### Task 4：request-essay-feedback use case

- **Files**：`src/application/request-essay-feedback.ts`、`tests/unit/request-essay-feedback.test.ts`（fake essay repository + 窄接口 fake source + fake feedback LLM）
- **Steps**：失败测试覆盖——
  - 依赖形状：use case 只接受窄 `EssayFeedbackTaskContextSource`（TS 编译期验证无写能力）与只读 essay 数据；不 import 完整 `TaskIntakeRepository`。
  - READY context：LLM 请求含 essay plainText、wordCount、**全部 CERTAIN statements**、**不含任何 UNCERTAIN statement 原文**、含 limitationCodes、prompt 含"不得因受限题图信息扣分或判错"要求；返回反馈。
  - DEGRADED context：仍可反馈；uncertain facts 不进事实依据；limitations 传入。
  - PENDING（availability PENDING）→ 稳定错误 `TASK_CONTEXT_PENDING`；UNAVAILABLE（context null）→ `TASK_CONTEXT_UNAVAILABLE`；均不调用 LLM。
  - session 不存在 → `ESSAY_NOT_FOUND`。
  - LLM 各失败 code 透传（REFUSAL/INCOMPLETE/INVALID_JSON/INVALID_STRUCTURE/NETWORK/TIMEOUT/TERMINAL）。
  - **domain 校验失败 → INVALID_STRUCTURE（owner=use case）**：LLM 返回 ok 但 value 无法通过 `essayFeedbackSchema` 时映射为 INVALID_STRUCTURE。
  - 少于 150 词不阻断。
- **Expected**：use case 测试全绿；CERTAIN-only 断言通过。

### Task 5：feedback API 路由

- **Files**：`src/presentation/writing/feedback-route-handlers.ts`、`app/api/essays/[sessionId]/feedback/route.ts`、`tests/unit/feedback-api.test.ts`
- **Steps**：测试覆盖——非法 JSON → 400 `INVALID_REQUEST`；无 body 允许（不要求 clientRequestId）；session 不存在 → 404 `ESSAY_NOT_FOUND`；PENDING → 409 `TASK_CONTEXT_PENDING`；UNAVAILABLE → 422 `TASK_CONTEXT_UNAVAILABLE`；成功 → 200 且 body 含 feedback；LLM NETWORK/TIMEOUT → 503 `FEEDBACK_LLM_UNAVAILABLE`；LLM REFUSAL/INCOMPLETE/INVALID_JSON/INVALID_STRUCTURE/TERMINAL → 502 `FEEDBACK_LLM_FAILED`；所有错误 body `{ error, message }` 且 message 为中文、不含 stack/raw response/key；`runtime = "nodejs"`。
- **Expected**：API 测试全绿（错误码矩阵逐项断言）。

### Task 6：右栏反馈面板 UI

- **Files**：`src/presentation/writing/feedback-panel.tsx`、`src/presentation/writing/writing-workspace.tsx`（接入）、`tests/unit/feedback-panel.test.tsx`
- **Steps**：测试覆盖——"获取反馈"按钮存在；点击后发起 POST `/api/essays/[sessionId]/feedback`（fetch mock，**请求体无 clientRequestId**）；请求期间按钮禁用（防重复点击）；成功渲染"非官方估计，仅供练习参考"、总分、四维分数、strengths、improvements、priorityImprovement；失败渲染稳定错误码对应的中文文案（无 stack）；少于 150 词显示提示但按钮可点；右栏保留保存状态展示。
- **Expected**：UI 测试全绿；原有 `writing-workspace.test.tsx` 无回归。

### Task 7：launcher 与配套

- **Files**：`launcher/Program.cs`、`scripts/build-launcher.ps1`、`.env.example`、`package.json`（`dev:local`）、`tests/unit/launcher-build.test.ts`
- **Steps**：
  1. 失败测试：`dev:local` 脚本存在且 `package.json` 可解析；`build-launcher.ps1` 可执行并产出 `dist\IELTS Writing Coach.exe`（spawn 构建脚本，断言 exe 存在）。
  2. 实现 `Program.cs`：`/api/health` 探测（127.0.0.1:3000，2s 超时）→ 已运行直接开浏览器；未运行则 `ProcessStartInfo`（隐藏窗口，cwd=项目根，重定向输出到 `%LOCALAPPDATA%\IELTS Writing Coach\server.log`）启动 `npm.cmd run dev:local` → 轮询 health（最长 60s）→ 成功开 `http://ieltswriting.localhost:3000`；失败 MessageBox（中文 + 日志路径 + 常见原因，无 stack）。
  3. `.env.example`：`OPENAI_API_KEY=`、`OPENAI_MODEL=gpt-5.6-luna`；`dev:local` = `next dev -H 127.0.0.1 -p 3000`。
- **Expected**：构建脚本测试通过；exe 可实编译（Task 9 门禁含 launcher build）。

### Task 8：Playwright e2e（离线 fake）

- **Files**：`tests/e2e/essay-feedback.spec.ts`
- **Steps**：e2e 默认注入确定性 fake（沿用既有受控 LLM 模式，绝不调用真实 OpenAI）——上传 fixture 题图 → 等待 READY → 输入 ≥150 词正文 → 点击"获取反馈" → 断言右栏出现"非官方估计，仅供练习参考"、总分/四维/改进项；再跑既有 3 条 e2e 确认无回归（`npm run test:e2e` 全量）。
- **Expected**：4 条 e2e 全绿；全程离线。

### Task 9：完整门禁 + Human Smoke Test 交接

- **Steps**：
  1. Phase 3.5 targeted（新增 feedback/health/launcher 测试文件）
  2. Phase 3 regression（既有 15 文件集合）、Phase 2 regression（既有 9 文件集合）
  3. `npx vitest --run tests/unit/phase-1-independent-acceptance.test.ts`（8/8）
  4. `npm run test:unit`（全量 Vitest）、coverage、typecheck、lint、production build、`npm audit --omit=dev`、`git diff --check`
  5. `scripts/build-launcher.ps1` 实编译 + exe 冒烟
  6. **零 diff 验证**：`git diff --exit-code` 三个既有 LLM 文件
  7. 精确暂存（排除 `dist/`、`.env`、`.data/`、`coverage/`、`test-results/`）→ 提交
  8. 向总指挥交付 Human Smoke Test 说明（双击哪个文件、打开什么地址、看到什么、亲手做什么）
- **Expected**：全部门禁 GREEN；提交完成；不做真实 Human Smoke Test（留给总指挥）。

## 5. Definition of Done

1. 双击 `dist\IELTS Writing Coach.exe` 可启动/聚焦本地服务并打开 `http://ieltswriting.localhost:3000`；重复双击不产生第二个 Node 实例；失败时中文弹窗 + 日志路径。
2. `/api/health` 返回 200 `{ ok: true }`，无副作用；`dev:local` 绑定 127.0.0.1:3000。
3. 右栏"获取反馈"：请求中禁用；成功后展示"非官方估计，仅供练习参考"、非官方 overall band、IELTS 四维、strengths、improvements、priority improvement；失败给稳定错误码 + 中文文案（无 stack）。
4. 反馈请求只基于 CERTAIN facts + limitationCodes；uncertain/unavailable 不作为判错依据（prompt 与测试双重保证）。
5. 0.5 band 步进在 JSON Schema 与 Zod 两端一致（6.5 accepted / 6.3 rejected）。
6. 反馈不持久化、不写 Memory、不发事件、不写 `essay_assessments`；无 clientRequestId/correlationId。
7. `EssayFeedbackLLMPort` additive；窄 `EssayFeedbackTaskContextSource` 无写能力；INVALID_JSON owner=adapter、INVALID_STRUCTURE owner=use case。
8. HTTP 错误码矩阵（404/409/422/503/502）逐项测试通过；错误 body 恒为 `{ error, message }`。
9. 既有 `LLMPort`/`TaskContextLLMPort`/`openai-task-context.adapter.ts` 零业务 diff（`git diff --exit-code` 验证）。
10. 全量 Vitest、Phase 1 独立验收、Phase 2/3 回归、Playwright 全绿；typecheck/lint/build/audit/diff-check 通过；launcher 可构建。
11. 自动测试全程离线；真实 OpenAI 仅限总指挥人工 Human Smoke Test。
12. `dist/`、`.env`、运行数据不入库；`launcher/Program.cs` 与构建脚本入库。
13. 已向总指挥交付 Human Smoke Test 步骤；不实现 realtime Coach、不开始 Phase 4。

## 6. 测试 AI 交接点

- 独立复验：health；schema 0.5 步进与 strict 拒绝；adapter 七类失败 code 与 INVALID_JSON owner；use case 窄依赖、CERTAIN-only prompt、PENDING/UNAVAILABLE 阻断、INVALID_STRUCTURE owner；API 错误码矩阵与 `{ error, message }` 无泄露；UI 防重复点击、非官方文案、<150 词提示；launcher 构建可复现、exe 冒烟；三个既有 LLM 文件零 diff；Phase 1/2/3 全回归；全程离线、无 live OpenAI。
- Human Smoke Test 由总指挥亲手执行（真实 API 仅此一步，明确提示费用）。

## 7. 建议提交切分

1. `docs: freeze phase 3.5 contracts in architecture 4.11`（amendment，含 design/plan/CHANGELOG 修订）
2. `feat: add health endpoint and essay feedback schema`（Task 1–2）
3. `feat: add essay feedback llm port and adapter`（Task 3）
4. `feat: add essay feedback use case and api`（Task 4–5）
5. `feat: add essay feedback panel`（Task 6）
6. `chore: add windows launcher and local scripts`（Task 7 + .env.example + dev:local）
7. `test: add essay feedback e2e`（Task 8）
8. `feat: complete phase 3.5 usable mvp`（Task 9 门禁与交接）

## 8. 架构复核交接（已完成）

- 架构 AI 实现前复核结论：**无 architecture blocker**；2 项必改（窄依赖、删 clientRequestId）、4 项钉死（INVALID_STRUCTURE owner、0.5 步进、CERTAIN-only、HTTP 错误码）、1 条红线（feedback ≠ 正式 Assessment）已全部落入 `docs/ARCHITECTURE.md` §4.11 与本计划；总指挥确认不再进行二轮 re-review，文档修订后直接编码。
