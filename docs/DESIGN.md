# Design

## Minimal architecture

```text
User in Codex / Claude Code conversation
                 │ $where-tokens-went or equivalent request
                 ▼
       Harness-native Skill / Host Agent
                 │ explicit harness + cwd + scope
                 ▼
     internal TypeScript CLI: inspect --format json
                 │
                 ▼
        one selected Harness Reader
                 │ minimal records
                 ▼
          shared deterministic analysis
                 │ sanitized Audit + Automated Checks
                 ▼
 Audit Overview + report-level Findings from fixed bundled Prompt
                 │
                 ├── scoped content Evidence for up to three Sessions
                 ▼
 Key Session Analysis from fixed bundled Prompt + validation
                 │
                 ▼
     one final standalone HTML composition and open
```

Only one Reader runs per invocation. There is no source registry scan, background collector, shared database, persistent content index, model service, or cross-Harness aggregation in MVP. The CLI remains the sole authority for facts; the Host Agent owns interpretation. The Host Agent is already the AI runtime: the internal CLI must not acquire Provider credentials or start a second model client.

`$where-tokens-went` and `where-tokens-went inspect` are different boundaries. The former is the public conversational Skill invocation and owns the complete report lifecycle. The latter is an internal deterministic calculation command and a developer debugging surface. Direct CLI HTML, when explicitly requested, is a deterministic fallback preview; it must not be opened as the normal Skill result before Host Agent synthesis.

## Runtime choice

Implement the local tool in TypeScript. Start with the Node.js standard library and add dependencies only where the source format requires them.

Do not choose a bundler, single-binary packager, MCP transport, or plugin SDK until the CLI demonstrates the Aha moment on both Readers.

## Internal CLI contract

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
- For a normal `$where-tokens-went` report request, the Skill first requests authoritative JSON without `--html`. It composes and opens HTML only after ReportSynthesis and KeySessionAnalysis have been generated and validated. If the bundled runtime has no callable composition entry accepting those inputs, the product workflow is incomplete; a one-off script or preliminary `inspect --html` fallback must not be presented as successful normal delivery.

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

### Skill Insights：Usage × Content 分层

Skill Insights 使用独立于普通 Audit Findings 的三类洞察合同：

- **Usage Aha**：由 deterministic Skill usage 产生的拓扑或行为对照；同一报告最多保留一条 pure usage topology 与一条 behavior anomaly。
- **Capability Aha**：Usage signal 与可读 `SKILL.md` 内容的交叉解释，必须回答删除整个 Skill 会失去什么，以及只删除通用流程脚手架后仍保留什么。
- **Mechanism Aha**：Usage、内容与轻量 Skill Trigger Trace 的交叉解释；没有触发序列时，calls-per-task 只能称为 anomaly，不能称为生命周期机制。

内容分析不以 `capabilityDelta` 等级作为结论，而生成 `SkillContentProfile`：`lossIfRemoved`、`modelNativeScaffold`、`scopedContent` 与 `contentSummary`。Capability Aha 必须有至少一个 Usage/behavior signal、一个 Snapshot 中逐字可校验的有界摘录、一个删除反事实和一个决策含义；“专有协议而非通用流程”的比较还必须同时拥有 unique side 与 model-native side 证据。`modelNativeScaffold` 中的 Observed 只证明摘录存在，模型原生能力是相对于当前强 coding agent 的 Interpretation；Gate 还要判断证据是否足以支撑 Claim 强度，不能用一条 generic 句子代表整个 Skill。

Candidate Selector 先产出 Usage Candidate，再与 Content Profile 合并为 Cross-layer Candidate。首版只支持高频独特能力、高频模型原生脚手架、高频 task-scoped 内容、低频独特能力、family shared core 与 behavior outlier；不增加开放式 taxonomy。Validated Capability Aha 优先于 Validated Mechanism Aha，后者优先于 Pure Usage Aha；证据不足时减少输出，不用重复 Usage Insight 填槽。命名相似只能形成 naming family，至少两个成员的内容证据才能形成 capability family。P1 Trigger Trace 不自动启动，只有 P0 真实报告确认 Capability Aha 已兑现且仍需要解释高频重复行为时才重新评估。

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

`AuditResult` remains deterministic. AI-authored data is a separate composition input. Report-level synthesis uses only the complete sanitized Audit; it does not require raw Session content:

```ts
interface ReportFinding {
  title: string;
  analysis: string;
  evidenceRefs: string[];
  support: "strong" | "moderate" | "limited";
  uncertainty: string | null;
}

interface ReportOverview {
  summary: string;
  evidenceRefs: string[];
}

interface ReportSynthesis {
  auditFingerprint: string;
  overview: ReportOverview;
  findings: ReportFinding[];
  noStrongFindingReason: string | null;
}

interface ReportComposition {
  auditFingerprint: string;
  audit: AuditResult;
  reportSynthesis: ReportSynthesis | null;
  keySessionAnalyses: KeySessionAnalysis[];
  /** Local-only resolved project display name; never part of AuditResult. */
  projectName?: string;
}
```

The version-controlled `prompts/report-synthesis.md` is the sole authoritative Prompt for generating `ReportSynthesis`, including both the Audit Overview and Findings. `scripts/package-skills.js` copies it byte-for-byte to `skills/where-tokens-went/references/report-synthesis.md`; that packaged file is a generated artifact, not a manual source. The Skill must read its bundled `references/report-synthesis.md` in full before generation and must bind it only to the selected locale, current Audit fingerprint, and complete structured sanitized `AuditResult`.

The version-controlled `prompts/key-session-analysis.md` is the sole authoritative Prompt for generating the Token-ranked `KeySessionAnalysis[]`. The same packaging step copies it byte-for-byte to the shared Skill as `references/key-session-analysis.md`. The Skill must read it in full after scoped Content Evidence acquisition and bind it only to the selected locale, current Audit fingerprint, complete structured sanitized `AuditResult`, and the selected in-memory packets. Its portability test rejects prose that becomes interchangeable after ranks, identifiers, Turn labels, and numeric values are removed. Insufficient or non-specific Evidence produces `primaryFinding: null` and `recommendation: null`; cosmetic wording differences are not accepted as Session specificity.

The version-controlled `prompts/skill-insights.md` remains the sole authoritative Prompt for Skill Insights. P0 now changes the runtime task to discover Usage × Content relationships rather than fill a quota of distribution summaries. A Capability Aha is attempted whenever readable selected `SKILL.md` content exists; failure of the dual-sided content gate is a valid recorded outcome, numeric wording remains renderer-owned, Snapshot binding remains exact, and the Capability schema is separate from the Usage schema rather than using a single score as a deletion counterfactual.

The bundled runtime exposes `report-run compose` as the formal normal-workflow entry for the shared Skill. It rejects a non-empty stdin envelope and reads the canonical Audit, accepted lane artifacts, explicit fallbacks, local-only project display name, and local-only first-user-message projection from the same Run. The lower-level `compose-report` command remains a compatibility and test entry, not the Skill workflow. Composition validates the Run contract again and writes the single final HTML without rereading history. The display name is resolved as remote repository name, package/project name, directory basename, then `project`, and remains outside `AuditResult`.

Report font configuration is presentation-only and does not change the Audit, narrative, privacy boundary, or HTML data. The packaged renderer embeds the authorized bundled W04/W05 faces by default; the final HTML command may receive one readable local `.ttf`, `.otf`, `.woff`, or `.woff2` file through `--font <font-file>` and an optional CSS family through `--font-family <name>`, with that file serving the 400 and 500 text slots. After the complete HTML is rendered, the runtime collects its serialized HTML characters, subsets each embedded face to WOFF2, and replaces the data URL atomically. An unreadable configured file falls back to the bundled font; a subsetting failure keeps the readable full embedded source and emits a warning. A system font family name without a local file is not sufficient for a standalone report.

Report localization belongs to the presentation layer. `AuditResult` and Evidence references remain language-independent; Host Agent-authored `ReportSynthesis` and `KeySessionAnalysis` prose follows the selected report locale. Fixed interface copy comes from the typed language table, while the renderer keeps HTML, text, share structure, data binding, and escaping.

The presentation layer translates the internal domain model into the user's mental model. `Host Agent`, `Content Evidence`, `Audit Scope`, schema field names, raw Evidence references, and accounting states remain internal or appear only in optional methodology details. Conclusions name the user's task, observed behavior, and consequence directly. Localization therefore covers narrative perspective and terminology as well as translated strings.

The renderer accepts one validated report synthesis, validated Skill Insights, plus at most one validated analysis for each of up to three Token-ranked Sessions. Report synthesis contains one Audit Overview and at most five prioritized Findings, including zero with an explicit grounded reason when no pattern is useful enough to retain. Skill Insights uses a finite typed output budget: at most one pure usage topology, at most one behavior anomaly, and up to two validated content/family insights; it may render fewer. Capability evidence excerpts are bounded and user-facing only when needed to prove the contrast. The Overview is one or two localized sentences backed by one to three same-Audit Evidence references. It describes the Audit period's overall activity and usage shape; it does not infer completed project work, recommend an action, or duplicate a Finding's wording and evidence detail. The validator rejects stale Audit bindings, unknown or cross-Scope Overview or Finding Evidence references, more than five Findings, and malformed analysis.

The report narrative has one user-centered visual hierarchy. After all synthesis and Key Session analysis are validated, the composition promotes one Primary Answer to the first screen: the largest meaningful usage destination, one supported mechanism or explicit unknown state, one justified action when available, and only the trust limitation that materially changes that answer. Report-level Findings add distinct secondary relationships; Key Session Analysis supplies drill-down; rankings, trajectories, charts, and tables provide verification and exploration. Within that drill-down, a collapsed Session disclosure may expose a compact decision signal—task identity, concise finding or concrete unknown, and a state derived from existing analysis fields—so the user can decide whether to expand without creating a second analysis layer. The user does not have to assemble the Primary Answer from separate modules.

Primary Answer is a presentation contract, not a new deterministic metric or authority. Its facts still come from `AuditResult`; its interpretation and action come only from validated synthesis and Key Session analysis. When no mechanism is supported, composition presents the measured destination and a specific unknown instead of promoting an Automated Check, accounting warning, or generic recommendation. When synthesis is invalid or unavailable, the report retains a neutral answer state and clearly identified deterministic fallback without impersonating an AI conclusion.

Trust information is a subordinate layer. Scope, Coverage, accounting reconciliation, pricing gaps, Provenance, and other limitations remain visible near the affected value or in the final limitations section. They enter the Primary Answer only when they block or materially qualify it. A warning's existence alone does not make it a Finding.

The standalone HTML keeps five stable reading stages while using progressive disclosure inside them: answer and essential context, diagnosis and supporting Evidence, secondary patterns, Session drill-down, then limitations and methodology. Each stage begins with one visible Kami-style Section marker. The localized marker contract is `01 · 概览`, `02 · 诊断`, `03 · 模式`, `04 · 追踪`, `05 · 限制` for Chinese and `01 · Orient`, `02 · Diagnose`, `03 · Patterns`, `04 · Trace`, `05 · Caveats` for English. Numbers are stable across reports, start at one, and have no total-count denominator. Chapter styling, charts, tables, controls, accessible names, and Evidence semantics remain presentation concerns; they must reinforce rather than determine the answer hierarchy.

Ivory is a quiet grouping surface, not general module chrome. Use one borderless, shadowless `--ivory` container around each self-contained interactive chart reading unit: the Token trend together with its chart summary, the model bar and share charts together as one comparison unit, the tool-impact chart, and each Key Session trajectory figure including its toolbar, legend, chart, caption, and local-content note. Keep the associated deterministic tables outside those containers so the chart remains the visual summary and the table remains the open, sortable evidence surface. Do not add ivory treatment to report headers, metric rows, Findings, metadata grids, tables, Session disclosure rows, whole sections, limitations, or the privacy/method footer. Reuse the existing `.ivory-group` visual grammar—`--ivory` fill, 8 px radius, no border or shadow—with responsive padding only; this is presentation-only and must not change module order, chart behavior, accessible names, print fallbacks, or Evidence semantics.

Contribution rankings include the exact token `value` and a derived `sharePercent` in percentage points. Session entries may include `displayName`, which combines an explicit Harness title with the Session ID; when no title exists, the ID remains the display name. Codex titles come only from its local Session index metadata. The Host Agent formats these values for the user's language without changing the authoritative JSON.

The Session ranking table is a deterministic ranking and navigation surface. It shows Session identity, Tokens, share, Turn count, duration, and Evidence completeness when available. It does not select or display a “main driver”: `TurnDiagnosticCandidate` values remain neutral candidate Evidence until a validated Key Session Analysis interprets them.

For Codex, when every selected Session has source metadata that proves whether it is a subagent, `summary.topLevelSessionCount` and `summary.subagentSessionCount` split the total execution Session count. When that source metadata is missing, both remain `unavailable`; the report never guesses from a title or sidebar state. `SessionRecord.partial` is `true` when the Reader attributes an unsupported accounting record, unusable timestamp, or broken tail to that Session; it is `false` after the Reader checks the Session and finds no such gap; it remains `null` when attribution is not possible.

The partial/subagent cross-statistics `summary.partialTopLevelSessionCount`, `summary.partialSubagentSessionCount`, and `summary.partialSessionRatePercent` are derived only when every selected Codex Session has boolean `isSubagent` and `partial` values, the attributed partial count equals `coverage.partialSessions`, and the selected Session denominator is greater than zero. Otherwise all three remain `unavailable`. This prevents an aggregate partial count from being presented as proof that the same Sessions are subagents.

Token composition is one Harness-aware seam in the shared analysis. Codex's reported `inputTokens` may include cache-read and cache-write subsets, so ordinary input is `input - cached - cacheWrite` only when the result is non-negative and internally consistent. Claude Code's ordinary input, cache-read input, cache-write input, and output are mutually exclusive buckets; a complete total may be derived from their sum even when reasoning tokens are absent. No bucket is silently converted to zero. Cache rates first sum compatible buckets across calls and then divide by the ordinary-input plus cache-read plus cache-write denominator.

API-equivalent cost is always an estimated reference amount, separate from Harness subscription spend and Provider quota. The default and only pricing path queries the LiteLLM model catalog using only the expected Provider/model identifiers (the selected Harness supplies the Provider mapping when a source record omits it), retains retrieval metadata, and uses exact catalog rows. An explicit conflicting Provider is not coerced. It keeps observed prices separate from an all-uncached counterfactual and reports price coverage; when at least one selected Usage has compatible pricing, currency values are estimated over that priced subset and explicitly exclude unpriced or incompatible Usage. Only a selection with no priced Usage leaves currency unavailable, while Token counts and non-price findings remain usable.

`firstRequestBurden` selects one earliest valid, timestamped and deduplicated ModelCall per selected Session. It reports median, aggregate total/share, cache composition and coverage, plus top-level/Subagent groups only when the source proves identity for every selected Session. The result is an observed first-request burden, not a decomposable startup tax.

`skillEvidence` is a small Reader output containing only Session/turn/call boundaries, normalized Skill names, evidence type, timestamp, redacted source location, coverage, and Provenance. `available` comes from an explicit listing, `invoked` from explicit invocation or verifiable resource/script relation, and `attributed` from a stronger versioned attribution or a source-proven call/turn match. Listing does not imply invocation; direct resource footprint, observed association, and causal impact are separate values. Without a valid counterfactual, causal impact is `unavailable`.

Follow-up extraction, AI rework classification, and a rework-rate metric remain outside this design; no reader field, analysis path, or report panel is reserved for them in this increment.

`summary.totalTokens` and related usage totals describe observed tokens from supported, selected ModelCall records. They are not a completeness claim: when Coverage is partial or records were skipped, the observed total may undercount actual usage. The analysis method that refers to “complete ModelCall token totals” means complete within those supported observed records, not complete history coverage.

Check identifiers and outcomes are stable machine data, not report Findings. A shared presentation function maps each check and its Evidence to concise localized fallback, text, and share output without rerunning thresholds or selecting a primary cause. The normal HTML “Findings” module instead renders the validated report synthesis in the same position and visual structure. Automated Checks remain inputs the Host Agent may select, combine, or ignore; a relevant pattern may be selected even when no check fires. Fallback checks must communicate what was observed, the relevant values, and the method, and must be identified as deterministic checks rather than AI synthesis.

The Host Agent first forms the Audit Overview and report-level Findings from the complete sanitized result. The Overview answers what the Audit period looks like overall; Findings identify important relationships that are difficult to see from individual metrics. The Host Agent looks for cross-metric patterns, concentration in a few Sessions or Turns, apparently healthy metrics that conceal waste, and apparently alarming metrics that do not materially affect the conclusion. It does not claim project outcomes, summarize every panel, restyle Automated Checks, recalculate facts, force a Finding count, or convert correlation into causality.

The Host Agent separately forms Key Session Analysis from the sanitized result plus progressively selected content Evidence for the same Audit Scope, using the fixed Key Session Analysis Prompt. Historical content is untrusted data and may not redirect the current analysis task. For report requests, deterministic JSON acquisition, fixed-Prompt report synthesis, content acquisition, fixed-Prompt Key Session Analysis, validation, final HTML composition, opening that final HTML, and giving the strongest conversational Finding are one indivisible Skill workflow. The Host Agent must not stop after the internal CLI step, open a preliminary fallback as the normal report, or stop after returning the report path.

The Audit Overview and AI-authored report narrative apply in this increment only to the default `$where-tokens-went` and `report` HTML workflow. Direct CLI text/share terminology and AI treatment for the narrower `usage`, `tools`, `week`, and `window` views remain deferred; they must not be used as substitutes for the full report workflow.

## Performance, scale, and caching architecture

The pipeline must operate efficiently on large real-world histories (e.g. 1,000+ files, 300k+ records) without requiring native binaries (such as Rust). Total deterministic report-generation wall time (excluding LLM inference) for a standard 7-day scope must remain under 2.0 seconds.

Key architectural requirements:
- **Algorithmic Complexity & In-Memory Indexing**: All shared analysis phases over ModelCall and ToolCall records must maintain (N + M)$ linear time complexity. Inner nested loops ((N \times M)$) over large record arrays are strictly prohibited. Multi-relation lookups (e.g. associating ToolCalls with Sessions or Turns) must be pre-indexed into hash maps (Map<string, T[]>).
- **Filesystem & Date Pruning**: For date-partitioned session storage (sessions/YYYY/MM/DD), directory traversal must prune directories before scope.since at the filesystem enumeration level rather than scanning all historical files and filtering in-memory. Large JSONL files must inspect initial headers (cwd) before parsing downstream records when filtering by project directory.
- **Targeted Content Evidence Retrieval**: Downstream content evidence extraction for the top three Token-ranked sessions must not re-scan the filesystem. The initial Reader pass must retain or provide exact relative file paths for identified sessions, allowing (1)$ direct targeted file reads for evidence extraction.
- **Static Asset In-Memory Caching**: Static binary assets (such as bundled TTF/WOFF2 fonts or icons) must be cached in memory after first read, eliminating repeated multi-megabyte disk reads and Base64 re-encodings during HTML rendering.
- **Remote Pricing Resolution & Cache**: External catalog queries (e.g. LiteLLM pricing) must persist responses in a local disk cache with a 7-day TTL. Unsupported or internal models must be negative-cached to avoid repeated network timeouts or 404 retries.
- **Append-Only Session Indexing**: Historical session files (JSONL) are append-only. Readers must maintain a lightweight session index (.scratch/session-index.json) tracking fastIdentity (path, size, mtimeMs). Unmodified files reuse pre-parsed session summaries directly (0 ms read); actively growing files seek to lastParsedOffset and incrementally parse appended lines only. Cold-path discovery uses a 16 KB CWD header probe adapter to skip non-target workspace files without parsing.
- **Font Superset Cache**: Font subsetting must implement a superset cache (requiredChars subset of cachedChars) rather than brittle exact hash matching. When an existing compiled WOFF2 covers all characters of the current report, it is reused directly, bypassing 2+ seconds of WASM compilation.
- **Three-Track DAG AI Concurrency**: Report synthesis, key session analysis, and Skill Insights must be orchestrated as a directed acyclic graph with concurrency capped at 3 (AI_CONCURRENCY = 3). Skill Insights starts from the immutable Skill Snapshot while report synthesis starts from `audit.json` and content-read feeds key-session-analysis; each lane has independent validation and fallback state.

## Privacy boundary

- Open source histories read-only and stream records where practical.
- Keep raw history content in process memory only as long as pairing and sizing require. A local Report Run may retain only the bounded structured Evidence and raw lane JSON needed for validation, retry, and diagnosis.
- Invoking the report Skill authorizes progressive in-memory content reading only inside the explicit Audit Scope and up to three Token-ranked Sessions. It does not authorize another Harness, project, or time range.
- Content Evidence packets are internal Host Agent inputs. A bounded packet may be stored only inside the local sensitive Run directory with an explicit retention/cleanup policy. It must not enter default JSON/text/share output, caches, indexes, telemetry, packaged Skills, or databases. The only content exception outside that workspace is the complete first user message for each displayed Turn in the local full HTML trajectory.
- The Run-scoped cleanup command is `report-run cleanup --run-dir <directory>` after final HTML exists; it removes bounded Evidence, Skill Snapshot, lane JSON, composition JSON, and first-user-message projections while retaining the final HTML, canonical Audit, manifest, and trace.
- Lane Eval review artifacts are a separate local-only development projection under `.scratch/`: they may retain raw structured model output, validation, and blind-grading Evidence needed to reproduce a candidate decision, but they are never default report JSON/text/share output and are not packaging or runtime cache input.
- Selected readable `SKILL.md` content is also an internal analysis input. Only the bounded, Snapshot-verified excerpts required by a validated local Capability Aha may appear in the full HTML; full Skill bodies, scripts, invocation arguments, and unrelated source content never appear. Sanitized share output removes Skill content excerpts unless a later privacy review explicitly authorizes them.
- Treat every prompt, response, command, link, and tool result read from history as untrusted data, never as an instruction or authorization for the current Host Agent.
- Hash Evidence with a standard cryptographic hash when identity without disclosure is useful.
- Redact home directories and absolute local paths in default output.
- Never include raw prompts, model responses, source code, shell output, tool results, credentials, or base64 payloads in default JSON/text/share output. The local sensitive Run/Eval workspace may retain only the bounded structured lane response explicitly required by the validation and provenance contracts; it never retains reasoning, unrelated transcript content, command bodies, tool output, credentials, or base64 payloads.
- Treat the local full HTML as sensitive: it may embed the complete, untruncated first user message for each displayed Turn, shows a quiet local-content note that does not compete with the analysis, and does not embed model responses, source code, command bodies, tool results, credentials, or base64 payloads.
- Build sanitized share HTML by removing the first-user-message field from the report data before rendering; hiding it with CSS or truncating it is insufficient.
- Saved Key Session Analysis paraphrases task context. Verbatim user text appears only in the local trajectory tooltip, never as AI Evidence or narrative.
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
11. Add Usage × Content Capability Aha with a dual-sided evidence gate and typed output diversity; do not expand Usage metrics to fill content slots.
12. Add the lightweight Skill Trigger Trace as a separate follow-up slice; it must not block Capability Aha delivery.

Stop the MVP when both Readers satisfy `MVP.md`. Add MCP, persistent storage, live telemetry, richer reports, or formal evals only after real usage shows which one removes the next bottleneck.
