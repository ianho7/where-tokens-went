# Skill / Agent 验证分层与本项目校验器复盘

日期：2026-09-23。状态：研究与设计建议，尚未修改发布合同或 Ticket 状态。以下将官方资料、本仓库可复现的事实和设计推论分开。

## 官方做法

| 项目 | 可核实的做法 | 来源 |
| --- | --- | --- |
| Anthropic Agent Skills / skill-creator | 先用少量真实任务跑旧版与新版，展示原始产物，由用户作定性判断；客观断言可用脚本检查。其文档明确说主观的写作或设计质量适合定性判断，不要强加断言；盲比是可选的，常规人工反馈通常足够。 | [官方 skill-creator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)、[Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) |
| Anthropic Agent Evals | 区分代码、模型、人工三类 grader。代码检查快且可复现，但字符串/正则对合法变体脆弱、缺乏细腻判断；模型评分适合开放输出，但应由人工校准。建议在可能时使用确定性检查、必要时使用模型检查，并阅读失败轨迹，辨别真实失败与评分器误判。文章还建议多组件任务给予部分分数，而非只有全有/全无。 | [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) |
| OpenAI Agents SDK / Skill eval | SDK 在输入、输出和工具边界提供可配置 guardrail 与运行 trace；工具 guardrail 可允许、拒绝本次内容或中止。官方 Skill eval 指南建议少量必须通过的检查，先用轻量代码检查可观察行为，再用结构化 rubric 评估难以机械判断的质量。 | [Agents SDK guardrails](https://openai.github.io/openai-agents-python/guardrails/)、[tracing](https://openai.github.io/openai-agents-python/tracing/)、[Testing Agent Skills Systematically with Evals](https://developers.openai.com/blog/eval-skills) |
| LangSmith | 明确区分部署前的离线数据集评估与生产 trace 的在线评估；代码评估器适合解析、必填字段、结构和具体业务规则，LLM-as-judge 适合难以用确定性规则刻画的语气、清晰度、语义正确性。在线评估可按 trace 过滤及抽样，以控制成本。 | [Evaluation types](https://docs.langchain.com/langsmith/evaluation-types)、[Online LLM-as-judge](https://docs.langchain.com/langsmith/online-evaluations-llm-as-judge) |
| SWE-agent | 将逐步轨迹、配置和日志保存下来，供检查和复现；批量运行与 benchmark 评分是分开的步骤。 | [Trajectories](https://github.com/SWE-agent/SWE-agent/blob/main/docs/usage/trajectories.md) |

## 本仓库可复现的断点

1. **同一份输出有两套通过口径。** `src/skill-insights.ts` 的 `validateSkillInsights` 会丢弃不合格卡片、保留合格卡片，并可同时返回 `valid: true` 和非空 `errors`。`src/cli.ts` 的报告路径按 `valid` 接受保留的卡片并记录警告；`src/eval-lab.ts` 的 lane Eval 把任一 `errors` 记为整份 Trial `blocked`。这使“报告可展示有效卡片”和“发布前 Trial 失败”同时成立。
2. **本轮四份冻结输出的只读重放。** 使用当前构建中的 `validateSkillInsights` 与相应 Snapshot，`main/current` 保留 2 张、拒绝 1 张；`main/v2` 保留 2 张、拒绝 0 张；`held-out/current` 保留 1 张、拒绝 1 张；`held-out/v2` 保留 1 张、拒绝 1 张。四份结果均为 `valid: true`。这只证明卡片级过滤结果，不证明 v2 更好、可发布或已进入最终 HTML。原始输出在 `.scratch/0025-v2-release/raw/`，本轮 Trial 在 `.scratch/0025-v2-release/attempt-4-validation/`。
3. **开放语义正则反复误判。** 本轮已核实的例子包括把 Skill ID 内的 `tokens` 当作 Token 指标、把否定列表中的 `causes/drives` 当作肯定因果、把 `high-impact` 当作因果动作，以及把“shared routing 是待调查问题”当作共享能力结论。它们不证明所有语义规则都无用，但证明当前宽泛词匹配不适合作为整份输出的独立硬拒绝依据。对应实现位于 `src/skill-insights.ts` 的因果、Token 与 family 语义检查。
4. **发布证据另有独立缺口。** `docs/AI_PIPELINE_EVAL_SPEC.md` 与 `docs/AI_PIPELINE_EVAL_EXECUTION.md` 仍点名旧 held-out Case，而本轮使用新 Case `skill-insights-heldout-aha-v1`。本轮 Trial 的 `generationRecord` 为 `null`；本地 `.generation.json` 自述与输出哈希不能单独证明 Host 执行。以上缺口不能通过放宽文案验证器解决。Ticket 0025 尚未交付，独立质量审阅与最终 HTML 也未完成。

以上为当前工作区的诊断快照。工作区有大量既有未提交改动；本记录不改变 Spec、Ticket、Prompt、validator 或发布状态。

## 对本项目的推论（不是上述项目的实现声明）

1. **代码硬门槛应小而精确。** JSON 结构、Snapshot 绑定、数值重算、逐字内容摘录、可解析的 Evidence 引用、隐私边界与版本等可确定的事实适合代码裁决。关键词碰撞、否定句、`shared` 或 `impact` 等开放语义不宜作为单独的整份输出硬拒绝依据；这来自 Anthropic 对正则脆弱性的明确提醒，以及 LangSmith 对代码/语义评分任务边界的划分。
2. **把卡片有效性、整份报告可交付性、候选是否更好分开。** 无效卡不应展示；丢弃一张卡不必自动抹去剩余有效卡，但也不自动表示目标 Aha 已达成。目标洞察是否有用，应读实际产物并做同输入对照。这是对 Anthropic 部分分数、人工读轨迹及 skill-creator 定性反馈的项目化应用。
3. **证据来源与质量评分分层。** 运行 trace、原始输出、输入和版本用于判断“是否真的执行、在什么条件下执行”；代码验证可核实的证据绑定；独立审阅判断开放式洞察的解释是否有用、是否夸大。缺少可核实执行记录时标记 `unavailable`，不能由 JSON 哈希或评分器代证。这是从 SWE-agent 轨迹、Agents SDK tracing 和本项目目标作出的推论。
4. **验证失败也要反查评分器。** 在新增 Prompt 规则或再次生成前，检查原始输出、输入和具体命中规则；若合法表达被误杀，应修评分器或下调该规则的裁决权限，而不是逼模型不断绕词。Anthropic 明确要求阅读失败轨迹，确认错误来自 agent 还是 grader。

## 建议的本项目验证边界（待决策）

| 层次 | 保留的硬要求 | 建议如何判断 |
| --- | --- | --- |
| 事实与权限 | 范围、计数、Token 口径、Snapshot、Evidence 引用与摘录、隐私、版本 | 确定性代码拒绝错误数据；任何卡片引用无效 Evidence 都不得显示。 |
| 单张洞察 | 结构合法、可核实 Evidence、支持相称的结论 | 卡片独立保留或丢弃，并记录原因。高确定性的违规可硬拒；有歧义的自然语言判断交给针对原文和 Evidence 的审阅。 |
| 候选质量 | 主 Case 的目标 Aha、held-out 不回退、真实决策价值 | 少量冻结输入的同输入对照、维度化独立审阅、用户看实际洞察。有效卡片存在并不自动意味着候选获胜。 |
| 发布与运行 | 可核实的真实执行、正确安装、最终 HTML 可见、失败原因清楚 | 发布时做一次完整报告验收；原始输出哈希只证完整性，执行来源需另行核实。正式 Eval promotion 的更重证据合同独立保留。 |

建议先在 Ticket 0025 上校准 `fatal / partial / accepted` 三种状态：整份身份或隐私错误为 `fatal`；一张卡被安全丢弃且目标洞察仍在为 `partial`，进入独立质量判断；全部合格为 `accepted`。`partial` 不自动通过发布，目标 Aha 缺失或仍有不安全内容可见则拒绝。让运行时与 lane Eval 消费同一份卡片级结果，再以现有四份 raw 做零模型调用的对照实验。此项会改变现行发布合同，实施前需更新 Spec/Ticket 并独立复核；本研究记录本身不授权发布。

这组官方资料**不能证明**其他项目完全不用正则或没有严格门禁；能支持的较窄结论是：它们通常按可确定事实与开放语义分配不同评估手段，并保留人工校准和运行记录。具体门槛仍须按本项目隐私与证据风险确定。
