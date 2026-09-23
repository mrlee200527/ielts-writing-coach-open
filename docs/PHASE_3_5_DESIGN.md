# Phase 3.5 — Usable MVP Design / Spec

> 状态：**草案，待总指挥确认**。本轮只做设计说明，不编码。
> 本阶段目标不是继续扩基础设施，而是让总指挥今天能真正日常使用产品。

## 1. 目标与优先级

Phase 3.5 的目标是交付一个**个人可日常使用**的 MVP：

1. **一键启动**：双击 `IELTS Writing Coach.exe` → 自动启动本地服务 → 打开浏览器。
2. **最短真正可用的 AI 写作链路**：上传题图 → Task Context → 三栏写作 → 自动保存 → 点击"获取反馈" → 右栏展示一次性全文反馈。
3. **Human Smoke Test**：自动测试通过不能单独视为阶段完成；完成后必须向总指挥说明双击哪个文件、打开什么地址、看到什么、亲手做哪条流程。

优先级（总指挥已确认）：**可用 > 简单 > 稳定 > 易启动 > 易恢复 > 工程完美**。

## 2. 明确不做（本轮）

- 1.5 秒 sentence realtime Coach、3 秒 paragraph realtime Coach、Intervention Policy 完整实时链路。
- Student Memory、教师知识库、完整长期个性化。
- 反馈持久化 / 评分历史 / 学习档案。
- Electron、安装器体系、自动更新、80/443 反向代理、hosts 修改、管理员权限。
- 多用户 / 认证 / 部署形态；Task 2。
- Phase 4 的全部高级能力。

## 3. A. 一键启动器（Launcher）

### 3.1 技术选型：Windows 自带 .NET Framework 编译的极薄 C# 单文件 exe

- **方案**：仓库保留 C# 源文件 `launcher/Program.cs` 与构建脚本 `scripts/build-launcher.ps1`；脚本调用 Windows 自带的 `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` 编译为 `dist\IELTS Writing Coach.exe`（构建产物，`dist/` 已在 `.gitignore`）。
- **选型原因**：
  - 零安装、零新增运行时：Windows 10/11 自带 .NET Framework 4.x 与 csc.exe，不引入 pkg/nexe/Electron 等任何新依赖或大框架（符合"不安装新的大型框架"约束）。
  - 满足"双击 .exe"体验：无需用户打开 PowerShell/CMD、无需 cd、无需手动 npm。
  - 隐藏窗口：exe 内用 `ProcessStartInfo`（`CreateNoWindow=true`、`UseShellExecute=false`）启动 dev server，不弹终端与控制台；浏览器只打开前端页面。
  - 错误提示：用 `MessageBox` 给普通用户可理解的中文提示 + 日志路径，不展示 stack trace。
- **明确不采用**：`.bat`（会闪终端窗口且无健康检查/错误弹窗）、PowerShell 脚本（仍需双击 .ps1 或快捷方式，体验不如 exe）、`pkg`/`nexe`（新的大型依赖）、Electron（严重超重）。

### 3.2 启动行为（对应需求 A.1–A.10）

1. 探测本地服务是否已运行：对 `http://127.0.0.1:3000/api/health` 做一次短超时 GET（`.NET` 侧用 `127.0.0.1`，因为系统级 DNS 不一定解析 `*.localhost`；浏览器侧才用 `ieltswriting.localhost`）。
2. 已运行 → 直接打开浏览器 `http://ieltswriting.localhost:3000`，**不重复启动**（满足 A.8）。
3. 未运行 → 以隐藏窗口启动 `npm run dev:local`（cwd=项目根目录），stdout/stderr 重定向到日志文件 `%LOCALAPPDATA%\IELTS Writing Coach\server.log`；轮询 `/api/health` 直到 200 或超时（约 60 秒）。
4. 健康检查成功 → 打开浏览器 `http://ieltswriting.localhost:3000`（系统默认浏览器；Chrome/Edge 90+ 及新版 Firefox 内置将 `*.localhost` 解析到 `127.0.0.1`，无需 hosts）。
5. 启动失败或超时 → `MessageBox` 显示：服务未能启动、日志路径（`%LOCALAPPDATA%\IELTS Writing Coach\server.log`）、以及"检查 `OPENAI_API_KEY` 是否配置"等常见原因；不展示大段 stack trace（满足 A.9）。
6. 第一版不隐藏 `:3000`；地址固定 `http://ieltswriting.localhost:3000`（满足 A.5/A.10）。
7. 已知限制与退路：若系统默认浏览器不支持 `*.localhost` 通配解析，exe 提示用户手动访问 `http://127.0.0.1:3000`（同一服务，仅地址不同），不修改 hosts。

### 3.3 配套

- 新增 `app/api/health/route.ts`：返回 `200 { ok: true }`，供 launcher 健康检查（也供测试与人工排查）。
- `package.json` 新增脚本 `dev:local`：`next dev -H 127.0.0.1 -p 3000`（显式绑定 IPv4 环回，确保 `127.0.0.1:3000` 可访问、`ieltswriting.localhost:3000` 可达）。
- 新增 `.env.example`：`OPENAI_API_KEY=`、`OPENAI_MODEL=gpt-5.6-luna`（Next.js 自动加载 `.env`；`.env*` 已在 `.gitignore`，密钥不进版本控制）。
- launcher 启动前不执行 `db:migrate`：本地数据库由应用首次访问时以 bootstrap 建空库，非空升级由既有 `db:migrate` 脚本负责；dev 组合根当前行为不变。

## 4. C. 一次性 LLM 全文反馈（本阶段最重要业务功能）

### 4.1 最小数据流

```
用户点击"获取反馈"（请求期间按钮禁用，防重复点击）
  → POST /api/essays/[sessionId]/feedback        // 无 clientRequestId（不持久化、不建幂等表、不发事件）
  → 后端：
      1. getWritingWorkspace(repository, sessionId)          // 复用，拿 essay + task + current revision（只读）
      2. EssayFeedbackTaskContextSource.findResolution(taskId)  // 窄只读接口，仅 findResolution，无写能力
      3. 校验 availability：READY/DEGRADED 才可反馈；
         PENDING → 409 TASK_CONTEXT_PENDING；UNAVAILABLE → 422 TASK_CONTEXT_UNAVAILABLE
      4. 组装版本化 prompt（promptVersion: "essay-feedback-v1"，CERTAIN-only）：
         - 仅 CERTAIN facts 作为事实依据（复用 fact-certainty.certainFacts）
         - UNCERTAIN/UNAVAILABLE fact statement 原文禁止作为事实输入；
           limitationCodes 明确标记为"受限信息"，prompt 要求不得因受限题图信息扣分或判错
         - 作文正文 plainText + wordCount
      5. 调用 EssayFeedbackLLMPort.executeEssayFeedback(request)
         → OpenAI Responses API：strict JSON Schema、reasoning.effort = low（复用现有调用模式）
      6. 返回 200 { feedback }；LLM 失败 → 稳定错误码（见 §4.4），不暴露原始响应或 stack
  → 前端右栏 feedback 面板展示：非官方总分估计、IELTS 四维分数、优点、改进建议（含优先改进项），
    并显示"非官方估计，仅供练习参考"
```

- **不持久化**：反馈仅会话内展示；刷新后丢失，可重新点击获取（最小版，符合"可用 > 简单"；为控制成本，每次点击 = 1 次真实 LLM 调用）。
- **不写 Student Memory、不产生新领域事件、不建幂等表、不引入 correlationId**（最小版；观测与记忆属于后续阶段）。
- **少于 150 词**：允许请求，按钮旁提示"作文字数偏少，反馈可能不准确"，不阻断。

### 4.2 反馈 Schema（最小，strict 结构化输出）

```ts
essayFeedbackSchema = z.object({
  overallBand: z.number().min(0).max(9),            // 非官方总分估计，0.5 步进
  criteria: z.object({
    taskAchievement: z.number().min(0).max(9),
    coherenceCohesion: z.number().min(0).max(9),
    lexicalResource: z.number().min(0).max(9),
    grammaticalRangeAccuracy: z.number().min(0).max(9),
  }).strict(),
  strengths: z.array(z.string()).min(1).max(3),      // 优点 1–3 条
  improvements: z.array(z.string()).min(1).max(3),   // 改进建议 1–3 条
  priorityImprovement: z.string().min(1),            // 唯一优先改进项
}).strict()
```

- 全部字段 required（与 Phase 3 strict Structured Outputs 冻结契约一致：语义缺失只用 nullable，不允许缺字段）。
- **band 0.5 步进冻结**：`overallBand` 与四维分数只允许 `0 / 0.5 / 1.0 / … / 9.0`（6.5 合法、6.3 非法）；Structured Output JSON Schema 与领域 Zod 校验保持一致。

### 4.3 新增端口（additive，无契约冲突）

- `EssayFeedbackLLMPort extends LLMPort`：新增 `executeEssayFeedback(request): Promise<EssayFeedbackLlmResult>`。
- 失败 code 复用 Phase 3 既有枚举：`TIMEOUT | NETWORK | INVALID_JSON | INVALID_STRUCTURE | REFUSAL | INCOMPLETE | TERMINAL`。
- **owner 冻结**：OpenAI adapter 负责 JSON decode（失败 → `INVALID_JSON`）；use case 负责 Zod/domain schema 校验（失败 → `INVALID_STRUCTURE`）；单一 owner，不重复归属。
- **窄依赖**：feedback 模块内部只读窄接口 `EssayFeedbackTaskContextSource { findResolution(taskId): Promise<TaskContextResolution | undefined> }`；use case 不得获得 `createIntake/publish/claim` 等写能力。Essay repository 依赖保持只读，不重构现有模块。
- 既有 `LLMPort`/`TaskContextLLMPort` 及 `openai-task-context.adapter.ts` 零修改（与 Phase 3 `TaskContextLLMPort` 先例一致；实现完成后以 `git diff --exit-code` 验证这三个既有文件零业务 diff）。

### 4.4 错误码冻结与红线

**HTTP 稳定错误码**（错误 body 恒为 `{ error: "<稳定错误码>", message: "<中文用户文案>" }`；不得返回 stack、供应商原始响应、API key 或内部异常详情）：

| 条件 | 状态码 | error |
|---|---|---|
| session 不存在 | 404 | `ESSAY_NOT_FOUND` |
| Task Context PENDING | 409 | `TASK_CONTEXT_PENDING` |
| Task Context UNAVAILABLE | 422 | `TASK_CONTEXT_UNAVAILABLE` |
| LLM NETWORK / TIMEOUT | 503 | `FEEDBACK_LLM_UNAVAILABLE` |
| LLM REFUSAL / INCOMPLETE / INVALID_JSON / INVALID_STRUCTURE / TERMINAL | 502 | `FEEDBACK_LLM_FAILED` |

**红线：Phase 3.5 Essay Feedback ≠ 正式 IELTS Assessment。** 它只是个人 MVP 的一次性非官方反馈链路；UI 必须显示「非官方估计，仅供练习参考」。本阶段严格禁止：写 `essay_assessments`、写 Student Memory、feedback 持久化、评分历史、新增 assessment 领域事件、复用/修改正式 Assessment schema、声称正式评分已完成。未来正式 Assessment 应替换这条最小链路，不得把本链路解释为已验收的正式评分模块。

## 5. 契约评估结论

- **无公共架构契约 blocker**：数据（TaskContext + revision）、调用模式（Responses API strict schema）、装配点（repository-factory）、UI 三栏（右栏扩展）全部可复用。
- 新增公共契约已按架构 AI 复核结论冻结在 `docs/ARCHITECTURE.md` **§4.11**：`EssayFeedbackLLMPort`（additive）、窄只读 `EssayFeedbackTaskContextSource.findResolution`、INVALID_JSON/INVALID_STRUCTURE owner、0.5 band 步进、CERTAIN-only prompt、HTTP 稳定错误码、feedback ≠ 正式 Assessment 红线、不持久化/不写 Memory/不发 assessment 事件、`/api/health` readiness probe、launcher 本地 MVP 边界。
- 架构 AI 复核结论为**无 architecture blocker**，本阶段不再进行第二轮 architecture re-review；文档修订后即可直接编码。

## 6. 复用清单（直接复用，不重新设计）

| 模块 | 复用方式 |
|---|---|
| `TaskContextResolution` / `findResolution` | 反馈输入数据源（context + limitationCodes + availability），经窄接口暴露 |
| `fact-certainty.ts` 的 `certainFacts` | 只把 CERTAIN facts 作为事实依据 |
| `NativeOpenAiResponsesClient` + strict JSON Schema + reasoning low | 反馈 LLM 调用基础设施（新建 adapter 复用 client） |
| `repository-factory.ts` 组合根 | 新增 feedback adapter/use case 装配入口 |
| `get-writing-workspace` + `WritingWorkspaceSnapshot` | session/task/revision 读取（只读） |
| 三栏 Workspace 与 autosave 控制器 | UI 骨架、自动保存原样保留；右栏替换为反馈面板 |
| API route 装配模式（`route.ts` → `createXxxRouteHandlers`） | 新 feedback 路由 |
| Playwright runner（`scripts/run-playwright.mjs`） | e2e 复用 |
| 确定性 fake（`controlled-llm.fake` 等） | 反馈链路测试默认离线 |

## 7. 预计新增文件

**业务与基础设施**
- `src/ports/essay-feedback-llm.port.ts`（新端口 + 窄只读 `EssayFeedbackTaskContextSource` 类型定义）
- `src/domain/feedback/essay-feedback.schema.ts`（反馈输出 strict schema，0.5 band 步进校验）
- `src/infrastructure/llm/openai-essay-feedback.adapter.ts`（adapter，复用 ResponsesClient；JSON decode → INVALID_JSON）
- `src/application/request-essay-feedback.ts`（use case：窄只读依赖、校验、组装 CERTAIN-only prompt、调用、返回；domain 校验失败 → INVALID_STRUCTURE）
- `src/presentation/writing/feedback-route-handlers.ts`（路由 handler；HTTP 稳定错误码冻结）
- `src/presentation/writing/feedback-panel.tsx`（右栏反馈面板：按钮、加载、错误、分数与建议展示 + "非官方估计，仅供练习参考"）
- `app/api/health/route.ts`
- `app/api/essays/[sessionId]/feedback/route.ts`
- 修改 `src/presentation/writing/writing-workspace.tsx`（右栏接入反馈面板）
- 修改 `src/infrastructure/database/repository-factory.ts`（装配 feedback adapter）

**Launcher**
- `launcher/Program.cs`（C# 源文件）
- `scripts/build-launcher.ps1`（调用系统 csc 编译 `dist\IELTS Writing Coach.exe`）
- `dist\IELTS Writing Coach.exe`（构建产物，`.gitignore` 已忽略 `dist/`）
- `.env.example`（`OPENAI_API_KEY` / `OPENAI_MODEL`）
- `package.json`：新增 `dev:local` 脚本

**测试**
- `tests/unit/essay-feedback.schema.test.ts`
- `tests/unit/openai-essay-feedback.adapter.test.ts`
- `tests/unit/request-essay-feedback.test.ts`
- `tests/unit/feedback-api.test.ts`
- `tests/unit/feedback-panel.test.tsx`
- `tests/unit/health-api.test.ts`（`/api/health` 200）
- `tests/e2e/essay-feedback.spec.ts`（Playwright，确定性 fake，离线）

**文档**
- `docs/superpowers/plans/2026-08-14-phase-3-5-usable-mvp.md`（本阶段的测试先行 Implementation Plan）

## 8. B. Human Smoke Test（Phase 3.5 完成后交总指挥亲手执行）

1. **双击**：`dist\IELTS Writing Coach.exe`（位于项目根目录下）。
2. **浏览器打开**：`http://ieltswriting.localhost:3000`（应自动打开；若默认浏览器不支持 `*.localhost`，用 `http://127.0.0.1:3000`）。
3. **页面应看到**：首页出现"AI IELTS Writing Coach"品牌与"开始"入口；上传一张 Task 1 题图（PNG/JPG）后进入三栏工作台：左栏题目与题图、中栏写作编辑区、右栏写作状态与"获取反馈"。
4. **总指挥亲手完成的主流程**：
   - 上传题图 → 等待状态变 READY → 写 150 词以上正文（自动保存显示"已保存"）→ 点击"获取反馈" → 右栏展示**"非官方估计，仅供练习参考"**、非官方总分估计、IELTS 四维分数、优点、改进建议与唯一优先改进项。
   - 少于 150 词时按钮旁出现提示但可点击。
   - 重复双击 exe → 浏览器直接打开/聚焦现有页面，**不产生第二个 Node 实例**。
   - 关掉服务后双击 exe → 自动重新启动服务并打开页面。
5. **真实 API 提示**：主流程中"获取反馈"是唯一真实 LLM 调用（1 次/点击，会产生少量 OpenAI 费用）；其余全部离线。若不想产生费用，可先跑 `tests/e2e/essay-feedback.spec.ts`（确定性 fake）验证链路，再做人工验证。

## 9. 风险与已知限制

- `ieltswriting.localhost` 依赖默认浏览器内置 `*.localhost` 解析（Chrome/Edge 90+、新版 Firefox）；旧浏览器需退路 `127.0.0.1`。
- launcher 依赖 Windows 自带 .NET Framework 4.x（Win10/11 均自带）；极端精简系统缺失 csc 时需人工按日志排查。
- 反馈每次点击消耗一次真实 LLM 调用；未做频率限制（个人自用 MVP，接受）。
- 反馈不持久化；刷新后需重新获取。
- 本地文件 Blob 与进程内 Job 仅适用于本地 MVP（沿用 Phase 3 已记录部署风险）。
