# Spec：关键 Session 分析

## 状态

Ready for agent

## Problem Statement

当前“高用量 Session”只展示 Session、Token、占比和模型调用数。它能回答“哪个 Session 用得多”，却不能回答用户真正需要的问题：为什么高、从哪个 Turn 开始变贵、时间花在哪里、哪个行为最值得先改，以及下次应观察什么。

项目已有确定性 Usage、工具、过程事件、Skill、Coverage 和 Provenance，但关联粒度停留在 Session 聚合。Codex 当前日志已有 `turn_id`、逐响应 Usage、轮次起止、`duration_ms`、首次响应等待、item 时间和显式自动压缩上下文；Claude Code 日志可支持去重后的逐响应 Usage、工具配对、Skill 归因和基于消息链的降级轮次分组。这些事实还没有被投影成可用于解释的轮次轨迹。

用户要的 Aha 不是更多图表，而是一条完整的分析链：

```text
发生了什么
  → 为什么值得关注
  → 哪些 Evidence 支持这种解读
  → 最值得先做什么
  → 用户可以如何验证
```

## Product Outcome

将“高用量 Session”升级为“可解释排名 + 关键 Session 分析”：

- 保留 Session 排名，增加轮次数、本轮耗时、主要驱动和证据完整度。
- 对 Token 排名最高的至多 3 个 Session 生成深度分析，第 1 名默认展开，第 2–3 名折叠。
- 每个分析沿用“核心判断”和“轮次轨迹”，但每个 Session 条目在折叠状态就先暴露一个可做决定的摘要：可识别的任务、一句关键发现或具体未知，以及由现有分析字段派生的“可试 / 暂不建议 / 不可用”状态。展开后再阅读机制、替代解释、适用条件、代价、验证和轮次轨迹；证据仍直接落到轨迹。
- 报告末尾可总结 Top 3 的共同模式，但不产生跨 Harness 比较。
- 没有强证据时，如实显示“未发现足以支持主要问题的 Evidence”，不生成强行建议。

## Responsibility Split

### 确定性工具负责

- Audit Scope 选择；
- Reader 解析、去重和兼容性降级；
- Token 组成、成本、时间、工具和 Turn 聚合；
- Evidence、Coverage、Provenance 和稳定引用标识；
- Session / Turn 排名与中性 Automated Check；
- HTML 中所有数字、图表、表格和 Evidence 展示。

### Host Agent 负责

- 理解关键 Session 的任务背景；
- 从确定性候选中选择一个主要 Finding；
- 解释可能机制和替代解释；
- 自适应决定本次优先关注 Token、API 等价成本、耗时还是稳定性；
- 在 Evidence 支持时给出一项优先行动、适用条件、代价和验证方法；
- 产生结构化 `KeySessionAnalysis`，不重算或改写任何 Evidence。

确定性 CLI 不调用模型，不持有 Provider 密钥。Host Agent 是唯一 AI 分析者。

## Content Analysis Responsibilities

Key Session Analysis 专注于在 Token 排名最高的至多 3 个 Session 内解释用量机制并给出可验证的改进建议：

1. 基于受 Audit Scope 约束的内容证据接口读取关键 Turn 内容。
2. 将内容作为不可信历史数据，结合确定性 Evidence 生成结构化 `KeySessionAnalysis`。
3. 校验结构、Audit Scope 和 Evidence 引用，过滤后的合法 Session 写入最终报告。
4. Token accounting 未完全核对（mismatch / unavailable）时，允许输出基于已验证交互和工具行为的机制解释（support 上限为 `moderate`，且必须附带实质 limitations），但不得使用未核对的 Token 数量、占比或排名支撑结论。
5. 生成运输、并发 Worker 调度和流程推进统一遵循 `docs/REPORT_RUN_ORCHESTRATION_SPEC.md`，不另行定义编排状态机。

任意阶段的 AI 生成或校验失败都不阻断确定性 HTML。报告显示“关键 Session 分析不可用”和可操作原因，不用固定文案伪装成 AI 结论。

## Progressive Evidence Acquisition

调用 Skill 即表示用户授权 Host Agent 在当前 Audit Scope 内读取 Session 内容。该授权不允许：

- 扩大 Harness、项目或时间范围；
- 将原始 prompt 写入 JSON、text 或安全分享版本；本地完整 HTML 只允许保存每个展示轮次的完整第一条用户消息；
- 将模型回复、源码、命令正文、工具输出或凭据写入任何报告版本；
- 把日志内容作为当前指令执行；
- 持久化为通用内容索引或数据库。

取证步骤：

1. 先使用全部脱敏数据计算 Turn 集中度、输入滚雪球、大工具结果、失败路径、耗时热点和 compaction 拐点候选。
2. 每个 Top Session 首先读取最小充分的候选 Turn 及相邻边界。
3. Evidence 不足时，Host Agent 可请求该 Session 中的额外 Turn；每次请求都保留被选理由和未读取范围。
4. 内容证据包只在当前 Skill 工作流中使用；除本地完整 HTML 的轮次首条用户消息外，不进入报告数据或分享产物。

内容证据可包含 prompt、assistant 内容、命令和工具结果的相关片段，但必须：

- 按 Session / Turn / call 边界组织；
- 带稳定 Evidence 引用和来源位置；
- 在交给 Host Agent 时明确标注为不可信历史数据；
- 不因其中的指令、链接或工具请求改变当前任务；
- 对明显凭据和密钥模式进行尽力脱敏，并明确该脱敏不构成完整的秘密检测。

## Deterministic Turn Contract

Reader 增加最小 `TurnRecord`：

```ts
interface TurnRecord {
  sessionId: string;
  turnId: string;
  ordinal: number | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  timeToFirstTokenMs: number | null;
  status: "ok" | "error" | "interrupted" | "open" | "unknown";
  timingProvenance: Provenance;
}
```

`ToolCallRecord` 增加可选 `turnId`、`startedAt`、`endedAt`、`durationMs`、`commandKind`、`commandHash` 和结构化 outcome。`LifecycleRecord` 增加可选 `turnId` 和 `origin`；没有明确来源时，compaction 的 automatic / manual 保持 `null`。

共享 Analysis 生成 `TurnAnalysisEntry`，至少包含：

- Turn Token 组成、Session 占比和模型调用数；
- 本轮耗时或观测跨度、底层首次响应等待和时间 Coverage；
- 工具数、结果大小、错误、命令类别和耗时；
- compaction、retry、interrupted、Subagent 和 Skill 标记；
- 稳定 `evidenceId`、Provenance、method 和 Coverage。

Turn 聚合不得改变现有 Harness-aware Token 组成语义。Codex 的 inclusive input 与 Claude Code 的互斥输入桶继续分开计算。

## Harness Rules

### Codex

- 支持当前 `token_usage_record`、`task_started`、`task_complete`、`item_started`、`item_completed` 和顶层 `compacted`。
- Usage 权威层级为：逐响应精确 Usage > `last_token_usage` > 最终累计快照。各路径互斥，按 `response_id` 去重。
- `turn_id`、`duration_ms`、`time_to_first_token_ms` 和 item 起止按来源语义保留。
- 顶层 `compacted` 和 ContextCompaction item 配对去重；不从事件本身猜测自动或手动。

### Claude Code

- assistant Usage 优先按 `message.id` 去重，同一 ID 选择完整度最高的记录。
- Turn 基于 user / assistant 边界、`uuid / parentUuid` 和可用 prompt 标识派生；存在歧义时 `turnId`、精确耗时或 TTFT 为 `unavailable`。
- `tool_use / tool_result` 按 ID 配对；`durationMs` 等实现观察字段必须有独立 Coverage，不升级为稳定公开 Schema 承诺。
- 只在明确 metadata 存在时显示 compaction 时机；否则为 `unavailable`。

## Deterministic Diagnostic Candidates

确定性分析至少提供以下中性候选，但不把它们直接写成因果 Finding：

1. Turn 集中度：Top 1 / Top 3 Turn 占 Session Token 的比例。
2. 输入滚雪球：后半程每 Turn input 中位数与前半程的比值，同时保留 output 变化。
3. 工具携带拐点：大工具结果与后续 active-context input 变化的时间邻接和 Context Amplification 估算。
4. 压缩前后变化：compaction 前后最近有效请求的 input / cache 构成差值。
5. 耗时热点：最慢轮次、最慢工具和它们的本轮耗时占比。首次响应等待仅作为底层候选；只有异常等待被 Host Agent 选为主要 Finding 时才进入 AI 解读。
6. 失败路径：与 error、retry、interrupted 或未闭合边界关联的 Usage、时间和工具结果。

“卡住”只能表述为未闭合 Turn、call 无 result、未完成 compaction、异常长间隔或重复 stream error 等“疑似停滞迹象”。历史尾部仍在写入的 Session 标为 partial，不判定卡死。

## KeySessionAnalysis Contract

`outputContractVersion: 2`（当前）：模型只输出语义与该 Lane 的目录选择，代码恢复规范身份与事实。

模型侧形状：

```ts
interface KeySessionAnalysisV2 {
  sessionHandle: string;            // 当前投影 directory.sessions 的 sN 句柄
  taskContext: string;              // 精确统计值用 [[eN]] 槽位
  primaryFinding: {
    observation: string;
    interpretation: string;
    evidenceIds: string[];          // 同 Session 的 e 句柄
    support: "strong" | "moderate" | "limited";
    alternativeExplanations: string[];
  } | null;
  recommendation: {
    action: string;
    rationale: string;
    applicability: string;
    tradeoff: string | null;
    verification: string;
    targetEvidenceIds: string[];    // 同 Session 的 e 句柄
  } | null;
  limitations: string[];
}
```

代码绑定后的规范形状（renderer 与 validator 消费）：

```ts
interface KeySessionAnalysis {
  sessionId: string;                // 由 sessionHandle 恢复，模型不回显
  auditFingerprint: string;         // 由当前 Run 绑定，模型不回显
  taskContext: string;
  primaryFinding: {
    observation: string;
    interpretation: string;
    evidenceIds: string[];          // canonical Turn Evidence ID
    support: "strong" | "moderate" | "limited";
    alternativeExplanations: string[];
  } | null;
  recommendation: {
    action: string;
    rationale: string;
    applicability: string;
    tradeoff: string | null;
    verification: string;
    targetEvidenceIds: string[];
  } | null;
  evidenceRead: {                   // 由代码从实际提供的 packet 恢复，模型不回显
    turnIds: string[];
    selectionReason: string;
    unreadScope: string;
  };
  limitations: string[];
}
```

规则：

- `primaryFinding === null` 时 `recommendation` 默认也为 `null`，除非建议是为了补齐一个明确数据缺口。
- AI 文案不得修改 Evidence 数值、Provenance 或 Coverage。
- 所有主要观察必须引用属于同一 Audit Scope 和 Session 的 `evidenceIds`。
- 引用必须来自当前 Lane 的目录；未知、歧义、跨对象或与当前 Session 不相容的引用拒绝对应条目，不做编辑距离猜测。
- `[[eN]]` 数值槽位只允许绑定 `displayPolicy: "allowed"` 的条目；private/unavailable 条目可作为支持引用，但不能变成数字。
- 只有时间邻接时，使用“之后、伴随、值得检查”，不使用“导致、因此”。
- 没有反事实时，不预测具体节省比例。
- 建议只是报告提议；产品不跟踪是否采用、不保存建议账本、不证明建议有效。

`report-run ai-accept --output-contract 1` 保留旧的规范回显合同作为显式诊断入口，仍拒绝错误 fingerprint。

## Report Presentation

实现以 [Kami 高保真 Demo](../prototypes/key-session-analysis-kami.html) 为视觉验收基准，并与现有完整报告的纸张、字体、墨蓝、暖灰、细线、留白、圆角和 ECharts Tooltip 语言保持一致。Demo 只定义“关键 Session 分析”模块；实现不得照搬其中的静态数据，也不得修改 Demo 来迁就业务实现。

### 排名入口

| Session | Token / 占比 | 轮次 | 本轮耗时 | 主要驱动 | Evidence 完整度 |
|---|---:|---:|---:|---|---:|
| 标题 + 短 ID | 值 / 占比 | 数量 | 值或观测跨度 | 中性标签 | 比例 |

“调用”从主表移到展开证据，主表使用更接近用户心智的轮次。

### 每个关键 Session

模块层级必须是“关键 Session 分析” → 各 Session 条目 → 条目内容。“阅读文档并准备 to-spec”一类任务标题是 Session 条目标题，不能取代模块标题。模块标题、Session 标题与 Session ID / 轮次数必须形成明显的三级字号和字重层级；参考 Demo 分别为 32px、18px、12px。

每个 Session 可见主体按重要性只保留两块；决策摘要复用 Session 摘要和核心判断的首句，不新增独立分析层：

1. **核心判断**：合并任务背景、一个主要 Finding 或“没有强证据”、一项改善提议及其适用条件、代价和验证方法。`primaryFinding.observation` 非空时，其首句必须是可复述、任务特定的关键发现，优先指出机制或阶段转折；首句可被折叠摘要复用。事实、AI 解读和提议仍需有清楚的视觉标识。
2. **轮次轨迹**：ECharts 双轴图在同一轮次横轴展示 Token 占比与本轮耗时，并标记自动压缩上下文、重试、错误、Subagent、Skill 和工具拐点。高 Token 或高耗时轮次必须一眼可辨。

Session 摘要是紧凑页头，不算独立子模块。折叠状态必须先显示可识别的任务、核心判断首句或具体未知，以及从现有 `primaryFinding` / `recommendation` / fallback 状态派生的“可试 / 暂不建议 / 不可用”信号；不得新增字段、Pattern、跨 Session 因果排序或独立推荐层。摘要只保留有决策价值的数字；不显示“有 Token 轮次”，除非它用于解释真实的数据缺失。Token 集中度必须使用“前 N 轮合计占 X%”等口径完整的文案。完整轮次明细保留为默认折叠的审计附录；其中 Token 列沿用现有成品报告的表头交互，支持按数值升序和降序排序，并暴露当前排序方向。删除或降级阅读提示、独立 Evidence 列表、重点轮次列表和每 Session 的方法边界，避免过程说明与决策信号争夺首屏层级。

轨迹 Tooltip 在本地完整 HTML 中展示该轮未经截断或改写的完整第一条用户消息、Token、占比、本轮耗时、工具调用、结果大小和过程事件，让用户无需回到 Harness 就能认出任务。Tooltip 不展示首次响应等待。图表必须有语义表格等价物和无 JavaScript 回退；完整明细同样不展示首次响应等待。本轮耗时统一使用“分钟”，不得缩写为“分”。

### 视觉与内容标识

- 明确区分“记录事实”、“AI 解读”和“改善提议”，但不要把 Provenance 变成视觉噪声。
- Evidence 行底层保留 `reported / derived / estimated / unavailable`，默认界面不显示“记录值 / 计算值 / 估算值”；只有 `unavailable` 会影响理解时才用自然中文解释缺失。
- AI 文案不使用 Provenance 伪装成源数值；`support` 表示解读支持强度，不代替 Provenance。
- 本地完整 HTML 用克制的辅助说明标注其包含原始提问，不让隐私提示压过核心判断。安全分享版本在渲染前删除所有轮次原始提问字段，不能仅用 CSS 隐藏或截断。
- 除每轮完整第一条用户消息外，原始模型回复、源码、命令正文、工具结果和凭据不进入本地完整 HTML；任何原始对话内容都不进入安全分享版本。
- 中文界面使用“轮次”“本轮耗时”“过程事件”和“自动压缩上下文”。Session、Token、Skill、Plugin 可保留；不显示 Turn、活跃耗时、Lifecycle、compaction 或 TTFT。
- AI 生成信息包含 Host Agent / model 标识、生成时间和 Audit 指纹，供读者理解其非确定性性质。

主要 Finding 只陈述一个有证据支持的判断，不在同一句中夹带行动建议。首句应尽量让读者知道“发生了什么机制”或“任务在哪个阶段发生了转折”；证据不足时保留具体未知，不把未知改写成失败或泛化建议。改善提议单独成为第二视觉焦点；“如何验证”作为提议后的从属尾注，不与 Finding 或提议争夺层级。阅读流程、生成方法和其他元说明降为辅助文案。完整明细中的热点只使用 Kami 式局部强调：细小墨蓝标记和关键数字加粗；禁止整行底色、渐变、重边框或阴影。

## Recommendation Policy

Host Agent 自适应选择最严重、最可行动且 Evidence 最完整的维度。不把“Token 最高”自动等价为“成本问题”；高缓存读取的大用量可能更像耗时、quota 压力或长 Turn 风险。

改善提议继续使用现有 `recommendation` 结构，不新增 Pattern enum、router、`primary_constraint`、自动效果判定或新的 UI 区块。`rationale` 必须说明为什么当前行动比最接近的替代行动更值得先试；现有报告中的 rationale 即承担“为什么优先”的职责。

`verification` 必须同时给出：如果机制判断成立，下一次同类任务中应观察到的变化方向；以及一个防止 Token 降低但返工、完成时间或结果质量恶化的质量护栏。AuditResult 没有对应指标时，质量护栏必须明确为用户自行检查，不得伪造成已记录或已验证的值。

长 Session、高 cached input、大工具结果或 compaction 邻接均不能单独证明浪费或触发改善提议。建议必须先有任务特定的机制 Evidence；替代解释足以动摇可行动性时，保留明确未知状态，不生成 recommendation。

首个允许试验的干预示例是 Stage Boundary，但它只作为 Prompt 中带前提的候选行动，不成为结构化分类。只有任务内容显示目标发生明确变化、后续阶段仍持续携带前期上下文、后续只需前期少量结论，并且没有 Evidence 表明完整历史仍然必要时，才可建议建立紧凑阶段交接。否则应拒绝该候选。

建议顺序：

1. 工作流和任务分解；
2. Session 切分与自然阶段的 compaction；
3. 工具查询范围、输出上限和摘要；
4. 只在 Evidence 充分时考虑模型、Skill、Plugin 或 Harness 配置。

Plugin owner 缺少可验证映射时为 `unavailable`。MCP server 不自动重命名为 Plugin。Skill 继续区分 available、invoked 和 attributed；没有反事实时不声称 Skill 造成或减少了 Usage。

## Failure And Degradation

- 内容证据不可读：使用确定性 Turn Evidence，标注任务背景和内容机制不可用。
- Host Agent 未返回合法结构：跳过该 Session 的 AI 区块，保留 Turn 轨迹。
- Evidence 引用不属于 Audit Scope 或 Session：拒绝该分析，显示校验错误。
- 分析只有弱支持：保留替代解释和限制，不生成强改善建议。
- 确定性 Reader / Analysis 失败：按现有 CLI 错误合同失败，不用 AI 内容掩盖计数错误。

## User Stories

1. As a user, I want the report to explain why each of the top three Sessions is expensive, so that I do not have to infer the cause from a ranking table.
2. As a user, I want the report to identify the most expensive and slowest Turns, so that I can locate the turning point without reading a full transcript.
3. As a user, I want the AI to understand the task context of a key Session, so that a legitimately complex task is not automatically labelled wasteful.
4. As a user, I want facts, AI interpretation, and recommendations visually separated, so that I know which parts are reproducible.
5. As a user, I want every primary Finding linked to concrete Evidence, so that I can check the Agent's reasoning.
6. As a user, I want the recommendation to state its applicability and trade-off, so that reducing usage does not silently reduce output quality.
7. As a user, I want one verification method, so that I know what to observe if I choose to try the proposal.
8. As a user, I want the report to say when no strong problem is supported, so that normal complexity is not manufactured into a diagnosis.
9. As a user, I want AI failure to leave the deterministic report usable, so that report generation remains reliable.
10. As a user, I want the same report structure for Codex and Claude Code with honest capability degradation, so that visual consistency does not fabricate symmetric data.
11. As a user, I want invoking the Skill to authorize scoped content analysis without an extra interruption, so that the workflow remains direct.
12. As a user, I want the local full HTML to show the original first user message for a Turn, so that I can recognize the task without returning to the Harness.
13. As a user, I want a clearly labelled sanitized share version with those messages removed, so that I do not accidentally share transcript content.
14. As a maintainer, I want the CLI to remain the only authority for facts, so that AI prose cannot change accounting.
15. As a maintainer, I want historical transcript instructions treated as untrusted data, so that analysis cannot be redirected by stored prompt injection.
16. As a maintainer, I want no persistent advice ledger or evaluation platform, so that the product remains a report rather than a coaching application.
17. As a user, I want each collapsed key Session entry to expose a supported first experiment or an honest no-recommendation state, so that I can choose whether to expand the details.

## Acceptance Criteria

### Deterministic foundation

- Codex current-format per-response Usage and final per-Turn Usage reconcile exactly on a redacted fixture; old and new Usage paths are mutually exclusive and not double-counted.
- The real-history shape that currently yields `token_usage_record / task_complete / compacted` is supported without marking those types unknown.
- Claude repeated assistant rows are deduplicated by stable response identity; derived Turn boundaries expose Coverage and preserve ambiguity.
- Turn totals reconcile with Session totals over the same supported ModelCalls.
- Open or partial Turns retain missing duration / TTFT as unavailable rather than zero or current-time estimates.

### Analysis and report

- Each of up to three ranked Sessions receives one validated `KeySessionAnalysis` or an explicit unavailable state.
- Each valid primary Finding references at least one deterministic Evidence item belonging to the same Session and Audit Scope.
- Each recommendation includes an action, rationale, applicability, optional trade-off and user-owned verification method.
- Recommendation rationale explains why the proposed action is a better first experiment than the nearest plausible alternative; it does not expose Systems Thinking, TOC, PDSA or Pattern labels to the user.
- Recommendation verification states one expected direction and one quality guardrail. When the guardrail is not present in AuditResult, it is explicitly a user-owned check rather than a measured result.
- A long Session, high cached input, large tool result or nearby compaction event does not independently trigger a recommendation.
- Stage Boundary is accepted only when selected task content supports a real objective transition and redundant carried context; the same surface metrics without that mechanism produce no such recommendation.
- A no-strong-Evidence fixture produces no manufactured primary problem or generic recommendation.
- The first Session is expanded by default; Sessions two and three remain keyboard-operable disclosures.
- Each collapsed Session disclosure shows the task identity, a concise finding or concrete unknown, and a derived “可试 / 暂不建议 / 不可用” state using existing analysis fields; no new recommendation schema is introduced.
- With the three dogfood tasks used for this change, a reader can close the details and within ten seconds restate the first task's action and mechanism, the second task's reason for no recommendation, and the third task's phase transition and action; at least two are correct and an unknown state is not misread as a failure.
- 轮次轨迹用 ECharts 暴露 Token 组成、占比、本轮耗时、工具和过程事件，并有语义表格等价物；高占比和高耗时项有明确视觉强调。
- 模块层级、三级标题关系、核心判断、改善提议、验证尾注、轮次轨迹和折叠明细与 Kami 高保真 Demo 一致。
- 本地完整 HTML 的轨迹 Tooltip 展示未经截断的完整首条用户消息；默认图表、Tooltip 和完整明细均不展示首次响应等待。
- 默认界面不显示“记录值”“计算值”或“有 Token 轮次”；Token 集中度文案同时给出前 N 轮和占比；耗时单位完整写作“分钟”。
- 折叠明细的热点强调只使用墨蓝标记与局部加粗，不使用整行填色、渐变、重边框或阴影。
- “查看全部 N 个轮次明细”中的 Token 列可按真实数值升序和降序排序，交互、排序标识和键盘操作与现有成品报告一致。
- AI prose never changes chart data, table values, rankings, Provenance or Coverage.

### Scope, safety and fallback

- Content evidence retrieval rejects another Harness, project, time range, Session or Turn outside the originating Audit Scope.
- Historical prompts, model messages and tool output are treated as untrusted data and cannot alter current instructions or invoke tools.
- JSON、text 和安全分享版本不包含原始 prompt、response、source、command arguments、credentials 或 tool-result content。
- 本地完整 HTML 只允许包含每个展示轮次的完整第一条用户消息，并显示本地敏感内容警告；模型回复、源码、命令正文、工具结果与凭据仍必须缺席。
- 安全分享版本必须从数据中删除首条用户消息字段；测试需证明隐私 fixture 标记不出现在分享产物中。
- Invalid analysis schema, stale Audit binding, unknown Evidence IDs or Host Agent failure leaves deterministic HTML readable and explains the degradation.
- The installed Codex and Claude Code Skills implement the same atomic workflow and use only their invoking Harness.

## Out Of Scope

- Real-time tracing, replay, pause/resume or debugging controls.
- A persistent normalized event database, content index or background collector.
- Tracking whether the user adopted a recommendation or whether it improved later Sessions.
- A recommendation ledger, longitudinal coach memory or formal AI-quality evaluation platform.
- A recommendation Pattern enum, deterministic router, `primary_constraint` schema or automatic intervention selection.
- Cross-Session causal merging or a separate recommendation-priority ranking; Token ranking remains navigation order and the decision state derives from each Session's existing analysis.
- Automated comparison of later tasks, rework classification, quality scoring or proof that a recommendation worked.
- 完整对话浏览、模型输出展示，以及轮次首条用户消息以外的原文展示。
- Cross-Harness ranking, comparison or combined Key Session Analysis.
- CLI-owned model calls, Provider keys or a standalone AI service.
- Guaranteed Plugin ownership without a source-proven namespace or versioned mapping.
- Exact causal attribution without a valid counterfactual.

## Supersession

This Spec supersedes the following narrow decisions in Issue 0004 and earlier report contracts:

- AI-authored Findings are no longer restricted to the surrounding conversation for report requests;
- the standalone HTML may contain validated Host Agent-authored Key Session Analysis;
- the Host Agent may read scoped, progressively selected Session content during the Skill workflow;
- default deterministic JSON/text/share output remains sanitized and model-free.
- the blanket ban on prompt text in HTML is narrowed: only the local full HTML may contain each displayed Turn's complete first user message; sanitized share HTML must remove it from the data before rendering.
- chart data may carry that message only in the sensitive local projection for the trajectory Tooltip; it remains forbidden in reusable deterministic AuditResult, JSON, text, and share projections.

All existing decisions about deterministic accounting, one selected Harness, Audit Scope, Provenance, Coverage, offline standalone HTML, accessibility, packaging and fail-soft missing values remain authoritative.

## References

- [MVP](../MVP.md)
- [Design](../DESIGN.md)
- [ADR 0001](../adr/0001-key-session-analysis-in-report.md)
- [Research](../research/high-usage-session-trajectory-zh-CN.md)
- [Harness data sources](../HARNESS_DATA_SOURCES.md)
