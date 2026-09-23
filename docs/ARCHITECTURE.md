# 雅思作文助手第一版系统架构

- 状态：第一版架构基线，主要技术、范围与题图交互已确认
- 日期：2026-08-13（北京时间）
- 适用范围：IELTS Academic Writing Task 1 MVP，覆盖动态、静态、流程图和地图四类题目
- 架构原则：个人开发者可完成、本地优先、接口可替换、先模块化单体、证据驱动反馈、当前状态与长期记忆严格分离

## 1. 目标与边界

系统是写作过程中的 AI Coach，而不是只在交卷后给分的批改器。第一版支持：

1. Task 1 动态图、静态图、流程图、地图的题目文本与图片导入及自动结构化理解；
2. 句子完成后的轻量语言检查；
3. 段落完成后的结构、逻辑、数据比较和任务完成度分析；
4. 全文完成后的 IELTS 四维评分、证据和改进总结；
5. 基于干预策略决定“立即提醒、延迟观察或不提示”；
6. 从多次已完成写作中归纳学生长期学习状态。

第一版不包含：Task 2 完整支持、多人课堂、教师后台、课程售卖、复杂 RAG 平台、模型微调、实时多人协作和微服务拆分。教师视频和教学知识库预留正式接口，作为 MVP 主链路完成后紧接开展的下一阶段，不阻塞本轮核心写作流程。

## 2. 方案选择

### 方案 A：模块化单体 + 异步 AI 任务（采用）

一个 TypeScript 代码库承载 Web、API 和领域模块。当前本地版本通过接口使用本地持久化、文件存储和进程内任务执行器；部署时替换为 PostgreSQL/Supabase、对象存储和 Trigger.dev。部署简单，同时保留清晰模块边界，后续可按真实负载拆分。

### 方案 B：前端 + 独立 Python AI 服务

Python 生态适合复杂 NLP/RAG，但第一版会增加跨语言契约、两套部署和排障成本。教师知识库或离线评测成熟后再考虑引入。

### 方案 C：微服务 + 事件总线

扩展能力强，但会过早引入服务发现、分布式一致性、监控和部署成本，不符合个人开发者约束。

## 3. 总体架构

```text
Browser / Writing Workspace
  |  autosave, sentence event, paragraph event, submit
  v
Next.js Application (modular monolith)
  +-- Auth & Student Profile
  +-- Task Intake & Image Understanding
  +-- Essay Session / Editor State
  +-- Feedback Orchestrator & Intervention Policy
  +-- IELTS Assessment
  +-- Student Memory
  +-- Knowledge Sources
  +-- LLM Gateway
  |
  +--> StoragePort: local adapter -> PostgreSQL/Supabase adapter
  +--> BlobPort: local files -> object storage adapter
  +--> LLMPort: OpenAI Responses API / gpt-5.6-luna
  +--> JobPort: in-process runner -> Trigger.dev adapter
```

逻辑上分模块，物理上先不拆服务。模块间通过 TypeScript 接口和领域事件通信，禁止跨模块直接修改他方存储。外部能力必须通过 `StoragePort`、`BlobPort`、`JobPort` 和 `LLMPort` 接入，使本地实现与未来服务器实现共享领域逻辑。

## 4. 核心模块及职责

### 4.1 Writing Workspace

- 写作阶段采用三栏信息层级：左栏固定呈现题目、原图、题图不确定性、字数和用时；中栏只呈现编辑器、保存/检查状态及与当前文本锚定的单条高价值提示；右栏呈现当前反馈队列、段落检查状态和本篇帮助记录；
- 写作阶段不读取或展示预测分数、四维分数和完整学习档案；分数与长期总结仅在提交冻结并完成评分后进入结果页；
- 编辑器本地即时响应，按防抖自动保存；
- 通过显式事件表达候选完成、检查调度、失效、展示、忽略、提交冻结与删除；
- 不在浏览器中拼装评分 Prompt 或保存供应商密钥。

### 4.2 Task Intake & Image Understanding

- 保存题目文本和原始图片；
- 调用多模态模型生成结构化 `Task Context`；
- 标记低置信度与不确定数据，由系统自动重试或降级；
- 每次有效输出形成不可变版本，供所有后续分析引用，不要求学生人工确认。

`Task Context` 至少包含：任务类型、图表类型、标题、单位、时间范围、数据系列、可辨识数据点、总体趋势、显著比较、图片理解置信度及不确定项。

四类 Task Context 使用共同外壳与分类扩展：动态题记录时间序列与变化；静态题记录同一时点或无时间变化的分类比较；流程图记录步骤、方向、输入输出和循环；地图记录地点、方位、时间版本及新增、移除、迁移和用途变化。

### 4.3 Essay Session

- 管理一次写作的生命周期、正文版本、段落和句子边界；
- 保存目标分数、字数、计时、当前任务、最近分析版本；
- 维护乐观并发版本号，拒绝旧分析覆盖新文本；
- 只保存本次写作状态，不承担长期画像。

### 4.4 Feedback Orchestrator

- 接收句子、段落和全文事件；
- 根据事件选择规则检查或 LLM 工作流；
- 组装最小必要上下文，执行去重、缓存、超时与重试；
- 将候选问题交给 Intervention Policy，而非直接展示。

### 4.5 Intervention Policy

这是“适度帮助”的核心领域模块，独立于 LLM。每个候选反馈计算：

- 严重度：是否影响理解、任务完成或目标分数；
- 置信度：模型和规则是否有足够证据；
- 重复性：是否为同一会话或长期高频问题；
- 时机：句子、段落还是全文阶段更适合处理；
- 依赖风险：是否会直接替学生改写或一次暴露过多答案；
- 冷却与预算：同类反馈是否刚出现、本阶段最多显示几条。

输出只有 `SHOW_NOW`、`DEFER`、`OBSERVE`、`SUPPRESS`。MVP 使用可配置规则加 LLM 严重度标签，不训练推荐模型。所有决策保留原因，便于测试和调参。

反馈预算属于服务端持久化的 `essay_feedback_policy_state`，不能只存在浏览器内存：

- `active_sentence_feedback_id`：任一时刻最多一个处于 `SHOWN` 的句子反馈；新候选在其解除前进入 `DEFER` 或 `SUPPRESS`；
- `paragraph_shown_count[paragraph_id]`：每段主动展示上限为 2；用户主动展开历史反馈不增加主动预算；
- `shown_issue_keys`：同一作文内按稳定的 `issue_key = category + normalized_rule + target_scope` 去重；
- `consecutive_ignored_by_category`：同类主动反馈连续两次由 `SHOWN -> IGNORED` 后，将该类状态置为 `SUPPRESSED_FOR_ESSAY`；处理、采纳或明确关闭该类反馈会把连续忽略计数清零；
- 抑制只影响本篇的主动展示，不停止后台检查，不影响提交后的全文评分，也不跨作文继承；刷新后从持久化状态恢复。

单条反馈状态为 `CANDIDATE -> DEFERRED | SHOWN | SUPPRESSED | STALE`，已展示反馈再进入 `ACTED | IGNORED | DISMISSED`。每次迁移记录原因、触发者和时间。

### 4.6 IELTS Assessment

- 使用独立的官方评分标准版本评估 Task Achievement、Coherence and Cohesion、Lexical Resource、Grammatical Range and Accuracy；
- 每个分数必须附作文证据、置信区间或置信等级，不给无依据的精确结论；
- 全文评分与写作中提示分开，避免实时提示污染最终评分逻辑；
- 分数预测是学习参考，不宣称等同于官方考官成绩。

评分输入必须携带 `task_context_version_id` 与不确定性集合。涉及不确定题图事实的 Task Achievement 判断必须标记 `LIMITED_BY_TASK_CONTEXT`；该事实不得成为扣分或判错的唯一证据。若某维度的关键判断依赖不确定事实，仍可输出分数，但必须降低该维度确定性并在结果页列出受影响结论。

### 4.7 Student Memory

- 从已完成作文、已确认反馈和后续表现中归纳稳定模式；
- 维护高频错误、已掌握表达、薄弱技能、目标分数和进步趋势；
- 使用证据计数、首次/最近观察时间、置信度和状态，支持衰减与重新掌握；
- 仅向反馈编排器提供相关的少量摘要，不把完整历史塞入每次 Prompt。

学习档案使用可重算的证据投影：

- 每条 `memory_evidence` 必须引用不同的已完成作文；同一作文中的重复观察对“两篇证据”只计 1 篇；
- 高频问题至少需要 2 篇未删除、评分/分析已完成作文的同类有效证据；少于 2 篇时只保留内部 `OBSERVED` 证据，不向用户显示长期标签；
- 用户可见状态为 `FREQUENT_ISSUE`、`IMPROVING`、`MASTERED`，内部另有 `OBSERVED`、`RETRACTED`、`USER_DELETED`；状态变化必须由版本化规则根据证据重算，不由 LLM 直接指定；
- 状态迁移规则：`OBSERVED -> FREQUENT_ISSUE` 需要至少 2 篇问题证据；`FREQUENT_ISSUE -> IMPROVING` 需要最近至少 2 篇有效作文中问题率下降且至少 1 篇出现正向证据；`IMPROVING -> MASTERED` 需要最近至少 3 篇有效作文均无该问题且至少 2 篇有正向证据；新问题证据可使状态退回 `FREQUENT_ISSUE`；
- 用户删除学习记录时写入 `memory_tombstone(skill_key, user_id)` 并将状态置为 `USER_DELETED`，立即停止展示和个性化使用；除非用户显式恢复，否则新证据不得静默复活该记录。

### 4.8 Knowledge Sources

知识来源严格区分：

- `Official Rubric`：IELTS 评分维度、band descriptor 和版本；
- `Teaching Knowledge`：教师课程、视频提炼的方法、示例和适用条件；
- `Product Policy`：干预时机、反馈预算和产品行为规则。

三者分别存储、分别标注来源，Prompt 中分别注入，禁止把教师技巧伪装成官方评分要求。IELTS 官方 PDF 原件保存在 `docs/references/official/ielts/`，以来源 URL 与 SHA-256 保证原件可追溯；Prompt 使用的数据必须是另存、标源、可复核的派生资料。教师知识库接口现在预留，MVP 主链路后立即开展内容提炼和检索设计。

### 4.9 LLM Gateway

- 提供供应商无关接口、结构化输出校验、模型路由、超时、重试、成本记录和可观测性；
- 业务模块不得直接调用具体模型 SDK；
- 保存 Prompt 模板版本、模型标识、输入哈希、输出和解析结果；
- 敏感信息最小化，日志默认不记录完整作文原文。

默认模型配置固定为 OpenAI `gpt-5.6-luna`，通过 Responses API 调用，推理强度使用 `low`，题图理解启用图像输入，所有业务输出优先使用结构化输出。该模型配置来自 OpenAI 官方模型文档；Gateway 仍保留按任务覆盖模型的能力，避免业务模块绑定具体供应商参数。

### 4.10 Phase 3 公共契约冻结

以下契约是 Task Intake 实现边界，不改变产品需求或验收标准：

- `BlobPort` 只接受服务端生成的 opaque UUID `blobId`，提供 `put/read/metadata/delete`。应用层生成 `blobId`；适配器校验 UUID 后自行派生内部 key，禁止接收或返回调用方路径。`put` 校验 bytes 的 size/hash，针对相同 ID 与相同 metadata 幂等，内容冲突返回稳定错误；`read` 返回 bytes 副本与 metadata；`delete` 幂等。Blob root、对象存储 bucket/key 和供应商 URL 都不得穿过端口。
- 原图保存在私有 Blob 中，不生成公共静态 URL。受控 API 必须先确认 blob 被可访问的 `writing_task` 引用，再通过 `BlobPort` 读取，并返回 `private, no-store`；不得泄露本机路径、对象存储 key、Base64 或签名。未来 Supabase Storage adapter 保持同一 opaque ID 和 metadata 语义。
- 既有 `LLMPort.execute(LlmRequest): Promise<LlmResult>` 及 sentence/paragraph 请求、成功结果保持不变。新增 `TaskContextLLMPort extends LLMPort`，通过独立 `executeTaskContext(TaskContextLlmRequest)` 承载 image、`schemaVersion`、`attemptId`、`correlationId` 和 `ANALYZE | REPAIR`，生产请求不携带测试专用 `fixtureId`。Task Context 成功结果必须含 `value/model/responseId`；稳定失败码为 `REFUSAL | INCOMPLETE | INVALID_JSON | INVALID_STRUCTURE | TIMEOUT | NETWORK | TERMINAL`。
- `REFUSAL` 是供应商明确拒绝；`INCOMPLETE` 是响应未完成且无可发布结构；`INVALID_JSON` 是无法解码；`INVALID_STRUCTURE` 是本地 Schema、交叉引用或语义校验失败；`TIMEOUT/NETWORK` 是瞬态传输失败；`TERMINAL` 只表示非重试的配置、权限或未分类供应商终态。adapter 不重试。单个 analysis attempt 在所有层合计最多调用 LLM 两次：timeout/network 只可再次 `ANALYZE`，invalid JSON/structure 只可执行一次 `REPAIR`，refusal/incomplete/terminal 不重试。用户显式 retry 创建新 attempt 和新预算。
- `JobPort` 继续只负责通用幂等投递、取消和非权威运行状态，不增加 attempt、调用次数、retry 或 terminal reason。Task Intake 数据库是这些状态的唯一事实来源；本地 runner 与未来 Trigger.dev adapter 必须调用同一 processor，并以数据库 claim/CAS 抵御重放，不能用 Job 状态覆盖领域状态。
- `WritingTask` 采用 additive、可空持久化扩展：`imageBlobId/imageMediaType/imageSha256/intakeStatus/currentTaskContextVersionId`。Phase 2 的 `imagePlaceholderKind` 与既有创建/读取路径保留；历史行的新列为 null，表示“未建立 Task Intake”，不得映射为失败或持续处理中。完整 `TaskContextResolution` 由 Task Intake repository 组装，不把 context JSON 嵌入 `WritingTask`。
- Task Context 为 strict 根 object，`task` 字段内部是四类 discriminated union。为兼容 strict Structured Outputs，供应商 Schema 的所有字段均 required；语义可缺失值使用 nullable，不使用 optional。领域层再次执行 Zod、fact ID 唯一/引用完整和状态一致性校验。limitations 使用稳定 category/reason code，用户文案由应用映射，不直接展示模型自由文本。
- `READY` 表示存在有效 context、全部事实为 `CERTAIN` 且无有效 limitation；`DEGRADED` 表示存在有效 context 和至少一个可用 `CERTAIN` fact，同时含不确定事实或 limitation；`UNAVAILABLE` 表示已接受的当前 attempt 无可安全使用的 context，仍发布 `context = null` 的不可变 version。只有 `TaskContextResolution` 和 certainty guard 可供下游读取；非确定事实不得成为判错或扣分的唯一依据。
- 每次 accepted attempt 的发布事务必须同时完成 immutable version 插入、`writing_tasks.current_task_context_version_id`/状态 CAS、attempt 终态和领域事件。CAS 条件至少包含当前 `active_attempt_id` 与输入 hash；失败即 `STALE`，不得移动 pointer。重复回调不得新增 version/event。`UNIQUE(task_id, version)` 保留；`input_hash` 用于 stale 判断，不得使用永久 `UNIQUE(task_id, input_hash)` 阻断显式 retry，应以 request idempotency key 和 active-attempt claim 去重。
- Blob 写入与 SQLite 事务不是同一原子资源：顺序固定为校验 -> 幂等 Blob put -> 数据库创建事务 -> commit 后投递 Job。数据库创建失败时只清理由本次请求新建且尚未被引用的 blob；Job 投递失败时保留 `UPLOADED` 以便恢复，不伪造 `QUEUED`。SQLite 升级统一由 `drizzle-kit generate` 产生 SQL、snapshot 与 journal，禁止只手写迁移文件或重写历史迁移。

### 4.11 Phase 3.5 公共契约冻结（Usable MVP）

以下契约冻结 Phase 3.5「一键启动 + 一次性全文反馈」实现边界；不改变 §4.10 或更早章节的语义，不改变产品需求或验收标准：

- 既有 `LLMPort`、`TaskContextLLMPort` 及 `openai-task-context.adapter.ts` 保持零业务 diff。新增 `EssayFeedbackLLMPort extends LLMPort`，通过独立 `executeEssayFeedback(EssayFeedbackLlmRequest)` 承载一次性全文反馈；该请求只读依赖窄接口 `EssayFeedbackTaskContextSource.findResolution(taskId)`（只暴露 `findResolution`，不暴露 create/publish/claim 等写能力）与只读 essay repository 数据，反馈 use case 不得获得 Task Intake 写能力。失败码沿用 Phase 3 枚举 `TIMEOUT | NETWORK | INVALID_JSON | INVALID_STRUCTURE | REFUSAL | INCOMPLETE | TERMINAL`；owner 冻结为：OpenAI adapter 负责 JSON decode（失败 → `INVALID_JSON`），use case 负责 Zod/domain schema 校验（失败 → `INVALID_STRUCTURE`）。
- 反馈输出为 strict 根 object，全部字段 required：`overallBand`、`criteria.taskAchievement/coherenceCohesion/lexicalResource/grammaticalRangeAccuracy`、`strengths[1..3]`、`improvements[1..3]`、`priorityImprovement`。所有 band 数值只允许 0.5 步进（0/0.5/1.0/…/9.0）；Structured Output JSON Schema 与领域 Zod 校验必须保持一致（6.5 合法、6.3 非法）。
- 反馈 prompt 输入规则（CERTAIN-only）：允许全部 `CERTAIN` fact statements 与 limitationCodes；禁止将 `UNCERTAIN`/`UNAVAILABLE` fact statement 原文作为事实输入，禁止以受限题图信息判错或扣分；prompt 必须明确要求不得因受限信息扣分。不确定事实不得成为判错或扣分的唯一依据（与 §4.10 一致）。
- 反馈 HTTP 稳定错误码：session 不存在 `404 ESSAY_NOT_FOUND`；Task Context PENDING `409 TASK_CONTEXT_PENDING`；Task Context UNAVAILABLE `422 TASK_CONTEXT_UNAVAILABLE`；LLM NETWORK/TIMEOUT `503 FEEDBACK_LLM_UNAVAILABLE`；LLM REFUSAL/INCOMPLETE/INVALID_JSON/INVALID_STRUCTURE/TERMINAL `502 FEEDBACK_LLM_FAILED`。错误 body 为 `{ error: "<稳定错误码>", message: "<中文用户文案>" }`；不得返回 stack、供应商原始响应、API key 或内部异常详情。
- Phase 3.5 Essay Feedback ≠ 正式 IELTS Assessment。它是个人 MVP 的一次性非官方反馈链路，UI 必须显示「非官方估计，仅供练习参考」；本阶段严格禁止写 `essay_assessments`、写 Student Memory、feedback 持久化、评分历史、新增 assessment 领域事件、复用/修改正式 Assessment schema，也不得声称正式评分已完成。未来正式 Assessment 应替换该最小链路，不把本链路解释为已验收的正式评分模块。
- 反馈请求不持久化、不建幂等表、不发领域事件；HTTP 请求不携带 `clientRequestId`（前端以请求期间禁用按钮防重复点击）；不引入 correlationId。
- `/api/health` 仅为 readiness probe，返回 `200 { ok: true }`；不做任何业务副作用。
- Launcher 为 Windows 本地 MVP 边界：C# 单文件 exe（Windows 自带 .NET Framework `csc.exe` 构建）隐藏启动 `npm run dev:local`（`next dev -H 127.0.0.1 -p 3000`），轮询 `http://127.0.0.1:3000/api/health` 后以系统默认浏览器打开 `http://ieltswriting.localhost:3000`；重复双击不重复启动；失败给中文提示与日志路径（`%LOCALAPPDATA%\IELTS Writing Coach\server.log`），不展示 stack。不引入 Electron、安装器、80/443 反向代理或 hosts 修改；不隐藏 `:3000`。

### 4.12 Phase 3.6 公共契约冻结（Personal Usable AI）

Phase 3.6 的完整规范见 [`docs/PHASE_3_6_ARCHITECTURE_DELTA.md`](./PHASE_3_6_ARCHITECTURE_DELTA.md)，该文档是本节的规范性增量；本节只记录与主架构的接缝：

- Phase 3 `TaskContextLLMPort` 与 Phase 3.5 `EssayFeedbackLLMPort` 保持不变。业务能力仍按角色建模；composition root 只装配 resolver/registry，运行时选择只通过 Provider-agnostic `RoleBindingResolver` 完成，并由已冻结 invocation snapshot 创建具体角色 adapter。不得用一个通用 generate 接口替换两个已验收业务 Port。
- Provider transport 限于 OpenAI、Gemini、Anthropic 与窄 OpenAI Responses-compatible profile。各 adapter 独立处理 image 编码、Structured Output schema projection、refusal/incomplete、timeout/network 和供应商错误；SDK 自动重试关闭。Phase 3 Task Context 已冻结的 application-level 调用预算不变，且绝不自动切换 Provider/model。
- **Personal MVP** 仅面向总指挥本人、当前 Windows 用户和可信本机：server 只监听 `127.0.0.1`、不开放 CORS，unsafe API 做基本 same-origin/CSRF 防护，Launcher 保持现有个人本机可信模型。凭证使用 Win32 Credential Manager 和 server-only `SecretStorePort`；SQLite 只存版本化 `secretRef` 与非秘密元数据。API Key 只可短暂存在于同源 PUT request body 与 server memory，不进入 GET/response、浏览器持久存储、持久 JSON 文件、数据库或日志。
- 模型基础能力使用 `SUPPORTED | UNSUPPORTED | UNKNOWN`；本产品兼容性必须分别通过 `TASK_CONTEXT` / `ESSAY_FEEDBACK` 最小真实 schema probe 获得。未验证模型不进入相应角色下拉，Custom 不因名称或兼容声明自动获得 capability。
- connection test 与 role verification 是两个动作；任何可能收费的探针必须先获用户明确同意、每个 requestId 最多一次 inference、无 SDK retry、无后台循环。自动化测试全部 fake/offline。
- Key、Base URL、Custom Model ID 或验证指纹变化会使 verification stale。Task Context attempt 持久化 Provider/model/secret revision 快照；同步 Feedback 在请求开始冻结内存快照。中途切换只影响下一请求，last-success 仅审计，绝不 fallback。
- §4.9 与 §15 中的固定 OpenAI 默认只保留为历史基线及显式 `ENV_DEV` 兼容路径；Phase 3.6 Launcher/personal runtime 以 UI 配置为唯一主入口。`.env` 失败时不得静默接管 UI 配置，UI 必须显示实际配置来源、Provider 和 model。
- `LocalSessionGate`、named-pipe bootstrap、current-SID 双向验证、pipe PID↔TCP listener 绑定、跨 Windows 用户隔离、port squatting、fake pipe/fake health 防护及第二普通 Windows 用户攻击测试，统一延期到 **Pre-release Hardening**；任何第二个人安装、测试或 beta 分发前必须完成。它们不是当前 Personal MVP implementation planning 的 blocker。
- 本阶段仍只是一次真实的非官方反馈链路，不进入 formal Assessment、Student Memory、realtime coach、Task 2、Teacher KB、费用统计或 Phase 4。

架构结论：**Phase 3.6 Personal MVP architecture approved for implementation planning**；当前无须总指挥拍板的架构 blocker。

## 5. 主要数据流

### 5.1 题目与图片导入

1. 客户端将题图提交给应用，由应用写入私有 Blob 并创建 `writing_task`；
2. 后台任务调用视觉模型，输出结构化 `task_context`；
3. Schema 校验或置信度检查失败时有限重试；仍失败则保存带不确定性标记的降级版本，不阻塞写作；
4. 每次有效输出生成不可变的 `task_context_version`，段落分析与全文评分使用最新有效版本；
5. 低置信度事实不得被当作确定事实评分，反馈和评分结果需显式降低置信度。

`Task Context` 中每个事实都使用稳定 `fact_id`，并带 `certainty = CERTAIN | UNCERTAIN | UNAVAILABLE`、`uncertainty_category` 和原图定位证据。段落反馈和全文评分输出中的每条 claim 必须列出 `supporting_fact_ids` 与独立作文证据；若只引用 `UNCERTAIN/UNAVAILABLE` 事实，Intervention Policy 强制 `SUPPRESS` 判错型反馈，评分器强制输出受限结论而不是负面判断。

### 5.2 句子级轻量检查

1. 句末标点后创建 1.5 秒可取消定时器；光标离开当前句或换行并开始下一句时立即形成候选完成，无需再等待；
2. 定时器到期时生成 `sentence.check_requested`，携带 `essay_revision_id`、稳定 `sentence_id`、`sentence_text_hash`、必要上下文哈希和幂等键；同一哈希只启动一次检查；
3. 定时器等待期间，只要该句文本变化、句子边界变化或会话进入提交/删除状态，就取消并发出 `sentence.check_cancelled`；
4. 检查运行后，只有目标句文本或其必要依赖上下文发生变化才使结果 `STALE`；无关句子的编辑不会误杀结果。旧结果可以审计但不得展示或占用预算；
5. 服务端先做拼写、基础语法和重复提示去重，仅在规则不足且有价值时调用低延迟文本模型；
6. Intervention Policy 选择候选并返回短提示和问题类型，默认不直接给完整改写。

目标：首条轻量反馈 P95 小于 2.5 秒；任何失败都不能阻断编辑和保存。

### 5.3 段落级分析

1. 连续输入两个换行、光标离开本段并开始下一段时创建 3 秒可取消定时器；用户点击“检查本段”时立即请求，不等待 3 秒且绕过“明显未完成短段落”的自动触发门槛；
2. 等待期间若目标段落文本、段落边界或会话状态变化，则取消；3 秒稳定后才生成 `paragraph.check_requested`；
3. 自动触发前先执行确定性完整性门槛：空段落、仅占位符或不足一个完整句的段落不请求 AI，并发出 `paragraph.check_skipped(reason=INCOMPLETE)`；
4. 请求携带 `paragraph_text_hash`、相邻段落摘要哈希、`task_context_version_id`、相关 Memory 投影版本和幂等键；这些依赖任一变化会使返回结果 `STALE`；
5. 输出结构覆盖段落功能、中心信息、比较关系、数据证据、衔接和遗漏；Intervention Policy 每段最多主动展示 2 条高价值提示；
6. 过期结果保留审计但不得展示或占用反馈预算。

### 5.4 全文评分与记忆归纳

1. 用户点击提交时先将当前编辑器正文同步保存为候选不可变 revision，并以该候选正文计算字数；不足 150 词则创建引用该 revision 的 `submission_intent` 并停留在 `AWAITING_WORD_COUNT_CONFIRMATION`，不启动评分；
2. 用户返回继续写作时取消该 intent，候选 revision 仅作为历史快照；用户确认提交时，在同一事务中核对 intent 引用的 revision 未被新编辑取代，记录 `word_count_at_submission` 与风险确认并将会话置为 `SUBMITTED`；若正文已变化则旧 intent 失效并重新执行字数判断；150 词及以上直接冻结候选 revision；
3. `essay.submitted` 只引用该冻结 revision，后续恢复或复制产生新会话/新 revision，不得改变已有评分；重复确认使用 intent 幂等键，只能冻结一次；
4. 评分工作流并行生成四维候选评价，再进行一致性校验和总评；评分状态为 `QUEUED -> RUNNING -> COMPLETED | RETRYABLE_FAILED | TERMINAL_FAILED`；
5. 保存评分、证据、Task Context 版本、置信度与 Prompt/标准版本；
6. 独立的记忆归纳任务比较本次证据与既有记忆；达到证据阈值才更新用户可见学习档案；
7. 学生学习面板读取排除删除数据后的最新投影。

### 5.5 删除与重算一致性

删除作文是单个应用事务，而不是仅隐藏历史列表：

1. 将 `essay_session` 标为 `DELETION_PENDING`，禁止新检查、重试和记忆归纳任务；
2. 取消未开始任务，运行中结果即使返回也因会话状态失效而不得落入用户投影；
3. 删除或软删除该作文 revision、segment、feedback、analysis、assessment/score，并撤销所有引用它的 `memory_evidence`；对象存储原图仅在没有其他题目引用时删除；
4. 在同一事务中将受影响的 `skill_key` 写入 outbox，提交后幂等重算 Student Memory；重算完成前相关记录状态为 `RECOMPUTING`，不得用于个性化；
5. 若剩余证据不足 2 篇，撤回 `FREQUENT_ISSUE`；若仍满足阈值，保留并更新来源、状态和优先级；
6. 最终发出 `essay.deleted` 和逐项 `memory.recomputed`。第一版本地适配器与未来 PostgreSQL 实现必须满足相同的原子性契约。

删除学习记录不删除作文或评分，只写 tombstone、隐藏该记录并停止个性化；删除作文则必须触发上述证据撤销与重算。

## 6. Essay State 与 Student Memory

| 维度 | Current Essay State | Student Memory |
|---|---|---|
| 生命周期 | 一次写作会话 | 跨会话长期存在 |
| 典型内容 | 当前文本、光标相关版本、段落、字数、计时、即时反馈 | 高频错误、掌握表达、薄弱技能、目标分数、趋势 |
| 写入来源 | 自动保存和本次分析 | 已完成作文的证据归纳、用户确认 |
| 更新频率 | 秒级/分钟级 | 提交后或周期性 |
| 一致性 | revision/version 防止旧结果覆盖 | evidence + confidence + status |
| 清理方式 | 会话归档，可保留历史版本 | 可修正、衰减、标为已掌握，不静默删除证据 |

硬性规则：实时分析只能读取 Student Memory 摘要，不能直接写长期记忆；Student Memory 更新必须经过提交后归纳器，并引用证据记录。

## 7. AI / LLM 调用层级

### Level 0：本地确定性逻辑

字数、句子切分、时间、版本检查、冷却、反馈预算、重复检测等。低成本、可预测，应优先使用。

### Level 1：低延迟语言检查

处理单句或很短上下文，使用快速低成本模型，严格 JSON 输出，超时快速降级。只识别和提示，不负责 IELTS 总体判断。

### Level 2：段落教练

使用中等能力模型，结合 Task Context、段落和少量记忆摘要，生成结构化候选建议。异步执行，可取消、去重。

### Level 3：全文评分

使用能力更强的模型和独立评分 Prompt。四维评分、证据提取和一致性检查分步执行，避免一次 Prompt 同时承担所有职责。

### Level 4：离线记忆归纳

提交后执行，结合结构化评分与历史证据更新 Student Memory。它不参与编辑器实时路径，因此可以更慢，但必须可审计和幂等。

图片理解是独立的多模态入口，不属于每次写作反馈调用；同一题目的最新有效 Task Context 应缓存复用。第一版各层默认使用 `gpt-5.6-luna` 和 `low` 推理强度，通过输入长度、Prompt 和反馈预算区分层级；评测数据证明某层能力不足后，才对该层升级模型。

## 8. 基本数据模型

所有主键使用 UUID，时间使用 `timestamptz`，JSONB 只用于模型输出和演进快的结构，核心查询字段保持关系化。

| 表 | 关键字段 | 责任 |
|---|---|---|
| `users` | `id`, `email`, `created_at` | 身份 |
| `student_profiles` | `user_id`, `target_band`, `timezone` | 稳定个人设置 |
| `writing_tasks` | `id`, `task_type`, `prompt_text`, `image_blob_id`, `image_media_type`, `image_sha256`, `intake_status`, `active_attempt_id`, `current_task_context_version_id` | Task 题目、私有图片引用与当前解析指针 |
| `task_context_attempts` | `id`, `task_id`, `input_hash`, `idempotency_key`, `prompt_version`, `schema_version`, `state`, `call_count`, `job_id`, `failure_code`, `started_at`, `finished_at` | 识图调用预算、claim、重试与终态审计 |
| `task_context_versions` | `id`, `task_id`, `version`, `context_json`, `status`, `limitations_json`, `source_image_sha256`, `prompt_version`, `schema_version`, `model`, `created_at` | 自动解析、校验并版本化的题图事实；不可变 |
| `essay_sessions` | `id`, `user_id`, `task_id`, `status`, `started_at`, `submitted_at`, `current_revision` | 当前写作会话 |
| `submission_intents` | `id`, `session_id`, `revision`, `word_count`, `risk_required`, `status`, `idempotency_key` | 少于 150 词确认与提交幂等边界 |
| `essay_revisions` | `id`, `session_id`, `revision_no`, `content_json`, `plain_text`, `word_count`, `created_at` | 不可变正文快照 |
| `essay_segments` | `id`, `revision_id`, `type`, `position`, `text_hash` | 句子/段落定位 |
| `analysis_runs` | `id`, `session_id`, `revision_id`, `scope`, `status`, `model`, `prompt_version`, `input_hash`, `latency_ms`, `cost` | AI 调用审计 |
| `feedback_items` | `id`, `analysis_run_id`, `segment_id`, `issue_key`, `category`, `state`, `severity`, `confidence`, `decision_reason`, `message`, `evidence_json` | 候选、展示、忽略、抑制与过期反馈 |
| `essay_feedback_policy_states` | `session_id`, `active_sentence_feedback_id`, `paragraph_counts_json`, `shown_issue_keys_json`, `ignore_streaks_json`, `suppressed_categories_json`, `version` | 跨刷新反馈预算与抑制状态 |
| `essay_assessments` | `id`, `revision_id`, `task_context_version_id`, `rubric_version`, `status`, `overall_band`, `scores_json`, `limitations_json`, `evidence_json`, `confidence` | 冻结版本的全文评分 |
| `student_memories` | `id`, `user_id`, `kind`, `skill_key`, `summary`, `status`, `projection_version`, `confidence`, `first_seen_at`, `last_seen_at` | 可重算长期学习状态 |
| `memory_evidence` | `id`, `memory_id`, `session_id`, `revision_id`, `feedback_id`, `signal`, `valid`, `observed_at` | 按不同已完成作文计数的证据链 |
| `memory_tombstones` | `id`, `user_id`, `skill_key`, `deleted_at` | 阻止用户删除的学习记录静默复活 |
| `domain_events` | `id`, `aggregate_type`, `aggregate_id`, `event_type`, `payload_json`, `occurred_at`, `correlation_id` | 可审计事件/outbox 与测试观测 |
| `knowledge_documents` | `id`, `source_type`, `title`, `version`, `content`, `metadata_json` | 官方标准/教师知识分源管理 |

MVP 不单独维护可变的“当前全文”表；`essay_sessions.current_revision` 指向最近自动保存的不可变快照。实现时可对短时间自动保存进行压缩，避免快照爆炸。

## 9. MVP 技术选型

- 前端与 API：Next.js App Router + TypeScript；
- 编辑器：TipTap（基于 ProseMirror，便于定位句子、段落和反馈标记）；
- UI：React + Tailwind CSS，沿用原型的三栏工作台并做响应式降级；
- 当前运行方式：本地 Next.js 应用；本地适配器负责持久化、图片文件和进程内后台任务；
- 数据、认证、对象存储的部署目标：Supabase（PostgreSQL、Auth、Storage），当前只实现稳定接口并保留迁移边界；
- 数据访问：Drizzle ORM；本地数据库实现与 PostgreSQL migration 共享领域 Schema，禁止业务代码直接依赖 Supabase SDK；
- 异步任务：本地进程内 `JobPort` 实现；部署时替换为 Trigger.dev；
- LLM：OpenAI Responses API，模型 ID `gpt-5.6-luna`，`reasoning.effort = low`，支持图像输入与结构化输出；经供应商无关 Gateway 调用；
- Schema 校验：Zod；
- 测试：Vitest（领域/单元）、Playwright（关键写作流程）、Prompt fixture + golden dataset（AI 回归）；
- 可观测性：结构化日志 + Sentry；记录 trace、模型、Prompt 版本、延迟、token 和成本，不默认记录全文；
- 部署目标：Vercel（Web/API）+ Supabase + Trigger.dev；当前阶段不部署服务器。

## 10. 关键 API / 领域事件

建议 API：

- `POST /api/tasks`：创建题目并上传图片；
- `POST /api/tasks/:id/understand`：触发图片理解；
- `GET /api/tasks/:id/context`：读取最新 Task Context 与置信度；
- `POST /api/essays`：创建写作会话；
- `PUT /api/essays/:id/draft`：带 revision 的自动保存；
- `POST /api/essays/:id/analyze/sentence`：句子级检查；
- `POST /api/essays/:id/analyze/paragraph`：段落级异步分析；
- `POST /api/essays/:id/submit`：冻结版本并触发评分；
- `POST /api/essays/:id/submit/confirm-risk`：确认不足 150 词风险并幂等冻结；
- `DELETE /api/essays/:id`：删除作文、撤销证据并触发记忆重算；
- `GET /api/essays/:id/feedback`：拉取或流式接收反馈；
- `GET /api/students/me/memory`：获取学习状态摘要；
- `DELETE /api/students/me/memory/:id`：删除学习记录并写入 tombstone。

可验证领域事件包括：

- 触发/失效：`sentence.completion_candidate`、`sentence.check_requested`、`sentence.check_cancelled`、`sentence.result_stale`、`paragraph.completion_candidate`、`paragraph.check_requested`、`paragraph.check_cancelled`、`paragraph.check_skipped`、`paragraph.result_stale`；
- 反馈策略：`feedback.candidate_created`、`feedback.shown`、`feedback.deferred`、`feedback.ignored`、`feedback.suppressed`、`feedback.stale`、`feedback.policy_state_changed`；
- 题图与评分：`task.context_ready`、`task.context_degraded`、`task.fact_uncertain`、`submission.word_count_risk_required`、`submission.cancelled`、`essay.submitted`、`assessment.started`、`assessment.limited_by_task_context`、`assessment.completed`、`assessment.failed`；
- 记忆与删除：`memory.evidence_added`、`memory.state_changed`、`memory.deleted`、`essay.deletion_started`、`essay.deleted`、`memory.recompute_requested`、`memory.recomputed`。

每个事件至少携带 `event_id`、`aggregate_id`、`essay_revision_id`（适用时）、`segment_id/text_hash`（适用时）、`task_context_version_id`（适用时）、`occurred_at`、`correlation_id`、`causation_id`、`idempotency_key` 与结构化 `reason_code`。

测试构建必须提供可注入 `Clock`/调度器以推进 1.5 秒与 3 秒边界，以及只读 `TestObservationPort` 查询事件流、反馈策略状态、任务状态、冻结 revision、评分限制和 Memory 投影；该端口仅在 `NODE_ENV=test` 启用，不得允许修改领域状态。

## 11. 非功能要求与降级

- 自动保存不得依赖 AI 成功；AI 服务不可用时仍可完成写作和提交；
- 所有异步任务幂等，使用 `scope + revision_id + input_hash + prompt_version` 去重；
- 旧 revision 的结果不显示；用户继续编辑时可取消未开始任务；
- 结构化输出必须 Schema 校验，失败后最多一次修复调用，之后返回明确的可重试状态；
- 图片访问使用短期签名 URL，供应商密钥仅在服务端；
- 用户可查看和清除长期学习记忆；
- 删除操作对历史、评分、证据和个性化投影满足“事务撤销 + outbox 幂等重算”；重算期间不得读取旧投影用于提示；
- Prompt 与评分标准版本化，评分结果可追溯；
- 上线前建立小型人工标注集，覆盖图表事实、四维评分和干预策略。

## 12. 主要技术风险

| 风险 | 影响 | MVP 缓解措施 |
|---|---|---|
| 图表 OCR/视觉误读 | 后续比较和评分全部被污染 | 结构化 Task Context、Schema 校验、自动重试、置信度传播、原图证据、四类题图回归集 |
| 实时反馈延迟或抖动 | 打断写作体验 | 防抖、取消旧任务、低延迟模型、异步段落分析、失败静默降级 |
| 反馈过多导致依赖 | 偏离产品核心 | 独立 Intervention Policy、反馈预算、冷却、延迟观察、默认不给整句改写 |
| IELTS 评分不稳定 | 用户失去信任 | 标准版本化、证据绑定、多阶段评分、一致性检查、人工 golden set |
| 长期记忆错误固化 | 对学生产生错误画像 | 多证据阈值、置信度、衰减、可解释和可删除、实时路径禁止直写 |
| 编辑器与分析版本错位 | 错误高亮或提示旧内容 | 不可变 revision、segment hash、旧结果抑制 |
| LLM 成本失控 | MVP 无法持续 | 任务上下文裁剪、缓存、模型分层、调用去重、token/成本预算 |
| 官方标准与教师方法混杂 | 评分解释失真 | 来源类型、版本和 Prompt 区域严格分离 |
| 隐私和供应商数据保留 | 学生文本泄露风险 | 最少数据、服务端调用、日志脱敏、数据删除、供应商保留策略审查 |

## 13. 建议开发顺序

1. **领域契约与评测样本**：冻结 Task Context、Feedback、Assessment、Memory Schema；收集少量 Task 1 人工样本与期望结果。
2. **写作主链路**：认证、题目、编辑器、自动保存、revision 和恢复；先不接 AI。
3. **题图理解**：图片上传、结构化解析、Schema 校验、自动重试、降级和缓存。
4. **句子级反馈**：事件检测、低延迟调用、版本校验、反馈展示与基本预算。
5. **段落分析**：异步任务、Task Context 注入、结构化建议、旧任务取消。
6. **全文评分**：四维评分、证据、一致性检查、结果页面和可追溯版本。
7. **Intervention Policy 完整化**：严重度、置信度、重复、冷却、延迟观察和反馈上限。
8. **Student Memory**：先建证据链，再做归纳和学习面板；禁止先做无证据画像。
9. **质量与上线**：Playwright 主流程、AI golden regression、成本/延迟看板、安全与删除流程。
10. **教师知识库下一阶段**：主写作链路完成后立即将视频转录为可审查知识条目，接入已预留的 `TeachingKnowledgePort`，并始终独立于官方评分标准。

## 14. 跨 AI 交接

### 产品经理 AI

产品交接已由 `docs/PRODUCT_REQUIREMENTS_MVP.md` 完成。本次架构检查未修改产品需求；若后续实现发现无法满足验收标准，必须以偏差提案返回产品经理 AI 和总指挥，不得在代码或架构文档中静默降级。

### 程序员 AI

实现前先冻结 TypeScript 状态枚举和事件 Schema，再输出数据库迁移草案与端口接口。必须实现可注入 `Clock`、segment/dependency hash、持久化反馈策略状态、提交 intent/冻结事务、删除 outbox 和 Memory 投影重算；不得把低置信度 Task Context 当作确定事实，也不得让实时路径直写 Student Memory。实现顺序应先完成确定性状态机及其单元测试，再接 LLM Gateway。

### 测试 AI

基于 `TestObservationPort` 和领域事件建立验收矩阵：精确推进 1.5/3 秒并覆盖取消/过期竞态；验证 1 条句子/每段 2 条预算及忽略两次后的跨刷新抑制；验证不确定 fact 不能单独触发判错且评分限制可见；验证少于 150 词取消/确认、只冻结一次及评分绑定；验证 Memory 两篇门槛、状态前进/回退、tombstone；验证删除作文后 Score/Evidence 不可见、Memory 重算期间不参与个性化且最终来源正确。另保留 AI 超时、无效 JSON、重复任务和四类题图 golden regression。

## 15. 决策状态

已确认：

1. 当前本地开发，采用可替换端口；未来部署目标为 Next.js + Supabase + Trigger.dev；
2. 默认 LLM 为 OpenAI `gpt-5.6-luna`，轻度推理并启用图像输入；
3. Task 1 MVP 覆盖动态、静态、流程图和地图全部四类；
4. IELTS 官方评分资料原件保留，评分派生数据必须可追溯；
5. 教师知识库当前预留接口，并作为主写作链路后的下一阶段。
6. Task Context 完全自动生成，不设置学生人工确认；系统通过自动重试、降级版本、置信度传播和测试集控制识图风险。
