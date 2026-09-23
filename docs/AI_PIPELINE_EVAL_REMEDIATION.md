# Goal-mode remediation prompt — round 3

> Historical round-3 execution prompt. Its requirement for a successful non-no-op promotion before accepting runtime delivery is superseded by `docs/AI_PIPELINE_EVAL_SPEC.md`, `docs/AI_PIPELINE_EVAL_EXECUTION.md`, and the current 0016/0021 Tickets. Do not replay this prompt as the next Goal; preserve its rejected experiment as evidence.

Use the complete prompt below either to resume the existing remediation Session or to open a new Codex session at `D:\project\agent-audit`.

---

你正在 `D:\project\agent-audit` 修复 AI Pipeline / Eval 架构。如果当前 Session 已有对应 Goal，立即恢复并继续该 Goal；否则创建一个不设 token budget 的 Goal。此前因 `usage: null`、旧 baseline 和 package 顺序得出的 blocked 判断已被新版合同取代：先重读本文、Spec、Execution 与 issues，再按新合同继续。不要推倒已验证的正确工作，也不要只分析、重新规划或再次宣告已有实现完成。

Goal objective：

> 关闭 issues 0015–0021 中重新打开的证据完整性、正式 Skill 生命周期、隐私、性能和 Eval 闭环缺口；用可解析的真实 Host Agent 执行记录、独立盲评、input-distinct held-out、多 trial、确定性重算和最终 HTML accepted-path 证明完成。任何 CLI 自报字段、手工 JSON/分数、重复登记同一输出、Case 改名、命令 exit 0 或 Ticket 勾选都不是完成证据。

## 1. 建立当前事实基线

先完整阅读：

- `AGENTS.md`
- `docs/AI_PIPELINE_EVAL_SPEC.md`
- `docs/AI_PIPELINE_EVAL_EXECUTION.md`
- `docs/AI_PIPELINE_EVAL_TICKETS.md`
- `docs/AI_PIPELINE_EVAL_REMEDIATION.md`
- `issues/0015-*.md` 至 `issues/0021-*.md`
- `docs/MVP.md`、`docs/DESIGN.md`、`CONTEXT.md`
- `prompts/report-synthesis.md`、`prompts/key-session-analysis.md`、`prompts/skill-insights.md`
- 两个 Harness 下安装后的 `SKILL.md`

不要导入此前 Session 的完成判断。当前 working tree、权威文档、可重复测试、Harness-owned execution records 和不可变 artifact 是唯一证据。若继续已有 Session，保留已通过且仍满足新合同的性能、held-out、状态机和红测证据；将仅由本地自述 JSON 支持的 provenance、baseline、review、promotion 及其下游证据重置为 `unverified`。保留所有已有修改，不 reset、不覆盖无关工作。

创建 `0015–0021 acceptance matrix`：每条 criterion 记录 `red test / implementation / verification artifact / status`。状态只能是 `unverified`、`red`、`green`、`blocked`；初始全部按 issue 当前状态处理，不能继承旧复选框。

完成标准：先复现本轮 review 中的所有缺口；失败测试必须在实现前真实失败。

## 2. 按风险顺序修复运行时契约

先完成 0015、0016，再做 Eval：

1. 所有 manifest、warning、artifact、status、trace、UI 与 finalize mutation 都通过 transactional Run Store。增加 compose warning 并发回归；最终 trace 读取失败必须把 delivery 从 `completed` 降为 `incomplete`。
2. 正式 Skill 只执行一次 `evidence --auto`。每个 lane 只有 `ai-start → ai-accept` 或显式 `ai-fallback` 生命周期。Host Agent wall-time 若单独记录，使用不会改变 lane 状态的非-lane phase；禁止 event 把 lane 提前标为 accepted。
3. 用安装后的 Skill 协议逐命令执行一个测试 Run，证明不存在重复 Evidence、提前 accepted、随后 `ai-accept` 被拒绝的路径。
4. 实现并测试统一隐私边界：bounded Evidence 和结构化 raw lane JSON 只能留在本地敏感 Run/Eval workspace，具有明确 retention/cleanup；不得进入默认 JSON/text/share、cache、index、telemetry 或 packaged Skill。不得保存 reasoning、无关 transcript、command/tool output、credentials 或 base64。
5. `docs/DESIGN.md`、Spec、Execution、AGENTS 与两个安装 Skill 的流程必须一致；不得留下 stdin compose 或仅内存 Evidence 的冲突描述。

每项只在对应红测转绿后更新 matrix，不要提前勾 Ticket。

## 3. 实现可证明的 Eval 状态机

CLI 保持 model-free；Host Agent 承担模型执行，确定性 runner 承担状态、artifact、blind mapping、验证和门禁。不要加入 Provider SDK、模型网关、数据库、daemon 或通用 DAG 框架。

实现并强制以下可恢复状态机：

`freeze → generator → contract-grade → blind-quality-grade → optimize → regression → held-out → review → promote`

硬要求：

- runner 暴露 `next legal action`，跳步命令必须失败；重复调用复用已完成阶段，不覆盖 trial、不重复模型执行；
- Generator、Quality Grader、Optimizer 使用独立上下文。允许使用独立 subagent；主代理仅编排和集成；
- promotion-critical trial 必须通过 Harness provenance adapter 绑定实际 Host Agent execution boundary。Codex 至少绑定真实 rollout/session path、thread、turn、response item、terminal Token event、output hash 和声明的 Token metric；本地 generation JSON 只是派生索引，不能自证；
- `--duration-ms`、`--token-count`、`--transcript-ref`、`--reviewer`、外部 grades 和 approval 文本只能是描述字段，不能单独推进门禁；无法观测的数据写 `unavailable`；
- budget observation 为 `within | exceeded | unavailable`，policy 为 `required | advisory`。`exceeded` 才是超预算；required + unavailable 为 `inconclusive`；advisory + unavailable 可继续质量门禁但必须保留限制。不得把 null 报成 `PROMOTION_*_BUDGET_EXCEEDED`；
- baseline/candidate 每个 counted trial 都是独立 Generator 执行。相同输出可自然发生，但重复登记同一生成记录不能计为多个 trial；
- blind map 在 Grader 前生成随机 opaque ID；Grader context 不得包含 role、Prompt hash、目录名或其他可反推身份的信息；
- Quality Grader 为每个 Rubric 维度输出 score + Evidence 或 blocking `unknown`；
- Optimizer 只接收记录中的失败维度、Evidence、参考和当前假设；每轮生成一个可证伪 Prompt revision，最多三轮。保存调用者提供的 proposal 文本不算执行；
- held-out Case 必须与开发用 smoke/regression 在 input hash 和场景内容上独立。只改 ID、split、路径或 expected text 必须被拒绝；
- review 抽查并解析 generation source reference，绑定 review artifact、blind map、grades 和 Evidence hash；
- promote 从原始 artifacts 重算全部门禁，不信任 `eligible` 字段，并拒绝相同输出改善、同输入 held-out、缺维度、不可解析 provenance、篡改 artifact 和空输出冒充能力提升。

为 targeted、candidate、scheduled/full 提供稳定脚本或等价稳定入口。普通 loop 永远不写 `prompts/`；只有 promote 可以写。

## 4. 建立真实 baseline、held-out 和性能证据

先隔离上一轮由同一 `$raw` 循环登记、手工递增耗时/Token 的伪 baseline；它可以保留为漏洞 fixture，但不得作为 accepted baseline。通过独立 baseline bootstrap 建立新基线，不要等待 candidate promotion：bootstrap 只能使用未修改的当前权威 Prompt、Harness-owned provenance、contract results、独立 blind grades、variance 和独立 review；它不要求 candidate improvement，也不能修改 Prompt。原子替换时保留旧 baseline hash、失效原因和 review hashes。

然后完成：

1. 为 Skill Insights 准备至少一个 regression 和一个真正 input-distinct held-out Case；脱敏且不共享同一 fixture/input hash。
2. 使用真实 Host Agent 对 baseline 和 candidate 分别执行独立 trials。promotion-critical Case 每个角色至少三次；保留可解析 generation records。
3. 使用独立上下文完成 blind Quality Grade；不得由实现主代理手填分数。
4. accepted baseline 中每个 counted trial 都有真实 output、contract result、blind grade、模型身份、Harness source locator、观测到或明确 unavailable 的时间/Token，以及方差结果；budget policy 对 unavailable 的处理符合 Spec。
5. 重建 0017 性能 fixture：约 1,000 文件、300,000 records，硬断言 `< 2000 ms`。同一测试比较参考路径和优化路径的 AuditResult 事实、fingerprint、Evidence selection 与 HTML 事实等价。3 个 Session/约 21 records 的 smoke test不能替代该验收。
6. Reader 的 inventory 只包含冻结 Scope 内实际读取或选中的安全文件身份；discovery 的全量 files 不得回流。

真实 candidate 如果三轮后没有显著改善，状态必须是 `inconclusive`。继续保留证据并报告，不制造分数、不复用输出、不放宽阈值、不把相同输入改名为 held-out。

## 5. Promotion 与一次最终验收

只有前四节全部 green 后才允许 promote。合法 promotion 必须同时满足：

- candidate Prompt hash 与 accepted baseline 不同；
- target dimension 有超过阈值的真实改善；
- deterministic、regression、input-distinct held-out、must-not-regress、variance、privacy、time/token budget 全部通过；
- review sampling 能解析 generation records，review/grade/blind-map hashes 完整；
- Skill Insights candidate 输出非空且实际展示目标能力；schema-valid `insights: []` 不能证明能力改进。

先区分两个 packaging 边界：

- Runtime integration：修复 runtime、Skill workflow、provenance adapter 或 validator 后，允许在权威 Prompt 未改变时 package/sync 并验证 installed path；candidate Prompt 必须继续留在 Eval workspace，不得进入 `prompts/` 或安装包。
- Prompt release：合法 promotion 更新权威 Prompt 后，再执行一次最终 `package-skills`、`verify-sync`、installed-bundle preflight 和完整报告。`verify-sync` 必须拒绝 stale dist 和 runtime 额外文件。

完整报告严格按安装 Skill 的唯一流程：

`prepare → evidence --auto once → three lane ai-start/ai-accept or honest fallback → artifact-only compose once → open final HTML → record UI dispatch → finalize`

最终验收必须证明：至少 Skill Insights lane 为 accepted；该非空 accepted 内容可在 HTML 中定位；HTML size/hash 完整；UI 为 completed/queued；trace 完整；delivery/lane/UI 状态分离；单一 bundleVersion 未漂移。fallback 测试单独保留，不能代替 accepted-path 验收。

## 6. 独立复核与退出规则

实现代理不得独自宣布完成。代码与 artifact 就绪后，启动两个独立 review subagent：

- Standards reviewer：只核对 AGENTS、DESIGN、Spec、Skill、隐私、事务与 sync；
- Spec reviewer：只核对 issues 0015–0021、真实执行 provenance、held-out 独立性、性能规模和最终 HTML accepted-path。

两个 reviewer 都拿不到实现代理的“完成总结”，只读取 working tree、测试、matrix 和 artifacts。任一 P0/P1 finding 都必须修复并重新定向复核；reviewer 不能通过修改分数或 Ticket 来消除 finding。

最终验证最多各运行一次：相关完整测试集合、typecheck、package、sync、真实 candidate Eval、完整报告。已经通过且未被后续修改影响的检查不重复。

只有以下全部成立才能把 Goal 标记 `complete`：

- 0015–0021 的每条当前 acceptance criterion 在 matrix 中为 green，并链接直接证据；
- 所有已知自报/重复输出/伪 held-out/空输出晋升场景被稳定拒绝；
- Codex promotion-critical trials 可解析到真实 session/turn/output/Token events；本地索引无法自证；
- budget unavailable 与 exceeded 被准确区分，required/advisory policy 均有测试；
- 旧伪 baseline 已通过独立 bootstrap 失效并被真实基线原子替换；
- Eval 状态机真实执行、可恢复，三个角色上下文独立；
- 1,000 文件/300,000 records 性能测试真实通过 `< 2000 ms` 且事实等价；
- 安装 Skill 流程可执行且与 DESIGN/Spec 一致；
- 一个非 no-op Skill Insights candidate 合法晋升，并以 accepted 内容出现在最终 HTML；
- 两个独立 reviewer 均无 P0/P1 finding；
- 最终回复提供 acceptance matrix、测试命令与结果、generation/review artifact 路径、baseline/candidate/promotion hashes、性能结果、最终 Run/HTML 路径、残余 P2/限制和 Goal token usage。

同一真实阻塞连续三轮仍无法继续时，按 Goal 规则标记 `blocked`，列出三次尝试和唯一所需用户动作。测试失败、candidate rejected、工作量大或接近预算都不是 blocked。

现在恢复或创建 Goal。若 0015/0016、真实规模性能、held-out 或状态机已有仍符合新合同的 green 证据，保留它们；从 Codex provenance adapter 的红测、budget 三态红测和 baseline bootstrap 红测开始。不要从生成新报告开始。

---
