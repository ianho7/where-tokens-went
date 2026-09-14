import { createHash } from "node:crypto";
import type {
  AuditResult,
  ContentEvidencePacket,
  EvidenceValue,
  KeySessionAnalysis,
  ReportComposition,
  ReportSynthesis,
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

export interface ReportSynthesisValidation {
  valid: boolean;
  errors: string[];
  synthesis: ReportSynthesis | null;
}

export interface ReportEvidenceMatch {
  kind: "summary" | "check" | "ranking" | "turn";
  key: string;
  dimension?: "sessions" | "projects" | "models" | "timeBuckets";
  evidence: EvidenceValue[];
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
    keySessionTokenAccounting: audit.keySessionTokenAccounting,
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

function evidenceNotRead(audit: AuditResult, sessionId: string, turnIds: string[], evidenceIds: string[]): string[] {
  const readEvidence = new Set(
    (audit.turns ?? [])
      .filter((turn) => turn.sessionId === sessionId && turnIds.includes(turn.turnId))
      .map((turn) => turn.evidenceId),
  );
  return evidenceIds.filter((evidenceId) => !readEvidence.has(evidenceId));
}

function normalizedFinding(analysis: KeySessionAnalysis): string | null {
  if (analysis.primaryFinding === null) return null;
  return [
    analysis.primaryFinding.observation,
    analysis.primaryFinding.interpretation,
    analysis.recommendation?.action ?? "",
  ].map((value) => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase()).join("\n");
}

export function resolveReportEvidence(audit: AuditResult, reference: string): ReportEvidenceMatch | null {
  if (!nonEmpty(reference)) return null;

  if (reference.startsWith("summary:")) {
    const key = reference.slice("summary:".length);
    const value = audit.summary[key];
    return key && hasOwn(audit.summary, key) && value ? { kind: "summary", key, evidence: [value] } : null;
  }

  const checkMatch = /^check:([^:]+)(?::(\d+))?$/.exec(reference);
  if (checkMatch) {
    const check = audit.checks.find((candidate) => candidate.id === checkMatch[1]);
    if (!check || check.evidence.length === 0) return null;
    if (checkMatch[2] === undefined) return { kind: "check", key: check.id, evidence: check.evidence };
    const index = Number(checkMatch[2]);
    return Number.isSafeInteger(index) && index < check.evidence.length
      ? { kind: "check", key: check.id + ":" + index, evidence: [check.evidence[index]] }
      : null;
  }

  const rankingMatch = /^ranking:(sessions|projects|models|timeBuckets):(.+)$/.exec(reference);
  if (rankingMatch) {
    const dimension = rankingMatch[1] as "sessions" | "projects" | "models" | "timeBuckets";
    const key = rankingMatch[2];
    const entry = audit.rankings[dimension].find((candidate) => candidate.key === key);
    return entry ? { kind: "ranking", dimension, key, evidence: [entry.value, entry.sharePercent, entry.count] } : null;
  }

  const turn = audit.turns.find((candidate) => candidate.evidenceId === reference);
  return turn
    ? { kind: "turn", key: turn.turnId, evidence: [turn.tokens.totalTokens, turn.sessionSharePercent, turn.modelCallCount] }
    : null;
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isSupport(value: unknown): value is ReportSynthesis["findings"][number]["support"] {
  return value === "strong" || value === "moderate" || value === "limited";
}

export function validateReportSynthesis(audit: AuditResult, synthesis: unknown): ReportSynthesisValidation {
  const errors: string[] = [];
  if (!synthesis || typeof synthesis !== "object" || Array.isArray(synthesis)) {
    return { valid: false, errors: ["Report synthesis is unavailable."], synthesis: null };
  }

  const candidate = synthesis as Partial<ReportSynthesis>;
  const expectedFingerprint = auditFingerprint(audit);
  if (candidate.auditFingerprint !== expectedFingerprint) errors.push("Audit fingerprint is stale or belongs to another Audit.");
  if (!candidate.overview || typeof candidate.overview !== "object" || Array.isArray(candidate.overview)) {
    errors.push("overview must be an object.");
  } else {
    const overview = candidate.overview as Partial<ReportSynthesis["overview"]>;
    if (!nonEmpty(overview.summary)) errors.push("overview.summary must be a non-empty string.");
    if (!Array.isArray(overview.evidenceRefs) || overview.evidenceRefs.length < 1 || overview.evidenceRefs.length > 3 || !overview.evidenceRefs.every(nonEmpty)) {
      errors.push("overview.evidenceRefs must contain one to three non-empty Evidence references.");
    } else {
      for (const reference of overview.evidenceRefs) {
        if (!resolveReportEvidence(audit, reference)) errors.push("Overview cites unknown or cross-Audit Evidence: " + reference);
      }
    }
  }
  if (!Array.isArray(candidate.findings)) {
    errors.push("findings must be a list.");
  } else {
    if (candidate.findings.length > 5) errors.push("Report synthesis cannot contain more than five Findings.");
    for (const [index, finding] of candidate.findings.entries()) {
      if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
        errors.push("Finding " + index + " is malformed.");
        continue;
      }
      const item = finding as Partial<ReportSynthesis["findings"][number]>;
      if (!nonEmpty(item.title)) errors.push("Finding " + index + " requires a title.");
      if (!nonEmpty(item.analysis)) errors.push("Finding " + index + " requires analysis.");
      if (!Array.isArray(item.evidenceRefs) || item.evidenceRefs.length === 0 || !item.evidenceRefs.every(nonEmpty)) {
        errors.push("Finding " + index + " requires at least one Evidence reference.");
      } else {
        for (const reference of item.evidenceRefs) {
          if (!resolveReportEvidence(audit, reference)) errors.push("Finding " + index + " cites unknown or cross-Audit Evidence: " + reference);
        }
      }
      if (!isSupport(item.support)) errors.push("Finding " + index + " has invalid support.");
      if (!hasOwn(item, "uncertainty") || (item.uncertainty !== null && !nonEmpty(item.uncertainty))) errors.push("Finding " + index + " uncertainty must be null or a non-empty string.");
    }
  }
  if (!hasOwn(candidate, "noStrongFindingReason") || (candidate.noStrongFindingReason !== null && !nonEmpty(candidate.noStrongFindingReason))) {
    errors.push("noStrongFindingReason must be null or a non-empty string.");
  } else if (Array.isArray(candidate.findings)) {
    if (candidate.findings.length === 0 && candidate.noStrongFindingReason === null) errors.push("noStrongFindingReason is required when there are no Findings.");
    if (candidate.findings.length > 0 && candidate.noStrongFindingReason !== null) errors.push("Findings and noStrongFindingReason cannot both be present.");
  }
  const uniqueErrors = [...new Set(errors)];
  return { valid: uniqueErrors.length === 0, errors: uniqueErrors, synthesis: uniqueErrors.length === 0 ? candidate as ReportSynthesis : null };
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
  const selectedSessionAccounting = audit.keySessionTokenAccounting?.find((entry) => entry.sessionId === analysis.sessionId)?.status;
  if (audit.scope.harness === "codex" && (selectedSessionAccounting ?? audit.summary.keySessionTokenAccountingStatus?.value ?? audit.summary.tokenAccountingStatus?.value) !== "reconciled") errors.push("Codex Token accounting is not reconciled for the selected Key Session; AI conclusions are blocked.");
  if (!nonEmpty(analysis.taskContext)) errors.push("taskContext is required.");
  if (!Array.isArray(analysis.limitations) || !analysis.limitations.every(nonEmpty)) errors.push("limitations must be a list of non-empty strings.");
  if (!analysis.evidenceRead || !Array.isArray(analysis.evidenceRead.turnIds) || analysis.evidenceRead.turnIds.length === 0 || !strings(analysis.evidenceRead.turnIds) || !nonEmpty(analysis.evidenceRead.selectionReason) || !nonEmpty(analysis.evidenceRead.unreadScope)) errors.push("evidenceRead must describe at least one selected Turn and the unread scope.");
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
    if (analysis.evidenceRead && strings(analysis.evidenceRead.turnIds) && strings(analysis.primaryFinding.evidenceIds)) {
      errors.push(...evidenceNotRead(audit, analysis.sessionId, analysis.evidenceRead.turnIds, analysis.primaryFinding.evidenceIds).map((id) => "primaryFinding Evidence was not read in evidenceRead: " + id));
    }
    if (!analysis.recommendation) errors.push("a supported primaryFinding requires one recommendation or an explicit data-gap explanation.");
  }
  if (analysis.recommendation !== null) {
    const recommendation = analysis.recommendation;
    if (![recommendation.action, recommendation.rationale, recommendation.applicability, recommendation.verification].every(nonEmpty)) errors.push("recommendation requires action, rationale, applicability, and verification.");
    if (recommendation.tradeoff !== null && !nonEmpty(recommendation.tradeoff)) errors.push("recommendation tradeoff must be null or a non-empty string.");
    if (!strings(recommendation.targetEvidenceIds)) errors.push("recommendation targetEvidenceIds must be a list of Evidence IDs.");
    errors.push(...sameSessionEvidence(audit, analysis.sessionId, recommendation.targetEvidenceIds).map((id) => "recommendation Evidence is unknown or cross-Session: " + id));
    if (analysis.evidenceRead && strings(analysis.evidenceRead.turnIds) && strings(recommendation.targetEvidenceIds)) {
      errors.push(...evidenceNotRead(audit, analysis.sessionId, analysis.evidenceRead.turnIds, recommendation.targetEvidenceIds).map((id) => "recommendation Evidence was not read in evidenceRead: " + id));
    }
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
  for (const candidate of (analyses ?? []).slice(0, 3) as unknown[]) {
    const sessionId = candidate && typeof candidate === "object" && !Array.isArray(candidate) && typeof (candidate as { sessionId?: unknown }).sessionId === "string"
      ? (candidate as { sessionId: string }).sessionId
      : "unknown";
    try {
      const analysis = candidate as KeySessionAnalysis;
      const result = validateKeySessionAnalysis(audit, analysis, packets.filter((packet) => packet.sessionId === sessionId));
      if (result.valid && result.analysis) {
        const finding = normalizedFinding(result.analysis);
        // ponytail: exact normalized prose only; add semantic similarity only if this misses real duplicates.
        const duplicate = finding !== null && valid.some((accepted) => normalizedFinding(accepted) === finding);
        if (duplicate) unavailable.push(sessionId + ": duplicate Session analysis prose; regenerate with Session-specific Evidence.");
        else valid.push(result.analysis);
      }
      else unavailable.push(sessionId + ": " + result.errors.join(" "));
    } catch {
      unavailable.push(sessionId + ": malformed Key Session Analysis.");
    }
  }
  if (analyses.length === 0) unavailable.push("Host Agent did not provide Key Session Analysis.");
  return { auditFingerprint: fingerprint, analyses: valid, unavailable };
}

export function reportComposition(audit: AuditResult, analyses: KeySessionAnalysis[], synthesis: ReportSynthesis | null = null): ReportComposition {
  const composition = composeKeySessionAnalyses(audit, analyses);
  const validatedSynthesis = synthesis === null ? null : validateReportSynthesis(audit, synthesis).synthesis;
  return { auditFingerprint: composition.auditFingerprint, audit, reportSynthesis: validatedSynthesis, keySessionAnalyses: composition.analyses };
}
