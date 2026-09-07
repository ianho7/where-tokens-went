---
name: agent-audit-pi
description: Explain recent Pi usage from local Session JSONL using the Agent Audit deterministic tool.
---

# Agent Audit for Pi

Use this Skill when the user asks where Pi usage or cost went, which Session or project was largest, or what action could reduce context growth.

The invoking Harness is fixed to Pi. Do not inspect Claude Code, Codex, DeepSeek Harness, or any other Harness in response to a Pi request.

## Invocation

For the Current Project, run:

```text
agent-audit inspect --harness pi --cwd <absolute-current-project-path> --since <duration> --format json
```

Use `7d` when no period is requested. Use `--all-projects` only when the user explicitly asks for a Global Audit within Pi.

The local tool is authoritative. Preserve reported cost separately from token totals, do not recalculate totals, infer missing values as zero, or expose raw Session content.

## Explanation

Explain the returned AuditResult concisely, preserving Scope, coverage, largest contributor, Finding, Evidence, Provenance, recommendation, and limitations. If no Finding is supported, say so. Never include prompts, source code, model responses, shell output, tool results, credentials, or base64 payloads from local history.
