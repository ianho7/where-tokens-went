---
status: accepted
---

# 在报告中生成关键 Session 分析

where-tokens-went 将保留可复算的确定性数据层，同时由 Host Agent 对 Token 排名最高的至多 3 个 Session 生成结构化的关键 Session 分析，并与 Evidence 一起写入 HTML。调用 Skill 表示用户授权在当前 Audit Scope 内于内存中读取 Session 内容；取证采用渐进方式，先由确定性分析定位关键 Turn，再读取相关内容，而不是一次性向模型提交完整日志。

关键 Session 分析使用固定的“任务背景—主要问题—证据链—改善行动—验证方法”结构，自适应选择 Token、API 等价成本、耗时或稳定性中最严重且最可行动的问题。没有强证据时不生成强行结论；建议优先针对工作流、Session 切分和工具输出，只在 Evidence 充分时涉及模型、Skill、Plugin 或配置。AI 分析失败时，确定性报告仍正常产生并显示降级原因。

这项能力仍是报告，不是 Harness 或持续教练系统。HTML 不保存原始 prompt、命令或工具输出；首版不持久化建议、不跟踪执行结果，也不证明改善有效。报告只提供有证据的提议与验证方向，是否实施及验证由用户决定。
