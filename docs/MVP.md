# MVP

## Product promise

When the user enters `$where-tokens-went` or an equivalent natural-language request in a Claude Code or Codex conversation, where-tokens-went examines only that Harness's existing local history and produces one evidence-backed explanation of where usage went and what the user should try next.

The first release succeeds when a user sees a real session, tool, retry, compaction, or subagent behavior responsible for a meaningful share of usage and says, “原来消耗在这里。”

The product is a usage explanation, not an Audit-pipeline presentation. Within ten seconds of opening the result, the user should be able to identify the largest meaningful usage destination, understand the strongest supported mechanism or the exact unknown, see one justified next action when available, and notice any data limitation that materially changes that answer.

## Product shape

The user-facing product is the Harness-native `$where-tokens-went` Skill invocation, backed by a local deterministic tool. It is not the bare shell command. Each Skill is distributed with the runtime and two authoritative Prompts it invokes, so copying or installing one Skill directory is sufficient. In one atomic workflow, the TypeScript CLI first returns the structured sanitized Audit without opening a preliminary report; the current Host Agent reads the fixed bundled synthesis Prompt, generates and validates one Audit Overview plus report-level Findings, progressively reads scoped content for up to three highest-usage Sessions, reads the fixed bundled Key Session Analysis Prompt, produces and validates structured Session-specific analysis, and only then writes and opens the final standalone HTML.

Internal deterministic invocation behind the Skill (not the user-facing product command):

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
- Skill Insights as a cross-layer explanation: Usage Aha describes observed Skill topology, Capability Aha combines Usage with readable `SKILL.md` content and deletion counterfactuals, and Mechanism Aha requires supported trigger-sequence evidence. Pure Usage Insight is secondary and must not fill slots that should be reserved for validated content relationships.
- When selected `SKILL.md` content is readable, Skill Insights must attempt at least one Usage × Content Capability Aha. If no content candidate passes the dual-sided evidence gate, the report may show Usage Aha only but records the specific rejection reason; it must not fabricate a Capability Aha or fill the gap with duplicate Usage cards.
- Skill content analysis distinguishes Observed excerpts from AI Interpretation: `modelNativeScaffold` is judged relative to a capable current coding agent, not treated as a timeless fact. Claim strength scales with evidence sufficiency; one generic sentence cannot support a “primary Capability Delta” conclusion.
- Deterministic automated checks for long Session concentration, repeated tool-result amplification, extra calls from errors/retries/subagents, model concentration, and data completeness when supported by Evidence.
- For Codex, distinguish total execution Sessions from top-level tasks and source-proven subagent Sessions when the local metadata supports that split.
- Human-readable automated-check output with a stable pass, notice, or warning outcome, compact Evidence, and the deterministic method. Automated Checks remain candidate Evidence and a deterministic fallback; they do not populate the normal HTML “Findings” module directly.
- A Host Agent-authored report synthesis that selects at most five prioritized Findings from the complete sanitized Audit, may merge or ignore Automated Checks, and returns zero Findings when none changes the user's understanding or decision. Each retained Finding states the cross-metric interpretation, cites same-Audit Evidence, and marks support and material uncertainty without inventing causality.
- A Host Agent-authored Audit Overview that uses one or two sentences and one to three same-Audit Evidence references to give a first impression of the Audit period's overall activity and usage shape. It does not claim project outcomes, give recommendations, or duplicate a Finding's wording and detail.
- The existing HTML “Findings” module keeps its position and visual treatment while its normal content source changes from fixed Automated Check copy to the validated report synthesis.
- Five localized narrative chapter markers organize the standalone HTML around progressive disclosure: answer and essential context, diagnosis and supporting Evidence, secondary patterns, Session drill-down, then limitations and methodology. Chinese uses `01 · 概览`, `02 · 诊断`, `03 · 模式`, `04 · 追踪`, and `05 · 限制`; English uses `01 · Orient`, `02 · Diagnose`, `03 · Patterns`, `04 · Trace`, and `05 · Caveats`. The markers use Kami's additive Section-number grammar, start at one, and do not add a total-count denominator, progress indicator, or navigation UI.
- A Session ranking table that remains a deterministic ranking and navigation surface. It does not promote the first Turn diagnostic candidate to a “main driver”; causal or priority judgment belongs to validated Key Session Analysis.
- Structured Key Session Analysis for up to three Token-ranked Sessions, generated from the fixed bundled `key-session-analysis.md` Prompt and consisting of grounded task context, one Session-specific primary Finding or an explicit no-strong-Evidence state, an Evidence chain, one improvement proposal, its applicability/trade-off, and a user-owned verification method. Each existing Session disclosure also exposes a compact decision signal before expansion: the task identity, a concise finding or concrete unknown, and a derived “try / do not recommend / unavailable” state. Rank-, identifier-, Turn-, or number-parameterized prose is not Session-specific analysis.
- Progressive content Evidence acquisition inside the selected Audit Scope. Invoking the Skill authorizes in-memory reading for analysis. The local full HTML may retain the first user message of each displayed Turn for trajectory tooltips; sanitized JSON, text, and share output never retain it.
- A deterministic report fallback when Host Agent generation, report-synthesis validation, or Key Session Analysis validation is unavailable. The fallback identifies its content as Automated Checks rather than presenting it as AI synthesis.
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
- AI-authored output for direct CLI text/share and the narrow `usage`, `tools`, `week`, or `window` views is deferred. This increment applies the Audit Overview and report-level synthesis contract only to the default `$where-tokens-went` and `report` HTML workflow.

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

The default result should fit in one Agent response and follow the user's decision path:

1. the largest meaningful usage destination;
2. the strongest supported mechanism, or a precise statement that the mechanism is unknown;
3. whether the Evidence supports an avoidable pattern, a plausibly legitimate workload, or neither conclusion;
4. one concrete next action and verification method only when the mechanism supports it;
5. compact numeric Evidence and only the limitations that materially qualify the answer.

The standalone report uses progressive disclosure in this order: Primary Answer, supporting Evidence and secondary contributors, Session drill-down, then methodology and data limitations. Scope, Coverage, accounting, pricing, and other trust metadata stay available without displacing the answer unless they make that answer unreliable. Charts and tables verify or explore the answer; the user should not have to combine them to discover it.

Do not dilute the result with every available chart or warning. Do not fill a narrative quota. If no strong mechanism is supported, say where usage was measured and what specific Evidence is missing; a grounded unknown state is a successful result.

For the Key Session Analysis module, the compact Session disclosure is part of the decision path: a user should be able to tell whether a Session has a supported first experiment or an honest no-recommendation state without opening its trajectory or methodology details. The expanded content retains the full mechanism, alternatives, applicability, trade-off, verification, and deterministic Turn Evidence.

For a report request, the deliverable is atomic and ordered: calculate the deterministic Audit as structured data without opening an intermediate HTML; generate and validate the Audit Overview and report-level Findings from that sanitized Audit using the fixed bundled Report Synthesis Prompt; progressively inspect relevant content for up to three Token-ranked Sessions; generate and validate structured Key Session Analysis using the fixed bundled Key Session Analysis Prompt; write all three layers together with deterministic Evidence into one final standalone HTML; open that final report; and provide the strongest supported Finding in the same conversation turn. If AI analysis is genuinely unavailable or its output fails validation, the final HTML still opens: its header shows a neutral unavailable state and its Findings module presents clearly identified Automated Checks as fallback content. A preliminary `inspect --html` result is not a valid substitute. Returning only Audit JSON, a fallback preview, a report path, diagnostic signals, or internal check identifiers does not satisfy the Aha response.

Skill Insights follows a separate finite output contract inside the report: at most one pure usage-topology insight, at most one behavior anomaly, and up to two validated content/family insights. The exact count is evidence-driven; repeated Usage observations are merged or dropped. A Capability Aha must show what disappears with the whole Skill, what remains if only generic scaffolding disappears, and the evidence supporting both sides when the claim compares them. A naming family is not a capability family without content evidence from at least two members.

## Acceptance criteria

- the deterministic report-generation pipeline for a standard 7-day scope (up to 1,000 files, ~300,000 records) completes within **2.0 seconds** wall time (excluding Host Agent LLM inference);
- deterministic analysis over ~30,000 tool calls and ~10,000 model calls completes in **< 100 ms** through linear hash-map indexing without (N \times M)$ nested iteration;
- content evidence reading for the top three Token-ranked sessions directly reads targeted session files and completes in **< 100 ms** without re-traversing the filesystem;
- static font assets are read and Base64-encoded only once per process, ensuring subsequent HTML renders complete in **< 100 ms**;
- model pricing queries are cached locally with a 7-day TTL, achieving **0 ms** pricing resolution on cache hits;
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
- Skill Insights keeps Usage Aha, Capability Aha, and Mechanism Aha distinct; the final output does not present multiple equivalent Usage observations when a validated content insight is available;
- when readable `SKILL.md` content exists, a Capability Aha cites at least one Usage or behavior signal, one exact bounded content excerpt, a deletion counterfactual, and a decision implication; a “protocol rather than generic workflow” claim has both unique-capability and model-native evidence, otherwise it is rejected or narrowed;
- a low-frequency Skill with strong unique capability evidence is not treated as low value solely because of usage frequency, and a family name match alone never becomes a shared-capability conclusion;
- a Skill content profile records `lossIfRemoved`, `modelNativeScaffold`, `scopedContent`, and `contentSummary` rather than relying on a standalone capability score;
- calls-per-task anomalies without a validated Skill Trigger Trace remain anomalies with an explicit unknown mechanism; they are not described as lifecycle behavior or repeated injection;
- when a readable-content Capability candidate is rejected, trace/debug records one stable reason: `missing_unique_capability_evidence`, `missing_model_native_counterevidence`, `insufficient_content_support`, `usage_content_relation_unclear`, `family_content_unavailable`, or `duplicate_mental_model_shift`; P1 Trigger Trace is deferred until a P0 real-report review confirms it is still needed;
- the normal HTML “Findings” module contains the validated Host Agent report synthesis rather than fixed Automated Check prose and presents at most five distinct Findings; zero Findings with an explicit grounded unknown state is valid when no pattern changes the user's understanding or decision;
- the report header contains a validated Host Agent Audit Overview with one to three same-Audit Evidence references; it gives a first impression of activity and usage shape, does not infer project progress, does not give advice, and does not repeat a Finding's wording or evidence detail;
- fixed threshold summaries and project-type guesses do not occupy the report header; when the Overview is unavailable or invalid, the header retains its place with a neutral unavailable state rather than substituting a deterministic diagnosis;
- every report-level Finding cites same-Audit Evidence, preserves its values and Provenance, distinguishes interpretation from causality, and includes support plus material uncertainty;
- invalid or unavailable report synthesis degrades in the same module to clearly identified Automated Checks without preventing the rest of the report from rendering;
- the standalone HTML shows exactly five localized chapter markers in `01` through `05` order; they organize answer and essential context, diagnosis and supporting Evidence, secondary patterns, Session drill-down, then limitations and methodology, without a `/ 05` denominator or any change to Evidence semantics;
- each of up to three Token-ranked Sessions contains one validated Key Session Analysis generated through the bundled authoritative Prompt or an explicit unavailable state; task context and mechanisms are grounded in that Session's selected Content and Turn Evidence, Findings cite same-Scope Evidence, recommendations include applicability, trade-off, and a user-owned verification method, and analyses fail the acceptance criterion when they differ only by rank, identity, Turn labels, numeric values, or cosmetic paraphrase;
- each Key Session disclosure shows a compact decision signal while collapsed: a recognizable task identity, a concise Session-specific finding or concrete unknown, and a derived “try”, “do not recommend”, or “unavailable” state; the signal uses existing analysis fields and does not add a new recommendation Schema;
- a user can close the Key Session details and, within ten seconds, identify the first experiment for a supported case, the reason an unsupported case has no recommendation, and the phase transition or mechanism for another supported case, using the three existing dogfood tasks;
- facts, Host Agent interpretation, and improvement proposals are visibly distinct; the Key Session module follows the accepted Kami prototype hierarchy, keeps Finding, proposal, and verification in separate roles, shows complete first-user-message tooltips in local full HTML, and proves those fields absent from the sanitized share projection;
- the Session ranking table contains no deterministic “main driver” column; Turn diagnostic candidates remain neutral Evidence until selected and interpreted by the Host Agent;
- invoking `$where-tokens-went` in either supported Host conversation does not expose or stop at the internal CLI step and does not open a preliminary deterministic HTML as the normal result;
- a report request produces both the opened final HTML containing deterministic Evidence, a validated Audit Overview, validated report-level Findings, and validated Key Session Analysis, plus the Host Agent's strongest conversational Finding.
- the first report screen passes the ten-second Aha test: a user can name the largest meaningful usage destination, the supported mechanism or exact unknown, the next action when justified, and the limitation that materially changes the answer without reading charts or methodology;
- user-facing narrative describes the user's task and observed behavior rather than the generation procedure; internal terms, raw Evidence identifiers, schema states, and untranslated status values remain in structured data or methodology details;
- accounting, Coverage, pricing, and other trust limitations do not appear as primary Findings unless they block or materially change the Primary Answer;
- no Finding or recommendation is required to fill a count; insufficient causal or task Evidence produces a specific unknown state while preserving the measured destination and supporting facts.
