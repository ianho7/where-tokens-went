import { createHash } from "node:crypto";
import type {
  AuditResult,
  ContentEvidencePacket,
  KeySessionAnalysis,
  ReportComposition,
} from "./types";

export interface KeySessionValidation {
  valid: boolean;
  errors: string[];
  analysis: KeySessionAnalysis | null;
}

export interface KeySessionComposition {
  auditFingerprint: string;
  analyses: KeySessionAnalysis[];
  unavailable: string[];
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, stableValue(nested)]));
  }
  return value;
}

export function auditFingerprint(audit: AuditResult): string {
  const sanitized = stableValue({
    scope: audit.scope,
    coverage: audit.coverage,
    summary: audit.summary,
    rankings: audit.rankings,
    turns: audit.turns,
    turnCandidates: audit.turnCandidates,
    report: audit.report,
    checks: audit.checks,
  });
  return createHash("sha256").update(JSON.stringify(sanitized)).digest("hex");
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonEmpty);
}

function sameSessionEvidence(audit: AuditResult, sessionId: string, evidenceIds: string[]): string[] {
  const turnEvidence = new Map((audit.turns ?? []).map((turn) => [turn.evidenceId, turn]));
  return evidenceIds.filter((evidenceId) => {
    const turn = turnEvidence.get(evidenceId);
    return !turn || turn.sessionId !== sessionId;
  });
}

function containsRawEvidence(analysis: KeySessionAnalysis, packets: ContentEvidencePacket[] | undefined): boolean {
  if (!packets) return false;
  const text = [analysis.taskContext, analysis.primaryFinding?.observation, analysis.primaryFinding?.interpretation, analysis.recommendation?.action, analysis.recommendation?.rationale].filter(nonEmpty).join("\n");
  return packets.some((packet) => packet.items.some((item) => item.content.length >= 40 && text.includes(item.content.replace(/…$/, ""))));
}

export function validateKeySessionAnalysis(
  audit: AuditResult,
  analysis: KeySessionAnalysis,
  packets?: ContentEvidencePacket[],
): KeySessionValidation {
  const errors: string[] = [];
  const expectedFingerprint = auditFingerprint(audit);
  const topSessionIds = new Set(audit.rankings.sessions.slice(0, 3).map((entry) => entry.key));
  if (!topSessionIds.has(analysis.sessionId)) errors.push("Session is outside the Token-ranked Top 3.");
  if (analysis.auditFingerprint !== expectedFingerprint) errors.push("Audit fingerprint is stale or belongs to another Audit.");
  if (audit.scope.harness === "codex" && (audit.summary.keySessionTokenAccountingStatus?.value ?? audit.summary.tokenAccountingStatus?.value) !== "reconciled") errors.push("Codex Token accounting is not reconciled for the selected Key Session; AI conclusions are blocked.");
  if (!nonEmpty(analysis.taskContext)) errors.push("taskContext is required.");
  if (!Array.isArray(analysis.limitations) || !analysis.limitations.every(nonEmpty)) errors.push("limitations must be a list of non-empty strings.");
  if (!analysis.evidenceRead || !strings(analysis.evidenceRead.turnIds) || !nonEmpty(analysis.evidenceRead.selectionReason) || !nonEmpty(analysis.evidenceRead.unreadScope)) errors.push("evidenceRead must describe selected Turns and unread scope.");
  const sessionTurns = new Set((audit.turns ?? []).filter((turn) => turn.sessionId === analysis.sessionId).map((turn) => turn.turnId));
  if (analysis.evidenceRead?.turnIds.some((turnId) => !sessionTurns.has(turnId))) errors.push("evidenceRead contains a Turn outside the selected Session.");
  if (analysis.primaryFinding === null) {
    if (analysis.recommendation !== null) errors.push("recommendation must be null when primaryFinding is null.");
  } else {
    if (!nonEmpty(analysis.primaryFinding.observation) || !nonEmpty(analysis.primaryFinding.interpretation)) errors.push("primaryFinding observation and interpretation are required.");
    if (!strings(analysis.primaryFinding.evidenceIds) || analysis.primaryFinding.evidenceIds.length === 0) errors.push("primaryFinding must cite at least one Evidence ID.");
    if (!['strong', 'moderate', 'limited'].includes(analysis.primaryFinding.support)) errors.push("primaryFinding support is invalid.");
    if (!strings(analysis.primaryFinding.alternativeExplanations)) errors.push("alternativeExplanations must be a list of non-empty strings.");
    errors.push(...sameSessionEvidence(audit, analysis.sessionId, analysis.primaryFinding.evidenceIds).map((id) => "primaryFinding Evidence is unknown or cross-Session: " + id));
    if (!analysis.recommendation) errors.push("a supported primaryFinding requires one recommendation or an explicit data-gap explanation.");
  }
  if (analysis.recommendation !== null) {
    const recommendation = analysis.recommendation;
    if (![recommendation.action, recommendation.rationale, recommendation.applicability, recommendation.verification].every(nonEmpty)) errors.push("recommendation requires action, rationale, applicability, and verification.");
    if (recommendation.tradeoff !== null && !nonEmpty(recommendation.tradeoff)) errors.push("recommendation tradeoff must be null or a non-empty string.");
    if (!strings(recommendation.targetEvidenceIds)) errors.push("recommendation targetEvidenceIds must be a list of Evidence IDs.");
    errors.push(...sameSessionEvidence(audit, analysis.sessionId, recommendation.targetEvidenceIds).map((id) => "recommendation Evidence is unknown or cross-Session: " + id));
  }
  if (containsRawEvidence(analysis, packets)) errors.push("analysis repeats raw historical content instead of a paraphrase.");
  return { valid: errors.length === 0, errors: [...new Set(errors)], analysis: errors.length === 0 ? analysis : null };
}

export function composeKeySessionAnalyses(
  audit: AuditResult,
  analyses: KeySessionAnalysis[],
  packets: ContentEvidencePacket[] = [],
): KeySessionComposition {
  const fingerprint = auditFingerprint(audit);
  const valid: KeySessionAnalysis[] = [];
  const unavailable: string[] = [];
  for (const analysis of analyses.slice(0, 3)) {
    const result = validateKeySessionAnalysis(audit, analysis, packets.filter((packet) => packet.sessionId === analysis.sessionId));
    if (result.valid && result.analysis) valid.push(result.analysis);
    else unavailable.push(analysis.sessionId + ": " + result.errors.join(" "));
  }
  if (analyses.length === 0) unavailable.push("Host Agent did not provide Key Session Analysis.");
  return { auditFingerprint: fingerprint, analyses: valid, unavailable };
}

export function reportComposition(audit: AuditResult, analyses: KeySessionAnalysis[]): ReportComposition {
  const composition = composeKeySessionAnalyses(audit, analyses);
  return { auditFingerprint: composition.auditFingerprint, audit, keySessionAnalyses: composition.analyses };
}
