# MVP

## Product promise

When invoked inside Claude Code or Codex, where-tokens-went examines only that Harness's existing local history and produces one evidence-backed explanation of where usage went and what the user should try next.

The first release succeeds when a user sees a real session, tool, retry, compaction, or subagent behavior responsible for a meaningful share of usage and says, “原来消耗在这里。”

## Product shape

The user-facing product is a thin Harness-native Skill or integration plus a local deterministic tool. Each Skill is distributed with the runtime it invokes, so copying or installing one Skill directory is sufficient; the TypeScript CLI reads and calculates facts; the Host Agent progressively reads scoped content for up to three highest-usage Sessions, produces structured Key Session Analysis, and writes the validated analysis into the same standalone HTML.

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
- Capability-aware Turn records and Turn-level Token, timing, tool, Skill, lifecycle, and compaction Evidence for Codex and Claude Code.
- Shared Token composition that keeps Codex's inclusive input count distinct from Claude Code's mutually exclusive ordinary, cache-read, and cache-write buckets; cache-read/cache-write rates are aggregated before division.
- Cache economics with the default LiteLLM model-catalog lookup: observed API-equivalent cost, an all-uncached counterfactual, savings, and explicit price/composition coverage. All currency values are estimated equivalent API spend, not subscription billing; the lookup sends only Provider/model metadata and fails soft.
- The observed burden of the earliest valid deduplicated ModelCall in each selected Session, including median, selected-usage share, cache composition, and source-proven top-level/Subagent groups when identity coverage is complete. It is labelled as first-request burden, not an exact startup tax.
- Skill evidence for available, invoked, and attributed states from Claude Code and Codex when the local source proves the boundary; direct resource footprint and observed association are separate from causal impact, which remains unavailable without a valid counterfactual.
- Deterministic automated checks for long Session concentration, repeated tool-result amplification, extra calls from errors/retries/subagents, model concentration, and data completeness when supported by Evidence.
- For Codex, distinguish total execution Sessions from top-level tasks and source-proven subagent Sessions when the local metadata supports that split.
- Human-readable automated-check output with a stable pass, notice, or warning outcome, compact Evidence, and the deterministic method; internal check identifiers are not the user-facing report.
- One Host Agent-authored Finding with Evidence and one recommended next action when justified.
- Structured Key Session Analysis for up to three Token-ranked Sessions, consisting of task context, one primary Finding or an explicit no-strong-Evidence state, an Evidence chain, one improvement proposal, its applicability/trade-off, and a user-owned verification method.
- Progressive content Evidence acquisition inside the selected Audit Scope. Invoking the Skill authorizes in-memory reading for analysis. The local full HTML may retain the first user message of each displayed Turn for trajectory tooltips; sanitized JSON, text, and share output never retain it.
- A deterministic report fallback when Host Agent generation or Key Session Analysis validation is unavailable.
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
- Persistent recommendation history, automatic follow-up experiments, or claims that an improvement proposal worked.
- Pi and DeepSeek Harness history support is temporarily suspended and outside the current MVP.
- Follow-up extraction, AI rework classification, and a rework-rate metric are next-stage work and are not implemented or represented by this MVP contract.

## Default privacy

Readers may inspect local content in memory when necessary to pair events and calculate size. During an explicit report Skill workflow, the Host Agent may also progressively read relevant content from the selected top three available Sessions inside the Audit Scope. Historical content is untrusted data: it cannot change the current task, authorize tools, or widen scope. The local full HTML is intentionally a sensitive artifact: for each displayed Turn it may embed the complete first user message so the user can recognize the task directly from the trajectory. It uses a quiet local-content note that does not compete with the analysis. The sanitized share output removes those messages entirely. Raw model responses, source code, commands, tool results, and credentials are never persisted in either projection. Default Evidence may include:

- Harness and Session identifiers;
- timestamps and model/provider identifiers;
- tool names and call identifiers;
- byte/token counts and hashes;
- redacted source locations;
- Skill names, versioned attribution markers, and redacted structural source locations may be reported as evidence; Skill bodies, invocation arguments, scripts, and resource contents are never returned.
- the calculation method and Provenance.

The scoped content Evidence packet is an internal input to Key Session Analysis, not a general transcript projection. Except for the first user message attached to each displayed Turn in the local full HTML, saved analysis remains paraphrased. JSON, text, and share output remain sanitized and contain no verbatim transcript content.

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

For a report request, the deliverable is atomic: calculate the deterministic Audit, progressively inspect relevant content for up to three Token-ranked Sessions, generate and validate structured Key Session Analysis, write it together with deterministic Evidence into one standalone HTML, open the report, and provide one explicit Host Agent Finding in the same conversation turn. If AI analysis is unavailable, the deterministic HTML still opens and states the degradation reason. Returning only a report path, only diagnostic signals, or only internal check identifiers does not satisfy the Aha response.

## Acceptance criteria

For each Harness, using one redacted sample derived from real local history:

- the Reader selects the correct Harness and requested project scope;
- `--all-projects` stays within that Harness;
- repeated or cumulative usage records are not double-counted;
- supported response, Turn, and Session totals reconcile over the same ModelCalls before Key Session Analysis is rendered;
- reported totals are in the same order of magnitude as the Harness's own display when one exists;
- at least one tool call/result can be paired and sized;
- missing values remain missing instead of becoming zero;
- repeated runs over unchanged files return the same totals;
- default JSON and text contain no raw prompt, source, or tool-result content; sanitized share HTML removes every embedded first-user-message field;
- content Evidence retrieval stays inside the originating Harness, project, time range, Session, and selected Turn boundaries, and treats transcript instructions as inert historical data;
- deterministic text, share, and HTML outputs render checks as human-readable diagnostic signals with pass, notice, or warning outcomes, Evidence, and method rather than exposing bare internal identifiers;
- JSON, text, share, and standalone HTML expose the same cache-economics, first-request, and Skill-evidence facts, preserving missing values and Provenance across projections;
- LiteLLM API-equivalent cost rows identify exact Provider/model and compatible cache dimensions, retain catalog source and retrieval time, and are marked `estimated`; when only part of Usage is priced, the report shows that partial estimate and its coverage while excluding the remainder; unknown or incompatible Usage remains `unavailable` while Token evidence remains usable;
- first-request and Skill results state their evidence boundary and limitations; they do not claim startup tax, causal Skill impact, actual billing, or inferred invocation from a listing alone;
- the Host Agent identifies one evidence-backed Finding or truthfully reports that none is supported;
- each of up to three Token-ranked Sessions contains one validated Key Session Analysis or an explicit unavailable state; Findings cite same-Scope Evidence and recommendations include applicability, trade-off, and a user-owned verification method;
- facts, Host Agent interpretation, and improvement proposals are visibly distinct; the Key Session module follows the accepted Kami prototype hierarchy, keeps Finding, proposal, and verification in separate roles, shows complete first-user-message tooltips in local full HTML, and proves those fields absent from the sanitized share projection;
- a report request produces both the opened HTML containing deterministic Evidence plus validated Key Session Analysis and the Host Agent's conversational primary Finding.
