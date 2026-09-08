export type Harness = "claude" | "codex" | "pi" | "deepseek";

export type Provenance = "reported" | "derived" | "estimated" | "unavailable";

export type AuditView = "full" | "usage" | "window" | "report" | "tools" | "week" | "share" | "question";

export type ReportLocale = "zh-CN" | "en-US";

export interface SessionRecord {
  harness: Harness;
  sessionId: string;
  /** Optional title supplied by the Harness's explicit Session metadata. */
  title?: string | null;
  projectCwd: string | null;
  startedAt: string | null;
  endedAt: string | null;
  parentSessionId: string | null;
  sourceVersion: string | null;
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
  /** Pi-only branch marker; false means the call was incurred outside the active context. */
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
  /** Pi entry that owns this call, when the source exposes branch entries. */
  entryId?: string | null;
  isError: boolean | null;
}

export interface LifecycleRecord {
  sessionId: string;
  timestamp: string | null;
  kind: "retry" | "compaction" | "subagent" | "interrupted";
  relatedId: string | null;
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
  modelCalls: ModelCallRecord[];
  toolCalls: ToolCallRecord[];
  lifecycle: LifecycleRecord[];
  coverage: Coverage;
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
  inputTokens: EvidenceValue;
  cachedInputTokens: EvidenceValue;
  cacheWriteTokens: EvidenceValue;
  outputTokens: EvidenceValue;
  reasoningTokens: EvidenceValue;
  totalTokens: EvidenceValue;
}

export interface DailyUsageEntry extends TokenBreakdown {
  key: string;
  modelCallCount: EvidenceValue;
  sharePercent: EvidenceValue;
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

export interface ReportData {
  dailyUsage: DailyUsageEntry[];
  hourlyActivity: HourlyActivityEntry[];
  hourlySupported: boolean;
  rollingWindow: RollingWindowReport | null;
  tools: ToolAnalysisEntry[];
  totalToolAmplifiedTokens: EvidenceValue;
}

export interface AuditFinding {
  kind: "long_session" | "tool_amplification" | "extra_calls";
  headline: string;
  explanation: string;
  impact: EvidenceValue;
  evidence: EvidenceValue[];
  recommendation: string;
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
  report: ReportData;
  topFinding: AuditFinding | null;
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
