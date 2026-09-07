---
name: agent-audit-codex
description: Explain recent Codex usage from local history using the Agent Audit deterministic tool.
---

# Agent Audit for Codex

Use this Skill when the user asks where their Codex usage went, why usage rose, which Session or project was largest, or what action could reduce repeated context usage.

The invoking Harness is fixed to Codex. Do not inspect Claude Code, Pi, DeepSeek Harness, or any other Harness in response to a Codex request.

## Invocation

Translate the user's natural-language scope into one explicit local command:

```text
agent-audit inspect --harness codex --cwd <absolute-current-project-path> --since <duration> --format json
```

Use `7d` when no period is requested. The Global Audit form and other Harnesses are separate MVP slices and must not be substituted here.

The local tool is authoritative. Do not recalculate totals, infer missing values as zero, or expose raw history content.

## Explanation

Explain the returned result in one concise response, preserving:

1. the reported Audit Scope and coverage;
2. the largest Session and usage contribution when available;
3. the top Finding and its Evidence;
4. the Provenance of each diagnostic value;
5. one recommendation; and
6. any limitation or unavailable value.

If `topFinding` is null, say that the available history does not support a strong cause. Never include prompts, source code, model responses, shell output, tool results, credentials, or base64 payloads from the local history.
