export type Harness = "claude" | "codex";

export type Provenance = "reported" | "derived" | "estimated" | "unavailable";

export type CacheWriteTtl = "5m" | "1h" | "mixed";

export type AuditView = "full" | "usage" | "window" | "report" | "tools" | "week" | "share" | "question";

export type ReportLocale = "zh-CN" | "en-US";

export type ApiPricingSourceKind = "litellm";

export interface ApiPricingSource {
  kind: ApiPricingSourceKind;
  version: string;
  retrievedAt: string | null;
  effectiveDate: string | null;
  currency: "USD";
  unit: "USD per 1M tokens";
}

export interface SessionRecord {
  harness: Harness;
  sessionId: string;
  /** Optional title supplied by the Harness's explicit Session metadata. */
  title?: string | null;
  projectCwd: string | null;
  startedAt: string | null;
  endedAt: string | null;
  parentSessionId: string | null;
  /** Codex source metadata proves this persisted Session ran as a subagent. */
  isSubagent?: boolean | null;
  /** Reader attribution of a coverage gap to this Session; null means unknown. */
  partial?: boolean | null;
  sourceVersion: string | null;
}

export interface TurnRecord {
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

export interface ModelCallRecord {
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
  totalTokens: number | null;
  reportedCost: number | null;
  status: "ok" | "error" | "interrupted" | "unknown";
  tokenProvenance: Provenance;
  /** Source-proven turn boundary used for conservative Skill attribution. */
  turnId?: string | null;
  /** Optional Claude cache-write detail needed for exact cache pricing. */
  cacheWrite5mTokens?: number | null;
  cacheWrite1hTokens?: number | null;
  cacheWriteTtl?: CacheWriteTtl | null;
  /** Optional branch marker retained for output compatibility; false means outside the active context. */
  activeBranch?: boolean;
}

export interface ToolCallRecord {
  sessionId: string;
  callId: string;
  timestamp: string | null;
  toolName: string;
  inputBytes: number | null;
  resultBytes: number | null;
  /** Unicode text-character count used by the amplification estimate. */
  resultChars?: number | null;
  /** Optional source entry that owns this call when the source exposes branch entries. */
  entryId?: string | null;
  turnId?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  durationMs?: number | null;
  commandKind?: string | null;
  commandHash?: string | null;
  isError: boolean | null;
}

export interface LifecycleRecord {
  sessionId: string;
  timestamp: string | null;
  kind: "retry" | "compaction" | "subagent" | "interrupted";
  relatedId: string | null;
  turnId?: string | null;
  origin?: "automatic" | "manual" | null;
}

export interface ReadScope {
  cwd: string | null;
  allProjects: boolean;
  since: Date;
}

export interface Coverage {
  filesRead: number;
  recordsRead: number;
  recordsSkipped: number;
  partialSessions: number;
  warnings: string[];
}

export interface ReadResult {
  sessions: SessionRecord[];
  turns: TurnRecord[];
  modelCalls: ModelCallRecord[];
  toolCalls: ToolCallRecord[];
  lifecycle: LifecycleRecord[];
  coverage: Coverage;
  /** Optional until a Harness exposes verifiable Skill history. */
  skillEvidence?: SkillUseRecord[];
  /** Final per-Session client cost snapshots, when a Harness reports them. */
  sessionCosts?: SessionCostRecord[];
  tokenAccounting?: TokenAccountingSummary;
}

export interface TokenAccountingSummary {
  responseTotal: number | null;
  turnTotal: number | null;
  threadTotal: number | null;
  reconciledSessionIds: string[];
  mismatchedSessionIds: string[];
  status: "reconciled" | "mismatch" | "unavailable";
  method: string;
}

export type SkillEvidenceState = "available" | "invoked" | "attributed" | "unavailable";

export type SkillEvidenceType =
  | "listing"
  | "versioned-attribution"
  | "explicit-input"
  | "resource-read"
  | "script-execution";

export interface SkillUseRecord {
  sessionId: string;
  skillName: string | null;
  state: SkillEvidenceState;
  evidenceType: SkillEvidenceType;
  turnId: string | null;
  callId: string | null;
  timestamp: string | null;
  /** Redacted structural location; never an absolute path or content. */
  sourceLocation: string | null;
  provenance: Provenance;
}

export interface SessionCostRecord {
  sessionId: string;
  totalCost: number | null;
  timestamp: string | null;
  provenance: "reported" | "unavailable";
}

export interface EvidenceValue {
  value: number | string | null;
  provenance: Provenance;
  method?: string;
  source?: {
    sessionId: string;
    recordId?: string;
    timestamp?: string;
  };
}

export interface ContributionEntry {
  key: string;
  /** Human-readable identity when the source provides one, such as a Session title plus ID. */
  displayName?: string;
  value: EvidenceValue;
  /** Percentage points of the complete selected token total, or unavailable. */
  sharePercent: EvidenceValue;
  /** Count of source records represented by this entry. */
  count: EvidenceValue;
}

export interface ContributionRankings {
  sessions: ContributionEntry[];
  projects: ContributionEntry[];
  models: ContributionEntry[];
  timeBuckets: ContributionEntry[];
}

export interface TokenBreakdown {
  /** Mutually exclusive ordinary (non-cache) input tokens when the source proves the composition. */
  inputTokens: EvidenceValue;
  /** Mutually exclusive cache-hit input tokens when the source proves the composition. */
  cachedInputTokens: EvidenceValue;
  /** Mutually exclusive cache-build input tokens when the source proves the composition. */
  cacheWriteTokens: EvidenceValue;
  outputTokens: EvidenceValue;
  /** Remainder of the reported total that cannot be assigned without changing source semantics. */
  unclassifiedTokens: EvidenceValue;
  /** Raw reasoning is retained for evidence but is not independently stacked with output. */
  reasoningTokens: EvidenceValue;
  totalTokens: EvidenceValue;
}

export interface DailyUsageEntry extends TokenBreakdown {
  key: string;
  modelCallCount: EvidenceValue;
  sharePercent: EvidenceValue;
  apiEquivalentCost: EvidenceValue;
}

export interface HourlyActivityEntry {
  key: string;
  modelCallCount: EvidenceValue;
  totalTokens: EvidenceValue;
  sharePercent: EvidenceValue;
}

export interface RollingWindowReport {
  windowHours: number;
  startAt: string;
  endAt: string;
  observedModelCallCount: EvidenceValue;
  observedTokens: EvidenceValue;
  historicalPeakObservedTokens: EvidenceValue;
  providerQuota: EvidenceValue;
  remainingProviderQuota: EvidenceValue;
  resetAt: EvidenceValue;
}

export interface ToolAnalysisEntry {
  key: string;
  calls: EvidenceValue;
  pairedResults: EvidenceValue;
  errors: EvidenceValue;
  injectedTokens: EvidenceValue;
  amplifiedTokens: EvidenceValue;
  sharePercent: EvidenceValue;
}

export interface ApiEquivalentCost {
  total: EvidenceValue;
  allUncachedTotal: EvidenceValue;
  difference: EvidenceValue;
  differencePercent: EvidenceValue;
  pricedTokens: EvidenceValue;
  relevantTokens: EvidenceValue;
  coveragePercent: EvidenceValue;
  unpricedModels: string[];
  limitations: string[];
  source: ApiPricingSource;
}

export interface CacheEconomics {
  totalInputTokens: EvidenceValue;
  inputTokens: EvidenceValue;
  cachedInputTokens: EvidenceValue;
  cacheWriteTokens: EvidenceValue;
  cacheReadRatePercent: EvidenceValue;
  cacheWriteRatePercent: EvidenceValue;
  coveragePercent: EvidenceValue;
  observedApiEquivalentCost: EvidenceValue;
  allUncachedApiEquivalentCost: EvidenceValue;
  cacheSavings: EvidenceValue;
  cacheSavingsPercent: EvidenceValue;
  pricedUsageCoveragePercent: EvidenceValue;
  limitations: string[];
}

export interface FirstRequestGroup {
  sessionCount: EvidenceValue;
  medianTokens: EvidenceValue;
  totalTokens: EvidenceValue;
  sharePercent: EvidenceValue;
  compositionCoveragePercent: EvidenceValue;
  inputTokens: EvidenceValue;
  cachedInputTokens: EvidenceValue;
  cacheWriteTokens: EvidenceValue;
  outputTokens: EvidenceValue;
  cacheReadRatePercent: EvidenceValue;
  coldSessionCount: EvidenceValue;
  coldSessionRatePercent: EvidenceValue;
}

export interface FirstRequestBurden {
  sessionCount: EvidenceValue;
  validFirstRequestCount: EvidenceValue;
  coveragePercent: EvidenceValue;
  medianTokens: EvidenceValue;
  totalTokens: EvidenceValue;
  sharePercent: EvidenceValue;
  compositionCoveragePercent: EvidenceValue;
  inputTokens: EvidenceValue;
  cachedInputTokens: EvidenceValue;
  cacheWriteTokens: EvidenceValue;
  outputTokens: EvidenceValue;
  cacheReadRatePercent: EvidenceValue;
  coldSessionCount: EvidenceValue;
  coldSessionRatePercent: EvidenceValue;
  topLevel: FirstRequestGroup | null;
  subagent: FirstRequestGroup | null;
  identityCoveragePercent: EvidenceValue;
  limitations: string[];
}

export interface SkillAnalysisEntry {
  name: string;
  state: SkillEvidenceState;
  availableSessions: EvidenceValue;
  invocationCount: EvidenceValue;
  sessionCount: EvidenceValue;
  firstObservedAt: EvidenceValue;
  lastObservedAt: EvidenceValue;
  attributedTokens: EvidenceValue;
  attributedApiEquivalentCost: EvidenceValue;
  evidenceCoveragePercent: EvidenceValue;
  directResourceFootprint: EvidenceValue;
  observedAssociation: EvidenceValue;
  causalImpact: EvidenceValue;
  evidenceTypes: string[];
  sourceLocations: string[];
}

export interface ReportData {
  dailyUsage: DailyUsageEntry[];
  hourlyActivity: HourlyActivityEntry[];
  hourlySupported: boolean;
  rollingWindow: RollingWindowReport | null;
  tools: ToolAnalysisEntry[];
  totalToolAmplifiedTokens: EvidenceValue;
  apiEquivalentCost: ApiEquivalentCost;
  cacheEconomics: CacheEconomics;
  firstRequestBurden: FirstRequestBurden;
  skills: SkillAnalysisEntry[];
}

export type AutomatedCheckId = "long_session" | "tool_amplification" | "extra_calls" | "model_concentration" | "data_quality";

export interface AutomatedCheck {
  id: AutomatedCheckId;
  outcome: "pass" | "notice" | "warning";
  evidence: EvidenceValue[];
  method: string;
}

export interface TurnAnalysisEntry {
  sessionId: string;
  turnId: string;
  ordinal: EvidenceValue;
  tokens: TokenBreakdown;
  sessionSharePercent: EvidenceValue;
  modelCallCount: EvidenceValue;
  startedAt: EvidenceValue;
  endedAt: EvidenceValue;
  durationMs: EvidenceValue;
  timeToFirstTokenMs: EvidenceValue;
  observedSpanMs: EvidenceValue;
  toolCallCount: EvidenceValue;
  pairedToolResultCount: EvidenceValue;
  toolResultChars: EvidenceValue;
  toolResultBytes: EvidenceValue;
  errorCount: EvidenceValue;
  lifecycleMarkers: string[];
  evidenceId: string;
  method: string;
  coverage: EvidenceValue;
}

export type TurnDiagnosticKind =
  | "turn_concentration"
  | "input_growth"
  | "tool_result_adjacency"
  | "compaction_change"
  | "waiting_hotspot"
  | "failed_path";

export interface TurnDiagnosticCandidate {
  id: string;
  kind: TurnDiagnosticKind;
  sessionId: string;
  evidenceIds: string[];
  evidence: EvidenceValue[];
  method: string;
  coverage: EvidenceValue;
}

export interface KeySessionAnalysis {
  sessionId: string;
  auditFingerprint: string;
  taskContext: string;
  primaryFinding: {
    observation: string;
    interpretation: string;
    evidenceIds: string[];
    support: "strong" | "moderate" | "limited";
    alternativeExplanations: string[];
  } | null;
  recommendation: {
    action: string;
    rationale: string;
    applicability: string;
    tradeoff: string | null;
    verification: string;
    targetEvidenceIds: string[];
  } | null;
  evidenceRead: {
    turnIds: string[];
    selectionReason: string;
    unreadScope: string;
  };
  limitations: string[];
}

export interface ReportComposition {
  auditFingerprint: string;
  audit: AuditResult;
  keySessionAnalyses: KeySessionAnalysis[];
}

export interface ContentEvidenceScope extends ReadScope {
  harness: Harness;
}

export interface ContentEvidenceSelection {
  sessionId: string;
  turnIds: string[];
  callIds?: string[];
  selectionReason: string;
  unreadScope: string;
}

export interface ContentEvidenceItem {
  sessionId: string;
  turnId: string | null;
  callId: string | null;
  kind: "user" | "assistant" | "tool" | "metadata";
  sourceLocation: string;
  content: string;
  truncated: boolean;
  untrusted: true;
}

export interface ContentEvidencePacket {
  scope: {
    harness: Harness;
    cwd: string | null;
    allProjects: boolean;
    since: string;
  };
  sessionId: string;
  turnIds: string[];
  selectionReason: string;
  unreadScope: string;
  items: ContentEvidenceItem[];
  warnings: string[];
}

export interface AuditSnapshot {
  scope: {
    harness: Harness;
    cwd: string | null;
    allProjects: boolean;
    since: string;
  };
  coverage: Coverage;
  summary: Record<string, EvidenceValue>;
  rankings: ContributionRankings;
  turns: TurnAnalysisEntry[];
  turnCandidates: TurnDiagnosticCandidate[];
  keySessionTokenAccounting?: KeySessionTokenAccounting[];
  report: ReportData;
  checks: AutomatedCheck[];
}

export interface KeySessionTokenAccounting {
  sessionId: string;
  status: "reconciled" | "mismatch" | "unavailable";
  method: string;
}

export interface WeekComparison {
  currentFrom: string;
  currentTo: string;
  previousFrom: string;
  previousTo: string;
  current: AuditSnapshot;
  previous: AuditSnapshot;
  changes: {
    totalTokens: EvidenceValue;
    modelCallCount: EvidenceValue;
    toolAmplifiedTokens: EvidenceValue;
  };
  modelChanges: WeekStructureChange[];
  toolChanges: WeekStructureChange[];
}

export interface WeekStructureChange {
  key: string;
  current: EvidenceValue;
  previous: EvidenceValue;
  change: EvidenceValue;
}

export interface AuditResult extends AuditSnapshot {
  view?: AuditView;
  weekComparison?: WeekComparison;
}
