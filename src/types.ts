export type Harness = "claude" | "codex";

export type Provenance = "reported" | "derived" | "estimated" | "unavailable";

export type CacheWriteTtl = "5m" | "1h" | "mixed";

export type AuditView = "full" | "usage" | "window" | "report" | "tools" | "week" | "share" | "question";

export type { ReportLocale } from "./report-messages";

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
  /** Direct file path for targeted evidence reads without directory re-scans. */
  filePath?: string | null;
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
  /** Exclusive upper bound for a frozen Report Run snapshot. */
  until?: Date;
}

export interface Coverage {
  filesRead: number;
  recordsRead: number;
  recordsSkipped: number;
  partialSessions: number;
  warnings: string[];
}

/** Local-only projection for the complete first user message of a displayed Turn. */
export interface FirstUserMessageRecord {
  sessionId: string;
  turnId: string;
  content: string | null;
  unavailableReason: string | null;
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
  /** Local-only report input; never copied into AuditResult or safe output formats. */
  firstUserMessages?: FirstUserMessageRecord[];
  /** Local-only identities of files actually read or selected for this Scope. */
  sourceFiles?: string[];
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
  /** Sum of unique selected Session ModelCall totals for Sessions containing this Skill. */
  associatedSessionTokens: EvidenceValue;
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
  /** Sanitised Skill names observed on this Turn, when the source proves attribution. */
  skillMarkers?: string[];
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

export interface ReportFinding {
  title: string;
  analysis: string;
  evidenceRefs: string[];
  support: "strong" | "moderate" | "limited";
  uncertainty: string | null;
}

export interface ReportOverview {
  summary: string;
  evidenceRefs: string[];
}

export interface ReportSynthesis {
  auditFingerprint: string;
  overview: ReportOverview;
  findings: ReportFinding[];
  noStrongFindingReason: string | null;
}

export interface ReportComposition {
  auditFingerprint: string;
  audit: AuditResult;
  reportSynthesis: ReportSynthesis | null;
  keySessionAnalyses: KeySessionAnalysis[];
  skillInsights?: ValidatedSkillInsight[];
  skillInsightsSnapshotId?: string;
  /** Local-only resolved project display name; never part of AuditResult. */
  projectName?: string;
  /** Optional local-only projection used by the full HTML renderer. */
  firstUserMessages?: FirstUserMessageRecord[];
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
    until?: string;
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
    until?: string;
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

export interface SkillDerivedMetrics {
  calls: number;
  tasks: number;
  callShare: number;
  callsPerTask: number | null;
  taskCoverage: number;
  rankByCalls: number;
  rankByTasks: number;
  /** ModelCall Tokens matched by the Skill's source-proven call/Turn boundary. */
  attributedCallTokens: number | null;
  /** Sum of unique selected Session totals for Sessions containing the Skill. */
  associatedSessionTokens: number | null;
  associatedCost: number | null;
}

export interface CallsPerTaskDistribution {
  median: number;
  p75: number;
  p90: number;
  max: number;
}

export interface DominantFamilyCandidate {
  groupId: string;
  memberSkillIds: string[];
  callShare: number;
}

export interface SkillFamilyUsage {
  groupId: string;
  memberSkillIds: string[];
  totalCalls: number;
  totalTasks: number;
  callShare: number;
  memberCount: number;
}

export interface GlobalSkillUsage {
  totalSkillsUsed: number;
  totalSkillCalls: number;
  totalTasks: number;
  callsPerTaskDistribution: CallsPerTaskDistribution;
  top4CallShare: number;
  lowFrequencySkillCount: number;
  lowFrequencyCallCount: number;
  lowFrequencySkillShare: number;
  lowFrequencyCallShare: number;
  singleUseSkillShare: number;
  /** Distribution over per-Skill associated Session totals; values are not additive across Skills. */
  associatedSessionTokenCount?: number;
  associatedSessionTokenMedian?: number | null;
  associatedSessionTokenP75?: number | null;
  associatedSessionTokenP90?: number | null;
  associatedSessionTokenMax?: number | null;
  dominantFamily: DominantFamilyCandidate | null;
  familyMetrics?: SkillFamilyUsage[];
}

export type SkillCandidateType =
  | "high_frequency"
  | "high_calls_per_task"
  | "skill_family"
  | "high_usage_strong_delta"
  | "high_usage_model_native_scaffold"
  | "high_usage_task_scoped_content"
  | "rare_strong_delta"
  | "family_shared_core"
  | "behavior_outlier";

export interface SkillCandidate {
  skillId: string;
  skillName: string;
  candidateTypes: SkillCandidateType[];
  signals: {
    calls?: number;
    tasks?: number;
    callShare?: number;
    callsPerTask?: number;
    rankByCalls?: number;
    attributedCallTokens?: number;
    associatedSessionTokens?: number;
    familyGroup?: string;
    isOutlier?: boolean;
  };
}

export interface SkillCandidatesResult {
  global: GlobalSkillUsage;
  candidates: SkillCandidate[];
}

export interface SkillContentSnapshot {
  skillId: string;
  skillName: string;
  skillPath: string | null;
  contentState: "available" | "unavailable";
  skillMdBytes: number;
  skillMdEstimatedTokens: number;
  skillMdHash: string | null;
  skillMdContent: string | null;
  referenceCount: number;
  referenceBytes: number;
  referenceFiles: string[];
}

export interface SkillSnapshotArtifact {
  snapshotId: string;
  auditFingerprint: string;
  createdAt: string;
  distributionContext: CallsPerTaskDistribution;
  globalUsage: GlobalSkillUsage;
  selectedCandidates: SkillCandidate[];
  selectedSkills: SkillContentSnapshot[];
}

export type SkillInsightScope = "global" | "family" | "cross_skill" | "skill";

export type SkillSemanticRole =
  | "capability"
  | "specializedCapability"
  | "localFact"
  | "hardConstraint"
  | "tool"
  | "decisionRule"
  | "genericProcedure";

export type SkillLoadingScope =
  | "always"
  | "task_scoped"
  | "reference_candidate"
  | "unclear";

export type SkillInsightEvidenceKind =
  | "global_metric"
  | "distribution_metric"
  | "family_metric"
  | "skill_metric"
  | "skill_content"
  | "cross_skill_content";

export type SkillInsightKind = "usage" | "capability" | "mechanism";

export type SkillInsightClaimStrength = "coexistence" | "scaffold-interpretation" | "primary-delta";

export type SkillInsightRejectionReason =
  | "missing_unique_capability_evidence"
  | "missing_model_native_counterevidence"
  | "insufficient_content_support"
  | "usage_content_relation_unclear"
  | "family_content_unavailable"
  | "duplicate_mental_model_shift";

export interface SkillContentLossIfRemoved {
  summary: string;
  role: Extract<SkillSemanticRole, "localFact" | "hardConstraint" | "tool" | "decisionRule" | "capability" | "specializedCapability">;
  evidenceExcerpt: string;
  whyModelWouldNotKnowThis: string;
  loadingScope: SkillLoadingScope;
}

export interface SkillContentModelNativeScaffold {
  summary: string;
  evidenceExcerpt: string;
  observed: string;
  interpretation: string;
  rationale: string;
  relativeTo: "capable-current-coding-agent";
}

export interface SkillContentScopedEntry {
  summary: string;
  activationCondition: string;
  evidenceExcerpt: string;
}

export interface SkillContentProfile {
  skillId: string;
  lossIfRemoved: SkillContentLossIfRemoved[];
  modelNativeScaffold: SkillContentModelNativeScaffold[];
  scopedContent: SkillContentScopedEntry[];
  contentSummary: string;
}

export interface SkillInsightEvidence {
  kind: SkillInsightEvidenceKind;
  metric?: string;
  value?: number | string;
  skillId?: string;
  familyId?: string;
  role?: SkillSemanticRole;
  loadingScope?: SkillLoadingScope;
  evidenceExcerpt?: string;
}

export interface MentalModelShift {
  surface: string;
  observed: string;
}

export interface DecisionDelta {
  before: string;
  after: string;
}

export type SkillInsightRevealPattern =
  | "share_inversion"
  | "distribution_outlier"
  | "family_concentration"
  | "content_contrast";

export interface SkillInsightReveal {
  semantic: string;
  pattern: SkillInsightRevealPattern;
  evidenceRefs: string[];
}

export interface SkillInsightCounterfactual {
  ifRemoved: string;
  withoutGenericScaffold: string;
}

export interface ValidatedSkillInsight {
  snapshotId: string;
  id: string;
  kind: SkillInsightKind;
  candidateType?: SkillCandidateType;
  claimStrength?: SkillInsightClaimStrength;
  scope: SkillInsightScope;
  subject?: {
    familyId?: string;
    skillId?: string;
    skillIds?: string[];
  };
  title: string;
  reveal: SkillInsightReveal;
  mentalModelShift: MentalModelShift;
  decisionDelta: DecisionDelta;
  observation: string;
  contrast: string;
  interpretation: string;
  counterfactual?: SkillInsightCounterfactual;
  conditionalMechanism?: string | null;
  consequence?: string | null;
  familyDifferences?: string[];
  confidence: "high" | "medium";
  evidence: SkillInsightEvidence[];
}

export interface SkillInsightsArtifact {
  snapshotId: string;
  auditFingerprint: string;
  createdAt: string;
  status: "completed" | "insufficient_evidence" | "unavailable";
  insights: ValidatedSkillInsight[];
  unsupportedClaimsDropped: number;
  oversizedFallbackUsed: boolean;
  rejectionReasons?: SkillInsightRejectionReason[];
  contentProfiles?: SkillContentProfile[];
}
