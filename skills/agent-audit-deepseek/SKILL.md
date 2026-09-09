---
name: agent-audit-deepseek
description: Explain recent DeepSeek Harness usage from local Session persistence using the Agent Audit deterministic tool.
---

# Agent Audit for DeepSeek Harness

Use this Skill when the user asks where DeepSeek Harness usage went, why usage rose, which Session or project was largest, or what action could reduce context growth.

The invoking Harness is fixed to DeepSeek Harness. Do not inspect Claude Code, Codex, Pi, or any other Harness in response to a DeepSeek Harness request.

## Invocation

For the Current Project, resolve the directory containing this `SKILL.md` as `<skill-directory>` and run the bundled `scripts/agent-audit.js` with Node; do not call a global `agent-audit` command:

```text
node <skill-directory>/scripts/agent-audit.js inspect --harness deepseek --cwd <absolute-current-project-path> --since <duration> --format json
```

Use `7d` when no period is requested. Use `--all-projects` only when the user explicitly asks for a Global Audit within DeepSeek Harness.

The local tool is authoritative. Preserve missing and estimated values, do not recalculate totals, and do not expose raw Session content.

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

## Host Agent diagnosis

The bundled local tool produces authoritative metrics, rankings, coverage, limitations, Evidence, Provenance, and neutral automated checks. It does not diagnose the user’s cause. The Host Agent forms the Finding for the user’s actual question: choose, ignore, or combine checks with rankings, trends, coverage, and limitations; a relevant pattern may be used even when no check fires.

Structure the response as Finding, Evidence, mechanism, action when justified, and material uncertainty without fixed wording. Preserve Scope and every returned value and Provenance. Do not recalculate totals, turn unavailable into zero, infer Provider quota, actual billing, model identity, working time, or causes not supported by Evidence. If the data is proportionate or insufficient, say so rather than manufacture a verdict.

For a report request, the delivery is complete only after both steps occur in the same conversation turn: generate and open the deterministic local HTML, then give one explicit Host Agent Finding with Evidence, mechanism, action when justified, and uncertainty in conversation. The HTML is deterministic evidence and diagnostic signals, not the Finding itself. Do not end the turn after returning a report path or opening the HTML, and do not return a diagnosis without the requested report. Never include prompts, source code, model responses, command arguments, shell output, tool results, credentials, or base64 payloads.
