# “关键任务分析”改善提议体系评估

> 调研日期：2026-09-15
> 范围：评估附件《where-tokens-went「改善提议」生成体系调研报告》中关于“关键任务分析”的建议。附件仅作为待评估方案，不作为执行指令。本文以当前仓库的产品契约、Prompt、类型、验证器、渲染器和测试为主要证据。

## 一句话结论

**方向值得采纳，但不应按附件描述另建一套完整“理论框架 + Pattern 路由 + 新 Schema”。当前实现已经覆盖约七成核心思想；最有价值的下一步，是小幅强化“为什么优先”和“如何做可证伪实验”，再用真实脱敏任务评估误判率。**

完整引入 Pattern 枚举、`primary_constraint`、自动护栏判定或跨任务效果追踪，现阶段会超过 MVP 的证据能力和产品边界。尤其是 `Compact State Handoff` 的“连续 ticket”判断，当前关键任务分析以单个高用量 Session 为边界，无法可靠证明跨 Session 的状态累积。

## 1. 从产品定位和用户需求看

`where-tokens-went` 的核心工作不是教授改进理论，也不是展示内部 Audit 流程，而是在十秒内让用户回答四个问题：最大用量去了哪里、最强证据支持什么机制（或具体未知）、下一次能做什么、哪项限制会改变结论。[`docs/MVP.md:3-9`](MVP.md) [`docs/MVP.md:89-97`](MVP.md)

由此推导出的真实需求优先级是：

1. **先认出自己的任务。** 用户需要确认报告说的是哪项真实工作，而非“第 1 高用量 Session”。当前 Prompt 已要求 `taskContext` 基于该任务内容，并用 portability test 拒绝换数字即可复用的模板。[`prompts/key-session-analysis.md:42-59`](../prompts/key-session-analysis.md) [`prompts/key-session-analysis.md:98-114`](../prompts/key-session-analysis.md)
2. **区分“贵”与“可避免”。** Token 集中只能说明去向，不能单独证明浪费。当前 Prompt 已明确：只有浓度、时长或排名而没有解释机制时，必须输出空 Finding，且“合法复杂任务”本身是候选解释。[`prompts/key-session-analysis.md:61-78`](../prompts/key-session-analysis.md)
3. **只获得一个值得先试的动作。** 多条最佳实践会把决策成本还给用户。现有结构只有一个 `recommendation`，Prompt 也只允许一个主要机制和一个 bounded action。[`src/types.ts:409-430`](../src/types.ts) [`prompts/key-session-analysis.md:61-96`](../prompts/key-session-analysis.md)
4. **知道建议还只是待验证假设。** 当前产品只提供用户自行验证的方法，不持久化建议、不跟踪结果，也不声称改善已经奏效；这是明确的 MVP 边界。[`docs/MVP.md:55-67`](MVP.md) [`docs/DESIGN.md:325`](DESIGN.md) [`docs/DESIGN.md:370`](DESIGN.md)

附件的总体方向与这些需求一致；风险在于把用户真正需要的“一个有根据的动作”扩张成一套用户不可见、但会显著增加生成复杂度的内部本体。

## 2. 附件建议与现有能力的重合度

| 附件建议 | 当前仓库状态 | 增量价值 | 判断 |
|---|---|---:|---|
| 证据 → 模式 → 机制 → 建议 | 已要求观察与解释分离，且 Finding 必须解释机制 | 低 | 已实现主要语义 |
| 只选一个 Primary Intervention | Schema 只有单个 recommendation；Prompt 只选一个机制和动作 | 很低 | 无需新增规则层 |
| Evidence strength 限制 recommendation strength | 已有 `strong / moderate / limited`、替代解释和空状态 | 低 | 可优化文案，不需重构 |
| 弱证据允许不给建议 | `primaryFinding: null` 时 recommendation 必须为 null，验证器与测试覆盖 | 很低 | 已实现 |
| Use when / Do not use when | 已有 `applicability`、`tradeoff`，但没有明确反适用检查 | 中 | 值得强化 Prompt |
| “为什么优先” | 当前 `rationale` 已在首屏动作下展示，但没有强制与次优方案比较 | 中高 | 最值得补强 |
| Prediction + quality guardrail | 当前只有一个自由文本 `verification` | 中高 | 值得做实验性增强 |
| Pattern router / pattern enum | 当前没有显式路由或 Pattern 字段 | 低到负 | 易诱发套模板，不建议首版加入 |
| 自动验证改善效果 | 明确不在 MVP；缺少建议历史、同类任务匹配与返工指标 | 高，但远期 | 需要产品扩围 |

现有首屏已经显示“最大 Token 去向 → 机制 → 下一步 → 验证方法”，并直接渲染 recommendation 的 action、rationale 和 verification。[`src/report.ts:575-593`](../src/report.ts) 因此单独新增“为什么优先”视觉区块很可能只是重复现有 rationale；更好的做法是提升 rationale 的内容契约，让它明确回答“为什么这个动作比最接近的替代动作更值得先试”。

## 3. 可行性与可靠性：必须分开评估

### 3.1 工程可行性：高

把 Systems Thinking、TOC、PDSA 转成 Prompt 内部检查清单，或加入少量 Pattern 示例，工程上很容易。当前生成链路已经有权威 Prompt、结构化 Schema、验证器、双 Skill 打包和 HTML 渲染入口；无需引入新的模型服务或数据层。[`docs/DESIGN.md:255-301`](DESIGN.md)

### 3.2 结论可靠性：目前中等，且不同层级差异很大

可靠性可分三层：

| 层级 | 当前能力 | 可靠性 |
|---|---|---|
| 数据归属与引用 | Audit fingerprint、Top 3 范围、同 Session Evidence、已读 Turn、Codex 逐任务 Token 对账均有校验 | 较高 |
| “这个机制最可能” | 主要依赖 Prompt 判断；验证器能检查字段和引用，却无法证明语义上的因果解释是真的 | 中等 |
| “这个动作会改善整体结果” | 只提供未来验证方法；没有自动结果跟踪、同类任务匹配、质量/返工度量 | 低 / 未实现 |

验证器现在能拒绝跨 Session 引用、未读取 Evidence、内容不足、Token 未对账、原文泄露和完全重复模板。[`src/key-session-analysis.ts:299-382`](../src/key-session-analysis.ts) 测试也覆盖重复分析、参数化叙述、内容不足和对账阻断。[`tests/interactive-report-regressions.test.js:414-641`](../tests/interactive-report-regressions.test.js) 但这些是**结构和边界校验**，不是机制真实性校验。Pattern 越多，模型越容易从“候选动作”反推“看起来匹配的机制”，这正是附件自己警告的 solution-first reasoning。

当前内容读取还有明确上限：每个 Session 最多选择 12 个 Turn，默认最多 24 条内容、每条 1200 字符，其余通过 `unreadScope` 显式保留为未读。[`src/content-evidence.ts:13-19`](../src/content-evidence.ts) [`src/content-evidence.ts:138-150`](../src/content-evidence.ts) [`src/content-evidence.ts:194-196`](../src/content-evidence.ts) 这对隐私和成本是合理的，但意味着“整个任务由多个阶段组成”“多数检查都成功”“历史细节持续跨 ticket 携带”等全局机制不总能从所读片段得到证明。

## 4. 三个 Intervention Pattern 的逐项评估

评分为 1–5，可靠性指“当前证据能否支持这个判断”，不是动作本身是否听起来合理。

| Pattern | 产品价值 | 工程可行性 | 当前证据可靠性 | Aha 潜力 | 结论 |
|---|---:|---:|---:|---:|---|
| Stage Boundary | 5 | 5 | 3 | 5 | 最适合先试，但必须要求明确阶段切换 + 后续上下文增长的联合证据 |
| Exception-only Evidence | 4 | 5 | 2 | 3 | 动作简单，但当前只能证明工具结果与高用量相邻，不能证明它是原因或多数结果可丢弃 |
| Compact State Handoff | 4 | 4 | 1–2 | 4 | 与 Stage Boundary 高度重叠；跨 ticket 场景超出单 Session 分析边界，暂不宜作为独立路由 |

### 4.1 Stage Boundary：可行，但只能作为有前提的实验

当前 Audit 能提供 Turn 顺序、输入 Token 前后半段中位数比、compaction 标记、工具结果大小与任务内容片段，因此在“内容显示目标已切换”且“后续输入持续增长”同时出现时，可以合理提出阶段交接实验。[`src/types.ts:366-405`](../src/types.ts) [`src/analysis.ts:878-907`](../src/analysis.ts)

不能仅从“大 Turn、cached input 高、任务很长”推出应拆阶段。大上下文可能是任务本身必需，缓存输入也可能比未缓存输入更经济。拆分还可能增加首次请求负担、恢复决策上下文的时间和遗漏风险。建议强度应停留在“下次同类任务试验”，除非内容证据明确显示独立目标仍共享大量不再需要的历史。

### 4.2 Exception-only Evidence：动作可用，诊断证据偏弱

项目的 deterministic candidate 对 `tool_result_adjacency` 的方法说明明确写着：报告工具结果大小和相邻 Turn Token，**不主张因果**。[`src/analysis.ts:899-904`](../src/analysis.ts) 当前 `errorCount` 能识别显式错误，但没有稳定的“检查通过 / 检查失败 / 后续仍需原始证据”分类，因此无法可靠证明“大部分验证结果都是正常、可安全摘要”。

该 Pattern 最安全的表达不是“以后都只保留异常”，而是：“对下一次同类视觉或测试任务试用异常摘要，同时保留失败证据的可回溯位置；比较工具结果量和后续输入，并确认检查覆盖与漏检没有恶化。”在没有覆盖率或漏检数据时，质量护栏必须明确为用户检查项，而不能伪装成已有指标。

### 4.3 Compact State Handoff：概念合理，当前产品边界不支持强判断

如果“连续 ticket”是多个独立 Session，关键任务分析只读取各自 Top 3 Session 的局部内容，不能建立 ticket 链、继承关系或跨 Session 状态流。报告级 synthesis 又被明确禁止输出 Session-specific action，因此现有架构没有可靠的跨 ticket 推荐落点。[`prompts/report-synthesis.md:19-25`](../prompts/report-synthesis.md)

如果多个迭代都在同一 Session 内，这个 Pattern 又与 Stage Boundary 几乎等价：都是在目标变化后只携带必要状态。首版应合并为一个更中性的 **Context Boundary Experiment**，避免模型为了选择标签而制造区别。

## 5. 理论框架是否真的增加可靠性

### Systems Thinking

适合作为“不要从单个数字直接给建议”的内部提醒，不适合作为因果证明器。Donella Meadows 原文把 leverage points 明确描述为拓宽思考的邀请，而不是寻找杠杆点的配方，并警告复杂系统难以机械泛化。[Donella Meadows Project：Leverage Points](https://donellameadows.org/archives/leverage-points-places-to-intervene-in-a-system/)

### Theory of Constraints

“集中在一个约束、避免同时优化所有局部指标”与产品需要高度匹配；TOCICO 的 Five Focusing Steps 也确实以识别、利用、服从、提升约束为顺序。[TOCICO：Five Focusing Steps](https://www.tocico.org/resource/collection/B6E9C93D-AFC5-407E-9D8B-AD70D0AEAFE0/Ferguson%2C_Lisa_TOCICO_FM_Basics_Ferguson_Lenhartz_EN_130507%28FINAL%29.pdf) 但当前 Schema 已天然限制为一个主要 Finding 和一个 recommendation，所以理论名称本身不会增加多少可靠性；有价值的是把 rationale 写成优先级比较。

### PDSA

最有实质增量。Deming Institute 将 PDSA 定义为学习循环：Plan 包含理论和成功指标，Study 比较预测与实际结果，再调整理论，而不是只做一次成功/失败检查。[Deming Institute：PDSA Cycle](https://deming.org/explore/pdsa/) 因此附件提出 prediction 和 guardrail 是对的，但当前产品最多只能生成 **PDSA-inspired experiment plan**，还不能声称拥有 PDSA 闭环，因为结果不会被系统持久化或自动 Study。

### Lean / Andon 与 Toyota Kata

Andon 的第一方定义是让状态和异常一眼可见并触发响应。[Lean Enterprise Institute：Andon](https://www.lean.org/lexicon-terms/andon/) 将它类比为 exception-only summary 可以启发设计，但不能单靠这个理论证明“正常原始证据可以删除”。软件验证仍需可追溯性和失败后的诊断材料。Toyota Kata 对本文的必要性更低；在现有证据不能可靠识别连续 ticket 状态链时，引入名称只会增加 Prompt anchoring。

## 6. Aha 时刻评估

先说明证据边界：仓库有十秒 Aha 的产品定义、HTML 内容快照和回归测试，但未见用户访谈、任务成功率、阅读耗时或可用性测试材料。因此以下是基于信息层级与现有交互契约的**产品判断**，不是已经由真实用户证实的效果结论。[`docs/MVP.md:130`](MVP.md) [`tests/fixtures/kami-report-content-baseline.json`](../tests/fixtures/kami-report-content-baseline.json)

### 能增强 Aha 的部分

- **明确“为什么先做这个”。** 当用户同时看到长 Turn、工具结果、缓存输入、compaction 时，一句优先级理由能消除“为什么不是先压工具输出”的疑问。
- **把建议写成可证伪实验。** “如果判断正确，下一次同类任务的后续输入应下降；同时检查返工和交付质量不变”比“减少上下文”更能促成行动。
- **允许不建议。** 具体未知比通用最佳实践更能建立信任；当前产品已经支持这一点。

### 会削弱 Aha 的部分

- 在界面显示 Systems Thinking、TOC、PDSA、Pattern 名称、constraint 字段或完整因果链，会把用户的注意力从“我的用量去哪了”移到“系统如何分析”。这违反当前语言边界和十秒首屏契约。[`CONTEXT.md:7-21`](../CONTEXT.md) [`docs/DESIGN.md:293-303`](DESIGN.md)
- 同时展示 prediction、多个 cost metric、多个 guardrail、适用/不适用、trade-off，会让首屏再次变成审计表。首屏应保留一个动作、一个为什么优先和一个最小验证；完整适用条件可留在关键任务展开项。
- Pattern 标题容易让三个不同任务看起来像同一个模板，反而触发项目已经专门修复过的 portability 问题。

**Aha 判断：附件整体框架的增量 Aha 只有中等；其中“为什么优先 + 可证伪验证”的 Aha 很高，而“理论库 + Pattern 路由 + 新字段”的 Aha 很低甚至为负。**

## 7. 推荐实现路径与工作量

估算假设：一名熟悉仓库的工程师；包含 Prompt、类型/验证、双 Skill 打包、定向测试与 diff 检查；不含正式用户研究和发布流程。

### Slice A：Prompt-only 验证（推荐先做）— 1–2 人日

1. 在权威 `prompts/key-session-analysis.md` 中要求 rationale 明确说明“为什么该动作比最接近的替代动作更优先”。
2. 要求 verification 同时包含一个预期方向和一个质量护栏；没有现成指标时必须标为用户自行检查，不得伪造数值。
3. 把 `Stage Boundary` 作为一个带 `use_when / do_not_use_when` 的例子，而不是 enum 或强制路由。
4. 更新 Prompt 契约测试并重新打包两个 Harness Skill。

这个 Slice 不新增 UI 和 Schema，现有 rationale、applicability、tradeoff、verification 字段足够承载实验。它能最快验证内容是否真的更有用。

### Slice B：小型可靠性评估 — 3–5 人日

建立 12–20 个最小脱敏真实任务样本，至少包含：明确阶段冗余、合法复杂任务、大工具结果但无因果、失败/重试路径、证据不足、跨 ticket 无法证明。人工按以下维度盲评：

- 机制是否由 Evidence 支持；
- 是否选择了正确的“不建议”状态；
- 动作是否针对机制而非指标；
- “为什么优先”是否排除了更近的替代解释；
- 验证是否同时检查成本与质量。

建议把上线门槛定在“零明显越界因果断言”，并记录 no-recommendation 的误拒绝和误放行，而不是只看 JSON 是否通过 validator。仓库当前明确不做 formal golden platform，因此这里应保持为小型固定 fixture 与人工 rubric，而非建设评估平台。[`docs/MVP.md:61-67`](MVP.md)

### Slice C：确认有增益后再结构化 — 2–4 人日

只有 Slice B 证明自由文本经常漏掉优先级或护栏时，才考虑新增 `priorityRationale`、`prediction`、`guardrail` 字段，并同步修改：

- `src/types.ts`；
- 权威 Prompt 与两个打包副本；
- `src/key-session-analysis.ts` 验证；
- `src/report.ts` 和中英文固定文案；
- 回归 fixture、组合验证和隐私测试。

不要首版加入 `pattern` enum、`primary_constraint` 或 router。它们没有新增用户可见能力，却会增加迁移、验证、渲染和模板化风险。

### Slice D：自动效果闭环（远期）— 10–20+ 人日

若产品要自动判断建议是否有效，需要新增建议历史、相似任务匹配、前后窗口对比、返工/完成质量代理、失败归因和隐私策略。这是新的持续教练产品，而不再只是一次性用量解释；必须先修改 MVP/DESIGN，并通过真实需求验证后再立项。

## 8. 主要风险与控制方法

| 风险 | 发生方式 | 控制 |
|---|---|---|
| Pattern anchoring | 模型看见 Pattern 后反向寻找证据 | Pattern 放在诊断之后；先写机制和反证，再看候选动作 |
| 把相关性写成因果 | 工具结果、compaction 与高 Token 相邻 | 保留“adjacency 不证明因果”；反证足以动摇时输出 null |
| Token 降了但质量变差 | 少读证据、少验证、拆分导致返工 | verification 必须包含质量护栏；无指标时标为用户检查 |
| 缓存被误判为浪费 | cached input 高看起来“重复” | 同时呈现缓存经济性；不把缓存 Token 等同于可避免成本 |
| 拆分导致恢复成本 | 新阶段重新加载必要背景 | tradeoff 必须指出恢复成本，并只在上下文确有冗余时建议 |
| 三个任务输出同一模板 | Pattern 标签替代任务机制 | 保留 portability test；Pattern 不进入用户标题 |
| “验证”被误解为已证实 | 报告给出未来比较方法 | 使用“预测 / 下次检查”，禁止“已改善”措辞 |

## 9. 最终建议

### 应采纳

- 把“为什么优先”变成 `rationale` 的强制语义，而不是先新增 UI 字段。
- 把 verification 升级为“预期变化 + 质量护栏 + 下次同类任务怎么比较”。
- 为 Stage Boundary 提供严格的使用与反适用条件，先作为 Prompt 示例实验。
- 用小型真实 fixture 评估因果越界和“不建议”准确性。

### 暂不采纳

- 不把 Systems Thinking、TOC、PDSA 名称展示给用户。
- 不建立多 Pattern enum/router；先避免解决方案先行。
- 不把 Compact State Handoff 作为独立 Pattern，除非未来能证明跨 ticket 状态链。
- 不承诺自动验证改善效果；当前只能帮助用户设计下一次实验。
- 不新增 `primary_constraint` 等内部本体字段，除非它能在真实评估中带来可测的质量提升。

## 10. 决策摘要

| 维度 | 结论 |
|---|---|
| 产品定位匹配 | 高；但只能作为内部推理约束，不能变成理论展示 |
| 用户需求匹配 | “为什么优先”和可证伪验证高度匹配；Pattern 分类本身不是用户需求 |
| 工程可行性 | Prompt-only 很高；结构化扩展中等；自动闭环低 |
| 当前可靠性 | 数据引用高、机制判断中等、改善结果证明未实现 |
| Aha 时刻 | 小改版高；整套框架直接落地中低 |
| 推荐工作量 | 先投入 4–7 人日完成 Prompt 实验 + 小型可靠性评估；确认增益后再投入 2–4 人日结构化 |
| 总体决策 | **有条件采纳，先窄后宽；接受推理原则，不接受一次性体系化扩张** |

## 主要证据来源

- 产品承诺与验收：[`docs/MVP.md`](MVP.md)
- 架构、权威边界与非目标：[`docs/DESIGN.md`](DESIGN.md)
- 用户语言和领域边界：[`CONTEXT.md`](../CONTEXT.md)
- 关键任务分析生成契约：[`prompts/key-session-analysis.md`](../prompts/key-session-analysis.md)
- 报告层与任务层职责分离：[`prompts/report-synthesis.md`](../prompts/report-synthesis.md)
- 已接受的关键任务分析决策：[`docs/adr/0001-key-session-analysis-in-report.md`](adr/0001-key-session-analysis-in-report.md)
- Schema：[`src/types.ts`](../src/types.ts)
- 验证与去模板逻辑：[`src/key-session-analysis.ts`](../src/key-session-analysis.ts)
- 确定性候选 Evidence：[`src/analysis.ts`](../src/analysis.ts)
- 渐进内容读取：[`src/content-evidence.ts`](../src/content-evidence.ts)
- 首屏与关键任务渲染：[`src/report.ts`](../src/report.ts)
- 回归覆盖：[`tests/interactive-report-regressions.test.js`](../tests/interactive-report-regressions.test.js)
