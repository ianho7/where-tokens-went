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
                 ├── JSON evidence → Host Agent explanation
                 └── concise text → direct CLI use
```

Only one Reader runs per invocation. There is no source registry scan, background collector, shared database, or cross-Harness aggregation in MVP.

## Runtime choice

Implement the local tool in TypeScript. Start with the Node.js standard library and add dependencies only where the source format requires them. DeepSeek Harness `.jsonl.zstd` requires Zstandard decoding; choose the smallest maintained package that can decode concatenated frames, then verify packed storage rows against the official implementation described in `HARNESS_DATA_SOURCES.md`.

Do not choose a bundler, single-binary packager, MCP transport, or plugin SDK until the CLI demonstrates the Aha moment on all four Readers.

## CLI contract

MVP exposes one command:

```text
agent-audit inspect \
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
  projectCwd: string | null;
  startedAt: string | null;
  endedAt: string | null;
  parentSessionId: string | null;
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

The shared analysis performs three passes:

1. **Contribution** — rank usage by Session, project, model, and time bucket using available reported token fields.
2. **Cause** — evaluate long-session concentration, tool-result amplification, and extra error/retry/subagent calls.
3. **Action** — select the highest-impact cause with sufficient Evidence and attach one specific recommendation.

Tool-result amplification starts as an estimate:

```text
estimated result tokens = UTF-8 text characters / 4
amplified tokens = estimated result tokens × later model calls in the same active context
```

Mark the value `estimated` and retain the method. Pi branches and compaction, Codex compaction, and DSH surface replacement must limit what counts as the same active context when the source makes that boundary available.

Do not introduce a generic rules engine. Three ordinary analysis functions returning candidate Findings are enough.

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
  topFinding: {
    kind: "long_session" | "tool_amplification" | "extra_calls";
    headline: string;
    explanation: string;
    impact: EvidenceValue;
    evidence: EvidenceValue[];
    recommendation: string;
  } | null;
}
```

The Host Agent may rephrase explanations but must preserve values, Provenance, scope, and limitations.

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
3. Produce contribution ranking and one long-session Finding.
4. Add Codex tool pairing and amplification Finding.
5. Add `--all-projects` without changing Harness selection.
6. Repeat the Reader slice for Claude, Pi, and DeepSeek Harness.
7. Add the thinnest native integration for each Harness after its Reader works from the CLI.

Stop the MVP when all four Readers satisfy `MVP.md`. Add MCP, persistent storage, live telemetry, richer reports, or formal evals only after real usage shows which one removes the next bottleneck.

