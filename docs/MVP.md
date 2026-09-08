# MVP

## Product promise

When invoked inside Claude Code, Codex, Pi, or DeepSeek Harness, Agent Audit examines only that Harness's existing local history and produces one evidence-backed explanation of where usage went and what the user should try next.

The first release succeeds when a user sees a real session, tool, retry, compaction, or subagent behavior responsible for a meaningful share of usage and says, “原来消耗在这里。”

## Product shape

The user-facing product is a thin Harness-native Skill or integration plus a local deterministic tool. Each Skill is distributed with the runtime it invokes, so copying or installing one Skill directory is sufficient; the Host Agent remains the UI and explains the result; the TypeScript CLI reads and calculates facts.

MVP invocation behind the integration:

```text
agent-audit inspect --harness <claude|codex|pi|deepseek> --cwd <absolute-path> --since 7d --format json
```

For a requested global view within the invoking Harness:

```text
agent-audit inspect --harness codex --all-projects --since 30d --format json
```

`--all-projects` widens project scope only. It never scans another Harness.

## In scope

- Existing local Session history for four Harnesses: Claude Code, Codex, Pi, and DeepSeek Harness.
- One explicitly selected Harness per invocation.
- Current-project audit by default; all-project audit when requested.
- User-selected time range; 7 days by default.
- Usage totals and ranking by session, project, model, and time window when supported by the source.
- Three initial causes: long sessions/context growth, repeated tool-result amplification, and extra calls from errors/retries/subagents.
- One prioritized Finding with Evidence and one recommended next action.
- JSON output for the Host Agent and concise text output for direct CLI use.
- `reported`, `derived`, `estimated`, and `unavailable` value provenance.

## Not in scope

- Scanning or combining multiple Harnesses in one invocation.
- Cross-Harness ranking or cost comparison.
- Provider subscription-quota prediction.
- OpenTelemetry collection, hooks, daemon processes, or cloud upload.
- MCP server, dashboard, team analytics, or a plugin framework.
- A persistent normalized event database.
- A formal golden evaluation platform.
- DeepSeek Harness SQLite persistence; MVP supports the observed `.jsonl.zstd` backend.

## Default privacy

Readers may inspect local content in memory when necessary to pair events and calculate size. They do not persist or return raw prompts, source code, model responses, or tool results. Default Evidence may include:

- Harness and Session identifiers;
- timestamps and model/provider identifiers;
- tool names and call identifiers;
- byte/token counts and hashes;
- redacted source locations;
- the calculation method and Provenance.

Content snippets require an explicit future opt-in and are not part of MVP.

## Aha response

The default result should fit in one Agent response:

1. scope and coverage;
2. largest usage contributor;
3. strongest supported cause;
4. compact numeric Evidence;
5. one next action;
6. limitations caused by missing or estimated data.

Do not dilute the result with every available chart or warning. If no strong cause is supported, say what was measured and what information is missing.

## Acceptance criteria

For each Harness, using one redacted sample derived from real local history:

- the Reader selects the correct Harness and requested project scope;
- `--all-projects` stays within that Harness;
- repeated or cumulative usage records are not double-counted;
- reported totals are in the same order of magnitude as the Harness's own display when one exists;
- at least one tool call/result can be paired and sized;
- missing values remain missing instead of becoming zero;
- repeated runs over unchanged files return the same totals;
- default JSON and text contain no raw prompt, source, or tool-result content;
- the result identifies one evidence-backed Finding or truthfully reports that none is supported.
