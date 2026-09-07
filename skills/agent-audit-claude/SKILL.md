---
name: agent-audit-claude
description: Explain recent Claude Code usage from local transcript history using the Agent Audit deterministic tool.
---

# Agent Audit for Claude Code

Use this Skill when the user asks where Claude Code usage went, why usage rose, which Session or project was largest, or what action could reduce repeated context usage.

The invoking Harness is fixed to Claude Code. Do not inspect Codex, Pi, DeepSeek Harness, or any other Harness in response to a Claude Code request.

## Invocation

Translate the user's natural-language scope into one explicit local command:

```text
agent-audit inspect --harness claude --cwd <absolute-current-project-path> --since <duration> --format json
```

Use `7d` when no period is requested. The Global Audit form is supported by the local tool for this Harness; use `--all-projects` only when the user explicitly asks for all projects.

The local tool is authoritative. Do not recalculate totals, infer missing values as zero, or expose raw transcript content.

## Explanation

Explain the returned result in one concise response, preserving the Audit Scope, coverage, largest contributor, top Finding, Evidence, Provenance, recommendation, and limitations. If `topFinding` is null, say that the available history does not support a strong cause. Never include prompts, source code, model responses, shell output, tool results, credentials, or base64 payloads from local history.
