# where-tokens-went 报告架构重构 Spec

日期：2026-10-02。状态：Accepted（批次 A～E / Ticket 0033～0041 代码实现、真实生成、多文件取证修复、人工体验确认及独立评审已全部通过并收口）。

来源：[整体调整提案](REPORT_ARCHITECTURE_REWORK_PROPOSAL.md)第 1.6 节及[生命周期复查](SKILL_LIFECYCLE_REVIEW.md)。本 Spec 定义目标行为；提案保存理由与取舍，Ticket 安排实施与证据。不因生成本文件而改变现行运行时或旧 Ticket 的验收条件。

## 1. 范围、结果与规范关系

用户仍从 Codex 调用 `$where-tokens-went`，零配置使用当前宿主 AI。三条 Lane 保持独立；代码负责事实、流程、绑定、接受和交付，宿主负责原生 Worker 派发、打开 HTML 和有依据的对话总结。Claude 支持继续暂停，源 Prompt 仍同步到两份分发包。

目标是让独立 Skill 能启动，正文取证正确，当前 ticket 与语义输出绑定可靠，合法内容可见，隐私不因部分引用绕过，中断能接着正确步骤运行，实际交付与清理结果可信。保留现有 Token 口径、排名、价格、缓存语义、视觉与交互。

不引入模型 API、凭据、工作流框架、数据库、常驻服务、跨 Harness 扫描或新的用户命令。不改变订阅账单、配额或因果反事实的未知状态。行为支持度与记账可靠性分离暂缓，当前未核对任务最高 moderate 保留。

### 1.1 显式修订点

以下修订只有本 Spec 经批准且对应实现交付后才生效；其余规则继续有效。

| 现行规则来源 | 本次修订 | 保持的约束 |
| --- | --- | --- |
| `docs/REPORT_RUN_ORCHESTRATION_SPEC.md` 的不改变输出 Schema | 允许第 5 节的版本化语义输出；目录、Prompt 和消费者一并切换 | 三条 Lane、冻结 Scope、一次修复、宿主能力边界 |
| 编排 Spec 和 Skill 的仓库 npm 预检 | 独立包先核验正在调用的包；仓库同步另属开发检查 | 预检失败不创建 Run，不读历史，不查价 |
| `AGENTS.md` 的安装预检与唯一恢复措辞 | 明确当前包预检与开发仓库同步的区别，独立包没有仓库时不调用目标项目 npm 脚本 | 所有真实/fixture Run 之前预检，失败仅一次有明确来源的恢复，版本不偷换 |
| `issues/0031-close-report-run-acceptance-gaps.md` 的数字与整条原文匹配规则 | 新 Ticket 明确调整统计数字绑定和已知原文部分匹配 | 不重写 0031 的批准验收；原始 hash、只读 Validator、隐私后验检查 |
| `docs/specs/key-session-analysis.md` 的模型身份和 evidenceRead 回显 | 新输出由代码绑定；模型选择当前目录里的任务与证据 | 任务专属机制、替代解释、建议依赖与记账政策 |
| `docs/specs/skill-insights.md` 与源 Prompt 的 snapshot、指标和摘录回显 | 新输出选择句柄，代码恢复规范值与允许的摘录 | Usage × Content、双侧内容证据、能力差异、禁止频次冒充因果 |
| 当前重复接受、组合复核与清理口径 | 接受时完成领域判定；组合核验完整性；实际交付和删除分别记录 | Run 锁、合法局部交付、明确 fallback、原文不外传 |

实施时同步 `docs/MVP.md`、`docs/DESIGN.md`、编排和领域规范的对应现行段落；已归档 Eval 正文和旧 Ticket 不改写。所有相关 Ticket 修改前完整读取 `prompts/report-synthesis.md`、`prompts/key-session-analysis.md`；涉及 Skill Insights 同时完整读取 `prompts/skill-insights.md`。

## 2. 独立安装、预检与空历史

### 2.1 包自检

正式运行以调用脚本所在 Skill 目录为包根，不向 cwd 或祖先查找开发仓库来决定哪个包是权威。增加内部只读入口 `report-run preflight`，供 Skill 在 start 前调用；start 仍在创建 Run 前自行核验。它不是新的用户产品命令。

复用已有 `bundle-version.json` 和 `scripts/bundle-version.js` 的包摘要算法，不增加第二份完整性清单。扩展摘要覆盖实际分发文件，包括 launcher、runtime、依赖、Prompt、Skill、样式和字体；版本元文件自身不参与摘要，插件版本等被摘要内容先同步再计算。运行时从实际调用包重算摘要，与 bundleVersion 中的摘要比较；输出契约版本加入现有版本元文件。缺文件、读取失败、版本字段不一致或摘要不一致使预检失败。枚举不得跟随越出包根的链接。此摘要证明包内容一致，不证明可信发行者、模型执行或用户历史真实性。

`package.json` 仍是 productVersion 唯一来源；打包时写入的版本贯穿整个 Run。运行时从包内读取版本，不要求目标项目拥有 package.json 或 npm 开发脚本。开发用 `npm run verify-installed-skill` 与 `verify-sync` 继续比较仓库分发和两份安装，不成为独立 Codex 包运行前提。

开发安装有本仓库时保留一次 `npm run install-local` 恢复后重验。独立安装没有开发仓库时不运行目标项目的同名 npm 脚本、不下载未知包；若本地已有明确分发来源则通过现有安装器重新安装一次并重验，没有来源或仍失败就报告需重新安装且不创建 Run。正常完整包无需用户补凭据、仓库路径或配置。

预检成功只允许之后创建 Run；中途 bundle 或契约改变，当前 Run 失败并停止。不得静默更新 manifest、重扫历史或借新版本继续旧 ticket。

### 2.2 没有可用历史

canonical Audit 没有可分析 Session 时，start 记录 `NO_HISTORY_IN_SCOPE`，三条 Lane 标为 unavailable，attempt 为 0，不生成输入或派发 Worker，不向要求至少一个 Session 的接口传空选择。它返回 `action: advance` 和 Run 身份，advance 渲染明确无数据的最终 HTML。

HTML 说明本次范围没有可用记录，不显示伪造机制、建议或零费用。真正记录的零与不可用值继续区分。随后沿相同打开、回执和清理路径交付。零 Session 但有 malformed/skipped 记录时说明缺失原因，不称为确认没有活动。

## 3. Run 生命周期、恢复与交付

### 3.1 所有者与返回动作

start 和 advance 按保存状态返回确定的下一动作；Host 执行动作，不读 manifest 自选业务命令。沿用已存在的命令，新增的是返回值和内部预检，不新增低层正常流程。

| 保存状态 | start / 不带 UI 的 advance 的目标行为 | 禁止行为 |
| --- | --- | --- |
| 未创建 | start 预检、准备、取证、签发初始 tickets；无数据走 2.2 | 提前建 Run、提前读历史或查价 |
| started，准备未封存 | 若准备调用仍活跃，返回 in-progress；拥有者已结束而必需准备产物不全，记 `PREPARATION_INTERRUPTED` 并失败，需新 Run | 对半成品猜测事实，重复扫描并冒充原 Run 已冻结 |
| prepared | 核验已有 Audit/Snapshot，补尚未取得的 Evidence，再创建未签发 Lane；不重新 prepare | 跳过 Evidence，先启动一部分后因缺依赖崩溃 |
| evidence-ready / awaiting-ai | 仅返回尚未派发的初始任务；已派发任务返回 wait-workers；接受 Worker 客观失败观察 | 重派已派发或终态 Worker，增加 replacement Worker |
| composing | 活跃拥有者返回 in-progress；确认拥有者已退出，核验已有产物并从未完成组合边界恢复 | 并发抢跑、按超时猜进程死亡、重复覆写最终产物 |
| awaiting-ui-dispatch | 返回同一个登记交付物的 open-html 动作 | 返回无路径的 ready:false，重新生成分析 |
| incomplete，UI 未完成 | 重新返回同一 open-html；新的 UI 回执只重试交付 | 重新 compose、改变路径、清理恢复材料 |
| incomplete，交付完成但清理未完成 | advance 只重试剩余清理，返回清理结果 | 再次打开或 compose、重复删除已确认删除的材料 |
| completed | 返回完成状态与最终路径，重复 UI 回执为已处理结果 | 再派发、消耗 attempt、重写 HTML |
| failed | 返回固定失败原因和已有安全最终物信息；当前 Run 不再生成 | 把失败当作可续跑成功 |

准备与组合拥有者在短锁内登记进程 PID、阶段 spanId 和开始时点，结束时登记终态。恢复只在操作系统明确确认拥有者不存在时接管；进程仍存在或状态不可观察时返回 in-progress/owner-unavailable，不以固定时间自动抢占。PID 不存在是当前单机恢复判断，不是模型执行证明。

组合中已登记产物先校验 hash，再复用；落盘但未登记的文件只在 canonical 输入与确定性重建结果一致时登记，否则保持失败并保留定位原因。长耗时计算、字体处理和文件写入保持在锁外，领取推进权与状态提交保持在锁内。

### 3.2 Worker 派发与一次修复

Host 报告实际派发出的 Worker 标识和对应 ticket；不可观察标识保持 unavailable。初次派发全部 eligible Workers 后才等待；无原生并发槽位时使用同一投影和 tickets 顺序执行，并记录 executionMode 和原因。

已派发但 Host 上下文中断，能找到原 Worker 时等待或继续该 Worker；找不到时报告 bound unavailable，由代码结束该 Lane。不得新建替代 Worker。当前 Worker 的首份正式非空输出被拒绝后，可在同一 Worker 会话使用唯一一次 retryTicket；第二次失败显式 fallback。空 stdin、只读 help 和传输用法错误不消耗 attempt。

接受 terminal Lane 不重新派发。多个调用读取同一个 open-html 动作不等于生成多份 HTML；动作身份由 code 生成并固定，Host 按实际执行情况回传状态。

### 3.3 实际交付物

manifest 的 delivery 记录包含绝对目标路径、bytes、sha256、bundleVersion、固定 actionId 和 UI 状态。默认目标为 Run 内 report.html；用户指定外部路径时该路径就是核验目标，不能用内部副本代替。

第一次 HTML 生成后冻结 delivery；随后重复 advance 返回同一路径和内容摘要。当前 Run 不允许再改 `--html` 目标；不同目标需求使用新的明确交付请求，不静默覆盖既有记录。报告头部 projectName 继续为本地外部字段，按远端仓库名、项目名、目录名、project 的顺序解析，不从 `<current-project>` 推导。

UI completed/queued 仅证明 Host 报告的打开派发状态，不证明用户实际阅读。处理回执前核验实际 delivery 文件存在、bytes/hash 与登记一致，且版本未漂移；核验失败记录 incomplete，不封存成功也不清理。failed/unavailable 保留材料，重复 advance 只重新返回现有动作。

accepted Lane 产物缺失或损坏属于完整性失败，不等于模型主动无结论。组合登记明确原因和对应不可交付内容，保留其他安全事实；可形成安全 fallback 时允许继续打开，但交付结果携带内容降级原因，原 accepted 审计记录不重写成 generation-unavailable。

### 3.4 清理与完成条件

只有版本、实际 HTML、Lane 终态及 completed/queued UI 回执满足交付条件后，才进入自动清理。内容 fallback 本身不阻止安全交付，但必须有原因。性能诊断 span 缺失不单独否定真实交付。

deliveryStatus 和 cleanupStatus 分开：前者可为 completed，后者为 pending、partial、failed 或 completed。清理未完成时 Run 为 incomplete，保留可定位清理失败；所有批准保留/删除条件满足后才为 completed。返回 cleanedUp 依据实际结果，不能无条件 true。

仅删除 Run 内敏感产物和 Lane 工作区。外部最终 HTML 保留；canonical Audit、manifest、trace 保留，默认仅一份最终 HTML。每项确认删除或原已不存在后移除引用，失败时保留引用、相对路径和错误码，不保存原文到 diagnostics。递归目录删除失败也不能清空 laneArtifacts；重试先核验仍存在的剩余项。

清理成功才写 cleanedAt。封存失败、UI 未成功和未知删除结果不得写 cleanedAt。重复成功回执或 advance 不重新写内容；清理重试只处理剩余敏感项，最终 trace 反映真实清理结果。

## 4. 正确取证、选择与目录

### 4.1 Codex 正文归属

Content Evidence Reader 继承 Session 的当前 Turn：显式 turn_id 优先，缺失时继承前置 turn_context/task_started 的有效归属；显式 call_id 可绑定主 Reader 已知的同 Scope 调用。没有可靠归属就不将正文收入某个已选 Turn，记录 `CONTENT_TURN_UNAVAILABLE`。

仅保留同 Harness、项目和 `[since, until)` 的已选 Turn/Call 内容。只选择一轮不能吸收该 Session 的其他未标号正文。未知时间或项目归属按现有 Scope 检查处理，不因补轮次而扩大范围。类型先检查 payload 实际形态，function_call_output 为 tool，message 按 role 分类。

选中 Turn 没有正文、内容截断、来源缺失和预算遗漏要进入 packets 警告与可用性说明，不能返回空 items 且毫无解释。原始内容保持本地敏感、不可信，不能指挥 Worker 调工具。

### 4.2 有界选取规则

继续 Top 3 Token-ranked Session。每 Session 最多 8 个 Turn、24 个正文项，每项最多 1200 个 JavaScript UTF-16 code units；这些是取证预算，不是报告卡片配额。

选择顺序固定：保留最早一轮任务语境和最后一轮结果；其余按 Audit 中 available、非负的 Turn totalTokens 降序挑选主要贡献轮次，每个贡献轮次优先连同其紧邻前一轮入选，去重直至 8 个。相同值按原 Turn ordinal，缺 ordinal 按原 Audit 顺序。某贡献 Turn 已在上下文集合仍算覆盖；先确保贡献轮次，再在剩余名额放其前一轮。

没有可用 Turn Token 值时，保留首尾并按已有 tool resultBytes 降序选对应 Turn/前一轮；两类值都不可用时按原顺序补足并记录 `TURN_SELECTION_USAGE_UNAVAILABLE`。估计工具大小不改称 Token 用量，不修改排名或计数算法。

正文项预算分配先每个已选 Turn 的第一条 user 消息，再每 Turn 的第一条 tool/assistant 结果，再按所选 Turn 时间顺序轮流补项直至 24，不能让首轮占满所有位置。任务语境缺失、未读 Turn 数、截断项与实际选择规则由代码记录。Worker 不自行扩大 Scope 或重读未提供历史。

### 4.3 Run 内证据目录

目录保存在现有投影中并计入 projectionHash。采用独立命名空间：s1 等为所选 Session，k1/f1 为 Skill/Family，e1 等为可解析规范 Evidence/指标，c1 等为内容位置。每个 Lane 的句柄只对该 Lane 当前输入有效，不成为全局 ID。

e 条目包含规范引用、适用对象、EvidenceValue、单位和允许展示的值；从 canonical Audit/Snapshot 恢复，不重算。历史正文 c 条目只作为本地分析依据，displayPolicy 为 private；它不得通过数字槽位或引用回填显示原文。Skill 内容 c 条目按冻结快照顺序切为最多 200 code units、相邻重叠 40 的片段，记录源 hash 和起止位置，可按现有本地限定摘录规则展示。分片覆盖既有预算内的全部所选 Skill 内容，不先挑“像约束”的句子。

未知句柄、与当前对象不相容的引用、归一化歧义或不允许展示的内容按明确错误拒绝对应独立项，不作编辑距离猜测。跨 Lane/Run 提交由 ticket 和投影绑定检查负责，短句柄本身不证明来源；不同目录可能都有 e1。一次成功解析仅证明当前目录引用位置存在，不证明整段含义成立。

## 5. 模型语义输出与代码绑定

### 5.1 输出版本与共同规则

Run、ticket 和 accepted envelope 由代码记录 `outputContractVersion: 2`；模型不回显该版本。v2 原始结果不含 runId、auditFingerprint、snapshotId、bundleVersion、attempt/span、projectionHash、evidenceRead 或 canonical metric 值。出现这些代码字段时拒绝该项，不能当无关额外字段忽略。

v2 在 0038 完整切换时生效；此前 0033 至 0037 的独立修复仍使用当前 v1，包内清单记录其真实合同版本。实施前置修复不能提前宣告 v2，也不能让同一个冻结 Run 从 v1 变成 v2。

顶层形状：synthesis 为 `{overview, findings, noStrongFindingReason}`；Key Session 为条目数组；Skill 为 `{contentProfiles, insights, rejectionReasons}`。JSON key 顺序无关，无关额外字段忽略且不进入 accepted 展示值；必填缺失、类型错误、非法 JSON 仍拒绝。raw 文件及 hash 保留原输入字节；不自动剥围栏、补字段或修 JSON。

所有统计指标的精确数字通过 prose 中的 `[[eN]]` 槽位选择 e 目录中的可展示 metric。代码绑定单位、来源和 locale 格式，转换为现有 renderer 所需字符串；原始语义文本和映射诊断保留在敏感 Lane 工作区。不存在、不可用或 private 值不能成为数字槽位，错误只影响依赖该字段的项。

自然语境中的版本、模型名、错误码和轮次不因数字被全盘拒绝。模型仍不能编造叙事数值、把数量当因果、将定性措辞当自动正确。代码不建立通用自然语言数字判真系统；明确的 Token/货币/百分比/倍率统计断言必须走槽位，剩余语义由 Prompt 和薄事实审阅负责。

### 5.2 各 Lane 的变化与保留字段

| Lane | v2 生成字段变化 | 保留的语义要求 |
| --- | --- | --- |
| Report Synthesis | 删除 fingerprint；overview/findings 的 evidenceRefs 改为 e 句柄；正文支持统计槽位 | overview 1 至 2 句、1 至 3 个支持引用；0 至 5 条 Finding，零条有原因；不生成建议或任务成果判断 |
| Key Session | sessionId 改为 sessionHandle；删除 fingerprint/evidenceRead；finding.evidenceIds 与 recommendation.targetEvidenceIds 改为 e 句柄 | taskContext、primaryFinding、recommendation、limitations 的其余字段保留；仅 Top 3 同 Session 已选 Turn；建议依赖合法机制 |
| Skill Insights | 删除 snapshotId；subject 与 contentProfiles 的 Skill/Family 标识改为目录句柄；metric 证据使用 e 句柄，内容引用使用 c 句柄；reveal 指向同条卡片所选引用；evidenceExcerpt 改为 contentRef | kind/scope/reveal/claimStrength、认知差与决策差、能力与因果质量边界保留；原本可选增强仍可选，不强制填卡片 |

Key Session 原始条目使用 `sessionHandle`，finding.evidenceIds、recommendation.targetEvidenceIds 和 synthesis.evidenceRefs 仍为字符串数组，数组元素是当前 e 句柄；转换后才成为 canonical ID。其余未声明修改的语义字段沿现行源 Prompt。

Skill subject 使用 `skillHandle`、`skillHandles`、`familyHandle` 代替对应 ID 字段，contentProfiles 使用 `skillHandle`。每个 metric evidence 项为 `{ref: "e1"}`，由目录恢复 kind、metric 和适用对象；每个 content evidence 项为 `{contentRef: "c1", role, loadingScope}`，其中语义角色和加载判断仍由模型提供。Profile 内原先每个 evidenceExcerpt 也改为 contentRef，不要求复述摘录或手算偏移。reveal.evidenceRefs 为该 insight.evidence 已使用的 e/c 句柄数组；不存在于同一条卡片证据中的引用拒绝该 reveal。这些对象表示文档合同，不是已修改的 TypeScript 实现。

代码解析成功后恢复 canonical subject、引用和获准摘录，写入带规范身份的 accepted envelope；规范分析类型和 renderer 继续消费解析后的 canonical 值。代码绑定 evidenceRead 表示实际向 Worker 提供的数据，不声明模型确实逐字阅读。

目录、三个源 Prompt、类型、接受器与消费者在同一 Ticket 作为完整 v2 路径切换；不能先落无人消费的目录或无法被 renderer 使用的输出。生成代码字段从 Prompt 删除，绑定校验从接受器保留。

### 5.3 旧版本与信任边界

现有版本记为 v1。v1 诊断/兼容入口明确指定旧合同，仍拒绝错误 fingerprint/snapshotId，不从 JSON 外观猜版本。普通新 Run 只用 v2；旧 Run 在其原 bundle 上完成，不跨 bundle 续跑，不迁移旧模型输出。

新接受器先核验当前 runDir、Lane、attempt/span、版本、输入 hash 和输出绑定，再解析语义。回填正确身份不能修复错误 ticket。可观察宿主执行来源保持绑定，不可观察值为 unavailable，代码包装不冒充执行证明。

若旧输出只有相同短句柄，且被调用者重新包装为当前 ticket，代码不能仅凭正文识别它来自旧 Run。旧票据或不匹配的已登记来源必须拒绝；来源不可观察时如实记录，不承诺识别所有正文重放，不为此恢复模型身份回显或另造执行证明系统。v1 兼容只适配现有明确诊断入口，不新增正常流程的双协议协商。

## 6. 统一接受、隐私与局部交付

### 6.1 单一领域处理路径

正常、修复和兼容提交通过同一领域路径：解析合同版本 → 核验调用上下文 → 解析目录及恢复规范事实 → 独立 Sanitizer → 只读 Validator → 独立项与依赖判定 → accepted 与 diagnostics。

Validator 不篡改原始内容，不猜身份或引用，不用降低 support 修复无依据因果。重复处理同一输入不重复追加限制、删除更多引用或继续降低支持度。CLI 负责输入输出和接入，组合读取 accepted 并核验绑定与完整性，不再执行另一套语义淘汰规则。

### 6.2 已知原文部分匹配

对分析用历史 user/assistant/tool 内容，先删除证据截断尾部省略号、将 CRLF 和连续 Unicode 空白折叠为单空格，再比较正文的连续共同片段。至少 40 code units 的连续匹配为已知原文重复；不用整个 1200 字片段全部相等作为唯一条件，不添加 kind 豁免。

Sanitizer 在原字段对应位置替换该片段为 `[已移除直接引用的历史内容]`，记录 code、字段路径和次数，不记录被删原文；匹配在跨换行时仍有效，不跨两个不同字段拼出假匹配。使用最长匹配先替换，重叠片段一次处理。Validator 在处理后的字段再次应用同一规则和既有凭据规则。

这种规则只检测已知原文直接重复，不证明识别了所有敏感语义。少于 40 字符仍受既有凭据、原文禁令和 Prompt 约束，不将阈值当作允许引用的长度。

如果必需观察/解释只剩占位符和标点，视为 unavailable；不生成替代因果。推荐失效可以保留独立合法机制；机制失效则去掉依赖推荐，留下有依据任务说明与具体未知。本地允许的首条用户消息和已核验的 Skill 摘录例外继续由各自投影控制，不扩展到 share/默认 JSON。

### 6.3 独立项和整批规则

Overview 与每条 Finding 独立接受，Key Session 与 Skill 卡片分别隔离。同一 Session 重复条目仅保留第一个合法项，其余记 `DUPLICATE_SESSION_ENTRY`。不同 Session 的完整规范化分析正文完全重复时，接受阶段保留首个合法项，其他项记 `DUPLICATE_ANALYSIS_PROSE`；不在组合阶段把整组全删，也不新增语义相似度阈值。

开放的跨任务可移植性仍由 Prompt 与质量审阅检查；相同机制但各自独立上下文和证据不自动视为重复。整批缺陷需要唯一修复时，返回具体错误给当前 Worker；已有合法项与 accepted 合同不因诊断非空而被全盘拒绝。达到 Lane 最低合法交付条件时 accepted，空或全部无效时走已有一次修复/最终 fallback。

Synthesis 有合法 Overview 或至少一条合法 Finding 即可局部接受；Overview 无效时保留合法 Finding，并使用现有确定性概览 fallback，记录原因。没有合法 Finding 时，合法 Overview 须附具体无结论原因；两者全无则修复或 fallback。Key Session 为至少一个合法任务条目，null Finding 可交付但须具体限制；Skill 为合法零卡片响应及原因或合法卡片集合，不能用空数组伪装已完成 Capability 分析。无 eligible 数据时由代码标记 unavailable，不要求模型填零卡片。

诊断区分 native-no-conclusion、partial-acceptance、all-items-rejected、generation-unavailable、artifact-integrity-failed、ui-dispatch-failed、cleanup-failed。partial acceptance 的所有删除原因进入记录，不能在 valid=true 时丢 errors。哈希失败不得被 catch 转成 null 而丢真实原因。

### 6.4 认知差与质量规则

mentalModelShift 描述表层数据印象与更深结构，不能虚构用户私人信念；decisionDelta 描述有依据的行动变化。继续保留能力与通用脚手架的双侧内容支持、family 至少两成员内容支持、无 Trigger Trace 不升级机制、关联不冒充因果。

代码负责结构和确定性支持边界；开放语义质量由源 Prompt、薄事实检查和人工审阅负责。D/E 的实现记录现行每个相关字段及规则的实际消费者，只有已有误判证据才调整明确规则。没有依据时保留，不增加关键词黑名单、质量评分或新的全局 Grader。

## 7. 减负、计时与完整用户结果

Key Session 投影保留一个权威 sessions/turns/accounting 位置，删除重复集合；每 Lane 只拿必要数据，省略字段明确记录。目录不是把完整 Audit 再复制一次。Skill 内容沿现有预算，不通过删掉关键内容换取无依据的“性能提升”。

生成字段建立消费者表：可见内容、代码绑定、质量判定、无消费者。只删除无消费者且不保护现行质量的字段；不强制复制静态数字、exact 摘录或数据包元信息。当前可选的 counterfactual/familyDifferences 保持可选。

manifest 记录 canonical/projection/raw/accepted bytes、修复次数、executionMode、确定性阶段、Lane Outer Span、交付墙钟与清理状态。模型时间或 Token 只有可解析执行记录才标 observed，否则 unavailable。不同保存状态不能重新声明执行模式；未知派发保持 unknown。

同冻结输入比较前后投影与语义输出体积，不以单次模型速度宣称稳定性能改善。不设置 50 秒、95% 完整度或卡片 90% 存活门槛。用户首屏仍识别最大去向、受支持机制或具体未知、行动状态和重大限制，内部 ID 和处理术语不进入正文。

真实报告交付后，Host 在对话给出与已接受报告一致的主要发现、机制、可试行动或具体未知；不能只返回路径、另做一次无证据诊断或再调用模型 API。

## 8. 验收设计与实施依赖

每个 AC 的主证明观察最近责任边界，复用仍匹配的已有证据。实现修改后要证明当前目标行为，不以本轮故障复现冒充修复成功；HTML/宿主证明仅覆盖独立的渲染、派发和交付风险。

| AC | 可判定的目标结果 | 主证明与可信失败 | Ticket |
| --- | --- | --- | --- |
| AC-01 | 独立包无需开发仓库可运行，篡改/缺文件在建 Run 前失败，无数据不调 Worker | 包预检与 start；排除仓库依赖、空选择报错、假机制 | 0033 |
| AC-02 | prepared 补取证，终态不重派，等待 UI 可取回同一动作；组合中断不重复领取 | start/advance owner 状态表；排除漏准备、重复任务、无路径与活跃拥有者抢占 | 0034 |
| AC-03 | 实际外部 HTML 修改导致回执不能封存成功 | delivery owner 实际路径/hash；内部副本未改不能充当通过 | 0034 |
| AC-04 | 未完成不清理；删除失败留引用、无 cleanedAt，重试只删剩余且状态真实 | cleanup owner 文件结果/manifest，含 EPERM；排除假删除与丢恢复材料 | 0035 |
| AC-05 | 原生未标号正文归属正确，单轮不串读、多轮不漏读，工具正确分类；非首尾峰值及必要上下文入选 | Content Evidence 公开入口与选择输出；排除十轮样例错误、只取首尾和首轮占预算 | 0036 |
| AC-06 | 已知原文的 80/450 字部分引用及换行变化被处理，凭据仍拒绝，合法独立内容保留 | 领域 Sanitizer/Validator；排除只匹配整段和占位空壳 | 0037 |
| AC-07 | v2 不回显身份仍正确绑定；错误 ticket/旧身份拒绝；句柄和统计值恢复规范来源 | Lane 接受实际产物与 raw hash；排除位置猜身份、跨目录、数字重算及解析忽略身份 | 0038 |
| AC-08 | 接受与组合可见内容一致；重复和混合合法项有局部结果及完整原因；损坏不变成主动无结论 | 接受领域、组合读取边界及一次绑定到 HTML 的风险证明；排除全组消失、valid=true 丢诊断、catch 吞错 | 0039 |
| AC-09 | 投影无重复集合，必需语义/内容支持未删；质量字段有实际用途，性能来源准确 | 投影/字段消费者表、固定输入薄事实审阅和可观察记录；排除仅靠 bytes/卡片数判好 | 0040 |
| AC-10 | 实际安装 Skill 经宿主派发，至少一条 eligible Lane 接受真实合法 v2 AI 输出，其余合法或明确 fallback；最终 HTML 打开、回执和清理后完成；规范一致 | 一次稳定集成点真实宿主路径与前述有效回归证据；全部 fallback 不证明正常 v2 可用，手工 fixture/UI 模拟不能替代 | 0041 |

新增证明先通过 test-audit authoring gate：独立预期、可信回归、现有缺口、正确所有者、无需测试专用生产 seam。扩展现有 owner 检查，不把相同场景在 JSON、HTML 和浏览器重复执行。Reviewer 复用已有证据，只有缺失、损坏或不匹配才重跑。

测试方案的具体缺口与独立预期见第 8.3 节；不是每项 AC 都新增一个测试。各 Ticket 的独立评审属于完成要求，不另写“已评审”字段或源码形状测试。只有最终实际输入、Prompt 和消费者仍匹配时，才能复用早期 AI 输出；0040 改动影响该输出时用最终 Prompt 做一次相关薄事实审阅。

只做 Prompt 文案且不改合同的后续变化使用 prompt-lab Fast Loop。本次运行时、隐私、接受、组合和分发变化使用相关 Release Loop；不恢复 Eval promotion、baseline、grader、optimizer、多 trial 或每 Ticket 完整报告仪式。共享合同和隐私 Ticket 完成需独立评审；范围外发现不自动升级为阻塞。

### 8.1 Ticket 索引

| Ticket | 草稿文件 | 依赖 | 批次与覆盖 |
| --- | --- | --- | --- |
| 0033 | [独立包预检与无数据启动](../issues/0033-self-contained-preflight-and-empty-scope.md) | 批准本 Spec | A，F01/F02 |
| 0034 | [按状态恢复与实际交付绑定](../issues/0034-resume-and-bind-delivery-artifact.md) | 0033 | A，F05/F09 |
| 0035 | [真实完成与可靠清理](../issues/0035-finalization-and-truthful-cleanup.md) | 0034 | A，F10/F11 |
| 0036 | [正文归属与主要贡献选取](../issues/0036-codex-evidence-attribution-and-selection.md) | 批准本 Spec；真实 Run 受 0033 预检约束 | B，F03/F04 |
| 0037 | [已知原文部分引用隐私处理](../issues/0037-partial-history-privacy-boundary.md) | 批准本 Spec | D 的独立隐私切片，F06 |
| 0038 | [目录、语义输出与身份绑定 v2](../issues/0038-semantic-output-and-evidence-binding-v2.md) | 0036 | B/C 完整契约切换，代码与 LLM 边界 |
| 0039 | [统一接受、组合和降级原因](../issues/0039-unified-acceptance-and-integrity-outcomes.md) | 0037、0038 | D，F07/F08、诊断与局部交付 |
| 0040 | [字段减负与质量计时边界](../issues/0040-projection-and-output-burden.md) | 0039 | E，认知差/反套话、重复输入、性能证据 |
| 0041 | [真实宿主集成验收与规范收口](../issues/0041-installed-skill-rework-acceptance.md) | 0035 已验收、0040 已实现并封存最终输入/Prompt | E，联合取证后全部已批准结果验收 |

```text
批准 Spec
  +→ 0033 → 0034 → 0035 ------------------+
  +→ 0036 → 0038 → 0039 → 0040 -----------+→ 0041
  +→ 0037 --------→ 0039
```

0036/0037 可以独立修复并使用当前 v1 输出；0038 将目录和三个消费者一起切换为 v2，跨批次原子交付避免半成品协议。0039/0040 停止不影响已完成路径。批准顺序不是强制同时修改多个同一文件的 Ticket；默认逐责任边界实施，合并前检查当前代码和证据是否仍匹配。

依赖图表示实现准备顺序。0040 的最终语义质量证明可复用 0041 的同一次真实生成：0040 实现并封存后允许 0041 开始取证，两者收到各自有效证据和独立审阅后才完成。不要求 0040 先拥有只能在 0041 取得的证据，也不因这次复用取消任何验收条件。

### 8.2 来源覆盖与取舍

提案 1.6.1 的 Q1/Q3 对应 0038/0039，Q2 对应 0039，Q4/脱敏对应 0037/0039，认知差和字段容错对应 0038/0040，数量/局部交付对应 0039。1.6.2 的五个候选对应 0038 与 0040。1.6.3 的编排/恢复对应 0033 至 0035，精简/原生并发/计时对应 0040/0041，可信度四项对应 0037 至 0039，最终对话对应 0041。F01 至 F11 全部在索引中有归属。

不采用：独立模型 API、合并 Lane、严格一次工具调用、编辑距离猜 Evidence、一个有效引用放行全文、脱敏后免检、降级标签保证全部内容有效、固定速度与存活率门槛。暂缓：拆分行为支持度与记账可靠性。保留：未知不归零、原生无结论、当前适用质量字段、局部接受、版本锁、源 Prompt 打包。不能在实施时把不采用项当作未完成需求。

### 8.3 草稿复查与证明缺口

本次复查从“能否区分用户结果与可信失败”倒推，不以来源问题有编号或表格字段齐全证明方案有效。复查只审设计和现有责任边界，没有执行新实现验收。结果是保留 9 个责任切片，减少重复机制并修正以下证明：

Stepback 检查点：目标是零配置下产出安全、可信且真正交付的使用解释；成功由实际责任边界的行为和最终宿主结果判定。先前已建立来源覆盖和 Ticket 依赖，但这些不能证明实现可用；待检验假设是“更详细的新机制和更多检查会增加可信度”。本轮改为对照现有实现和证明，删除重复摘要机制，保留已有局部接受契约，并用能击穿首尾补丁及全 fallback 的对照修正验收。

| Ticket / 主证明 | 独立预期与可信失败 | 现有证据为何不足 / 最小补充 |
| --- | --- | --- |
| 0033：包 preflight / start | 普通项目只凭完整包启动；缺文件或改 launcher 在创建 Run 前失败；无历史不派发 | `tests/bundle-version.test.js` 依赖仓库及两份安装，现有摘要未覆盖 launcher；`tests/codex-inspect.test.js` 的 copied Skill 证明 inspect，不能证明 full start。扩展真实包入口，不复制摘要 helper 算期望；损坏对照由事先冻结的包摘要判断。无 Run 用文件结果证明；历史/查价的前置顺序由独立 Reviewer 追踪正常入口的控制流，确认成功预检之前没有调用，不增加调用计数 hook 或源码字符串断言。 |
| 0034/0035：状态与文件 | 重新调用不重派；外部 HTML 被改就不能封存；删除失败保留文件和引用 | `tests/report-run-advance.test.js` 已覆盖正常回执、并发短锁和脱敏；缺 prepared/awaiting-ui 恢复、外部实际目标及 EPERM 失败结果。补责任边界表，不重演全部正常报告；故障注入只模拟 FS 拒绝，不生成成功回执或删除结果。 |
| 0036：正文与 selector | 显式/继承归属只读已选轮；12 轮中第 10 轮为 905，其余 15，首轮和第 12 轮为 15，应覆盖第 10/9 轮且预算不超限 | `tests/codex-inspect.test.js` 现有 Content Evidence 样例不足以证明继承与预算。原 F04 十轮末轮峰值只能击穿 first-8，不能排除首尾补丁；保留为诊断来源，以非首尾峰值作为选取主证明。固定预期不能由 selector 生成。 |
| 0037：Sanitizer / Validator | 已知原文部分复制及空白变体不可见，独立合法字段仍在，重复处理不再变 | `tests/report-run-advance.test.js` 覆盖整段脱敏及 raw 保留，缺 F06 部分复制。扩展现有领域输入；只有 renderer 可能重新填回原文时补一份 HTML 绑定证明，不再同层重复整段场景。 |
| 0038：当前 ticket 接受与 canonical 输出 | 省略模型身份仍绑定当前事实；错误票据拒绝；当前目录引用与数值准确 | `tests/lane-input-projections.test.js`、`tests/lane-validation-table.test.js` 和 Lane 提交覆盖 v1，缺 v2 适配。扩展现有表；canonical 值用固定输入手工预期核对，不用 resolver 生成期望。不要求短句柄识别伪装成当前票据的旧正文。 |
| 0039：accepted 与 compose | 无效 Overview 不抹合法 Finding；重复保首项；accepted 损坏有真实原因 | `tests/lane-validation-table.test.js` 已覆盖合法单 Finding + 无效 Overview，必须保留这份证据，不新增重复测试；缺整批重复在接受与组合的一致性及 accepted 损坏诊断，补这两项。HTML 只证明 accepted 内容没有在转换时丢失。 |
| 0040/0041：减负与真实宿主 | 最终 Prompt 保留证据支持与行动价值，实际宿主能接受 v2 并打开对应 HTML | 投影/计时检查复用 `lane-input-projections`、`ai-lane-timing-decoupling` 的仍有效部分；新增字段有真实消费才记录。最终真实路径至少一条有 eligible 数据的 Lane 取得真实 AI 的合法 v2 输出；全部 fallback 只证明 fallback 交付，不证明新输出可用。一次可复用的最终 JSON 薄事实审阅与一次实际打开分别保护语义及交付，不另设重复多模型仪式。 |

以上不授权新增测试专用导出、重置函数、框架或生产注入开关。实现前核对完整受影响测试及 fixture；无法确认旧覆盖缺口或独立预期时，先补清证明设计，不能按测试数量交差。0038 的统计槽位是规范值绑定机制，不是开放语义判真器；0041 必须单独记录真实生成、fallback、UI 派发和清理，不能互相替代。

## 9. 执行与回退

本文件与 0033 至 0041 均为草稿。批准 Spec 与对应 Ticket 条件后再实施；不为已明确的零配置、宿主路径或旧 Run 拒绝重复询问。新发现不改变冻结条件，除非用户批准扩展范围。

源码只改 `src/`、`prompts/` 及必要源脚本/文档，生成 Skill runtime 不直接编辑。分发检查点使用 `npm run package-skills` 和 `npm run verify-sync`；依赖当前 dist 的定向检查消费该次构建，不重复 build。完整测试或实际安装只在负责的风险边界需要时执行。当前任务只写文档，不执行这些实施命令。

每 Ticket 可恢复其源和 Prompt 并重新打包，无历史数据迁移；回退后不能继续 bundle 已漂移的 Run，已有 HTML 保留。正在运行的旧 bundle Run 应先结束；无法结束时显式未完成，新包从新 Run 开始，不能偷换版本字段。

Ticket 按现有 `issues/` 布局保存，目前该目录被仓库忽略。草稿是本地文件，不声称已经纳入 Git；本 Spec 的索引保留全部路径。若后续要提交 Ticket，单独明确本地交接或跟踪策略，不擅自修改全仓库忽略规则。
