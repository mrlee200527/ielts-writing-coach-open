# Phase 1 Domain Foundation 独立验收报告

- 日期：2026-08-13（北京时间）
- 测试角色：测试 AI
- 验收结论：**不通过，退回程序员 AI 修复后复验**
- 依据：`docs/PRODUCT_REQUIREMENTS_MVP.md`、`docs/ARCHITECTURE.md`、`docs/ACCEPTANCE_TEST_PLAN_MVP.md`、`docs/superpowers/plans/2026-08-13-phase-1-domain-foundation.md`

## 1. 执行摘要

程序员原有 10 个测试文件、26 项测试全部通过，`typecheck`、lint、production build 也通过；但测试 AI 新增的 8 项独立验收中 **7 项失败、1 项通过**。失败覆盖 AT-04、AT-06、AT-07、AT-09 及 Phase 1 Definition of Done 的事件观测、深层不可变性要求，因此本阶段不能验收通过。

本轮未修改 `src/`、配置或业务文档，仅新增独立验收测试、验收报告并追加 `CHANGELOG.md`。

## 2. 实际执行的验证

| 验证 | 结果 |
|---|---|
| 程序员原有 Vitest：10 文件、26 测试 | 通过 |
| 独立验收 Vitest：8 测试 | 7 失败、1 通过 |
| `npm run typecheck` | 通过，0 错误 |
| `npm run lint` | 通过，0 错误 |
| `npm run build` | 通过，Next.js production build 成功 |
| 事务失败保留既有状态、撤销部分写入 | 通过 |

独立复现文件：`tests/unit/phase-1-independent-acceptance.test.ts`。

## 3. 缺陷清单

### DEF-P1-01 stale 判定误杀无关 revision 变化

- **等级：P1**
- **违反：** AC-04/AT-06；架构 5.2 第 4 条；Phase 1 Task 4/5 与 DoD 5。
- **复现：** 对句子 R1 启动检查；保持目标句 `textHash` 与 `dependencyHash` 不变，只把当前 `revisionId` 更新为 R2；调用 `acceptResult`。
- **预期：** 无关编辑不使结果 stale，不产生 `sentence.result_stale`。
- **实际：** 产生 `sentence.result_stale(DEPENDENCY_CHANGED)`。
- **根因证据：** coordinator 将整个请求对象传给通用 hash；`revisionId` 被错误纳入 stale 依赖，而不是只比较声明的句子 dependency snapshot。

### DEF-P1-02 重复候选计时器无法完整取消并产生重复请求

- **等级：P1**
- **违反：** AC-04、AC-06；AT-04、AT-07；架构 5.2 第 2/3 条、5.3 第 2 条；Phase 1 DoD 4/5/6。
- **复现 A：** 同一 sentence segment 连续两次创建 1.5 秒候选，随后文本变化并取消，再推进 1500 ms。
- **预期 A：** 所有旧计时器取消，请求数为 0。
- **实际 A：** 较早计时器仍执行，请求数为 1。
- **复现 B：** 同一 paragraph segment 连续两次自动候选，再推进 3000 ms。
- **预期 B：** 同一稳定输入只请求一次。
- **实际 B：** 产生两个段落请求。
- **根因证据：** `pending.set(segmentId, newTask)` 覆盖旧句柄前未取消旧任务；段落 coordinator 也没有请求幂等/去重保护。

### DEF-P1-03 completion coordinator 事件不可由 TestObservationPort 观测

- **等级：P1**
- **违反：** 架构第 10 节事件 envelope 与 TestObservationPort 契约；验收计划可测性要求 3/4；Phase 1 Task 2/5/6/8 与 DoD 2/8/12。
- **复现：** 触发 `sentence.check_requested`，将 coordinator 产生的事件交给冻结的 `domainEventSchema` 校验。
- **预期：** 事件包含 event/aggregate/revision/segment、时间、correlation、causation、idempotency、hash、reason code，可被 recorder/observation 查询。
- **实际：** coordinator 仅记录 `{ eventType, reasonCode }`，Schema 校验失败，也未接入 `InMemoryEventRecorder`。
- **根因证据：** 事件 Schema 和观察端口是孤立组件，实际 sentence/paragraph 协调器没有通过事件工厂/记录器发出可观测领域事件。

### DEF-P2-01 Revision 与 Observation 只提供浅层冻结

- **等级：P2**
- **违反：** Phase 1 Task 3“不可变快照”、Task 8“返回深冻结副本”、DoD 3/8；验收计划可测性要求 3。
- **复现：** 创建含嵌套 `content.blocks[0]` 的 revision；查询含嵌套 payload 的 observation event。
- **预期：** 根对象和所有嵌套对象/数组均不可修改，外部不能改变快照语义。
- **实际：** 仅 revision/event 根对象被冻结，`content`、`payload` 及嵌套对象未冻结。
- **根因证据：** 两处均只调用一次 `Object.freeze(root)`，未递归冻结。

### DEF-P1-04 Job double 允许晚到/重复完成覆盖终态结果

- **等级：P1**
- **违反：** AT-09 Phase 1 适用部分；架构非功能要求“异步任务幂等”；Phase 1 Task 7 与 DoD 6/7。
- **复现：** job 进入 RUNNING，先完成为结果 A，再以相同 job ID 晚到完成结果 B。
- **预期：** 首个有效终态结果保持为 A，重复/晚到完成被拒绝或明确标记无效。
- **实际：** 状态仍为 COMPLETED，但结果被 B 覆盖。
- **根因证据：** `complete` 无状态迁移守卫，直接覆盖 map 中已有终态。

## 4. 已通过能力

- 句子单一候选的 1499/1500 ms 边界、光标离句和下一句即时触发；
- 段落单一候选的 2999/3000 ms 边界、INCOMPLETE 跳过、手动绕过及单一取消；
- `Clock`/`Scheduler` 可注入，测试无需真实等待；
- Essay 合法/非法状态迁移及 analysis 非 DRAFT 拒绝；
- revision 编号单调、正文/内容创建时复制、字数/hash 生成；
- LLM double 可暂停并按调用乱序释放，稳定错误码可注入；
- Storage 事务失败时撤销部分写入且不污染事务前状态；
- TestObservationPort 非测试环境拒绝装配，顶层返回对象只读；
- 幂等键四元组的基本稳定性、Job enqueue 相同 key 去重。

## 5. 本轮不验的 MVP AC

Phase 1 尚未实现完整 UI/API、真实 AI 工作流与后续领域模块，因此本轮不验：

- AC-01、AC-02、AC-03 的题图导入、工作台 UI、自动保存与恢复；
- AC-05 的实际拼写/语法反馈内容；
- AC-06 的反馈排序、每段两条上限与禁止整段答案；
- AC-07 全部反馈预算、去重、忽略和跨刷新抑制；
- AC-08 提交 intent、少于 150 词确认与冻结评分；
- AC-09 全文评分页面；
- AC-10 Student Memory；
- AC-11 作文与学习记录删除；
- AT-09 的真实超时策略、JSON/Schema 修复调用、UI 降级和评分失败状态。

## 6. 修复与复验要求

程序员 AI 应保留并使 `tests/unit/phase-1-independent-acceptance.test.ts` 全部通过，同时确保原 26 项测试、typecheck、lint、coverage 和 build 不回归。修复应覆盖根因：使用显式 dependency snapshot 判 stale；替换候选前取消旧计时器并对段落请求幂等；将 coordinator 事件接入完整 envelope/recorder；实现深层不可变副本；为 Job terminal transition 增加保护。

修复完成后交测试 AI 重跑 Phase 1 全量验收。修复前不建议进入下一阶段，以免将竞态、观测和幂等缺陷带入真实异步 AI 工作流。

## 7. 复验记录（2026-08-13T23:29:35+08:00）

### 复验结论：Phase 1 Accepted

本节追加记录修复后的独立复验，不删除或改写上方历史失败结论。

五类缺陷全部通过独立回归：

1. **stale 必要依赖**：仅改变无关 `revisionId` 不再产生 stale；目标 segment、文本 hash 或依赖 hash 变化仍能识别 stale。
2. **重复候选取消与去重**：同一 sentence/paragraph segment 的旧计时器会被取消；重复稳定候选和相同请求键只产生一个请求。
3. **事件与观测**：completion coordinator 发出完整 `DomainEvent` envelope，事件可通过 `InMemoryEventRecorder` 和 `TestObservationPort` 查询，并携带稳定 reason code/关联字段。
4. **深层不可变性**：Revision content、Observation snapshot、事件 payload 的嵌套对象和数组均递归冻结。
5. **Job 终态保护**：Job double 只允许合法状态迁移；晚到或重复完成不会覆盖首个终态结果。

### 复验命令证据

| 命令 | 结果 |
|---|---|
| `npm test -- --run tests/unit/phase-1-independent-acceptance.test.ts --reporter=verbose` | 8/8 通过 |
| `npm test -- --run` | 11 个测试文件、35/35 通过 |
| `npm test -- --run --coverage` | 35/35 通过；Statements 95.45%、Branches 81.98%、Functions 96.34%、Lines 98.49% |
| `npm run typecheck` | 通过，0 错误 |
| `npm run lint` | 通过，0 错误 |
| `npm run build` | 通过，Next.js production build 成功 |

事务回滚复验仍通过：失败事务不会污染既有状态，也不会保留部分写入。

### 范围声明

本 Accepted 结论仅适用于 Phase 1 Domain Foundation 及 AT-04、AT-06、AT-07、AT-09 的第一阶段适用部分。AC-01、AC-02、AC-03、AC-05、AC-06 的完整反馈规则、AC-07 至 AC-11，以及真实 LLM、评分、Student Memory、删除流程仍按上方“本轮不验的 MVP AC”保留为后续阶段范围。

### 下一责任 AI

程序员 AI 可进入下一阶段实施；架构 AI 继续复核新增事件 emitter、依赖快照和状态迁移契约。测试 AI 在下一阶段交付后继续独立验收，不得将本报告的 Phase 1 Accepted 扩展解释为整个 MVP 已验收。

## 8. Typed Dependency Snapshot 契约复验（2026-08-14T09:25:45+08:00）

### 结论：Typed dependency snapshot 缺口 Closed；Phase 1 仍为 Accepted

本节追加记录架构 AI 指出的 typed snapshot 契约缺口及修复后的独立回归，保留前述首次失败、修复和复验历史。

独立验证结果：

1. sentence 与 paragraph coordinator 在候选调度、请求和结果接收入口均执行对应 strict Zod Schema 校验；
2. sentence 的 `textHash`、`boundaryHash`、`contextHash` 任一单独变化均产生 stale；
3. paragraph 的 `textHash`、`boundaryHash`、`adjacentSummaryHash`、`taskContextVersionId`、`memoryProjectionVersion` 任一单独变化均产生 stale；
4. 无关 `revisionId` 与 snapshot 外的无关正文属性变化不产生 stale；
5. 缺失、非法或正文与 paragraph `textHash` 不一致的 snapshot 在任务调度前被拒绝；
6. canonical snapshot hash 对字段顺序不同但语义等价的输入保持稳定；
7. AT-04、AT-06、AT-07 和 Phase 1 独立验收无回归。

### 新鲜命令证据

| 命令 | 结果 |
|---|---|
| typed snapshot + sentence/paragraph + stale + 独立验收针对性 Vitest | 5 文件、33/33 通过 |
| Phase 1 独立验收 | 8/8 通过 |
| `npm test -- --run` | 12 文件、49/49 通过 |
| `npm run typecheck` | 通过，0 错误 |
| `npm run lint` | 通过，0 错误 |
| `npm run build` | 通过，Next.js production build 成功 |

下一责任 AI：程序员 AI。Phase 1 typed dependency snapshot 前置缺口已闭环，可开始已批准的 Phase 2；测试 AI 在 Phase 2 交付后独立验收 Writing Main Flow 范围。
