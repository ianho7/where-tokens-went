---
status: draft
---

# Spec: Skill 洞察模块（Skill Insights）与证据化架构

## Problem Statement

当前 `where-tokens-went` 报告包含“Skill 使用证据”模块，列出各 Skill 的调用次数、涉及会话数、关联 Token 与等价成本。然而该表格仅能回答“使用了哪些 Skill”，无法回答以下深层问题：
1. 用户的 Skill 体系是如何实际协作的？是否存在少数 Skill 垄断绝大多数调用的高度集中现象？
2. 哪些高频 Skill 真正提供了模型缺失的硬约束或私有工具（Capability Delta），哪些内容随着基础模型能力增强已退化为冗余的通用流程脚手架（Generic Procedure）？
3. 哪些 Skill 在单任务中被高频反复调用（高 `callsPerTask`），可能存在重复指导？
4. 同一命名家族（Skill Family）的多个变体之间是否存在大量未解耦的重复内容？
5. 某些低频但体积巨大的 Skill 是否存在过早加载全部细节的问题，适合通过 References 实施渐进披露（Progressive Disclosure）？

若单纯依赖无约束的 LLM 对全部 Skill 内容进行开放式审查，不仅消耗大量 Token，还极易引发因果幻觉（如将任务关联用量错误断言为“Skill 造成/浪费了 Token”）、生造虚假指标或将任务内调用频次断言为“Prompt 重复注入”。

## Solution

实现一套“代码负责发现哪里值得看，AI 负责解释为什么值得看”的确定性与证据化 Skill 洞察体系：
1. **确定性衍生指标与候选筛选（Candidate Selector）**：在准备阶段从完整 Skill population 计算全局使用分布（低频 Skill 数/调用数、长尾占比、Top-N 份额）、完整 family metrics 及单 Skill 指标（`calls`、`tasks`、`callShare`、`callsPerTask`、`taskCoverage`），再基于无模型规则最多筛选 5 个 Unique 候选 Skill；候选采样不得改变统计口径。
2. **只读快照加载（Skill Snapshot Loader）**：严格按 `工作区 harness → 工作区 .agents → 用户 harness → 用户 .agents` 确定性路径读取候选 `SKILL.md` 及元数据，并在 `prepare` 阶段固化为不可变 Snapshot 产物，彻底消除运行期间的磁盘竞争与内容漂移。
3. **DAG 双轨/多轨流水线并发 AI 分析**：将 `skill-insights` 作为独立 Lane 接入现有的 DAG 并发调度框架，与 `report-synthesis` 和 `key-session-analysis` 协同推进。
4. **受控 Prompt 契约与预算门禁**：设立 24,000 estimated tokens 的正文预算。预算内执行高效 Single-batch 推理；预算超限则自动触发 Two-stage Fallback（逐一提取单个 Skill Profile 后聚合合成）。
5. **代码证据门禁（Evidence Gate）**：在 `compose` 阶段对模型输出执行阻断式校验，强制要求摘录在快照中逐字子串匹配（≤ 200 字符）、阻断因果用词（associated ≠ caused）、拒绝将频次伪称为注入，并要求非平凡的 Cognitive Delta（`mentalModelShift`）与 Decision Delta；family 语义结论必须有至少两个成员的内容证据，混合语义角色必须分别有证据。
6. **Kami 风格紧凑渲染**：在 HTML 报告中置于“Skill 使用证据”上方，渲染 0~5 张决策卡片（Quiet Card，证据不足允许更少，绝不为了填满卡片而凑数）；同一家族默认最多一张 family/Skill 洞察，只有认知与决策增量均不同且证据不重叠时才保留第二张，并隐藏内部 Schema 和原始长小数。

## User Stories

1. As a developer auditing agent usage, I want to see if my skill usage is concentrated in a tiny core, so that I know which 1~2 skills dominate my daily workflow.
2. As a skill author, I want the audit to distinguish true capability deltas from generic procedures, so that I can eliminate redundant guidance that modern models already follow natively.
3. As a workflow designer, I want to identify skills with high calls-per-task, so that I can investigate whether an agent is repeatedly seeking guidance within single tasks.
4. As a skill maintainer, I want to detect when multiple skills in a family share overlapping procedural instructions, so that I can extract a shared core or shared references.
5. As an optimization-minded user, I want rare but bulky skills to be highlighted for progressive disclosure opportunities, so that large reference texts are not loaded unconditionally into routine sessions.
6. As a privacy-focused developer, I want all skill content reading to happen locally from known disk roots and frozen in a run snapshot, so that no external network requests or disk races can mutate the analysis.
7. As a report reader, I want each insight card to cleanly separate observed facts, AI interpretations, and suggested next actions, so that I never mistake a hypothesis for a measurement.
8. As an auditor, I want every claim about skill content to provide an exact verbatim excerpt of 200 characters or less, so that I can instantly verify the source line in my editor.
9. As a cost-conscious user, I want the system to reject claims that a skill "caused" or "wasted" tokens without causal counterfactuals, so that correlation is never presented as causation.
10. As an ADHD user, I want the first screen of the skill section to present at most 3 to 5 high-impact findings, so that I can extract actionable takeaways in under 10 seconds.
11. As a user with few skill executions, I want the system to produce zero to two insights gracefully when evidence is sparse, so that no meaningless boilerplate is generated.
12. As a developer waiting for report generation, I want the skill insights LLM call to run concurrently with report synthesis and key session analysis, so that my total report wait time does not increase.
13. As a team lead, I want the report to avoid arbitrary quality grades, health scores, or vanity leaderboards, so that the output remains an objective engineering tool rather than a subjective linter.

## Implementation Decisions

### 1. 架构模块划分与数据流
- **Candidate Selector**：输入为确定性 `AuditResult.report.skills`，输出全局指标摘要与去重后的至多 5 个候选 Skill。
- **Snapshot Loader**：按固定优先级检索本地磁盘，构建不可变的 `SkillSnapshot`。
- **AI Orchestrator**：在 Host Agent 调度内发起并行请求，加载预定义 Prompt 合同，捕获时序 Trace。
- **Evidence Gate**：纯函数代码校验器，校验 Schema、子串、指标有效性、Cognitive/Decision Delta、语义角色证据与因果边界，并执行去重、主题多样性和截断至 5 条。
- **HTML Renderer**：将通过门禁的 `ValidatedSkillInsight` 渲染为符合 Kami 规范的 HTML 片段。

### 2. 候选筛选规则与四类候选定义
- **高频核心（High Frequency）**：按 `calls` 排序的 Top 2，或 `callShare ≥ 0.20` 的 Skill。
- **任务内高频（High Calls Per Task）**：`callsPerTask ≥ 3.0` 且总 `calls ≥ 5` 的 Skill（至多 2 个）。
- **Skill 家族候选（Family Overlap）**：基于短横线前缀或共享词干识别（如 `where-tokens-went-*`），选取重合度最高的一组（至多 2 个）。
- **长尾使用（Long Tail）**：全局统计 `lowFrequencySkillCount` 与 `lowFrequencyCallShare`，作为全局上下文，不单独读取长尾 Skill 的正文。
- **完整 family 口径**：`familyMetrics` 在候选采样前从完整 population 计算；`where-tokens-went*` 的家族份额不能只由被选中的正文成员相加得到。
- **总量控制**：所有候选 Skill 合计去重后严格不超过 5 个 Unique Skills。

### 3. 磁盘物理检索优先级（Path Resolution Order）
1. 工作区 Harness 路径：`<cwd>/.<harness>/skills/<name>/SKILL.md`
2. 工作区 Agents 路径：`<cwd>/.agents/skills/<name>/SKILL.md`
3. 用户全局 Harness 路径：`~/.<harness>/skills/<name>/SKILL.md`
4. 用户全局 Agents 路径：`~/.agents/skills/<name>/SKILL.md`
5. 若均未命中：标记 `contentState: "unavailable"`，仅保留用量数据，不触发内容审查。

### 4. 24k 内容预算与降级状态机（Budget & Fallback State Machine）
- 估算 Token 计算公式：`estimatedTokens = Math.ceil(skillMdBytes / 3.6)`。
- **Single-batch（默认）**：当 $\sum \text{estimatedTokens} \le 24,000$ 时，合并所有选中 Skill 的元数据与 `SKILL.md`，单次请求产出 Profiles 与 Insights。
- **Two-stage Fallback**：当总 Token 超过 24,000 时，针对超大 Skill 依次单独调用 Content Inspector Prompt 生成 `SkillContentProfile`；校验通过后，再聚合输入 Synthesis Prompt 生成最终洞察。

### 5. 证据门禁拦截规则（Evidence Gate Hard Boundaries）
- **因果拦截**：文本中若出现 `cause`、`caused`、`responsible for`、`waste`、`wasted`、`cost you`、`导致`、`造成`、`浪费`、`花掉了` 等因果推论，直接拒绝该条 Insight。
- **重复注入拦截**：若将 `callsPerTask` 解释为“完整 SKILL.md 被重复注入”，直接拒绝该条 Insight。
- **真实引用确定性匹配**：`evidenceExcerpt` 最长 200 字符，经过换行与空白规范化（normalize whitespace/line endings）后仍必须能在对应快照的 `SKILL.md` 中做确定性 substring match；重点在于防范虚假引用而非要求机械原始字节完全一致。
- **指标校验**：引用指标必须属于系统预置的确定性计算键，禁止模型自创指标。
- **认知与决策增量**：每条保留洞察都必须说明表面数据形成的印象、对照后观察到的结构，以及因此改变的维护/调查决策；“继续观察”“建议优化”不能单独满足门槛。
- **语义蕴含**：若同一条结论同时声称硬约束与通用流程处于同一层，必须分别引用两种角色的内容证据；若声称 family 成员共享能力核心，必须引用至少两个成员的内容。

### 6. 数据接口定义（Data Shape Contract）

```typescript
export type SkillInsightScope = "global" | "family" | "cross_skill" | "skill";

export interface SkillInsightDelta {
  before: string;
  after: string;
}

export interface SkillContentSnapshot {
  skillId: string;
  skillName: string;
  skillPath: string | null;
  contentState: "available" | "unavailable";
  skillMdBytes: number;
  skillMdEstimatedTokens: number;
  skillMdHash: string | null;
  skillMdContent: string | null;
  referenceCount: number;
  referenceBytes: number;
  referenceFiles: string[];
}

export interface ValidatedSkillInsight {
  id: string;
  scope: SkillInsightScope;
  subject?: { familyId?: string; skillId?: string; skillIds?: string[] };
  title: string;
  mentalModelShift: { surface: string; observed: string };
  decisionDelta: SkillInsightDelta;
  observation: string;
  contrast: string;
  interpretation: string;
  conditionalMechanism?: string | null;
  consequence?: string | null;
  confidence: "high" | "medium";
  evidence: Array<Record<string, unknown>>;
}
```

## Testing Decisions

- **外在行为测试（External Behavior Tests）**：
  - 纯函数测试确定性指标计算，覆盖空数据、0 任务、极端集中分布等边界条件。
  - 筛选器测试输入 30 个 Skill 使用记录，验证输出严格去重且数量 $\le 5$。
  - Loader 测试真实文件系统路径检索、中文 UTF-8 解析及文件缺失优雅降级。
  - 门禁测试输入模拟的各种有害/违规 LLM 输出（虚假摘录、因果陈述、超长引用、自造指标），断言 100% 拦截。
  - 报告渲染测试断言生成的 HTML 包含规范的卡片结构，且不出现“导致”或“造成”等因果用词。
- **测试模块与对比 Prior Art**：
  - 新增 `tests/skill-insights-derivation.test.js`、`tests/skill-snapshot-loader.test.js`、`tests/skill-evidence-gate.test.js`。
  - 借鉴 `tests/key-session-analysis.test.js` 的 Mock 注入与 Schema 校验机制。

## Out of Scope

- 自动编辑、重写、删除或合并本地 `SKILL.md` 文件。
- Skill 评分系统、等级划分或健康度打分（Health Score）。
- 依赖 Embedding / 向量数据库计算语义相似度。
- 完整的静态 AST 语法树解析或跨文件依赖调用图。
- 真实的运行时 Prompt Injection Trace 追踪（列入 V2 规划）。

## Further Notes

本模块旨在让报告在既有的使用量统计之上，提供具有认知增量的高价值解释。遵循 Kami 极简排版风格，让用户在 10 秒内迅速抓住 Skill 体系的关键演进方向。

## 2026-09-29 Contract Revision: Refined Runtime Boundaries

Bug Fix 0029 clarifies the boundary between runtime verification and authoring quality:
- **Runtime validation scope**: strictly verifies facts, data safety, and renderable structure:
  1. Valid top-level envelope matching the frozen `snapshotId`.
  2. Exact substring match for `evidenceExcerpt` (<= 200 characters) in the snapshot.
  3. Valid deterministic metric keys and evidence references.
  4. Non-empty required renderer fields (`reveal`, `mentalModelShift`, `decisionDelta`, `evidence`).
  5. Prohibition on machine-identifiable explicit metric numbers (tokens, percentages, costs, multipliers) in free prose; model names (`GPT-4o`, `Claude 3.5`), tool names, versions (`Python 3`, `v2`), years, and qualitative wording remain acceptable.
  6. Prohibition on direct affirmative causal assertions without trigger trace.
- **Quality targets**: cognitive delta depth, decision delta distinctiveness, deletion counterfactual depth, and multi-excerpt coverage are Prompt instructions and evaluation criteria for human review; they are not whole-output runtime regex vetoes.
- **Partial acceptance**: Valid cards are retained even if sibling cards are discarded; the lane is accepted as long as at least one card passes validation.
