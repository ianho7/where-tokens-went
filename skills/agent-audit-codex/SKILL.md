---
name: agent-audit-codex
description: Explain recent Codex usage from local history using the Agent Audit deterministic tool.
---

# Agent Audit for Codex

Use this Skill when the user asks where their Codex usage went, why usage rose, which Session or project was largest, or what action could reduce repeated context usage.

The invoking Harness is fixed to Codex. Do not inspect Claude Code, Pi, DeepSeek Harness, or any other Harness in response to a Codex request.

## Invocation

Translate the user's natural-language scope into one explicit local command. Resolve the directory containing this `SKILL.md` as `<skill-directory>` and run the bundled `scripts/agent-audit.js` with Node; do not call a global `agent-audit` command. Use Current Project by default; when the user asks for a Global Audit, widen only the project selector with `--all-projects`:

```text
node <skill-directory>/scripts/agent-audit.js inspect --harness codex --cwd <absolute-current-project-path> --since <duration> --format json
```

```text
node <skill-directory>/scripts/agent-audit.js inspect --harness codex --all-projects --since <duration> --format json
```

Use `7d` when no period is requested. Global Audit still remains inside Codex; never substitute another Harness.

The local tool is authoritative. Do not recalculate totals, infer missing values as zero, or expose raw history content.

## Explanation

Explain the returned result in one concise response, preserving:

1. the reported Audit Scope and coverage;
2. the largest Session and usage contribution when available;
3. the top Finding and its Evidence;
4. the Provenance of each diagnostic value;
5. one recommendation; and
6. any limitation or unavailable value.

Use a Session ranking entry's `displayName` when present; it already contains the title and Session ID. Use `sharePercent.value` directly as percentage points and do not recalculate it. Format large numbers naturally for the user's language (for example, Chinese 万/亿 or English K/M/B), and include the exact token value when useful for verification. Explain `reported` as directly recorded, `derived` as calculated from records, `estimated` as an estimate, and `unavailable` as missing data in the user's language. Keep the exact JSON values authoritative.

If `topFinding` is null, say that the available history does not support a strong cause. Never include prompts, source code, model responses, shell output, tool results, credentials, or base64 payloads from the local history.
