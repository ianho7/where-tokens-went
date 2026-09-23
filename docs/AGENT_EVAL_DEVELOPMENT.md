# `where-tokens-went` 的 Agent / Skill Eval 开发研究笔记

## 结论

本项目当前最值得优先修复的不是某一段 Prompt，而是两条工程闭环缺失：

1. **AI 行为闭环**：没有把“什么叫好”固化成版本化 Case、Rubric、Baseline 与 Regression，因此每次 Prompt / Skill 修改主要靠单次主观观察，无法区分真实改进、随机波动和旧能力回退。
2. **Report Run 闭环**：虽然 `docs/MVP.md` 已规定原子工作流、结构化校验、显式 fallback 与 Run 版本约束，但还需要让每个真实运行留下可诊断的阶段状态和失败原因，否则“AI 分析未显示”只能表现为不可用，无法定位发生在生成、校验、组合还是 UI 分发。

这两条闭环应分开建设：确定性代码继续用单元/契约测试；模型行为用小型、多 trial 的 Eval；真实 Report Run 用结构化 trace 和阶段状态解释失败。不要把三者塞进一个耗时的端到端测试。

## 可核查原则

### 1. 先定义成功，再修改 Skill / Prompt

OpenAI 的官方 Skill eval 指南把成功拆为 outcome、process、style、efficiency，并建议只保留少量必须通过的检查；Anthropic 也建议从真实失败和已有人工检查开始，早期 20–50 个任务就能产生价值。对单个 Skill，OpenAI 给出的更轻量起点是 10–20 个 prompt，并同时包含应触发和不应触发的案例。

对本项目，应把 `docs/MVP.md` 的十秒 Aha 目标直接转成 Eval Contract，而不是重新发明抽象指标：

- 用户能否在首屏识别最大有意义的 usage destination；
- 是否给出受 Evidence 支持的 mechanism，或明确具体 unknown；
- recommendation 是否由 mechanism 推出且带验证方法；
- AI 结果是否实际进入最终 HTML，而不只是成功生成 JSON；
- fallback 是否准确说明失败阶段，而不是笼统显示“不可用”。

来源：[OpenAI, *Testing Agent Skills Systematically with Evals*, “Define success…” 与 “small, targeted prompt set”](https://developers.openai.com/blog/eval-skills)；[Anthropic, *Demystifying evals for AI agents*, “Going from zero to one”](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)；本地材料：`D:/Downloads/Testing Agent Skills Systematically with Evals.md` §1、§4，`D:/Downloads/Demystifying evals for AI agents.md` “Collect tasks for the initial eval dataset”；项目合同：`docs/MVP.md` “Product promise”“Aha response”。

### 2. 分开 Capability Eval 与 Regression Eval

Capability Eval 用困难 Case 推动能力上升，可以保持较低通过率；Regression Eval 保护已经解决的行为，目标应接近全过。已经稳定的 capability case 可以“毕业”进入 regression suite。每个重复出现的问题都应成为一个带固定输入和失败断言的 regression case，而不只是追加一条 Prompt 指令。

对本项目，建议先建立以下回归簇：

- `analysis-missing-from-html`：AI JSON 合法，但最终 HTML 未渲染该内容；
- `opaque-unavailable`：fallback 没有给出精确 stage / reason；
- `invalid-evidence-ref`：模型引用不存在或越界 Evidence；
- `generic-finding`：Finding 只是指标复述或可跨 Session 套用；
- `partial-key-session`：Top Session 分析缺失且没有显式 null-state 原因。

来源：[Anthropic, “Capability vs. regression evals”](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)；本地材料：`D:/Downloads/anthropic-demystifying-evals-for-ai-agents-summary.md` §4、§12，`D:/Downloads/agent-skill-eval-driven-development.md` §11。

### 3. 结果、轨迹和运行状态要同时可见，但评分优先看结果

Anthropic 区分 transcript/trace 与 outcome，并提醒不要把固定工具调用顺序当成成功本身；应优先评分最终产物，只在安全、权限、必读 Prompt 等确属产品合同的地方约束过程。OpenAI 的官方 Skill eval 指南建议保存结构化 JSONL trace，让确定性检查可以解释 Skill 是否触发、运行了什么、产生了哪些 artifact，以及是否出现 thrashing 和 token 膨胀。

本项目应把一次 Report Run 保存为可检查的阶段记录（字段名称可按现有 Run manifest 调整）：

```text
preflight → inspect → report_synthesis → synthesis_validation
→ content_evidence → key_session_analysis → session_validation
→ compose → write → ui_dispatch
```

每阶段至少记录 `status`、开始/结束时间、输入 fingerprint、bundle/product version、产物 hash、验证错误码和 fallback 原因。原始历史内容仍遵守现有隐私边界，不进入普通日志。这样“AI 分析不显示”能被归类为：未调用、调用失败、输出无效、Evidence 不匹配、组合遗漏、写入失败或 UI dispatch 未完成。

来源：[Anthropic, “The structure of an evaluation”“Design the eval harness and graders”“Check the transcripts”](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)；[OpenAI, “Get started with lightweight deterministic graders”](https://developers.openai.com/blog/eval-skills)；项目合同：`docs/MVP.md` “Report generation hard boundary”相关要求及 “Aha response”。阶段化 Run 记录是结合这些原则对本项目作出的工程推论，不是来源原文中的现成架构。

### 4. 用三层 grader，不让 LLM Judge 承担机械校验

适合确定性 grader 的项目规则包括：JSON Schema、fingerprint、Evidence 引用解析、Session 范围、条数、null-state、locale、最终 HTML 中对应模块是否存在、UI dispatch 状态。适合 LLM rubric 的是：Finding 是否真正解释 mechanism、是否比指标复述更有洞察、建议是否对应问题、是否通过 portability test。人工只需校准主观维度和抽查高影响失败。

LLM Judge 应按维度拆开，并允许 `Unknown`；否则一个总分既难定位失败，也会迫使证据不足时猜测。Judge 必须定期与人的判断校准。

来源：[Anthropic, “Types of graders” 与 “Design graders thoughtfully”](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)；[OpenAI, “Conduct qualitative checks…structured response”](https://developers.openai.com/blog/eval-skills)；本地材料：`D:/Downloads/agent-skill-eval-driven-development.md` §12。

### 5. 用分层运行预算解决测试过慢

不要每改一行 Prompt 都跑完整报告。推荐三档：

| 档位 | 内容 | 触发时机 |
| --- | --- | --- |
| PR fast gate | 纯确定性合同测试 + 3–5 个高信息 smoke cases，每 Case 1 trial | 每次修改 |
| candidate eval | 10–20 个固定 Cases，重点 Case 3 trials，保存 trace、延迟、Token、失败分类 | Prompt / Skill 候选合并前 |
| scheduled/full | 完整 capability + regression，多 trial；慢速 HTML/UI 检查与人工抽样 | 夜间、里程碑、模型升级 |

先运行便宜、可解释的确定性检查，只有它们通过才调用模型；模型输出一旦 Schema 或 Evidence gate 失败，就停止后续昂贵阶段。Case 按历史失败簇分层抽样，smoke 集应覆盖最常见和破坏性最高的失败，而不是随机挑选。

OpenAI 明确建议从快检查开始，仅在能降低风险时增加 build/runtime 等重检查，并跟踪命令数、token 和 thrashing；Anthropic 强调多 trial 是处理非确定性的必要手段，并区分一次成功的 `pass@k` 与连续可靠的 `pass^k`。

来源：[OpenAI, “Extending your evals as the skill matures”](https://developers.openai.com/blog/eval-skills)；[Anthropic, “How to think about non-determinism”](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)；本地材料：`D:/Downloads/agent-skill-eval-driven-development.md` §9–§10。具体档位和 Case 数是针对本仓库成本结构的建议。

### 6. 一次实验只改变一个可证伪假设

固定 Case、模型配置、输入快照和 grader 版本，保存 baseline 与 candidate 的逐 Case 对比。每轮实验写明 target failure、hypothesis、change、expected improvement、must-not-regress、结果与 accept/reject。若同时修改 Prompt、Skill、evidence selector 和 composer，即使结果变好也无法归因。

AI 行为有随机性，因此不要用一次成功决定合并。报告面向用户的一致性更接近 `pass^k`：同类任务连续多次都不丢分析，比多次中偶尔成功一次更重要。

来源：[Anthropic, “How to think about non-determinism”](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)；本地材料 `D:/Downloads/agent-skill-eval-driven-development.md` §8、§10、§19。实验模板本身来自本地综合材料，未发现其对应的单一一手来源。

### 7. 禁止运行时“手搓临时代码”，把允许行为变成可审计资产

真实 Skill 工作流应只调用版本控制中的 CLI、schema、Prompt 和脚本；若模型需要生成临时代码才能完成常规报告，说明功能缺失在产品 harness，而不是该次运行应临时补洞。可以在 trace 中对命令和写入路径做 allowlist/分类：预期工具调用、只读诊断、未知临时脚本。未知脚本不必一概判失败，但必须显式记录并阻止它成为静默成功路径；确认是常规需求后，把它移入 `src/`、测试并打包。

这一条主要是针对用户观察和本项目 Source-of-Truth 约束的工程推论。可借鉴的官方依据是：Skill eval 应捕获 trace/artifact、检查预期行为与仓库清洁度，并使用最小权限。来源：[OpenAI Skill eval 指南](https://developers.openai.com/blog/eval-skills)；项目约束：仓库 `AGENTS.md` 的 “Report generation hard boundary”。

## 最小落地顺序

1. 建立 `evals/contracts/` 与 5 个上述真实回归 Case；先实现纯确定性 grader，不引入 Eval 平台。
2. 让 Report Run 输出阶段状态和稳定错误码，并在 HTML fallback 中显示用户可理解的具体原因。
3. 增加 3–5 Case smoke runner：固定输入快照，生成 trace + artifact manifest，失败可直接定位到阶段。
4. 给 report synthesis 与 key-session analysis 各建维度化 rubric，并用少量人工标注样本校准。
5. 将 Prompt / Skill 改动改为 baseline-vs-candidate 实验；通过后把真实失败加入 regression，完整套件转为 scheduled run。

这保持了 `docs/MVP.md` “不建设 formal golden evaluation platform”的边界：先用 repo 文件、现有 Node test runner、结构化 JSON 和小型脚本完成闭环，等 Case 数量、并发或跨模型比较真的成为瓶颈后再评估平台。

## 来源可信度与限制

- `D:/Downloads/Demystifying evals for AI agents.md` 是 Anthropic 官方文章的本地剪藏，关键主张已用官方原文核对。
- `D:/Downloads/Testing Agent Skills Systematically with Evals.md` 是 OpenAI 官方文章的本地剪藏，关键主张已用官方网页核对。
- `D:/Downloads/anthropic-demystifying-evals-for-ai-agents-summary.md` 是二手总结，只用于导航和中文术语，不作为独立事实依据。
- `D:/Downloads/agent-skill-eval-driven-development.md` 是面向本项目的综合性文章，但没有列出完整来源；其中 `.eval/` 目录、Session 切分和实验模板等属于作者建议，本文均按“本地材料主张/工程推论”处理。
- 官方文章说明的是通用原则，不证明上述具体目录、Case 数和阶段字段一定最优；这些项目化建议仍需用首轮 baseline 的运行时间、失败可定位率与人工一致性验证。
