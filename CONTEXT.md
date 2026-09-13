# where-tokens-went

where-tokens-went is the domain of explaining a coding agent's historical resource usage from evidence already stored by its harness.

## Language

**Host Agent**:
The coding agent in which the user invokes where-tokens-went, such as Codex or Claude Code.
_Avoid_: Provider, model, client

**Skill Invocation**:
The public product entry in a Host Agent conversation: `$where-tokens-went` or an equivalent natural-language request. It covers deterministic Audit acquisition, Host Agent synthesis, validation, final report composition and opening, and the conversational Finding as one workflow.
_Avoid_: CLI invocation, shell command

**Internal CLI**:
The deterministic `where-tokens-went inspect` command used by the Skill to calculate authoritative facts and by developers for direct debugging. It does not call a model, and its direct HTML output is not the normal Skill report.
_Avoid_: Skill Invocation, AI report generator

**Harness**:
The agent runtime that owns sessions, tools, persistence, and execution behavior. Claude Code and Codex are the currently supported Harnesses in this project.
_Avoid_: Model, Provider

**Provider**:
The service that executes a model request. A Harness may use more than one Provider.
_Avoid_: Harness, Agent

**Session**:
A persisted unit of interaction owned by one Harness and associated with a project or working directory.
_Avoid_: Request, run

**Subagent Session**:
A persisted execution Session whose Harness metadata explicitly identifies it as a subagent; it is not the same thing as a top-level task shown in a Host Agent sidebar.
_Avoid_: Top-level task

**Current Project**:
The absolute working directory supplied by the invoking Host Agent and used to select matching Sessions.
_Avoid_: Repository, project slug

**Audit Scope**:
The explicit combination of Harness, project selection, and time range included in one Audit.
_Avoid_: Global state

**Global Audit**:
An Audit covering all projects for the invoking Harness within a requested period. It does not combine different Harnesses.
_Avoid_: Cross-Harness audit

**Reader**:
A Harness-specific interpreter that converts persisted Session records into the minimal common records required by Analysis.
_Avoid_: Connector, Adapter, Collector

**Usage**:
The observed model-resource quantities associated with a model call, such as input, cached input, output, reasoning, or reported cost.
_Avoid_: Quota

**Evidence**:
A value plus enough source location and method information for a person or Agent to verify how it was obtained.
_Avoid_: Claim, insight

**Automated Check**:
A deterministic, descriptive diagnostic signal with a stable identity, outcome, Evidence, and method. It is candidate Evidence and deterministic fallback content; it does not directly populate the normal HTML Findings module, select a primary cause, prescribe an action, or impersonate a Host Agent Finding.
_Avoid_: Finding, recommendation, verdict

**Finding**:
A Host Agent-owned, prioritized explanation of an observed usage pattern supported by same-Audit Evidence. Report-level Findings synthesize relationships across metrics and may merge or ignore Automated Checks; they preserve facts and Provenance, state support and material uncertainty, and do not turn correlation into causality.
_Avoid_: Alert, metric

**Audit Overview**:
A Host Agent-owned, Evidence-backed first impression of the Audit period's overall activity and usage shape. It is not a Finding, project-progress report, recommendation, or deterministic check.
_Avoid_: Executive Finding, project summary, progress report

**关键 Session 分析**:
Host Agent 对一个高贡献 Session 生成的证据化解读；它选择一个主要 Finding，说明可能机制与替代解释，并给出一项改善行动及验证方法。它必须区分事实、解读和建议，不改写 Evidence，也不把时间相关性表述为已证实因果。
_Avoid_: AI 诊断, 导师分析

**轮次**:
用户发出一条消息后，到 Agent 完成、被中断或仍未结束的一段交互。在中文报告中使用“第 12 轮”，不显示 `Turn 12`。
_Avoid_: Turn（用户界面）

**本轮耗时**:
一轮从开始到完成或中断的经过时间，可包含模型工作、工具调用、重试、等待、Subagent 和自动压缩上下文。它不是计费时间，也不表示每一秒都有效产出。
_Avoid_: 活跃耗时

**Token 集中度**:
Session 中用量最高的前 N 轮 Token 合计占该 Session Token 总量的比例。界面必须同时写明 N 和占比，例如“前 5 轮合计占 79.30%”，不能只写“前五高用量轮次”。
_Avoid_: 高用量轮次（未说明统计口径）

**首次响应等待**:
从用户请求开始到模型首次产生响应内容的时间；底层字段保留为 `timeToFirstTokenMs`。关键 Session 默认界面和完整明细不展示，只有当 Host Agent 将异常等待选为主要 Finding 时才可引用。
_Avoid_: TTFT（用户界面）

**过程事件**:
一轮中可定位的重试、自动压缩上下文、Subagent 或中断等事件的用户界面统称。
_Avoid_: Lifecycle（用户界面）

**自动压缩上下文**:
Harness 为释放上下文空间而把较早对话整理为摘要的过程。它与高用量同时出现不代表它造成高用量。
_Avoid_: compaction（用户界面）

**Provenance**:
The origin class of a value: `reported`, `derived`, `estimated`, or `unavailable`.
_Avoid_: Confidence

**Context Amplification**:
The repeated inclusion of earlier content, especially tool results, in later model requests within a Session.
_Avoid_: Exact billed tokens
