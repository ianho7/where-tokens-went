# where-tokens-went

`where-tokens-went` 用来解释 Codex 或 Claude Code 最近的本地用量去了哪里：哪个项目、Session、模型或时间段贡献最多，以及有哪些值得尝试的改进动作。

它只读取当前机器上的本地历史，不上传原始 Prompt、模型回复、源代码或工具输出。

## 安装

### 使用 skills.sh

```bash
npx skills add <owner>/<repo> --skill where-tokens-went --agent codex --yes
npx skills add <owner>/<repo> --skill where-tokens-went --agent claude-code --yes
```

将 `<owner>/<repo>` 替换为实际的 GitHub 仓库。需要固定版本时，请使用 Git tag 或 commit。

### Claude Code 插件

在 Claude Code 中添加本仓库的 Marketplace，然后安装 `where-tokens-went`：

```text
/plugin marketplace add <owner>/<repo>
/plugin install where-tokens-went@where-tokens-went
```

### Codex 插件

将本仓库作为本地 Marketplace 添加，再安装 `where-tokens-went`。Codex 插件清单位于 `skills/where-tokens-went/.codex-plugin/plugin.json`。

## 使用

在 Codex 或 Claude Code 对话框中输入：

```text
$where-tokens-went
```

也可以直接提出类似问题：

```text
帮我分析当前项目最近 7 天的 Codex 用量都花在哪里，并给出一个最值得尝试的改进建议。
```

默认范围是当前 Harness、当前项目和最近 7 天。只有在用户明确要求时，才会扩大到所有项目或其他时间范围。

报告会优先展示最大用量贡献者、可观察到的机制、下一步建议以及数据限制。无法由证据支持的原因会明确显示为未知，不会从本地历史内容推测结论。

运行时需要 Node.js。Skill 会调用自身目录中的本地确定性工具，不依赖全局安装的 `where-tokens-went` 命令。

## 目录

- `skills/where-tokens-went/SKILL.md`：Skill 入口和使用规则
- `skills/where-tokens-went/scripts/`：运行时脚本
- `skills/where-tokens-went/references/`：运行时参考 Prompt
- `skills/where-tokens-went/.claude-plugin/`：Claude Code 插件清单
- `skills/where-tokens-went/.codex-plugin/`：Codex 插件清单
