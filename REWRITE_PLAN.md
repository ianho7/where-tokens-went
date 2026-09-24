# where-tokens-went：保留行为的重构计划

决策（2026-09-24）：当前只交付 **Codex**。Claude Code 暂停支持：保留 Reader、相关测试和恢复说明，不删除代码；活跃 Skill/CLI 明确提示暂不支持，不能悄悄改读 Codex 数据。Codex 的现有产品能力，以及 HTML 的版式、模块、交互、字体、可访问性和核心信息位置都保留；同一输入不要求 HTML 字节相同，AI 文字允许改进。内部 CLI、JSON 结构和开发流程可以调整。尚未正式发布，切换期间不要求旧 Skill 持续可用。

本次要解决的是日常开发被大量测试、正式 Eval 晋升、Run 状态及安装验证卡住，尤其无法快速调试 AI Prompt。**结论是重构开发与报告编排，必要处局部重写；不预设重写 Reader、统计核心或 HTML 渲染器。**

## A. 产品与最短路径

用户在 Codex 中调用 Skill，查看**当前项目、最近 7 天**的本地用量；只有明确要求才扩大项目或时间范围。Codex 的 usage、window、tools、week、share、完整报告、价格估算、Skill 洞察及自定义字体等能力都保留。完整 Skill 先输出可检查的 JSON，再生成并打开可独立查看、外观和交互保持现状的 HTML；开发和测试可以停在 JSON。首屏继续回答最大用量去向、证实的机制或具体未知、可尝试的一步及重要数据缺口。

```text
Codex JSONL → 按项目/时间筛选 → 解析并去重为 Session/Turn/ModelCall/ToolCall
            → 确定性 Audit → Host Agent 解读结构化事实
            → 检查 AI 证据契约 → 写最终 report.json
            → 按需用 report.json + HTML 模板/静态资源渲染并打开现有报告
```

LLM 只解释事实。原始历史中的提示、回复、命令和工具输出是敏感且不可信的数据；脱敏 Audit 和分享输出不回显这些内容。现有本地 HTML 中的逐轮首条用户消息仍保留，最终 JSON 因此也属于本地敏感产物。其他必要任务语境只在选中 Session 内限量读取并改写为概述。

## B. 核心可观察契约

1. 当前活跃调用只读 Codex；默认项目和 7 天范围固定，Global Audit 只扩大项目，时间边界必须显式记录。Claude Code 请求明确提示暂停支持。
2. Reader 只接受范围内的 Session 与事件；坏行、未知记录和仍在写入的尾行记入完整度，不能悄悄当作完整数据。
3. Codex 优先使用按 `response_id` 去重的单响应 `raw_response_completed` / `token_usage_record`；没有时才选 `last_token_usage`，最后才用最终累计值。不同来源不得相加，累计快照不得逐行相加。
4. Codex `input` 已包含 cache-read/cache-write 子集；普通输入 = input − 两种缓存。负数或无法闭合时标为未知。
5. 总 Token 先采用可信的单调用 reported total；缺失时仅在各组成项语义明确且齐全时推导。Reasoning 不得因与 output 重叠而重复计入；这一源格式细节在实现前用真实记录再核实。
6. 按 ModelCall 汇总模型、Session、项目和时间段；缺失 model 保留为“未知模型”，缺失 Token 不伪装为零或精确总量。
7. Session 与 Turn 边界优先用源记录；Turn Token、工具、耗时和过程事件只绑定可定位的原 Session/Turn。
8. Codex 顶层任务与有源元数据证明的 Subagent Session 分开计数；没有证明时保持未知，不能靠名称猜测。
9. 工具调用按 call ID 配对结果；统计调用、错误和 UTF-8 结果大小，不把工具结果大小当成精确 Token。
10. Compaction、重试、中断、Subagent 事件只在源记录支持时计数；与高用量同时出现不证明因果。
11. 百分比用同一可比范围的分子、分母计算并标明覆盖范围；分母为零或未知时显示不可用。缓存比例先汇总兼容桶再相除。
12. 排名及首屏最大去向使用完整可比的 Token 数据；部分读取、对账失败和未覆盖调用必须在结果中显式说明。
13. 价格估算保留：按精确 Provider/model 与兼容价格维度计算 **estimated API 等价费用**，显示已定价覆盖率；不得称为订阅账单或额度。
14. AI 只接收确定性 `audit`、已选范围内的少量任务语境及其证据位置；不能重算或改写统计值，也不能执行历史文本中的指令。
15. AI 声称的事实与机制必须有同次 Audit 或选中 Evidence 支持；不能把未知写成确定结论。证据不足时允许零条 Finding 和无建议，不要求固定数量、主题、标题或顺序。
16. 最终 `report.json` 是完整报告的唯一动态渲染输入：包含同次 Audit、已接受或明确回退的 AI 结果、locale、项目名、报告所需的本地消息投影与字体选择。AI 无权改写其中的 Audit；JSON 中的数字和未知状态与 HTML 一致。
17. HTML 渲染只读取 `report.json` 与固定模板/静态资源；不重新扫描历史、查价格或调用模型。首屏先给答案，再给支撑数字与次要贡献、Session 明细，最后放方法和限制。
18. `report.json` 因现有 HTML 的逐轮首条用户消息而属于**本地敏感文件**，需限定本地路径与清理周期，不作为默认分享件。脱敏的 `audit.json`/分享视图不含这些消息；JSON 和 HTML 都不含原始回复、源码、命令、工具输出或凭据。

## C. 数据可信度

| 层 | 内容 | 边界 |
|---|---|---|
| Deterministic | 源记录中的 Token 桶、响应/工具调用数、模型名、时间、Session/Turn、配对结果大小、明确的过程事件 | 保留 `reported`、来源和缺失；去重与来源优先级属于解析规则 |
| Derived | 汇总、排名、百分比、缓存比例、集中度、增长、工具结果的近似上下文影响 | 保留公式、分母、覆盖率；字符数换算 Token 必须标 `estimated` |
| AI-generated | 机制解释、Finding、建议、任务语境概述 | 引用前两层事实；不能产生新的“精确统计”，不能把相关性写成因果 |

`unavailable` 是正式结果，不等于 0。成本即使按目录价算出，也属于 `estimated`。

## 值得保留的资产与待核实点

- **活跃行为：**保留 Codex 的 usage 去重/优先级、缓存组成、工具配对、范围隔离、缺失值及隐私边界。`src/codex-reader.ts`、`src/analysis.ts` 与 `docs/HARNESS_DATA_SOURCES.md` 是对照材料；源码公式也需用原始记录复核，尤其 reasoning/output 是否重叠。
- **冻结资产：**原样保留 `src/claude-reader.ts`、相关定向测试与来源说明，标明冻结版本和重新启用条件。活跃编排不调用它；恢复时重新核实数据源、运行定向测试并接回入口，不承诺冻结期间持续兼容。
- **报告行为参考：**`.scratch/current-prompt-real-host-20260921-rerun-v5/audit.json` 与同目录 `report.html`，以及根目录 `report-real-dogfood-zh-CN.html`。只核对核心事实和阅读语义，不做 HTML 字节快照；这些本地产物不直接当可提交 fixture。
- **测试种子：**`tests/codex-inspect.test.js` 中 Codex 当前 usage、缓存组成、工具配对、缺失值和隐私案例保护业务规则。Claude 去重测试随 Reader 冻结。重构期间先保持这些测试可运行，待新路径具备等价检查后逐项合并；不按旧测试数量或文件布局机械保留。
- **AI Prompt 资产：**保留 `prompts/report-synthesis.md`、`prompts/key-session-analysis.md` 和 `prompts/skill-insights.md` 三种独立能力。修改报告综合、关键 Session、证据、检查或回退前，阅读前两份源 Prompt；修改 Skill 洞察前再读第三份。源 Prompt 仍打包进两份 Harness Skill，Claude 入口保持冻结；日常调试直接读源 Prompt，无需打包。

### 5 个真实案例候选

均由上述本地 Codex `audit.json` 定位。Ticket 01 已从 small、normal、long-context 三个候选提取并冻结脱敏 JSONL；tool-heavy 与 edge-case 仍未提取。表中旧数字只是待复核的对拍基线，不代表旧实现一定正确。Phase 2 可从其他候选提取最小记录，验证数值、隐藏敏感内容，并在提交前检查许可与隐私。

| 形态 | Session ID | 旧 Audit 观察 | 主要用途 |
|---|---|---|---|
| small | `01a0c300-df10-7971-b2d8-774746fb5341` | 1 Turn、0 工具、26,869 Token | 最小闭环与空工具集 |
| normal | `01a0a438-ab31-7a13-a3a0-1d89544d6b20` | 15 Turns、31 工具、1,636,883 Token | 常规聚合与 Turn 排序 |
| tool-heavy | `01a0be94-17b9-79e0-b11a-a75d689d605c` | 4,454 工具、约 1,470 万结果字符 | 工具配对、体量、性能 |
| long-context | `01a0aea4-0fe4-7850-9625-1acfd00f665c` | 22 Turns、199,076,168 Token | 长任务及后期用量集中 |
| edge-case | `01a0b9f1-8bcb-7b63-93b4-a9b4bca211f8` | 27 Turns、8 个压缩标记 | 压缩与过程事件不重算 |

**覆盖缺口：**仓库没有已确认的真实 Claude Code fixture；冻结期间不把 Claude 真实 E2E 当作交付门槛。边界记录另用极小构造样本覆盖 Codex 新旧 usage 混合/重复；Claude 流式重复的定向测试随冻结代码保留。上述五个 ID 是考古候选，其中三个已有脱敏 Codex fixture。

## 旧系统的主要 accidental complexity

旧仓库约有 22 个源码文件（829 KiB）、24 个顶层测试文件（353 KiB）、11 个构建脚本、182 个 `test(...)` 案例；`src/cli.ts` 与 `src/report.ts` 各约 148 KiB。复杂度主要来自：

- `report-run` 的跨进程锁、manifest、trace、artifact、三条 AI lane 和 finalize 状态机围住一次本地报告生成；来源与结论的必要检查可以更直接地完成。
- `eval-*`、accepted baseline、Prompt promotion、grader/optimizer/provenance 形成了另一套产品级工作流；它服务开发验证，不是用户查看用量所需的运行能力。
- 字体子集、ECharts bundle、Kami 样式契约及交互行为属于要保留的现有 HTML 能力；其评分脚本和大量重复视觉回归检查是开发负担候选，不能把两者一起删除。
- `types.ts` 的大型层级、Skill Snapshot/Candidate/Evidence Gate 与多份 Prompt 带来许多同步契约；证据真实性检查仍必要。当前 Report Synthesis 验证甚至拒绝恰好 1 条 Finding，与“发现数量由证据决定”冲突。
- `src/`、`dist/`、打包 Skill、工作区安装副本、版本 preflight/verify-sync 形成多份同步表面；活跃 Codex Skill 需要可交付，Claude 包保留为冻结资产，并重新选择最薄的构建边界。

## Complexity Budget

**Data flows forward. Nothing coordinates backwards.**

```text
Codex JSONL → Reader / Normalize → Audit → 并列 AI 分析 → report.json → HTML
```

每层只消费前一层明确交付的数据。HTML renderer 不调用 analyzer 或查询价格；AI 检查不重读 JSONL；Prompt 调试不启动完整 `report-run`；AI 失败不触发历史重扫；报告编排不控制 Eval promotion。中间逻辑对象和开发 fixture 可以存在，但不得反向协调。`audit.json` 可作为脱敏事实输入或对外视图，不是第二份可编辑的渲染真相。

**AI 很容易生成 abstraction；本项目默认删除、简化、合并、直接实现，最后才考虑抽象。**优先级：`删除 > 简化 > 合并 > 直接实现 > 抽象`。新增 abstraction、validator、pipeline stage、config、framework、generic helper layer、state machine、schema hierarchy、test suite、Prompt 或 intermediate artifact，默认不进入方案；必须指出当前真实需求，并满足相应门槛：

| 新增内容 | 进入门槛 |
|---|---|
| abstraction | 至少两个真实、稳定、已存在的消费者 |
| validator | 新增者须对应真实发生过的问题；已有必要的 AI 事实检查收敛为一个薄入口 |
| pipeline stage / intermediate artifact | 产生独立且必要的用户价值或明确交付物 |
| config | 当前存在真实差异，而非未来可能需要 |
| Prompt | 现有 Prompt 无法承担的独立任务 |
| test suite | 保护真正独立的产品能力 |

其他框架、状态机、通用层和多级 schema 同样需证明当前必要性，不能仅因旧系统已有或便于扩展而保留。

`report.json` 是最终报告**唯一动态渲染输入**，只包含最终用户报告真正需要的数据，结构只分三个逻辑区域：`audit` 存确定性与 derived facts，AI 无权修改；`ai` 存三种独立 AI 结果及各自必要的 fallback；`render` 存 locale、项目名、字体和现有 HTML 必需的本地消息投影。仅加一个简单格式版本号，不发展 schema 层级；除非最终用户报告确有需求，不增加顶层区域。Debug trace、Eval/Prompt 实验结果与历史、评分、promotion/pipeline state、run manifest、optimizer、开发日志、临时诊断和编排元数据均留在报告边界之外；`report.json` 不是开发流程状态容器。`report.json + 固定模板/静态资源 → HTML`；renderer 只做展示格式化，不补算统计或修正数据。

现有 `renderHtml` 定位为 **Legacy Renderer Adapter**。本轮可复用它，以保住当前 HTML 的视觉、交互、图表和字体；禁止再往里面增加 Token 计算、Session 解析、Finding 判断、AI 调用、价格查询、历史扫描、数据修正或业务推断。已有业务计算若妨碍纯消费边界，按实际需要前移到 Audit；不以重写整个 HTML 为本轮前提。

三份 Prompt 是并列能力：`audit → {report synthesis, key session analysis, skill insights} → report.json`。每份可单独运行、调试、失败、fallback 和替换；修改一份不强迫重跑另两份，不串成 Prompt 链或层叠 validator。

## 验证：Test facts, not intelligence

**Test facts, not intelligence.** 自动化测试严格保护 JSONL Reader、scope/时间过滤、来源优先级、`response_id` 去重、累计快照、cache 桶、missing/unavailable、ModelCall/Session/Turn 聚合、工具配对、百分比、覆盖率、价格等确定性或 derived 事实，以及真实发生过的 regression。优先用 table-driven cases 覆盖一整个规则族；测试量由这个轻量 Skill 的真实业务复杂度决定，不追求 coverage 或数量。

**Tests are incident-driven, not imagination-driven.** 不仅 test suite，新增的每个 test case 也要说明它保护的具体规则或 regression：仅限核心确定性计算、解析/来源边界、关键用户可观察 contract 或已真实发生的 regression。已有规则的另一输入变体优先扩展现有 table-driven case，不另建独立 test；避免一个 edge case 或分支一个 test，也不因未来假想风险、覆盖率、AI 顺手建议或“更保险”而增长测试。每个 test 都必须有明确保护对象。

**Checks** 只阻止 AI 明显越界：结果可解析、必要结构存在、Evidence 引用能在当前 Audit/选中材料中解析、精确数字来自 Audit、AI 不修改 `audit`、unknown 不被说成确定事实。目标是一个薄的 `validateAiResult(result, audit)` 式入口；不加多层 validator、grader、score、promotion、baseline、AI judge 或 validator of validator。检查不规定 Finding 数量、标题、主题、顺序、措辞、建议数或旧 snapshot。零条、一条、三条 Finding 都可成立；声称的机制必须有证据。

**Review** 由人判断 Finding 是否有价值、是否发现表格不易看到的问题、建议是否有用、文案是否有 AI 味、Prompt 是否需调整；它不是自动化 gate。**AI validation constrains falsehood, not judgment.**

真实 E2E 初始只用上表五类 Codex fixture，走 `真实输入 → Reader → Audit → 选定 Prompt → report.json`。每例只核对少数关键统计事实、流程完成、隐私/unknown/Evidence 边界，并供必要的人工 Prompt Review 使用；不做“五例 × 大量断言”，不主动扩充几十个 fixture。只有新的真实 regression 才考虑新增。HTML 另做少量 JSON→HTML smoke 与必要的人工视觉/交互核对，不做整页字节 snapshot。

## Fast Loop、Release Loop 与 Prompt Lab

**Fast Loop 是日常默认。**修改 Prompt、Finding、wording、insight 或小范围报告内容时，用固定 Audit 和必要的固定 Evidence，只运行一个选定 Prompt、调用模型一次，输出 `input summary / AI result JSON / evidence references / check result`，人工直接看结果。Prompt Lab 是正式开发入口，但只是薄 Runner：选一个源 Prompt 和固定 fixture，读取必要 Evidence，调用模型一次，输出结果并做极薄的 groundedness check；目标体验是“改 `report-synthesis.md` → 一个简单命令选择 `normal` fixture → 看 JSON”，具体命令名此时不定。它不依赖 Reader、历史扫描、Audit 重算、定价、HTML、打包、安装或完整报告编排。需要看页面时，从已有 `report.json` 单独 render。

Prompt Lab 不是 Prompt 管理平台或新的 Eval Framework。本轮不加入 registry framework、实验数据库、运行历史、Prompt 版本管理、比较看板、批量实验、评分、grader/optimizer、promotion/baseline、复杂 fixture 管理、UI 平台或多阶段编排；将来有真实需求再单独评估。它的价值是缩短反馈路径：`prompt + fixture + one model call → JSON`。

Fast Loop 默认不运行全量测试、完整 `report-run`、完整 E2E、Eval promotion、所有 Prompt、所有 fixture、HTML、安装或打包。修改某项确定性指标时，只跑相关数据测试并检查 JSON。**Agent 不得仅因“更保险”把日常修改升级为 Release Loop。**

**Release Loop** 只在重大功能完成、准备 merge/发布或明确要求完整验收时运行：相关确定性测试 → 少量真实 Codex E2E → 薄 AI 检查与 `report.json` 核对 → JSON→HTML smoke → 必要的人工视觉/交互检查 → 一次完整 Codex Skill smoke。正式 Eval 晋升状态机、accepted baseline、grader/optimizer/provenance、重复 Run 验证和评分脚本拟退役；保留范围冻结、敏感数据隔离、独立 fallback 与最终 HTML 能力。删除旧机制前检查消费者，并同步修订 `AGENTS.md`、Eval 文档及 Skill 指引中的过时强制门槛。

## 实施顺序与成功标准

1. 冻结上表少量真实 Codex 输入、Audit 与 HTML 参考，复核旧输出的关键事实；登记 Claude Reader、测试、Skill 的冻结边界和恢复步骤。
2. 建立 `report.json` 的最小三区域边界，将当前分散的 Audit、AI、render 数据写入其中；同输入对拍统计和隐私，不改变现有 HTML 外观。
3. 建立独立 Prompt Lab 与三份 Prompt 的单独执行/回退路径；只用固定事实和 Evidence 调试选定 AI 结果。再让 Legacy Renderer Adapter 从 `report.json` 独立生成原有 HTML。
4. 简化完整报告编排并移除旧开发验证机制；按 Release Loop 定向验收 Codex 各现有视图、价格、Skill 洞察、字体、最终 JSON/HTML，人工看 2–3 份报告，最后做一次安装后的完整 Skill smoke。每个独立切片核对后提交；Claude 恢复另行验收。

主要成功指标是：改一个 Prompt 后，能否用固定 fixture 和一次模型调用直接看到 JSON；改一个统计指标时，能否只改数据层并跑少量相关测试。Codex 的现有能力、统计正确性和 HTML 用户体验继续保留；test count、coverage、模块数、schema 完整度、Eval 分数和 validator 数量都不是目标。
