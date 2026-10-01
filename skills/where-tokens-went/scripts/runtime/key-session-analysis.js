"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditFingerprint = auditFingerprint;
exports.resolveReportEvidence = resolveReportEvidence;
exports.validateReportSynthesis = validateReportSynthesis;
exports.sanitizeKeySessionAnalysis = sanitizeKeySessionAnalysis;
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
function normalizeEvidenceId(id) {
    return id.trim().toLowerCase().replace(/[\s\-_]/g, "");
}
function sameSessionEvidence(audit, sessionId, evidenceIds) {
    if (!Array.isArray(evidenceIds))
        return [];
    const turns = audit.turns ?? [];
    return evidenceIds.filter((evidenceId) => {
        if (typeof evidenceId !== "string")
            return true;
        const trimmed = evidenceId.trim();
        const exactMatches = turns.filter((turn) => turn.evidenceId === trimmed);
        if (exactMatches.length === 1)
            return exactMatches[0].sessionId !== sessionId;
        if (exactMatches.length > 1)
            return true; // ambiguous
        const norm = normalizeEvidenceId(trimmed);
        const normalizedMatches = turns.filter((turn) => normalizeEvidenceId(turn.evidenceId) === norm);
        if (normalizedMatches.length === 1)
            return normalizedMatches[0].sessionId !== sessionId;
        return true; // ambiguous or unknown
    });
}
function evidenceNotRead(audit, sessionId, turnIds, evidenceIds) {
    if (!Array.isArray(evidenceIds) || !Array.isArray(turnIds))
        return [];
    const readTurns = (audit.turns ?? []).filter((turn) => turn.sessionId === sessionId && turnIds.includes(turn.turnId));
    return evidenceIds.filter((evidenceId) => {
        if (typeof evidenceId !== "string")
            return true;
        const trimmed = evidenceId.trim();
        const exactMatches = readTurns.filter((turn) => turn.evidenceId === trimmed);
        if (exactMatches.length === 1)
            return false;
        if (exactMatches.length > 1)
            return true; // ambiguous
        const norm = normalizeEvidenceId(trimmed);
        const normalizedMatches = readTurns.filter((turn) => normalizeEvidenceId(turn.evidenceId) === norm);
        if (normalizedMatches.length === 1)
            return false;
        return true; // not read or ambiguous
    });
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
    const trimmed = reference.trim();
    if (trimmed.toLowerCase().startsWith("summary:")) {
        const rawKey = trimmed.slice("summary:".length).trim();
        if (hasOwn(audit.summary, rawKey) && audit.summary[rawKey]) {
            return { kind: "summary", key: rawKey, evidence: [audit.summary[rawKey]] };
        }
        const normKey = normalizeEvidenceId(rawKey);
        const matches = [];
        for (const [k, v] of Object.entries(audit.summary)) {
            if (normalizeEvidenceId(k) === normKey && v) {
                matches.push([k, v]);
            }
        }
        if (matches.length === 1) {
            return { kind: "summary", key: matches[0][0], evidence: [matches[0][1]] };
        }
        return null;
    }
    const checkMatch = /^check:([^:]+)(?::(\d+))?$/i.exec(trimmed);
    if (checkMatch) {
        const rawId = checkMatch[1].trim();
        let check;
        const exact = audit.checks.filter((candidate) => candidate.id === rawId);
        if (exact.length === 1) {
            check = exact[0];
        }
        else if (exact.length > 1) {
            return null;
        }
        else {
            const normId = normalizeEvidenceId(rawId);
            const normalizedMatches = audit.checks.filter((candidate) => normalizeEvidenceId(candidate.id) === normId);
            if (normalizedMatches.length === 1) {
                check = normalizedMatches[0];
            }
            else {
                return null;
            }
        }
        if (!check || check.evidence.length === 0)
            return null;
        if (checkMatch[2] === undefined)
            return { kind: "check", key: check.id, evidence: check.evidence };
        const index = Number(checkMatch[2]);
        return Number.isSafeInteger(index) && index < check.evidence.length
            ? { kind: "check", key: check.id + ":" + index, evidence: [check.evidence[index]] }
            : null;
    }
    const rankingMatch = /^ranking:(sessions|projects|models|timeBuckets):(.+)$/i.exec(trimmed);
    if (rankingMatch) {
        const normDimension = rankingMatch[1].toLowerCase();
        const dimensionKey = normDimension === "timebuckets" ? "timeBuckets" : normDimension;
        const rawKey = rankingMatch[2].trim();
        const entries = audit.rankings[dimensionKey] ?? [];
        let entry;
        const exact = entries.filter((candidate) => candidate.key === rawKey);
        if (exact.length === 1) {
            entry = exact[0];
        }
        else if (exact.length > 1) {
            return null;
        }
        else {
            const normKey = normalizeEvidenceId(rawKey);
            const normalizedMatches = entries.filter((candidate) => normalizeEvidenceId(candidate.key) === normKey);
            if (normalizedMatches.length === 1) {
                entry = normalizedMatches[0];
            }
            else {
                return null;
            }
        }
        return entry ? { kind: "ranking", dimension: dimensionKey, key: entry.key, evidence: [entry.value, entry.sharePercent, entry.count] } : null;
    }
    const turns = audit.turns ?? [];
    let turn;
    const exact = turns.filter((candidate) => candidate.evidenceId === trimmed);
    if (exact.length === 1) {
        turn = exact[0];
    }
    else if (exact.length > 1) {
        return null;
    }
    else {
        const normTrimmed = normalizeEvidenceId(trimmed);
        const normalizedMatches = turns.filter((candidate) => normalizeEvidenceId(candidate.evidenceId) === normTrimmed);
        if (normalizedMatches.length === 1) {
            turn = normalizedMatches[0];
        }
        else {
            return null;
        }
    }
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
    if (candidate.auditFingerprint !== expectedFingerprint) {
        return { valid: false, errors: ["Audit fingerprint is stale or belongs to another Audit."], synthesis: null };
    }
    let validOverview = null;
    if (!candidate.overview || typeof candidate.overview !== "object" || Array.isArray(candidate.overview)) {
        errors.push("overview must be an object.");
    }
    else {
        const overview = candidate.overview;
        if (!nonEmpty(overview.summary)) {
            errors.push("overview.summary must be a non-empty string.");
        }
        else if (!Array.isArray(overview.evidenceRefs) || overview.evidenceRefs.length < 1 || overview.evidenceRefs.length > 3 || !overview.evidenceRefs.every(nonEmpty)) {
            errors.push("overview.evidenceRefs must contain one to three non-empty Evidence references.");
        }
        else {
            let overviewEvidenceValid = true;
            for (const reference of overview.evidenceRefs) {
                if (!resolveReportEvidence(audit, reference)) {
                    errors.push("Overview cites unknown or cross-Audit Evidence: " + reference);
                    overviewEvidenceValid = false;
                }
            }
            if (overviewEvidenceValid) {
                validOverview = {
                    summary: overview.summary,
                    evidenceRefs: [...overview.evidenceRefs],
                };
            }
        }
    }
    const validFindings = [];
    if (!Array.isArray(candidate.findings)) {
        return { valid: false, errors: ["findings must be a list."], synthesis: null };
    }
    if (candidate.findings.length > 5) {
        return { valid: false, errors: ["Report synthesis cannot contain more than five Findings."], synthesis: null };
    }
    for (const [index, finding] of candidate.findings.entries()) {
        if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
            errors.push("Finding " + index + " is malformed.");
            continue;
        }
        const item = finding;
        let findingValid = true;
        if (!nonEmpty(item.title)) {
            errors.push("Finding " + index + " requires a title.");
            findingValid = false;
        }
        if (!nonEmpty(item.analysis)) {
            errors.push("Finding " + index + " requires analysis.");
            findingValid = false;
        }
        if (!Array.isArray(item.evidenceRefs) || item.evidenceRefs.length === 0 || !item.evidenceRefs.every(nonEmpty)) {
            errors.push("Finding " + index + " requires at least one Evidence reference.");
            findingValid = false;
        }
        else {
            for (const reference of item.evidenceRefs) {
                if (!resolveReportEvidence(audit, reference)) {
                    errors.push("Finding " + index + " cites unknown or cross-Audit Evidence: " + reference);
                    findingValid = false;
                }
            }
        }
        if (!isSupport(item.support)) {
            errors.push("Finding " + index + " has invalid support.");
            findingValid = false;
        }
        if (!hasOwn(item, "uncertainty") || (item.uncertainty !== null && !nonEmpty(item.uncertainty))) {
            errors.push("Finding " + index + " uncertainty must be null or a non-empty string.");
            findingValid = false;
        }
        if (findingValid) {
            validFindings.push({
                title: item.title,
                analysis: item.analysis,
                evidenceRefs: [...item.evidenceRefs],
                support: item.support,
                uncertainty: item.uncertainty ?? null,
            });
        }
    }
    if (validOverview && validFindings.length > 0) {
        const groups = new Map();
        for (const [index, finding] of validFindings.entries()) {
            const signature = canonicalizeNarrative(audit, finding.title, finding.analysis);
            groups.set(signature, [...(groups.get(signature) ?? []), index]);
        }
        for (const group of groups.values()) {
            if (group.length > 1)
                errors.push("Findings " + group.join(", ") + " form an interchangeable parameterized narrative group; regenerate distinct Findings.");
        }
        const overviewSignature = canonicalizeNarrative(audit, validOverview.summary);
        for (const [index, finding] of validFindings.entries()) {
            const findingNarratives = new Set([
                canonicalizeNarrative(audit, finding.title),
                canonicalizeNarrative(audit, finding.analysis),
                canonicalizeNarrative(audit, finding.title, finding.analysis),
            ]);
            if (findingNarratives.has(overviewSignature))
                errors.push("Overview is an interchangeable restatement of Finding " + index + ".");
        }
    }
    const noStrongReason = typeof candidate.noStrongFindingReason === "string" && candidate.noStrongFindingReason.trim()
        ? candidate.noStrongFindingReason.trim()
        : null;
    if (validFindings.length > 0) {
        return {
            valid: true,
            errors: [...new Set(errors)],
            synthesis: {
                auditFingerprint: expectedFingerprint,
                overview: validOverview,
                findings: validFindings,
                noStrongFindingReason: null,
            },
        };
    }
    if (noStrongReason) {
        return {
            valid: true,
            errors: [...new Set(errors)],
            synthesis: {
                auditFingerprint: expectedFingerprint,
                overview: validOverview,
                findings: [],
                noStrongFindingReason: noStrongReason,
            },
        };
    }
    errors.push("Report synthesis has no valid findings and no valid noStrongFindingReason.");
    return {
        valid: false,
        errors: [...new Set(errors)],
        synthesis: null,
    };
}
function normalizeWhitespaceMapping(orig) {
    let normalized = "";
    const normToOrigStart = [];
    const normToOrigEnd = [];
    let p = 0;
    while (p < orig.length) {
        if (/\s/u.test(orig[p])) {
            const start = p;
            while (p < orig.length && /\s/u.test(orig[p])) {
                p++;
            }
            const normIdx = normalized.length;
            normalized += " ";
            normToOrigStart[normIdx] = start;
            normToOrigEnd[normIdx] = p;
        }
        else {
            const normIdx = normalized.length;
            normalized += orig[p];
            normToOrigStart[normIdx] = p;
            normToOrigEnd[normIdx] = p + 1;
            p++;
        }
    }
    return { normalized, normToOrigStart, normToOrigEnd };
}
function extractHistoryNorms(packets) {
    if (!packets || packets.length === 0)
        return [];
    const norms = new Set();
    for (const packet of packets) {
        for (const item of packet.items ?? []) {
            if (typeof item.content === "string") {
                const unellipsed = item.content.replace(/(?:…|\.{3})$/, "");
                const normalized = unellipsed.replace(/\s+/gu, " ").trim();
                if (normalized.length >= 40) {
                    norms.add(normalized);
                }
            }
        }
    }
    return [...norms];
}
function findRawEvidenceSpans(text, historyNorms, minLength = 40) {
    if (!text || text.length < minLength || historyNorms.length === 0) {
        return [];
    }
    const { normalized, normToOrigStart, normToOrigEnd } = normalizeWhitespaceMapping(text);
    if (normalized.length < minLength) {
        return [];
    }
    const candidates = [];
    for (const hist of historyNorms) {
        if (hist.length < minLength)
            continue;
        let i = 0;
        while (i <= normalized.length - minLength) {
            const probe = normalized.slice(i, i + minLength);
            if (!hist.includes(probe)) {
                i++;
                continue;
            }
            let low = minLength;
            let high = normalized.length - i;
            let bestLen = minLength;
            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                if (hist.includes(normalized.slice(i, i + mid))) {
                    bestLen = mid;
                    low = mid + 1;
                }
                else {
                    high = mid - 1;
                }
            }
            const origStart = normToOrigStart[i];
            const origEnd = normToOrigEnd[i + bestLen - 1];
            candidates.push({ origStart, origEnd, normLen: bestLen });
            i++;
        }
    }
    if (candidates.length === 0) {
        return [];
    }
    // 最长匹配优先替换，重叠片段一次处理
    candidates.sort((a, b) => b.normLen - a.normLen || a.origStart - b.origStart);
    const accepted = [];
    for (const cand of candidates) {
        let merged = false;
        for (let k = 0; k < accepted.length; k++) {
            const existing = accepted[k];
            if (Math.max(cand.origStart, existing.origStart) <= Math.min(cand.origEnd, existing.origEnd)) {
                existing.origStart = Math.min(existing.origStart, cand.origStart);
                existing.origEnd = Math.max(existing.origEnd, cand.origEnd);
                merged = true;
                break;
            }
        }
        if (!merged) {
            accepted.push({ origStart: cand.origStart, origEnd: cand.origEnd });
        }
    }
    accepted.sort((a, b) => a.origStart - b.origStart);
    const finalSpans = [];
    for (const span of accepted) {
        if (finalSpans.length === 0) {
            finalSpans.push(span);
        }
        else {
            const prev = finalSpans[finalSpans.length - 1];
            if (span.origStart <= prev.origEnd) {
                prev.origEnd = Math.max(prev.origEnd, span.origEnd);
            }
            else {
                finalSpans.push(span);
            }
        }
    }
    return finalSpans;
}
function redactTextField(text, path, historyNorms, redactions) {
    const spans = findRawEvidenceSpans(text, historyNorms, 40);
    if (spans.length === 0) {
        return text;
    }
    let current = text;
    for (let j = spans.length - 1; j >= 0; j--) {
        current = current.slice(0, spans[j].origStart) + "[已移除直接引用的历史内容]" + current.slice(spans[j].origEnd);
    }
    redactions.push({
        code: "RAW_EVIDENCE_REDACTED",
        fieldPath: path,
        count: spans.length,
    });
    return current;
}
function isOnlyPlaceholderAndPunctuation(text) {
    if (typeof text !== "string")
        return false;
    const withoutPlaceholder = text.replaceAll("[已移除直接引用的历史内容]", "");
    const meaningful = withoutPlaceholder.replace(/[\p{P}\p{S}\s]/gu, "");
    return meaningful.length === 0;
}
const CREDENTIAL_PATTERNS = [
    /(?:api[_-]?key|access[_-]?token|password|secret|credential)\s*[:=]\s*["']?(?!<redacted>|\[已移除)[^\s,"'}]+/i,
    /Bearer\s+(?!<redacted>|\[已移除)[A-Za-z0-9._-]+/i,
];
function stringContainsUnredactedCredentials(text) {
    if (typeof text !== "string")
        return false;
    return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text));
}
function containsUnredactedCredentials(analysis) {
    const fields = [
        analysis.taskContext,
        analysis.primaryFinding?.observation,
        analysis.primaryFinding?.interpretation,
        ...(analysis.primaryFinding?.alternativeExplanations ?? []),
        analysis.recommendation?.action,
        analysis.recommendation?.rationale,
        analysis.recommendation?.applicability,
        analysis.recommendation?.tradeoff,
        analysis.recommendation?.verification,
        ...(analysis.limitations ?? []),
    ];
    return fields.some((field) => stringContainsUnredactedCredentials(field));
}
function sanitizeKeySessionAnalysis(analysis, packets) {
    if (!packets || packets.length === 0) {
        return { sanitized: analysis, redactions: [] };
    }
    const historyNorms = extractHistoryNorms(packets);
    if (historyNorms.length === 0) {
        return { sanitized: analysis, redactions: [] };
    }
    const redactions = [];
    const redact = (text, path) => redactTextField(text, path, historyNorms, redactions);
    const sanitized = {
        ...analysis,
        taskContext: typeof analysis.taskContext === "string" ? redact(analysis.taskContext, "taskContext") : analysis.taskContext,
        primaryFinding: analysis.primaryFinding
            ? {
                ...analysis.primaryFinding,
                observation: typeof analysis.primaryFinding.observation === "string"
                    ? redact(analysis.primaryFinding.observation, "primaryFinding.observation")
                    : analysis.primaryFinding.observation,
                interpretation: typeof analysis.primaryFinding.interpretation === "string"
                    ? redact(analysis.primaryFinding.interpretation, "primaryFinding.interpretation")
                    : analysis.primaryFinding.interpretation,
                alternativeExplanations: Array.isArray(analysis.primaryFinding.alternativeExplanations)
                    ? analysis.primaryFinding.alternativeExplanations.map((alt, i) => typeof alt === "string" ? redact(alt, `primaryFinding.alternativeExplanations[${i}]`) : alt)
                    : analysis.primaryFinding.alternativeExplanations,
            }
            : null,
        recommendation: analysis.recommendation
            ? {
                ...analysis.recommendation,
                action: typeof analysis.recommendation.action === "string"
                    ? redact(analysis.recommendation.action, "recommendation.action")
                    : analysis.recommendation.action,
                rationale: typeof analysis.recommendation.rationale === "string"
                    ? redact(analysis.recommendation.rationale, "recommendation.rationale")
                    : analysis.recommendation.rationale,
                applicability: typeof analysis.recommendation.applicability === "string"
                    ? redact(analysis.recommendation.applicability, "recommendation.applicability")
                    : analysis.recommendation.applicability,
                tradeoff: typeof analysis.recommendation.tradeoff === "string"
                    ? redact(analysis.recommendation.tradeoff, "recommendation.tradeoff")
                    : analysis.recommendation.tradeoff,
                verification: typeof analysis.recommendation.verification === "string"
                    ? redact(analysis.recommendation.verification, "recommendation.verification")
                    : analysis.recommendation.verification,
            }
            : null,
        limitations: Array.isArray(analysis.limitations)
            ? analysis.limitations.map((lim, i) => typeof lim === "string" ? redact(lim, `limitations[${i}]`) : lim)
            : analysis.limitations,
    };
    // 必需解释脱敏后只剩占位符时，输出明确未知并移除依赖该解释的建议；独立合法内容继续保留。
    let primaryFinding = sanitized.primaryFinding;
    let recommendation = sanitized.recommendation;
    let limitations = Array.isArray(sanitized.limitations) ? [...sanitized.limitations] : [];
    if (primaryFinding !== null) {
        const obsBlank = isOnlyPlaceholderAndPunctuation(primaryFinding.observation);
        const intBlank = isOnlyPlaceholderAndPunctuation(primaryFinding.interpretation);
        if (obsBlank || intBlank) {
            primaryFinding = null;
            recommendation = null;
            const unavailableMsg = "Primary mechanism observation or interpretation contained only directly cited historical content and was redacted; mechanism is unavailable.";
            if (!limitations.includes(unavailableMsg)) {
                limitations.push(unavailableMsg);
            }
        }
    }
    if (recommendation !== null) {
        const actBlank = isOnlyPlaceholderAndPunctuation(recommendation.action);
        const ratBlank = isOnlyPlaceholderAndPunctuation(recommendation.rationale);
        if (actBlank || ratBlank) {
            recommendation = null;
            const unavailableMsg = "Proposed action or rationale contained only directly cited historical content and was redacted; recommendation is unavailable.";
            if (!limitations.includes(unavailableMsg)) {
                limitations.push(unavailableMsg);
            }
        }
    }
    if (isOnlyPlaceholderAndPunctuation(sanitized.taskContext)) {
        sanitized.taskContext = "Task context contained only directly cited historical content and was redacted; specific task is unavailable.";
    }
    sanitized.primaryFinding = primaryFinding;
    sanitized.recommendation = recommendation;
    sanitized.limitations = limitations;
    return { sanitized, redactions };
}
function containsRawEvidence(analysis, packets) {
    if (!packets || packets.length === 0)
        return false;
    const historyNorms = extractHistoryNorms(packets);
    if (historyNorms.length === 0)
        return false;
    const fields = [
        analysis.taskContext,
        analysis.primaryFinding?.observation,
        analysis.primaryFinding?.interpretation,
        ...(analysis.primaryFinding?.alternativeExplanations ?? []),
        analysis.recommendation?.action,
        analysis.recommendation?.rationale,
        analysis.recommendation?.applicability,
        analysis.recommendation?.tradeoff,
        analysis.recommendation?.verification,
        ...(analysis.limitations ?? []),
    ];
    return fields.some((field) => typeof field === "string" && findRawEvidenceSpans(field, historyNorms, 40).length > 0);
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
    const accountingStatus = selectedSessionAccounting ?? audit.summary.keySessionTokenAccountingStatus?.value ?? audit.summary.tokenAccountingStatus?.value;
    if (audit.scope.harness === "codex" && analysis.primaryFinding !== null && accountingStatus !== "reconciled") {
        if (analysis.primaryFinding.support === "strong") {
            errors.push("Codex Token accounting is not reconciled for the selected Key Session; strong conclusions are blocked.");
        }
        if (!Array.isArray(analysis.limitations) || analysis.limitations.length === 0 || !analysis.limitations.every(nonEmpty)) {
            errors.push("limitations must be a non-empty list of non-empty strings when Token accounting is not reconciled.");
        }
    }
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
    if (containsUnredactedCredentials(analysis))
        errors.push("analysis contains unredacted credentials.");
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
function reportComposition(audit, analyses, synthesis = null, packets, skillInsights, skillInsightsSnapshotId) {
    const composition = composeKeySessionAnalyses(audit, analyses, packets);
    const validatedSynthesis = synthesis === null ? null : validateReportSynthesis(audit, synthesis).synthesis;
    return {
        auditFingerprint: composition.auditFingerprint,
        audit,
        reportSynthesis: validatedSynthesis,
        keySessionAnalyses: composition.analyses,
        skillInsights,
        skillInsightsSnapshotId,
    };
}
