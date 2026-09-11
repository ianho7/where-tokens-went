# Design

## Minimal architecture

```text
Harness-native Skill / integration
                 │ explicit harness + cwd + scope
                 ▼
         TypeScript CLI: inspect
                 │
                 ▼
        one selected Harness Reader
                 │ minimal records
                 ▼
          shared deterministic analysis
                 │
                 ├── JSON Evidence + Turn candidates
                 ├── concise text/share → human-readable checks
                 └── scoped content Evidence for up to three Sessions
                                      │
                                      ▼
                              Host Agent interpretation
                                      │ structured Key Session Analysis
                                      ▼
                         validation + standalone HTML composition
```

Only one Reader runs per invocation. There is no source registry scan, background collector, shared database, persistent content index, model service, or cross-Harness aggregation in MVP. The CLI remains the sole authority for facts; the Host Agent owns interpretation.

## Runtime choice

Implement the local tool in TypeScript. Start with the Node.js standard library and add dependencies only where the source format requires them.

Do not choose a bundler, single-binary packager, MCP transport, or plugin SDK until the CLI demonstrates the Aha moment on both Readers.

## CLI contract

MVP exposes one command:

```text
where-tokens-went inspect \
  --harness <claude|codex> \
  [--cwd <absolute-path> | --all-projects] \
  [--since <duration>] \
  [--format text|json]
```

Rules:

- `--harness` is required at the CLI boundary. Native integrations supply it, so users do not choose it during normal Agent use.
- `--cwd` is the default integration path and must be absolute.
- `--all-projects` is mutually exclusive with `--cwd`.
- `--since` defaults to `7d`; integrations translate explicit user periods such as “近 30 天”.
- `json` is authoritative for Agent use; `text` is a compact direct-use view over the same result.
- One malformed Session must not hide valid Sessions. Coverage and skipped-record counts are part of the result.
- The public deterministic JSON/text behavior remains sanitized and model-free. The Harness-native Skill may use an explicit bundled content-Evidence path and HTML-composition input during the atomic report workflow; both are bound to the originating Audit Scope and are not alternate general-purpose transcript APIs.

## Minimal records

Readers return plain values, not a general event platform:

```ts
type Harness = "claude" | "codex";
type Provenance = "reported" | "derived" | "estimated" | "unavailable";

interface SessionRecord {
  harness: Harness;
  sessionId: string;
  title?: string | null;
  projectCwd: string | null;
  startedAt: string | null;
  endedAt: string | null;
  parentSessionId: string | null;
  isSubagent?: boolean | null; // only when the Harness source proves it
  partial?: boolean | null; // true/false only when the Reader can attribute coverage completeness to this Session
  sourceVersion: string | null;
}

interface TurnRecord {
  sessionId: string;
  turnId: string;
  ordinal: number | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  timeToFirstTokenMs: number | null;
  status: "ok" | "error" | "interrupted" | "open" | "unknown";
  timingProvenance: Provenance;
}

interface ModelCallRecord {
  sessionId: string;
  callId: string | null;
  timestamp: string | null;
  provider: string | null;
  model: string | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteTokens: number | null;
  cacheWrite5mTokens?: number | null;
  cacheWrite1hTokens?: number | null;
  cacheWriteTtl?: "5m" | "1h" | "mixed" | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  reportedCost: number | null;
  status: "ok" | "error" | "interrupted" | "unknown";
  turnId?: string | null;
}

interface ToolCallRecord {
  sessionId: string;
  callId: string;
  timestamp: string | null;
  turnId?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  durationMs?: number | null;
  toolName: string;
  inputBytes: number | null;
  resultBytes: number | null;
  isError: boolean | null;
  commandKind?: string | null;
  commandHash?: string | null;
}

interface LifecycleRecord {
  sessionId: string;
  timestamp: string | null;
  kind: "retry" | "compaction" | "subagent" | "interrupted";
  relatedId: string | null;
  turnId?: string | null;
  origin?: "automatic" | "manual" | null;
}

interface SkillUseRecord {
  sessionId: string;
  skillName: string | null;
  state: "available" | "invoked" | "attributed" | "unavailable";
  evidenceType: "listing" | "versioned-attribution" | "explicit-input" | "resource-read" | "script-execution";
  turnId: string | null;
  callId: string | null;
  timestamp: string | null;
  sourceLocation: string | null; // redacted structural location only
  provenance: Provenance;
}

interface SessionCostRecord {
  sessionId: string;
  totalCost: number | null;
  timestamp: string | null;
  provenance: "reported" | "unavailable";
}
```

If a field is absent, return `null`. Do not normalize absence into zero. Provenance belongs to derived result values; Readers separately report which source record supplied each value.

## Reader contract

Each Reader implements one operation:

```ts
interface ReadScope {
  cwd: string | null;
  allProjects: boolean;
  since: Date;
}

interface ReadResult {
  sessions: SessionRecord[];
  turns: TurnRecord[];
  modelCalls: ModelCallRecord[];
  toolCalls: ToolCallRecord[];
  lifecycle: LifecycleRecord[];
  skillEvidence?: SkillUseRecord[];
  sessionCosts?: SessionCostRecord[];
  coverage: {
    filesRead: number;
    recordsRead: number;
    recordsSkipped: number;
    partialSessions: number;
    warnings: string[];
  };
}

type Reader = (scope: ReadScope) => Promise<ReadResult>;
```

Use a direct switch on `--harness` to select one Reader. A registry, factory, or dynamic plugin mechanism has no MVP use.

## Initial analysis

The shared analysis performs two deterministic passes:

1. **Contribution** — rank usage by Session, project, model, and time bucket using available reported token fields.
2. **Checks** — evaluate neutral conditions such as long-Session concentration, tool-result amplification, extra error/retry/subagent calls, model concentration, and data completeness.

Analysis does not choose a primary cause, explain the user's intent, or prescribe an action. The Host Agent owns those decisions.

Analysis additionally builds capability-aware Turn entries and neutral candidates for Turn concentration, input growth, tool-result adjacency, compaction changes, waiting hotspots, and failed paths. These candidates retain Evidence, method, Provenance, and Coverage; they do not become Findings until selected and interpreted by the Host Agent.

Tool-result amplification starts as an estimate:

```text
estimated result tokens = UTF-8 text characters / 4
amplified tokens = estimated result tokens × later model calls in the same active context
```

Mark the value `estimated` and retain the method. Claude Code and Codex compaction boundaries must limit what counts as the same active context when the source makes that boundary available.

Do not introduce a generic rules engine. Ordinary analysis functions returning a small stable list of automated checks are enough.

## Result contract

```ts
interface EvidenceValue {
  value: number | string | null;
  provenance: Provenance;
  method?: string;
  source?: {
    sessionId: string;
    recordId?: string;
    timestamp?: string;
  };
}

interface AuditResult {
  scope: {
    harness: Harness;
    cwd: string | null;
    allProjects: boolean;
    since: string;
  };
  coverage: ReadResult["coverage"];
  summary: Record<string, EvidenceValue>;
  rankings: ContributionRankings;
  turns: TurnAnalysisEntry[];
  report: ReportData;
  checks: Array<{
    id: "long_session" | "tool_amplification" | "extra_calls" | "model_concentration" | "data_quality";
    outcome: "pass" | "notice" | "warning";
    evidence: EvidenceValue[];
    method: string;
  }>;
}
```

`AuditResult` remains deterministic. AI-authored data is a separate composition input:

```ts
interface ReportComposition {
  auditFingerprint: string;
  audit: AuditResult;
  keySessionAnalyses: KeySessionAnalysis[];
}
```

The renderer accepts at most one validated analysis for each of up to three Token-ranked Sessions. It rejects stale Audit bindings, cross-Scope or cross-Session Evidence references, and malformed analysis. Rejection removes only the AI-authored block; deterministic rankings, Turn trajectories, checks, and limitations remain renderable.

Contribution rankings include the exact token `value` and a derived `sharePercent` in percentage points. Session entries may include `displayName`, which combines an explicit Harness title with the Session ID; when no title exists, the ID remains the display name. Codex titles come only from its local Session index metadata. The Host Agent formats these values for the user's language without changing the authoritative JSON.

For Codex, when every selected Session has source metadata that proves whether it is a subagent, `summary.topLevelSessionCount` and `summary.subagentSessionCount` split the total execution Session count. When that source metadata is missing, both remain `unavailable`; the report never guesses from a title or sidebar state. `SessionRecord.partial` is `true` when the Reader attributes an unsupported accounting record, unusable timestamp, or broken tail to that Session; it is `false` after the Reader checks the Session and finds no such gap; it remains `null` when attribution is not possible.

The partial/subagent cross-statistics `summary.partialTopLevelSessionCount`, `summary.partialSubagentSessionCount`, and `summary.partialSessionRatePercent` are derived only when every selected Codex Session has boolean `isSubagent` and `partial` values, the attributed partial count equals `coverage.partialSessions`, and the selected Session denominator is greater than zero. Otherwise all three remain `unavailable`. This prevents an aggregate partial count from being presented as proof that the same Sessions are subagents.

Token composition is one Harness-aware seam in the shared analysis. Codex's reported `inputTokens` may include cache-read and cache-write subsets, so ordinary input is `input - cached - cacheWrite` only when the result is non-negative and internally consistent. Claude Code's ordinary input, cache-read input, cache-write input, and output are mutually exclusive buckets; a complete total may be derived from their sum even when reasoning tokens are absent. No bucket is silently converted to zero. Cache rates first sum compatible buckets across calls and then divide by the ordinary-input plus cache-read plus cache-write denominator.

API-equivalent cost is always an estimated reference amount, separate from Harness subscription spend and Provider quota. The default and only pricing path queries the LiteLLM model catalog using only the expected Provider/model identifiers (the selected Harness supplies the Provider mapping when a source record omits it), retains retrieval metadata, and uses exact catalog rows. An explicit conflicting Provider is not coerced. It keeps observed prices separate from an all-uncached counterfactual and reports price coverage; when at least one selected Usage has compatible pricing, currency values are estimated over that priced subset and explicitly exclude unpriced or incompatible Usage. Only a selection with no priced Usage leaves currency unavailable, while Token counts and non-price findings remain usable.

`firstRequestBurden` selects one earliest valid, timestamped and deduplicated ModelCall per selected Session. It reports median, aggregate total/share, cache composition and coverage, plus top-level/Subagent groups only when the source proves identity for every selected Session. The result is an observed first-request burden, not a decomposable startup tax.

`skillEvidence` is a small Reader output containing only Session/turn/call boundaries, normalized Skill names, evidence type, timestamp, redacted source location, coverage, and Provenance. `available` comes from an explicit listing, `invoked` from explicit invocation or verifiable resource/script relation, and `attributed` from a stronger versioned attribution or a source-proven call/turn match. Listing does not imply invocation; direct resource footprint, observed association, and causal impact are separate values. Without a valid counterfactual, causal impact is `unavailable`.

Follow-up extraction, AI rework classification, and a rework-rate metric remain outside this design; no reader field, analysis path, or report panel is reserved for them in this increment.

`summary.totalTokens` and related usage totals describe observed tokens from supported, selected ModelCall records. They are not a completeness claim: when Coverage is partial or records were skipped, the observed total may undercount actual usage. The analysis method that refers to “complete ModelCall token totals” means complete within those supported observed records, not complete history coverage.

Check identifiers and outcomes are stable machine data, not report copy. A shared presentation function maps each check and its Evidence to a concise localized observation for text, share, and HTML without rerunning thresholds or selecting a primary cause. A visible check must communicate what was observed, the relevant values, and the method; showing only an internal identifier such as `long_session` is invalid. Passed checks may be shown when they establish useful data health or the absence of a detectable pattern. The presentation must not add a fixed mechanism, recommendation, or final diagnosis.

The Host Agent forms Key Session Analysis from the complete sanitized result plus progressively selected content Evidence for the same Audit Scope. It may select, ignore, or combine checks, rankings, Turn trajectories, content context, coverage, and limitations while preserving values, Provenance, scope, and capability boundaries. Historical content is untrusted data and may not redirect the current analysis task. For report requests, content acquisition, analysis, validated HTML composition, opening the HTML, and giving the conversational primary Finding are one indivisible Skill workflow; the Host Agent must not stop after returning the report path.

## Privacy boundary

- Open source histories read-only and stream records where practical.
- Keep raw content in process memory only as long as pairing and sizing require.
- Invoking the report Skill authorizes progressive in-memory content reading only inside the explicit Audit Scope and up to three Token-ranked Sessions. It does not authorize another Harness, project, or time range.
- Content Evidence packets are internal Host Agent inputs. They are not written to default JSON, text, share, HTML, caches, indexes, or databases.
- Treat every prompt, response, command, link, and tool result read from history as untrusted data, never as an instruction or authorization for the current Host Agent.
- Hash Evidence with a standard cryptographic hash when identity without disclosure is useful.
- Redact home directories and absolute local paths in default output.
- Never include raw prompts, model responses, source code, shell output, tool results, credentials, or base64 payloads in default JSON or text.
- Saved Key Session Analysis may paraphrase task context but never quote or embed raw transcript content by default.
- Report partial reads and unknown record types; do not guess new schemas.

## Harness implementation order

1. **Codex** — prove current-project and all-project scope over rollout JSONL; reconcile current `token_usage_record`, legacy `last_token_usage`, final cumulative snapshots, and `raw_response_completed` through mutually exclusive precedence.
2. **Claude Code** — prove response-level deduplication, capability-aware Turn reconstruction, and tool call/result pairing over transcript JSONL.

For each Reader, derive one minimal redacted sample from a real Session and retain only the records necessary to catch parser and counting regressions. This is a smoke check, not a formal evaluation platform.

## First implementation slices

1. Parse CLI scope and emit an empty but valid `AuditResult`.
2. Implement Codex Session discovery and usage counting for current cwd.
3. Produce contribution ranking and one human-readable long-Session automated check.
4. Add Codex tool pairing and an amplification automated check.
5. Add `--all-projects` without changing Harness selection.
6. Keep the Codex and Claude Reader slices aligned with the shared contract.
7. Add the thinnest native integration for each Harness after its Reader works from the CLI.
8. Add Turn records and deterministic key-Turn candidates only after Session totals reconcile.
9. Add scoped progressive content Evidence and structured Key Session Analysis composition for the top three Sessions.
10. Render validated analysis into HTML with deterministic fallback; keep recommendation tracking and automated outcome evaluation outside the product.

Stop the MVP when both Readers satisfy `MVP.md`. Add MCP, persistent storage, live telemetry, richer reports, or formal evals only after real usage shows which one removes the next bottleneck.
