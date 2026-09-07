export type Harness = "claude" | "codex" | "pi" | "deepseek";

export type Provenance = "reported" | "derived" | "estimated" | "unavailable";

export interface SessionRecord {
  harness: Harness;
  sessionId: string;
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
  value: EvidenceValue;
}

export interface ContributionRankings {
  sessions: ContributionEntry[];
  projects: ContributionEntry[];
  models: ContributionEntry[];
  timeBuckets: ContributionEntry[];
}

export interface AuditResult {
  scope: {
    harness: Harness;
    cwd: string | null;
    allProjects: boolean;
    since: string;
  };
  coverage: Coverage;
  summary: Record<string, EvidenceValue>;
  rankings: ContributionRankings;
  topFinding: {
    kind: "long_session" | "tool_amplification" | "extra_calls";
    headline: string;
    explanation: string;
    impact: EvidenceValue;
    evidence: EvidenceValue[];
    recommendation: string;
  } | null;
}
