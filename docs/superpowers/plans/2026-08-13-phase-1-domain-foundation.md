# 第一阶段领域基础 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可运行、可测试且不依赖真实外部服务的 Next.js/TypeScript 项目骨架，冻结 Essay/Revision、句子/段落完成检测、异步幂等与事件观测所需的第一阶段领域契约。

**Architecture:** 使用单一 Next.js 模块化单体，但第一阶段只实现与框架无关的领域包、端口和测试替身；应用层通过端口协调领域状态机，不直接依赖 OpenAI、Supabase、Trigger.dev 或浏览器计时器。领域事件作为唯一可审计观测面，`TestObservationPort` 只读且仅在测试组合根中装配。

**Tech Stack:** Next.js App Router、TypeScript strict、Zod、Vitest、ESLint；不接真实 LLM、数据库、对象存储或任务平台。

---

## 1. 第一阶段边界

### 包含

- 项目基础骨架、TypeScript/Vitest/lint 配置和最小健康页；
- 核心 ID、时间、Essay、Revision、Segment、Analysis、Feedback 与 Domain Event Schema；
- Essay/Revision 生命周期及不可变 revision 快照；
- 句子 1.5 秒、段落 3 秒的确定性完成检测、取消、跳过和 stale 判定；
- 可注入 `Clock`/`Scheduler`；可替换 `LLMPort`、`JobPort`、`StoragePort`；
- 内存存储、手动时钟/调度器、可控 LLM/Job doubles；
- 只读 `TestObservationPort`；事件 envelope、reason code、幂等键与 stale 依赖快照；
- 对应 Vitest 单元/契约测试。

### 明确不包含

- OpenAI 或任何真实 LLM 调用、Prompt、结构化输出修复；
- IELTS 四维评分及评分页面；
- Student Memory、证据投影、tombstone 或重算实现；
- 教师知识库、真实 Supabase/Trigger.dev/对象存储适配器；
- 完整编辑器、上传、提交/删除用户流程及 Playwright 验收。

第一阶段只为上述后续模块冻结可替换边界，不改变 `docs/PRODUCT_REQUIREMENTS_MVP.md`、`docs/ARCHITECTURE.md` 或 `docs/ACCEPTANCE_TEST_PLAN_MVP.md` 的公共契约。

## 2. 目录与文件清单

```text
.
├─ package.json
├─ package-lock.json
├─ tsconfig.json
├─ next.config.ts
├─ eslint.config.mjs
├─ vitest.config.ts
├─ app/
│  ├─ layout.tsx
│  └─ page.tsx
├─ src/
│  ├─ domain/
│  │  ├─ shared/
│  │  │  ├─ ids.ts
│  │  │  ├─ clock.ts
│  │  │  ├─ hash.ts
│  │  │  └─ errors.ts
│  │  ├─ events/
│  │  │  ├─ event-types.ts
│  │  │  ├─ domain-event.schema.ts
│  │  │  ├─ reason-codes.ts
│  │  │  └─ event-factory.ts
│  │  ├─ essay/
│  │  │  ├─ essay.schema.ts
│  │  │  ├─ essay-state-machine.ts
│  │  │  ├─ revision.schema.ts
│  │  │  ├─ revision-service.ts
│  │  │  └─ dependency-snapshot.schema.ts
│  │  ├─ analysis/
│  │  │  ├─ analysis.schema.ts
│  │  │  ├─ idempotency-key.ts
│  │  │  └─ stale-result-policy.ts
│  │  ├─ completion/
│  │  │  ├─ completion.schema.ts
│  │  │  ├─ sentence-completion-machine.ts
│  │  │  ├─ paragraph-completion-machine.ts
│  │  │  └─ paragraph-completeness.ts
│  │  └─ feedback/
│  │     └─ feedback.schema.ts
│  ├─ application/
│  │  ├─ sentence-check-coordinator.ts
│  │  └─ paragraph-check-coordinator.ts
│  ├─ ports/
│  │  ├─ llm.port.ts
│  │  ├─ job.port.ts
│  │  ├─ storage.port.ts
│  │  └─ test-observation.port.ts
│  └─ testing/
│     ├─ manual-clock.ts
│     ├─ manual-scheduler.ts
│     ├─ controlled-llm.fake.ts
│     ├─ controlled-job.fake.ts
│     ├─ in-memory-storage.fake.ts
│     ├─ in-memory-event-recorder.ts
│     ├─ test-observation.adapter.ts
│     └─ fixtures.ts
└─ tests/unit/
   ├─ domain-event.schema.test.ts
   ├─ essay-state-machine.test.ts
   ├─ revision-service.test.ts
   ├─ idempotency-key.test.ts
   ├─ stale-result-policy.test.ts
   ├─ sentence-completion-machine.test.ts
   ├─ paragraph-completion-machine.test.ts
   ├─ port-contracts.test.ts
   └─ test-observation-port.test.ts
```

职责约束：`src/domain` 不导入 Next.js 或具体适配器；`src/application` 只依赖领域模块和端口；`src/testing` 不被生产组合根导入。`StoragePort` 第一阶段只暴露完成这些状态机所需的事务、revision、analysis、幂等记录和事件追加能力，不预先定义评分或 Memory 仓储方法。

## 3. 先写测试的顺序

1. `domain-event.schema.test.ts`：先冻结公共事件 envelope 和结构化 reason code。
2. `essay-state-machine.test.ts`、`revision-service.test.ts`：先固定合法生命周期、revision 单调性与快照不可变性。
3. `idempotency-key.test.ts`、`stale-result-policy.test.ts`：先固定 `scope + revision_id + input_hash + prompt_version` 和“只比较必要依赖”的规则。
4. `sentence-completion-machine.test.ts`：覆盖 AT-04、AT-06 的 1499/1500 ms、即时触发、取消、重放和晚到结果。
5. `paragraph-completion-machine.test.ts`：覆盖 AT-07 的 2999/3000 ms、完整性门槛、手动绕过、取消和依赖变化。
6. `port-contracts.test.ts`：用同一套契约验证 fake 的暂停、释放、失败、重复、乱序和幂等行为。
7. `test-observation-port.test.ts`：证明只读查询、correlation ID 过滤、事件顺序，以及非测试环境拒绝装配。

每个测试文件遵循 Red → Green → Refactor；先运行单文件确认因缺失实现而失败，再写最小实现，不通过放宽断言处理失败。

## 4. 实施顺序与逐步验收

### Task 1：建立项目骨架和质量门禁

**创建：** `package.json`、`package-lock.json`、`tsconfig.json`、`next.config.ts`、`eslint.config.mjs`、`vitest.config.ts`、`app/layout.tsx`、`app/page.tsx`。

- [ ] 初始化 Next.js App Router + strict TypeScript，脚本固定为 `dev`、`build`、`lint`、`typecheck`、`test`、`test:watch`。
- [ ] 配置 Vitest 使用 Node 环境、显式测试 glob 和 fake timer 隔离；不引入浏览器或真实网络。
- [ ] 健康页只标识项目可运行，不实现 MVP UI。
- [ ] 运行 `npm run typecheck`、`npm run lint`、`npm test -- --run`、`npm run build`。

**验收：** 四条命令退出码均为 0；测试命令在尚无测试时必须配置为成功或在本任务加入最小配置测试；生产依赖中没有 OpenAI、Supabase、Trigger.dev、TipTap。

### Task 2：冻结基础 Schema 与事件契约

**测试先行：** `tests/unit/domain-event.schema.test.ts`。

**创建：** `src/domain/shared/{ids,clock,hash,errors}.ts`、`src/domain/events/{event-types,domain-event.schema,reason-codes,event-factory}.ts`、`src/domain/essay/{essay,revision,dependency-snapshot}.schema.ts`、`src/domain/analysis/analysis.schema.ts`、`src/domain/feedback/feedback.schema.ts`。

- [ ] 用 Zod 品牌字符串表达 UUID/稳定 ID，用 ISO 时间字符串表达可序列化时间；领域内部由 `Clock` 提供 `Date`。
- [ ] 冻结 Essay 状态至少包含 `DRAFT`、`SUBMITTED`、`DELETION_PENDING`、`DELETED`；Revision 为不可变快照并含 `revisionNo`、正文、字数、创建时间。
- [ ] 冻结 analysis 状态 `QUEUED | RUNNING | COMPLETED | RETRYABLE_FAILED | TERMINAL_FAILED | CANCELLED | STALE`，反馈状态与架构一致。
- [ ] 事件 envelope 必含 `eventId`、`eventType`、`aggregateType`、`aggregateId`、适用的 revision/segment/task-context ID、text/dependency hash、`occurredAt`、`correlationId`、`causationId`、`idempotencyKey`、`reasonCode`、版本化 payload。
- [ ] `event-types.ts` 至少声明本阶段会发出的 sentence/paragraph completion、requested、cancelled、skipped、result_stale 事件；其余已确认公共事件名称一并注册但不实现业务处理。

**验收：** 正向 fixture 全部 parse；缺少公共字段、未知事件版本、自由文本 reason code、非法状态均失败；`npm test -- domain-event.schema.test.ts --run` 通过；Schema 快照无敏感正文。

### Task 3：实现 Essay / Revision 状态模型

**测试先行：** `tests/unit/essay-state-machine.test.ts`、`tests/unit/revision-service.test.ts`。

**创建：** `src/domain/essay/essay-state-machine.ts`、`src/domain/essay/revision-service.ts`。

- [ ] 只允许 `DRAFT -> SUBMITTED -> DELETION_PENDING -> DELETED` 及 `DRAFT -> DELETION_PENDING -> DELETED`；非法迁移返回稳定领域错误码。
- [ ] `RevisionService.createNext` 根据当前 revision 创建 `revisionNo + 1` 快照，并重新计算正文 hash/字数；不允许修改旧对象。
- [ ] 当 Essay 为 `SUBMITTED`、`DELETION_PENDING` 或 `DELETED` 时拒绝新写作分析调度；本阶段不实现提交 intent 或删除事务。

**验收：** 合法迁移、非法回退、重复命令、revision 单调递增、输入对象未被修改全部通过；`npm test -- essay-state-machine.test.ts revision-service.test.ts --run` 通过。

### Task 4：实现幂等键与 stale 判定

**测试先行：** `tests/unit/idempotency-key.test.ts`、`tests/unit/stale-result-policy.test.ts`。

**创建：** `src/domain/analysis/idempotency-key.ts`、`src/domain/analysis/stale-result-policy.ts`。

- [ ] 幂等键从规范化的 `scope + revisionId + inputHash + promptVersion` 生成，字段顺序或对象键顺序不影响结果，任一语义字段变化必须改变结果。
- [ ] 句子依赖仅含目标句文本/边界及声明的必要上下文；无关句编辑不 stale。
- [ ] 段落依赖含目标段文本/边界、相邻摘要 hash、Task Context 版本、Memory 投影版本占位值；任一变化 stale。
- [ ] Essay 进入提交或删除状态时，运行结果一律 stale；返回结构化 `reasonCode` 和 expected/actual hash，不抛供应商错误文本。

**验收：** AT-06 的“无关句不误杀”和 AT-07 的四类依赖变化均有精确断言；相同输入重放键一致；`npm test -- idempotency-key.test.ts stale-result-policy.test.ts --run` 通过。

### Task 5：实现可注入时间与句子完成状态机

**测试先行：** `tests/unit/sentence-completion-machine.test.ts`。

**创建：** `src/domain/completion/completion.schema.ts`、`src/domain/completion/sentence-completion-machine.ts`、`src/application/sentence-check-coordinator.ts`、`src/testing/manual-clock.ts`、`src/testing/manual-scheduler.ts`。

- [ ] `Clock.now()` 和 `Scheduler.schedule/cancel` 为纯端口；测试推进时间不使用真实 sleep。
- [ ] 句末标点候选进入 `WAITING` 并调度 1500 ms；1499 ms 无请求，1500 ms 且依赖未变只请求一次。
- [ ] 光标离句、换行后开始下一句立即请求；同一 sentence hash 重放不得创建第二个有效任务。
- [ ] 等待期间目标句文本/边界变化，或 Essay 提交/删除，取消定时器并发 `sentence.check_cancelled`。
- [ ] 运行中结果经 Task 4 策略判 stale 时发 `sentence.result_stale`，不进入可展示结果集合。

**验收：** 对应 AT-04 全部分支和 AT-06 核心竞态通过；断言请求次数、状态和事件字段，而非日志文本；`npm test -- sentence-completion-machine.test.ts --run` 通过且用例无真实等待。

### Task 6：实现段落完成状态机

**测试先行：** `tests/unit/paragraph-completion-machine.test.ts`。

**创建：** `src/domain/completion/paragraph-completeness.ts`、`src/domain/completion/paragraph-completion-machine.ts`、`src/application/paragraph-check-coordinator.ts`。

- [ ] 自动候选进入 `WAITING` 并调度 3000 ms；2999 ms 无请求，3000 ms 只请求一次。
- [ ] 空段、占位符或不足一个完整句由确定性门槛跳过并发 `paragraph.check_skipped(INCOMPLETE)`。
- [ ] 用户“检查本段”立即请求且绕过完整性门槛。
- [ ] 等待期间段落文本/边界或 Essay 状态变化取消；运行后依赖快照变化发 `paragraph.result_stale`。
- [ ] 状态机只产生检查请求，不实现 LLM 候选内容、反馈排序或每段两条预算。

**验收：** AT-07 中触发、门槛、手动绕过、取消和 stale 全部在单元层通过；`npm test -- paragraph-completion-machine.test.ts --run` 通过。

### Task 7：定义端口并实现可控 fake / double

**测试先行：** `tests/unit/port-contracts.test.ts`。

**创建：** `src/ports/{llm,job,storage}.port.ts`、`src/testing/{controlled-llm.fake,controlled-job.fake,in-memory-storage.fake,fixtures}.ts`。

- [ ] `LLMPort` 接受供应商无关、版本化的结构化请求，返回结构化成功或稳定错误码；fake 可暂停、按调用释放、超时、网络失败、无效结构、重复和乱序完成。
- [ ] `JobPort` 支持 enqueue/cancel/status 与幂等键；fake 能保持 queued/running、重复投递、失败和乱序完成。
- [ ] `StoragePort.transaction` 原子保存 revision、analysis、幂等记录和领域事件；内存 fake 支持失败回滚与按 ID 查询，不提供评分或 Memory API。
- [ ] 所有 doubles 默认只记录 fixture ID/hash，不输出全文或密钥。

**验收：** 契约测试证明一次幂等键只有一个有效 job/result，重复/晚到完成可被协调器识别，事务失败无部分写入；`npm test -- port-contracts.test.ts --run` 通过。

### Task 8：实现只读 TestObservationPort

**测试先行：** `tests/unit/test-observation-port.test.ts`。

**创建：** `src/ports/test-observation.port.ts`、`src/testing/in-memory-event-recorder.ts`、`src/testing/test-observation.adapter.ts`。

- [ ] 暴露按 correlation/aggregate/event type 查询事件、analysis 状态、依赖 hash、幂等键和当前 Essay/revision 的只读快照。
- [ ] 接口不含 create/update/delete/advance/release 等写方法；返回深冻结副本，调用者修改不影响领域状态。
- [ ] 工厂只在 `NODE_ENV=test` 创建适配器，其他环境返回稳定配置错误。
- [ ] 支持等待“事件/状态达到条件”的测试 promise，由手动调度推进，不使用固定 sleep。

**验收：** 类型层和运行时均不能借观测端口写状态；查询顺序按 `occurredAt + eventId` 稳定；非测试环境装配失败；`npm test -- test-observation-port.test.ts --run` 通过。

### Task 9：全量回归与文档交接

**修改：** `CHANGELOG.md`。如实际命令或目录与本计划发生经批准的实现偏差，另建 `docs/IMPLEMENTATION_NOTES_PHASE_1.md` 记录，不静默修改公共契约。

- [ ] 运行 `npm run typecheck`、`npm run lint`、`npm test -- --run --coverage`、`npm run build`。
- [ ] 对照 AT-04、AT-06、AT-07、AT-09 的第一阶段适用部分建立测试名映射。
- [ ] 检查生产依赖和源码，确认没有真实 LLM、评分、Student Memory、教师知识库实现。
- [ ] 追加 `CHANGELOG.md` 完成记录，列出验证证据、已知风险和下一责任 AI（测试 AI 独立复验，架构 AI 评审 Schema/端口契约）。

**验收：** 所有命令退出码为 0；本阶段新增领域/应用代码行覆盖率不低于 90%，关键状态迁移和分支覆盖率 100%；无 `.only`、`.skip`、真实计时等待、网络访问或未处理占位符。

## 5. 第一阶段 Definition of Done

只有同时满足以下条件，第一阶段才可声明完成：

1. 根项目可 `npm run build`，TypeScript strict、lint、Vitest 全部通过。
2. 公共状态枚举、Zod Schema、事件 envelope、事件名和 reason code 与已确认架构一致，未修改 AC。
3. Essay/Revision 状态模型拒绝非法迁移，revision 不可变且单调递增。
4. 句子在 1499/1500 ms、段落在 2999/3000 ms 的边界测试稳定通过，无真实等待。
5. 句子/段落等待取消、运行结果 stale、必要依赖 hash 与无关编辑不误杀均有测试证据。
6. 幂等键按架构四元组生成；重复任务、重复回调和晚到结果只有一个有效结果。
7. `Clock`、`Scheduler`、`LLMPort`、`JobPort`、`StoragePort` 均可替换，可控 doubles 覆盖成功、暂停、失败、重复和乱序。
8. `TestObservationPort` 只读、仅测试环境启用，并能按 correlation ID 提供事件与状态证据。
9. 测试覆盖 AT-04、AT-06、AT-07 以及 AT-09 中适用的确定性/异步基础部分；未声称完成其余 MVP 验收。
10. 仓库中不存在真实 LLM 接入、评分、Student Memory 或教师知识库业务实现。
11. `CHANGELOG.md` 已追加实施完成/暂停/阻塞记录；任何偏差已上报总指挥，没有静默更改公共契约。
12. 测试 AI 可仅凭命令与 `TestObservationPort` 独立复验，架构 AI 可评审状态/事件/端口 Schema 后再批准进入第二阶段。

## 6. 建议提交切分

沿用当前 Git 历史的 Conventional Commit 风格：

1. `chore: scaffold nextjs domain workspace`
2. `feat: define domain schemas and events`
3. `feat: add essay revision state model`
4. `feat: add deterministic completion machines`
5. `test: add controllable port doubles`
6. `test: add readonly observation port`

实际编码前须由总指挥确认本计划；确认前停止，不创建上述源代码和配置。
