---
name: agent-audit-pi
description: Explain recent Pi usage from local Session JSONL using the Agent Audit deterministic tool.
---

# Agent Audit for Pi

Use this Skill when the user asks where Pi usage or cost went, which Session or project was largest, or what action could reduce context growth.

The invoking Harness is fixed to Pi. Do not inspect Claude Code, Codex, DeepSeek Harness, or any other Harness in response to a Pi request.

## Invocation

For the Current Project, resolve the directory containing this `SKILL.md` as `<skill-directory>` and run the bundled `scripts/agent-audit.js` with Node; do not call a global `agent-audit` command:

```text
node <skill-directory>/scripts/agent-audit.js inspect --harness pi --cwd <absolute-current-project-path> --since <duration> --format json
```

Use `7d` when no period is requested. Use `--all-projects` only when the user explicitly asks for a Global Audit within Pi.

The local tool is authoritative. Preserve reported cost separately from token totals, do not recalculate totals, infer missing values as zero, or expose raw Session content.

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

Explain the returned AuditResult concisely, preserving Scope, coverage, largest contributor, Finding, Evidence, Provenance, recommendation, and limitations. Use a Session ranking entry's `displayName` when present; it already contains the title and Session ID. Use `sharePercent.value` directly as percentage points and do not recalculate it. Format large numbers naturally for the user's language (for example, Chinese 万/亿 or English K/M/B), and include the exact token value when useful for verification. Explain `reported` as directly recorded, `derived` as calculated from records, `estimated` as an estimate, and `unavailable` as missing data in the user's language. If no Finding is supported, say so. Never include prompts, source code, model responses, shell output, tool results, credentials, or base64 payloads from local history.
