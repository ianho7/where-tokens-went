# 04: 在固定案例上单独运行一个 Prompt

**What to build:** 开发者可选定报告综合 Prompt 和一个固定 Audit/Evidence 案例，调用模型一次，立即查看输入摘要、AI 输出 JSON、证据引用和薄检查结果。

**Blocked by:** 01/固定 Codex 基线并冻结 Claude 入口.

**Status:** pass

- [x] 一次实验只运行选定 Prompt 和一次模型调用；不触发历史扫描、Audit 重算、定价、HTML、打包、安装或完整报告编排。
- [x] 薄检查只拦截结构缺失、虚构引用或数字、改写 Audit、把 unknown 当事实等明显越界；不规定 Finding 数量、主题或措辞。
- [x] 开发者改动源 Prompt 后，可用固定案例直接看到新的 JSON；不引入实验数据库、评分或晋升流程。
