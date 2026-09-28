---
status: accepted
---

# 报告由代码编排，Codex 原生子 Agent执行 AI Lane

## 背景

完整报告目前由 Host Agent 逐步调用 `prepare`、`evidence`、三组 `ai-start` / `ai-accept`、`compose`、打开、`finalize` 和 `cleanup`。代码已经维护状态、指纹、验证与 Artifact，但不会主动推进完整流程。真实 Run 用时 880.223 秒，其中 243.690 秒位于 Lane 外部且没有权威因果归因，三个 Lane 从首次启动到最后接受形成 615.601 秒外层包络。

直接在 CLI 中引入 Provider 客户端可以让代码发起模型请求，却会改变零配置、凭据、隐私和费用边界。继续由一个 Host Agent 串行生成三个 Lane，则无法实现真实并发，也保留了逐步调度空档。

## 决策

Report Orchestrator 成为流程权威。它冻结 Scope、准备 Evidence、生成 Lane Input Projection、签发 Lane ticket、等待终态、决定单 Lane 重试或 fallback，并自动完成 composition、render、finalize 和 cleanup。

Codex 通过 Host Capability Bridge 一次性派发最多三个原生 Lane Worker。每个 Worker 只读取自己的权威 Prompt、ticket 和投影，并提交一个结构化 Lane 结果。原生并发不可用时，同一组 Worker 按顺序执行，Report Run 合同不变。

CLI 不读取 Provider 凭据，也不启动第二个模型客户端。Host Capability Bridge 只执行本地代码无法调用的宿主能力，目前是原生 Subagent dispatch 和在 Codex 内打开最终 HTML。它不决定流程顺序、重试策略或完成状态。

`prompts/report-synthesis.md`、`prompts/key-session-analysis.md` 和 `prompts/skill-insights.md` 继续分别作为三个 Lane 的源 Prompt。三个 Lane 保留独立输入、Validator、retry、fallback 和 Artifact。投影减少重复上下文传输，但 canonical Audit、Content Evidence 和 Skill Snapshot 仍是验证与组合的事实权威。

## 结果

- 报告仍是零配置本地产品，不需要用户提供模型 API Key。
- 编码化状态机取代 Host Agent逐命令推进，Host 只保留两项窄能力。
- 三个 Lane 可以真实重叠执行，失败只影响对应 Lane。
- Lane Outer Span 只证明调度区间和重叠，不冒充模型生成时间。
- 性能验收观察可控阶段、输入体积与同范围总耗时，不对不可控模型响应设置固定秒数。
- Provider 直连、跨 Harness模型服务和通用工作流引擎仍不在当前范围内。
