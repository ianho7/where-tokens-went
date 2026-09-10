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
                 ├── JSON evidence + checks → Host Agent Finding
                 ├── concise text/share → human-readable checks
                 └── standalone HTML → human-readable checks + report data
```

Only one Reader runs per invocation. There is no source registry scan, background collector, shared database, or cross-Harness aggregation in MVP.

## Runtime choice

Implement the local tool in TypeScript. Start with the Node.js standard library and add dependencies only where the source format requires them. DeepSeek Harness `.jsonl.zstd` requires Zstandard decoding; choose the smallest maintained package that can decode concatenated frames, then verify packed storage rows against the official implementation described in `HARNESS_DATA_SOURCES.md`.

Do not choose a bundler, single-binary packager, MCP transport, or plugin SDK until the CLI demonstrates the Aha moment on all four Readers.

## CLI contract

MVP exposes one command:

```text
where-tokens-went inspect \
  --harness <claude|codex|pi|deepseek> \
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

## Minimal records

Readers return plain values, not a general event platform:

```ts
type Harness = "claude" | "codex" | "pi" | "deepseek";
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

interface ModelCallRecord {
  sessionId: string;
  callId: string | null;
  timestamp: string | null;
  provider: string | null;
  model: string | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  reportedCost: number | null;
  status: "ok" | "error" | "interrupted" | "unknown";
}

interface ToolCallRecord {
  sessionId: string;
  callId: string;
  timestamp: string | null;
  toolName: string;
  inputBytes: number | null;
  resultBytes: number | null;
  isError: boolean | null;
}

interface LifecycleRecord {
  sessionId: string;
  timestamp: string | null;
  kind: "retry" | "compaction" | "subagent" | "interrupted";
  relatedId: string | null;
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
  modelCalls: ModelCallRecord[];
  toolCalls: ToolCallRecord[];
  lifecycle: LifecycleRecord[];
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

Tool-result amplification starts as an estimate:

```text
estimated result tokens = UTF-8 text characters / 4
amplified tokens = estimated result tokens × later model calls in the same active context
```

Mark the value `estimated` and retain the method. Pi branches and compaction, Codex compaction, and DSH surface replacement must limit what counts as the same active context when the source makes that boundary available.

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
  report: ReportData;
  checks: Array<{
    id: "long_session" | "tool_amplification" | "extra_calls" | "model_concentration" | "data_quality";
    outcome: "pass" | "notice" | "warning";
    evidence: EvidenceValue[];
    method: string;
  }>;
}
```

Contribution rankings include the exact token `value` and a derived `sharePercent` in percentage points. Session entries may include `displayName`, which combines an explicit Harness title with the Session ID; when no title exists, the ID remains the display name. Codex titles come only from its local Session index metadata. The Host Agent formats these values for the user's language without changing the authoritative JSON.

For Codex, when every selected Session has source metadata that proves whether it is a subagent, `summary.topLevelSessionCount` and `summary.subagentSessionCount` split the total execution Session count. When that source metadata is missing, both remain `unavailable`; the report never guesses from a title or sidebar state. `SessionRecord.partial` is `true` when the Reader attributes an unsupported accounting record, unusable timestamp, or broken tail to that Session; it is `false` after the Reader checks the Session and finds no such gap; it remains `null` when attribution is not possible.

The partial/subagent cross-statistics `summary.partialTopLevelSessionCount`, `summary.partialSubagentSessionCount`, and `summary.partialSessionRatePercent` are derived only when every selected Codex Session has boolean `isSubagent` and `partial` values, the attributed partial count equals `coverage.partialSessions`, and the selected Session denominator is greater than zero. Otherwise all three remain `unavailable`. This prevents an aggregate partial count from being presented as proof that the same Sessions are subagents.

`summary.totalTokens` and related usage totals describe observed tokens from supported, selected ModelCall records. They are not a completeness claim: when Coverage is partial or records were skipped, the observed total may undercount actual usage. The analysis method that refers to “complete ModelCall token totals” means complete within those supported observed records, not complete history coverage.

Check identifiers and outcomes are stable machine data, not report copy. A shared presentation function maps each check and its Evidence to a concise localized observation for text, share, and HTML without rerunning thresholds or selecting a primary cause. A visible check must communicate what was observed, the relevant values, and the method; showing only an internal identifier such as `long_session` is invalid. Passed checks may be shown when they establish useful data health or the absence of a detectable pattern. The presentation must not add a fixed mechanism, recommendation, or final diagnosis.

The Host Agent forms the Finding from the complete sanitized result. It may select, ignore, or combine checks, rankings, trends, coverage, and limitations while preserving values, Provenance, scope, and capability boundaries. For report requests, generating and opening HTML plus giving this conversational diagnosis is one indivisible Skill workflow; the Host Agent must not stop after returning the report path.

## Privacy boundary

- Open source histories read-only and stream records where practical.
- Keep raw content in process memory only as long as pairing and sizing require.
- Hash Evidence with a standard cryptographic hash when identity without disclosure is useful.
- Redact home directories and absolute local paths in default output.
- Never include raw prompts, model responses, source code, shell output, tool results, credentials, or base64 payloads in default JSON or text.
- Report partial reads and unknown record types; do not guess new schemas.

## Harness implementation order

1. **Codex** — prove current-project and all-project scope over rollout JSONL, using `raw_response_completed` or non-cumulative usage correctly.
2. **Claude Code** — prove response-level deduplication and tool call/result pairing over transcript JSONL.
3. **Pi** — add active-branch and compaction-aware accounting; preserve reported cost separately.
4. **DeepSeek Harness** — decode the observed `.jsonl.zstd` backend and packed rows; SQLite remains out of scope.

For each Reader, derive one minimal redacted sample from a real Session and retain only the records necessary to catch parser and counting regressions. This is a smoke check, not a formal evaluation platform.

## First implementation slices

1. Parse CLI scope and emit an empty but valid `AuditResult`.
2. Implement Codex Session discovery and usage counting for current cwd.
3. Produce contribution ranking and one human-readable long-Session automated check.
4. Add Codex tool pairing and an amplification automated check.
5. Add `--all-projects` without changing Harness selection.
6. Repeat the Reader slice for Claude, Pi, and DeepSeek Harness.
7. Add the thinnest native integration for each Harness after its Reader works from the CLI.

Stop the MVP when all four Readers satisfy `MVP.md`. Add MCP, persistent storage, live telemetry, richer reports, or formal evals only after real usage shows which one removes the next bottleneck.
