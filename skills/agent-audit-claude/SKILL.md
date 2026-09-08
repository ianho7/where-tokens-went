---
name: agent-audit-claude
description: Explain recent Claude Code usage from local transcript history using the Agent Audit deterministic tool.
---

# Agent Audit for Claude Code

Use this Skill when the user asks where Claude Code usage went, why usage rose, which Session or project was largest, or what action could reduce repeated context usage.

The invoking Harness is fixed to Claude Code. Do not inspect Codex, Pi, DeepSeek Harness, or any other Harness in response to a Claude Code request.

## Invocation

Translate the user's natural-language scope into one explicit local command. Resolve the directory containing this `SKILL.md` as `<skill-directory>` and run the bundled `scripts/agent-audit.js` with Node; do not call a global `agent-audit` command:

```text
node <skill-directory>/scripts/agent-audit.js inspect --harness claude --cwd <absolute-current-project-path> --since <duration> --format json
```

Use `7d` when no period is requested. The Global Audit form is supported by the local tool for this Harness; use `--all-projects` only when the user explicitly asks for all projects.

The local tool is authoritative. Do not recalculate totals, infer missing values as zero, or expose raw transcript content.

## Intent routing

Natural language is the primary interface. Interpret the request into fixed Harness, Audit Scope, period, locale, view, and output arguments, then run the same bundled inspect command. Logical shortcuts are optional aliases, not a second implementation:

- Full diagnosis or /agent-audit: current project and 7d by default, view full, and a local self-contained HTML report.
- usage: view usage for an at-a-glance panel.
- window: view window for locally observed recent five-hour activity. Provider quota, remaining allowance, reset time, and safe-to-start claims are unavailable without first-party data.
- report [days]: view report with --since <days>d and a local HTML path.
- tools [days]: view tools with --since <days>d.
- week: view week for two adjacent seven-day periods.
- share [days]: view share with --since <days>d and a local Markdown path.
- An arbitrary question is interpreted by the Host Agent into one of the fixed views; never pass transcript text or the question as a shell command.

Pass the user's language as --locale zh-CN or --locale en-US. For full and report views, choose a local output path, pass --html <report-path>, and open that file after successful generation. Use --share <share-path> for share view. The selected Harness, Current Project versus Global Audit, and privacy boundary must remain unchanged for every view.

## Explanation

Explain the returned result in one concise response, preserving the Audit Scope, coverage, largest contributor, top Finding, Evidence, Provenance, recommendation, and limitations. Use a Session ranking entry's `displayName` when present; it already contains the title and Session ID. Use `sharePercent.value` directly as percentage points and do not recalculate it. Format large numbers naturally for the user's language (for example, Chinese 万/亿 or English K/M/B), and include the exact token value when useful for verification. Explain `reported` as directly recorded, `derived` as calculated from records, `estimated` as an estimate, and `unavailable` as missing data in the user's language. If `topFinding` is null, say that the available history does not support a strong cause. Never include prompts, source code, model responses, shell output, tool results, credentials, or base64 payloads from local history.
