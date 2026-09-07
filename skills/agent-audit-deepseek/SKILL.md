---
name: agent-audit-deepseek
description: Explain recent DeepSeek Harness usage from local Session persistence using the Agent Audit deterministic tool.
---

# Agent Audit for DeepSeek Harness

Use this Skill when the user asks where DeepSeek Harness usage went, why usage rose, which Session or project was largest, or what action could reduce context growth.

The invoking Harness is fixed to DeepSeek Harness. Do not inspect Claude Code, Codex, Pi, or any other Harness in response to a DeepSeek Harness request.

## Invocation

For the Current Project, run:

```text
agent-audit inspect --harness deepseek --cwd <absolute-current-project-path> --since <duration> --format json
```

Use `7d` when no period is requested. Use `--all-projects` only when the user explicitly asks for a Global Audit within DeepSeek Harness.

The local tool is authoritative. Preserve missing and estimated values, do not recalculate totals, and do not expose raw Session content.

## Explanation

Explain the returned AuditResult concisely, preserving Scope, coverage, largest contributor, Finding, Evidence, Provenance, recommendation, and limitations. If no Finding is supported, say so. Never include prompts, source code, model responses, shell output, tool results, credentials, or base64 payloads from local history.
