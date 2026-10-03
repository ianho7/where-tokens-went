import type {
  AuditResult,
  ContentEvidencePacket,
  EvidenceValue,
  KeySessionAnalysis,
  Provenance,
  ReportFinding,
  ReportLocale,
  ReportOverview,
  ReportSynthesis,
  SkillContentProfile,
  SkillContentSnapshot,
  SkillInsightEvidence,
  SkillInsightEvidenceKind,
  SkillInsightRejectionReason,
  SkillLoadingScope,
  SkillSemanticRole,
  SkillSnapshotArtifact,
  TurnAnalysisEntry,
  ValidatedSkillInsight,
} from "./types";
import {
  auditFingerprint,
  normalizedFinding,
  resolveReportEvidence,
  sanitizeKeySessionAnalysis,
  validateKeySessionAnalysis,
  turnEvidenceMetrics,
} from "./key-session-analysis";
import { skillInsightEvidenceReference } from "./skill-insights";

/**
 * Model-facing Lane output contract version.
 *
 * v2 removes code-owned identity fields and canonical measurements from every
 * Lane output: the model selects handles from the frozen Evidence Directory and
 * code restores canonical identities, facts, units, sources and approved Skill
 * excerpts. v1 survives only as an explicitly requested diagnostic contract.
 */
export const OUTPUT_CONTRACT_VERSION = 2 as const;
export const REPORT_SYNTHESIS_LEGACY_OUTPUT_CONTRACT_VERSION = 1 as const;
export const PROJECTION_SCHEMA_VERSION = 2 as const;

export type OutputContractVersion = 1 | 2;

/**
 * Whether a directory entry may be rendered as a number. `private` entries may
 * be cited as support but never rendered; `unavailable` entries exist so the
 * model can see the unknown state without inventing zero.
 */
export type LaneDisplayPolicy = "allowed" | "private" | "unavailable";

export type LaneObjectKind =
  | "session"
  | "project"
  | "model"
  | "timeBucket"
  | "turn"
  | "check"
  | "summary"
  | "metric"
  | "skill"
  | "family"
  | "content";

export type LaneSlotKind =
  | "tokens"
  | "percentage"
  | "count"
  | "duration"
  | "currency"
  | "multiplier"
  | "size"
  | "other";

export interface LaneEntityRef {
  handle: string;
  kind: "session" | "skill" | "family";
  canonicalId: string;
  label: string;
  displayPolicy: LaneDisplayPolicy;
}

export interface LaneEvidenceEntry {
  handle: string;
  objectKind: LaneObjectKind;
  /** Canonical identity the model must not echo; code restores it on accept. */
  canonicalRef: string;
  /** Canonical owning object handle when the entry belongs to one. */
  ownerHandle: string | null;
  /** Canonical owning object identity used for cross-object binding checks. */
  ownerCanonicalId: string | null;
  /** Canonical metric identity. Absent for pure citation anchors. */
  metric: string | null;
  label: string;
  value: EvidenceValue | null;
  unit: string | null;
  slotKind: LaneSlotKind | null;
  allowedSlotKinds: LaneSlotKind[];
  displayPolicy: LaneDisplayPolicy;
  /** Model-facing rendering of the value; never the raw private text. */
  display: string | null;
  /** True when the entry may be cited as supporting Evidence. */
  citable: boolean;
}

export interface LaneContentEntry {
  handle: string;
  canonicalRef: string;
  skillHandle: string | null;
  skillId: string | null;
  contentHash: string | null;
  startOffset: number;
  endOffset: number;
  displayPolicy: LaneDisplayPolicy;
  available: boolean;
}

export interface LaneDirectory {
  sessions: LaneEntityRef[];
  skills: LaneEntityRef[];
  families: LaneEntityRef[];
  evidence: LaneEvidenceEntry[];
  content: LaneContentEntry[];
}

export function emptyLaneDirectory(): LaneDirectory {
  return { sessions: [], skills: [], families: [], evidence: [], content: [] };
}

export function isLaneDirectory(value: unknown): value is LaneDirectory {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<LaneDirectory>;
  return Array.isArray(candidate.sessions) &&
    Array.isArray(candidate.skills) &&
    Array.isArray(candidate.families) &&
    Array.isArray(candidate.evidence) &&
    Array.isArray(candidate.content);
}

function handleOf(prefix: string, value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return new RegExp(`^${prefix}[1-9][0-9]*$`).test(trimmed) ? trimmed : null;
}

export function evidenceHandle(value: unknown): string | null {
  return handleOf("e", value);
}

export function sessionHandle(value: unknown): string | null {
  return handleOf("s", value);
}

export function skillHandle(value: unknown): string | null {
  return handleOf("k", value);
}

export function familyHandle(value: unknown): string | null {
  return handleOf("f", value);
}

export function contentHandle(value: unknown): string | null {
  return handleOf("c", value);
}

// ---------------------------------------------------------------------------
// Value binding
// ---------------------------------------------------------------------------

function numberFormatter(locale: ReportLocale): Intl.NumberFormat {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 20 });
}

function compactNumberFormatter(locale: ReportLocale): Intl.NumberFormat {
  return new Intl.NumberFormat(locale, { notation: "compact", compactDisplay: "short", maximumFractionDigits: 2 });
}

function provenancePrefix(provenance: Provenance): string {
  return provenance === "estimated" ? "~" : "";
}

function displayPolicyFor(value: EvidenceValue): LaneDisplayPolicy {
  if (value.value === null || value.value === undefined || value.provenance === "unavailable") return "unavailable";
  return "allowed";
}

function slotKindForUnit(unit: string | null, metric: string | null): LaneSlotKind {
  const source = (unit ?? "").toLowerCase();
  if (source === "percent") return "percentage";
  if (source === "usd") return "currency";
  if (source === "multiplier") return "multiplier";
  if (source === "bytes" || source === "codeunits") return "size";
  if (source === "ms") return "duration";
  if (source === "tokens") return "tokens";
  if (source === "count" || source === "calls" || source === "records") return "count";
  if (metric && /(?:Ms|Duration)$/.test(metric)) return "duration";
  if (metric && /(?:Percent|percent|Share|share|Rate|rate)$/.test(metric)) return "percentage";
  return "other";
}

/**
 * Exact, locale-stable rendering for a bound numeric slot. The value always
 * comes from the canonical Audit/Snapshot; this function never recomputes a
 * measurement and never renders a private or unavailable value.
 */
export function formatSlotValue(value: EvidenceValue, slotKind: LaneSlotKind | null, locale: ReportLocale): string {
  const prefix = provenancePrefix(value.provenance);
  if (value.value === null || value.value === undefined) return "—";
  if (typeof value.value !== "number" || !Number.isFinite(value.value)) return prefix + String(value.value);
  if (slotKind === "percentage") return prefix + numberFormatter(locale).format(value.value) + "%";
  if (slotKind === "currency") {
    const formatted = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value.value);
    return formatted.startsWith("-") ? "-$" + formatted.slice(1) : "$" + formatted;
  }
  if (slotKind === "multiplier") return prefix + numberFormatter(locale).format(value.value) + "x";
  if (slotKind === "other") return prefix + compactNumberFormatter(locale).format(value.value);
  return prefix + numberFormatter(locale).format(value.value);
}

// ---------------------------------------------------------------------------
// Evidence Directory construction
// ---------------------------------------------------------------------------

const SUMMARY_META: Record<string, { unit: string | null; label: string }> = {
  totalTokens: { unit: "tokens", label: "total Tokens" },
  sessionCount: { unit: "count", label: "Sessions" },
  topLevelSessionCount: { unit: "count", label: "top-level Sessions" },
  subagentSessionCount: { unit: "count", label: "Subagent Sessions" },
  modelCallCount: { unit: "calls", label: "Model Calls" },
  reportedCost: { unit: "usd", label: "reported cost" },
  topSessionTokens: { unit: "tokens", label: "primary destination Tokens" },
  topSessionSharePercent: { unit: "percent", label: "primary destination share" },
  tokenAccountingStatus: { unit: null, label: "Token accounting" },
  keySessionTokenAccountingStatus: { unit: null, label: "Key Session Token accounting" },
  responseUsageTotal: { unit: "tokens", label: "response usage total" },
  cumulativeTurnTotal: { unit: "tokens", label: "cumulative Turn total" },
  estimatedToolAmplifiedTokens: { unit: "tokens", label: "estimated tool amplification" },
  toolCallCount: { unit: "calls", label: "tool calls" },
  pairedToolResultCount: { unit: "count", label: "paired tool results" },
};

const CLASSIFICATION_SUMMARY_KEYS = new Set(["tokenAccountingStatus", "keySessionTokenAccountingStatus"]);

interface InternalEvidenceEntry {
  objectKind: LaneObjectKind;
  canonicalRef: string;
  metric: string | null;
  label: string;
  value: EvidenceValue | null;
  unit: string | null;
  slotKind: LaneSlotKind | null;
  citable: boolean;
  ownerHandle?: string | null;
  ownerCanonicalId?: string | null;
}

/**
 * Deterministic handle allocation: entries are numbered in declaration order,
 * so the same frozen inputs always produce the same directory and hash.
 */
class DirectoryBuilder {
  private readonly directory: LaneDirectory = emptyLaneDirectory();
  private readonly sessionHandles = new Map<string, string>();
  private readonly skillHandles = new Map<string, string>();
  private readonly familyHandles = new Map<string, string>();

  addSession(canonicalId: string, label: string): string {
    const existing = this.sessionHandles.get(canonicalId);
    if (existing) return existing;
    const handle = `s${this.directory.sessions.length + 1}`;
    this.sessionHandles.set(canonicalId, handle);
    this.directory.sessions.push({ handle, kind: "session", canonicalId, label, displayPolicy: "allowed" });
    return handle;
  }

  addSkill(canonicalId: string, label: string): string {
    const existing = this.skillHandles.get(canonicalId);
    if (existing) return existing;
    const handle = `k${this.directory.skills.length + 1}`;
    this.skillHandles.set(canonicalId, handle);
    this.directory.skills.push({ handle, kind: "skill", canonicalId, label, displayPolicy: "allowed" });
    return handle;
  }

  addFamily(canonicalId: string, label: string): string {
    const existing = this.familyHandles.get(canonicalId);
    if (existing) return existing;
    const handle = `f${this.directory.families.length + 1}`;
    this.familyHandles.set(canonicalId, handle);
    this.directory.families.push({ handle, kind: "family", canonicalId, label, displayPolicy: "allowed" });
    return handle;
  }

  sessionHandleFor(canonicalId: string): string | null {
    return this.sessionHandles.get(canonicalId) ?? null;
  }

  skillHandleFor(canonicalId: string): string | null {
    return this.skillHandles.get(canonicalId) ?? null;
  }

  familyHandleFor(canonicalId: string): string | null {
    return this.familyHandles.get(canonicalId) ?? null;
  }

  addEvidence(entry: InternalEvidenceEntry): string {
    const handle = `e${this.directory.evidence.length + 1}`;
    const displayPolicy = entry.value ? displayPolicyFor(entry.value) : "unavailable";
    const slotKind = entry.slotKind;
    this.directory.evidence.push({
      handle,
      objectKind: entry.objectKind,
      canonicalRef: entry.canonicalRef,
      ownerHandle: entry.ownerHandle ?? null,
      ownerCanonicalId: entry.ownerCanonicalId ?? null,
      metric: entry.metric,
      label: entry.label,
      value: entry.value,
      unit: entry.unit,
      slotKind,
      allowedSlotKinds: displayPolicy === "allowed" && slotKind ? [slotKind] : [],
      displayPolicy,
      display: null,
      citable: entry.citable,
    });
    return handle;
  }

  addContent(entry: Omit<LaneContentEntry, "handle">): string {
    const handle = `c${this.directory.content.length + 1}`;
    this.directory.content.push({ handle, ...entry });
    return handle;
  }

  build(locale: ReportLocale): LaneDirectory {
    for (const entry of this.directory.evidence) {
      entry.display = entry.value ? formatSlotValue(entry.value, entry.slotKind, locale) : null;
    }
    return this.directory;
  }
}
function addSummaryEntries(builder: DirectoryBuilder, audit: AuditResult): void {
  for (const [key, value] of Object.entries(audit.summary ?? {})) {
    const isClassification = CLASSIFICATION_SUMMARY_KEYS.has(key);
    const unit = isClassification ? null : SUMMARY_META[key]?.unit ?? null;
    builder.addEvidence({
      objectKind: "summary",
      canonicalRef: `summary:${key}`,
      metric: key,
      label: SUMMARY_META[key]?.label ?? key,
      value: isClassification ? null : value,
      unit,
      slotKind: isClassification ? null : slotKindForUnit(unit, key),
      citable: true,
    });
  }
}

const CHECK_UNITS = ["count", "count", "percent"] as const;
const CHECK_METRICS = ["value", "count", "share"] as const;

function addCheckEntries(builder: DirectoryBuilder, audit: AuditResult): void {
  for (const check of audit.checks ?? []) {
    builder.addEvidence({
      objectKind: "check",
      canonicalRef: `check:${check.id}`,
      metric: check.outcome,
      label: `Automated Check ${check.id}`,
      value: null,
      unit: null,
      slotKind: null,
      citable: true,
    });
    check.evidence.forEach((value, index) => {
      const unit = CHECK_UNITS[index] ?? "count";
      builder.addEvidence({
        objectKind: "check",
        canonicalRef: `check:${check.id}:${index}`,
        metric: CHECK_METRICS[index] ?? `evidence${index}`,
        label: `Automated Check ${check.id} evidence ${index}`,
        value,
        unit,
        slotKind: slotKindForUnit(unit, null),
        citable: true,
      });
    });
  }
}

type RankingDimension = "sessions" | "projects" | "models" | "timeBuckets";

const RANKING_OBJECT_KIND: Record<RankingDimension, LaneObjectKind> = {
  sessions: "session",
  projects: "project",
  models: "model",
  timeBuckets: "timeBucket",
};

function addRankingEntries(
  builder: DirectoryBuilder,
  rankings: AuditResult["rankings"],
  dimensions: readonly RankingDimension[],
  options: { registerSessions: boolean },
): void {
  for (const dimension of dimensions) {
    const entries = rankings?.[dimension] ?? [];
    for (const entry of entries) {
      const ownerHandle = options.registerSessions && dimension === "sessions"
        ? builder.addSession(entry.key, entry.displayName ?? entry.key)
        : builder.sessionHandleFor(entry.key);
      const metrics: Array<{ suffix: string; metric: string; unit: string; label: string; value: EvidenceValue }> = [
        { suffix: "", metric: "tokens", unit: "tokens", label: "Tokens", value: entry.value },
        { suffix: ":sharePercent", metric: "sharePercent", unit: "percent", label: "share", value: entry.sharePercent },
        {
          suffix: ":count",
          metric: dimension === "sessions" ? "modelCallCount" : "count",
          unit: dimension === "sessions" ? "calls" : "count",
          label: dimension === "sessions" ? "Model Calls" : "calls",
          value: entry.count,
        },
      ];
      for (const meta of metrics) {
        if (!meta.value) continue;
        builder.addEvidence({
          objectKind: RANKING_OBJECT_KIND[dimension],
          canonicalRef: `ranking:${dimension}:${entry.key}${meta.suffix}`,
          metric: meta.metric,
          label: meta.label,
          value: meta.value,
          unit: meta.unit,
          slotKind: slotKindForUnit(meta.unit, meta.metric),
          citable: true,
          ownerHandle,
          ownerCanonicalId: dimension === "sessions" ? entry.key : null,
        });
      }
    }
  }
}

function addTurnEntries(
  builder: DirectoryBuilder,
  turns: readonly TurnAnalysisEntry[],
  metricKeys: readonly string[],
): void {
  for (const turn of turns) {
    const ownerHandle = builder.sessionHandleFor(turn.sessionId);
    const available = turnEvidenceMetrics(turn);
    for (const key of metricKeys) {
      const meta = available.find((entry) => entry.metric === key);
      if (!meta) continue;
      builder.addEvidence({
        objectKind: "turn",
        canonicalRef: `${turn.evidenceId}${meta.suffix}`,
        metric: meta.metric,
        label: meta.label,
        value: meta.value,
        unit: meta.unit,
        slotKind: slotKindForUnit(meta.unit, meta.metric),
        citable: true,
        ownerHandle,
        ownerCanonicalId: turn.sessionId,
      });
    }
  }
}

function addKeySessionAccountingEntries(
  builder: DirectoryBuilder,
  audit: AuditResult,
  sessionIds: ReadonlySet<string>,
): void {
  for (const entry of audit.keySessionTokenAccounting ?? []) {
    if (!sessionIds.has(entry.sessionId)) continue;
    builder.addEvidence({
      objectKind: "metric",
      canonicalRef: `keySessionTokenAccounting:${entry.sessionId}`,
      metric: "keySessionTokenAccountingStatus",
      label: "Key Session Token accounting",
      value: null,
      unit: null,
      slotKind: null,
      citable: true,
      ownerHandle: builder.sessionHandleFor(entry.sessionId),
      ownerCanonicalId: entry.sessionId,
    });
  }
}

export interface LaneDirectoryResult {
  directory: LaneDirectory;
  contentByHandle: Map<string, string>;
}

export interface SynthesisDirectoryInput {
  audit: AuditResult;
  turns: readonly TurnAnalysisEntry[];
  locale: ReportLocale;
}

export function buildReportSynthesisDirectory(input: SynthesisDirectoryInput): LaneDirectoryResult {
  const builder = new DirectoryBuilder();
  addSummaryEntries(builder, input.audit);
  addCheckEntries(builder, input.audit);
  addRankingEntries(builder, input.audit.rankings, ["sessions", "projects", "models", "timeBuckets"], { registerSessions: true });
  addTurnEntries(builder, input.turns, ["totalTokens", "sessionSharePercent", "modelCallCount"]);
  const directory = builder.build(input.locale);
  return { directory, contentByHandle: new Map() };
}

export interface KeySessionDirectoryInput {
  audit: AuditResult;
  sessions: readonly { key: string; displayName?: string }[];
  turns: readonly TurnAnalysisEntry[];
  locale: ReportLocale;
}

export function buildKeySessionDirectory(input: KeySessionDirectoryInput): LaneDirectoryResult {
  const builder = new DirectoryBuilder();
  for (const session of input.sessions) {
    builder.addSession(session.key, session.displayName ?? session.key);
  }
  addSummaryEntries(builder, input.audit);
  addRankingEntries(
    builder,
    { sessions: input.sessions as AuditResult["rankings"]["sessions"], projects: [], models: [], timeBuckets: [] },
    ["sessions"],
    { registerSessions: false },
  );
  addTurnEntries(builder, input.turns, ["totalTokens", "sessionSharePercent", "modelCallCount", "toolResultBytes", "durationMs", "errorCount"]);
  addKeySessionAccountingEntries(builder, input.audit, new Set(input.sessions.map((session) => session.key)));
  const directory = builder.build(input.locale);
  return { directory, contentByHandle: new Map() };
}

// ---------------------------------------------------------------------------
// Skill content chunking
// ---------------------------------------------------------------------------

export const SKILL_CONTENT_CHUNK_CODE_UNITS = 200;
export const SKILL_CONTENT_CHUNK_OVERLAP_CODE_UNITS = 40;

export interface SkillContentChunk {
  skillId: string;
  startOffset: number;
  endOffset: number;
  contentHash: string;
  text: string;
}

/**
 * Split frozen Skill content into adjacent chunks of at most 200 UTF-16 code
 * units with a 40-code-unit overlap, covering the entire supplied content.
 */
export function chunkSkillContent(skillId: string, content: string, hash: (input: string) => string): SkillContentChunk[] {
  const chunks: SkillContentChunk[] = [];
  if (typeof content !== "string" || content.length === 0) return chunks;
  const step = SKILL_CONTENT_CHUNK_CODE_UNITS - SKILL_CONTENT_CHUNK_OVERLAP_CODE_UNITS;
  for (let start = 0; start < content.length; start += step) {
    const end = Math.min(content.length, start + SKILL_CONTENT_CHUNK_CODE_UNITS);
    const text = content.slice(start, end);
    chunks.push({ skillId, startOffset: start, endOffset: end, contentHash: hash(text), text });
    if (end >= content.length) break;
  }
  return chunks;
}

export interface SkillInsightsDirectoryInput {
  snapshot: SkillSnapshotArtifact;
  hash: (input: string) => string;
  locale: ReportLocale;
}

const GLOBAL_METRIC_META: Array<{ metric: string; unit: string; label: string }> = [
  { metric: "totalSkillsUsed", unit: "count", label: "Skills used" },
  { metric: "totalSkillCalls", unit: "calls", label: "Skill calls" },
  { metric: "totalTasks", unit: "count", label: "Tasks" },
  { metric: "top4CallShare", unit: "percent", label: "top four call share" },
  { metric: "lowFrequencySkillCount", unit: "count", label: "low-frequency Skills" },
  { metric: "lowFrequencyCallCount", unit: "calls", label: "low-frequency calls" },
  { metric: "lowFrequencySkillShare", unit: "percent", label: "low-frequency Skill share" },
  { metric: "lowFrequencyCallShare", unit: "percent", label: "low-frequency call share" },
  { metric: "singleUseSkillShare", unit: "percent", label: "single-use Skill share" },
  { metric: "associatedSessionTokenCount", unit: "count", label: "Session totals available" },
  { metric: "associatedSessionTokenMedian", unit: "tokens", label: "associated Session Token median" },
  { metric: "associatedSessionTokenP75", unit: "tokens", label: "associated Session Token P75" },
  { metric: "associatedSessionTokenP90", unit: "tokens", label: "associated Session Token P90" },
  { metric: "associatedSessionTokenMax", unit: "tokens", label: "associated Session Token maximum" },
];

export function buildSkillInsightsDirectory(input: SkillInsightsDirectoryInput): LaneDirectoryResult {
  const builder = new DirectoryBuilder();
  const contentByHandle = new Map<string, string>();
  const snapshot = input.snapshot;

  for (const candidate of snapshot.selectedCandidates ?? []) {
    builder.addSkill(candidate.skillId, candidate.skillName);
  }
  for (const skill of snapshot.selectedSkills ?? []) {
    builder.addSkill(skill.skillId, skill.skillName);
  }
  for (const family of snapshot.globalUsage?.familyMetrics ?? []) {
    builder.addFamily(family.groupId, family.groupId);
  }
  if (snapshot.globalUsage?.dominantFamily) {
    builder.addFamily(snapshot.globalUsage.dominantFamily.groupId, snapshot.globalUsage.dominantFamily.groupId);
  }

  const global = snapshot.globalUsage;
  if (global) {
    const raw = global as unknown as Record<string, unknown>;
    for (const meta of GLOBAL_METRIC_META) {
      const value = typeof raw[meta.metric] === "number" ? raw[meta.metric] as number : null;
      builder.addEvidence({
        objectKind: "metric",
        canonicalRef: `global:${meta.metric}`,
        metric: meta.metric,
        label: meta.label,
        value: value === null ? null : { value, provenance: "derived" as Provenance },
        unit: meta.unit,
        slotKind: slotKindForUnit(meta.unit, meta.metric),
        citable: true,
      });
    }
    const distribution = snapshot.distributionContext ?? global.callsPerTaskDistribution;
    if (distribution) {
      const entries: Array<[string, number]> = [
        ["median", distribution.median],
        ["p75", distribution.p75],
        ["p90", distribution.p90],
        ["max", distribution.max],
      ];
      for (const [metric, value] of entries) {
        builder.addEvidence({
          objectKind: "metric",
          canonicalRef: `distribution:${metric}`,
          metric,
          label: `calls per task ${metric}`,
          value: { value, provenance: "derived" },
          unit: "multiplier",
          slotKind: "multiplier",
          citable: true,
        });
      }
    }
    for (const family of global.familyMetrics ?? []) {
      const ownerHandle = builder.familyHandleFor(family.groupId);
      const metrics: Array<[string, number, string]> = [
        ["callShare", family.callShare, "percent"],
        ["totalCalls", family.totalCalls, "calls"],
        ["totalTasks", family.totalTasks, "count"],
        ["memberCount", family.memberCount, "count"],
      ];
      for (const [metric, value, unit] of metrics) {
        builder.addEvidence({
          objectKind: "family",
          canonicalRef: `family:${family.groupId}:${metric}`,
          metric,
          label: `family ${metric}`,
          value: { value, provenance: "derived" },
          unit,
          slotKind: slotKindForUnit(unit, metric),
          citable: true,
          ownerHandle,
          ownerCanonicalId: family.groupId,
        });
      }
    }
  }

  for (const candidate of snapshot.selectedCandidates ?? []) {
    const ownerHandle = builder.skillHandleFor(candidate.skillId);
    for (const [metric, signal] of Object.entries(candidate.signals ?? {})) {
      if (typeof signal !== "number" && typeof signal !== "string") continue;
      const unit = metric === "callShare"
        ? "percent"
        : metric === "callsPerTask"
          ? "multiplier"
          : metric === "calls" || metric === "rankByCalls"
            ? "calls"
            : metric === "tasks"
              ? "count"
              : "tokens";
      builder.addEvidence({
        objectKind: "skill",
        canonicalRef: `skill:${candidate.skillId}:${metric}`,
        metric,
        label: `Skill ${metric}`,
        value: { value: signal, provenance: "derived" },
        unit,
        slotKind: slotKindForUnit(unit, metric),
        citable: true,
        ownerHandle,
        ownerCanonicalId: candidate.skillId,
      });
    }
  }

  for (const skill of snapshot.selectedSkills ?? []) {
    const ownerHandle = builder.skillHandleFor(skill.skillId);
    if (!ownerHandle) continue;
    const content = skill.skillMdContent;
    const available = skill.contentState === "available" && typeof content === "string" && content.length > 0;
    if (!available) {
      builder.addContent({
        canonicalRef: `content:${skill.skillId}`,
        skillHandle: ownerHandle,
        skillId: skill.skillId,
        contentHash: null,
        startOffset: 0,
        endOffset: 0,
        displayPolicy: "unavailable",
        available: false,
      });
      continue;
    }
    for (const chunk of chunkSkillContent(skill.skillId, content as string, input.hash)) {
      const handle = builder.addContent({
        canonicalRef: `content:${skill.skillId}:${chunk.startOffset}-${chunk.endOffset}`,
        skillHandle: ownerHandle,
        skillId: skill.skillId,
        contentHash: chunk.contentHash,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        displayPolicy: "allowed",
        available: true,
      });
      contentByHandle.set(handle, chunk.text);
    }
  }

  const directory = builder.build(input.locale);
  return { directory, contentByHandle };
}

export function buildLaneDirectory(
  lane: "report-synthesis" | "key-session-analysis" | "skill-insights",
  inputs: {
    audit?: AuditResult;
    turns?: readonly TurnAnalysisEntry[];
    sessions?: readonly { key: string; displayName?: string }[];
    snapshot?: SkillSnapshotArtifact;
    hash: (input: string) => string;
    locale: ReportLocale;
  },
): LaneDirectoryResult {
  if (lane === "report-synthesis") {
    if (!inputs.audit) return { directory: emptyLaneDirectory(), contentByHandle: new Map() };
    return buildReportSynthesisDirectory({ audit: inputs.audit, turns: inputs.turns ?? inputs.audit.turns ?? [], locale: inputs.locale });
  }
  if (lane === "key-session-analysis") {
    if (!inputs.audit) return { directory: emptyLaneDirectory(), contentByHandle: new Map() };
    return buildKeySessionDirectory({
      audit: inputs.audit,
      sessions: inputs.sessions ?? inputs.audit.rankings.sessions.slice(0, 3),
      turns: inputs.turns ?? [],
      locale: inputs.locale,
    });
  }
  if (!inputs.snapshot) return { directory: emptyLaneDirectory(), contentByHandle: new Map() };
  return buildSkillInsightsDirectory({ snapshot: inputs.snapshot, hash: inputs.hash, locale: inputs.locale });
}

// ---------------------------------------------------------------------------
// Shared v2 parsing helpers
// ---------------------------------------------------------------------------

export interface LaneContractIssue {
  code: string;
  fieldPath: string | null;
  message: string;
}

export interface LaneParseResult<T> {
  accepted: T | null;
  issues: LaneContractIssue[];
}

const FORBIDDEN_CODE_FIELDS: readonly string[] = [
  "runId",
  "auditFingerprint",
  "fingerprint",
  "snapshotId",
  "bundleVersion",
  "projectionHash",
  "projectionSchemaVersion",
  "outputContractVersion",
  "evidenceRead",
  "attempt",
  "spanId",
  "responseId",
  "threadId",
];

/**
 * Contract v2 forbids code-owned identity and version fields anywhere in the
 * model output. They are not "unrelated extras": they would let the model
 * assert an identity that only code may bind.
 */
function collectForbiddenFields(value: unknown, path: string, found: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenFields(item, `${path}[${index}]`, found));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_CODE_FIELDS.includes(key)) found.push(`${path}.${key}`);
    collectForbiddenFields(nested, `${path}.${key}`, found);
  }
}

function forbiddenFieldIssues(raw: unknown, laneLabel: string): LaneContractIssue[] {
  const found: string[] = [];
  collectForbiddenFields(raw, "$", found);
  if (found.length === 0) return [];
  const unique = [...new Set(found)];
  return [{
    code: "OUTPUT_CONTRACT_CODE_FIELD",
    fieldPath: unique[0],
    message: `${laneLabel} v2 must not echo code-owned fields: ${unique.join(", ")}.`,
  }];
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSupport(value: unknown): value is ReportFinding["support"] {
  return value === "strong" || value === "moderate" || value === "limited";
}

export function dedupeIssues(issues: LaneContractIssue[]): LaneContractIssue[] {
  const seen = new Set<string>();
  const result: LaneContractIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.code}|${issue.fieldPath ?? ""}|${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(issue);
  }
  return result;
}

function findEvidenceEntry(directory: LaneDirectory, handle: string): LaneEvidenceEntry | undefined {
  return directory.evidence.find((entry) => entry.handle === handle);
}

export interface SlotBinding {
  handle: string;
  canonicalRef: string;
  slotKind: LaneSlotKind;
  value: EvidenceValue;
  formatted: string;
  label: string;
}

export interface SlotTextResult {
  ok: boolean;
  text: string;
  issues: LaneContractIssue[];
  bindings: SlotBinding[];
}

const SLOT_PATTERN = /\[\[([^[\]]*)\]\]/g;
const SLOT_KINDS: readonly LaneSlotKind[] = ["tokens", "percentage", "count", "duration", "currency", "multiplier", "size", "other"];

interface ParsedSlot {
  kind: LaneSlotKind | null;
  handle: string;
}

function parseSlot(raw: string): ParsedSlot | null {
  const trimmed = raw.trim();
  const match = /^(?:([a-z]+):)?(e[1-9][0-9]*)$/.exec(trimmed);
  if (!match) return null;
  return { kind: (match[1] as LaneSlotKind | undefined) ?? null, handle: match[2] };
}

/**
 * Bind every `[[eN]]` slot in one prose field to the canonical value carried by
 * the current Lane directory. Unknown, private, unavailable and incompatible
 * slots reject the dependent item instead of being guessed.
 */
export function bindSlotText(
  text: string,
  directory: LaneDirectory,
  locale: ReportLocale,
  options: { fieldPath: string; ownerCanonicalId?: string | null },
): SlotTextResult {
  const issues: LaneContractIssue[] = [];
  const bindings: SlotBinding[] = [];
  if (typeof text !== "string") return { ok: true, text, issues, bindings };
  const reject = (message: string): void => {
    issues.push({ code: "EVIDENCE_SLOT_INVALID", fieldPath: options.fieldPath, message });
  };

  const resolved: Array<{ start: number; end: number; replacement: string }> = [];
  SLOT_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SLOT_PATTERN.exec(text)) !== null) {
    const parsed = parseSlot(match[1]);
    if (!parsed) {
      reject(`Slot '[[${match[1]}]]' is not a valid Evidence Directory handle.`);
      continue;
    }
    if (parsed.kind && !SLOT_KINDS.includes(parsed.kind)) {
      reject(`Slot '[[${match[1]}]]' declares an unknown value kind.`);
      continue;
    }
    const entry = findEvidenceEntry(directory, parsed.handle);
    if (!entry) {
      reject(`Slot '[[${match[1]}]]' references a handle that is not in the current Lane directory.`);
      continue;
    }
    if (!entry.citable) {
      reject(`Slot '[[${match[1]}]]' references an entry that cannot be cited.`);
      continue;
    }
    if (entry.displayPolicy !== "allowed" || !entry.value) {
      reject(`Slot '[[${match[1]}]]' references a private or unavailable value and cannot be rendered as a number.`);
      continue;
    }
    if (options.ownerCanonicalId && entry.ownerCanonicalId && entry.ownerCanonicalId !== options.ownerCanonicalId) {
      reject(`Slot '[[${match[1]}]]' belongs to another object than the current Session.`);
      continue;
    }
    if (parsed.kind && !entry.allowedSlotKinds.includes(parsed.kind)) {
      reject(`Slot '[[${match[1]}]]' is incompatible with the value kind of ${entry.canonicalRef}.`);
      continue;
    }
    const slotKind = parsed.kind ?? entry.slotKind;
    if (!slotKind) {
      reject(`Slot '[[${match[1]}]]' has no bound value kind.`);
      continue;
    }
    const formatted = formatSlotValue(entry.value, slotKind, locale);
    bindings.push({ handle: entry.handle, canonicalRef: entry.canonicalRef, slotKind, value: entry.value, formatted, label: entry.label });
    resolved.push({ start: match.index, end: match.index + match[0].length, replacement: formatted });
  }

  let bound = text;
  for (let index = resolved.length - 1; index >= 0; index -= 1) {
    const span = resolved[index];
    bound = bound.slice(0, span.start) + span.replacement + bound.slice(span.end);
  }
  return { ok: issues.length === 0, text: bound, issues, bindings };
}

export interface ResolvedEvidenceRef {
  handle: string;
  canonicalRef: string;
  objectKind: LaneObjectKind;
  metric: string | null;
  ownerCanonicalId: string | null;
}

function resolveEvidenceRef(
  directory: LaneDirectory,
  ref: unknown,
  fieldPath: string,
  options: { allowedObjectKinds?: readonly LaneObjectKind[]; ownerCanonicalId?: string | null },
): { resolved: ResolvedEvidenceRef | null; issues: LaneContractIssue[] } {
  const issues: LaneContractIssue[] = [];
  const handle = evidenceHandle(ref);
  if (!handle) {
    issues.push({ code: "EVIDENCE_REF_INVALID", fieldPath, message: `Evidence reference '${String(ref)}' is not a current directory handle.` });
    return { resolved: null, issues };
  }
  const entry = findEvidenceEntry(directory, handle);
  if (!entry) {
    issues.push({ code: "EVIDENCE_REF_UNKNOWN", fieldPath, message: `Evidence reference '${handle}' is not in the current Lane directory.` });
    return { resolved: null, issues };
  }
  if (!entry.citable) {
    issues.push({ code: "EVIDENCE_REF_INVALID", fieldPath, message: `Evidence reference '${handle}' cannot be cited.` });
    return { resolved: null, issues };
  }
  if (options.allowedObjectKinds && !options.allowedObjectKinds.includes(entry.objectKind)) {
    issues.push({ code: "EVIDENCE_REF_INCOMPATIBLE", fieldPath, message: `Evidence reference '${handle}' is not compatible with this field.` });
    return { resolved: null, issues };
  }
  if (options.ownerCanonicalId && entry.ownerCanonicalId && entry.ownerCanonicalId !== options.ownerCanonicalId) {
    issues.push({ code: "EVIDENCE_REF_CROSS_OBJECT", fieldPath, message: `Evidence reference '${handle}' belongs to another object.` });
    return { resolved: null, issues };
  }
  return {
    resolved: {
      handle: entry.handle,
      canonicalRef: entry.canonicalRef,
      objectKind: entry.objectKind,
      metric: entry.metric,
      ownerCanonicalId: entry.ownerCanonicalId,
    },
    issues,
  };
}

// ---------------------------------------------------------------------------
// Report Synthesis v2
// ---------------------------------------------------------------------------

export interface ReportSynthesisV2Input {
  directory: LaneDirectory;
  locale: ReportLocale;
}

export function parseReportSynthesisV2(raw: unknown, input: ReportSynthesisV2Input): LaneParseResult<ReportSynthesis> {
  const issues: LaneContractIssue[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { accepted: null, issues: [{ code: "REPORT_SYNTHESIS_INVALID", fieldPath: null, message: "Report synthesis output must be a JSON object." }] };
  }
  const contractIssues = forbiddenFieldIssues(raw, "Report synthesis");
  if (contractIssues.length > 0) return { accepted: null, issues: contractIssues };

  const record = raw as Record<string, unknown>;
  const reject = (code: string, fieldPath: string | null, message: string): void => {
    issues.push({ code, fieldPath, message });
  };

  let overview: ReportOverview | null = null;
  if (!record.overview || typeof record.overview !== "object" || Array.isArray(record.overview)) {
    reject("REPORT_SYNTHESIS_INVALID", "overview", "overview must be an object.");
  } else {
    const candidate = record.overview as Record<string, unknown>;
    if (!nonEmptyString(candidate.summary)) {
      reject("REPORT_SYNTHESIS_INVALID", "overview.summary", "overview.summary must be a non-empty string.");
    } else {
      const bound = bindSlotText(candidate.summary, input.directory, input.locale, { fieldPath: "overview.summary" });
      issues.push(...bound.issues);
      const refs = Array.isArray(candidate.evidenceRefs) ? candidate.evidenceRefs : [];
      if (refs.length < 1 || refs.length > 3) {
        reject("REPORT_SYNTHESIS_INVALID", "overview.evidenceRefs", "overview.evidenceRefs must contain one to three directory handles.");
      }
      const canonicalRefs: string[] = [];
      let overviewValid = bound.ok;
      refs.forEach((ref, index) => {
        const resolution = resolveEvidenceRef(input.directory, ref, `overview.evidenceRefs[${index}]`, {});
        issues.push(...resolution.issues);
        if (resolution.resolved) canonicalRefs.push(resolution.resolved.canonicalRef);
        else overviewValid = false;
      });
      if (overviewValid && canonicalRefs.length > 0) {
        overview = { summary: bound.text, evidenceRefs: [...new Set(canonicalRefs)] };
      }
    }
  }

  if (!Array.isArray(record.findings)) {
    reject("REPORT_SYNTHESIS_INVALID", "findings", "findings must be a list.");
    return { accepted: null, issues: dedupeIssues(issues) };
  }
  if (record.findings.length > 5) {
    reject("REPORT_SYNTHESIS_INVALID", "findings", "Report synthesis cannot contain more than five Findings.");
    return { accepted: null, issues: dedupeIssues(issues) };
  }

  const findings: ReportFinding[] = [];
  record.findings.forEach((item, index) => {
    const path = `findings[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      reject("REPORT_SYNTHESIS_INVALID", path, "Finding must be an object.");
      return;
    }
    const finding = item as Record<string, unknown>;
    const itemIssues: LaneContractIssue[] = [];
    if (!nonEmptyString(finding.title)) itemIssues.push({ code: "REPORT_SYNTHESIS_INVALID", fieldPath: `${path}.title`, message: "Finding requires a title." });
    if (!nonEmptyString(finding.analysis)) itemIssues.push({ code: "REPORT_SYNTHESIS_INVALID", fieldPath: `${path}.analysis`, message: "Finding requires analysis." });
    if (!isSupport(finding.support)) itemIssues.push({ code: "REPORT_SYNTHESIS_INVALID", fieldPath: `${path}.support`, message: "Finding has invalid support." });
    if (!Object.prototype.hasOwnProperty.call(finding, "uncertainty") || (finding.uncertainty !== null && !nonEmptyString(finding.uncertainty))) {
      itemIssues.push({ code: "REPORT_SYNTHESIS_INVALID", fieldPath: `${path}.uncertainty`, message: "Finding uncertainty must be null or a non-empty string." });
    }
    const titleBound = nonEmptyString(finding.title)
      ? bindSlotText(finding.title, input.directory, input.locale, { fieldPath: `${path}.title` })
      : { ok: true, text: "", issues: [], bindings: [] };
    const analysisBound = nonEmptyString(finding.analysis)
      ? bindSlotText(finding.analysis, input.directory, input.locale, { fieldPath: `${path}.analysis` })
      : { ok: true, text: "", issues: [], bindings: [] };
    itemIssues.push(...titleBound.issues, ...analysisBound.issues);
    const refs = Array.isArray(finding.evidenceRefs) ? finding.evidenceRefs : [];
    if (refs.length === 0) {
      itemIssues.push({ code: "REPORT_SYNTHESIS_INVALID", fieldPath: `${path}.evidenceRefs`, message: "Finding requires at least one Evidence reference." });
    }
    const canonicalRefs: string[] = [];
    refs.forEach((ref, refIndex) => {
      const resolution = resolveEvidenceRef(input.directory, ref, `${path}.evidenceRefs[${refIndex}]`, {});
      itemIssues.push(...resolution.issues);
      if (resolution.resolved) canonicalRefs.push(resolution.resolved.canonicalRef);
    });
    if (itemIssues.length > 0) {
      issues.push(...itemIssues);
      return;
    }
    findings.push({
      title: titleBound.text,
      analysis: analysisBound.text,
      evidenceRefs: [...new Set(canonicalRefs)],
      support: finding.support as ReportFinding["support"],
      uncertainty: (finding.uncertainty as string | null) ?? null,
    });
  });

  const reason = nonEmptyString(record.noStrongFindingReason) ? record.noStrongFindingReason.trim() : null;
  if (findings.length === 0 && !reason) {
    reject("REPORT_SYNTHESIS_INVALID", null, "Report synthesis has no valid findings and no valid noStrongFindingReason.");
    return { accepted: null, issues: dedupeIssues(issues) };
  }
  if (findings.length === 0 && overview === null) {
    reject("REPORT_SYNTHESIS_INVALID", null, "Report synthesis has no valid findings and no valid overview.");
    return { accepted: null, issues: dedupeIssues(issues) };
  }

  return {
    accepted: {
      auditFingerprint: "",
      overview,
      findings,
      noStrongFindingReason: findings.length > 0 ? null : reason,
    },
    issues: dedupeIssues(issues),
  };
}

// ---------------------------------------------------------------------------
// Key Session Analysis v2
// ---------------------------------------------------------------------------

export interface KeySessionV2Input {
  directory: LaneDirectory;
  locale: ReportLocale;
  sessions: readonly { key: string }[];
  audit?: AuditResult;
}

export function parseKeySessionAnalysesV2(raw: unknown, input: KeySessionV2Input): LaneParseResult<KeySessionAnalysis[]> {
  const issues: LaneContractIssue[] = [];
  if (!Array.isArray(raw)) {
    return { accepted: null, issues: [{ code: "KEY_SESSION_INVALID", fieldPath: null, message: "Key Session Analysis output must be a JSON array." }] };
  }
  const contractIssues = forbiddenFieldIssues(raw, "Key Session Analysis");
  if (contractIssues.length > 0) return { accepted: null, issues: contractIssues };

  const topSessionIds = new Set(input.sessions.map((session) => session.key));
  const accepted: KeySessionAnalysis[] = [];
  const seenSessions = new Set<string>();
  const seenSignatures = new Set<string>();
  const reject = (fieldPath: string | null, message: string): void => {
    issues.push({ code: "KEY_SESSION_INVALID", fieldPath, message });
  };

  raw.forEach((item, index) => {
    const path = `[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      reject(path, "Key Session Analysis entry is malformed.");
      return;
    }
    const record = item as Record<string, unknown>;
    const handle = sessionHandle(record.sessionHandle);
    if (!handle) {
      reject(`${path}.sessionHandle`, "sessionHandle must be a current Lane directory session handle.");
      return;
    }
    const session = input.directory.sessions.find((entry) => entry.handle === handle);
    if (!session) {
      issues.push({ code: "EVIDENCE_REF_UNKNOWN", fieldPath: `${path}.sessionHandle`, message: `Session handle '${handle}' is not in the current Lane directory.` });
      return;
    }
    if (!topSessionIds.has(session.canonicalId)) {
      reject(`${path}.sessionHandle`, `Session handle '${handle}' is outside the Token-ranked Top 3.`);
      return;
    }
    const itemIssues: LaneContractIssue[] = [];
    if (!nonEmptyString(record.taskContext)) {
      itemIssues.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.taskContext`, message: "taskContext is required." });
    }
    const taskContext = nonEmptyString(record.taskContext)
      ? bindSlotText(record.taskContext, input.directory, input.locale, { fieldPath: `${path}.taskContext`, ownerCanonicalId: session.canonicalId })
      : { ok: true, text: "", issues: [], bindings: [] };
    itemIssues.push(...taskContext.issues);
    if (!taskContext.ok || !nonEmptyString(taskContext.text)) {
      issues.push(...itemIssues);
      return;
    }

    let primaryFinding: KeySessionAnalysis["primaryFinding"] = null;
    const findingIssues: LaneContractIssue[] = [];
    if (record.primaryFinding !== null && record.primaryFinding !== undefined) {
      if (typeof record.primaryFinding !== "object" || Array.isArray(record.primaryFinding)) {
        findingIssues.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.primaryFinding`, message: "primaryFinding must be an object or null." });
      } else {
        const finding = record.primaryFinding as Record<string, unknown>;
        if (!nonEmptyString(finding.observation) || !nonEmptyString(finding.interpretation)) {
          findingIssues.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.primaryFinding`, message: "primaryFinding observation and interpretation are required." });
        }
        if (!isSupport(finding.support)) {
          findingIssues.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.primaryFinding.support`, message: "primaryFinding support is invalid." });
        }
        const alternatives = Array.isArray(finding.alternativeExplanations) ? finding.alternativeExplanations : [];
        if (!alternatives.every(nonEmptyString)) {
          findingIssues.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.primaryFinding.alternativeExplanations`, message: "alternativeExplanations must be a list of non-empty strings." });
        }
        const observation = nonEmptyString(finding.observation)
          ? bindSlotText(finding.observation, input.directory, input.locale, { fieldPath: `${path}.primaryFinding.observation`, ownerCanonicalId: session.canonicalId })
          : { ok: true, text: "", issues: [], bindings: [] };
        const interpretation = nonEmptyString(finding.interpretation)
          ? bindSlotText(finding.interpretation, input.directory, input.locale, { fieldPath: `${path}.primaryFinding.interpretation`, ownerCanonicalId: session.canonicalId })
          : { ok: true, text: "", issues: [], bindings: [] };
        findingIssues.push(...observation.issues, ...interpretation.issues);
        const evidenceIds = Array.isArray(finding.evidenceIds) ? finding.evidenceIds : [];
        if (evidenceIds.length === 0) {
          findingIssues.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.primaryFinding.evidenceIds`, message: "primaryFinding must cite at least one Evidence handle." });
        }
        const canonicalEvidence: string[] = [];
        evidenceIds.forEach((ref, refIndex) => {
          const resolution = resolveEvidenceRef(input.directory, ref, `${path}.primaryFinding.evidenceIds[${refIndex}]`, {
            allowedObjectKinds: ["turn"],
            ownerCanonicalId: session.canonicalId,
          });
          findingIssues.push(...resolution.issues);
          if (resolution.resolved) canonicalEvidence.push(resolution.resolved.canonicalRef);
        });
        if (findingIssues.length === 0) {
          primaryFinding = {
            observation: observation.text,
            interpretation: interpretation.text,
            evidenceIds: [...new Set(canonicalEvidence)],
            support: finding.support as "strong" | "moderate" | "limited",
            alternativeExplanations: alternatives as string[],
          };
        }
      }
    }

    let recommendation: KeySessionAnalysis["recommendation"] = null;
    const recIssues: LaneContractIssue[] = [];
    if (record.recommendation !== null && record.recommendation !== undefined) {
      if (typeof record.recommendation !== "object" || Array.isArray(record.recommendation)) {
        recIssues.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.recommendation`, message: "recommendation must be an object or null." });
      } else {
        const rec = record.recommendation as Record<string, unknown>;
        if (!nonEmptyString(rec.action) || !nonEmptyString(rec.rationale) || !nonEmptyString(rec.applicability) || !nonEmptyString(rec.verification)) {
          recIssues.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.recommendation`, message: "recommendation requires action, rationale, applicability, and verification." });
        }
        if (rec.tradeoff !== null && rec.tradeoff !== undefined && !nonEmptyString(rec.tradeoff)) {
          recIssues.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.recommendation.tradeoff`, message: "recommendation tradeoff must be null or a non-empty string." });
        }
        const fields = (["action", "rationale", "applicability", "verification"] as const).map((field) => {
          const value = rec[field];
          return nonEmptyString(value)
            ? bindSlotText(value, input.directory, input.locale, { fieldPath: `${path}.recommendation.${field}`, ownerCanonicalId: session.canonicalId })
            : { ok: true, text: "", issues: [], bindings: [] };
        });
        for (const bound of fields) recIssues.push(...bound.issues);
        const targets = Array.isArray(rec.targetEvidenceIds) ? rec.targetEvidenceIds : [];
        const canonicalTargets: string[] = [];
        targets.forEach((ref, refIndex) => {
          const resolution = resolveEvidenceRef(input.directory, ref, `${path}.recommendation.targetEvidenceIds[${refIndex}]`, {
            allowedObjectKinds: ["turn"],
            ownerCanonicalId: session.canonicalId,
          });
          recIssues.push(...resolution.issues);
          if (resolution.resolved) canonicalTargets.push(resolution.resolved.canonicalRef);
        });
        if (recIssues.length === 0) {
          recommendation = {
            action: fields[0].text,
            rationale: fields[1].text,
            applicability: fields[2].text,
            tradeoff: (rec.tradeoff as string | null) ?? null,
            verification: fields[3].text,
            targetEvidenceIds: [...new Set(canonicalTargets)],
          };
        }
      }
    }

    const rawLimitations = Array.isArray(record.limitations) ? record.limitations.filter(nonEmptyString) : [];
    const limitations: string[] = [...rawLimitations];

    if (findingIssues.length > 0) {
      primaryFinding = null;
      if (recommendation !== null || (record.recommendation !== null && record.recommendation !== undefined)) {
        recommendation = null;
        recIssues.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.recommendation`, message: "recommendation must be null when primaryFinding is null." });
      }
      const missingMechanismLimitation = "Primary mechanism was unavailable or failed validation; specific task is retained with limitations.";
      if (!limitations.includes(missingMechanismLimitation)) {
        limitations.push(missingMechanismLimitation);
      }
    }

    if (primaryFinding === null) {
      if (recommendation !== null) {
        recommendation = null;
        recIssues.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.recommendation`, message: "recommendation must be null when primaryFinding is null." });
      }
      if (limitations.length === 0) {
        issues.push(...itemIssues, ...findingIssues, ...recIssues, { code: "KEY_SESSION_INVALID", fieldPath: `${path}.limitations`, message: "limitations must be a list of non-empty strings." });
        return;
      }
    } else if (recommendation === null) {
      const droppedRecReason = "Recommendation was unavailable or failed validation; primary finding is retained.";
      if (!limitations.includes(droppedRecReason)) {
        limitations.push(droppedRecReason);
      }
    }

    issues.push(...itemIssues, ...findingIssues, ...recIssues);

    if (seenSessions.has(session.canonicalId)) {
      issues.push({
        code: "DUPLICATE_SESSION_ENTRY",
        fieldPath: `${path}.sessionHandle`,
        message: `Duplicate entry for Session '${session.canonicalId}'; only the first valid entry is retained.`,
      });
      return;
    }

    const candidateAnalysis: KeySessionAnalysis = {
      sessionId: session.canonicalId,
      auditFingerprint: "",
      taskContext: taskContext.text,
      primaryFinding,
      recommendation,
      evidenceRead: { turnIds: [], selectionReason: "", unreadScope: "" },
      limitations,
    };

    if (input.audit) {
      const signature = normalizedFinding(input.audit, candidateAnalysis);
      if (signature !== null && seenSignatures.has(signature)) {
        issues.push({
          code: "DUPLICATE_ANALYSIS_PROSE",
          fieldPath: path,
          message: "Duplicate analysis prose across Sessions; only the first valid entry is retained.",
        });
        return;
      }
      if (signature !== null) seenSignatures.add(signature);
    }

    seenSessions.add(session.canonicalId);
    accepted.push(candidateAnalysis);
  });

  if (accepted.length === 0) {
    reject(null, "No Key Session Analysis entry passed v2 directory binding.");
    return { accepted: null, issues: dedupeIssues(issues) };
  }
  return { accepted, issues: dedupeIssues(issues) };
}

export interface KeySessionAcceptanceInput {
  audit: AuditResult;
  contractVersion: 1 | 2;
  raw: unknown;
  directory?: LaneDirectory | null;
  locale: ReportLocale;
  packets?: ContentEvidencePacket[];
  runFingerprint?: string;
}

export interface KeySessionAcceptanceResult {
  accepted: KeySessionAnalysis[] | null;
  validationAccepted: boolean;
  errors: Array<{ code: string; fieldPath: string | null; message: string }>;
}

export function laneIssueErrors(
  issues: readonly LaneContractIssue[],
  fallbackCode: string,
): Array<{ code: string; fieldPath: string | null; message: string }> {
  return issues.map((issue) => ({
    code: issue.code || fallbackCode,
    fieldPath: issue.fieldPath ?? null,
    message: issue.message,
  }));
}

export function dedupeErrors(errors: Array<{ code: string; fieldPath: string | null; message: string }>): Array<{ code: string; fieldPath: string | null; message: string }> {
  const seen = new Set<string>();
  const result: Array<{ code: string; fieldPath: string | null; message: string }> = [];
  for (const err of errors) {
    const key = `${err.code}::${err.fieldPath ?? ""}::${err.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(err);
    }
  }
  return result;
}

export function acceptKeySessionAnalyses(input: KeySessionAcceptanceInput): KeySessionAcceptanceResult {
  const { audit, contractVersion, raw, directory, locale, packets, runFingerprint } = input;
  const errors: Array<{ code: string; fieldPath: string | null; message: string }> = [];

  if (!Array.isArray(raw)) {
    return {
      accepted: null,
      validationAccepted: false,
      errors: [{ code: "KEY_SESSION_INVALID", fieldPath: null, message: "Key Session Analysis output must be a JSON array." }],
    };
  }

  if (contractVersion === 2) {
    if (!isLaneDirectory(directory)) {
      return {
        accepted: null,
        validationAccepted: false,
        errors: [{ code: "LANE_DIRECTORY_UNAVAILABLE", fieldPath: null, message: "The current Lane projection does not carry a verifiable Evidence Directory." }],
      };
    }
    const contractIssues = forbiddenFieldIssues(raw, "Key Session Analysis");
    if (contractIssues.length > 0) {
      return {
        accepted: null,
        validationAccepted: false,
        errors: laneIssueErrors(contractIssues, "KEY_SESSION_INVALID"),
      };
    }
  }

  const topSessionIds = new Set(audit.rankings.sessions.slice(0, 3).map((session) => session.key));
  const candidates = Array.isArray(raw) ? raw : [];
  if (candidates.length === 0) {
    return {
      accepted: null,
      validationAccepted: false,
      errors: [{ code: "KEY_SESSION_INVALID", fieldPath: null, message: "Expected a non-empty Key Session Analysis array." }],
    };
  }

  const acceptedCandidates: KeySessionAnalysis[] = [];
  const seenFinalSessions = new Set<string>();
  const seenFinalSignatures = new Set<string>();

  for (const [index, item] of candidates.entries()) {
    const path = `[${index}]`;
    const candidateErrors: Array<{ code: string; fieldPath: string | null; message: string }> = [];

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push({ code: "KEY_SESSION_INVALID", fieldPath: path, message: "Key Session Analysis entry is malformed." });
      continue;
    }
    const record = item as Record<string, unknown>;

    // 1. Session 判定
    let canonicalSessionId: string | null = null;
    if (contractVersion === 2) {
      const handle = sessionHandle(record.sessionHandle);
      if (!handle) {
        errors.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.sessionHandle`, message: "sessionHandle must be a current Lane directory session handle." });
        continue;
      }
      const session = directory!.sessions.find((entry) => entry.handle === handle);
      if (!session) {
        errors.push({ code: "EVIDENCE_REF_UNKNOWN", fieldPath: `${path}.sessionHandle`, message: `Session handle '${handle}' is not in the current Lane directory.` });
        continue;
      }
      if (!topSessionIds.has(session.canonicalId)) {
        errors.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.sessionHandle`, message: `Session handle '${handle}' is outside the Token-ranked Top 3.` });
        continue;
      }
      canonicalSessionId = session.canonicalId;
    } else {
      if (typeof record.sessionId !== "string" || !topSessionIds.has(record.sessionId)) {
        errors.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.sessionId`, message: "Key Session Analysis entry has missing or invalid sessionId." });
        continue;
      }
      canonicalSessionId = record.sessionId;
    }

    // 2. TaskContext 判定
    let taskContextText: string | null = null;
    if (contractVersion === 2) {
      if (!nonEmptyString(record.taskContext)) {
        candidateErrors.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.taskContext`, message: "taskContext is required." });
      } else {
        const bound = bindSlotText(record.taskContext, directory!, locale, { fieldPath: `${path}.taskContext`, ownerCanonicalId: canonicalSessionId });
        candidateErrors.push(...laneIssueErrors(bound.issues, "KEY_SESSION_INVALID"));
        if (bound.ok && nonEmptyString(bound.text)) taskContextText = bound.text;
      }
    } else {
      if (!nonEmptyString(record.taskContext)) {
        candidateErrors.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.taskContext`, message: "taskContext is required." });
      } else {
        taskContextText = record.taskContext.trim();
      }
    }

    if (!taskContextText) {
      errors.push(...candidateErrors);
      continue;
    }

    // 3. PrimaryFinding 检查
    let primaryFinding: KeySessionAnalysis["primaryFinding"] = null;
    let findingValid = false;
    const findingProvided = record.primaryFinding !== null && record.primaryFinding !== undefined;

    if (findingProvided) {
      if (typeof record.primaryFinding !== "object" || Array.isArray(record.primaryFinding)) {
        candidateErrors.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.primaryFinding`, message: "primaryFinding must be an object or null." });
      } else {
        const finding = record.primaryFinding as Record<string, unknown>;
        const findingIssues: Array<{ code: string; fieldPath: string | null; message: string }> = [];
        if (!nonEmptyString(finding.observation) || !nonEmptyString(finding.interpretation)) {
          findingIssues.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.primaryFinding`, message: "primaryFinding observation and interpretation are required." });
        }
        if (!isSupport(finding.support)) {
          findingIssues.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.primaryFinding.support`, message: "primaryFinding support is invalid." });
        }
        const alternatives = Array.isArray(finding.alternativeExplanations) ? finding.alternativeExplanations : [];
        if (!alternatives.every(nonEmptyString)) {
          findingIssues.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.primaryFinding.alternativeExplanations`, message: "alternativeExplanations must be a list of non-empty strings." });
        }

        let obsText = "";
        let intText = "";
        const canonicalEvidence: string[] = [];

        if (contractVersion === 2) {
          const obsBound = nonEmptyString(finding.observation)
            ? bindSlotText(finding.observation, directory!, locale, { fieldPath: `${path}.primaryFinding.observation`, ownerCanonicalId: canonicalSessionId })
            : { ok: true, text: "", issues: [] };
          const intBound = nonEmptyString(finding.interpretation)
            ? bindSlotText(finding.interpretation, directory!, locale, { fieldPath: `${path}.primaryFinding.interpretation`, ownerCanonicalId: canonicalSessionId })
            : { ok: true, text: "", issues: [] };
          findingIssues.push(...laneIssueErrors(obsBound.issues, "KEY_SESSION_INVALID"), ...laneIssueErrors(intBound.issues, "KEY_SESSION_INVALID"));
          obsText = obsBound.text;
          intText = intBound.text;

          const evidenceIds = Array.isArray(finding.evidenceIds) ? finding.evidenceIds : [];
          if (evidenceIds.length === 0) {
            findingIssues.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.primaryFinding.evidenceIds`, message: "primaryFinding must cite at least one Evidence handle." });
          }
          evidenceIds.forEach((ref, refIndex) => {
            const resolution = resolveEvidenceRef(directory!, ref, `${path}.primaryFinding.evidenceIds[${refIndex}]`, {
              allowedObjectKinds: ["turn"],
              ownerCanonicalId: canonicalSessionId,
            });
            findingIssues.push(...laneIssueErrors(resolution.issues, "KEY_SESSION_INVALID"));
            if (resolution.resolved) canonicalEvidence.push(resolution.resolved.canonicalRef);
          });
        } else {
          obsText = typeof finding.observation === "string" ? finding.observation.trim() : "";
          intText = typeof finding.interpretation === "string" ? finding.interpretation.trim() : "";
          const evidenceIds = Array.isArray(finding.evidenceIds) ? finding.evidenceIds : [];
          if (evidenceIds.length === 0 || !evidenceIds.every(nonEmptyString)) {
            findingIssues.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.primaryFinding.evidenceIds`, message: "primaryFinding must cite at least one Evidence ID." });
          } else {
            for (const ref of evidenceIds) {
              const match = resolveReportEvidence(audit, ref);
              if (!match || (match.kind === "turn" && match.evidence[0] && (match.evidence[0] as any).sessionId && (match.evidence[0] as any).sessionId !== canonicalSessionId)) {
                findingIssues.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.primaryFinding.evidenceIds`, message: `primaryFinding Evidence is unknown or cross-Session: ${ref}` });
              } else {
                canonicalEvidence.push(ref);
              }
            }
          }
        }

        if (findingIssues.length === 0 && nonEmptyString(obsText) && nonEmptyString(intText) && canonicalEvidence.length > 0) {
          primaryFinding = {
            observation: obsText,
            interpretation: intText,
            evidenceIds: [...new Set(canonicalEvidence)],
            support: finding.support as "strong" | "moderate" | "limited",
            alternativeExplanations: alternatives as string[],
          };
          findingValid = true;
        } else {
          candidateErrors.push(...findingIssues);
        }
      }
    }

    // 4. Recommendation 检查
    let recommendation: KeySessionAnalysis["recommendation"] = null;
    let recValid = false;
    const recProvided = record.recommendation !== null && record.recommendation !== undefined;

    if (recProvided) {
      if (typeof record.recommendation !== "object" || Array.isArray(record.recommendation)) {
        candidateErrors.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.recommendation`, message: "recommendation must be an object or null." });
      } else {
        const rec = record.recommendation as Record<string, unknown>;
        const recIssues: Array<{ code: string; fieldPath: string | null; message: string }> = [];
        if (!nonEmptyString(rec.action) || !nonEmptyString(rec.rationale) || !nonEmptyString(rec.applicability) || !nonEmptyString(rec.verification)) {
          recIssues.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.recommendation`, message: "recommendation requires action, rationale, applicability, and verification." });
        }
        if (rec.tradeoff !== null && rec.tradeoff !== undefined && !nonEmptyString(rec.tradeoff)) {
          recIssues.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.recommendation.tradeoff`, message: "recommendation tradeoff must be null or a non-empty string." });
        }

        const canonicalTargets: string[] = [];
        let boundFields: string[] = [];

        if (contractVersion === 2) {
          const fields = (["action", "rationale", "applicability", "verification"] as const).map((field) => {
            const value = rec[field];
            return nonEmptyString(value)
              ? bindSlotText(value, directory!, locale, { fieldPath: `${path}.recommendation.${field}`, ownerCanonicalId: canonicalSessionId })
              : { ok: true, text: "", issues: [] };
          });
          for (const bound of fields) recIssues.push(...laneIssueErrors(bound.issues, "KEY_SESSION_INVALID"));
          boundFields = fields.map((f) => f.text);

          const targets = Array.isArray(rec.targetEvidenceIds) ? rec.targetEvidenceIds : [];
          targets.forEach((ref, refIndex) => {
            const resolution = resolveEvidenceRef(directory!, ref, `${path}.recommendation.targetEvidenceIds[${refIndex}]`, {
              allowedObjectKinds: ["turn"],
              ownerCanonicalId: canonicalSessionId,
            });
            recIssues.push(...laneIssueErrors(resolution.issues, "KEY_SESSION_INVALID"));
            if (resolution.resolved) canonicalTargets.push(resolution.resolved.canonicalRef);
          });
        } else {
          boundFields = (["action", "rationale", "applicability", "verification"] as const).map((field) => {
            const val = rec[field];
            return typeof val === "string" ? val.trim() : "";
          });
          const targets = Array.isArray(rec.targetEvidenceIds) ? rec.targetEvidenceIds : [];
          for (const ref of targets) {
            if (typeof ref === "string") {
              const match = resolveReportEvidence(audit, ref);
              if (match) canonicalTargets.push(ref);
              else recIssues.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.recommendation.targetEvidenceIds`, message: `recommendation Evidence is unknown or cross-Session: ${ref}` });
            }
          }
        }

        if (recIssues.length === 0 && boundFields.every(nonEmptyString)) {
          recommendation = {
            action: boundFields[0],
            rationale: boundFields[1],
            applicability: boundFields[2],
            tradeoff: (rec.tradeoff as string | null) ?? null,
            verification: boundFields[3],
            targetEvidenceIds: [...new Set(canonicalTargets)],
          };
          recValid = true;
        } else {
          candidateErrors.push(...recIssues);
        }
      }
    }

    // 5. 依赖判定与未知限制构建（AC-3）
    const rawLimitations = Array.isArray(record.limitations) ? record.limitations.filter(nonEmptyString) : [];
    const limitations: string[] = [...rawLimitations];

    if (!findingValid) {
      primaryFinding = null;
      if (recommendation !== null || recProvided) {
        recommendation = null;
        candidateErrors.push({ code: "KEY_SESSION_INVALID", fieldPath: `${path}.recommendation`, message: "recommendation must be null when primaryFinding is null." });
      }
      const missingMechanismLimitation = "Primary mechanism was unavailable or failed validation; specific task is retained with limitations.";
      if (!limitations.includes(missingMechanismLimitation)) {
        limitations.push(missingMechanismLimitation);
      }
    } else {
      if (!recValid) {
        recommendation = null;
        const missingRecLimitation = "Recommendation was unavailable or failed validation; primary finding is retained.";
        if (!limitations.includes(missingRecLimitation)) {
          limitations.push(missingRecLimitation);
        }
      }
    }

    // 6. 绑定 packets 与 evidenceRead
    const sessionPackets = packets?.filter((packet) => packet.sessionId === canonicalSessionId) ?? [];
    const packet = sessionPackets.find((p) => p.sessionId === canonicalSessionId && p.turnIds.length > 0);
    const fallbackTurnIds = (audit.turns ?? [])
      .filter((turn) => turn.sessionId === canonicalSessionId)
      .map((turn) => turn.turnId);

    const candidateObj: KeySessionAnalysis = {
      sessionId: canonicalSessionId,
      auditFingerprint: contractVersion === 1
        ? (typeof record.auditFingerprint === "string" ? record.auditFingerprint : "")
        : (runFingerprint ?? auditFingerprint(audit)),
      taskContext: taskContextText,
      primaryFinding,
      recommendation,
      evidenceRead: packet
        ? { turnIds: packet.turnIds, selectionReason: packet.selectionReason, unreadScope: packet.unreadScope }
        : {
            turnIds: fallbackTurnIds,
            selectionReason: "No Content Evidence packet was supplied for this Session; the canonical Audit Turns define the read scope.",
            unreadScope: "No bounded Content Evidence was available for this Session.",
          },
      limitations,
    };

    // 7. Sanitizer
    const { sanitized, redactions } = sanitizeKeySessionAnalysis(candidateObj, sessionPackets);
    for (const redact of redactions) {
      candidateErrors.push({
        code: "RAW_EVIDENCE_REDACTED",
        fieldPath: `${path}.${redact.fieldPath}`,
        message: `Redacted ${redact.count} raw evidence instance(s).`,
      });
    }

    // 8. Validator 校验
    let finalCandidate: KeySessionAnalysis | null = null;
    const valResult = validateKeySessionAnalysis(audit, sanitized, sessionPackets);

    if (valResult.valid && valResult.analysis) {
      finalCandidate = valResult.analysis;
    } else {
      const fatalErrors = valResult.errors.filter((msg) =>
        msg.includes("fingerprint") ||
        msg.includes("outside the Token-ranked Top 3") ||
        (msg.includes("credentials") && typeof sanitized.taskContext === "string" && /api_key|sk-[a-zA-Z0-9_-]+/i.test(sanitized.taskContext))
      );
      candidateErrors.push(...valResult.errors.map((msg) => ({ code: "KEY_SESSION_INVALID", fieldPath: path, message: msg })));
      if (fatalErrors.length === 0 && sanitized.primaryFinding !== null) {
        // Validate the mechanism independently before removing its dependent action.
        const withoutRecommendation: KeySessionAnalysis = {
          ...sanitized,
          recommendation: null,
          limitations: [...sanitized.limitations, "Recommendation was unavailable or failed validation; primary finding is retained."],
        };
        const mechanismVal = validateKeySessionAnalysis(audit, withoutRecommendation, sessionPackets);
        const fallbackObj: KeySessionAnalysis = {
          ...sanitized,
          primaryFinding: null,
          recommendation: null,
          limitations: [...sanitized.limitations, "Primary mechanism failed validation; specific task is retained with limitations."],
        };
        const retryVal = mechanismVal.valid ? mechanismVal : validateKeySessionAnalysis(audit, fallbackObj, sessionPackets);
        if (retryVal.valid && retryVal.analysis) {
          finalCandidate = retryVal.analysis;
        } else {
          candidateErrors.push(...retryVal.errors.map((msg) => ({ code: "KEY_SESSION_INVALID", fieldPath: path, message: msg })));
        }
      }
    }

    if (!finalCandidate) {
      errors.push(...candidateErrors);
      continue;
    }

    // 9. 最终去重（AC-2）：只有最终通过领域处理的合法项才参与去重！
    if (seenFinalSessions.has(finalCandidate.sessionId)) {
      candidateErrors.push({
        code: "DUPLICATE_SESSION_ENTRY",
        fieldPath: path,
        message: `Duplicate entry for Session '${finalCandidate.sessionId}'; only the first valid entry is retained.`,
      });
      errors.push(...candidateErrors);
      continue;
    }

    const signature = normalizedFinding(audit, finalCandidate);
    if (signature !== null && seenFinalSignatures.has(signature)) {
      candidateErrors.push({
        code: "DUPLICATE_ANALYSIS_PROSE",
        fieldPath: path,
        message: "Duplicate analysis prose across Sessions; only the first valid entry is retained.",
      });
      errors.push(...candidateErrors);
      continue;
    }

    seenFinalSessions.add(finalCandidate.sessionId);
    if (signature !== null) seenFinalSignatures.add(signature);
    acceptedCandidates.push(finalCandidate);
    errors.push(...candidateErrors);
    if (acceptedCandidates.length >= 3) break;
  }

  const validationAccepted = acceptedCandidates.length > 0;
  return {
    accepted: validationAccepted ? acceptedCandidates : null,
    validationAccepted,
    errors: dedupeErrors(errors),
  };
}

// ---------------------------------------------------------------------------
// Skill Insights v2
// ---------------------------------------------------------------------------

const ALLOWED_ROLES = new Set<SkillSemanticRole>([
  "capability",
  "specializedCapability",
  "localFact",
  "hardConstraint",
  "tool",
  "decisionRule",
  "genericProcedure",
]);
const ALLOWED_LOADING_SCOPES = new Set<SkillLoadingScope>(["always", "task_scoped", "reference_candidate", "unclear"]);
const ALLOWED_V2_REJECTION_REASONS = new Set<SkillInsightRejectionReason>([
  "missing_unique_capability_evidence",
  "missing_model_native_counterevidence",
  "insufficient_content_support",
  "usage_content_relation_unclear",
  "family_content_unavailable",
  "duplicate_mental_model_shift",
]);
const ALLOWED_REVEAL_PATTERNS = new Set(["share_inversion", "distribution_outlier", "family_concentration", "content_contrast"]);

function metricEvidenceKindFor(entry: LaneEvidenceEntry): SkillInsightEvidenceKind {
  if (entry.canonicalRef.startsWith("distribution:")) return "distribution_metric";
  if (entry.canonicalRef.startsWith("global:")) return "global_metric";
  if (entry.objectKind === "family") return "family_metric";
  return "skill_metric";
}

export interface SkillInsightsV2Input {
  directory: LaneDirectory;
  contentByHandle: Map<string, string>;
  snapshotId: string;
}

export interface SkillInsightsV2Accepted {
  snapshotId: string;
  insights: ValidatedSkillInsight[];
  contentProfiles: SkillContentProfile[];
  rejectionReasons: SkillInsightRejectionReason[];
}

function resolveContentRef(
  directory: LaneDirectory,
  contentByHandle: Map<string, string>,
  value: unknown,
  fieldPath: string,
  ownerSkillHandle: string | null,
): { text: string; ref: string; skillId: string | null } | null {
  const ref = contentHandle(value);
  if (!ref) {
    return null;
  }
  const entry = directory.content.find((candidate) => candidate.handle === ref);
  if (!entry) return null;
  if (ownerSkillHandle && entry.skillHandle !== ownerSkillHandle) return null;
  if (!entry.available) return null;
  const text = contentByHandle.get(ref);
  if (typeof text !== "string") return null;
  return { text, ref, skillId: entry.skillId };
}

function parseSkillContentProfilesV2(
  raw: unknown,
  input: SkillInsightsV2Input,
  issues: LaneContractIssue[],
): SkillContentProfile[] {
  if (!Array.isArray(raw)) return [];
  const profiles: SkillContentProfile[] = [];
  raw.forEach((item, index) => {
    const path = `contentProfiles[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const record = item as Record<string, unknown>;
    const handle = skillHandle(record.skillHandle);
    const skill = handle ? input.directory.skills.find((entry) => entry.handle === handle) : undefined;
    if (!handle || !skill) {
      issues.push({ code: "SKILL_INSIGHTS_INVALID", fieldPath: `${path}.skillHandle`, message: "contentProfiles requires a current Skill handle." });
      return;
    }
    const contentSummary = nonEmptyString(record.contentSummary) ? record.contentSummary.trim() : "";
    if (!contentSummary) {
      issues.push({ code: "SKILL_INSIGHTS_INVALID", fieldPath: `${path}.contentSummary`, message: "contentProfiles requires a content summary." });
      return;
    }
    const requireContent = (value: unknown, fieldPath: string): { text: string; ref: string } | null => {
      const resolved = resolveContentRef(input.directory, input.contentByHandle, value, fieldPath, handle);
      if (!resolved) {
        issues.push({
          code: contentHandle(value) ? "CONTENT_REF_INCOMPATIBLE" : "CONTENT_REF_INVALID",
          fieldPath,
          message: `Content reference '${String(value)}' is not an available content handle of this Skill.`,
        });
        return null;
      }
      return resolved;
    };

    const lossIfRemoved: SkillContentProfile["lossIfRemoved"] = [];
    for (const [entryIndex, entry] of (Array.isArray(record.lossIfRemoved) ? record.lossIfRemoved : []).entries()) {
      if (!entry || typeof entry !== "object") continue;
      const candidate = entry as Record<string, unknown>;
      const summary = nonEmptyString(candidate.summary) ? candidate.summary.trim() : "";
      const role = typeof candidate.role === "string" && ALLOWED_ROLES.has(candidate.role as SkillSemanticRole) && candidate.role !== "genericProcedure"
        ? candidate.role as SkillContentProfile["lossIfRemoved"][number]["role"]
        : undefined;
      const why = nonEmptyString(candidate.whyModelWouldNotKnowThis) ? candidate.whyModelWouldNotKnowThis.trim() : "";
      const loadingScope = typeof candidate.loadingScope === "string" && ALLOWED_LOADING_SCOPES.has(candidate.loadingScope as SkillLoadingScope)
        ? candidate.loadingScope as SkillLoadingScope
        : undefined;
      if (!summary || !role || !why || !loadingScope) {
        issues.push({ code: "SKILL_INSIGHTS_INVALID", fieldPath: `${path}.lossIfRemoved[${entryIndex}]`, message: "lossIfRemoved entry is incomplete." });
        continue;
      }
      const content = requireContent(candidate.contentRef, `${path}.lossIfRemoved[${entryIndex}].contentRef`);
      if (!content) continue;
      lossIfRemoved.push({ summary, role, evidenceExcerpt: content.text, whyModelWouldNotKnowThis: why, loadingScope });
    }

    const modelNativeScaffold: SkillContentProfile["modelNativeScaffold"] = [];
    for (const [entryIndex, entry] of (Array.isArray(record.modelNativeScaffold) ? record.modelNativeScaffold : []).entries()) {
      if (!entry || typeof entry !== "object") continue;
      const candidate = entry as Record<string, unknown>;
      const summary = nonEmptyString(candidate.summary) ? candidate.summary.trim() : "";
      const observed = nonEmptyString(candidate.observed) ? candidate.observed.trim() : "";
      const interpretation = nonEmptyString(candidate.interpretation) ? candidate.interpretation.trim() : "";
      const rationale = nonEmptyString(candidate.rationale) ? candidate.rationale.trim() : "";
      const relativeTo = candidate.relativeTo === "capable-current-coding-agent" ? candidate.relativeTo : undefined;
      if (!summary || !observed || !interpretation || !rationale || !relativeTo) {
        issues.push({ code: "SKILL_INSIGHTS_INVALID", fieldPath: `${path}.modelNativeScaffold[${entryIndex}]`, message: "modelNativeScaffold entry is incomplete." });
        continue;
      }
      const content = requireContent(candidate.contentRef, `${path}.modelNativeScaffold[${entryIndex}].contentRef`);
      if (!content) continue;
      modelNativeScaffold.push({ summary, evidenceExcerpt: content.text, observed, interpretation, rationale, relativeTo });
    }

    const scopedContent: SkillContentProfile["scopedContent"] = [];
    for (const [entryIndex, entry] of (Array.isArray(record.scopedContent) ? record.scopedContent : []).entries()) {
      if (!entry || typeof entry !== "object") continue;
      const candidate = entry as Record<string, unknown>;
      const summary = nonEmptyString(candidate.summary) ? candidate.summary.trim() : "";
      const activationCondition = nonEmptyString(candidate.activationCondition) ? candidate.activationCondition.trim() : "";
      if (!summary || !activationCondition) {
        issues.push({ code: "SKILL_INSIGHTS_INVALID", fieldPath: `${path}.scopedContent[${entryIndex}]`, message: "scopedContent entry is incomplete." });
        continue;
      }
      const content = requireContent(candidate.contentRef, `${path}.scopedContent[${entryIndex}].contentRef`);
      if (!content) continue;
      scopedContent.push({ summary, activationCondition, evidenceExcerpt: content.text });
    }

    profiles.push({ skillId: skill.canonicalId, lossIfRemoved, modelNativeScaffold, scopedContent, contentSummary });
  });
  return profiles;
}

export function parseSkillInsightsV2(raw: unknown, input: SkillInsightsV2Input): LaneParseResult<SkillInsightsV2Accepted> {
  const issues: LaneContractIssue[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { accepted: null, issues: [{ code: "SKILL_INSIGHTS_INVALID", fieldPath: null, message: "Skill Insights output must be a JSON object." }] };
  }
  const contractIssues = forbiddenFieldIssues(raw, "Skill Insights");
  if (contractIssues.length > 0) return { accepted: null, issues: contractIssues };

  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.insights)) {
    return { accepted: null, issues: [{ code: "SKILL_INSIGHTS_INVALID", fieldPath: "insights", message: "Skill Insights output requires an insights array." }] };
  }

  const rejectionReasons = new Set<SkillInsightRejectionReason>();
  if (Array.isArray(record.rejectionReasons)) {
    for (const reason of record.rejectionReasons) {
      if (typeof reason === "string" && ALLOWED_V2_REJECTION_REASONS.has(reason as SkillInsightRejectionReason)) {
        rejectionReasons.add(reason as SkillInsightRejectionReason);
      }
    }
  }
  const contentProfiles = parseSkillContentProfilesV2(record.contentProfiles, input, issues);

  const insights: ValidatedSkillInsight[] = [];
  record.insights.forEach((item, index) => {
    const path = `insights[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      issues.push({ code: "SKILL_INSIGHTS_INVALID", fieldPath: path, message: "Insight entry must be an object." });
      return;
    }
    const candidate = item as Record<string, unknown>;
    const id = nonEmptyString(candidate.id) ? candidate.id.trim() : "";
    const title = nonEmptyString(candidate.title) ? candidate.title.trim() : "";
    const kind = candidate.kind;
    const scope = candidate.scope;
    if (!id || !title || (kind !== "usage" && kind !== "capability") || !["global", "family", "cross_skill", "skill"].includes(String(scope))) {
      issues.push({ code: "SKILL_INSIGHTS_INVALID", fieldPath: path, message: "Insight requires id, title, a supported kind, and a valid scope." });
      return;
    }
    if (kind === "capability" && candidate.claimStrength !== undefined &&
        !["coexistence", "scaffold-interpretation", "primary-delta"].includes(String(candidate.claimStrength))) {
      issues.push({ code: "SKILL_INSIGHTS_INVALID", fieldPath: `${path}.claimStrength`, message: "Capability insight has an invalid claim strength." });
      return;
    }

    const itemIssues: LaneContractIssue[] = [];
    const revealRecord = candidate.reveal && typeof candidate.reveal === "object" && !Array.isArray(candidate.reveal)
      ? candidate.reveal as Record<string, unknown>
      : null;
    const semantic = revealRecord && nonEmptyString(revealRecord.semantic) ? revealRecord.semantic.trim() : "";
    const pattern = revealRecord && typeof revealRecord.pattern === "string" ? revealRecord.pattern : "";
    if (!semantic || !ALLOWED_REVEAL_PATTERNS.has(pattern)) {
      itemIssues.push({ code: "SKILL_INSIGHTS_INVALID", fieldPath: `${path}.reveal`, message: "Insight requires a qualitative reveal semantic and a supported pattern." });
    }
    if (kind === "capability" && pattern !== "content_contrast") {
      itemIssues.push({ code: "SKILL_INSIGHTS_INVALID", fieldPath: `${path}.reveal.pattern`, message: "Capability insight must use a content-contrast Reveal." });
    }

    const mentalModelShift = candidate.mentalModelShift && typeof candidate.mentalModelShift === "object"
      ? candidate.mentalModelShift as Record<string, unknown>
      : null;
    const decisionDelta = candidate.decisionDelta && typeof candidate.decisionDelta === "object"
      ? candidate.decisionDelta as Record<string, unknown>
      : null;
    if (!mentalModelShift || !nonEmptyString(mentalModelShift.surface) || !nonEmptyString(mentalModelShift.observed)) {
      itemIssues.push({ code: "SKILL_INSIGHTS_INVALID", fieldPath: `${path}.mentalModelShift`, message: "Insight requires a complete mentalModelShift." });
    }
    if (!decisionDelta || !nonEmptyString(decisionDelta.before) || !nonEmptyString(decisionDelta.after)) {
      itemIssues.push({ code: "SKILL_INSIGHTS_INVALID", fieldPath: `${path}.decisionDelta`, message: "Insight requires a complete decisionDelta." });
    }
    for (const field of ["observation", "contrast", "interpretation"] as const) {
      if (!nonEmptyString(candidate[field])) {
        itemIssues.push({ code: "SKILL_INSIGHTS_INVALID", fieldPath: `${path}.${field}`, message: `Insight requires ${field}.` });
      }
    }
    if (candidate.confidence !== "high" && candidate.confidence !== "medium") {
      itemIssues.push({ code: "SKILL_INSIGHTS_INVALID", fieldPath: `${path}.confidence`, message: "Insight confidence must be high or medium." });
    }

    let subject: ValidatedSkillInsight["subject"];
    if (candidate.subject && typeof candidate.subject === "object" && !Array.isArray(candidate.subject)) {
      const rawSubject = candidate.subject as Record<string, unknown>;
      const familyRef = familyHandle(rawSubject.familyHandle);
      const skillRef = skillHandle(rawSubject.skillHandle);
      const skillRefs = Array.isArray(rawSubject.skillHandles)
        ? rawSubject.skillHandles.map((value) => skillHandle(value)).filter((value): value is string => Boolean(value))
        : [];
      const family = familyRef ? input.directory.families.find((entry) => entry.handle === familyRef) : undefined;
      const skill = skillRef ? input.directory.skills.find((entry) => entry.handle === skillRef) : undefined;
      if (familyRef && !family) {
        itemIssues.push({ code: "EVIDENCE_REF_UNKNOWN", fieldPath: `${path}.subject.familyHandle`, message: `Family handle '${familyRef}' is not in the current Lane directory.` });
      }
      if (skillRef && !skill) {
        itemIssues.push({ code: "EVIDENCE_REF_UNKNOWN", fieldPath: `${path}.subject.skillHandle`, message: `Skill handle '${skillRef}' is not in the current Lane directory.` });
      }
      const resolvedSkillIds: string[] = [];
      for (const ref of skillRefs) {
        const entry = input.directory.skills.find((candidateEntry) => candidateEntry.handle === ref);
        if (!entry) {
          itemIssues.push({ code: "EVIDENCE_REF_UNKNOWN", fieldPath: `${path}.subject.skillHandles`, message: `Skill handle '${ref}' is not in the current Lane directory.` });
          continue;
        }
        resolvedSkillIds.push(entry.canonicalId);
      }
      subject = {
        ...(family ? { familyId: family.canonicalId } : {}),
        ...(skill ? { skillId: skill.canonicalId } : {}),
        ...(resolvedSkillIds.length > 0 ? { skillIds: [...new Set(resolvedSkillIds)] } : {}),
      };
    }

    const rawEvidence = Array.isArray(candidate.evidence) ? candidate.evidence : [];
    const validEvidence: SkillInsightEvidence[] = [];
    const contentRefsByEvidenceIndex = new Map<string, number>();
    rawEvidence.forEach((entry, evidenceIndex) => {
      const evidencePath = `${path}.evidence[${evidenceIndex}]`;
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        itemIssues.push({ code: "SKILL_INSIGHTS_INVALID", fieldPath: evidencePath, message: "Evidence entry must be an object." });
        return;
      }
      const evidenceRecord = entry as Record<string, unknown>;
      if (nonEmptyString(evidenceRecord.contentRef)) {
        const resolved = resolveContentRef(input.directory, input.contentByHandle, evidenceRecord.contentRef, `${evidencePath}.contentRef`, null);
        if (!resolved) {
          itemIssues.push({ code: "CONTENT_REF_INCOMPATIBLE", fieldPath: `${evidencePath}.contentRef`, message: `Content reference '${String(evidenceRecord.contentRef)}' is not an available directory content handle.` });
          return;
        }
        contentRefsByEvidenceIndex.set(resolved.ref, validEvidence.length);
        const role = typeof evidenceRecord.role === "string" && ALLOWED_ROLES.has(evidenceRecord.role as SkillSemanticRole)
          ? evidenceRecord.role as SkillSemanticRole
          : undefined;
        const loadingScope = typeof evidenceRecord.loadingScope === "string" && ALLOWED_LOADING_SCOPES.has(evidenceRecord.loadingScope as SkillLoadingScope)
          ? evidenceRecord.loadingScope as SkillLoadingScope
          : undefined;
        validEvidence.push({
          kind: evidenceRecord.kind === "cross_skill_content" ? "cross_skill_content" : "skill_content",
          skillId: resolved.skillId ?? undefined,
          role,
          loadingScope,
          contentExcerpt: resolved.text,
        });
        return;
      }
      const ref = evidenceHandle(evidenceRecord.ref);
      if (!ref) {
        itemIssues.push({ code: "EVIDENCE_REF_INVALID", fieldPath: `${evidencePath}.ref`, message: "Metric evidence requires a current directory handle." });
        return;
      }
      const metricEntry = input.directory.evidence.find((candidateEntry) => candidateEntry.handle === ref);
      if (!metricEntry) {
        itemIssues.push({ code: "EVIDENCE_REF_UNKNOWN", fieldPath: `${evidencePath}.ref`, message: `Evidence handle '${ref}' is not in the current Lane directory.` });
        return;
      }
      validEvidence.push({
        kind: metricEvidenceKindFor(metricEntry),
        metric: metricEntry.metric ?? undefined,
        value: metricEntry.value?.value ?? undefined,
        skillId: metricEntry.objectKind === "skill" ? metricEntry.ownerCanonicalId ?? undefined : undefined,
        familyId: metricEntry.objectKind === "family" ? metricEntry.ownerCanonicalId ?? undefined : undefined,
        evidenceRef: ref,
      });
    });

    const revealRefs = revealRecord && Array.isArray(revealRecord.evidenceRefs)
      ? revealRecord.evidenceRefs.map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean)
      : [];
    if (revealRefs.length === 0) {
      itemIssues.push({ code: "SKILL_INSIGHTS_INVALID", fieldPath: `${path}.reveal.evidenceRefs`, message: "Reveal requires at least one evidence handle." });
    }
    // Object-compatibility: a content citation must belong to the objects the
    // insight itself declares. A `skill` insight may not silently borrow another
    // Skill's frozen content, while `family`/`cross_skill`/`global` analyses keep
    // their legitimate multi-Skill reach.
    const declaredSkillIds = new Set<string>([
      ...(subject?.skillId ? [subject.skillId] : []),
      ...(subject?.skillIds ?? []),
    ]);
    const referencedContentSkills = new Set<string>();
    rawEvidence.forEach((entry, evidenceIndex) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
      const evidenceRecord = entry as Record<string, unknown>;
      if (!nonEmptyString(evidenceRecord.contentRef)) return;
      const ref = contentHandle(evidenceRecord.contentRef);
      const contentEntry = ref ? input.directory.content.find((candidateEntry) => candidateEntry.handle === ref) : undefined;
      const ownerSkillId = contentEntry?.skillId ?? null;
      if (ownerSkillId) referencedContentSkills.add(ownerSkillId);
      if (!ref || !contentEntry?.available || !ownerSkillId) return;
      if (declaredSkillIds.has(ownerSkillId)) return;
      if (scope === "skill") {
        itemIssues.push({
          code: "CONTENT_REF_INCOMPATIBLE",
          fieldPath: `${path}.evidence[${evidenceIndex}].contentRef`,
          message: subject?.skillId
            ? `Content reference '${ref}' is owned by '${ownerSkillId}' and is not compatible with this 'skill' insight subject '${subject.skillId}'.`
            : `Content reference '${ref}' is owned by '${ownerSkillId}', but this 'skill' insight declares no subject Skill to own that content.`,
        });
        return;
      }
      if (scope === "family") {
        // Family membership is constrained by the declared family itself; only an
        // explicit member declaration makes a concrete member mandatory.
        if (declaredSkillIds.size === 0) return;
        itemIssues.push({
          code: "CONTENT_REF_INCOMPATIBLE",
          fieldPath: `${path}.evidence[${evidenceIndex}].contentRef`,
          message: `Content reference '${ref}' is owned by '${ownerSkillId}', which is not a declared member of this family insight.`,
        });
        return;
      }
      if (scope === "cross_skill") {
        itemIssues.push({
          code: "CONTENT_REF_INCOMPATIBLE",
          fieldPath: `${path}.evidence[${evidenceIndex}].contentRef`,
          message: declaredSkillIds.size === 0
            ? `Content reference '${ref}' is owned by '${ownerSkillId}', but this cross_skill insight declares no Skill handles to own that content.`
            : `Content reference '${ref}' is owned by '${ownerSkillId}', which is not among the declared Skills of this cross_skill insight (${[...declaredSkillIds].join(", ")}).`,
        });
      }
    });
    if (scope === "cross_skill" && referencedContentSkills.size > 0 && referencedContentSkills.size < 2) {
      // A cross-Skill content claim must actually compare two declared Skills; a
      // usage-only cross_skill insight is left to the existing subject and
      // metric checks rather than being forced to cite content.
      itemIssues.push({
        code: "SKILL_INSIGHTS_INVALID",
        fieldPath: `${path}.evidence`,
        message: "A cross_skill insight that cites content must reference content from at least two distinct declared Skills.",
      });
    }
    const canonicalRevealRefs: string[] = [];
    for (const ref of revealRefs) {
      const metricRef = evidenceHandle(ref);
      if (metricRef) {
        const bound = validEvidence.find((evidence) => evidence.evidenceRef === metricRef);
        if (!bound) {
          itemIssues.push({ code: "REVEAL_EVIDENCE_UNBOUND", fieldPath: `${path}.reveal.evidenceRefs`, message: `Reveal reference '${ref}' is not used by this insight's evidence.` });
          continue;
        }
        canonicalRevealRefs.push(skillInsightEvidenceReference(bound));
        continue;
      }
      const contentRef = contentHandle(ref);
      if (contentRef) {
        // Content evidence keeps its handle for this binding check only; the accepted
        // envelope carries the restored excerpt, not the frozen-fragment address.
        const entry = input.directory.content.find((candidateEntry) => candidateEntry.handle === contentRef);
        const evidenceIndex = contentRefsByEvidenceIndex.get(contentRef);
        const bound = evidenceIndex === undefined ? undefined : validEvidence[evidenceIndex];
        if (!entry || !bound) {
          itemIssues.push({ code: "REVEAL_EVIDENCE_UNBOUND", fieldPath: `${path}.reveal.evidenceRefs`, message: `Reveal reference '${ref}' is not used by this insight's evidence.` });
          continue;
        }
        canonicalRevealRefs.push(skillInsightEvidenceReference(bound));
        continue;
      }
      itemIssues.push({ code: "EVIDENCE_REF_INVALID", fieldPath: `${path}.reveal.evidenceRefs`, message: `Reveal reference '${ref}' is not a current directory handle.` });
    }

    if (kind === "capability") {
      const hasUsageEvidence = validEvidence.some((evidence) =>
        evidence.kind === "global_metric" || evidence.kind === "distribution_metric" || evidence.kind === "family_metric" || evidence.kind === "skill_metric");
      const uniqueEvidence = validEvidence.filter((evidence) =>
        (evidence.kind === "skill_content" || evidence.kind === "cross_skill_content") && evidence.role && evidence.role !== "genericProcedure");
      const genericEvidence = validEvidence.filter((evidence) =>
        (evidence.kind === "skill_content" || evidence.kind === "cross_skill_content") && evidence.role === "genericProcedure");
      if (!hasUsageEvidence) {
        itemIssues.push({ code: "SKILL_INSIGHTS_INVALID", fieldPath: `${path}.evidence`, message: "Capability insight requires a deterministic Usage signal." });
        rejectionReasons.add("usage_content_relation_unclear");
      }
      if (uniqueEvidence.length === 0) {
        itemIssues.push({ code: "SKILL_INSIGHTS_INVALID", fieldPath: `${path}.evidence`, message: "Capability insight requires unique-capability content evidence." });
        rejectionReasons.add("missing_unique_capability_evidence");
      }
      if (genericEvidence.length === 0) {
        itemIssues.push({ code: "SKILL_INSIGHTS_INVALID", fieldPath: `${path}.evidence`, message: "Capability insight requires model-native counterevidence." });
        rejectionReasons.add("missing_model_native_counterevidence");
      }
      if (scope === "family") {
        const distinctSkills = new Set(uniqueEvidence.map((evidence) => evidence.skillId).filter(Boolean));
        if (distinctSkills.size < 2) {
          itemIssues.push({ code: "SKILL_INSIGHTS_INVALID", fieldPath: `${path}.evidence`, message: "Family Capability insight requires content evidence from at least two Skills." });
          rejectionReasons.add("family_content_unavailable");
        }
      }
    }
    if (validEvidence.length === 0) {
      itemIssues.push({ code: "SKILL_INSIGHTS_INVALID", fieldPath: `${path}.evidence`, message: "Insight rejected: no valid evidence passed directory binding." });
    }
    if (itemIssues.length > 0) {
      issues.push(...itemIssues);
      return;
    }

    const counterfactual = candidate.counterfactual && typeof candidate.counterfactual === "object" && !Array.isArray(candidate.counterfactual)
      ? (() => {
          const rawCounterfactual = candidate.counterfactual as Record<string, unknown>;
          const ifRemoved = nonEmptyString(rawCounterfactual.ifRemoved) ? rawCounterfactual.ifRemoved.trim() : "";
          const withoutGenericScaffold = nonEmptyString(rawCounterfactual.withoutGenericScaffold) ? rawCounterfactual.withoutGenericScaffold.trim() : "";
          return ifRemoved && withoutGenericScaffold ? { ifRemoved, withoutGenericScaffold } : undefined;
        })()
      : undefined;

    insights.push({
      snapshotId: input.snapshotId,
      id,
      kind,
      ...(typeof candidate.candidateType === "string" ? { candidateType: candidate.candidateType as ValidatedSkillInsight["candidateType"] } : {}),
      ...(kind === "capability" && typeof candidate.claimStrength === "string" ? { claimStrength: candidate.claimStrength as ValidatedSkillInsight["claimStrength"] } : {}),
      scope: scope as ValidatedSkillInsight["scope"],
      ...(subject ? { subject } : {}),
      title,
      reveal: {
        semantic,
        pattern: pattern as ValidatedSkillInsight["reveal"]["pattern"],
        evidenceRefs: [...new Set(canonicalRevealRefs)],
      },
      mentalModelShift: {
        surface: (mentalModelShift?.surface as string).trim(),
        observed: (mentalModelShift?.observed as string).trim(),
      },
      decisionDelta: {
        before: (decisionDelta?.before as string).trim(),
        after: (decisionDelta?.after as string).trim(),
      },
      observation: (candidate.observation as string).trim(),
      contrast: (candidate.contrast as string).trim(),
      interpretation: (candidate.interpretation as string).trim(),
      ...(counterfactual ? { counterfactual } : {}),
      conditionalMechanism: nonEmptyString(candidate.conditionalMechanism) ? candidate.conditionalMechanism.trim() : null,
      consequence: nonEmptyString(candidate.consequence) ? candidate.consequence.trim() : null,
      ...(Array.isArray(candidate.familyDifferences)
        ? { familyDifferences: candidate.familyDifferences.filter(nonEmptyString).slice(0, 4) }
        : {}),
      confidence: candidate.confidence as "high" | "medium",
      evidence: validEvidence,
    });
  });

  if (insights.length === 0) {
    issues.push({ code: "SKILL_INSIGHTS_INVALID", fieldPath: null, message: "No Skill Insight card passed v2 directory binding." });
    return { accepted: null, issues: dedupeIssues(issues) };
  }
  return {
    accepted: {
      snapshotId: input.snapshotId,
      insights,
      contentProfiles,
      rejectionReasons: [...rejectionReasons],
    },
    issues: dedupeIssues(issues),
  };
}

/**
 * Compose-time integrity check for an accepted v2 Skill Insights envelope.
 *
 * The v2 accept step already completed the domain judgment. Compose therefore
 * re-verifies structure, the bound Snapshot identity and code-restored excerpt
 * content only; it does not re-impose the v1 reference-format scheme and does
 * not run a second semantic elimination pass.
 */
export function verifyAcceptedSkillInsightsV2(
  value: unknown,
  expectedSnapshotId: string,
): { valid: boolean; insights: ValidatedSkillInsight[]; errors: string[]; rejectionReasons: SkillInsightRejectionReason[] } {
  const errors: string[] = [];
  const rejectionReasons = new Set<SkillInsightRejectionReason>();
  if (!Array.isArray(value) || value.length === 0) {
    return { valid: false, insights: [], errors: ["Accepted Skill Insights value is not a non-empty array."], rejectionReasons: [] };
  }
  const insights: ValidatedSkillInsight[] = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`Accepted Skill Insight ${index} is not an object.`);
      continue;
    }
    const candidate = item as ValidatedSkillInsight;
    if (candidate.snapshotId !== expectedSnapshotId) {
      errors.push(`Accepted Skill Insight ${index} is bound to another Skill Snapshot.`);
      continue;
    }
    if (!nonEmptyString(candidate.id) || !nonEmptyString(candidate.title) || !["usage", "capability", "mechanism"].includes(String(candidate.kind))) {
      errors.push(`Accepted Skill Insight ${index} has an invalid identity or kind.`);
      continue;
    }
    const reveal = candidate.reveal;
    if (!reveal || !nonEmptyString(reveal.semantic) || !ALLOWED_REVEAL_PATTERNS.has(String(reveal.pattern)) || !Array.isArray(reveal.evidenceRefs) || reveal.evidenceRefs.length === 0) {
      errors.push(`Accepted Skill Insight ${index} has an incomplete Reveal.`);
      continue;
    }
    if (!candidate.mentalModelShift || !candidate.decisionDelta) {
      errors.push(`Accepted Skill Insight ${index} is missing a cognitive or decision delta.`);
      continue;
    }
    if (!Array.isArray(candidate.evidence) || candidate.evidence.length === 0) {
      errors.push(`Accepted Skill Insight ${index} carries no bound evidence.`);
      continue;
    }
    const contentMissing = candidate.evidence.some((evidence) =>
      (evidence.kind === "skill_content" || evidence.kind === "cross_skill_content")
      && (!nonEmptyString(evidence.contentExcerpt) || !nonEmptyString(evidence.skillId)));
    if (contentMissing) {
      errors.push(`Accepted Skill Insight ${index} lost its code-restored content excerpt.`);
      rejectionReasons.add("insufficient_content_support");
      continue;
    }
    const metricMissing = candidate.evidence.some((evidence) =>
      !(evidence.kind === "skill_content" || evidence.kind === "cross_skill_content")
      && !nonEmptyString(evidence.metric));
    if (metricMissing) {
      errors.push(`Accepted Skill Insight ${index} lost its canonical metric identity.`);
      continue;
    }
    insights.push(candidate);
  }
  return { valid: insights.length > 0, insights, errors, rejectionReasons: [...rejectionReasons] };
}

export type { ContentEvidencePacket, SkillContentSnapshot };
