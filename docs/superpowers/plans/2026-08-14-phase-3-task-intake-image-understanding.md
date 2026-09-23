# Phase 3 Task Intake & Image Understanding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现真实 IELTS Academic Task 1 题图上传、原图持久可见、异步多模态识图、四类版本化 Task Context 与 fact-level 不确定性，并保证识图失败不阻断 Phase 2 写作主链路。

**Architecture:** 在现有 Next.js 模块化单体中新增独立 Task Intake 边界：`BlobPort` 以应用生成的 opaque UUID 管理私有原图，Task Intake Repository 以 request idempotency、active-attempt claim 和 CAS 原子维护任务、识图 attempt、不可变 Task Context version 与领域事件，`JobPort` 只调度可重放工作。既有 `LLMPort.execute` 完全不变，新增 `TaskContextLLMPort.executeTaskContext` 由 OpenAI Responses 基础设施适配器实现；任何下游只能通过稳定 `TaskContextResolution` 和 certainty guard 读取 accepted version，不能读取供应商原始 JSON。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript strict、Zod 4、Drizzle ORM、SQLite、OpenAI Responses API、Vitest、Playwright；本地文件系统 Blob adapter，未来对象存储通过同一 `BlobPort` 替换。

---

## 1. 范围、验收与固定决策

### 本阶段覆盖

- AC-01 剩余部分：真实单图上传、可选题目文字、处理状态、原图始终可见、四类题型完成后进入/继续使用 Writing Workspace。
- AC-02：fact 级 `CERTAIN | UNCERTAIN | UNAVAILABLE`、通俗限制说明、完全不可用时仍可编辑和保存。
- AT-01：动态图、静态图、流程图、地图的上传 → 排队 → 处理 → ready/degraded 路径。
- AT-02：超时、网络失败、拒绝、invalid JSON、Schema invalid 最终降级，主链路不阻断。
- AT-10 当前适用部分：Task Context 中所有语义事实具有稳定 `fact_id`、certainty 和 uncertainty category；提供下游保护函数，证明仅不确定/不可用事实不能被提升为确定依据。本阶段不实现 Intervention Policy 或 assessment UI。

### 明确不包含

- 句子/段落 AI feedback、IELTS 全文评分、Student Memory、教师知识库；
- 多图题目、PDF、图片裁剪编辑、OCR 人工修正、用户手动确认 Task Context；
- Supabase Storage、Trigger.dev、认证与多用户 UI；
- 修改 `docs/PRODUCT_REQUIREMENTS_MVP.md`、`docs/ARCHITECTURE.md`、`docs/ACCEPTANCE_TEST_PLAN_MVP.md` 或降低任何既有断言。

### 设计决策

1. 新增 `POST /api/task-intakes` multipart 入口，不破坏 Phase 2 JSON `POST /api/essays`；上传成功即创建 Session，用户可立即进入 Writing Workspace，识图状态异步更新。
2. 原图不经过公开文件路径。浏览器只访问 `GET /api/task-images/{blobId}`；路由必须先由 repository 验证该 blob 被当前可访问的 `writing_task` 引用，再从 `BlobPort` 读取并返回固定 MIME、长度、ETag 与 `private, no-store`。仅凭合法 blob UUID 不构成读取权限。
3. 单文件限制由产品边界固定为 PNG/JPEG/WEBP、10 MiB；不接受 GIF。供应商上限不能替代应用上限。
4. 每次初始处理或用户显式 retry 都创建新的 immutable analysis attempt；同一请求通过 request idempotency key 返回同一 attempt，task 同时只能有一个 active attempt。`inputHash` 参与 claim/CAS 和 stale 判断，但不设永久唯一约束，显式 retry 可对相同输入创建新 attempt 和新预算。
5. 单 attempt 在 adapter、processor 和 runner 所有层合计最多调用 LLM 2 次：首次 `ANALYZE`；TIMEOUT/NETWORK 可再 `ANALYZE` 一次；INVALID_JSON/INVALID_STRUCTURE 可 `REPAIR` 一次；REFUSAL/INCOMPLETE/TERMINAL 不重试。adapter 本身绝不重试；用户显式 retry 创建新 attempt，重新获得独立的两次预算。
6. accepted attempt 的每个终态产生一个不可变 version。`READY` 仅允许有效 context、全部 facts 为 CERTAIN 且无 limitation；`DEGRADED` 必须有有效 context、至少一个 CERTAIN fact，并含非确定 fact 或 limitation；`UNAVAILABLE` 必须 `context = null` 并保存稳定 limitation codes。version、task pointer/status CAS、attempt 终态与领域事件在同一 SQLite 事务提交。
7. Blob/SQLite 跨资源顺序固定为校验 → 应用生成 blobId → 幂等 Blob put → SQLite 创建事务 → commit 后 Job enqueue。数据库创建失败时，仅当本次 put 返回 CREATED 且 repository 再确认 blob 未被任何 writing_task 引用，才执行幂等 delete 补偿；若 put 为 ALREADY_EXISTS 或已有引用，禁止删除。Job enqueue 失败保留 UPLOADED，不伪造 QUEUED。
8. OpenAI 官方文档确认 Responses API 可使用 URL、Base64 data URL 或 Files API file ID 输入图像；本地 MVP adapter 使用 Blob bytes 生成 Base64 data URL，避免暴露本机 URL。Structured Outputs 使用 strict JSON Schema：根为 object，四类 union 位于 required `task` 字段；所有字段 required，语义缺失用 nullable；refusal/incomplete 单独映射。

## 2. 已冻结公共契约

以下契约已由 `docs/ARCHITECTURE.md` 第 4.10 节冻结，计划执行者不得另行解释或静默扩展：

1. 新增 `BlobPort`；应用生成 opaque UUID `blobId`，adapter 校验 UUID 后自行派生内部 key。端口不接受/返回路径、bucket、object key、URL 或签名。
2. 既有 `LLMPort.execute(LlmRequest): Promise<LlmResult>`、`LlmRequest`、`LlmResult` 与 sentence/paragraph 测试完全不变。新增 `TaskContextLLMPort extends LLMPort` 和独立 `executeTaskContext(TaskContextLlmRequest)`；Task Context 生产请求不含测试专用 `fixtureId`。
3. `JobPort` 继续只负责通用幂等投递、取消和非权威运行状态；attempt、call count、retry、failure code 和 accepted 终态只以 Task Intake 数据库为事实来源。
4. `WritingTask` 只增加六个 nullable 字段 `imageBlobId/imageMediaType/imageSha256/intakeStatus/activeAttemptId/currentTaskContextVersionId`，保留 `imagePlaceholderKind` 及 Phase 2 创建/读取路径。历史 null 表示“未建立 Task Intake”，不是 FAILED、UPLOADED、QUEUED 或 PROCESSING。
5. accepted attempt 发布使用 active attempt + input hash CAS；成功事务同时插入 version、移动 pointer/status、写 attempt 终态与领域事件。duplicate/late/stale 返回不得插入 version/event 或移动 pointer。
6. 正式 SQLite 升级只接受 `drizzle-kit generate` 生成的 SQL、snapshot 和 journal；禁止只手写 SQL、修改旧迁移或手工伪造 metadata。

## 3. 文件结构

```text
app/
├─ api/
│  ├─ task-intakes/route.ts                         # multipart 上传、创建 Session、排队
│  ├─ task-intakes/[taskId]/route.ts                # 读取状态/version，显式 retry
│  └─ task-images/[blobId]/route.ts                 # 受控原图读取
└─ write/[sessionId]/page.tsx                       # 继续加载统一 workspace snapshot
src/
├─ domain/task-context/
│  ├─ task-context.schema.ts                        # 根对象 + 四类内部 union
│  ├─ task-context-version.schema.ts                # immutable version/resolution
│  ├─ task-intake-state-machine.ts                  # upload/processing/terminal transitions
│  └─ fact-certainty.ts                             # 下游 certainty guard
├─ application/task-intake/
│  ├─ task-intake.repository.ts                     # task/attempt/version 原子操作
│  ├─ create-task-intake.ts                         # Blob + Session + attempt + enqueue
│  ├─ process-task-context.ts                       # 调用预算、校验、发布/降级
│  ├─ get-task-intake.ts                            # UI/下游稳定 resolution
│  └─ retry-task-intake.ts                          # 显式 retry 与幂等
├─ ports/
│  ├─ blob.port.ts                                  # opaque UUID、稳定结果/错误
│  ├─ llm.port.ts                                   # 保持 Phase 1 原文件不变
│  ├─ task-context-llm.port.ts                      # extends LLMPort 的专用图像端口
│  └─ job.port.ts                                   # 不改公共状态语义
├─ infrastructure/
│  ├─ blob/local-filesystem-blob.adapter.ts         # 本地私有 blob root
│  ├─ llm/openai-task-context.adapter.ts            # Responses 多模态 + strict schema
│  ├─ jobs/local-task-context-job.adapter.ts        # 本地可控执行器
│  ├─ database/schema.ts                            # task/attempt/version 表
│  ├─ database/migrations/0002_task_intake.sql
│  └─ storage/drizzle-task-intake.repository.ts
├─ presentation/task-intake/
│  ├─ task-intake.types.ts                          # multipart/API DTO
│  ├─ task-intake-route-handlers.ts                 # 稳定状态码/错误码
│  ├─ task-intake-form.tsx                          # 上传 + 可选文字
│  └─ task-context-status.tsx                       # 原图、状态、通俗限制
└─ testing/
   ├─ in-memory-blob.fake.ts
   ├─ controlled-task-context-llm.fake.ts
   ├─ controlled-task-context-job.fake.ts
   └─ task-context-fixtures.ts
tests/
├─ fixtures/task-images/                            # 12 个小型匿名合成图
│  ├─ dynamic/{clear,uncertain,unavailable}.png
│  ├─ static/{clear,uncertain,unavailable}.png
│  ├─ process/{clear,uncertain,unavailable}.png
│  └─ map/{clear,uncertain,unavailable}.png
├─ fixtures/task-context-golden/                    # 与图片同名 JSON + 人工标注
├─ unit/
│  ├─ task-context-schema.test.ts
│  ├─ task-intake-state-machine.test.ts
│  ├─ fact-certainty.test.ts
│  ├─ create-task-intake.test.ts
│  ├─ process-task-context.test.ts
│  ├─ drizzle-task-intake.repository.test.ts
│  ├─ task-intake-api.test.ts
│  ├─ task-image-api.test.ts
│  ├─ openai-task-context.adapter.test.ts
│  └─ task-context-observation.test.ts
├─ integration/task-context-golden.test.ts          # 固定 adapter 回放；live 测试 opt-in
└─ e2e/task-intake-image-understanding.spec.ts
```

还需修改：`app/page.tsx`、`src/domain/essay/writing-task.schema.ts`、`src/application/essay-session.repository.ts`、`src/infrastructure/storage/drizzle-essay-session.repository.ts`、`src/presentation/writing/prompt-panel.tsx`、`src/presentation/writing/writing-workspace.tsx`、`src/presentation/writing/workspace.types.ts`、`src/domain/events/event-types.ts`、`src/domain/events/reason-codes.ts`、`src/ports/test-observation.port.ts`、`src/testing/test-observation.adapter.ts`、`src/infrastructure/database/repository-factory.ts`、`package.json`、`package-lock.json`、`.gitignore`、`CHANGELOG.md`。

## 4. 核心类型契约

### Task Context 根 Schema

```ts
const certaintySchema = z.enum(["CERTAIN", "UNCERTAIN", "UNAVAILABLE"]);
const uncertaintyCategorySchema = z.enum([
  "LABEL_UNREADABLE", "VALUE_AMBIGUOUS", "LEGEND_AMBIGUOUS",
  "TIME_RANGE_AMBIGUOUS", "STEP_AMBIGUOUS", "ARROW_AMBIGUOUS",
  "LOCATION_AMBIGUOUS", "DIRECTION_AMBIGUOUS", "IMAGE_QUALITY", "OTHER",
]);

const factSchema = z.object({
  factId: uuidSchema,
  statement: z.string().min(1).max(500),
  certainty: certaintySchema,
  uncertaintyCategory: uncertaintyCategorySchema.nullable(),
  evidence: z.object({
    regionLabel: z.string().max(120).nullable(),
    sourceText: z.string().max(240).nullable(),
  }).strict(),
}).superRefine((fact, context) => {
  if (fact.certainty !== "CERTAIN" && fact.uncertaintyCategory === null) {
    context.addIssue({ code: "custom", message: "UNCERTAINTY_CATEGORY_REQUIRED" });
  }
  if (fact.certainty === "CERTAIN" && fact.uncertaintyCategory !== null) {
    context.addIssue({ code: "custom", message: "CERTAIN_FACT_CATEGORY_MUST_BE_NULL" });
  }
});

const limitationCodeSchema = z.enum([
  "IMAGE_UNREADABLE", "TASK_TYPE_AMBIGUOUS", "LABELS_PARTIALLY_UNREADABLE",
  "VALUES_PARTIALLY_UNREADABLE", "LEGEND_UNCLEAR", "TIME_RANGE_UNCLEAR",
  "PROCESS_FLOW_UNCLEAR", "MAP_ORIENTATION_UNCLEAR", "NO_SAFE_CONTEXT",
]);

const dynamicTaskSchema = z.object({
  kind: z.literal("DYNAMIC_CHART"),
  chartType: z.enum(["LINE", "BAR", "AREA", "MIXED", "OTHER"]),
  timeAxisFactIds: z.array(uuidSchema), seriesFactIds: z.array(uuidSchema), changeFactIds: z.array(uuidSchema),
});
const staticTaskSchema = z.object({
  kind: z.literal("STATIC_CHART"),
  chartType: z.enum(["BAR", "PIE", "TABLE", "MIXED", "OTHER"]),
  categoryFactIds: z.array(uuidSchema), seriesFactIds: z.array(uuidSchema), comparisonFactIds: z.array(uuidSchema),
});
const processTaskSchema = z.object({
  kind: z.literal("PROCESS"),
  processType: z.enum(["LINEAR", "CYCLICAL", "NATURAL", "MAN_MADE", "MIXED"]),
  stageFactIds: z.array(uuidSchema), edgeFactIds: z.array(uuidSchema),
});
const mapTaskSchema = z.object({
  kind: z.literal("MAP"),
  mapType: z.enum(["PAST_PRESENT", "BEFORE_AFTER", "PROPOSED", "MULTI_PERIOD"]),
  locationFactIds: z.array(uuidSchema), changeFactIds: z.array(uuidSchema), directionFactIds: z.array(uuidSchema),
});

export const taskContextSchema = z.object({
  schemaVersion: z.literal(1),
  task: z.discriminatedUnion("kind", [dynamicTaskSchema, staticTaskSchema, processTaskSchema, mapTaskSchema]),
  title: z.string().max(240).nullable(),
  units: z.array(z.string().min(1).max(80)),
  facts: z.array(factSchema).min(1),
  limitations: z.array(limitationCodeSchema),
}).strict();
```

供应商 strict Schema 的所有 object 字段都必须 required；nullable 是字段值域的一部分，不得改回 optional。发布前额外验证：所有 `*FactIds` 唯一且存在于 `facts`；`factId` 无重复；limitations 只接受稳定 code；模型不能提供 version/id/status，这些字段只由服务端生成。

### 状态与稳定读取接口

```ts
type TaskIntakeStatus = "UPLOADED" | "QUEUED" | "PROCESSING" | "READY" | "DEGRADED" | "FAILED";
type TaskContextVersionStatus = "READY" | "DEGRADED" | "UNAVAILABLE";

interface TaskContextResolution {
  taskId: string;
  image: { blobId: string; mediaType: "image/png" | "image/jpeg" | "image/webp"; sha256: string };
  processingStatus: TaskIntakeStatus;
  taskContextVersionId: string | null;
  taskContextVersion: number | null;
  availability: "PENDING" | "READY" | "DEGRADED" | "UNAVAILABLE";
  context: TaskContext | null;
  limitationCodes: readonly TaskContextLimitationCode[];
  publicLimitationMessages: readonly string[];
}

export function certainFacts(resolution: TaskContextResolution): readonly TaskFact[] {
  return resolution.context?.facts.filter((fact) => fact.certainty === "CERTAIN") ?? [];
}
export function canUseAsSoleErrorEvidence(facts: readonly TaskFact[]): boolean {
  return facts.some((fact) => fact.certainty === "CERTAIN");
}
```

`publicLimitationMessages` 由 application mapper 按稳定 code 生成，模型与基础设施 adapter 不提供用户文案。状态验证规则固定为：

```ts
function validateResolutionStatus(status: TaskContextVersionStatus, context: TaskContext | null): void {
  const certainCount = context?.facts.filter((fact) => fact.certainty === "CERTAIN").length ?? 0;
  const hasNonCertain = context?.facts.some((fact) => fact.certainty !== "CERTAIN") ?? false;
  const hasLimitations = (context?.limitations.length ?? 0) > 0;
  if (status === "READY" && (!context || certainCount !== context.facts.length || hasLimitations)) throw new Error("READY_INCONSISTENT");
  if (status === "DEGRADED" && (!context || certainCount < 1 || (!hasNonCertain && !hasLimitations))) throw new Error("DEGRADED_INCONSISTENT");
  if (status === "UNAVAILABLE" && context !== null) throw new Error("UNAVAILABLE_INCONSISTENT");
}
```

## 5. 测试先行实施任务

### Task 1：Task Context Schema、四类边界与 certainty guard

**Files:**
- Create: `src/domain/task-context/task-context.schema.ts`
- Create: `src/domain/task-context/task-context-version.schema.ts`
- Create: `src/domain/task-context/fact-certainty.ts`
- Create: `tests/unit/task-context-schema.test.ts`
- Create: `tests/unit/fact-certainty.test.ts`
- Create: `src/testing/task-context-fixtures.ts`

- [ ] **Step 1: 写四类有效 fixture 和失败测试**

测试必须逐类断言 `kind`、专属 fact reference 字段、稳定 UUID；并拒绝顶层额外字段、重复/悬空 fact ID、非确定 fact 无 category、动态图混入 `stageFactIds`、地图混入 chart 字段。

- [ ] **Step 2: 运行红灯**

```powershell
npx.cmd vitest --run tests/unit/task-context-schema.test.ts tests/unit/fact-certainty.test.ts
```

Expected: FAIL，原因是 Schema/guard 尚不存在，不得用宽松 `z.record` 通过。

- [ ] **Step 3: 实现第 4 节完整 Schema 和交叉引用校验**

`TaskContextVersion` 固定字段：`id/taskId/version/status/context/schemaVersion/sourceImageSha256/promptVersion/model/createdAt/limitations`；`UNAVAILABLE` 必须 `context = null`，READY/DEGRADED 必须存在 context，并按第 4 节状态验证规则拒绝不一致组合。

- [ ] **Step 4: 运行绿灯与 Phase 1 typed snapshot 回归**

```powershell
npx.cmd vitest --run tests/unit/task-context-schema.test.ts tests/unit/fact-certainty.test.ts tests/unit/dependency-snapshot.test.ts tests/unit/paragraph-completion-machine.test.ts
npm.cmd run typecheck
npm.cmd run lint
```

Expected: 新测试通过；paragraph 的 `taskContextVersionId` 契约不变。

- [ ] **Step 5: 提交**

```powershell
git add src/domain/task-context src/testing/task-context-fixtures.ts tests/unit/task-context-schema.test.ts tests/unit/fact-certainty.test.ts
git commit -m "feat: define versioned task context schemas"
```

### Task 2：BlobPort、TaskContextLLMPort 与状态机

**Files:**
- Create: `src/ports/blob.port.ts`
- Create: `src/ports/task-context-llm.port.ts`
- Verify unchanged: `src/ports/llm.port.ts`
- Create: `src/domain/task-context/task-intake-state-machine.ts`
- Create: `src/testing/in-memory-blob.fake.ts`
- Create: `src/testing/controlled-task-context-llm.fake.ts`
- Modify: `src/testing/controlled-job.fake.ts`
- Test: `tests/unit/port-contracts.test.ts`
- Create: `tests/unit/task-intake-state-machine.test.ts`

- [ ] **Step 1: 写冻结端口契约的失败测试**

`tests/unit/port-contracts.test.ts` 必须先固定：既有 `ControlledLlmFake.execute` 与 sentence/paragraph 请求/成功结果原样通过；`TaskContextLLMPort` 另有 `executeTaskContext`；生产请求没有 `fixtureId`；Blob 同 ID/同 bytes+metadata 幂等，同 ID/不同内容稳定冲突，missing read/metadata 和重复 delete 具有稳定结果。

- [ ] **Step 2: 实现精确接口**

```ts
type BlobMetadata = { size: number; mediaType: AllowedTaskImageType; sha256: string };
type BlobPutResult = { status: "CREATED" } | { status: "ALREADY_EXISTS" };
type BlobReadResult = { status: "FOUND"; bytes: Uint8Array; metadata: BlobMetadata } | { status: "NOT_FOUND" };
type BlobMetadataResult = { status: "FOUND"; metadata: BlobMetadata } | { status: "NOT_FOUND" };
type BlobDeleteResult = { status: "DELETED" } | { status: "NOT_FOUND" };
class BlobPortError extends Error {
  constructor(readonly code: "INVALID_BLOB_ID" | "SIZE_MISMATCH" | "HASH_MISMATCH" | "CONTENT_CONFLICT" | "BLOB_UNAVAILABLE") { super(code); }
}
interface BlobPort {
  put(input: { blobId: string; bytes: Uint8Array; metadata: BlobMetadata }): Promise<BlobPutResult>;
  read(blobId: string): Promise<BlobReadResult>;
  metadata(blobId: string): Promise<BlobMetadataResult>;
  delete(blobId: string): Promise<BlobDeleteResult>;
}

interface TaskContextLlmRequest {
  attemptId: string;
  correlationId: string;
  promptVersion: string;
  schemaVersion: 1;
  inputHash: string;
  image: { mediaType: AllowedTaskImageType; bytes: Uint8Array };
  promptText: string | null;
  mode: "ANALYZE" | "REPAIR";
};
type TaskContextLlmResult =
  | { ok: true; value: unknown; model: string; responseId: string }
  | { ok: false; code: "TIMEOUT" | "NETWORK" | "INVALID_JSON" | "INVALID_STRUCTURE" | "REFUSAL" | "INCOMPLETE" | "TERMINAL" };
interface TaskContextLLMPort extends LLMPort {
  executeTaskContext(request: TaskContextLlmRequest): Promise<TaskContextLlmResult>;
}
```

adapter 校验 UUID 后内部派生 key；`read` 返回 bytes 深拷贝。覆盖 Job 同幂等键去重；Task Context fake 可暂停、invalid、refusal、乱序释放；状态只允许 `UPLOADED→QUEUED→PROCESSING→READY|DEGRADED|FAILED`，终态不可被晚到结果覆盖。

- [ ] **Step 3: 运行红灯，最小实现，再运行绿灯并证明 llm.port.ts 无 diff**

```powershell
npx.cmd vitest --run tests/unit/port-contracts.test.ts tests/unit/task-intake-state-machine.test.ts
npm.cmd run typecheck
git diff --exit-code -- src/ports/llm.port.ts
```

Expected: 所有 doubles 确定性运行，无真实 sleep；既有 sentence/paragraph LLM fixture 调用仍编译并通过。

- [ ] **Step 4: 提交**

```powershell
git add src/ports/blob.port.ts src/ports/task-context-llm.port.ts src/domain/task-context/task-intake-state-machine.ts src/testing tests/unit/port-contracts.test.ts tests/unit/task-intake-state-machine.test.ts
git commit -m "feat: add task intake port contracts"
```

### Task 3：Task Intake 应用服务、调用预算与竞态

**Files:**
- Create: `src/application/task-intake/task-intake.repository.ts`
- Create: `src/application/task-intake/create-task-intake.ts`
- Create: `src/application/task-intake/process-task-context.ts`
- Create: `src/application/task-intake/get-task-intake.ts`
- Create: `src/application/task-intake/retry-task-intake.ts`
- Modify: `src/domain/essay/writing-task.schema.ts`
- Modify: `src/application/essay-session.repository.ts`
- Create: `tests/unit/create-task-intake.test.ts`
- Create: `tests/unit/process-task-context.test.ts`
- Modify: `src/testing/in-memory-essay-session.repository.ts`

- [ ] **Step 1: 写 create 红灯测试**

断言合法图片先按 SHA-256/size/type 校验，应用生成 opaque UUID `blobId`，再执行 Blob put。若 put=CREATED 后 SQLite 创建失败，repository 确认无 writing_task 引用该 blob 后调用幂等 delete；若 put=ALREADY_EXISTS、已有引用或引用检查失败，禁止补偿删除并记录稳定补偿结果。SQLite commit 后才 enqueue；enqueue 失败时 task 保持可恢复 `UPLOADED` 而非伪造 QUEUED。相同 request idempotency key 返回同一 Session/Blob/attempt，不重复保存或重新获得预算。

- [ ] **Step 2: 写 processor 红灯测试**

使用 controlled doubles 覆盖：

- 第一次有效四类输出发布 version 1；
- 部分 uncertain 输出发布 DEGRADED；
- TIMEOUT/NETWORK 后同 attempt 只再 `ANALYZE` 一次；
- INVALID_JSON/INVALID_STRUCTURE 后第二次 `mode=REPAIR`；
- REFUSAL/INCOMPLETE/TERMINAL 不 retry；
- 两次失败发布 UNAVAILABLE version 和 FAILED task；
- call count 在发起每次调用前以 CAS 递增，任何路径均不得超过 2；adapter/fake 调用次数与数据库 call_count 一致；
- 用户显式 retry 使用新 request idempotency key 创建新 attempt、active-attempt claim 和独立两次预算；同 retry request 重放返回同 attempt；
- duplicate callback 不新增 version/event；旧 attempt 晚到不覆盖新 attempt/version；
- image hash/prompt/schema 变化导致旧结果 stale；
- Blob 缺失直接 UNAVAILABLE，不调用 LLM；
- 任一失败后既有 Essay revision 保存仍成功。

- [ ] **Step 3: 实现仓储语义与 processor**

```ts
interface TaskIntakeRepository {
  createIntake(input: CreateTaskIntakeTransaction): Promise<"CREATED" | "ALREADY_EXISTS">;
  claimAttempt(input: { taskId: string; attemptId: string; inputHash: string; idempotencyKey: string }): Promise<"CLAIMED" | "STALE" | "DUPLICATE">;
  claimLlmCall(input: { taskId: string; attemptId: string; inputHash: string; expectedCallCount: 0 | 1 }): Promise<"CLAIMED" | "BUDGET_EXHAUSTED" | "STALE">;
  publishAcceptedAttempt(input: PublishTaskContextVersion): Promise<"PUBLISHED" | "STALE" | "DUPLICATE">;
  markQueued(taskId: string, attemptId: string, jobId: string): Promise<void>;
  findResolution(taskId: string): Promise<TaskContextResolution | undefined>;
  isBlobReferenced(blobId: string): Promise<boolean>;
}
```

`publishAcceptedAttempt` 的 CAS 至少包含 `writing_tasks.active_attempt_id = attemptId` 与 attempt/input hash；成功时版本号取事务内 `MAX(version)+1`，并在同一事务完成 version 插入、task pointer/intake status、attempt 终态和唯一领域事件。CAS 失败返回 STALE；已接受同一 attempt 返回 DUPLICATE；两者均不得插入 version/event 或移动 pointer。application 先本地 Zod/交叉引用/状态一致性校验，再调用发布事务。

- [ ] **Step 4: 运行绿灯与 Phase 2 保存回归**

```powershell
npx.cmd vitest --run tests/unit/create-task-intake.test.ts tests/unit/process-task-context.test.ts tests/unit/save-essay-draft.test.ts tests/unit/writing-ai-isolation.test.ts
npm.cmd run typecheck
npm.cmd run lint
```

- [ ] **Step 5: 提交**

```powershell
git add src/application/task-intake src/domain/essay/writing-task.schema.ts src/application/essay-session.repository.ts src/testing/in-memory-essay-session.repository.ts tests/unit/create-task-intake.test.ts tests/unit/process-task-context.test.ts
git commit -m "feat: orchestrate task image understanding"
```

### Task 4：SQLite 版本化持久化与本地 Blob adapter

**Files:**
- Modify: `src/infrastructure/database/schema.ts`
- Create: `src/infrastructure/database/migrations/0002_task_intake.sql`
- Create: `src/infrastructure/storage/drizzle-task-intake.repository.ts`
- Create: `src/infrastructure/blob/local-filesystem-blob.adapter.ts`
- Modify: `src/infrastructure/database/repository-factory.ts`
- Modify: `.gitignore`
- Create: `tests/unit/drizzle-task-intake.repository.test.ts`
- Create: `tests/unit/local-filesystem-blob.adapter.test.ts`

- [ ] **Step 1: 写迁移/仓储红灯测试**

新增字段/表：

```text
writing_tasks: image_blob_id, image_media_type, image_sha256, intake_status,
               active_attempt_id, current_task_context_version_id
task_context_attempts: id, task_id, input_hash, prompt_version, schema_version,
                       idempotency_key, state, call_count, job_id, failure_code,
                       started_at, finished_at
task_context_versions: id, task_id, version, status, context_json nullable,
                       limitations_json, source_image_sha256, prompt_version,
                       schema_version, model, created_at
```

约束：保留 `UNIQUE(task_id, version)`；attempt 只对 request idempotency key 建立唯一约束，例如 `UNIQUE(task_id, idempotency_key)`。明确禁止 `UNIQUE(task_id, input_hash)`；input hash 只用于 active-attempt claim/CAS/stale。current pointer 只能指向同 task 的 accepted version。`writing_tasks` 六个新增字段 `image_blob_id/image_media_type/image_sha256/intake_status/active_attempt_id/current_task_context_version_id` 均 nullable；升级既有 Phase 2 数据后保持 placeholder 路径可读，六列全 null 映射为 `availability=PENDING` 且 UI 显示“尚未导入题图”，不得映射为 FAILED/PROCESSING。

- [ ] **Step 2: 覆盖事务、重复和重连**

测试发布中每个写点注入失败均回滚 version/pointer/attempt/event；两个连接竞争同 attempt 只有一个 PUBLISHED；重复 accepted callback 返回 DUPLICATE 且 version/event 数不变；active attempt 切换后旧 callback 返回 STALE；同 input hash 的显式 retry 可创建新 attempt；关闭重开后原图 metadata、终态和 version 可恢复。

- [ ] **Step 3: 实现 Blob adapter 安全边界**

Blob root 从 `LOCAL_BLOB_ROOT` 注入，内部 key 只能由 adapter 从已校验 UUID 派生；metadata sidecar 或 SQLite 保存 size/MIME/hash。写入使用临时文件 + 原子 rename；失败不留下可读取半文件；同 ID 同 metadata/bytes 返回 ALREADY_EXISTS，同 ID 内容冲突抛 `CONTENT_CONFLICT`；missing read/metadata 返回 NOT_FOUND，重复 delete 返回 NOT_FOUND。测试目录位于每用例临时根并清理。

- [ ] **Step 4: 用 drizzle-kit 正式生成升级迁移**

```powershell
npm.cmd run db:generate
npm.cmd run db:migrate
npx.cmd vitest --run tests/unit/drizzle-task-intake.repository.test.ts tests/unit/local-filesystem-blob.adapter.test.ts tests/unit/drizzle-essay-session.repository.test.ts
npm.cmd run typecheck
npm.cmd run lint
```

Expected: `drizzle-kit generate` 同时新增实际命名的 SQL、`meta/*_snapshot.json` 和 `_journal.json` entry；从 Accepted checkpoint 的 Phase 2 SQLite fixture 运行正式 migration 后旧 Session/placeholder 仍可读，新列为 null；再运行全新数据库路径验证同一 schema。不得只手写 SQL、手工编辑 snapshot/journal、修改 `0000/0001` 历史迁移或用 bootstrap 代替升级证据。

- [ ] **Step 5: 提交**

```powershell
git add .gitignore src/infrastructure tests/unit/drizzle-task-intake.repository.test.ts tests/unit/local-filesystem-blob.adapter.test.ts
git commit -m "feat: persist task images and context versions"
```

### Task 5：Multipart API、受控原图访问与稳定状态码

**Files:**
- Create: `src/presentation/task-intake/task-intake.types.ts`
- Create: `src/presentation/task-intake/task-intake-route-handlers.ts`
- Create: `app/api/task-intakes/route.ts`
- Create: `app/api/task-intakes/[taskId]/route.ts`
- Create: `app/api/task-images/[blobId]/route.ts`
- Create: `tests/unit/task-intake-api.test.ts`
- Create: `tests/unit/task-image-api.test.ts`

- [ ] **Step 1: 写 API 红灯测试**

`POST /api/task-intakes` 使用 `Request.formData()`，字段为 `image` 和可选 `promptText/clientRequestId`。状态码：201 成功；400 缺文件/多文件/空文件；413 超 10 MiB；415 非允许 MIME 或 magic bytes 不匹配；503 Blob/DB/job 不可用。响应只返回 `sessionId/taskId/status/imageUrl`，不返回本机路径、bytes、供应商错误或签名。

- [ ] **Step 2: 写读取与状态测试**

`GET /api/task-images/{blobId}`：先调用 repository `findAccessibleTaskByBlobId(blobId, developmentUserId)`；无引用、属于其他用户、task 不可访问或 blob 不存在均返回 404，避免枚举；只有授权引用存在才调用 BlobPort。成功返回 bytes/MIME/ETag 与 `Cache-Control: private, no-store`；非法 UUID 400；授权后 Blob 故障 503。测试用“Blob 存在但无 writing_task 引用”证明不能读取。`GET /api/task-intakes/{taskId}` 返回稳定 resolution；`POST ...?action=retry` 仅 FAILED/DEGRADED/UNAVAILABLE 可触发新 attempt，相同 request idempotency key 返回同 attempt，READY 返回 409 `TASK_CONTEXT_ALREADY_READY`。

- [ ] **Step 3: 实现 Next.js 16 Route Handler**

只使用 Web `Request/Response`；按仓库 `node_modules/next/dist/docs/.../15-route-handlers.md` 当前约定实现，不引入旧 Pages API。解析 multipart 后立即复制 bytes，不把 `File` 对象跨应用边界保存。

- [ ] **Step 4: 运行绿灯与既有 API 回归**

```powershell
npx.cmd vitest --run tests/unit/task-intake-api.test.ts tests/unit/task-image-api.test.ts tests/unit/writing-api.test.ts
npm.cmd run typecheck
npm.cmd run lint
```

- [ ] **Step 5: 提交**

```powershell
git add app/api/task-intakes app/api/task-images src/presentation/task-intake tests/unit/task-intake-api.test.ts tests/unit/task-image-api.test.ts
git commit -m "feat: expose task image intake API"
```

### Task 6：OpenAI Responses adapter 与本地 Job 执行器

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/infrastructure/llm/openai-task-context.adapter.ts`
- Create: `src/infrastructure/llm/task-context-output.schema.ts`
- Create: `src/infrastructure/jobs/local-task-context-job.adapter.ts`
- Create: `tests/unit/openai-task-context.adapter.test.ts`
- Create: `tests/unit/local-task-context-job.adapter.test.ts`

- [ ] **Step 1: 写 adapter 红灯测试，不访问网络**

注入 Responses client interface，捕获请求并断言：模型来自 `OPENAI_MODEL`，默认采用已批准 `gpt-5.6-luna`；`reasoning.effort="low"`；input 同时含题目文字与 Base64 `input_image`；detail 明确为 `original`；`text.format` 为 strict JSON Schema；不把原图、Base64、API key 或完整模型输出写日志。

- [ ] **Step 2: 覆盖供应商结果映射**

解析成功 → `ok:true`；refusal → REFUSAL；incomplete → INCOMPLETE；超时/网络错误 → 对应稳定 code；SDK parse 失败 → INVALID_JSON；本地 Zod/引用校验失败 → INVALID_STRUCTURE。对每种失败断言 Responses client 只被调用一次；adapter 不重试、不 repair、不读取或修改 attempt call_count，预算与第二次调用只由 application processor 在数据库 claim 后控制。

- [ ] **Step 3: 实现 strict 输出 Schema 转换**

供应商 schema 根必须是 object，`task` 内部使用 discriminated union/JSON Schema `anyOf`；每个 object 均 `additionalProperties:false`，`required` 必须列出 properties 的全部键。`title`、`uncertaintyCategory`、`regionLabel`、`sourceText` 等语义可缺失值使用 `[type, "null"]`，不从 required 删除。limitations 只能输出稳定 enum code，禁止自由文本。适配器返回 unknown，领域 Zod/交叉引用/状态一致性仍为最终信任边界。

- [ ] **Step 4: 实现本地 Job adapter**

enqueue 同 idempotency key 返回同 handle；worker 从 repository 领取 attempt 后调用 processor；进程内异常映射 FAILED/UNAVAILABLE；重复执行和重启重放依赖数据库 claim，而不是内存状态。测试用 manual scheduler 释放 job，不使用真实等待。

- [ ] **Step 5: 运行绿灯与端口回归**

```powershell
npx.cmd vitest --run tests/unit/openai-task-context.adapter.test.ts tests/unit/local-task-context-job.adapter.test.ts tests/unit/port-contracts.test.ts
npm.cmd run typecheck
npm.cmd run lint
```

- [ ] **Step 6: 提交**

```powershell
git add package.json package-lock.json src/infrastructure/llm src/infrastructure/jobs tests/unit/openai-task-context.adapter.test.ts tests/unit/local-task-context-job.adapter.test.ts
git commit -m "feat: connect multimodal task context processing"
```

### Task 7：上传 UI、Workspace 状态与失败可继续写作

**Files:**
- Create: `src/presentation/task-intake/task-intake-form.tsx`
- Create: `src/presentation/task-intake/task-context-status.tsx`
- Modify: `app/page.tsx`
- Modify: `src/presentation/writing/prompt-panel.tsx`
- Modify: `src/presentation/writing/writing-workspace.tsx`
- Modify: `src/presentation/writing/workspace.types.ts`
- Create: `tests/unit/task-intake-form.test.tsx`
- Modify: `tests/unit/writing-workspace.test.tsx`

- [ ] **Step 1: 写 UI 红灯测试**

首页必须有 label 清晰的单文件输入、可选题目文字、开始按钮；客户端只做即时 type/size 提示，服务端仍重复校验。上传中按钮不可重复提交；成功导航 session URL；失败保留已选说明并可重试，不伪造 Session。

- [ ] **Step 2: 写 Workspace 状态测试**

有 Task Intake 时左栏始终渲染真实 `<img data-testid="task-original-image">`；QUEUED/PROCESSING 显示真实状态，不显示 context；READY 显示题型摘要；DEGRADED 通过 application mapper 把稳定 limitation/uncertainty codes 映射为通俗文案，不显示置信度数字或模型自由文本；FAILED/UNAVAILABLE 显示“识别不可用，仍可继续写作，后续评价会受限”和 retry。历史 Phase 2 task 的六个 nullable 字段 `imageBlobId/imageMediaType/imageSha256/intakeStatus/activeAttemptId/currentTaskContextVersionId` 全为 null 时继续显示既有“题图将在后续导入”占位，不轮询、不显示失败/处理中。所有状态下 editor/autosave 保持可用。

- [ ] **Step 3: 实现轮询边界**

只在 QUEUED/PROCESSING 每 1 秒查询状态；终态停止；组件卸载取消；刷新直接从 server snapshot 恢复。轮询失败只显示状态刷新失败，不卸载编辑器、不清空正文、不改变 save controller。

- [ ] **Step 4: 运行绿灯、构建与 Phase 2 UI 回归**

```powershell
npx.cmd vitest --run tests/unit/task-intake-form.test.tsx tests/unit/writing-workspace.test.tsx tests/unit/autosave-controller.test.ts
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

- [ ] **Step 5: 提交**

```powershell
git add app/page.tsx src/presentation/task-intake src/presentation/writing tests/unit/task-intake-form.test.tsx tests/unit/writing-workspace.test.tsx
git commit -m "feat: add task image intake experience"
```

### Task 8：Golden fixtures、TestObservationPort 与独立验收证据

**Files:**
- Create: `tests/fixtures/task-images/**`
- Create: `tests/fixtures/task-context-golden/**`
- Create: `tests/integration/task-context-golden.test.ts`
- Create: `tests/e2e/task-intake-image-understanding.spec.ts`
- Modify: `src/ports/test-observation.port.ts`
- Modify: `src/testing/test-observation.adapter.ts`
- Create: `tests/unit/task-context-observation.test.ts`
- Modify: `package.json`

- [ ] **Step 1: 建立 12 组匿名合成 fixtures**

每类各 clear/uncertain/unavailable。Golden metadata 固定：fixtureId、kind、expectedCertainFacts、expectedUncertaintyCategories、forbiddenClaims、人工复核日期、schemaVersion、promptVersion、图片 SHA-256。图片不含姓名、版权水印或真实考试保密材料；单图小于 500 KiB。

- [ ] **Step 2: 扩展只读 TestObservationPort**

```ts
taskIntake(taskId: string): unknown | undefined;
taskContextVersions(taskId: string): readonly unknown[];
analysisAttempts(taskId: string): readonly unknown[];
```

返回深冻结副本，仅 `NODE_ENV=test` 可构造；不暴露 blob bytes、API key、Base64、供应商原始 response；事件可等待 `task.context_ready|task.context_degraded` 和失败终态事件。

- [ ] **Step 3: 完成固定回放 golden 测试**

默认 CI 使用 fixed LLM outputs，逐 fixture 验证 Schema、fact reference、certainty、forbidden claims 和版本记录。增加 opt-in `test:ai:golden`，仅在显式 `RUN_LIVE_AI_GOLDEN=1` 且有 API key 时运行真实模型；结果用于人工复核，不以逐字相等作为门禁，不在日志输出图片/Base64/完整响应。

- [ ] **Step 4: 完成 Playwright AT-01/AT-02**

流程一：上传四类 clear fixture → 原图可见 → PROCESSING → READY → 工作台编辑/保存/刷新仍见原图/context version。流程二：controlled LLM 同 attempt 两次失败 → accepted UNAVAILABLE version/context null → 错误说明来自稳定 code 且无置信度数字 → 编辑保存刷新成功。流程三：uncertain fixture → DEGRADED 且至少一个 CERTAIN fact → 通俗类别可见 → observation 证明 uncertain facts 未进入 `certainFacts()`。流程四：Accepted checkpoint 的历史 Phase 2 Session → 六个新增字段 null → 原占位与编辑保存行为不变。流程五：Blob 存在但无可访问 writing_task 引用 → 图片 API 404 且 BlobPort.read 未调用。

- [ ] **Step 5: 运行验收准备门禁**

```powershell
npx.cmd vitest --run tests/unit/task-context-observation.test.ts tests/integration/task-context-golden.test.ts
npm.cmd run test:e2e -- tests/e2e/task-intake-image-understanding.spec.ts
npx.cmd vitest --run tests/unit/phase-1-independent-acceptance.test.ts
npm.cmd run test:unit
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
git diff --check
```

Expected: Phase 3 新测试通过；Phase 1 8/8 与 Phase 1+2 全量测试无回归；Playwright 包含 Phase 2 原主流程和 Phase 3 新流程。

- [ ] **Step 6: 提交**

```powershell
git add tests/fixtures tests/integration tests/e2e src/ports/test-observation.port.ts src/testing/test-observation.adapter.ts tests/unit/task-context-observation.test.ts package.json
git commit -m "test: add task context acceptance coverage"
```

### Task 9：最终质量门禁与三方交接

**Files:**
- Modify: `CHANGELOG.md`
- Create during testing: `docs/PHASE_3_ACCEPTANCE_REPORT.md`（仅测试 AI 独立验收时创建，程序员 AI不得预写 Accepted）

- [ ] **Step 1: 程序员 AI 范围审计**

扫描不得出现 sentence/paragraph feedback、assessment、Student Memory、teacher knowledge 新业务实现；确认 PRD 与 Acceptance Criteria 无 diff，且实现阶段没有在架构 AI 已批准的 Phase 3 冻结契约之外继续修改 `docs/ARCHITECTURE.md`；确认 `.data/`、blob root、API key、模型响应、Playwright artifacts 未被跟踪。

- [ ] **Step 2: 完整门禁**

```powershell
npm.cmd run test:unit
npx.cmd vitest --run tests/unit/phase-1-independent-acceptance.test.ts
npm.cmd run test:e2e
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd audit --omit=dev
git diff --check
git status --short --branch --untracked-files=all
```

任何失败先定位根因并只修 Phase 3 范围；不得删除/放宽 Phase 1/2 测试。开发依赖 audit 风险单独记录，不冒充生产依赖结论。

- [ ] **Step 3: 架构 AI 契约复核交接**

交付：opaque UUID Blob 边界、稳定幂等/错误和 writing_task 引用授权；Blob/SQLite 孤儿补偿；既有 LLMPort 零修改与新增 TaskContextLLMPort；全 required/nullable 根 object/内部 union Schema；request idempotency、active-attempt claim、accepted version/pointer/attempt/event 原子事务；每 attempt 两次调用预算和显式 retry 新预算；late/duplicate/stale；READY/DEGRADED/UNAVAILABLE；下游 certainty guard；正式 Drizzle migration；本地 Job 与未来 Trigger adapter 边界。

- [ ] **Step 4: 测试 AI 独立验收交接**

测试 AI 必须独立复验 AC-01 剩余、AC-02、AT-01/02/10 当前部分；四类 clear/uncertain/unavailable golden；Blob 同 ID 幂等与内容冲突、missing/read/delete 稳定语义；无 writing_task 引用不可读取私有原图；数据库创建失败只清理本次 CREATED 且无引用的孤儿 blob；历史 nullable task 兼容；既有 LLMPort sentence/paragraph 零回归；TaskContext adapter 单次调用不重试；每 attempt 两次预算、显式 retry 新 attempt/新预算；invalid JSON/Schema invalid/timeout/network/refusal/incomplete/terminal；request idempotency、active claim、accepted 原子提交、duplicate/late/stale 零副作用；READY/DEGRADED/UNAVAILABLE 严格组合；正式 migration 从 Phase 2 数据升级的 SQL/snapshot/journal 证据；识别失败继续编辑保存；TestObservationPort 只读深冻结；Phase 1/2 全回归。程序员 AI 的结果只作交接信息，不作为 Accepted 结论。

- [ ] **Step 5: 追加 CHANGELOG 并停止**

记录交付物、门禁证据、已知风险、公共契约复核结果、未运行 live golden 的原因（如无 key）、下一责任 AI。不得开始 Phase 4 或任何 feedback/assessment/Memory 编码。

## 6. Definition of Done

- 单张 PNG/JPEG/WEBP 可真实上传；类型、magic bytes、10 MiB 限制由服务端执行。
- 应用生成 opaque UUID blobId，adapter 内部派生 key；Blob put/read/metadata/delete 的幂等、深拷贝、NOT_FOUND、CONTENT_CONFLICT 与稳定不可用错误均有契约测试。
- 原图写入 BlobPort，刷新/重启后仍通过受控 API 查看；API 先验证可访问 writing_task 引用，无引用即 404 且不读取 Blob；本地路径、object key、Base64、签名和密钥不出现在 DTO/日志。
- Blob put 与 SQLite create 跨资源顺序及孤儿补偿通过故障注入：只删除本次 CREATED 且再次确认无引用的 blob，ALREADY_EXISTS/已有引用/引用检查失败均不删除；enqueue 失败保留 UPLOADED。
- 上传后 Session 与空白编辑器可用；QUEUED/PROCESSING/READY/DEGRADED/FAILED 显式且可观测。
- WritingTask 仅 additive nullable 扩展；Accepted checkpoint 的历史 null 继续走 Phase 2 placeholder，不映射失败或处理中。
- 四类 Task Context 通过唯一版本化 Zod Schema；root object 与 OpenAI strict Structured Outputs 兼容；所有供应商字段 required，语义缺失只用 nullable。
- 每个事实有稳定 fact ID、certainty、必要 uncertainty category 和可定位 evidence；引用无悬空/重复。
- limitations 只保存稳定 category/reason code；用户文案只由 application mapper 产生，不保存或展示模型自由文本。
- READY/DEGRADED/UNAVAILABLE 严格符合冻结语义；accepted attempt 的 immutable version、task pointer/status CAS、attempt 终态和事件同一事务；duplicate/late/stale 不新增 version/event 或移动 pointer。
- 既有 `LLMPort.execute`、sentence/paragraph 请求与结果零修改；新增 `TaskContextLLMPort.executeTaskContext`，生产请求无 fixtureId。
- Task Context adapter 每次调用只调用供应商一次且不重试；每 attempt 所有层合计最多 2 次，timeout/network 再 ANALYZE、invalid JSON/structure 仅一次 REPAIR、refusal/incomplete/terminal 不重试；显式 retry 新建 attempt 和独立预算。
- attempt 使用 request idempotency key + active claim + input hash CAS；不含永久 `UNIQUE(task_id,input_hash)`，相同输入可显式 retry。
- DEGRADED/UNAVAILABLE 不阻断 Writing Workspace 编辑、自动保存、刷新恢复；UI 不显示内部置信度。
- 下游只经 `TaskContextResolution`/certainty guard 消费；仅 uncertain/unavailable facts 时 `canUseAsSoleErrorEvidence` 为 false。
- TestObservationPort 只读、深冻结、仅测试环境启用；可查 task 状态、attempt、versions、领域事件，不可读 blob bytes/供应商原始响应。
- 12 组四类 golden fixtures 有人工标注 metadata 和 SHA-256；默认固定回放稳定，live golden 仅显式 opt-in。
- 正式 SQLite 升级由 `drizzle-kit generate` 同时生成 SQL/snapshot/journal，并从非空 Phase 2 fixture 验证历史兼容；不修改旧迁移、不以 bootstrap 代替升级。
- Phase 1 独立验收、Phase 1+2 全量 Vitest、既有与新增 Playwright、typecheck、lint、production build、生产依赖 audit、diff check 全部通过。
- 测试 AI 独立验收与架构 AI 契约复核均有明确交接；确认前不宣称 Phase 3 Accepted。

## 7. 已知风险与非阻塞项

- LLM 预算、区域和数据保留仍是 MEMORY 中待决策项；本地开发可完成固定 adapter/golden 回放，但真实 live golden 或上线前必须由总指挥确认数据发送边界。
- 本地文件系统 adapter 只服务本地 MVP；部署到多实例环境前必须替换为共享对象存储，但 BlobPort 语义和测试向量保持不变。
- 模型可能产生结构合法但事实错误的输出；Schema 通过不等于事实正确，因此四类 golden 人工复核是发布门禁的一部分。
- 进程内本地 Job adapter 不能替代生产 durable queue；数据库 claim/idempotency 保证重放安全，未来 Trigger.dev adapter 必须复用相同 processor 和 attempt 契约。

## 8. Architecture Re-review 自检矩阵

| `docs/ARCHITECTURE.md` Phase 3 冻结契约 | 计划落实位置 | 自检结论 |
|---|---|---|
| 应用生成 opaque UUID blobId，adapter 内部派生 key | §1 决策 7；Task 2 接口；Task 4 adapter；DoD | 已落实；端口无 path/key/URL |
| Blob put/read/metadata/delete 幂等与稳定错误 | Task 2 `BlobPut/Read/Metadata/DeleteResult`、`BlobPortError`；Task 4；DoD/测试交接 | 已落实 |
| 私有读取先验证 writing_task 引用 | §1 决策 2；Task 5 `findAccessibleTaskByBlobId`；E2E 流程五；DoD | 已落实 |
| Blob put 与 SQLite create 的孤儿补偿 | §1 决策 7；Task 3 create 故障测试；DoD/测试交接 | 已落实，仅清理本次 CREATED 且无引用 blob |
| 既有 LLMPort.execute 与 sentence/paragraph 不变 | §2 契约 2；文件清单 Verify unchanged；Task 2 `git diff --exit-code`；DoD | 已落实 |
| 新增 TaskContextLLMPort extends LLMPort / executeTaskContext | §2；文件结构；Task 2 独立接口；Task 6 adapter | 已落实，不继承 `LlmRequest` |
| adapter 不重试；单 attempt 总预算最多 2 | §1 决策 5；Task 3 call-count CAS；Task 6 单调用断言；DoD | 已落实 |
| 显式 retry 新 attempt、新预算 | §1 决策 4/5；Task 3；Task 5 API；测试交接 | 已落实；相同 retry request 幂等 |
| WritingTask additive nullable，历史 null 非状态 | §2 契约 4；Task 4 migration；Task 7 UI；E2E 流程四；DoD | 已落实 |
| strict Structured Outputs 全字段 required，缺失用 nullable | §1 决策 8；§4 Schema；Task 6 schema 转换；DoD | 已落实；所有 properties 均列入 required |
| limitations 稳定 code，应用映射 UI 文案 | §4 `limitationCodeSchema`/resolution；Task 6；Task 7；DoD | 已落实，无模型自由文本 |
| 不使用永久 UNIQUE(task_id,input_hash) | §1 决策 4；§2 契约 5；Task 4 数据库约束；DoD | 已落实；只保留 input hash CAS/stale |
| request idempotency + active-attempt claim + CAS | §1 决策 4；Task 3 repository；Task 4 并发；DoD | 已落实 |
| accepted version/pointer/attempt/event 同事务 | §1 决策 6；Task 3 `publishAcceptedAttempt`；Task 4 故障注入；DoD | 已落实 |
| duplicate/late/stale 零 version/pointer/event 副作用 | §2 契约 5；Task 3；Task 4；测试 AI 交接 | 已落实 |
| READY/DEGRADED/UNAVAILABLE 严格语义 | §1 决策 6；§4 `validateResolutionStatus`；golden/E2E；DoD | 已落实 |
| drizzle-kit generate 生成 SQL/snapshot/journal | §2 契约 6；Task 4 Step 4；Task 9/DoD | 已落实；含非空 Phase 2 升级测试 |

自检未发现与 Phase 3 冻结公共契约的剩余冲突。若 architecture re-review 修改上述任一契约，必须先修订本计划并重新执行本矩阵，不得在编码中静默偏离。
