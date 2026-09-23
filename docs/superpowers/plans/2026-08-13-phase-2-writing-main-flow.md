# Phase 2 Writing Main Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不接入任何真实 AI 能力的前提下，实现从首页开始 Task 1、创建 Essay Session、进入三栏写作工作台、持续编辑与自动保存、持久化不可变 Revision，并在刷新或重新进入后恢复最近成功正文的完整主链路。

**Architecture:** 沿用 Next.js App Router 模块化单体和 Phase 1 领域基础。浏览器负责即时编辑、字数显示、可注入计时与防抖调度；服务端应用服务负责创建会话、乐观并发保存、不可变 revision 和恢复；Drizzle + 本地 SQLite 作为当前 `StoragePort` 适配器，业务层不直接依赖数据库。写作主链路不依赖 `LLMPort` 或 `JobPort`，因此 AI 失败不能阻断编辑、保存或恢复。

**Tech Stack:** Next.js 16、React 19、TypeScript strict、Zod、TipTap、Tailwind CSS、Drizzle ORM、SQLite、Vitest、Playwright。

---

## 1. 范围与验收映射

### 本阶段包含

- AC-01 子集：首页展示“开始 Task 1 写作”；点击后创建本地题目占位和 Essay Session，进入可见题目文字、题图占位及空白编辑区的工作台。
- AC-03：正文、字数和用时即时更新；自动保存独立于 AI；刷新或用 session URL 重新进入时恢复最近成功 revision。
- 基础三栏响应式布局：左栏题目/题图占位/字数/用时，中栏编辑器/保存状态，右栏明确标示 AI 反馈尚未启用。
- 本地单用户组合根、Essay Session 创建、不可变 Revision 持久化、乐观并发、防抖自动保存、失败重试和只读测试观测。

### 本阶段明确不包含

- 真实 LLM、Prompt、Task Context 自动识图、题图事实或不确定性推断；
- 真实题图上传/对象存储；本阶段只提供可替换的题图展示占位，不声称完整通过 AC-01 上传与识图验收；
- 句子/段落 AI 检查或反馈 UI、IELTS 评分、提交、Student Memory、教师知识库；
- 正式认证、多用户账户页面、Supabase/Trigger.dev/Vercel 部署。

不得修改 `docs/PRODUCT_REQUIREMENTS_MVP.md`、`docs/ARCHITECTURE.md`、`docs/ACCEPTANCE_TEST_PLAN_MVP.md` 或 Phase 1 公共领域契约。若现有契约无法支持乐观并发或持久化，停止相关 Task 并上报架构 AI，不静默改变语义。

## 2. 目录与文件清单

```text
app/
├─ globals.css                                      # Tailwind 与三栏响应式基础样式
├─ layout.tsx                                       # 全局样式、中文元数据
├─ page.tsx                                         # 首页与开始写作入口
├─ write/[sessionId]/page.tsx                       # 服务端加载最近保存快照
└─ api/
   ├─ essays/route.ts                               # POST 创建 Session
   └─ essays/[sessionId]/
      ├─ route.ts                                   # GET 恢复 Session
      └─ draft/route.ts                             # PUT 乐观并发自动保存
src/
├─ domain/
│  ├─ essay/
│  │  ├─ writing-task.schema.ts                     # 本阶段题目文字/图片占位引用
│  │  ├─ essay-session-service.ts                   # 创建 DRAFT Session
│  │  └─ writing-timer.ts                           # 确定性用时快照计算
│  └─ events/
│     ├─ event-types.ts                             # 注册 session/revision 保存事件
│     └─ reason-codes.ts                            # 注册稳定保存原因码
├─ application/
│  ├─ essay-session.repository.ts                   # 领域专用仓储契约
│  ├─ create-essay-session.ts                       # 原子创建 task/session/初始 revision
│  ├─ save-essay-draft.ts                           # CAS 保存与幂等响应
│  └─ get-writing-workspace.ts                      # 恢复最近成功正文
├─ infrastructure/
│  ├─ database/
│  │  ├─ schema.ts                                  # writing_tasks/session/revision 表
│  │  ├─ client.ts                                  # 本地 SQLite 连接
│  │  ├─ migrate.ts                                 # 开发/测试迁移入口
│  │  └─ migrations/0001_writing_main_flow.sql
│  └─ storage/drizzle-essay-session.repository.ts   # 仓储 + 事务 + CAS 适配器
├─ presentation/writing/
│  ├─ writing-workspace.tsx                         # 三栏组合组件
│  ├─ prompt-panel.tsx                              # 题目文字/题图占位/统计
│  ├─ essay-editor.tsx                              # TipTap 受控编辑器
│  ├─ workspace-sidebar.tsx                         # Phase 2 非 AI 右栏状态
│  ├─ autosave-controller.ts                        # 串行、合并最新草稿、重试
│  ├─ use-writing-timer.ts                          # 每秒显示、可见性暂停
│  └─ workspace.types.ts                            # UI 与 API DTO
└─ testing/
   ├─ controlled-draft-save.fake.ts                 # 延迟/失败/乱序保存 double
   └─ phase-2-fixtures.ts                           # 不含真实用户数据的 fixtures
tests/
├─ unit/
│  ├─ essay-session-service.test.ts
│  ├─ writing-timer.test.ts
│  ├─ create-essay-session.test.ts
│  ├─ save-essay-draft.test.ts
│  ├─ get-writing-workspace.test.ts
│  ├─ autosave-controller.test.ts
│  ├─ drizzle-essay-session.repository.test.ts
│  └─ writing-ai-isolation.test.ts
└─ e2e/
   ├─ writing-main-flow.spec.ts
   └─ writing-ai-degraded.spec.ts
playwright.config.ts
drizzle.config.ts
```

修改 `package.json`、`package-lock.json`、`vitest.config.ts`、`src/ports/test-observation.port.ts`、`src/testing/test-observation.adapter.ts`、`CHANGELOG.md`。Phase 1 的 `essay.schema.ts`、`revision.schema.ts` 与 `revision-service.ts` 只在测试证明存在兼容性缺口时做向后兼容扩展；不得更改既有字段含义。

## 3. 测试先行顺序

1. Session、初始 Revision、用时模型的领域测试。
2. 创建、保存、恢复应用服务测试，先固定事务和乐观并发。
3. SQLite/Drizzle 仓储契约测试，复用应用服务测试向量。
4. 自动保存控制器测试，覆盖防抖、串行、合并、失败和晚到响应。
5. UI/E2E：首页 → 工作台 → 编辑 → 保存 → 刷新恢复。
6. AI 隔离测试：故障 LLM/Job doubles 存在时写作保存仍成功，且写作服务零 AI 调用。

每个 Task 均执行 Red → Green → Refactor：先运行指定测试确认因行为缺失而失败，再写最小实现，再运行该测试、相关 Phase 1 回归、`typecheck` 和 `lint`。不得通过延长真实等待、降低并发断言或把失败保存标为成功来使测试变绿。

## 4. 实施任务

### Task 1：补齐 Phase 2 测试与 UI 工具链

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `drizzle.config.ts`
- Create: `app/globals.css`
- Modify: `app/layout.tsx`

- [ ] 安装架构指定依赖：`@tiptap/react`、`@tiptap/starter-kit`、`drizzle-orm`、SQLite driver、Tailwind；开发依赖加入 `drizzle-kit`、`@playwright/test`、React 测试所需 jsdom 工具。
- [ ] 新增脚本：`test:unit`、`test:e2e`、`db:generate`、`db:migrate`，保持既有 `test`、`typecheck`、`lint`、`build` 可用。
- [ ] 配置 Vitest 继续运行 `tests/unit/**/*.test.ts`；Playwright 使用独立临时数据库和 `data-testid`/语义角色，不共享开发数据。
- [ ] 先在 `tests/unit/project-config.test.ts` 增加脚本及依赖断言，再运行：

```powershell
npm.cmd test -- project-config.test.ts --run
npm.cmd run typecheck
npm.cmd run lint
```

**Expected:** 配置测试先红后绿；三条命令退出码 0。不得引入 OpenAI、Supabase 或 Trigger.dev SDK。

### Task 2：创建 Session、初始 Revision 与确定性计时模型

**Files:**
- Create: `src/domain/essay/writing-task.schema.ts`
- Create: `src/domain/essay/essay-session-service.ts`
- Create: `src/domain/essay/writing-timer.ts`
- Test: `tests/unit/essay-session-service.test.ts`
- Test: `tests/unit/writing-timer.test.ts`

- [ ] 先写失败测试，固定创建结果：`DRAFT` Session、占位 Task、revision 1 空正文、`wordCount = 0`、`startedAt` 来自注入 `Clock`。
- [ ] 题目占位 Schema 只包含 `id`、`promptText`、`imagePlaceholderKind: "TASK_1_PENDING"`；不生成 Task Context 或虚构识图结果。
- [ ] 计时模型使用持久化快照，不读取全局时间：

```ts
interface WritingTimerSnapshot {
  elapsedMs: number;
  runningSince?: string;
}

function elapsedWritingMs(snapshot: WritingTimerSnapshot, now: Date): number;
function pauseWritingTimer(snapshot: WritingTimerSnapshot, now: Date): WritingTimerSnapshot;
function resumeWritingTimer(snapshot: WritingTimerSnapshot, now: Date): WritingTimerSnapshot;
```

- [ ] 覆盖 0 秒、59/60 秒格式化、暂停期间不增长、恢复后继续累加、系统时间倒退不产生负数。
- [ ] 运行：

```powershell
npm.cmd test -- essay-session-service.test.ts writing-timer.test.ts --run
npm.cmd test -- essay-state-machine.test.ts revision-service.test.ts --run
npm.cmd run typecheck
npm.cmd run lint
```

**Expected:** 新测试全部通过，Phase 1 Essay/Revision 测试无回归；领域层不导入 React、Next.js 或数据库。

### Task 3：定义创建、保存和恢复应用服务

**Files:**
- Create: `src/application/essay-session.repository.ts`
- Create: `src/application/create-essay-session.ts`
- Create: `src/application/save-essay-draft.ts`
- Create: `src/application/get-writing-workspace.ts`
- Test: `tests/unit/create-essay-session.test.ts`
- Test: `tests/unit/save-essay-draft.test.ts`
- Test: `tests/unit/get-writing-workspace.test.ts`
- Modify: `src/domain/events/event-types.ts`
- Modify: `src/domain/events/reason-codes.ts`

- [ ] 先以内存仓储写失败测试，仓储契约固定为领域操作，而不是向 UI 暴露字符串 collection：

```ts
interface EssaySessionRepository {
  create(input: { task: WritingTask; session: EssaySession; revision: EssayRevision }): Promise<void>;
  findWorkspace(sessionId: string): Promise<WritingWorkspaceSnapshot | undefined>;
  saveRevision(input: {
    sessionId: string;
    expectedRevisionId: string;
    revision: EssayRevision;
    timer: WritingTimerSnapshot;
    clientMutationId: string;
  }): Promise<"SAVED" | "ALREADY_SAVED" | "REVISION_CONFLICT">;
}
```

- [ ] `CreateEssaySession` 在一个事务中保存占位 Task、DRAFT Session 和空 revision 1；重复 `clientRequestId` 返回同一 Session。
- [ ] `SaveEssayDraft` 校验 Session 为 `DRAFT`、`expectedRevisionId` 等于当前 revision，再用 Phase 1 `createNextRevision` 创建不可变 revision；事务提交后才返回 `SAVED`。
- [ ] 相同 `clientMutationId` 重放返回同一个已保存 revision；旧 `expectedRevisionId` 返回结构化 `REVISION_CONFLICT`，不得覆盖当前正文。
- [ ] `GetWritingWorkspace` 只返回 Session 当前指针指向的最近成功 revision、题目占位和计时快照；未提交/回滚 revision 不可见。
- [ ] 注册 `essay.session_created`、`essay.revision_saved` 事件及 `SESSION_STARTED`、`AUTOSAVE_SUCCEEDED`、`REVISION_CONFLICT` reason code，继续使用 Phase 1 完整 envelope 和 recorder。
- [ ] 运行：

```powershell
npm.cmd test -- create-essay-session.test.ts save-essay-draft.test.ts get-writing-workspace.test.ts --run
npm.cmd test -- domain-event.schema.test.ts test-observation-port.test.ts --run
npm.cmd run typecheck
npm.cmd run lint
```

**Expected:** 创建原子、revision 单调、重复请求幂等、冲突不覆盖、失败回滚、恢复只见最后成功正文均有断言；事件可由 `TestObservationPort` 观测。

### Task 4：实现 Drizzle + SQLite 本地持久化适配器

**Files:**
- Create: `src/infrastructure/database/schema.ts`
- Create: `src/infrastructure/database/client.ts`
- Create: `src/infrastructure/database/migrate.ts`
- Create: `src/infrastructure/database/migrations/0001_writing_main_flow.sql`
- Create: `src/infrastructure/storage/drizzle-essay-session.repository.ts`
- Test: `tests/unit/drizzle-essay-session.repository.test.ts`
- Modify: `.gitignore`

- [ ] 先对内存临时数据库运行与 Task 3 相同的仓储契约测试。
- [ ] 表仅实现本阶段需要的 `writing_tasks`、`essay_sessions`、`essay_revisions`、`domain_events` 和幂等请求记录；字段与架构第 8 节一致，UUID 和 ISO/timestamptz 语义不变。
- [ ] `essay_sessions.current_revision_id` 更新与新 revision/event 插入在同一事务中；CAS 更新条件必须包含旧 revision ID，受影响行数为 0 时返回 `REVISION_CONFLICT`。
- [ ] 数据库路径从 `LOCAL_DATABASE_PATH` 注入；测试使用每用例独立临时文件并在用例后关闭连接，不提交数据库文件。
- [ ] 运行：

```powershell
npm.cmd test -- drizzle-essay-session.repository.test.ts --run
npm.cmd run db:generate
npm.cmd run typecheck
npm.cmd run lint
```

**Expected:** 关闭并重开数据库后仍恢复最后成功 revision；事务注入失败不会移动 session 指针；重复/乱序保存不覆盖新正文。

### Task 5：实现 HTTP API 与输入 Schema

**Files:**
- Create: `app/api/essays/route.ts`
- Create: `app/api/essays/[sessionId]/route.ts`
- Create: `app/api/essays/[sessionId]/draft/route.ts`
- Create: `src/presentation/writing/workspace.types.ts`
- Test: `tests/unit/writing-api.test.ts`

- [ ] 先写 Route Handler 测试：创建返回 `201 + sessionId`；恢复返回最近成功 DTO；保存成功返回新 revision；非法输入 `400`；不存在 `404`；冲突 `409`；存储失败 `503` 且不伪报已保存。
- [ ] 请求 DTO 使用 Zod：正文 `plainText`、TipTap `content`、`expectedRevisionId`、`clientMutationId`、计时快照；响应不返回数据库内部字段或供应商错误。
- [ ] 本地单用户身份由组合根注入固定开发用户 ID，领域/API 不硬编码用户；为未来 Auth adapter 保留边界，但本阶段不做登录 UI。
- [ ] API 组合根不得创建或调用 `LLMPort`、`JobPort`。
- [ ] 运行：

```powershell
npm.cmd test -- writing-api.test.ts --run
npm.cmd run typecheck
npm.cmd run lint
```

**Expected:** 所有状态码和稳定错误码精确通过；响应日志不包含完整正文。

### Task 6：实现可控自动保存控制器

**Files:**
- Create: `src/presentation/writing/autosave-controller.ts`
- Create: `src/testing/controlled-draft-save.fake.ts`
- Create: `src/testing/phase-2-fixtures.ts`
- Test: `tests/unit/autosave-controller.test.ts`

- [ ] 先用手动 Scheduler 和 controlled save fake 写失败测试，固定状态：`IDLE | DIRTY | SAVING | SAVED | SAVE_FAILED | CONFLICT`。
- [ ] 输入后 800 ms 防抖；799 ms 不保存，800 ms 请求一次。保存进行中继续输入只保留最新待保存快照，当前请求结束后立即保存最新内容，不并发发出多个 PUT。
- [ ] 成功响应只有在 mutation ID 与当前 in-flight 匹配时才推进 revision；晚到/重复响应不得把较新 `SAVED` 状态或正文倒退。
- [ ] 网络/503 进入 `SAVE_FAILED`，正文继续可编辑；下一次输入或显式重试重新保存。409 进入 `CONFLICT` 并加载服务端最近成功正文供协调，不静默覆盖。
- [ ] 运行：

```powershell
npm.cmd test -- autosave-controller.test.ts --run
npm.cmd test -- phase-1-independent-acceptance.test.ts --run
npm.cmd run typecheck
npm.cmd run lint
```

**Expected:** 防抖边界、合并最新草稿、失败恢复、冲突和晚到响应全部使用确定性测试，无真实 sleep；Phase 1 并发终态测试无回归。

### Task 7：实现首页和三栏 Writing Workspace

**Files:**
- Modify: `app/page.tsx`
- Create: `app/write/[sessionId]/page.tsx`
- Create: `src/presentation/writing/writing-workspace.tsx`
- Create: `src/presentation/writing/prompt-panel.tsx`
- Create: `src/presentation/writing/essay-editor.tsx`
- Create: `src/presentation/writing/workspace-sidebar.tsx`
- Create: `src/presentation/writing/use-writing-timer.ts`
- Modify: `app/globals.css`

- [ ] 首页用语义按钮“开始 Task 1 写作”；点击 POST 创建 Session，成功后导航 `/write/{sessionId}`，失败显示可重试错误，不创建伪 Session。
- [ ] 工作台服务端先加载最近成功 snapshot；左栏显示题目文字、明确的“题图将在后续导入”占位、实时字数和用时；中栏 TipTap 编辑器及保存状态；右栏只显示“AI 反馈将在后续阶段启用”，不创建反馈或评分数据。
- [ ] 编辑器每次变化同步更新本地正文、纯文本字数和计时显示，不等待保存或 AI。字数计算复用 Phase 1 规则，避免 UI 与 revision 不一致。
- [ ] `useWritingTimer` 注入时钟/interval adapter；页面隐藏时暂停本地累计并尝试 flush 当前草稿，恢复可见时继续。刷新后从最后成功 timer snapshot 恢复。
- [ ] 三栏桌面布局按左/中/右呈现；窄屏按题目 → 编辑器 → 状态纵向排列。关键元素提供 `role` 或稳定 `data-testid`: `start-task-1`、`task-image-placeholder`、`essay-editor`、`word-count`、`writing-time`、`save-status`。
- [ ] 运行：

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

**Expected:** 构建成功；写作页面不读取分数、Memory、Task Context 或 AI feedback。

### Task 8：完成主流程与 AI 降级独立验收准备

**Files:**
- Create: `tests/e2e/writing-main-flow.spec.ts`
- Create: `tests/e2e/writing-ai-degraded.spec.ts`
- Create: `tests/unit/writing-ai-isolation.test.ts`
- Modify: `src/ports/test-observation.port.ts`
- Modify: `src/testing/test-observation.adapter.ts`

- [ ] Playwright 先写失败流程：打开首页 → 点击开始 → 看到空白编辑器/题目占位 → 输入跨段正文 → 字数立即变化 → 用时推进 → 等待 `SAVED` → 刷新 → 正文、字数和最后成功 revision 恢复。
- [ ] 增加保存失败流程：阻断一次 draft API，确认编辑与字数继续工作、状态为保存失败；恢复 API 后继续输入并成功保存，刷新恢复最新成功正文。
- [ ] AI 隔离单元测试装配会抛错的 `LLMPort`/`JobPort` doubles，同时执行创建、编辑保存和恢复；断言主链路成功且 AI doubles 调用数为 0。若复用 Phase 1 coordinator 注入失败，也必须证明其失败事件不会改变 revision 保存结果。
- [ ] 扩展 `TestObservationPort` 只读查询 Session 当前 revision、revision 数量及 `essay.revision_saved` 事件；返回值保持深冻结，仅测试环境启用。
- [ ] 运行：

```powershell
npm.cmd test -- writing-ai-isolation.test.ts --run
npm.cmd run test:e2e -- writing-main-flow.spec.ts writing-ai-degraded.spec.ts
npm.cmd test -- test-observation-port.test.ts --run
```

**Expected:** E2E 不使用固定 sleep，以保存状态或观测事件等待；AI 故障不阻断编辑、保存、恢复；独立验收可验证 revision 单调及最近成功正文。

### Task 9：全量回归、范围审计与交接

**Files:**
- Modify: `CHANGELOG.md`
- Optional create only on approved deviation: `docs/IMPLEMENTATION_NOTES_PHASE_2.md`

- [ ] 运行完整门禁：

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test -- --run
npm.cmd run test:e2e
npm.cmd run build
npm.cmd test -- --run --coverage
```

- [ ] 检查 `git diff --check`，确认三份公共文档和 `tests/unit/phase-1-independent-acceptance.test.ts` 未修改。
- [ ] 扫描生产源码和依赖，确认无 OpenAI/真实 LLM、Task Context 识图、句段 AI 反馈、评分、Student Memory 或教师知识库实现。
- [ ] `CHANGELOG.md` 追加完成/阻塞记录，写明各 Task 测试证据、覆盖率、实现偏差和下一责任 AI。

**Expected:** 所有门禁退出码 0；Phase 1 全部 35 项及独立验收 8 项无回归；Phase 2 新增领域/应用代码 statements 与 lines 不低于 90%，保存并发、失败和恢复关键分支 100% 覆盖。

## 5. Definition of Done

Phase 2 只有同时满足以下条件才可声明完成：

1. 首页可创建且只创建一个 DRAFT Essay Session，并导航到稳定 session URL。
2. 工作台按架构呈现三栏信息层级；题目文字和题图占位可见，编辑器初始为空；写作阶段无评分和学习档案。
3. 输入无需等待网络或 AI 即时显示；字数与 Phase 1 revision 规则一致，用时由可注入时间源确定。
4. 自动保存采用 800 ms 防抖、单飞请求、最新草稿合并、mutation 幂等和 revision CAS；旧响应不能覆盖新结果。
5. 每次成功保存生成不可变、深冻结、单调递增 revision；session 当前指针与 revision/event 在同一事务提交。
6. 保存失败或冲突有明确非阻断状态；失败事务不移动当前 revision，不丢失浏览器中的未保存正文。
7. 刷新、关闭后重新访问 session URL、重启本地数据库连接，均恢复最近一次成功正文、字数和已保存计时快照。
8. 写作、保存和恢复代码不依赖 `LLMPort`/`JobPort`；AI double 超时/失败时主链路仍完全可用且不产生伪反馈。
9. `TestObservationPort` 可只读观测 session、当前 revision、revision 数量和保存事件，保持测试环境限定及深层不可变。
10. Vitest、Phase 1 独立验收、Playwright、typecheck、lint、build、coverage 全部通过；无 `.only`、`.skip`、真实 sleep 或网络 AI 调用。
11. 未实现或声称完成真实题图上传/识图、句段 AI 反馈、IELTS 评分、Student Memory、教师知识库或其他 Phase 2 外功能。
12. `CHANGELOG.md` 已追加实施状态；任何架构契约冲突已停止并上报，没有修改 PRD、架构或 Acceptance Criteria。

## 6. 测试 AI 交接点

测试 AI 应独立执行并取证：

- **AC-01 子集：** 首页入口、Session 创建、题目文字/题图占位、空白编辑区；报告中明确真实上传和识图未在本阶段验收。
- **AT-03 / AC-03：** 输入时字数/用时不等待保存；成功保存后刷新恢复；保存失败后编辑不阻断；恢复后只出现最近成功 revision。
- **并发与持久化：** 800 ms 边界、快速连续输入、保存中继续输入、重复 mutation、旧 revision 冲突、数据库重开、失败事务回滚。
- **AI 隔离：** 注入超时/失败 doubles 后验证创建、编辑、保存、刷新恢复仍成功，并确认 LLM/Job 零调用或失败事件不污染 revision。
- **可观测证据：** `essay.session_created`、`essay.revision_saved` 完整 envelope；revisionNo 单调；currentRevisionId 只指向已提交事务；Observation 深层只读。
- **回归：** Phase 1 全量单元与 `tests/unit/phase-1-independent-acceptance.test.ts` 必须保持通过。

建议缺陷分级：正文丢失、旧保存覆盖新正文、刷新恢复错误、AI 故障阻断编辑/保存为 P0/P1；保存状态文案或响应式布局局部偏差按影响定为 P2/P3。测试 AI 完成独立报告前，不进入题图理解或任何 AI 阶段。

## 7. 建议提交切分

1. `chore: add phase 2 persistence and ui test tooling`
2. `feat: add essay session creation and timer model`
3. `feat: add revision save and restore services`
4. `feat: add local drizzle essay repository`
5. `feat: add writing session api`
6. `feat: add resilient autosave controller`
7. `feat: build task 1 writing workspace`
8. `test: cover writing flow and ai degradation`

每个提交只包含对应 Task 与 `CHANGELOG.md` 记录；不得混入其他 AI 的未提交文档变更。计划获总指挥确认前停止，不安装依赖、不创建数据库、不修改业务代码。
