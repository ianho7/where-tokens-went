# MVP

## Product promise

When invoked inside Claude Code or Codex, where-tokens-went examines only that Harness's existing local history and produces one evidence-backed explanation of where usage went and what the user should try next.

The first release succeeds when a user sees a real session, tool, retry, compaction, or subagent behavior responsible for a meaningful share of usage and says, “原来消耗在这里。”

## Product shape

The user-facing product is a thin Harness-native Skill or integration plus a local deterministic tool. Each Skill is distributed with the runtime it invokes, so copying or installing one Skill directory is sufficient; the Host Agent remains the UI and explains the result; the TypeScript CLI reads and calculates facts.

MVP invocation behind the integration:

```text
where-tokens-went inspect --harness <claude|codex> --cwd <absolute-path> --since 7d --format json
```

For a requested global view within the invoking Harness:

```text
where-tokens-went inspect --harness codex --all-projects --since 30d --format json
```

`--all-projects` widens project scope only. It never scans another Harness.

## In scope

- Existing local Session history for two Harnesses: Claude Code and Codex.
- One explicitly selected Harness per invocation.
- Current-project audit by default; all-project audit when requested.
- User-selected time range; 7 days by default.
- Usage totals and ranking by session, project, model, and time window when supported by the source.
- Shared Token composition that keeps Codex's inclusive input count distinct from Claude Code's mutually exclusive ordinary, cache-read, and cache-write buckets; cache-read/cache-write rates are aggregated before division.
- Cache economics with the default LiteLLM model-catalog lookup: observed API-equivalent cost, an all-uncached counterfactual, savings, and explicit price/composition coverage. All currency values are estimated equivalent API spend, not subscription billing; the lookup sends only Provider/model metadata and fails soft.
- The observed burden of the earliest valid deduplicated ModelCall in each selected Session, including median, selected-usage share, cache composition, and source-proven top-level/Subagent groups when identity coverage is complete. It is labelled as first-request burden, not an exact startup tax.
- Skill evidence for available, invoked, and attributed states from Claude Code and Codex when the local source proves the boundary; direct resource footprint and observed association are separate from causal impact, which remains unavailable without a valid counterfactual.
- Deterministic automated checks for long Session concentration, repeated tool-result amplification, extra calls from errors/retries/subagents, model concentration, and data completeness when supported by Evidence.
- For Codex, distinguish total execution Sessions from top-level tasks and source-proven subagent Sessions when the local metadata supports that split.
- Human-readable automated-check output with a stable pass, notice, or warning outcome, compact Evidence, and the deterministic method; internal check identifiers are not the user-facing report.
- One Host Agent-authored Finding with Evidence and one recommended next action when justified.
- JSON output for the Host Agent and concise text output for direct CLI use.
- `reported`, `derived`, `estimated`, and `unavailable` value provenance.

## Not in scope

- Scanning or combining multiple Harnesses in one invocation.
- Cross-Harness ranking or cost comparison.
- Provider subscription-quota prediction or claims about an actual provider bill.
- OpenTelemetry collection, hooks, daemon processes, or cloud upload.
- MCP server, dashboard, team analytics, or a plugin framework.
- A persistent normalized event database.
- A formal golden evaluation platform.
- Pi and DeepSeek Harness history support is temporarily suspended and outside the current MVP.
- Follow-up extraction, AI rework classification, and a rework-rate metric are next-stage work and are not implemented or represented by this MVP contract.

## Default privacy

Readers may inspect local content in memory when necessary to pair events and calculate size. They do not persist or return raw prompts, source code, model responses, or tool results. Default Evidence may include:

- Harness and Session identifiers;
- timestamps and model/provider identifiers;
- tool names and call identifiers;
- byte/token counts and hashes;
- redacted source locations;
- Skill names, versioned attribution markers, and redacted structural source locations may be reported as evidence; Skill bodies, invocation arguments, scripts, and resource contents are never returned.
- the calculation method and Provenance.

Content snippets require an explicit future opt-in and are not part of MVP.

The default LiteLLM lookup sends only the expected Provider and model identifiers. The response is not persisted as a separate database or cache; lookup failures remain local `unavailable` Evidence.

## Aha response

The default result should fit in one Agent response:

1. scope and coverage;
2. largest usage contributor;
3. strongest supported cause;
4. compact numeric Evidence;
5. one next action;
6. limitations caused by missing or estimated data.

Do not dilute the result with every available chart or warning. If no strong cause is supported, say what was measured and what information is missing.

For a report request, the deliverable is atomic: generate and open the deterministic standalone HTML, then provide one explicit Host Agent Finding in the same conversation turn. The HTML contains metrics, rankings, coverage, limitations, and human-readable automated checks; it does not contain an AI-authored Finding. Returning only a report path, only diagnostic signals, or only internal check identifiers does not satisfy the Aha response.

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
- deterministic text, share, and HTML outputs render checks as human-readable diagnostic signals with pass, notice, or warning outcomes, Evidence, and method rather than exposing bare internal identifiers;
- JSON, text, share, and standalone HTML expose the same cache-economics, first-request, and Skill-evidence facts, preserving missing values and Provenance across projections;
- LiteLLM API-equivalent cost rows identify exact Provider/model and compatible cache dimensions, retain catalog source and retrieval time, and are marked `estimated`; when only part of Usage is priced, the report shows that partial estimate and its coverage while excluding the remainder; unknown or incompatible Usage remains `unavailable` while Token evidence remains usable;
- first-request and Skill results state their evidence boundary and limitations; they do not claim startup tax, causal Skill impact, actual billing, or inferred invocation from a listing alone;
- the Host Agent identifies one evidence-backed Finding or truthfully reports that none is supported;
- a report request produces both the opened deterministic HTML and the Host Agent's separate conversational diagnosis.
