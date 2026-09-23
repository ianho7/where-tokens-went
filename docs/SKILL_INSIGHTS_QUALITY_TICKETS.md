# Skill Insights 质量恢复 Tickets

执行合同：[Skill Insights 质量恢复 Spec](SKILL_INSIGHTS_QUALITY_RECOVERY.md)。四项按顺序执行；0025 仅在用户确认 0024 的候选确有改善时启动。以下状态是计划，不是完成声明。

## 0022 — 固定质量目标与差距（0.5–1 AI 小时）

**Status:** completed · **Depends on:** none

复用 `.scratch/skill-insights-human-reference-answer.json`、`evals/cases/skill-insights-real-aha-v2.json` 和当前真实报告，列出三条理想洞察各自的事实、解释、决策价值，以及 `supported / missing-input / not-justified`。对照当前原文；明确第三条的任务总 Token 与现有匹配调用 Token 不是同一口径。用户能读懂差距即验收；不生成新报告或新 Rubric。前两条若已足够好，可 `KEEP_CURRENT`，停止无意义的 Prompt 改写。

## 0023 — 补齐最小事实路径（2–4 AI 小时）

**Status:** completed · **Depends on:** 0022

先追溯 `src/analysis.ts` 的 `attributedTokens`、任务/Session Token 和源记录边界，确定第三条真正需要的指标。沿既有 `deriveSkillMetrics → selectSkillCandidates → SkillSnapshot → validator` 路径，只投影可定位、可去重、有范围与重叠说明的事实；为有证据的低频/高规模 Skill 保留一个有界候选机会，不挤掉高价值 Capability 候选。匹配调用 Token 与包含 Skill 的整个任务 Token 分开命名；跨 Skill 重叠不可相加，也不可称为因果。修正只靠词面拦截有证据结论的 validator，同时继续拒绝缺证据或因果夸大的输出。

**验收/停止：** 一项最小定向检查覆盖“有证据可通过，缺证据/因果断言被拒绝”，现有 Capability 不回退；按 `AGENTS.md` 做一次限于改动范围的独立 Standards/Spec 复核。若源记录不足，产出明确 `unavailable` 并停止，不造新模型或估算来凑第三条。

**0023 发现与边界（2026-09-21）：** `attributedTokens` 仍严格表示与 Skill 的源证 call/turn 边界匹配的去重 ModelCall Token；新增的 `associatedSessionTokens` 才表示包含该 Skill 的每个唯一、选定范围 Session 的完整 ModelCall Token 总量之和。它要求 Session 非 partial、ModelCall Token 完整；Codex 还要求该 Session 的响应 Usage 与 Turn 累计对账通过。Reader 没有独立于 Session 的任务总 Token源，因此不能把该指标改称“Skill 导致的任务 Token”，也不能把跨 Skill 的重叠 Session 相加；不满足条件时保持 `unavailable`。

实现沿 `analysis → deriveSkillMetrics → selectSkillCandidates → SkillSnapshot → validator` 增加这两个明确命名的信号；最多用一个 `rare_strong_delta` 槽位给低调用量且有完整关联 Session Token 的 Skill，位于现有 Capability/高频/异常候选之后，不扩大五个候选上限。Validator 只有在 Snapshot 验证的 `associatedSessionTokens` 证据存在时才放行频率—规模关系，仍拒绝因果断言；无证据的未知边界和现有 Capability 洞察均通过定向检查。

## 0024 — 同输入、最多两轮 Prompt 调优（1–2 AI 小时）

**Status:** completed · **Depends on:** 0022 + 0023（或 0023 明确的 unavailable 结论）

冻结一个已核口径的 Snapshot，使用现有 lane-only 入口生成当前与候选的真实文本；一次只改一个假设，最多两次候选修改。并排交付原文、证据与差距，按 `IMPROVED / KEEP_CURRENT / INCONCLUSIVE` 请用户判断是否有更有用、非重复、且可执行的洞察。参考答案不是字符串匹配目标，诊断输出不是晋升证据。

**验收/停止：** 用户未确认改善时，权威 Prompt 不变，不进入 0025；两轮仍无改善就 `STOP`。不扫描历史、定价、安装、打包、生成 HTML，也不新增 Grader/Optimizer/Case 矩阵。

**2026-09-22 执行结果（blocked）：** v2 候选已整理为完整 Prompt，validator 的 family 调用量聚合误判已按最小正反边界修正，相关定向测试 12/12 通过。使用原始冻结 Snapshot `fixture-skill-snapshot-real-aha-v1` 仅生成一次新的候选原始输出；第一条 Capability 通过，第二条因中文措辞“名称和聚合调用仍不能证明成员能力相同”触发 family-semantic 内容证据门禁，确定性校验 `blocked`。原始输出保留在 `.scratch/skill-insights-v2-real-candidate-20260922.raw.json`，不再重生成、不手改、不把本轮诊断当晋升证据。0024 未完成，权威 Prompt 不变。

**2026-09-22 后续执行结果（completed）：** 用户授权一次局部 v2 兼容修正；validator 增加了对“聚合不建立共同能力”否定措辞的最小覆盖，构建与定向测试保持 12/12 通过。第二次且仅此一次重新生成使用同一冻结 Snapshot，输出两条目标洞察、canonical evidenceRefs，无第三张未知卡片，确定性校验 `passed`。原始输出保留在 `.scratch/skill-insights-v2-real-candidate-rerun-20260922.raw.json`；该结果仍是候选兼容证据，不是正式 promotion evidence。

## 0025 — v2 一次性产品发布与可见验收（限次执行；阻塞时停止）

**Status:** blocked（边界纠偏通过；Codex Host generation 未完成，缺少可解析 paired output） · **Depends on:** 0024 = 用户接受 v2 方向

本 Ticket 唯一候选为 `evals/candidates/skill-insights-0024-family-cross-metric-v2.md`（SHA-256 `b33bdaa9dca56ba3623f35b28bf3273336bb2e0e39cd19afacac0c359679255b`）；当前生产 Prompt SHA-256 为 `f8753cd72097d6cc31c553bc2f51eb3c4c31c28955246a7f2f0b049663a1df75`。输入绑定为主 Case `skill-insights-real-aha-v2`（SHA-256 `39f933190d27e2337cb29f64547d1808b4ffb4a37e5db4c9ca5f6712f8181841`）及 held-out Case `skill-insights-heldout-aha-v1`（SHA-256 `eca7a05d87c45a780c9dce8a56759ab5c643d7466b02ededed070697338c04b5`）。文档旧引用 `skill-insights-heldout-v2` 使用不同 fixture（SHA-256 `22c4547550cac08ca400033d15e87888f93688fe5ae6744d24d3397465d08c23`），不属于本次已有四份 raw 的配对输入，现予更正。

按 [一次性 v2 产品发布路径](AI_PIPELINE_EVAL_EXECUTION.md#one-time-skill-insights-v2-product-release) 执行，严格分两段：

1. **零模型调用门禁纠偏：** 对 `.scratch/0025-v2-release/raw/real-current.raw.json`、`attempt-4-real-v2.raw.json`、`attempt-4-heldout-current.raw.json`、`attempt-4-heldout-v2.raw.json` 按上述输入重放现行代码。直接读取每张保留/丢弃卡、错误和 `valid / insights / errors`；不得以早先 Session 结论代替重放。把无效卡排除在报告外，单卡错误在另有有效卡时保留为诊断，空结果或 Snapshot/Envelope 身份错误阻断输出。运行时与 lane Eval 使用同一校验结果；候选是否达标仍由独立质量审阅决定。
2. **执行来源核验与一次对照：** 仅复用能从 Harness-owned Codex rollout 解析出确切输出内容及执行/Token 事件、并与 Case 输入、Prompt 和模型比较身份绑定的 raw。现有 `.generation.json` sidecar 与 SHA-256 只证明本地字节匹配，不证明模型执行；`trial.json` 中 `generationRecord: null` 也不能被改写为有来源。无法直接解析的组合视为缺失，只在门禁纠偏、定向测试和独立 Standards/Spec 复核通过后，为当前 Prompt 与 v2 在上述两个 Case 的每个缺失组合各生成一次。
3. **独立质量判断：** 用不知 Prompt 身份的独立上下文比较两组 raw、过滤后的卡、丢弃卡诊断与同一份输入 Snapshot。主 Case 必须同时保留有证据的本地 Harness 协议/通用脚手架 Capability Aha 和 Top-4/命名家族调用拓扑 Aha，不添加第三张无证据卡。Held-out 的证据、决策价值和校准不确定性不得有实质回退。逐卡核对原文与 Evidence；“负责这些调用”“驱动这些调用”等直接因果即使未命中窄代码门禁也属于硬拒。若正文声称多个 Skill 的 Token 总量/求和，必须逐一核对 `subject`、指标 Evidence 与正文成员一致，缺失或不一致即硬拒。检查数值、Token 口径、Evidence、隐私范围和明确无依据因果；有效卡存在不自动通过。此审阅代替扩张同义词正则，不可省略。
4. **只在质量审阅通过后发布：** 将该候选写入 `prompts/skill-insights.md`，执行一次 `package-skills`、`verify-sync`、默认安装预检；按 installed Skill 完整 Report Run 路径生成一次最终 HTML 并实际打开。随后由独立审阅者逐张检查 HTML 中实际显示的 Skill Insights 卡，对照已接受的 lane 输出、冻结 Snapshot 和 Evidence；记录每张显示卡的 ID 与结论，确认合成/渲染没有添入额外卡或实质改变主张，并核对主张、指标、不确定性、Evidence、隐私和身份边界。此项最终页面逐卡审阅不能由前面的 raw 输出审阅代替。Run Evidence 必须保留到逐卡审阅完成；先记录逐卡结论，再清理 Run 目录。只有两条主 Case 目标洞察、bundle 身份、非空 accepted lane、UI dispatch、cleanup 和逐卡审阅都通过才可完成。若任一发布门禁失败，恢复生产 Prompt 与分发包，记录未完成，不重生成候选。

**验收/停止：** 只有可核实的两组 paired Host 执行 + 独立接受对照 + 安装后打开的最终 HTML 可见两条非空洞察 + 可观察 UI dispatch 与清理，才算交付。缺少可解析执行来源、Candidate 未达到目标、held-out 回退或安全边界失败时，保持生产 Prompt 不变并停止。旧 baseline 保持原样；不做 baseline bootstrap、迁移、正式 Eval promotion、多轮 optimizer 或全项目验证。

**2026-09-23 直接重放结果：** 四份冻结 raw 分别绑定主 Case input hash `39f933190d27e2337cb29f64547d1808b4ffb4a37e5db4c9ca5f6712f8181841` 与 held-out Case input hash `eca7a05d87c45a780c9dce8a56759ab5c643d7466b02ededed070697338c04b5`。修订门禁后，main/current 保留 3 张（Capability、family topology、频率/任务规模未知边界），main/v2 保留 2 张目标卡；held-out/current 和 held-out/v2 各保留 2 张，四份均为 `valid=true` 且 `errors=[]`。三个已记录的误判——“family label explains where calls cluster”、“does not identify the cause of repetition”与“shared routing or entry topology”——均消失。raw 与本地 sidecar 哈希匹配，但配对 Trial 缺少可解析的 Host `generationRecord`/rollout 定位；这次重放只证明现行合同结果，不证明执行来源或候选质量，生产 Prompt 尚未替换。

**2026-09-23 独立 Standards/Spec 复核：** 已按当前 Spec 将责任型/驱动型直接因果及正文跨 Skill Token 总量与 `subject`/Evidence 不一致列为独立逐卡审阅硬拒；不通过扩展词面清单来替代原文核对。复核结论为本 Ticket 范围内无未解决 P1。最终 `ai-accept` 成功或本地 `host-response.json` 字段不得单独证明 Host 来源；发布审阅需将最终 lane 输出与实际 Codex 持久化执行记录解析并绑定。

**2026-09-23 Host generation stop：** 在取得 paired output 前启动了一次 Codex CLI generation invocation。CLI 报告模型别名 `gpt-6-luna` 未知（使用 fallback model metadata），随后回报 `401 Unauthorized: Missing bearer or basic authentication` 并进入连接重试。没有生成 TEMP raw 文件；检查当天 Codex 持久化记录后只发现此次命令的工具输出，没有匹配的 assistant response item 或 Token usage record。进程已停止且不重试。随后只读诊断确认：当前 CLI 为 `0.155.0-alpha.16`，`codex login status` 为 `Not logged in`；用户级 Codex 配置将请求路由到 `cc-switch` 自定义 provider，且 `requires_openai_auth=true`。本次进程无有效 Codex 登录态；因此 401 的可核实根因是所选 provider 所需的 OpenAI/Codex 认证不可用。本机 CLI 的 bundled model catalog 包含 `gpt-6-astra` 与 `gpt-5.4`，不包含 `gpt-6-luna`；官方模型目录列有 `gpt-6-luna`，但认证失败且 CLI 未登记该 ID，尚不能验证 `cc-switch` 入口是否支持它。未恢复认证及确认该入口支持的模型名之前不再调用生成、不调用其余三个组合、不进入盲审、生产 Prompt 替换、打包/安装或 HTML 生成，Ticket 0025 保持 blocked。生产 Prompt 保持 SHA-256 `f8753cd72097d6cc31c553bc2f51eb3c4c31c28955246a7f2f0b049663a1df75`。

**2026-09-23 登录恢复检查：** 用户批准后启动 `codex login`，浏览器到达本机回调；随后 CLI 请求 `https://auth.openai.com/oauth/token` 时报告发送请求失败，且只读 `codex login status` 仍为 `Not logged in`。这能确认回调到达 CLI、令牌交换失败；底层网络、代理或 TLS 原因未区分。没有重试登录，也没有保留或复用一次性回调 code。登录前 `auth.json` 存在，但这不证明其中凭据可用；登录尝试后该文件大小由 4,016 bytes 变为 4,001 bytes，修改时间由 `2026-09-20T05:47:32Z` 变为 `2026-09-23T12:18:00Z`。未读取文件内容，因此具体变化未知；当前登录状态仍为未登录。当前 Codex Desktop rollout 存在且包含 Desktop response/usage 记录，但其中没有 0025 的四个独立生成输出。CLI 不是 Ticket 的硬要求；只有能从实际 Host 持久化中解析精确输出，并绑定输入、Prompt、模型和 usage 记录的执行方式才可替代。未建立该替代执行路径前维持 blocked。

前段旧 baseline 身份不匹配仍是正式 Eval promotion 的真实历史，不是本次一次性产品发布的前置条件。旧 baseline 核查的 6 份历史输出仅 5 份通过当时 validator，旧评分口径也不足以证明目标 Aha；不迁移、不转写为本次比较的当前输出。此前各次阻塞记录保留为历史，不作为此次 release 的完成证据。
