# agent-audit

`agent-audit` helps a coding agent explain where its own historical usage went. The user asks inside Claude Code, Codex, Pi, or DeepSeek Harness; a thin native integration invokes a local deterministic tool for that same harness and returns evidence the host agent can explain.

## Aha moment

Within one minute, answer three questions about the invoking harness:

1. Which session, project, model, or time window accounts for the most usage?
2. What observable mechanism caused it: a long session, repeated tool output, retries/errors, compaction, or subagents?
3. What is the single highest-impact next action, and what evidence supports it?

Example user prompts:

```text
帮我分析最近 7 天这个项目的 Codex 消耗。
为什么我最近的 Claude Code Token 用得这么快？
帮我对比近 30 天所有项目的 Pi 消耗情况。
```

The default scope is the invoking harness, current project, and last 7 days. A user may widen the scope to all projects or another period, but one invocation never silently mixes harnesses.

## MVP

- Harnesses: Claude Code, Codex, Pi, and DeepSeek Harness.
- Experience: a native Skill/Integration calls one local TypeScript CLI command and the host agent explains its JSON evidence.
- Inputs: existing local session history only.
- Outputs: a concise finding in the agent conversation; JSON is authoritative and text is a compact CLI view.
- Privacy: raw prompts, source code, and tool output stay local and are omitted from default output.

The implementation scope and acceptance criteria live in [docs/MVP.md](docs/MVP.md). Read [docs/DESIGN.md](docs/DESIGN.md) before implementing the CLI or a Reader, and [docs/HARNESS_DATA_SOURCES.md](docs/HARNESS_DATA_SOURCES.md) before changing harness-specific parsing.

## Local installation

From a clean checkout, install dependencies and expose the CLI plus project-scoped native Skills with:

```text
npm install
npm run install-local
```

`install-local` builds the CLI, links the `agent-audit` command through npm, and installs one fixed-Harness Skill in each native project location:

| Harness | Skill location |
| --- | --- |
| Codex | `.agents/skills/agent-audit-codex/SKILL.md` |
| Claude Code | `.claude/skills/agent-audit-claude/SKILL.md` |
| Pi | `.pi/skills/agent-audit-pi/SKILL.md` |
| DeepSeek Harness | `.agents/skills/agent-audit-deepseek/SKILL.md` |

To install the same entries into another project, pass its absolute path to `npm run install-skills -- <project-root>`. Each Skill fixes its invoking Harness and delegates all counting to the local `agent-audit inspect` command.

## Status

The local end-to-end MVP is verified. The TypeScript tool reads Codex, Claude Code, Pi, and the observed DeepSeek Harness JSONL/Zstandard history forms, ranks complete usage by Session/project/model/time bucket, and each Harness has a thin native Agent Skill entry point. Run `npm install`, then `npm run install-local` to expose the command and install the project-scoped Skills; `npm test` runs the redacted regression suite.

The implementation remains deliberately local and deterministic: no cloud upload, background collector, persistent normalized database, or cross-Harness audit is included.
