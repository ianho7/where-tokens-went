---
status: accepted
---

# 在报告中生成关键 Session 分析

where-tokens-went 将保留可复算的确定性数据层，同时由 Host Agent 对 Token 排名最高的至多 3 个 Session 生成结构化的关键 Session 分析，并与 Evidence 一起写入 HTML。调用 Skill 表示用户授权在当前 Audit Scope 内于内存中读取 Session 内容；取证采用渐进方式，先由确定性分析定位关键 Turn，再读取相关内容，而不是一次性向模型提交完整日志。

`prompts/key-session-analysis.md` 是这层 Host Agent 生成行为的单一权威 Prompt，并由打包脚本原样复制到 Codex 与 Claude 两个 Skill。两个 Skill 必须在取得限定范围的 Content Evidence 后完整读取该 Prompt，再生成整个 Token 排名分析数组。把排名、Session/Turn 标识和数字替换后仍可互换的文案视为参数化模板；重新生成后仍不能形成 Session-specific 机制时，使用显式无强 Evidence 状态，而不是把通用模板标为 AI 解读。

关键 Session 分析在产品呈现上收敛为两个主体：“核心判断”和“轮次轨迹”。层级固定为模块标题、Session 条目标题、Session 元信息三级；核心判断中的主要 Finding 只承担判断职责，改善提议独立呈现，验证方法作为提议的从属尾注。证据直接落到轨迹，不再重复展示独立证据列表或重点轮次列表。Session 摘要是紧凑页头，完整轮次明细是默认折叠的审计附录。分析自适应选择 Token、API 等价成本、本轮耗时或稳定性中最严重且最可行动的问题。没有强证据时不生成强行结论；AI 分析失败时，确定性报告仍正常产生并显示降级原因。`docs/prototypes/key-session-analysis-kami.html` 是该模块的已接受视觉参照。

这项能力仍是报告，不是 Harness 或持续教练系统。本地完整 HTML 为了让用户从轨迹直接认出任务，在每轮 Tooltip 中保存该轮未经截断的完整第一条用户消息，并以克制的辅助说明标识本地内容属性。安全分享版本在渲染前删除这些消息；两种版本都不保存模型回复、源码、命令正文、工具结果或凭据。首版不持久化建议、不跟踪执行结果，也不证明改善有效。报告只提供有证据的提议与验证方向，是否实施及验证由用户决定。

首次响应等待继续保留在底层数据中，但不进入关键 Session 的默认图表、Tooltip 或完整明细。只有当 Host Agent 将异常响应等待选为主要问题时，分析才可引用该 Evidence。中文界面使用“轮次”“本轮耗时”“过程事件”和“自动压缩上下文”，不显示 Turn、活跃耗时、Lifecycle、compaction 或 TTFT。
