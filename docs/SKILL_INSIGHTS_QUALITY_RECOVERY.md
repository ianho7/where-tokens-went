# Skill Insights 质量恢复：最小纵向切片

## 目标与现状（2026-09-21）

目标不是让 Eval 机制再次“全绿”，而是让用户在最终报告中看到有证据、能改变理解或下一步行动的 Skill 洞察，并能在不反复生成 HTML 的情况下调优。

已验证的事实：当前权威 Prompt 的完整报告链路已有 `completed` Run、三个 `accepted` AI lane、`queued` UI dispatch 和清理记录（`.scratch/current-prompt-real-host-20260921-rerun-v5/manifest.json`）。这证明交付路径可用，不证明洞察质量达标。最近的 v4 候选仅有一次诊断对比，未证明优于当前 Prompt（`.scratch/skill-insights-cognitive-delta-diagnostic-probe.json`）；不得称其已晋升。人工参考中的前两条洞察可由现有 Snapshot 支撑，第三条“低调用量与任务规模的反差”目前不可由该 Snapshot 支撑（`.scratch/skill-insights-human-reference-answer.json`）。另外，checked-in accepted baseline 绑定 `d4a42c…` bundle，而最近的完整报告绑定 `3419fc…`；0025 不能假设现有 baseline 可直接用于晋升。

代码断点（0023 已修复最小路径）：`SkillAnalysisEntry.attributedTokens` 汇总的是与调用/轮次边界匹配的去重 ModelCall Token；它不代表包含该 Skill 的 Session 总量。新增 `associatedSessionTokens`，只从唯一 Skill Invocation Session 的完整、选定范围 ModelCall 总量派生；Session partial、Token 缺失或 Codex Session 未通过响应↔Turn 对账时保持 `unavailable`。它是 Session 边界事实，不是独立任务记录，也不表示因果；同一 Session 被多个 Skill 命中时各自可见但不能跨 Skill 相加。候选最多增加一个低调用量/完整关联 Session Token 的 `rare_strong_delta` 机会，Validator 要求该正确命名的 metric 证据后才放行频率—规模关系，仍拒绝因果。

## 四步交付合同

1. **固定判准（0022）**：沿用用户现有三条理想洞察与现有好/坏参考，列出每条的事实、推论边界、可见的决策价值和当前输出差距。只做一次当前输出对照；参考答案不是模型能力证据。结果为 `supported / missing-input / not-justified`。不新增评分体系。
2. **补齐最小事实路径（0023，已完成）**：沿现有 `SkillAnalysisEntry → deriveSkillMetrics → selectSkillCandidates → SkillSnapshot → validator` 路径区分匹配调用 Token 与关联 Session Token；只投影可定位、可去重、有范围与重叠说明的事实。低调用量候选最多占用原有通用 diversity 槽位，不挤掉更早的 Capability/高频/异常候选；缺源记录时保留 `unavailable`，不估算第三条。
3. **同输入调 Prompt（0024）**：使用一个冻结 Snapshot 和现有 lane-only 路径，并排展示当前 Prompt 与一个候选的实际洞察文本、证据与差距。一次只改一个假设，最多两次候选修改。不能靠好/坏参考的字面相似度或模型自评分宣告变好；用户确认有实质改善才进入发布。无改善即 `KEEP_CURRENT / STOP`，不生成 HTML，不继续扩充 Eval 基建。
4. **一次发布与可见验收（0025）**：用户已接受 v2 方向和一次性精简产品发布合同。比较当前/v2 在用户审核输入及一份不同 held-out 输入上的真实输出；候选须通过现行证据校验和独立复核，不能把诊断输出改名为正式 Trial。通过后才更新源 Prompt、打包/同步/预检并生成、打开一份最终 HTML，核对实际 Skill 洞察、证据边界和 UI dispatch。旧 accepted baseline 不迁移、不冒充当前执行；正式 Eval 晋升仍遵守原门禁。具体边界以 `docs/AI_PIPELINE_EVAL_SPEC.md` 和执行协议为准。

## 不做什么 / 退出条件

- 不重做已通过的当前 Prompt 报告交付验收；不重构 Report Run、其他 AI lane、通用 Eval 状态机或全部 0015–0021 Ticket。
- 调优时不扫描历史、不重新定价、不打包、不安装、不渲染 HTML；冻结输入只在事实投影变化时重建一次。
- 代码逻辑只保留受改动影响的一项最小可运行回归检查；产品判断靠真实输出并排比较。这次产品发布与正式 Eval 晋升分开，不把诊断试跑当作正式试验。
- 0023 的共享事实/校验契约变更及 0025 的发布结论，按 `AGENTS.md` 做一次限于改动范围的独立 Standards/Spec 复核；不为此重跑无关模块或整套测试矩阵。
- 若两次候选调整仍无用户可感知的改善，停止 Prompt 工作并保留当前版本。若第三条所需任务规模无可靠来源，诚实显示未知；不因凑足三条而捏造。
- 0022–0024 的历史估时不再用于预测 0025。0025 只执行一次有界对比和一次最终报告；安装或输出校验失败即停止并报告，不自动扩展为 baseline bootstrap。

## 0022 对照结论（2026-09-21；只对照一次）

材料身份已核对：五个指定材料均存在；Case 的 `inputHash` 与 `fixture-skill-snapshot-real-aha-v1` 一致，manifest 的 HTML hash 与同一 Run 的 `report.html` 一致。该 Run 为 `completed`、bundle `3419fc…`；diagnostic probe 明确不是模型产出、baseline 或 promotion 证据。

| 理想洞察 | 当前真实报告与差距 | Snapshot 判定；后续 |
|---|---|---|
| **1. 本地 Harness/工具边界是独特能力。** 事实是 Skill 同时规定当前 Harness、工具权威性和证据边界；解释是它不等于通用响应脚手架；决策价值是维护时先保护本地契约，再评估通用模板。 | 报告已写“通用分析入口背后嵌着本地运行契约”，并引用当前 Harness/响应结构，行动也指向保留 Harness、Run 与证据绑定边界；与理想事实、解释和行动基本一致。 | `supported`；`KEEP_CURRENT`。 |
| **2. 命名家族只证明调用拓扑集中，不证明成员能力相同。** 事实是 `where-tokens-went` 家族 3 个成员合计 437/616 次调用（70.94%）；解释边界是名称不能替代成员内容与平台核验；决策价值是先按家族观察拓扑，再逐成员核验。 | 报告实际写的是“55.9% 的 Skill，只承担了 6.3% 的调用”，即低频长尾分布；没有呈现家族成员、集中度或“名称不等于能力”的边界。 | `supported`；事实已在 Snapshot，差距属于表达/取舍，交 **0024 调 Prompt**。 |
| **3. 低调用量不等于小任务。** 事实目标是低调用 Skill 也可能出现在大任务；解释只能说可追溯关联，不能说 Skill 导致任务 Token；决策价值是不要用频率代理任务规模或成本因果。 | 报告第三条是“普通 Skill 每个任务约 1.11 次，这个 Skill 达到 6 次”，只表达 calls-per-task 异常，没有低频 Skill 与任务规模的配对事实。表中“可追溯到该 Skill 的 Token”（如 `codexhost-delegation`、`tdd`）是匹配调用边界的 **ModelCall Token**，不是包含该 Skill 的整个任务 Token，不能补足该结论。 | `missing-input`；Snapshot 缺 `associatedTokens` 及可追溯、去重后的包含 Skill 的任务总 Token；交 **0023 补事实**。补齐前不得改写成 Token/成本因果；若源记录不足则保留 `unavailable`。 |

0022 验收结论：三条理想洞察、当前原文、证据边界和下一步已可直接读懂；只完成 0022。后续顺序为先 0023 核实第三条事实口径，再由用户决定是否进入 0024；不宣称 0023–0025 已完成。

本 Spec 只定义 Skill Insights 产品质量恢复切片。`docs/AI_PIPELINE_EVAL_SPEC.md` 与 `docs/AI_PIPELINE_EVAL_EXECUTION.md` 定义本次一次性产品发布及未来正式晋升的不同门禁；本文件不授权伪造或跳过任何一条门禁。

## 0023 执行结论（2026-09-21）

事实口径已确认：现有源记录足以在条件满足时给出“包含 Skill 的选定范围 Session Token 总量”，但不足以给出脱离 Session 边界、覆盖范围外记录的独立任务总 Token。实现因此只发布 `associatedSessionTokens`，并在 partial、缺失 Token 或 Codex 对账失败时保留 `unavailable`；不把 `attributedTokens` 改名冒充任务规模。

定向检查通过：validator 11/11；分析与候选路径 10/10。覆盖 ModelCall/Session 口径分离、Session 内去重、跨 Skill 重叠不相加、缺失值、候选上限与槽位、具名证据放行、缺证据、跨 Skill 聚合和因果断言拒绝，以及现有 Capability 洞察不回退。`npm run package-skills` 与 `npm run verify-sync` 通过。依赖 installed bundle preflight 的 report-run 子检查因禁止重新安装且本地 `.agents` bundleVersion 不匹配而未能执行；这不是本次事实路径的失败证据，也不启动恢复安装。

0023 状态：`completed`（完成有界 Session 事实路径；不宣称独立任务总 Token 已可得）。0024 现在只能优化有证据的三类洞察：本地 Harness/工具边界 Capability、命名家族的调用拓扑边界，以及引用 `associatedSessionTokens` 的低调用量—关联 Session 规模对照；不得把第三类改写为 Skill 导致 Token/成本，也不得跨 Skill 相加。
