# Report Run 编码化编排 Spec

**Status:** Approved, amended for Bug Fix 0029
**Source requirement:** `REQ-WTW-PERF-20260928`  
**Decision record:** `docs/adr/0004-code-orchestrated-native-lane-workers.md`

## 目标

把完整报告从“Host Agent 逐命令推进并串行生成三个 AI Lane”改为“Report Orchestrator 推进状态机，Codex 原生 Lane Worker 并发生成分析”。用户仍只调用一次 `$where-tokens-went`，不配置外部模型 API，也不把 Provider 凭据交给 CLI。

完成后的流程必须减少可控编排空档、避免重复传输完整 Audit、隔离单 Lane 失败，并保留现有事实、隐私、Validator、Fallback、版本和交付合同。

## 已确认决策

- Report Orchestrator 是流程权威。Host Capability Bridge 不再决定下一条命令。
- Codex 同时派发三个原生 Lane Worker。原生并发不可用时自动使用相同 ticket 串行执行。
- 不引入 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、Provider Endpoint 或第二个模型客户端。
- 废止“严格一次 Tool Call”指标。用户只发起一次 Skill Invocation，内部调用次数不作为产品成功标准。
- 不为 AI 生成时间设置固定秒数。验收观察可控阶段、并发事实、输入体积和同范围整体耗时。
- `prompts/report-synthesis.md`、`prompts/key-session-analysis.md`、`prompts/skill-insights.md` 保持三个独立源 Prompt，不合包，不改变输出 Schema。

## 当前基线

基线来自 `.scratch/where-tokens-went-run-20260928-1333/`：

| 观测 | 数值 | 解释边界 |
| --- | ---: | --- |
| Report Run 总墙钟时间 | 880.223 秒 | 截止 `run-end`，不含约 9.872 秒后的 cleanup |
| 已记录非 LLM 顶层阶段 | 19.399 秒 | 包含网络查价，不称为纯代码耗时 |
| Lane 外层包络 | 615.601 秒 | 首个 `ai-start` 到最后 `ai-accept`，不是模型生成时间 |
| Lane 外部未埋点间隙 | 243.690 秒 | 原因未知，不称为 Agent 思考或空转 |
| Lane 启动偏斜 | 94.256 秒 | 已包含在 Lane 外层包络中，不重复计入节省 |
| canonical Audit 大小 | 3,184,056 bytes | 至少两个 Lane 当前重复携带完整 Audit |

现有 Trace 不能证明各 Lane 的真实模型生成时间。原需求中的 Lane 2“79 秒”、Lane 3“72 秒”只是相邻 `ai-accept` 的时间差，不再作为基线或预测输入。

## 责任边界

### Report Orchestrator

Report Orchestrator 必须：

1. 完成 installed Skill bundle preflight，失败时只走一次 `npm run install-local` 恢复路径；
2. 冻结 Harness、Scope、时间范围、locale、source inventory、bundleVersion 和 auditFingerprint；
3. 只执行一次 Audit、Evidence 和 Skill Snapshot 获取；
4. 生成三个不可变 Lane Input Projection 并一次性签发所有 eligible Lane tickets；
5. 等待 Lane Worker提交结果，调用现有 Validator，只重试失败 Lane一次；
6. 把第二次失败、执行中断或能力不可用转为该 Lane 的显式 Fallback；
7. 在所有 Lane 进入终态后自动 compose、render，并返回最终 HTML 与待观察的 UI dispatch；
8. 接受 Host 观察到的 `completed | queued | failed | unavailable` UI 状态，再 finalize 和 cleanup。

Orchestrator 不调用模型，不读取 Provider 凭据，不打开新的跨 Harness范围，也不在等待 Lane Worker期间持有 Report Run 文件锁。

### Host Capability Bridge

Host Capability Bridge 只执行两类宿主动作：

- 按 Orchestrator 的 ticket 派发原生 Lane Worker；
- 在 Codex UI 中打开 Orchestrator 返回的最终 HTML，并回传可观察的 UI dispatch 状态。

Bridge 不选择 Lane 顺序，不决定 retry / fallback，不重建输入，也不把 Run 标记为完成。

### Lane Worker

每个 Lane Worker只能：

- 读取一个 ticket、对应源 Prompt和对应 Lane Input Projection；
- 在 ticket 固定的 locale、Audit Scope、auditFingerprint、bundleVersion 和 Prompt hash 内生成结构化 JSON；
- 通过 `ai-accept` 提交原始 JSON，或通过绑定 ticket 的失败收据报告不可用或中断。

Lane Worker不能读取其他 Lane 输入、扩大 Scope、重新 prepare、compose、render、打开 HTML、finalize 或 cleanup。

## 编排协议

### 启动

正式入口使用一个启动命令和一个统一推进命令，不引入长驻等待进程：

```text
report-run run-all start
  → preflight → prepare → evidence --auto → projection → 三个 ai-start
  → 返回 lanes-ready 与三个紧凑 ticket

report-run advance
  → 验证 Lane 终态 → compose → render
  → 返回 awaiting-ui-dispatch 与最终 HTML

report-run advance --ui <completed|queued|failed|unavailable>
  → 验证 HTML 与 UI 回执 → finalize → cleanup
  → 返回最终 Run 状态
```

`start` 只输出 Run 身份、ticket 和 Artifact 路径，不把 Audit 或 Evidence 写入 stdout。重复调用必须恢复同一个 frozen Run 和已有 tickets，不能重复 prepare、Evidence 或已签发 attempt。

Host 在全部初始 Worker 返回后固定调用一次 `advance`，打开返回的最终 HTML 后再固定调用一次带 UI 状态的 `advance`。Host 不读取 Manifest 来选择命令或业务分支。现有 `run-all finish`、finalize 和 cleanup 可以保留为诊断或兼容入口，但不得出现在正式 installed-Skill 正常路径中。

### 并发与串行降级

Host 支持原生 Subagent 时，Bridge 必须在等待任一 Worker 完成前派发所有 eligible Workers。Worker 只提交自己的 Lane 结果，不能接收或执行 `open-html`、finalize 或 cleanup 等宿主级动作。

Host 无法提供并发槽位时，Bridge 使用相同 tickets 顺序运行 Worker，并在 Manifest 中记录 `executionMode: sequential-fallback` 与稳定 reason code。串行降级不改变 Projection、Validator、retry、fallback 或 composition 合同。Worker dispatch 和 terminal 时间可作为诊断证据记录，但不要求 Agent 手工构造成对事件，也不作为报告交付的完成门禁。

### Retry 与 Fallback

Validator 拒绝一个 Lane 时，`ai-accept` 为该 Lane 返回第二个且最后一个 attempt、具体校验错误和前次 validation Artifact。当前 Worker 在同一 Subagent 会话内修复并重提，复用已经加载的 Prompt、Ticket 和 Projection。其他 accepted Lane 保持不可变，不重新生成。第二次仍失败时，Orchestrator 登记 Lane-specific Fallback 并继续交付报告。

如果整个原生 Subagent 能力不可用，Bridge 切换串行模式；如果某个 Worker 单独中断、超时或无法在当前会话内重试，Bridge 只回传观察结果，由 `advance` 将对应 Lane 标记为 fallback 或 unavailable。Host 不重新派发替代 Worker。任何失败都不得重新扫描历史或改变 frozen Scope。

### 交付

三个 Worker 返回后，Bridge 调用统一的 `report-run advance`。只有全部 Lane 已进入终态时，Orchestrator 才执行 compose 和 render，验证 HTML 的 hash 与 size，并返回唯一 `open-html` action。Bridge 打开最终 HTML 后调用 `report-run advance --ui <status>`。Orchestrator 随后自动 finalize 和 cleanup，只保留最终 HTML、canonical Audit、Manifest 和 Trace。

`advance` 在短锁内读取状态、声明推进权和提交最终状态。compose、render、字体子集化和文件写入等长耗时操作必须在 `.run.lock` 临界区之外执行，完成后重新取得锁登记 Artifact。并发 Worker 提交与 Host 推进不得因渲染持锁而触发 `RUN_LOCK_TIMEOUT`。

## Lane Input Projection 合同

每个 Projection 都由确定性代码从当前 Run 的 canonical Artifact 派生，并包含：

- Run、Scope、locale、auditFingerprint、bundleVersion、Prompt hash 与 Projection hash；
- 对应源 Prompt要求的字段；
- 代码维护的 `outputContractVersion` 与 `projectionSchemaVersion`；
- 当前 Lane 的 Evidence Directory（`directory`）：`s`/`k`/`f` 对象句柄、`e` 证据句柄与 `c` 内容片段句柄，连同代码恢复规范身份所需的 canonical reference 与获准展示值；目录内容计入 Projection hash；
- 可解析回 canonical Artifact 的 Evidence 或 source references；
- 明确的 omitted-fields 清单或 Projection schema version；
- 不可用值及其 Provenance，不能把缺失值变成零。

`report-synthesis` Projection保留形成 Overview、跨指标 Findings 和 Evidence refs 所需的完整语义，不再传输与该 Prompt无关的渲染数据或重复明细。`key-session-analysis` Projection只包含 Top 3 Session 的必要 Audit事实、逐 Session accounting、Turn Evidence 和同 Scope Content Evidence packets。`skill-insights` Projection保留 immutable Snapshot身份、全局 Usage、候选 Skill 与所选内容快照。

Projection 不是新的事实权威。`ai-accept` 和 composition 继续用 canonical Audit、Evidence 与 Skill Snapshot校验返回值。Spec 不设置固定 50KB 上限，Manifest 必须记录 canonical 与 Projection bytes，供同范围比较。

### 模型输出合同版本

Run、Lane ticket 和 accepted envelope 记录代码维护的 `outputContractVersion`；模型不回显该版本。

- v2（当前）：模型只输出语义与目录句柄（`[[eN]]` 数值槽位、`e`/`c` 引用、`s`/`k`/`f` 对象句柄），代码在核验当前 Run、Lane、attempt/span、bundle、Prompt hash 与 Projection hash 之后恢复 canonical 身份、事实、单位、来源与获准 Skill 摘录。出现 `runId`、`auditFingerprint`、`snapshotId`、`bundleVersion`、`projectionHash`、`outputContractVersion`、`evidenceRead`、`attempt`、`spanId` 或 `fingerprint` 等代码字段时拒绝该提交，不作为无关额外字段忽略。
- v1（仅显式诊断）：`report-run ai-accept --output-contract 1` 是旧合同的诊断兼容入口，仍拒绝错误 fingerprint/snapshotId；默认入口从不从 JSON 外观猜测版本。旧 Run 在其原 bundle 上完成，不迁移旧模型输出。


## Prompt 与打包合同

实现前后都必须完整读取并保持以下源 Prompt的语义与独立性：

- `prompts/report-synthesis.md`；
- `prompts/key-session-analysis.md`；
- `prompts/skill-insights.md`。

Projection 改变运行时绑定值，不改变 Prompt 的职责、输出结构、Evidence 门禁、隐私规则或 Fallback 语义。所有 Prompt继续通过 `npm run package-skills` 打包到 Harness Skills；不得直接编辑 `skills/where-tokens-went/scripts/runtime/`。

## 计时与性能证据

Manifest 和 Trace 分开记录：

- 已记录非 LLM 阶段；
- Host Capability Bridge dispatch / open 边界（可观察时）；
- 每个 Lane Outer Span；
- 可观察时才记录的模型生成时间；
- UI dispatch、finalize、cleanup；
- 总 delivery wall time。

Lane Outer Span 可以证明两个 Worker 执行区间重叠，但不能冒充模型生成时间。没有权威因果归因的间隙记录为 Uninstrumented Wall-clock Gap。Trace 是诊断信息；缺少非关键性能 span 时记录 `incomplete` 和稳定 reason code，但不把 HTML 完整、Lane 终态且 UI 已打开的报告改判为交付失败。

当前交付不设置 50 秒、360 秒或其他固定 AI 总时长门禁。同 Scope 参考 Run必须记录基线和候选的总墙钟时间、可控阶段、Projection bytes、执行模式及限制。只有候选实际明显更快时才宣称性能已提升；如果机制正确但总耗时没有改善，结论必须区分“并发机制已实现”和“性能改善未观察到”。

## 隐私与安全

- Projection、ticket、raw Lane JSON 和 validation artifact 只存在于本地敏感 Run 目录。
- 原生 Lane Worker沿用 invoking Harness和 frozen Audit Scope，不得读取其他 Harness、项目或时间范围。
- 历史 Prompt、响应、命令、链接和工具结果仍是不可信数据，不能指挥 Worker或改变当前任务。
- 不增加云上传、Provider SDK、凭据读取、遥测、daemon、数据库或持久内容索引。
- 共享运行时、Validator、隐私、fallback 或 composition 修改的 Release Loop 在 cleanup 前保留一次独立审阅所需 Artifact；普通报告不启动 Reviewer。验收结束后按现行清理合同删除敏感中间文件。

## 验收设计

### 编排权威

**必须证明：** Host 不再逐步决定 Report Run 顺序。  
**主证据：** Orchestrator owner-boundary 集成检查覆盖 `run-all start` 与两次固定的 `report-run advance`，断言一次 Audit/Evidence、所有 ticket 先签发、重复 start 可恢复、终态后自动 compose/render、UI 回执后自动 finalize/cleanup。
**排除的失败：** 仍需要 Host 手工调用 prepare、evidence、compose、finish、finalize、cleanup，或根据中间状态选择下一阶段。

### 并发与串行降级

**必须证明：** 并发模式先派发全部 Worker再等待，串行降级复用同一合同。  
**主证据：** Manifest executionMode 与 Harness 原生 Worker 记录；并发 fixture 至少两个 Worker 执行区间重叠，降级 fixture 不改变 ticket 和 accepted Artifact 身份。普通报告不要求 Agent 手工补写 dispatch/terminal span。
**排除的失败：** 表面声明并发，实际逐 Lane等待；降级路径使用另一套输入或跳过验证。

### Projection 完整性

**必须证明：** Projection 减少重复输入且没有成为第二事实源。  
**主证据：** 每个 Lane 的 Projection contract检查，所有可引用事实和 Evidence ref均能解析到同 Run canonical Artifact，omitted fields明确，bytes 已记录。  
**排除的失败：** 丢失 Prompt必需事实、跨 Scope混入、重算数值或 Validator改信 Projection。

### 失败隔离

**必须证明：** 一个 Lane拒绝只重试该 Lane一次，accepted Lane和 frozen inputs不变。  
**主证据：** Report Run集成检查提交一个无效 Lane结果，观察 attempt 2 ticket、其余 accepted Artifact hash不变、第二次失败后生成 Lane-specific Fallback并完成 HTML。  
**排除的失败：** 重跑 prepare、覆盖成功 Artifact、无限重试或整份报告失败。

### 真实宿主交付

**必须证明：** installed Skill 能通过 Codex原生 Worker完成一个真实 Run并打开最终 HTML。  
**主证据：** 一次相关真实报告，保留执行模式、ticket、Projection bytes、Lane终态、HTML hash/size、UI dispatch、cleanup和同 Scope基线对比。  
**排除的失败：** 只有 fixture、手工拼 JSON、未打开 HTML，或把 Lane Outer Span报告为模型时间。

上述检查各自只证明其责任边界。测试不能通过复制实现清单、grep源码或让 fake直接制造被断言的调度结果来通过。共享运行时合同完成后需要一次独立 Standards / Spec复核，未解决 P0/P1 阻断完成。

## 非目标

- 不实现外部 Provider API并发。
- 不合并三个 Prompt或三个 Lane输出。
- 不建立通用 DAG框架、队列、daemon或模型服务。
- 不追求严格一次内部 Tool Call。
- 不把固定 AI生成秒数作为验收门禁。
- 不顺带重构 Reader、报告内容、Renderer视觉或 Skill Insights质量。

## Implementation Tickets

- `issues/0026-code-owned-report-run-checkpoints.md`
- `issues/0027-lane-input-projections.md`
- `issues/0028-native-lane-workers-installed-delivery.md`
