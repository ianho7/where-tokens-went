# where-tokens-went

`where-tokens-went` 用来解释编码智能体的历史用量去了哪里。用户在 Claude Code 或 Codex 中用自然语言提问，对应的原生 Agent Skill 会调用同一台机器上的确定性 CLI，再由当前智能体解释 CLI 返回的证据。

## 名称与迁移状态

`where-tokens-went` 是项目正式对外名称，也已经同步作为 CLI 命令、两个 Skill/plugin 的安装标识和目录命名空间。旧版 agent-audit 命令和 agent-audit-* Skill 标识不再是当前发布入口；已有旧版安装需要按新名称重新安装。

## Aha moment

目标是在一分钟内回答三个问题：

1. 哪个 Session、项目、模型或时间段贡献了最多用量？
2. 可以观察到的主要原因是什么：长 Session、重复携带工具输出、重试/错误、上下文压缩，还是子智能体？
3. 当前最值得采取的一项行动是什么，证据是什么？

默认审计范围是：当前 Harness、当前项目、最近 7 天。用户可以明确改为所有项目或其他时间范围，但一次调用不会静默混合多个 Harness。

## MVP 边界

- 支持 Claude Code 和 Codex。
- 最终形态是“原生 Agent Skill + 本地确定性工具”。
- 只读取已有的本地 Session 历史，不需要后台采集器。
- JSON 是权威结果；文本格式只提供紧凑的人类可读摘要。
- 原始 prompt、源代码、模型回复和工具输出保留在本机，不出现在默认结果中。

完整范围与验收标准见 [docs/MVP.md](docs/MVP.md)。修改 CLI、共享记录、分析或隐私行为前请阅读 [docs/DESIGN.md](docs/DESIGN.md)；修改 Harness Reader 前请阅读 [docs/HARNESS_DATA_SOURCES.md](docs/HARNESS_DATA_SOURCES.md)。

## 安装

推荐从包含本仓库的 Git 版本或 Skill 平台安装。每个 Skill 目录现在都包含 `SKILL.md` 和同版本的本地确定性工具；不需要另行安装全局 `where-tokens-went` 命令。

### GitHub / skills.sh

仓库按 `skills/<skill-name>/SKILL.md` 约定暴露两个 Skill。选择与当前 Harness 对应的目录即可；也可以把两个目录作为一个 Skill pack 安装。

```bash
# 使用 skills.sh CLI 安装指定 Harness 的 Skill（将 owner/repo 替换为实际仓库）
npx skills add <owner>/<repo> --skill where-tokens-went-codex --agent codex --yes
npx skills add <owner>/<repo> --skill where-tokens-went-claude --agent claude-code --yes

# 使用 GitHub CLI 安装指定 Harness 的 Skill
gh skill install <owner>/<repo> where-tokens-went-codex --agent codex
gh skill install <owner>/<repo> where-tokens-went-claude --agent claude-code
```

安装前请检查 Skill 目录中的脚本和来源；默认只读取本机历史，不上传数据。需要固定版本时，使用 Git tag 或 commit。

### Claude Code 市场

仓库包含 `.claude-plugin/marketplace.json`，在 Claude Code 中添加仓库后安装 `where-tokens-went-claude`：

```text
/plugin marketplace add <owner>/<repo>
/plugin install where-tokens-went-claude@where-tokens-went
```

### Codex 插件市场

Codex Skill 目录包含 `.codex-plugin/plugin.json`，仓库同时提供 repo-local marketplace 元数据。将该仓库作为本地 marketplace 添加后，安装 `where-tokens-went-codex`；具体命令以当前 Codex CLI 的插件命令为准。

### 从源码开发安装

前置条件：本机已安装 Node.js、npm，并已拉取本仓库。

在仓库根目录执行：

```bash
npm install
npm run install-local
```

`install-local` 会完成三件事：

1. 编译 TypeScript CLI；
2. 将同版本运行产物打包到两个 Skill 目录；
3. 通过 `npm link` 暴露全局 `where-tokens-went` 命令（仅供直接 CLI 调试），并将完整 Skill 目录安装到对应 Host 的原生目录。

源码变更后重新生成 Skill 产物：

```bash
npm run package-skills
```

| Harness | Skill 安装位置 |
| --- | --- |
| Codex | `.agents/skills/where-tokens-went-codex/`（含 `SKILL.md` 和 `scripts/`） |
| Claude Code | `.claude/skills/where-tokens-went-claude/`（含 `SKILL.md` 和 `scripts/`） |

如果要把已打包的 Skill 安装到另一个项目，请仍在本仓库根目录执行：

```bash
npm run install-skills -- "<目标项目绝对路径>"
```

该命令复制完整 Skill 目录。它只依赖本仓库中已生成的发布产物，不会在目标项目创建 `npm link`。

安装后，从目标项目目录启动对应的 Host Agent。若正在运行的会话没有发现新 Skill，请新建一个会话。

## 操作方式一：直接用自然语言

在对应 Host Agent 中提问即可。例如：

```text
帮我分析当前项目最近 7 天的 Codex 用量都花在哪里，并给出一个最值得采取的改进建议。

为什么我最近 7 天的 Claude Code Token 用得这么快？

```

每个 Skill 都固定绑定自己的 Harness。例如，在 Codex 中触发的 Skill 只会读取 Codex 历史；“所有项目”只扩大项目范围，不会扩大 Harness 范围。

正常结果应包含：

- 实际使用的审计范围与 Coverage；
- 最大用量贡献者；
- 确定性工具给出的、带结果状态、Evidence、方法和 Provenance 的人类可读自动检查；
- Host Agent 针对当前问题形成的主要 Finding，以及证据支持时的一项可执行建议；
- 数据缺失、格式不支持或统计不完整时的限制说明。

请求报告时，Skill 会生成并打开自包含 HTML，同时由 Host Agent 在同一轮对话中给出诊断。HTML 展示指标、排名、Coverage、限制和人类可读自动检查；它不内置固定的首要 Finding 或推荐动作。只返回报告路径或内部检查 ID 不算完成诊断。

## 操作方式二：直接运行 CLI

直接 CLI 调试（开发安装后）：

```bash
where-tokens-went inspect --harness codex --cwd "<当前项目绝对路径>" --since 7d --format text
```

Skill 正常使用时会调用自身目录下的 `scripts/where-tokens-went.js`，不依赖全局命令。

直接 CLI 输出是确定性证据面，不调用模型，也不替代 Host Agent 的 Finding。

获取适合智能体继续解释的权威 JSON：

```bash
where-tokens-went inspect --harness codex --cwd "<当前项目绝对路径>" --since 7d --format json
```

审计同一 Harness 下的所有项目：

```bash
where-tokens-went inspect --harness codex --all-projects --since 30d --format json
```

将 `codex` 替换为 `claude`，即可审计对应 Harness。

### CLI 参数

| 参数 | 含义 |
| --- | --- |
| `--harness` | 必填：`codex` 或 `claude` |
| `--cwd` | 当前项目的绝对路径；与 `--all-projects` 二选一 |
| `--all-projects` | 审计当前 Harness 下的所有项目；与 `--cwd` 二选一 |
| `--since` | 时间范围，默认 `7d`；支持 `h`、`d`、`w`、`m`，例如 `24h`、`7d`、`2w`、`1m` |
| `--format` | `json` 或 `text`，默认 `json` |

## 验证开发环境

```bash
npm run typecheck
npm test
```

当前回归覆盖 Claude Code 和 Codex 的安全输出、范围边界、用量统计、工具结果配对，以及 Codex 的 Session 语义。

## 当前状态

本地读取、共享分析和多格式报告主干已经可运行；Tare 式 Host Agent 主导诊断正在按 [Issue 0004](issues/0004-agent-led-tare-style-diagnosis.md) 收口，当前未完成项以该 Issue 的五张 ticket 为准。项目刻意不包含云端上传、后台采集器、持久化标准化数据库、跨 Harness 聚合、Dashboard 或正式评测平台；只有真实使用证明需要时才考虑扩展。
