# 04: 在固定案例上单独运行一个 Prompt

**What to build:** 开发者可选定报告综合 Prompt 和一个固定 Audit/Evidence 案例，调用模型一次，立即查看输入摘要、AI 输出 JSON、证据引用和薄检查结果。检查可对明确写出的统计单位（如 Tokens、模型调用次数、百分比）核对固定 Evidence 字段；其余自由文本语义忠实度由人工 Prompt Review 判断。

**Blocked by:** 01/固定 Codex 基线并冻结 Claude 入口.

**Status:** pass

**Targeted replan:** 单位校验只映射本 Ticket 覆盖的明确 Audit 字段与文字单位；不推断任意自由文本语义。`modelCallCount` 的数值不能支持 Token 数量表述。

- [x] 一次实验只运行选定 Prompt 和一次模型调用；不触发历史扫描、Audit 重算、定价、HTML、打包、安装或完整报告编排。
- [x] 薄检查只核对必要结构、Evidence 引用能在固定 Audit/选中材料中解析、数字及明确写出的统计单位与所引用字段一致（包括 unavailable 状态），并阻止 AI 替换或改写 Audit。其余自由文本对 Evidence 的语义忠实度由人工 Prompt Review 判断；检查不规定 Finding 数量、主题或措辞。
- [x] 开发者改动源 Prompt 后，可用固定案例直接看到新的 JSON；不引入实验数据库、评分或晋升流程。
