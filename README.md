# where-tokens-went

在 Codex 对话中输入 `$where-tokens-went`，查看最近的 Token 用量主要花在哪些任务、哪些行为可能解释这些消耗，以及下一步值得尝试的调整。工具读取本地历史，生成并打开独立 HTML 报告，同时在对话中给出最有证据支持的结论。

**当前支持 Codex；Claude Code 支持暂停。** 暂停期间，在 Claude Code 中调用会提示停止，不读取任何历史。恢复条件见 [Claude Code 支持状态](docs/CLAUDE_CODE_RECOVERY.md)。

## 安装

运行时需要 Node.js。Skill 自带运行时和分析 Prompt，不需要全局安装 `where-tokens-went` 命令，也不需要另配模型 API Key。

使用 skills.sh 安装到 Codex：

```bash
npx skills add ianho7/where-tokens-went --skill where-tokens-went --agent codex --yes
```

仓库也提供 [Codex 插件清单](skills/where-tokens-went/.codex-plugin/plugin.json)，供插件集成参考。上面的 Skill 安装方式是本文的快速开始路径。

## 快速开始

在要分析的项目中打开 Codex 对话，输入：

```text
$where-tokens-went
```

默认分析当前项目最近 7 天的 Codex 历史。只有明确要求时，才扩大项目或时间范围；不会合并其他编码 Agent 的历史。

也可以用自然语言提出问题：

```text
用 where-tokens-went 分析当前项目最近 7 天的 Codex 用量，生成报告，并给出一个最值得尝试的改进建议。
```

- 查看更大范围：用 where-tokens-went 分析所有项目最近 30 天的 Codex 用量。
- 比较两周变化：用 where-tokens-went 比较当前项目最近一周与前一周的 Codex 用量。
- 生成分享摘要：用 where-tokens-went 生成当前项目最近 7 天的脱敏 Markdown 用量摘要。

## 报告里有什么

报告先解释最大用量去向、证据支持的机制或具体未知、值得尝试的下一步，以及会影响判断的数据限制，再展开明细：

- **用量分布**：任务、模型、时间趋势，以及跨项目统计时的项目贡献。
- **重点任务分析**：最多三个高贡献任务的轮次、工具和过程事件，结合任务内容解释可能机制，给出有依据的建议及验证方法。
- **Skill 洞察**：结合可观察的使用记录和选定 Skill 内容，分析能力增量或可能的冗余，不把调用次数直接当成质量或因果结论。
- **数据来源与限制**：区分记录值、计算值、估算值和暂不可用的数据。

证据不足时会保留已知用量，并明确说明无法判断的原因。AI 分析不可用或未通过校验时，相关部分会明确显示降级状态，保留可用的确定性统计，不编造诊断或建议。

HTML 内置图表和字体，可独立打开。报告默认使用内置字体；需要更换时，在对话中提供本地 `.ttf`、`.otf`、`.woff` 或 `.woff2` 文件路径。仅提供系统字体名不足以嵌入独立报告。

## 隐私与限制

历史读取和确定性统计在本地执行。AI 解读通过当前 Codex 完成，会使用本次范围内受限的任务内容片段和选定 Skill 内容；这一过程受当前 Codex 的模型服务与数据政策约束，不能视为完全离线分析。工具不额外连接模型服务，也不另行收集模型凭据。

本地完整 HTML 会保留展示轮次的首条用户消息，并可能包含用于支持 Skill 洞察的短摘录，因此应作为敏感文件保管。脱敏分享输出会移除这些内容；默认 JSON、文本和分享输出不包含原始对话、源代码或工具输出。需要分享时，使用脱敏摘要，并先检查其中的任务和 Skill 名称。

默认会联网向 LiteLLM 查询价格，只发送 Provider/model 标识，不发送任务内容。金额是 **API 等价费用估算**，不是订阅账单。价格缺失时会标明未计价部分或费用暂不可用，不把缺失费用算成零。工具不能推断剩余额度、额度重置时间，也不能保证某个建议一定节省用量。

## 开发与文档

业务源码位于 `src/`，分析 Prompt 位于 `prompts/`，两者是唯一源文件。`skills/where-tokens-went/` 是自包含分发包；不要直接修改其中的运行时或 Prompt 副本。

| 场景 | 入口与验证 |
| --- | --- |
| 本地开发安装 | `npm install`，再运行 `npm run install-local`，会构建分发包、链接 CLI 并安装项目内 Skill |
| 仅修改 Prompt | 使用仓库的 [prompt-lab Skill](.agents/skills/prompt-lab/SKILL.md) 和 `npm run prompt:lab`，完成一个固定样本、一次模型调用、事实检查和人工 JSON 审阅；无需完整报告或打包安装 |
| 修改运行时、校验器、隐私、渲染或分发 | 运行直接相关的确定性检查和真实回归；只有改变对应边界时才增加 HTML 或安装后交付验证 |
| 同步分发包 | `npm run package-skills`；提交前运行 `npm run verify-sync` |
| 综合测试 | `npm test`，会先打包并安装项目内 Skill，再执行测试，不是只读检查 |

私人 handoff、临时 spec 和草稿应留在本地，不提交。

- [产品目标与范围](docs/MVP.md)
- [技术设计](docs/DESIGN.md)
- [历史数据来源](docs/HARNESS_DATA_SOURCES.md)
- [Skill 入口与运行规则](skills/where-tokens-went/SKILL.md)
- [Claude Code 暂停与恢复条件](docs/CLAUDE_CODE_RECOVERY.md)
