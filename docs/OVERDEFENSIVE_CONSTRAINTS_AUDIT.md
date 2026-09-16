# where-tokens-went 过度防御与报告内容缺失调查

> 调查日期：2026-09-15
> 调查范围：当前 worktree 中的 Skill、源 Prompt、TypeScript 代码、打包产物、测试、项目文档与 ADR。
> 调查性质：问题记录与限制盘点，不等于立即删除所有限制。

## 结论先行

当前限制不是同一种东西，应该分开处理：

1. **必须保留的安全与事实边界**：Harness、项目和时间范围隔离；敏感内容脱敏；缺失值不补零；不把相关性写成因果；不把 Skill 可用性写成实际调用；不把估算成本写成账单。
2. **已确认会过度隐藏内容的门槛**：报告综合校验采用整份失败回退；排名和 Token 构成按组全量失败；Key Session 曾把全局对账状态当成全部分析的门槛；Content Evidence 读取失败会静默跳过；未知限制原因落入过于笼统的文案。
3. **数据显示了但解释不充分**：固定英文内部原因、原始状态词、内部 Evidence 引用和机械句子拼接曾直接进入用户文案；已有本轮修复，但默认兜底仍可能丢失具体原因。
4. **产品范围延后而不是数据错误**：窄视图不调用 AI、只分析 Token 排名 Top 3、只读候选轮次、没有跨 Harness、没有配额/账单/因果影响、没有持久化内容索引。这些限制可能让用户觉得“少”，但不应和错误地隐藏已有证据混为一谈。

最值得优先收窄的是：**局部无效不应使整份有效叙事消失；局部数据缺失不应使可计算的其他分组消失；读取失败和未知原因不能静默或泛化。**

## 一、此前三个问题的记录

### 1. 中文没有覆盖具体的 Key Session 失败原因

`src/report-messages.ts:1186-1197` 的 `unavailableReason()` 只有少数精确匹配。未命中的原因统一返回“任务解读未通过证据核对”，因此：

- 用户看不到究竟是对账、指纹、轮次范围、Evidence 读取还是结构字段失败；
- “保留确定性轮次轨迹”会让人误以为整个任务分析都不可用；
- 同一个通用文案覆盖了不同的修复路径。

当前已补充若干具体映射，包括 Codex Token 对账、重复解读、指纹不匹配、轮次越界、核心判断、改善提议和 `evidenceRead`。仍然存在的风险是，未来新增英文内部原因仍会落入通用分支。

### 2. 部分轮次无法对账时，为什么曾经全部不分析

原因是此前把全局 `summary.tokenAccountingStatus` 当作 Key Session 的共同准入条件。任何一个 Token-bearing 任务的响应 Usage 总量与累计轮次快照不一致，都会使全局状态为 `mismatch`；旧逻辑没有先判断当前候选任务是否属于不一致集合，于是所有任务都被拒绝。

这不是数据推理的必然结果，而是门槛作用域过大：

- **应该被阻止的**：发生对账问题的那个任务的机制判断和建议；
- **仍可分析的**：同一审计中有完整、独立对账的其他任务；
- **仍应保留的**：所有任务的已知 Token 去向、轮次轨迹和具体未知原因。

当前代码已改为读取 `AuditResult.keySessionTokenAccounting` 的逐任务状态：已核对任务仍可产生解读；不一致或不可用任务保留任务上下文和证据范围，但 `primaryFinding` 与 `recommendation` 为 `null`。这解决了“一个坏任务拖垮全部任务”的根因。

### 3. 为什么之前没有 `tokenAccountingStatus`

`tokenAccountingStatus` 不是 Codex 原始字段，而是项目在 Reader 之后派生的审计不变量。它在提交 `99495d2`（`Implement key session analysis`，2026-09-12）中引入，所以更早的报告不会出现。

当前链路是：

1. `src/codex-reader.ts:326-368` 从 Codex 历史记录读取响应 Usage 和 `token_count` 的累计/增量字段；
2. `src/codex-reader.ts:920-1004` 去重响应 Usage，按任务比较响应总量与最新累计轮次快照总量；
3. `src/types.ts:142-150` 定义项目自己的 `TokenAccountingSummary`；
4. `src/analysis.ts:1185-1194` 将状态放进 `AuditResult.summary`，并标为 `provenance: "derived"`。

因此：

- `responseTotal`、`turnTotal` 是从历史记录取得的 `reported` 数值；
- `status`、`reconciledSessionIds`、`mismatchedSessionIds` 和比较方法是项目代码计算的 `derived` 结果；
- 它不是 Codex 官方账单、配额、限流或 API 状态；
- 它可以作为“当前数据能否支持某个任务级结论”的证据，但不应作为全局报告的硬阻断。

## 二、最后一次读取快照

以下数字来自调查期间最后一次读取的本地 Codex 快照；历史文件会继续变化，数字不是固定基线。

| 项目 | 快照值 | 含义 |
| --- | ---: | --- |
| 任务记录 | 137 | 当前选择范围内的 Session 记录 |
| 轮次 | 941 | 可形成轮次轨迹的记录 |
| 模型调用 | 7,599 | 读取到的模型调用记录 |
| 文件 / 读取记录 | 774 / 308,101 | Reader 覆盖范围 |
| 跳过记录 / 不完整任务 | 1,612 / 0 | 有记录被跳过，但 Reader 没有归因到不完整任务 |
| 覆盖警告 | 1 | 其中包含 Codex 对账警告 |
| 缺少可用 Token 总量的调用 | 0 | 本快照中 Token 总量本身没有缺失 |
| 可排名任务 | 127 / 137 | 10 个任务没有可排名模型调用，不等于 Token 字段缺失 |
| 首次请求完整度 | 127 / 137，92.7% | 只有有有效时间戳和模型调用的任务进入该指标 |
| 任务级对账 | 118 已核对，9 不一致 | 只影响对应任务的机制结论 |
| Top 3 Content Evidence | 3 个包，均非空 | 每包最多 24 项；本次探针中 53 / 72 项被截断 |

本快照没有发现“Token 字段缺失导致 Top 3 排名消失”或“Content Evidence 空包导致当前 Top 3 全部不可解读”，但代码路径允许这些情况发生，见后文。

## 三、已确认的内容缺失或过宽门槛

严重级别：

- **P0**：用户已有的有效结论被整体隐藏，直接破坏“有证据的去向解释器”；
- **P1**：一个局部缺失使一整个分组或维度不可用；
- **P2**：数据仍在，但用户看不到具体原因或下一步；
- **保留**：边界是产品或隐私要求，不应仅为增加文案而放宽。

| 级别 | 位置 | 限制 | 实际影响 | 判定 |
| --- | --- | --- | --- | --- |
| P0 | `src/key-session-analysis.ts:203-276`、`src/report.ts:485-488,794-804` | `ReportSynthesis` 任一字段、Finding、Evidence 引用或叙事去重校验失败，整份 synthesis 变成 `null`，Findings 全部回退到 Automated Checks | 一个坏 Finding 可以隐藏同一份 synthesis 中其他有效 Finding | 应收窄为局部丢弃或局部回退 |
| P0 | `src/analysis.ts:64-76,97-132` | 一个分组中任一模型调用缺 Token，总量为 `null`，该分组从排名中整体过滤 | 一个调用缺字段会隐藏该任务、模型、项目或时间分组的其他可用 Token | 应保留完整度并允许部分汇总 |
| P1 | `src/analysis.ts:153-188` | 任一调用的 Token 构成缺失、负数或不互斥，整个分组的 input/cache/output 构成均为 `unavailable` | 其他调用本来可以分解的缓存和输出构成也不显示 | 可按兼容调用子集显示，并明确覆盖率 |
| P1 | `src/analysis.ts:79-94` | 有 Session cost 快照时，任一所选任务缺最终成本，整体 reported cost 为 `null`；无快照时任一调用缺 cost 也为 `null` | 成本总览过于容易变成无数据；虽不阻断 Token 主路径，但会丢掉可加总部分 | 应显示部分成本及覆盖范围，或明确这是严格总计 |
| P1 | `src/content-evidence.ts:154-202` | 文件读取失败、JSONL 中间行解析失败、非对象记录和未命中记录直接 `continue`；Codex 的 `warnings` Map 没有被填充 | AI 可能收到空包或少量包，却不知道内容是“没有内容”还是“读取失败” | 必须区分空、未命中、跳过和读取失败 |
| P1 | `src/content-evidence.ts:135-150` | Content Evidence 只能来自同一 Harness、项目、时间范围、Top 3，且每任务只能选 1-12 个轮次 | 低排名任务没有机制解读；超出候选轮次的上下文不参与判断 | Top 3 和范围边界应保留，但影响必须显式可见 |
| P1 | `src/content-evidence.ts:73-84,194-197,236-239` | 每项内容默认最多 1,200 字符，每任务最多 24 项；内容脱敏后才交给分析 | 任务的真实上下文可能被截断，机制证据可能落在未读取部分 | 保留上限，但必须把截断和未读范围作为具体未知 |
| P2 | `src/report-messages.ts:377-404,407-448` | 未知英文 warning 或 limitation 退化为通用“有一条数据记录无法读取”或“存在一项未满足的诊断条件” | 用户看不到具体缺少什么，也无法判断是否影响最大去向 | 应补充最小的结构化映射；未知原因不能伪装成同一种原因 |
| P2 | `src/report.ts:563-568` | 机制未知文案过滤包含内部词的 limitation，命中后直接换成一般性的“具体机制未知” | 为了不泄露内部术语，可能连同有价值的具体未知原因一起删除 | 应把内部原因转成用户语言，而不是一律抹掉 |
| P2 | `src/report-messages.ts:1184-1185` 及相关拼接 | 已终止句子再与下一句拼接，可能形成 `。；`、`。.` 或中英文标点混用 | 破坏可信度，也提示文案是机械拼接 | 已做局部修复；仍需把“片段是否带终止标点”作为调用约定检查 |

### 已有最小复现

- `validateReportSynthesis()` 输入两个 Finding，其中一个不合法时，结果为 `valid: false`、`synthesis: null`，两个 Finding 都不返回；
- 用一个完整分组和一个缺 Token 分组调用排名分析时，全局总量不可用，缺字段分组被过滤，完整分组也无法得到正常占比；
- 这两条是逻辑级复现，不依赖历史内容，因此属于确认的根因，不是单次报告偶发问题。

## 四、需要 fixture 才能定量确认的风险

下表是代码已经显示出的限制，影响方向明确，但当前真实快照没有触发，不能把它们误报成已经发生的线上故障。

| 位置 | 风险 | 当前行为 | 需要的最小验证 |
| --- | --- | --- | --- |
| `src/key-session-analysis.ts:84-97,346-383` | 跨任务可移植性判定可能误杀真实的相似任务 | 去掉排名、ID、轮次和数字后，规范化文本相同的候选全部标为重复并隐藏 | 两个不同任务、同一机制但不同证据和行动的脱敏 fixture |
| `src/key-session-analysis.ts:44-50,203-211,305-310` | 审计指纹任一字段变化使全部 AI prose 过期 | stale synthesis / Key Session 全部无效 | 修改一个不影响主答案的 Coverage 字段，验证是否仍需整份重做 |
| `src/analysis.ts:445-487` | 首次请求只取每任务最早有效模型调用 | 没有有效时间戳或模型调用的任务从该指标排除；总量严格不可用，但中位数仍可能可用 | 缺时间戳、只有工具事件、重复响应的任务 fixture |
| `src/analysis.ts:995-1045` | 顶层/子任务和不完整任务交叉统计要求所有身份与归因字段完整 | 任一任务缺身份或 partial 归因，三个交叉值一起不可用 | 仅缺一个 `isSubagent` 或 `partial` 的多任务 fixture |
| `src/analysis.ts:703-733` | 历史滚动峰值跳过含空 Token 的整个窗口 | 所有候选窗口都含空值时，峰值完全不可用 | 一个窗口中单个调用无 Token 的时间序列 fixture |
| `src/codex-reader.ts:959-964` | 响应 Usage、增量 `token_count`、最终累计值采用优先级而非合并 | `rawCalls` 非空就完全优先于 incremental；若 raw 来源不完整，可能遮住另一来源 | 同一任务同时存在不完整 raw 与完整 incremental 的 fixture |
| `src/codex-reader.ts:600-616,710-719`、`src/claude-reader.ts:338-379` | 中间 JSONL 损坏通常只计 skipped，不标记任务 partial；未知“敏感型”事件则标记 partial | 数据丢失与任务归因不对称，用户只看到总跳过数 | 中间坏行、未知 token/response 行、尾部坏行各一份 fixture |
| `src/cli.ts:149-170` | 周报切片过滤 calls/tools/lifecycle 等，但保留原始 turns 和 `tokenAccounting` | comparison 的轮次或对账状态可能来自切片外范围 | 两周边界各有轮次/快照的 fixture |
| `src/analysis.ts:1057-1073` | 40% 长任务、工具放大、额外生命周期、60% 模型集中度等阈值只生成候选检查 | 本身不会进入正常 Findings，但 fallback 时容易让检查看起来像结论 | synthesis 失效时检查 fallback 的用户理解测试 |

## 五、两个 Harness Skill 的限制清单

`skills/where-tokens-went/SKILL.md` 是 Codex 与 Claude Code 共用的 Harness-native Skill，按当前 Host 选择 Harness；Codex 额外包含任务级 Token 对账规则。Skill 不是独立事实源；Prompt 副本由 `scripts/package-skills.js` 从 `prompts/` 复制生成。

| Skill 规则 | 影响 | 判定 |
| --- | --- | --- |
| 固定调用方 Harness；不扫描另一个 Harness | 避免把不同数据源混为一个答案，但无法跨 Harness 比较 | 保留 |
| 当前项目和最近 7 天为默认；所有项目必须显式请求；不静默扩大范围 | 可能让用户以为“最近活动”是全局，但这是可解释的范围边界 | 保留，首屏要清楚写范围 |
| `inspect` 只取得 JSON；正常流程不先生成或打开 deterministic HTML；最终 `compose-report` 只调用一次 | 确保报告经过 Prompt 生成、校验和统一组合；中间结果不对用户冒充最终报告 | 保留 |
| 先读完整 bundled Prompt，再生成并校验 synthesis/Key Session | 保证规则一致，但增加了模型上下文与生成失败概率 | 保留，失败时应做局部降级 |
| Report Synthesis 无效时整份保留为 `null`，Findings 使用同一模块的 Automated Check fallback | 一个结构问题会让用户失去有效 AI Findings | 收窄；这是当前 P0 |
| Key Session 无效项只重生成一次，仍失败就省略；不允许第二次模型调用 | 避免无限重试、成本和新的不一致，但单个任务容易显得“没有内容” | 保留一次重试；省略时必须显示具体未知 |
| 只对 Token 排名 Top 3 任务读 Content Evidence，优先最小候选轮次，不读完整 transcript | 隐私和上下文成本边界；低排名任务没有 AI 机制解释 | 保留，但显示“未解释的原因” |
| 历史内容是不可信数据，不能改任务、授权工具或扩大范围 | 防止 prompt injection 和越权 | 保留 |
| 默认输出不含原始 Prompt、模型响应、源码、命令、工具结果、凭据和 base64；本地完整 HTML 仅允许展示轮次的首条用户消息，share/JSON/text 删除 | 保护敏感信息，但会减少机制解释的可读上下文 | 保留；可改善“缺少什么”的说明 |
| 不把 quota、剩余额度、reset、实际账单、因果 Skill 影响写成可得结论 | 防止把本地历史误当 Provider 事实 | 保留 |
| 窄视图 `usage`、`tools`、`week`、`window`、直接 CLI text/share 不调用 AI | 保持 deterministic view 快速、可审计，但这些入口没有用户中心解释 | 属于产品范围，不应误称为报告缺失 |
| 报告必须走同一 Harness、项目、时间、隐私边界；不得用用户问题文本作为 shell 命令 | 安全和范围一致性 | 保留 |
| Kami 颜色、图表线型、ARIA、打印和响应式规则 | 视觉验收约束，不直接限制事实内容；但固定五章和模块位置减少了重排空间 | 保留，除非后续发现首屏布局实际遮挡答案 |

## 六、两份源 Prompt 的限制清单

### `prompts/report-synthesis.md`

- 只使用完整、脱敏的 `AuditResult`，不能使用原始 Session 内容；因此报告级 Finding 只能做跨指标关系解释，不能直接解释任务语义。
- Overview 必须是 1-2 句，引用 1-3 个同一 Audit 的 Evidence；不能给建议、写项目进度或重复 Finding。
- Finding 最多 5 条、没有最低数量；零条必须带 `noStrongFindingReason`。这不是错误，但在 synthesis 无效时会与 fallback 叠加造成“内容很少”。
- Automated Check 只能作为候选 Evidence 或 fallback，不能因为 warning 自动升格为核心发现。
- Finding 必须解释关系和影响，不写行动建议；建议归 Key Session。
- accounting、Coverage、pricing 默认是可信度信息，只有实质改变 Primary Answer 才进入核心叙事。
- 不得写 Host Agent、Content Evidence、Evidence 选择、schema、验证、排名过程或 Model Call 数量；这是用户语言边界，但如果内部原因没有本地化映射，具体限制会一起消失。
- 不得推断因果、完成结果、质量、工作时间、实际账单和配额；数值必须使用 Audit 原值和 Provenance。
- Evidence 引用必须可解析、属于当前 Audit；Fingerprint 不匹配即失败。

### `prompts/key-session-analysis.md`

- 只分析 Token 排名 Top 3；每个任务使用同一 Audit Scope、同一 fingerprint、同一任务的轮次和 Content Evidence。
- `taskContext` 必须说明任务实际在做什么；`observation` 必须是任务独有现象；不能用“它是最高 Token 轮次”冒充解释。
- `interpretation` 只有在证据支持机制时才生成；只支持集中度时必须使用 `primaryFinding: null`。
- 没有机制就没有 recommendation；因此“已知去向 + 具体未知”是合法结果，不应强行补 Finding 或建议。
- 推荐必须包含 action、rationale、applicability、trade-off、verification，并且引用同一任务已读取的 Evidence。字段严格但能防止把建议写成无据动作。
- Codex 只要求所选任务自己的 accounting 为 `reconciled`；`mismatch`/`unavailable` 任务保留上下文但 Finding 和建议为 `null`。这已修复旧的全局阻断。
- 跨任务可移植性检查去除排名、ID、轮次和数字后仍相同即拒绝；它防模板化，但可能误杀共享机制的真实不同解释。
- 不得复制原始历史内容、源码、命令、工具结果、凭据或 base64；只能转述。
- 严格要求 Evidence ID 属于同一任务、必须在 `evidenceRead` 中已读；证据选择错一个就会使该任务分析无效。

## 七、代码层限制清单

### CLI 与范围：`src/cli.ts`

- 强制 `--harness`，且只能是 `codex`/`claude`；`--cwd` 必须绝对路径；`--cwd` 与 `--all-projects` 互斥。
- 默认 `7d`；share 未显式指定时间时改用 `30d`；week 通过两个 7 天窗口比较。
- 直接 `--html` 是 deterministic fallback，不是正常 Skill 最终结果；正常报告必须由 composition envelope 生成。
- 周报的 `sliceRead()` 存在范围一致性待验证风险，见第四节；这不是隐私限制，而是可能让比较使用切片外的 turns/accounting。

### Reader：`src/codex-reader.ts`、`src/claude-reader.ts`

- 递归读取本地 JSONL，只保留当前 Harness 的记录；不构建跨 Harness 数据库。
- 缺失字段保持 `null`；不可识别的记录大多跳过。文件读取失败会计数并加 warning，中间 JSON 行解析失败通常只计 skipped，尾部坏行才归为 partial。
- 未知记录类型如果名称含 `usage/token/response/assistant/message/tool/call/turn/retry/interrupt/compact/subagent/error`，会标记 Session partial；这个宽正则可能把未知但不影响 Token 的记录当成敏感缺口。
- Codex 响应 Usage、增量 token_count、最终累计值不混加；去重和来源优先级保护总量准确性，但 raw 来源完整性不足时可能遮挡另一来源。
- Codex 的 Turn/Thread 累计快照只用于对账，不应被当成新增调用量；当前 `tokenAccountingStatus` 就是此处派生的项目不变量。
- Skill 证据只有 listing、显式调用或可验证资源/脚本关系才能升级；普通文字、目录列表和未知字段不算调用。
- 工具结果默认只计算字节/字符大小，不回显正文；图片/base64 不输出。

### 分析：`src/analysis.ts`

- Token 总量需要每个选定模型调用都有可用总量；任一缺失即整体 total unavailable。
- 排名按 group 全量完整才保留；这是当前确认的 P0/P1 内容缺失来源。
- Codex Token 构成会从 input 中拆出 cache-read/cache-write；不满足非负和互斥关系就整组 unavailable，防止重复相加但过于严格。
- 报告成本优先使用 Session 累计快照；任何所选任务无最终成本就不生成整体 reported cost。API 等价价格路径则允许已定价子集的 partial estimated。
- 首次请求只取每任务最早有效、去重的 ModelCall；没有有效调用的任务排除，不能称为准确启动税。
- 顶层/子任务统计要求所有身份覆盖；partial 任务统计要求 Reader 能逐任务归因且数量一致。
- 历史滚动峰值会跳过含空 Token 的候选窗口；Tool amplification 只有 call/result 配对后才估算，未配对不猜正文大小。
- 40%、60% 等阈值只产生 Automated Check，不应自动成为 Finding；fallback 场景需要避免用户把它们理解成诊断结论。
- Skill 的可用、调用、归因和因果影响分开；因果影响始终 unavailable，除非有对照/反事实。

### Content Evidence：`src/content-evidence.ts`

- 请求必须与 Audit 的 Harness、项目范围、时间范围完全一致。
- 只允许排名 Top 3 的任务，每任务 1-12 个轮次，不能重复任务，不能跨任务或跨范围引用。
- 默认每任务最多 24 个内容项，每项最多 1,200 字符；每项先做凭据/Bearer 脱敏，再标记是否截断。
- 文件打不开、JSONL 行解析失败、没有稳定 ID、没有时间戳、未命中选择的内容都直接跳过；当前 warnings Map 没有记录这些跳过原因。
- 返回的 packet 标记为 untrusted；它仅是内存中的 Key Session 输入，不写入 Audit、JSON、text 或 share。

### Key Session 与 composition：`src/key-session-analysis.ts`

- Report Synthesis 的 Evidence 引用必须能解析到 summary、ranking、check 或 Turn；跨 Audit/未知引用失败。
- 当前 Report Synthesis 验证是整份原子失败；Key Session 是逐项验证，但重复规范化文本时会成组淘汰。
- Fingerprint 将 scope、coverage、summary、rankings、turns、candidates、accounting、report、checks 一起绑定；任何输入变化都会使旧 AI 文案过期。
- 一个候选必须同时满足 Top 3、同任务 Evidence、已读取轮次、结构字段、机制/建议规则和隐私规则。
- 失败项返回 unavailable；设计上没有用不确定的模型生成结果“尽量显示”，而是保留确定性轮次轨迹。这保护真实性，但当前的原因解释仍不够细。

### 报告与本地化：`src/report.ts`、`src/report-messages.ts`

- `validatedReportSynthesis()` 只接受 fingerprint 正确且整份验证通过的 synthesis，否则 Findings 全部降级为 checks。
- Primary Answer 现在优先显示最大有效任务、其任务级机制分析、可用行动和只会改变答案的限制；全局 accounting mismatch 不再自动挤进主答案。
- 机制未知时会过滤内部术语；这是隐私/语言边界，但目前以删除信息为代价，应该改为精确用户语言映射。
- Evidence 数字必须通过 formatter 带名称、单位和 Provenance；排序、表格、图表仍然属于验证层，不能让用户必须读图才能知道主答案。
- raw Evidence ID 保留在 HTML 属性、结构数据或方法细节；普通用户可见文案不应显示原始 ID。
- 窄屏和打印复用同一章结构；没有新增第二套页面、Tabs 或卡片系统，因而首屏信息需要依赖既有 composition 顺序。

### 隐私投影与类型：`src/prompt-projection.ts`、`src/types.ts`

- `firstUserMessageText()` 只保留首条用户消息，排除 tool_result 并脱敏凭据；本地完整 HTML 可用，share/JSON/text 不可用。
- `AuditResult`、`ContentEvidencePacket`、`ReportComposition` 明确分离确定性事实、内存内容和本地专用字段；原始内容不进入公共结果模型。
- 所有诊断值要求 `reported`、`derived`、`estimated` 或 `unavailable`；“没有数据”不能编码成 0。这是事实边界，不是展示层缺陷。

### 价格：`src/rates.ts`

- 只按 Provider/model 精确匹配 LiteLLM 目录；默认 4 秒超时、失败 soft，不阻断 Token 结果。
- 只提交 Provider/model 元数据，不保存独立价格缓存；无法精确匹配时金额 unavailable。
- 已定价 Usage 可以给 partial estimated，并显示覆盖；不兼容或未定价 Usage 排除。
- 这部分比 Token 对账更宽容，当前不属于主要内容缺失根因；但用户容易把“金额无数据”误解成“Token 无数据”。

### 打包：`scripts/package-skills.js`

- `prompts/report-synthesis.md` 与 `prompts/key-session-analysis.md` 是唯一源文件；脚本把它们复制到共用 Skill 的 `references/`，并复制编译后的 runtime。
- 生成的 references/runtime 不是第二套手工逻辑；修改 Prompt 后必须重新打包，不能只改某个 Harness 副本。
- 打包脚本会清理并重建 generated runtime；当前调查不修改它以外的依赖或服务。

## 八、文档与验收契约中的限制

### `AGENTS.md` 与 `CONTEXT.md`

- 要求 Primary Answer 先于 Evidence、下钻、方法和限制；用户不应从多个审计模块自行拼答案。
- 要求内部 ontology 留在代码、结构数据和方法细节，不在用户叙事中出现 Host Agent、Content Evidence、Audit Scope、schema 或原始 Evidence ID。
- 要求 accounting、Coverage、pricing 默认留在信任层，只有实质改变答案时才进入核心叙事。
- 要求缺证据时显示已知去向和具体未知，而不是制造 Finding 或建议。
- 要求不新增 registry、factory、service、数据库、第二模型或通用 NLP 校验器。

### `docs/MVP.md`

- MVP 只支持 Claude Code/Codex 当前 Harness、当前/所有项目、时间范围、Token 排名、缓存/价格、首次请求、Skill 状态、确定性 checks、Report Synthesis、Top 3 Key Session 和最终 HTML。
- 明确禁止跨 Harness、配额/账单、OTel/hooks/cloud、MCP/dashboard/team analytics、持久化数据库、正式语言评测、推荐历史和自动跟进。
- 明确 raw content 只在内存或本地完整 HTML 的首条用户消息例外中存在；share/JSON/text 去除。
- 明确 Findings 最多 5 条且零条合法，Automated Checks 不能直接填充正常 Findings；这防止“凑数量”，但在全份 synthesis 回退时会放大稀疏感。
- 明确 AI 只用于完整/report HTML workflow；窄 view 的“没有解读”是产品边界，不是 Reader 失败。

### `docs/DESIGN.md`

- 架构固定为一条 Reader、共享 deterministic analysis、Host synthesis、Top 3 内容、Key Session analysis、一次最终 composition。
- CLI 是事实唯一权威；Host Agent 负责解释；内部 CLI 不持有 Provider 凭据、不启动第二模型客户端。
- malformed Session 不应隐藏 valid Sessions，但当前 Report Synthesis 的 malformed Finding 仍会隐藏同份有效 Finding，这是契约与实现之间的重点矛盾。
- 类型中的 optional 字段缺失必须为 `null`，来源不明的身份/partial/时间/价格不能猜测。
- 任何 AI 文案必须绑定当前 fingerprint，并通过引用、范围、同任务 Evidence 和机制规则校验。
- 五章、图表、表格、默认展开任务和隐私语义必须保留；首屏只能通过既有组合结构改善。

### `docs/HARNESS_DATA_SOURCES.md`

- 当前只支持两个 Harness；Pi 和 DeepSeek 章节是暂停支持的调研资料，不代表当前 CLI 能读。
- 官方数据结构不稳定或没有正式 schema 时，Reader 必须宽容解析、保留来源、缺失置 null；这解释了 partial/unavailable 设计。
- Codex 的 `last_token_usage` 是增量、`total_token_usage` 是累计，不能逐行相加；当前 accounting 对账来自这里。
- 工具正文、Skill body、Prompt、回复、源码和凭据默认只保留大小/元数据；关键任务才允许在同一范围内读取内容。
- 当前文档也要求成本 partial、Skill 证据状态分层、无反事实不谈因果；这些是应保留的边界。

### `README.md` 与 ADR

- `README.md` 把 Skill workflow 作为正式入口，裸 CLI 只属于确定性证据面或 fallback；这会降低直接查看原始内容的自由度，但保证入口一致。
- `docs/adr/0001-key-session-analysis-in-report.md` 固化了 Key Session 进入报告的原因和最多 Top 3 的范围。
- `docs/adr/0002-ai-report-narrative-hierarchy.md` 固化了 Primary Answer、层级、零 Finding 合法和信任限制后置。
- `docs/REPAIR_AI_NARRATIVE_GROUNDING_PROMPT.md` 记录了当前 AI 叙事修复方向；它支持“有据解释”，但也把严格校验和具体未知放在同一条降级路径上。

## 九、总体处置建议

| 处置 | 条目 | 理由 |
| --- | --- | --- |
| **保留** | Harness/项目/时间范围隔离；历史内容 untrusted；凭据/base64/模型响应/源码/命令/工具正文不进入默认输出；缺失不补零；不做因果、账单、配额推断 | 这是安全和事实真实性，不是过度防御 |
| **保留但显式化** | Top 3 内容范围、1-12 轮、24 项/项 1,200 字符、一次重试、窄视图无 AI、成本精确匹配 | 限制确实存在，但要告诉用户缺少的具体范围和它是否改变主答案 |
| **P0 收窄** | Report Synthesis 整份原子失败 | 局部坏 Finding 不应隐藏其他有效 Finding；至少应保留 Overview 和合法 Finding |
| **P0/P1 收窄** | Token 排名、Token 构成和 reported cost 的分组全量失败 | 显示可计算子集、覆盖率和“未包含什么”，而不是整组无数据 |
| **P1 修复可见性** | Content Evidence 的读文件/解析失败静默跳过；warnings 未填充 | AI 和用户无法区分无内容、未命中和读取失败 |
| **P1 修复可见性** | 未知 warning/limitation 的通用本地化 | 具体未知必须回答“缺少什么、影响哪一项” |
| **P1 需要 fixture** | portability 去重、raw/incremental 优先级、JSONL 中间坏行、周报切片 | 先用最小脱敏 fixture 证明是否误杀，再决定是否改规则 |
| **不要做** | 删除全部隐私脱敏、取消同任务 Evidence、让全局 mismatch 再次阻断全部分析、把 warning 自动升格 Finding、引入第二模型/NLP 框架/数据库 | 会偏离产品目标，且不能解决真正的内容缺失根因 |

## 十、调查边界与下一步

本次只保存调查记录，没有在此文档之外新增代码修改，也没有改变 Reader、Token 计算、定价、隐私边界或 Content Evidence 获取规则。现有 worktree 中其他未提交修改均视为用户工作，未覆盖或清理。

下一次实现应按 P0 顺序处理：先让 Report Synthesis 和分组统计具备局部降级，再补 Content Evidence 的具体失败原因；每个非平凡规则只增加一个最小脱敏 fixture/回归检查。Prompt 源文件改动后继续只通过 `scripts/package-skills.js` 同步两个 Harness Skill。

## 十一、再次复核：还有哪些机制会造成阻断

本节专门回答“还有没有类似 `tokenAccountingStatus` 的东西，会让内容不显示”。这里把“阻断”分成四种，避免把字段无数据、单任务解读失败和整份报告失败混为一谈。

### 1. 会让整层 AI 内容消失的阻断

| 机制 | 位置 | 阻断范围 | 当前判定 |
| --- | --- | --- | --- |
| Report Synthesis 原子失败 | `src/key-session-analysis.ts:203-276`、`src/report.ts:485-488,794-804` | 一个 Finding、Overview、Evidence 引用或叙事去重校验失败，整份 Overview/Findings synthesis 变为 `null`，报告退回 Automated Checks | **P0 过宽阻断** |
| Audit Fingerprint 不匹配 | `src/key-session-analysis.ts:210-211,308-310`、`src/cli.ts:271-280` | 旧 AI 文案不再进入当前组合；最终 HTML 仍可生成，但 AI Overview/Findings/Key Session 会降级 | **应保留完整性门槛，但影响范围可能过宽** |
| Report Evidence 引用失败 | `src/key-session-analysis.ts:217-272` | 未知、跨 Audit、跨范围 Evidence 或 Overview/Finding 叙事重复时，整份 Report Synthesis 无效 | **P0/P1，需改为局部淘汰或局部回退** |
| Content Evidence 范围校验失败 | `src/content-evidence.ts:135-150,201-203,243-249` | Harness、项目、时间范围不一致，或选中非 Top 3/重复任务/范围外轮次时，Evidence 获取直接抛错 | **安全边界应保留；错误应转为具体未知，不应静默拖垮报告** |
| Key Session 严格校验失败 | `src/key-session-analysis.ts:306-343` | 当前任务的 Finding 和建议被清除；确定性轮次轨迹仍可保留 | **单任务级门槛，通常合理，但失败原因需要细分** |

### 2. 与 `tokenAccountingStatus` 最相似的全局派生信号

`summary.keySessionTokenAccountingStatus` 在 `src/analysis.ts:1116-1121` 中由 Top 3 任务的逐任务状态派生：

- Top 3 全部 `reconciled` → `reconciled`；
- 任一 Top 3 为 `mismatch` → `mismatch`；
- 无法完整判断 → `unavailable`。

它本身不是 Codex 字段，也是项目代码生成的 `derived` 信号。当前正常数据路径优先使用 `AuditResult.keySessionTokenAccounting` 中的任务级状态，因此已不应因为一个任务失败而阻断全部任务。

但 `validateKeySessionAnalysis()` 仍有兼容性回退：当所选任务没有逐任务状态时，会回退到 `summary.keySessionTokenAccountingStatus`，再回退到 `summary.tokenAccountingStatus`。因此旧 Audit、手工构造的测试 Audit 或不完整 composition 仍可能重新触发全局阻断。

这是一条仍需收窄的潜在路径：**逐任务状态缺失时，应保留任务级未知，而不是用全局状态拒绝所有非空结论。**

### 3. 只阻断单个任务或单个指标的门槛

| 机制 | 位置 | 结果 |
| --- | --- | --- |
| 任一 ModelCall 缺 Token | `src/analysis.ts:64-76,97-132` | 对应任务、模型、项目或时间分组可能整体不参与排名；全局总量也可能变为 unavailable |
| 任一调用 Token 构成不完整/不互斥 | `src/analysis.ts:153-188,308-357` | 对应分组的 input/cache/output 构成整体 unavailable；价格主路径仍可对兼容子集估算 |
| 缺少有效时间戳或 ModelCall | `src/analysis.ts:445-490` | 该任务退出首次请求统计，但其他首次请求仍可计算 |
| 缺少全部任务身份元数据 | `src/analysis.ts:995-1045` | 顶层/子任务交叉统计或 partial 归因统计整体 unavailable |
| 所有滚动窗口都含空 Token | `src/analysis.ts:715-735` | 历史五小时峰值 unavailable，不影响基础 Token 总量 |
| Key Session 引用未读取、跨任务或未知 Evidence | `src/key-session-analysis.ts:319-336` | 当前任务整个机制判断无效，但不影响其他任务和确定性轨迹 |
| 跨任务规范化文本相同 | `src/key-session-analysis.ts:346-383` | 重复组中的 Key Session 分析全部被省略，防模板化但可能误杀真实相似机制 |
| 无机制证据 | `prompts/key-session-analysis.md:53-92` | 只显示已知去向和具体未知；Finding 与 recommendation 必须为 `null`，这是语义规则而非异常阻断 |

### 4. 命令级硬错误

以下条件会直接终止某一步，而不只是让某个字段 unavailable：

- CLI 缺少 `--harness`，或同时缺少 `--cwd`/`--all-projects`；
- `--cwd` 与 `--all-projects` 同时使用；
- `--since`、`--view`、`--format` 或 `--pricing` 参数不合法；
- Content Evidence 选中非 Top 3、重复任务、零轮次、超过 12 个轮次或范围外轮次；
- `compose-report` 缺少合法 JSON composition envelope 或最终 HTML 路径。

这些是调用契约或安全边界，不能和“报告内容被过度隐藏”混为一谈；但 Content Evidence 的范围错误应在最终报告中体现为具体未知，而不是只留下通用“任务解读不可用”。

### 5. 复核结论

按“类似 `tokenAccountingStatus` 的全局派生门槛”定义，当前最重要的同类项是：

1. `summary.keySessionTokenAccountingStatus`：Top 3 聚合对账状态，仍有兼容性回退造成全局阻断的潜在路径；
2. `auditFingerprint`：完整性绑定，任意审计输入变化会让全部旧 AI 文案失效；
3. `ReportSynthesis` 整体 validation：不是状态字段，但一个局部错误会使整层 AI 叙事消失。

其他 `unavailable` 大多只影响单个指标或任务，不会直接阻断整份报告。当前最后一次真实快照中，Token 缺失调用为 0、Top 3 Content Evidence 均非空，因此已确认的主要风险是门槛设计和降级路径，而不是原始 Token 数据完全不存在。
