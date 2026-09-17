"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditFingerprint = auditFingerprint;
exports.resolveReportEvidence = resolveReportEvidence;
exports.validateReportSynthesis = validateReportSynthesis;
exports.validateKeySessionAnalysis = validateKeySessionAnalysis;
exports.composeKeySessionAnalyses = composeKeySessionAnalyses;
exports.reportComposition = reportComposition;
const node_crypto_1 = require("node:crypto");
function stableValue(value) {
    if (Array.isArray(value))
        return value.map(stableValue);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, stableValue(nested)]));
    }
    return value;
}
function auditFingerprint(audit) {
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
    return (0, node_crypto_1.createHash)("sha256").update(JSON.stringify(sanitized)).digest("hex");
}
function nonEmpty(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function strings(value) {
    return Array.isArray(value) && value.every(nonEmpty);
}
function sameSessionEvidence(audit, sessionId, evidenceIds) {
    if (!Array.isArray(evidenceIds))
        return [];
    const turnEvidence = new Map((audit.turns ?? []).map((turn) => [turn.evidenceId, turn]));
    return evidenceIds.filter((evidenceId) => {
        const turn = turnEvidence.get(evidenceId);
        return !turn || turn.sessionId !== sessionId;
    });
}
function evidenceNotRead(audit, sessionId, turnIds, evidenceIds) {
    if (!Array.isArray(evidenceIds) || !Array.isArray(turnIds))
        return [];
    const readEvidence = new Set((audit.turns ?? [])
        .filter((turn) => turn.sessionId === sessionId && turnIds.includes(turn.turnId))
        .map((turn) => turn.evidenceId));
    return evidenceIds.filter((evidenceId) => !readEvidence.has(evidenceId));
}
function normalizedFinding(audit, analysis) {
    if (analysis.primaryFinding === null)
        return null;
    const normalized = canonicalizeNarrative(audit, analysis.taskContext, analysis.primaryFinding.observation, analysis.primaryFinding.interpretation, ...analysis.primaryFinding.alternativeExplanations, analysis.recommendation?.action ?? "", analysis.recommendation?.rationale ?? "", analysis.recommendation?.applicability ?? "", analysis.recommendation?.tradeoff ?? "", analysis.recommendation?.verification ?? "");
    return normalized;
}
function resolveReportEvidence(audit, reference) {
    if (!nonEmpty(reference))
        return null;
    if (reference.startsWith("summary:")) {
        const key = reference.slice("summary:".length);
        const value = audit.summary[key];
        return key && hasOwn(audit.summary, key) && value ? { kind: "summary", key, evidence: [value] } : null;
    }
    const checkMatch = /^check:([^:]+)(?::(\d+))?$/.exec(reference);
    if (checkMatch) {
        const check = audit.checks.find((candidate) => candidate.id === checkMatch[1]);
        if (!check || check.evidence.length === 0)
            return null;
        if (checkMatch[2] === undefined)
            return { kind: "check", key: check.id, evidence: check.evidence };
        const index = Number(checkMatch[2]);
        return Number.isSafeInteger(index) && index < check.evidence.length
            ? { kind: "check", key: check.id + ":" + index, evidence: [check.evidence[index]] }
            : null;
    }
    const rankingMatch = /^ranking:(sessions|projects|models|timeBuckets):(.+)$/.exec(reference);
    if (rankingMatch) {
        const dimension = rankingMatch[1];
        const key = rankingMatch[2];
        const entry = audit.rankings[dimension].find((candidate) => candidate.key === key);
        return entry ? { kind: "ranking", dimension, key, evidence: [entry.value, entry.sharePercent, entry.count] } : null;
    }
    const turn = audit.turns.find((candidate) => candidate.evidenceId === reference);
    return turn
        ? { kind: "turn", key: turn.turnId, evidence: [turn.tokens.totalTokens, turn.sessionSharePercent, turn.modelCallCount] }
        : null;
}
function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function narrativeValuePattern(value) {
    return "(?<![A-Za-z0-9_])" + escapeRegExp(value) + "(?![A-Za-z0-9_])";
}
function narrativeValues(audit) {
    const values = new Set();
    const add = (value) => {
        if (typeof value !== "string" || !value.trim())
            return;
        values.add(value.normalize("NFKC").toLowerCase());
    };
    add(audit.scope.cwd);
    add(audit.scope.harness);
    for (const entries of Object.values(audit.rankings)) {
        for (const entry of entries) {
            add(entry.key);
            add(entry.displayName);
        }
    }
    for (const turn of audit.turns ?? []) {
        add(turn.sessionId);
        add(turn.turnId);
        add(turn.evidenceId);
    }
    for (const candidate of audit.turnCandidates ?? []) {
        add(candidate.id);
        add(candidate.sessionId);
        for (const evidenceId of candidate.evidenceIds)
            add(evidenceId);
    }
    for (const entry of audit.keySessionTokenAccounting ?? [])
        add(entry.sessionId);
    for (const key of Object.keys(audit.summary ?? {}))
        add(key);
    for (const check of audit.checks ?? [])
        add(check.id);
    for (const tool of audit.report?.tools ?? [])
        add(tool.key);
    for (const skill of audit.report?.skills ?? [])
        add(skill.name);
    return [...values].sort((left, right) => right.length - left.length);
}
function canonicalizeNarrative(audit, ...parts) {
    let text = parts.filter(nonEmpty).join("\n").normalize("NFKC").toLowerCase();
    const knownValues = narrativeValues(audit);
    if (knownValues.length > 0) {
        text = text.replace(new RegExp(knownValues.map(narrativeValuePattern).join("|"), "gu"), "value");
    }
    return text
        .replace(/第\s*(?:\d+|[一二三四五六七八九十百]+)(?:\s*(?:高用量|大|位|个))?/gu, "rank")
        .replace(/前\s*(?:\d+|[一二三四五六七八九十百]+)(?:\s*(?:个|轮|项))?/gu, "rank")
        .replace(/\b(?:top|rank(?:ed|ing)?)\s*(?:\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/giu, "rank")
        .replace(/\b\d+(?:st|nd|rd|th)\b/giu, "rank")
        .replace(/\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/giu, "rank")
        .replace(/\d+(?:[.,]\d+)*(?:\s*(?:%|％|percent|percentage|tokens?|token|turns?|turn|calls?|call|ms|milliseconds?|s|sec|seconds?|m|min|minutes?|h|hours?|秒|分钟|小时|轮|次|个))?/giu, "number")
        .replace(/[\p{P}\p{S}]+/gu, " ")
        .replace(/\s+/gu, " ")
        .trim();
}
function isSupport(value) {
    return value === "strong" || value === "moderate" || value === "limited";
}
function validateReportSynthesis(audit, synthesis) {
    const errors = [];
    if (!synthesis || typeof synthesis !== "object" || Array.isArray(synthesis)) {
        return { valid: false, errors: ["Report synthesis is unavailable."], synthesis: null };
    }
    const candidate = synthesis;
    const expectedFingerprint = auditFingerprint(audit);
    if (candidate.auditFingerprint !== expectedFingerprint)
        errors.push("Audit fingerprint is stale or belongs to another Audit.");
    if (!candidate.overview || typeof candidate.overview !== "object" || Array.isArray(candidate.overview)) {
        errors.push("overview must be an object.");
    }
    else {
        const overview = candidate.overview;
        if (!nonEmpty(overview.summary))
            errors.push("overview.summary must be a non-empty string.");
        if (!Array.isArray(overview.evidenceRefs) || overview.evidenceRefs.length < 1 || overview.evidenceRefs.length > 3 || !overview.evidenceRefs.every(nonEmpty)) {
            errors.push("overview.evidenceRefs must contain one to three non-empty Evidence references.");
        }
        else {
            for (const reference of overview.evidenceRefs) {
                if (!resolveReportEvidence(audit, reference))
                    errors.push("Overview cites unknown or cross-Audit Evidence: " + reference);
            }
        }
    }
    if (!Array.isArray(candidate.findings)) {
        errors.push("findings must be a list.");
    }
    else {
        if (candidate.findings.length > 5)
            errors.push("Report synthesis cannot contain more than five Findings.");
        if (candidate.findings.length === 1)
            errors.push("Report synthesis requires at least two Findings when findings are present, or return zero findings with noStrongFindingReason.");
        for (const [index, finding] of candidate.findings.entries()) {
            if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
                errors.push("Finding " + index + " is malformed.");
                continue;
            }
            const item = finding;
            if (!nonEmpty(item.title))
                errors.push("Finding " + index + " requires a title.");
            if (!nonEmpty(item.analysis))
                errors.push("Finding " + index + " requires analysis.");
            if (!Array.isArray(item.evidenceRefs) || item.evidenceRefs.length === 0 || !item.evidenceRefs.every(nonEmpty)) {
                errors.push("Finding " + index + " requires at least one Evidence reference.");
            }
            else {
                for (const reference of item.evidenceRefs) {
                    if (!resolveReportEvidence(audit, reference))
                        errors.push("Finding " + index + " cites unknown or cross-Audit Evidence: " + reference);
                }
            }
            if (!isSupport(item.support))
                errors.push("Finding " + index + " has invalid support.");
            if (!hasOwn(item, "uncertainty") || (item.uncertainty !== null && !nonEmpty(item.uncertainty)))
                errors.push("Finding " + index + " uncertainty must be null or a non-empty string.");
        }
    }
    if (!hasOwn(candidate, "noStrongFindingReason") || (candidate.noStrongFindingReason !== null && !nonEmpty(candidate.noStrongFindingReason))) {
        errors.push("noStrongFindingReason must be null or a non-empty string.");
    }
    else if (Array.isArray(candidate.findings)) {
        if (candidate.findings.length === 0 && candidate.noStrongFindingReason === null)
            errors.push("noStrongFindingReason is required when there are no Findings.");
        if (candidate.findings.length > 0 && candidate.noStrongFindingReason !== null)
            errors.push("Findings and noStrongFindingReason cannot both be present.");
    }
    if (errors.length === 0 && candidate.overview && typeof candidate.overview === "object" && !Array.isArray(candidate.overview) && Array.isArray(candidate.findings)) {
        const overview = candidate.overview;
        const findings = candidate.findings;
        const groups = new Map();
        for (const [index, finding] of findings.entries()) {
            const signature = canonicalizeNarrative(audit, finding.title, finding.analysis);
            groups.set(signature, [...(groups.get(signature) ?? []), index]);
        }
        for (const group of groups.values()) {
            if (group.length > 1)
                errors.push("Findings " + group.join(", ") + " form an interchangeable parameterized narrative group; regenerate distinct Findings.");
        }
        const overviewSignature = canonicalizeNarrative(audit, overview.summary);
        for (const [index, finding] of findings.entries()) {
            const findingNarratives = new Set([
                canonicalizeNarrative(audit, finding.title),
                canonicalizeNarrative(audit, finding.analysis),
                canonicalizeNarrative(audit, finding.title, finding.analysis),
            ]);
            if (findingNarratives.has(overviewSignature))
                errors.push("Overview is an interchangeable restatement of Finding " + index + ".");
        }
    }
    const uniqueErrors = [...new Set(errors)];
    return { valid: uniqueErrors.length === 0, errors: uniqueErrors, synthesis: uniqueErrors.length === 0 ? candidate : null };
}
function containsRawEvidence(analysis, packets) {
    if (!packets)
        return false;
    const text = [analysis.taskContext, analysis.primaryFinding?.observation, analysis.primaryFinding?.interpretation, analysis.recommendation?.action, analysis.recommendation?.rationale].filter(nonEmpty).join("\n");
    return packets.some((packet) => packet.items.some((item) => item.content.length >= 40 && text.includes(item.content.replace(/…$/, ""))));
}
function contentEvidenceInsufficient(audit, analysis, packets) {
    const turnIds = analysis.evidenceRead?.turnIds;
    if (!strings(turnIds))
        return true;
    const packet = packets.find((candidate) => candidate.sessionId === analysis.sessionId &&
        candidate.scope.harness === audit.scope.harness &&
        candidate.scope.allProjects === audit.scope.allProjects &&
        candidate.scope.since === audit.scope.since &&
        candidate.scope.until === audit.scope.until &&
        candidate.turnIds.length === turnIds.length &&
        candidate.turnIds.every((turnId, index) => turnId === turnIds[index]) &&
        candidate.selectionReason === analysis.evidenceRead.selectionReason &&
        candidate.unreadScope === analysis.evidenceRead.unreadScope);
    return !packet || packet.items.length === 0 || !packet.items.some((item) => nonEmpty(item.content));
}
function validateKeySessionAnalysis(audit, analysis, packets) {
    const errors = [];
    const expectedFingerprint = auditFingerprint(audit);
    const topSessionIds = new Set(audit.rankings.sessions.slice(0, 3).map((entry) => entry.key));
    if (!topSessionIds.has(analysis.sessionId))
        errors.push("Session is outside the Token-ranked Top 3.");
    if (analysis.auditFingerprint !== expectedFingerprint)
        errors.push("Audit fingerprint is stale or belongs to another Audit.");
    const selectedSessionAccounting = audit.keySessionTokenAccounting?.find((entry) => entry.sessionId === analysis.sessionId)?.status;
    if (audit.scope.harness === "codex" && analysis.primaryFinding !== null && (selectedSessionAccounting ?? audit.summary.keySessionTokenAccountingStatus?.value ?? audit.summary.tokenAccountingStatus?.value) !== "reconciled")
        errors.push("Codex Token accounting is not reconciled for the selected Key Session; AI conclusions are blocked.");
    if (!nonEmpty(analysis.taskContext))
        errors.push("taskContext is required.");
    if (!Array.isArray(analysis.limitations) || !analysis.limitations.every(nonEmpty))
        errors.push("limitations must be a list of non-empty strings.");
    if (!analysis.evidenceRead || !Array.isArray(analysis.evidenceRead.turnIds) || analysis.evidenceRead.turnIds.length === 0 || !strings(analysis.evidenceRead.turnIds) || !nonEmpty(analysis.evidenceRead.selectionReason) || !nonEmpty(analysis.evidenceRead.unreadScope))
        errors.push("evidenceRead must describe at least one selected Turn and the unread scope.");
    const sessionTurns = new Set((audit.turns ?? []).filter((turn) => turn.sessionId === analysis.sessionId).map((turn) => turn.turnId));
    if (analysis.evidenceRead?.turnIds.some((turnId) => !sessionTurns.has(turnId)))
        errors.push("evidenceRead contains a Turn outside the selected Session.");
    if (analysis.primaryFinding === null) {
        if (analysis.recommendation !== null)
            errors.push("recommendation must be null when primaryFinding is null.");
    }
    else {
        if (!nonEmpty(analysis.primaryFinding.observation) || !nonEmpty(analysis.primaryFinding.interpretation))
            errors.push("primaryFinding observation and interpretation are required.");
        if (!strings(analysis.primaryFinding.evidenceIds) || analysis.primaryFinding.evidenceIds.length === 0)
            errors.push("primaryFinding must cite at least one Evidence ID.");
        if (!['strong', 'moderate', 'limited'].includes(analysis.primaryFinding.support))
            errors.push("primaryFinding support is invalid.");
        if (!strings(analysis.primaryFinding.alternativeExplanations))
            errors.push("alternativeExplanations must be a list of non-empty strings.");
        errors.push(...sameSessionEvidence(audit, analysis.sessionId, analysis.primaryFinding.evidenceIds).map((id) => "primaryFinding Evidence is unknown or cross-Session: " + id));
        if (analysis.evidenceRead && strings(analysis.evidenceRead.turnIds) && strings(analysis.primaryFinding.evidenceIds)) {
            errors.push(...evidenceNotRead(audit, analysis.sessionId, analysis.evidenceRead.turnIds, analysis.primaryFinding.evidenceIds).map((id) => "primaryFinding Evidence was not read in evidenceRead: " + id));
        }
        if (!analysis.recommendation)
            errors.push("a supported primaryFinding requires one recommendation or an explicit data-gap explanation.");
    }
    if (analysis.recommendation !== null) {
        const recommendation = analysis.recommendation;
        if (![recommendation.action, recommendation.rationale, recommendation.applicability, recommendation.verification].every(nonEmpty))
            errors.push("recommendation requires action, rationale, applicability, and verification.");
        if (recommendation.tradeoff !== null && !nonEmpty(recommendation.tradeoff))
            errors.push("recommendation tradeoff must be null or a non-empty string.");
        if (!strings(recommendation.targetEvidenceIds))
            errors.push("recommendation targetEvidenceIds must be a list of Evidence IDs.");
        errors.push(...sameSessionEvidence(audit, analysis.sessionId, recommendation.targetEvidenceIds).map((id) => "recommendation Evidence is unknown or cross-Session: " + id));
        if (analysis.evidenceRead && strings(analysis.evidenceRead.turnIds) && strings(recommendation.targetEvidenceIds)) {
            errors.push(...evidenceNotRead(audit, analysis.sessionId, analysis.evidenceRead.turnIds, recommendation.targetEvidenceIds).map((id) => "recommendation Evidence was not read in evidenceRead: " + id));
        }
    }
    if (analysis.primaryFinding !== null && packets !== undefined && contentEvidenceInsufficient(audit, analysis, packets)) {
        errors.push("Content Evidence is insufficient for a primaryFinding; primaryFinding and recommendation must be null.");
    }
    if (containsRawEvidence(analysis, packets))
        errors.push("analysis repeats raw historical content instead of a paraphrase.");
    return { valid: errors.length === 0, errors: [...new Set(errors)], analysis: errors.length === 0 ? analysis : null };
}
function composeKeySessionAnalyses(audit, analyses, packets) {
    const fingerprint = auditFingerprint(audit);
    const validCandidates = [];
    const unavailable = [];
    const candidates = (analyses ?? []).slice(0, 3);
    for (const candidate of candidates) {
        const sessionId = candidate && typeof candidate === "object" && !Array.isArray(candidate) && typeof candidate.sessionId === "string"
            ? candidate.sessionId
            : "unknown";
        try {
            const analysis = candidate;
            const result = validateKeySessionAnalysis(audit, analysis, packets?.filter((packet) => packet.sessionId === sessionId));
            if (result.valid && result.analysis) {
                validCandidates.push({ sessionId, analysis: result.analysis, signature: normalizedFinding(audit, result.analysis) });
            }
            else
                unavailable.push(sessionId + ": " + result.errors.join(" "));
        }
        catch {
            unavailable.push(sessionId + ": malformed Key Session Analysis.");
        }
    }
    const groups = new Map();
    for (const candidate of validCandidates) {
        if (candidate.signature === null)
            continue;
        groups.set(candidate.signature, [...(groups.get(candidate.signature) ?? []), candidate]);
    }
    const duplicateCandidates = new Set();
    for (const group of groups.values()) {
        if (group.length < 2)
            continue;
        for (const candidate of group)
            duplicateCandidates.add(candidate);
    }
    const valid = [];
    for (const candidate of validCandidates) {
        if (duplicateCandidates.has(candidate))
            unavailable.push(candidate.sessionId + ": duplicate Session analysis prose; regenerate with Session-specific Evidence.");
        else
            valid.push(candidate.analysis);
    }
    if (candidates.length === 0)
        unavailable.push("Host Agent did not provide Key Session Analysis.");
    return { auditFingerprint: fingerprint, analyses: valid, unavailable };
}
function reportComposition(audit, analyses, synthesis = null, packets) {
    const composition = composeKeySessionAnalyses(audit, analyses, packets);
    const validatedSynthesis = synthesis === null ? null : validateReportSynthesis(audit, synthesis).synthesis;
    return { auditFingerprint: composition.auditFingerprint, audit, reportSynthesis: validatedSynthesis, keySessionAnalyses: composition.analyses };
}
