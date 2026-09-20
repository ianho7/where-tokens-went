"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeLocale = normalizeLocale;
exports.formatCompact = formatCompact;
exports.resolveReportProjectName = resolveReportProjectName;
exports.collectReportFontCharacters = collectReportFontCharacters;
exports.subsetReportFonts = subsetReportFonts;
exports.renderHtml = renderHtml;
exports.renderText = renderText;
exports.renderWeekText = renderWeekText;
exports.renderShare = renderShare;
const node_fs_1 = require("node:fs");
const node_crypto_1 = require("node:crypto");
const node_path_1 = require("node:path");
const key_session_analysis_1 = require("./key-session-analysis");
const skill_insights_1 = require("./skill-insights");
const report_messages_1 = require("./report-messages");
function normalizeLocale(value) {
    return value && value.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}
function labelsFor(locale) {
    return (0, report_messages_1.reportMessagesFor)(locale);
}
function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
function numberFormatter(locale) {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
}
function formatCompact(value, locale) {
    if (value === null || !Number.isFinite(value))
        return labelsFor(locale).unavailable;
    const absolute = Math.abs(value);
    const labels = labelsFor(locale);
    if (labels.compactLargeUnit && absolute >= 100000000)
        return numberFormatter(locale).format(value / 100000000) + labels.compactLargeUnit;
    if (labels.compactMediumUnit && absolute >= 10000)
        return numberFormatter(locale).format(value / 10000) + labels.compactMediumUnit;
    return new Intl.NumberFormat(locale, {
        notation: "compact",
        compactDisplay: "short",
        maximumFractionDigits: 2,
    }).format(value);
}
function formatExact(value, locale) {
    if (value === null)
        return labelsFor(locale).unavailable;
    return typeof value === "number" ? new Intl.NumberFormat(locale, { maximumFractionDigits: 20 }).format(value) : String(value);
}
function formatCurrency(value, locale) {
    if (value === null)
        return labelsFor(locale).unavailable;
    const numericValue = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numericValue)
        ? new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numericValue)
        : String(value);
}
function formatDateKey(value, _locale, includeYear = true) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match)
        return value;
    return (includeYear ? match[1] + "." : "") + match[2] + "." + match[3];
}
function formatDateTime(value, locale) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return value;
    const parts = new Intl.DateTimeFormat(labelsFor(locale).intlLocale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).formatToParts(date);
    const part = (type) => parts.find((item) => item.type === type)?.value ?? "";
    const hour = part("hour") === "24" ? "00" : part("hour");
    return part("year") + "." + part("month") + "." + part("day") + " " + hour + ":" + part("minute");
}
function dateEvidence(value, locale) {
    return typeof value.value === "string" ? { ...value, value: formatDateTime(value.value, locale) } : value;
}
function usdText(value) {
    return value.startsWith("-") ? "-$" + value.slice(1) : "$" + value;
}
function provenancePrefix(provenance, locale) {
    return provenance === "estimated" ? labelsFor(locale).estimatedPrefix : "";
}
function provenanceLabel(provenance, locale) {
    const labels = labelsFor(locale);
    return provenance === "reported"
        ? labels.reported
        : provenance === "derived"
            ? labels.derived
            : provenance === "estimated"
                ? labels.estimated
                : labels.unavailableProvenance;
}
function provenanceTitle(value, locale) {
    const labels = labelsFor(locale);
    return labels.provenance + labels.exactSeparator + provenanceLabel(value.provenance, locale);
}
function provenanceSeparator(locale) {
    return labelsFor(locale).provenanceSeparator;
}
function proseSeparator(locale) {
    return locale === "zh-CN" ? "；" : "; ";
}
function completeSentence(value, locale) {
    const text = value.trim();
    if (!text)
        return "";
    const terminal = locale === "zh-CN" ? /[。！？]$/u : /[.!?]$/u;
    return terminal.test(text) ? text : text + (locale === "zh-CN" ? "。" : ".");
}
function evidencePlain(value, locale, compact = true) {
    if (value.value === null)
        return "—";
    const raw = typeof value.value === "number"
        ? compact ? formatCompact(value.value, locale) : formatExact(value.value, locale)
        : String(value.value);
    return provenancePrefix(value.provenance, locale) + raw;
}
function percentagePlain(value, locale) {
    if (value.value === null)
        return "—";
    const raw = typeof value.value === "number" ? formatExact(value.value, locale) : String(value.value);
    return provenancePrefix(value.provenance, locale) + raw + "%";
}
function metricPlain(value, locale, compact = true) {
    if (value.value === null)
        return "—";
    const raw = typeof value.value === "number"
        ? compact ? formatCompact(value.value, locale) : formatExact(value.value, locale)
        : String(value.value);
    return provenancePrefix(value.provenance, locale) + raw;
}
function evidenceHtml(value, locale, compact = true, currency = false) {
    const labels = labelsFor(locale);
    if (value.value === null) {
        const title = provenanceTitle(value, locale);
        return "<span class=\"metric-stack\" data-provenance=\"unavailable\" aria-label=\"" + escapeHtml(title) + "\"><span class=\"unavailable\" title=\"" + escapeHtml(title) + "\">—</span></span>";
    }
    const compactValue = typeof value.value === "number" && compact ? formatCompact(value.value, locale) : formatExact(value.value, locale);
    const displayValue = currency && !compact ? formatCurrency(value.value, locale) : compactValue;
    const exactValue = formatExact(value.value, locale);
    const title = labels.exact + labels.exactSeparator + (currency ? usdText(exactValue) : exactValue) + provenanceSeparator(locale) + provenanceTitle(value, locale);
    return "<span class=\"metric-stack\" data-provenance=\"" + value.provenance + "\" data-sort=\"" + (typeof value.value === "number" ? String(value.value) : "") + "\" aria-label=\"" + escapeHtml(title) + "\"><span class=\"metric-main\" title=\"" +
        escapeHtml(title) + "\">" + escapeHtml(provenancePrefix(value.provenance, locale) + (currency ? usdText(displayValue) : displayValue)) + "</span></span>";
}
function currencyPlain(value, locale, compact = true) {
    if (value.value === null)
        return "—";
    const raw = typeof value.value === "number"
        ? compact ? formatCompact(value.value, locale) : formatCurrency(value.value, locale)
        : String(value.value);
    return provenancePrefix(value.provenance, locale) + usdText(raw);
}
function findingEvidenceHtml(value, locale, kind, compact = true) {
    if (value.value === null)
        return evidenceHtml(value, locale, false);
    const labels = labelsFor(locale);
    const compactValue = kind === "percentage"
        ? formatExact(value.value, locale) + "%"
        : typeof value.value === "number" && compact ? formatCompact(value.value, locale) : formatExact(value.value, locale);
    const exactValue = formatExact(value.value, locale) + (kind === "percentage" ? "%" : "");
    const title = labels.exact + labels.exactSeparator + exactValue + provenanceSeparator(locale) + provenanceTitle(value, locale);
    return "<span class=\"finding-evidence\" data-provenance=\"" + escapeHtml(value.provenance) + "\" data-sort=\"" +
        (typeof value.value === "number" ? String(value.value) : "") + "\" aria-label=\"" + escapeHtml(title) + "\"><span class=\"finding-value\" title=\"" +
        escapeHtml(title) + "\">" + escapeHtml(provenancePrefix(value.provenance, locale) + compactValue) +
        "</span></span>";
}
function findingMetricHtml(value, locale, compact = true) {
    return findingEvidenceHtml(value, locale, "metric", compact);
}
function findingPercentageHtml(value, locale) {
    return findingEvidenceHtml(value, locale, "percentage", false);
}
function percentageHtml(value, locale) {
    const labels = labelsFor(locale);
    if (value.value === null)
        return evidenceHtml(value, locale, false);
    const exactValue = formatExact(value.value, locale) + "%";
    const title = labels.exact + labels.exactSeparator + exactValue + provenanceSeparator(locale) + provenanceTitle(value, locale);
    return "<span class=\"metric-stack\" data-provenance=\"" + value.provenance + "\" data-sort=\"" + String(value.value) + "\" aria-label=\"" + escapeHtml(title) + "\"><span class=\"percentage\" title=\"" +
        escapeHtml(title) + "\">" + escapeHtml(provenancePrefix(value.provenance, locale) + exactValue) + "</span></span>";
}
function metricValueHtml(value, locale, kind, compact = true) {
    return kind === "percentage"
        ? percentageHtml(value, locale)
        : evidenceHtml(value, locale, compact, kind === "currency");
}
function renderMetric(label, value, locale, kind = "metric", compact = true) {
    return "<div class=\"metric\"><span class=\"metric-label\">" + escapeHtml(label) + "</span><strong class=\"metric-value\">" +
        metricValueHtml(value, locale, kind, compact) + "</strong></div>";
}
function renderMetrics(items, locale, variant = "default") {
    const countClass = items.length > 0 ? " metrics--count-" + items.length : "";
    return "<div class=\"metrics metrics--" + variant + countClass + "\">" + items.map(([label, value, kind, compact]) => renderMetric(label, value, locale, kind, compact ?? true)).join("") + "</div>";
}
function tagHtml(label, variant = "quiet") {
    return "<span class=\"tag tag--" + variant + "\">" + escapeHtml(label) + "</span>";
}
function outcomeLabel(outcome, locale) {
    return labelsFor(locale).checks.outcome[outcome];
}
function publicLabel(value, fallback) {
    return value.length <= 80 && /^[A-Za-z0-9_.:@-]+$/.test(value) ? value : fallback;
}
function modelLabel(value, locale) {
    if (value === "<unknown-model>")
        return labelsFor(locale).unknownModel;
    return publicLabel(value, labelsFor(locale).unavailable);
}
function emptyState(labels, message = labels.noData) {
    return "<p class=\"empty\">" + escapeHtml(message) + "</p>";
}
function renderSectionMarker(label) {
    return "<div class=\"section-num\">" + escapeHtml(label) + "</div>";
}
function isPricingLimitation(limitation) {
    return /LiteLLM|price|priced Usage|Provider|model identifier|resolved price entry|currency requires|cost estimate|cost dimension/i.test(limitation);
}
function renderCacheLimitations(cache, locale) {
    const labels = labelsFor(locale);
    const pricing = cache.limitations.some(isPricingLimitation) || (typeof cache.pricedUsageCoveragePercent.value === "number" && cache.pricedUsageCoveragePercent.value < 100);
    const other = cache.limitations.filter((limitation) => !isPricingLimitation(limitation));
    const parts = [];
    if (pricing) {
        parts.push("<p class=\"coverage-note pricing-note\">" + escapeHtml(labels.pricingNote) + "</p>");
    }
    if (other.length > 0) {
        parts.push("<ul class=\"editorial-list\">" + other.map((limitation) => "<li>" + escapeHtml(labels.limitation(limitation)) + "</li>").join("") + "</ul>");
    }
    return parts.join("");
}
function renderWarningList(result, locale) {
    const labels = labelsFor(locale);
    if (result.coverage.warnings.length === 0)
        return emptyState(labels);
    return "<ul class=\"editorial-list\">" + result.coverage.warnings
        .map((warning) => "<li>" + escapeHtml(labels.warning(warning)) + "</li>")
        .join("") + "</ul>";
}
function coverageEvidence(value, method) {
    return { value, provenance: "derived", method };
}
function unavailableEvidence(method) {
    return { value: null, provenance: "unavailable", method };
}
function coverageSummaryEvidence(result, key, method) {
    const candidate = result.summary[key];
    return candidate && candidate.value !== undefined ? candidate : unavailableEvidence(method);
}
function coveragePercentageText(value, locale) {
    if (value.value === null)
        return "—";
    const raw = typeof value.value === "number" ? formatExact(value.value, locale) : String(value.value);
    return provenancePrefix(value.provenance, locale) + raw + "%";
}
function coveragePercentageHtml(value, locale) {
    if (value.value === null)
        return evidenceHtml(value, locale, false);
    const labels = labelsFor(locale);
    const exactValue = formatExact(value.value, locale) + "%";
    const title = labels.exact + labels.exactSeparator + exactValue + provenanceSeparator(locale) + provenanceTitle(value, locale);
    return "<span class=\"coverage-percentage\" data-provenance=\"" + escapeHtml(value.provenance) + "\" data-sort=\"" +
        String(value.value) + "\" aria-label=\"" + escapeHtml(title) + "\"><span title=\"" + escapeHtml(title) + "\">" +
        escapeHtml(provenancePrefix(value.provenance, locale) + exactValue) + "</span></span>";
}
function coverageMetricHtml(value, locale) {
    return evidenceHtml(value, locale, false);
}
function coverageNarrative(result, locale) {
    const labels = labelsFor(locale);
    const messages = labels.coverageMessages;
    const partialCount = coverageEvidence(result.coverage.partialSessions, "count of partial Sessions reported by coverage");
    const sessionCount = coverageSummaryEvidence(result, "sessionCount", "count of selected Session records");
    const rate = result.summary.partialSessionRatePercent ?? unavailableEvidence("source-proven partial Session rate was not reported");
    const partialTop = result.summary.partialTopLevelSessionCount ?? unavailableEvidence("source-proven partial top-level Session count was not reported");
    const partialSubagent = result.summary.partialSubagentSessionCount ?? unavailableEvidence("source-proven partial subagent Session count was not reported");
    const hasQualityGaps = result.coverage.partialSessions > 0 || result.coverage.recordsSkipped > 0 || result.coverage.warnings.length > 0;
    if (!hasQualityGaps) {
        return { text: messages.clean, html: escapeHtml(messages.clean) };
    }
    const observedCaveat = messages.observedCaveat;
    let text;
    let html;
    if (result.coverage.partialSessions > 0 && rate.value !== null) {
        const partialText = metricPlain(partialCount, locale, false);
        const sessionText = metricPlain(sessionCount, locale, false);
        const rateText = coveragePercentageText(rate, locale);
        text = messages.withRate.text(partialText, sessionText, rateText);
        html = coverageMetricHtml(partialCount, locale) + messages.withRate.htmlBetween + coverageMetricHtml(sessionCount, locale) +
            messages.withRate.htmlSessionPrefix + coveragePercentageHtml(rate, locale) + messages.withRate.htmlRateSuffix;
        if (partialTop.value !== null && partialSubagent.value !== null) {
            const allSubagents = partialTop.value === 0 && partialSubagent.value === result.coverage.partialSessions;
            if (allSubagents) {
                text += messages.allPartialSubagents;
                html += escapeHtml(messages.allPartialSubagents);
            }
            else {
                text += messages.composition.text(metricPlain(partialTop, locale, false), metricPlain(partialSubagent, locale, false));
                html += messages.composition.htmlPrefix + coverageMetricHtml(partialTop, locale) + messages.composition.htmlBetween +
                    coverageMetricHtml(partialSubagent, locale) + messages.composition.htmlSuffix;
            }
        }
    }
    else if (result.coverage.partialSessions > 0) {
        text = messages.withoutRate.text(metricPlain(partialCount, locale, false));
        html = coverageMetricHtml(partialCount, locale) + messages.withoutRate.htmlSuffix;
    }
    else {
        text = messages.skippedOrWarnings;
        html = escapeHtml(text);
    }
    text += " " + observedCaveat;
    html += " " + escapeHtml(observedCaveat);
    return { text, html };
}
function coverageLineText(result, locale) {
    const stats = labelsFor(locale).coverageMessages.stats(result.coverage.filesRead, result.coverage.recordsRead, result.coverage.recordsSkipped, result.coverage.partialSessions, result.coverage.warnings.length);
    return coverageNarrative(result, locale).text + " " + stats;
}
function renderCoverage(result, locale) {
    const labels = labelsFor(locale);
    const narrative = coverageNarrative(result, locale);
    const alert = result.coverage.partialSessions > 0 || result.coverage.recordsSkipped > 0 || result.coverage.warnings.length > 0;
    const metrics = [
        [labels.files, coverageEvidence(result.coverage.filesRead, "count of files read"), "metric", false],
        [labels.records, coverageEvidence(result.coverage.recordsRead, "count of records read"), "metric", false],
        [labels.skipped, coverageEvidence(result.coverage.recordsSkipped, "count of records skipped"), "metric", false],
        [labels.partialSessions, coverageEvidence(result.coverage.partialSessions, "count of partial Sessions"), "metric", false],
        [labels.warnings, coverageEvidence(result.coverage.warnings.length, "count of coverage warnings"), "metric", false],
    ];
    const narrativeHtml = alert
        ? "<aside class=\"quiet-callout\"><span class=\"tag tag--quiet\">" + escapeHtml(labels.coverageMessages.alertLabel) + "</span><p>" + narrative.html + "</p></aside>"
        : "<p class=\"coverage-note\">" + narrative.html + "</p>";
    return renderMetrics(metrics, locale, "coverage") + narrativeHtml;
}
function renderScope(result, locale) {
    const labels = labelsFor(locale);
    return "<dl class=\"metadata-grid\">" +
        "<div><dt>" + escapeHtml(labels.harness) + "</dt><dd>" + escapeHtml(result.scope.harness) + "</dd></div>" +
        "<div><dt>" + escapeHtml(labels.scope) + "</dt><dd>" + escapeHtml(result.scope.allProjects ? labels.allProjects : labels.currentProject) + "</dd></div>" +
        "<div><dt>" + escapeHtml(labels.since) + "</dt><dd>" + escapeHtml(formatDateTime(result.scope.since, locale)) + "</dd></div>" +
        "</dl>";
}
function reportDateRange(result, locale) {
    const dates = result.report.dailyUsage.map((row) => row.key).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
    if (dates.length === 0)
        return formatDateTime(result.scope.since, locale).split(" ")[0].slice(5);
    const first = formatDateKey(dates[0], locale, false);
    const last = formatDateKey(dates[dates.length - 1], locale, false);
    return first === last ? first : first + "—" + last;
}
function reportEndDate(result, locale) {
    const dates = result.report.dailyUsage.map((row) => row.key).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
    return dates.length > 0 ? formatDateKey(dates[dates.length - 1], locale) : formatDateTime(result.scope.since, locale).split(" ")[0];
}
function readRepositoryName(cwd) {
    try {
        const config = (0, node_fs_1.readFileSync)((0, node_path_1.join)(cwd, ".git", "config"), "utf8");
        const url = /^\s*url\s*=\s*(.+)$/m.exec(config)?.[1]?.trim();
        if (!url)
            return null;
        const value = url.replace(/[\\/]+$/, "").split(/[\\/:]/).pop() ?? "";
        return value.replace(/\.git$/, "") || null;
    }
    catch {
        return null;
    }
}
function readProjectMetadata(cwd) {
    if (!cwd)
        return { repositoryName: null, name: null };
    const repositoryName = readRepositoryName(cwd);
    try {
        const packageJson = JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.join)(cwd, "package.json"), "utf8"));
        return {
            repositoryName,
            name: typeof packageJson.name === "string" ? packageJson.name.replace(/^@[^/]+\//, "") : null,
        };
    }
    catch {
        try {
            const pyproject = (0, node_fs_1.readFileSync)((0, node_path_1.join)(cwd, "pyproject.toml"), "utf8");
            const name = /^\s*name\s*=\s*["']([^"']+)["']/m.exec(pyproject)?.[1] ?? null;
            return { repositoryName, name };
        }
        catch {
            return { repositoryName, name: null };
        }
    }
}
function resolveReportProjectName(cwd) {
    const metadata = readProjectMetadata(cwd);
    return metadata.repositoryName ?? metadata.name ?? cwd?.split(/[\\/]/).filter(Boolean).pop() ?? null;
}
function projectName(result, metadata, locale, composition) {
    const composed = composition?.projectName;
    if (typeof composed === "string" && composed.trim())
        return composed.trim();
    const explicit = result.projectName;
    if (typeof explicit === "string" && explicit.trim())
        return explicit.trim();
    if (metadata.repositoryName)
        return metadata.repositoryName;
    if (metadata.name)
        return metadata.name;
    const cwd = result.scope.cwd;
    const basename = cwd?.split(/[\\/]/).filter(Boolean).pop();
    return basename && !/^<[^>]+>$/.test(basename) ? basename : (result.scope.allProjects ? labelsFor(locale).allProjects : labelsFor(locale).projectFallback);
}
function renderHeaderMetric(label, value, locale, kind = "metric") {
    return "<div class=\"report-header__metric\"><strong class=\"report-header__metric-value\">" +
        metricValueHtml(value, locale, kind) + "</strong><span class=\"report-header__metric-label\">" +
        escapeHtml(label) + "</span></div>";
}
function validatedReportSynthesis(result, composition) {
    if (!composition || composition.auditFingerprint !== (0, key_session_analysis_1.auditFingerprint)(result))
        return null;
    const validation = (0, key_session_analysis_1.validateReportSynthesis)(result, composition.reportSynthesis);
    return validation.valid ? validation.synthesis : null;
}
function renderReportOverviewEvidence(result, overview, locale) {
    const labels = labelsFor(locale);
    return "<div class=\"report-overview-evidence\" data-evidence-refs=\"" + escapeHtml(overview.evidenceRefs.join(" ")) + "\" aria-label=\"" + escapeHtml(labels.header.overviewEvidence) + "\"><span class=\"report-overview-evidence__label\">" + escapeHtml(labels.header.overviewEvidence) + "</span>" + overview.evidenceRefs.map((reference) => "<span class=\"report-overview-evidence__item\" data-evidence-ref=\"" + escapeHtml(reference) + "\">" + escapeHtml(reportFindingEvidence(result, reference, locale)) + "</span>").join("") + "</div>";
}
function renderReportHeader(result, locale, composition) {
    const labels = labelsFor(locale);
    const metadata = readProjectMetadata(result.scope.cwd);
    const subject = result.scope.allProjects ? labels.allProjects : projectName(result, metadata, locale, composition);
    const eyebrow = labels.header.eyebrow(reportDateRange(result, locale));
    const synthesis = validatedReportSynthesis(result, composition);
    const overview = synthesis?.overview;
    const overviewSummary = overview?.summary ?? labels.header.overviewUnavailable;
    const overviewEvidence = overview ? renderReportOverviewEvidence(result, overview, locale) : "";
    const apiCost = result.report.apiEquivalentCost.total;
    const apiCostText = typeof apiCost.value === "number"
        ? escapeHtml(labels.header.apiEquivalent) + " " + metricValueHtml(apiCost, locale, "currency")
        : "";
    return "<header class=\"report-header\">" +
        "<div class=\"report-header__main\"><div class=\"report-header__identity\">" +
        "<div class=\"report-eyebrow\">" + escapeHtml(eyebrow) + "</div>" +
        "<h1><span class=\"report-header__project\">" + escapeHtml(subject) + "</span><span class=\"report-header__suffix\">" + escapeHtml(labels.header.suffix) + "</span></h1>" +
        "<p class=\"report-deck\">" + escapeHtml(overviewSummary) + "</p>" + overviewEvidence + "</div>" +
        "<div class=\"report-header__primary\"><strong class=\"report-header__value\">" +
        metricValueHtml(result.summary.totalTokens, locale, "metric") + "</strong>" +
        "<span class=\"report-header__primary-label\">" + apiCostText + "</span>" +
        "<span class=\"report-header__primary-date\">" + escapeHtml(labels.header.asOf(reportEndDate(result, locale))) + "</span></div></div>" +
        "<div class=\"report-header__metrics\" aria-label=\"" + escapeHtml(labels.header.keyMetrics) + "\">" +
        renderHeaderMetric(labels.sessions, result.summary.sessionCount, locale) +
        renderHeaderMetric(labels.modelCalls, result.summary.modelCallCount, locale) +
        renderHeaderMetric(labels.cacheReadRate, result.report.cacheEconomics.cacheReadRatePercent, locale, "percentage") +
        renderHeaderMetric(labels.priceCoverage, result.report.cacheEconomics.pricedUsageCoveragePercent, locale, "percentage") +
        "</div></header>";
}
function isTokenAccountingWarning(warning) {
    return warning === "Some Codex Sessions have Turn snapshots that do not reconcile to their per-response Usage; only individually reconciled Sessions are eligible for AI analysis." ||
        warning === "Codex response Usage did not reconcile with the latest cumulative Turn/thread snapshot; AI analysis is unavailable.";
}
function topTaskTokenAccountingStatus(result) {
    const top = result.rankings.sessions.find((entry) => numericValue(entry.value) !== null);
    if (!top)
        return null;
    return result.keySessionTokenAccounting?.find((entry) => entry.sessionId === top.key)?.status ?? null;
}
function primaryLimitation(result, locale) {
    const labels = labelsFor(locale);
    const topTaskAccountingStatus = topTaskTokenAccountingStatus(result);
    if (topTaskAccountingStatus === "mismatch") {
        return locale === "zh-CN"
            ? "Token 记录暂时无法核对；最大去向只代表当前能够核对的记录。"
            : "Token records cannot currently be reconciled; the largest destination covers only records that can be checked now.";
    }
    if (topTaskAccountingStatus === "unavailable") {
        return locale === "zh-CN"
            ? "缺少可核对的 Token 记录，因此最大去向的完整性无法确认。"
            : "Reconciled Token records are unavailable, so the completeness of the largest destination cannot be confirmed.";
    }
    const hasMaterialCoverageGap = result.coverage.recordsSkipped > 0 || result.coverage.partialSessions > 0 ||
        result.coverage.warnings.some((warning) => !isTokenAccountingWarning(warning));
    if (hasMaterialCoverageGap) {
        return locale === "zh-CN"
            ? "数据完整度有限：有记录被跳过或任务记录不完整，最大去向可能被低估。"
            : "Data completeness is limited: skipped or partial task records may undercount the largest destination.";
    }
    if (result.summary.totalTokens.value === null)
        return labels.primaryNoDestination;
    return null;
}
function primaryMechanismText(analysis, locale) {
    const labels = labelsFor(locale);
    const limitation = analysis?.limitations.find((value) => value.trim());
    return limitation && !/Host Agent|Content Evidence|schema|validation|Evidence selection|Session-specific/i.test(limitation)
        ? (locale === "zh-CN" ? "具体机制未知：" : "Mechanism unknown: ") + limitation
        : labels.primaryUnknownMechanism;
}
function renderPrimaryAnswer(result, locale, composition) {
    const labels = labelsFor(locale);
    const top = result.rankings.sessions.find((entry) => numericValue(entry.value) !== null);
    const validated = composition && composition.auditFingerprint === (0, key_session_analysis_1.auditFingerprint)(result)
        ? (0, key_session_analysis_1.composeKeySessionAnalyses)(result, composition.keySessionAnalyses)
        : { analyses: [], unavailable: [] };
    const analysis = top ? validated.analyses.find((candidate) => candidate.sessionId === top.key) : undefined;
    const primaryFinding = analysis?.primaryFinding;
    const destination = top
        ? "<strong class=\"primary-answer__destination-name\">" + escapeHtml(sessionTitle(top, locale)) + "</strong><span class=\"primary-answer__destination-value\">" + keyMetricHtml(top.value, locale, "primary-answer__metric") + " " + escapeHtml(labels.tokens) + "</span><span class=\"primary-answer__destination-share\">" + escapeHtml(labels.share) + labels.exactSeparator + keyPercentageHtml(top.sharePercent, locale) + "</span>"
        : "<strong class=\"primary-answer__destination-name\">" + escapeHtml(labels.primaryNoDestination) + "</strong>";
    const mechanism = primaryFinding
        ? "<p class=\"primary-answer__observation\">" + escapeHtml(primaryFinding.observation) + "</p><p>" + escapeHtml(primaryFinding.interpretation) + "</p>"
        : "<p>" + escapeHtml(primaryMechanismText(analysis, locale)) + "</p>";
    const action = analysis?.recommendation && primaryFinding
        ? "<article class=\"primary-answer__item primary-answer__item--action\"><h3>" + escapeHtml(labels.primaryAction) + "</h3><p class=\"primary-answer__action-title\">" + escapeHtml(analysis.recommendation.action) + "</p><p>" + escapeHtml(analysis.recommendation.rationale) + "</p><p class=\"primary-answer__verification\"><span>" + escapeHtml(labels.verificationMethod) + labels.exactSeparator + "</span>" + escapeHtml(analysis.recommendation.verification) + "</p></article>"
        : "";
    const limitation = primaryLimitation(result, locale);
    const limitationHtml = limitation
        ? "<article class=\"primary-answer__item primary-answer__item--limitation\"><h3>" + escapeHtml(labels.primaryLimitation) + "</h3><p>" + escapeHtml(limitation) + "</p></article>"
        : "";
    const refs = top ? "ranking:sessions:" + top.key : "summary:totalTokens";
    return "<section class=\"primary-answer\" data-evidence-refs=\"" + escapeHtml(refs) + "\" aria-labelledby=\"primary-answer-title\"><header class=\"primary-answer__head\"><span class=\"primary-answer__kicker\">" + escapeHtml(labels.primaryAnswer) + "</span><h2 id=\"primary-answer-title\">" + escapeHtml(top ? labels.primaryDestination : labels.primaryNoDestination) + "</h2></header><div class=\"primary-answer__grid\"><div class=\"primary-answer__item primary-answer__item--destination\"><p class=\"primary-answer__destination\">" + destination + "</p></div><article class=\"primary-answer__item primary-answer__item--mechanism\"><h3>" + escapeHtml(labels.primaryMechanism) + "</h3>" + mechanism + "</article>" + action + limitationHtml + "</div></section>";
}
function renderKpis(result, locale) {
    const labels = labelsFor(locale);
    const sessionBreakdown = result.summary.topLevelSessionCount.value !== null && result.summary.subagentSessionCount.value !== null
        ? [[labels.topLevelSessions, result.summary.topLevelSessionCount, "metric"], [labels.subagentSessions, result.summary.subagentSessionCount, "metric"]]
        : [];
    const items = [
        ...sessionBreakdown,
        ...(result.summary.reportedCost.value === null ? [] : [[labels.reportedCost, result.summary.reportedCost, "currency"]]),
    ];
    return items.length === 0 ? "" : "<section class=\"summary-secondary\"><h2>" + escapeHtml(labels.usageView) + "</h2>" + renderMetrics(items, locale, "summary") + "</section>";
}
function presentCheck(check, locale) {
    const evidence = (index) => evidencePlain(check.evidence[index], locale);
    const percentage = (index) => percentagePlain(check.evidence[index], locale);
    const metricHtml = (index, compact = true) => findingMetricHtml(check.evidence[index], locale, compact);
    const percentageHtmlValue = (index) => findingPercentageHtml(check.evidence[index], locale);
    const labels = labelsFor(locale);
    const messages = labels.checks;
    const status = outcomeLabel(check.outcome, locale);
    if (check.id === "long_session") {
        const message = messages.longSession;
        return {
            outcomeLabel: status,
            headline: message.headline(percentage(2)),
            detail: message.detail(evidence(1), evidence(0)),
            headlineHtml: message.headlinePrefix + percentageHtmlValue(2) + message.headlineSuffix,
            detailHtml: message.detailPrefix + metricHtml(1) + message.detailBetween + metricHtml(0) + message.detailSuffix,
            method: labels.method(check.method),
        };
    }
    if (check.id === "tool_amplification") {
        const message = messages.toolAmplification;
        return {
            outcomeLabel: status,
            headline: message.headline(evidence(2)),
            detail: message.detail(evidence(0), labels.characters, evidence(1)),
            headlineHtml: message.headlinePrefix + metricHtml(2) + message.headlineSuffix,
            detailHtml: message.detailPrefix + metricHtml(0) + message.detailResultSeparator + escapeHtml(labels.characters) + message.detailBetween + metricHtml(1) + message.detailCallSuffix,
            method: labels.method(check.method),
        };
    }
    if (check.id === "extra_calls") {
        const message = messages.extraCalls;
        return {
            outcomeLabel: status,
            headline: message.headline(evidence(0)),
            detail: message.detail,
            headlineHtml: message.headlinePrefix + metricHtml(0) + message.headlineSuffix,
            detailHtml: message.detail,
            method: labels.method(check.method),
        };
    }
    if (check.id === "model_concentration") {
        const message = messages.modelConcentration;
        return {
            outcomeLabel: status,
            headline: message.headline(evidence(0), percentage(1)),
            detail: message.detail(evidence(2)),
            headlineHtml: message.headlinePrefix + metricHtml(0) + message.headlineBetween + percentageHtmlValue(1) + message.headlineSuffix,
            detailHtml: message.detailPrefix + metricHtml(2) + message.detailSuffix,
            method: labels.method(check.method),
        };
    }
    if (check.outcome === "pass") {
        const message = messages.pass;
        return {
            outcomeLabel: status,
            headline: message.headline,
            detail: message.detail(evidence(1), evidence(0)),
            headlineHtml: message.headline,
            detailHtml: message.detailPrefix + metricHtml(1) + message.detailBetween + metricHtml(0) + message.detailSuffix,
            method: labels.method(check.method),
        };
    }
    const message = messages.coverage;
    return {
        outcomeLabel: status,
        headline: message.headline,
        detail: message.detail(evidence(2), evidence(3), evidence(4)),
        headlineHtml: message.headline,
        detailHtml: message.detailPrefix + metricHtml(2) + message.detailSkippedSuffix + metricHtml(3) + message.detailPartialSuffix + metricHtml(4) + message.detailWarningsSuffix,
        method: labels.method(check.method),
    };
}
function checkLine(check, locale) {
    const presented = presentCheck(check, locale);
    return presented.outcomeLabel + ": " + presented.headline + " — " + presented.detail + " " + labelsFor(locale).methodPrefix + presented.method;
}
function reportEvidenceValue(value, locale) {
    const raw = value.value === "mismatch"
        ? locale === "zh-CN" ? "Token 记录暂时无法核对" : "Token records cannot currently be reconciled"
        : value.value === "reconciled"
            ? locale === "zh-CN" ? "已核对" : "reconciled"
            : value.value === "unavailable"
                ? labelsFor(locale).unavailable
                : evidencePlain(value, locale, false);
    return raw + " (" + provenanceLabel(value.provenance, locale) + ")";
}
function reportEvidenceFact(value, label, locale, kind = "metric") {
    const display = kind === "percentage" ? percentagePlain(value, locale) : reportEvidenceValue(value, locale);
    return label + labelsFor(locale).exactSeparator + display;
}
function checkEvidenceLabels(checkId, locale) {
    const labels = labelsFor(locale);
    if (checkId === "long_session")
        return [[labels.totalTokens, "metric"], [labels.modelCalls, "metric"], [labels.share, "percentage"]];
    if (checkId === "tool_amplification")
        return [[labels.resultSize, "metric"], [labels.modelCalls, "metric"], [labels.amplified, "metric"]];
    if (checkId === "extra_calls")
        return [[labels.processEvents, "metric"]];
    if (checkId === "model_concentration")
        return [[labels.totalTokens, "metric"], [labels.share, "percentage"], [labels.modelCalls, "metric"]];
    return [[labels.skipped, "metric"], [labels.partialSessions, "metric"], [labels.warnings, "metric"]];
}
function summaryEvidenceLabel(key, locale) {
    const labels = labelsFor(locale);
    const known = {
        totalTokens: labels.totalTokens,
        sessionCount: labels.sessions,
        topLevelSessionCount: labels.topLevelSessions,
        subagentSessionCount: labels.subagentSessions,
        modelCallCount: labels.modelCalls,
        reportedCost: labels.reportedCost,
        topSessionTokens: labels.primaryDestination,
        topSessionSharePercent: labels.share,
        tokenAccountingStatus: labels.primaryLimitation,
        keySessionTokenAccountingStatus: labels.primaryLimitation,
        responseUsageTotal: labels.modelCalls,
        cumulativeTurnTotal: labels.totalTokens,
        estimatedToolAmplifiedTokens: labels.amplified,
        toolCallCount: labels.tools,
        pairedToolResultCount: labels.pairedResults,
    };
    return known[key] ?? labels.findingEvidence;
}
function checkName(checkId, locale) {
    const labels = labelsFor(locale);
    if (checkId === "long_session")
        return labels.kindLongSession;
    if (checkId === "tool_amplification")
        return labels.kindToolAmplification;
    if (checkId === "extra_calls")
        return labels.kindExtraCalls;
    return labels.automatedCheckEvidence;
}
function reportFindingEvidence(result, reference, locale) {
    const labels = labelsFor(locale);
    const match = (0, key_session_analysis_1.resolveReportEvidence)(result, reference);
    if (!match)
        return labels.unavailable;
    if (match.kind === "check") {
        const checkId = match.key.split(":", 1)[0];
        const outcome = result.checks.find((c) => c.id === checkId)?.outcome;
        const valueLabels = checkEvidenceLabels(checkId, locale);
        const facts = match.evidence.map((value, index) => reportEvidenceFact(value, valueLabels[index]?.[0] ?? labels.findingEvidence, locale, valueLabels[index]?.[1] ?? "metric"));
        const factText = (outcome ? outcomeLabel(outcome, locale) + proseSeparator(locale) : "") + facts.join(proseSeparator(locale));
        return checkName(checkId, locale) + "（" + factText + "）";
    }
    if (match.kind === "ranking") {
        const row = match.dimension ? result.rankings[match.dimension].find((entry) => entry.key === match.key) : undefined;
        const name = row
            ? match.dimension === "sessions" ? sessionTitle(row, locale)
                : match.dimension === "models" ? modelLabel(row.key, locale)
                    : publicLabel(row.displayName ?? row.key, labels.unavailable)
            : labels.unavailable;
        const facts = [
            [labels.tokens, "metric"],
            [labels.share, "percentage"],
            [match.dimension === "sessions" ? labels.modelCalls : labels.calls, "metric"],
        ];
        return name + "（" + match.evidence.map((value, index) => reportEvidenceFact(value, facts[index]?.[0] ?? labels.findingEvidence, locale, facts[index]?.[1] ?? "metric")).join(proseSeparator(locale)) + "）";
    }
    if (match.kind === "turn") {
        const turn = result.turns.find((candidate) => candidate.evidenceId === reference);
        const facts = [[labels.tokens, "metric"], [labels.share, "percentage"], [labels.modelCalls, "metric"]];
        return (turn ? roundLabel(turn, locale) : labels.unavailable) + "（" + match.evidence.map((value, index) => reportEvidenceFact(value, facts[index]?.[0] ?? labels.findingEvidence, locale, facts[index]?.[1] ?? "metric")).join(proseSeparator(locale)) + "）";
    }
    return match.evidence.map((value) => reportEvidenceFact(value, summaryEvidenceLabel(match.key, locale), locale)).join(proseSeparator(locale));
}
function renderReportFinding(result, finding, locale) {
    const labels = labelsFor(locale);
    const support = labels.findingSupport[finding.support];
    const evidence = finding.evidenceRefs.map((reference) => reportFindingEvidence(result, reference, locale)).join(proseSeparator(locale));
    const uncertainty = finding.uncertainty === null ? "" : labels.findingUncertainty + labels.exactSeparator + completeSentence(finding.uncertainty, locale);
    const evidencePrefix = labels.findingEvidence + labels.exactSeparator;
    const evidenceSection = evidence.startsWith(evidencePrefix) ? evidence : evidencePrefix + evidence;
    const method = [evidenceSection, labels.findingSupport[finding.support], uncertainty].filter(Boolean).join(proseSeparator(locale));
    return "<li class=\"editorial-item\" data-evidence-refs=\"" + escapeHtml(finding.evidenceRefs.join(" ")) + "\"><div class=\"editorial-tags\" aria-label=\"" + escapeHtml(support) + "\">" + tagHtml(support) + "</div><strong class=\"editorial-title\">" + escapeHtml(finding.title) + "</strong><p class=\"editorial-detail\">" + escapeHtml(finding.analysis) + "</p><small class=\"editorial-method\">" + escapeHtml(method) + "</small></li>";
}
function renderChecks(result, locale, note = labelsFor(locale).checksNote) {
    const labels = labelsFor(locale);
    const title = labels.diagnosticSignals;
    const noteHtml = "<p class=\"coverage-note\">" + escapeHtml(note) + "</p>";
    if (result.checks.length === 0)
        return "<section><h2>" + escapeHtml(title) + "</h2>" + noteHtml + emptyState(labels, labels.checks.noFinding) + "</section>";
    return "<section class=\"supporting-findings\"><h2>" + escapeHtml(title) + "</h2>" + noteHtml + "<ul>" + result.checks.map((check) => {
        const presented = presentCheck(check, locale);
        const severityTag = tagHtml(presented.outcomeLabel);
        return "<li class=\"editorial-item\" data-outcome=\"" + escapeHtml(check.outcome) + "\"><div class=\"editorial-tags\" aria-label=\"" + escapeHtml(presented.outcomeLabel) + "\">" + severityTag + "</div><strong class=\"editorial-title\">" + presented.headlineHtml + "</strong><p class=\"editorial-detail\">" + presented.detailHtml + "</p><small class=\"editorial-method\">" + escapeHtml(labels.methodPrefix) + escapeHtml(presented.method) + "</small></li>";
    }).join("") + "</ul></section>";
}
function renderFindings(result, locale, composition) {
    const labels = labelsFor(locale);
    const synthesis = validatedReportSynthesis(result, composition);
    if (!synthesis) {
        return renderChecks(result, locale, labels.reportFallbackNote + " " + labels.reportFallbackDetail);
    }
    const note = "<p class=\"coverage-note\">" + escapeHtml(labels.reportSynthesisNote) + "</p>";
    if (synthesis.findings.length === 0) {
        return "<section><h2>" + escapeHtml(labels.diagnosticSignals) + "</h2>" + note + emptyState(labels, labels.noStrongFinding + (locale === "zh-CN" ? "：" : ": ") + synthesis.noStrongFindingReason) + "</section>";
    }
    return "<section class=\"supporting-findings\"><h2>" + escapeHtml(labels.diagnosticSignals) + "</h2>" + note + "<ul>" + synthesis.findings.map((finding) => renderReportFinding(result, finding, locale)).join("") + "</ul></section>";
}
function tokenCell(value, locale) {
    return evidenceHtml(value, locale);
}
function shortenedId(value) {
    return value.length > 20 ? value.slice(0, 8) + "…" + value.slice(-4) : value;
}
function sessionLabel(row, locale) {
    if (row.displayName && row.displayName !== row.key)
        return row.displayName;
    return labelsFor(locale).untitledSession + " · " + shortenedId(row.key);
}
function reportDerivedEvidence(value, method) {
    return value === null ? { value: null, provenance: "unavailable", method } : { value, provenance: "derived", method };
}
function sessionTurns(result, sessionId) {
    return (result.turns ?? []).filter((turn) => turn.sessionId === sessionId);
}
function sessionActiveTime(result, sessionId) {
    const turns = sessionTurns(result, sessionId);
    const durations = turns.map((turn) => turn.durationMs.value).filter((value) => typeof value === "number");
    if (durations.length > 0)
        return reportDerivedEvidence(durations.reduce((sum, value) => sum + value, 0), "sum of source-reported Turn durations in the Session");
    const spans = turns.map((turn) => turn.observedSpanMs.value).filter((value) => typeof value === "number");
    return spans.length > 0 ? reportDerivedEvidence(spans.reduce((sum, value) => sum + value, 0), "sum of observed Turn spans; exact active time was unavailable") : { value: null, provenance: "unavailable", method: "Session has no complete Turn duration or observed span" };
}
function sessionCompleteness(result, sessionId) {
    const turns = sessionTurns(result, sessionId);
    if (turns.length === 0)
        return { value: null, provenance: "unavailable", method: "Session has no Turn trajectory" };
    return reportDerivedEvidence(Math.round((turns.reduce((sum, turn) => sum + Number(turn.coverage.value ?? 0), 0) / turns.length) * 100) / 100, "mean of Turn evidence completeness percentages");
}
function sessionTitle(row, locale) {
    const displayName = row.displayName?.trim();
    if (displayName && displayName !== row.key) {
        const suffix = " (" + row.key + ")";
        return displayName.endsWith(suffix) ? displayName.slice(0, -suffix.length) : displayName;
    }
    return labelsFor(locale).untitledSession;
}
function keyValueText(value, locale, compact = true) {
    if (value.value === null)
        return "—";
    return typeof value.value === "number"
        ? (compact ? formatCompact(value.value, locale) : formatExact(value.value, locale))
        : String(value.value);
}
function keyMetricHtml(value, locale, className = "", compact = true) {
    const classes = className ? " " + className : "";
    if (value.value === null)
        return "<span class=\"key-value unavailable" + classes + "\" aria-label=\"" + escapeHtml(labelsFor(locale).unavailable) + "\">—</span>";
    const display = keyValueText(value, locale, compact);
    const sort = typeof value.value === "number" ? " data-sort=\"" + String(value.value) + "\"" : "";
    return "<span class=\"key-value" + classes + "\" data-provenance=\"" + escapeHtml(value.provenance) + "\"" + sort + " aria-label=\"" + escapeHtml(display) + "\">" + escapeHtml(display) + "</span>";
}
function keyPercentageHtml(value, locale, className = "") {
    if (value.value === null)
        return keyMetricHtml(value, locale, className, false);
    const display = keyValueText(value, locale, false) + "%";
    const sort = typeof value.value === "number" ? " data-sort=\"" + String(value.value) + "\"" : "";
    return "<span class=\"key-value" + (className ? " " + className : "") + "\" data-provenance=\"" + escapeHtml(value.provenance) + "\"" + sort + " aria-label=\"" + escapeHtml(display) + "\">" + escapeHtml(display) + "</span>";
}
function durationText(value, locale) {
    if (typeof value.value !== "number" || !Number.isFinite(value.value))
        return "—";
    const totalSeconds = Math.max(0, Math.round(value.value / 1000));
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);
    const duration = labelsFor(locale).duration;
    if (hours > 0)
        return hours + duration.hour + (minutes > 0 ? duration.separator + minutes + duration.minute : "") + (seconds > 0 ? duration.separator + seconds + duration.second : "");
    if (totalMinutes > 0)
        return totalMinutes + duration.minute + (seconds > 0 ? duration.separator + seconds + duration.second : "");
    return seconds + duration.second;
}
function keyDurationHtml(value, locale, className = "") {
    if (value.value === null)
        return keyMetricHtml(value, locale, className, false);
    const display = durationText(value, locale);
    const sort = typeof value.value === "number" ? " data-sort=\"" + String(value.value) + "\"" : "";
    return "<span class=\"key-value" + (className ? " " + className : "") + "\" data-provenance=\"" + escapeHtml(value.provenance) + "\"" + sort + " aria-label=\"" + escapeHtml(display) + "\">" + escapeHtml(display) + "</span>";
}
function resultSizeText(turn, locale) {
    const chars = numericValue(turn.toolResultChars);
    if (chars !== null)
        return formatCompact(chars, locale) + labelsFor(locale).resultSizeCharactersSuffix;
    const bytes = numericValue(turn.toolResultBytes);
    return bytes === null ? "—" : formatCompact(bytes, locale) + " B";
}
function processEvents(turn, locale) {
    const labels = labelsFor(locale);
    const events = turn.lifecycleMarkers.map((marker) => labels.eventLabels[marker]).filter((marker) => Boolean(marker));
    if (typeof turn.errorCount.value === "number" && turn.errorCount.value > 0)
        events.push(labels.errors);
    for (const skill of turn.skillMarkers ?? [])
        events.push(labels.skillPrefix + skill);
    return [...new Set(events)];
}
function roundLabel(turn, locale) {
    const ordinal = numericValue(turn.ordinal);
    if (ordinal === null)
        return shortenedId(turn.turnId);
    return labelsFor(locale).keySession.roundLabel(formatExact(ordinal, locale));
}
function hotTurnIds(turns) {
    const byTokens = [...turns].filter((turn) => numericValue(turn.tokens.totalTokens) !== null)
        .sort((left, right) => numericValue(right.tokens.totalTokens) - numericValue(left.tokens.totalTokens))
        .slice(0, 5).map((turn) => turn.turnId);
    const byDuration = [...turns].filter((turn) => numericValue(turn.durationMs) !== null)
        .sort((left, right) => numericValue(right.durationMs) - numericValue(left.durationMs))
        .slice(0, 3).map((turn) => turn.turnId);
    return new Set([...byTokens, ...byDuration]);
}
function fixedPercent(value, locale) {
    return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + "%";
}
function concentrationText(turns, sessionTotal, locale) {
    const denominator = numericValue(sessionTotal);
    const valued = turns.filter((turn) => numericValue(turn.tokens.totalTokens) !== null)
        .sort((left, right) => numericValue(right.tokens.totalTokens) - numericValue(left.tokens.totalTokens));
    const messages = labelsFor(locale).keySession;
    if (denominator === null || denominator <= 0 || valued.length === 0)
        return messages.concentrationUnavailable;
    const count = Math.min(5, valued.length);
    const numerator = valued.slice(0, count).reduce((sum, turn) => sum + numericValue(turn.tokens.totalTokens), 0);
    const percent = Math.round((numerator / denominator) * 10000) / 100;
    return messages.concentration(count, fixedPercent(percent, locale));
}
function keySessionUnavailableReason(reason, locale) {
    return labelsFor(locale).keySession.unavailableReason(reason);
}
function renderTurnTrajectory(result, sessionId, locale) {
    const labels = labelsFor(locale);
    const turns = sessionTurns(result, sessionId);
    if (turns.length === 0)
        return emptyState(labels, labels.noTrajectory);
    const hot = hotTurnIds(turns);
    const rows = turns.map((turn) => {
        const events = processEvents(turn, locale);
        const className = hot.has(turn.turnId) ? " class=\"hot-row\"" : "";
        const composition = [
            labels.input + " " + labels.tokens + labels.exactSeparator + keyValueText(turn.tokens.inputTokens, locale),
            labels.cachedInput + " " + labels.tokens + labels.exactSeparator + keyValueText(turn.tokens.cachedInputTokens, locale),
            labels.output + " " + labels.tokens + labels.exactSeparator + keyValueText(turn.tokens.outputTokens, locale),
        ].join(proseSeparator(locale));
        const toolResult = labels.toolCalls + labels.exactSeparator + keyValueText(turn.toolCallCount, locale, false) +
            proseSeparator(locale) + labels.resultSize + labels.exactSeparator + resultSizeText(turn, locale);
        return "<tr" + className + "><th scope=\"row\" class=\"turn-number\"><span>" + escapeHtml(roundLabel(turn, locale)) + "</span></th><td>" + keyMetricHtml(turn.tokens.totalTokens, locale, "turn-token") + "</td><td>" + keyPercentageHtml(turn.sessionSharePercent, locale, "turn-share") + "</td><td class=\"composition\">" + escapeHtml(composition) + "</td><td>" + keyDurationHtml(turn.durationMs, locale, "turn-duration") + "</td><td class=\"tool-result\"><span data-sort=\"" + (numericValue(turn.toolCallCount) ?? "") + "\">" + escapeHtml(toolResult) + "</span></td><td class=\"event\">" + escapeHtml(events.join(" · ") || "—") + "</td></tr>";
    }).join("");
    return "<table class=\"kami-table compact sortable turn-detail-table\"><caption class=\"sr-only\">" + escapeHtml(labels.turnTrajectory) + "</caption><thead><tr><th scope=\"col\">" + escapeHtml(labels.turn) + "</th><th scope=\"col\">" + escapeHtml(labels.tokens) + "</th><th scope=\"col\">" + escapeHtml(labels.share) + "</th><th scope=\"col\">" + escapeHtml(labels.input) + "、" + escapeHtml(labels.cachedInput) + "、" + escapeHtml(labels.output) + "</th><th scope=\"col\">" + escapeHtml(labels.roundDuration) + "</th><th scope=\"col\">" + escapeHtml(labels.toolCalls) + "、" + escapeHtml(labels.resultSize) + "</th><th scope=\"col\">" + escapeHtml(labels.processEvents) + "</th></tr></thead><tbody>" + rows + "</tbody></table>";
}
function firstSentence(text) {
    const trimmed = text.trim();
    if (!trimmed)
        return "";
    const match = trimmed.match(/^.*?[。！？]|^.*?[.!?](?=\s|$)/);
    return match ? match[0].trim() : trimmed;
}
function renderKeySessionAnalysis(result, locale, composition, localFirstUserMessages) {
    const labels = labelsFor(locale);
    const topSessions = result.rankings.sessions.slice(0, 3);
    if (topSessions.length === 0)
        return "";
    const promptRecords = localFirstUserMessages ?? composition?.firstUserMessages ?? [];
    const promptByTurn = new Map(promptRecords.map((record) => [record.sessionId + "\0" + record.turnId, record]));
    const keySessionMessages = labels.keySession;
    const validated = composition
        ? (0, key_session_analysis_1.composeKeySessionAnalyses)(result, composition.keySessionAnalyses)
        : { analyses: [], unavailable: [keySessionMessages.noComposition] };
    const bySession = new Map(validated.analyses.map((analysis) => [analysis.sessionId, analysis]));
    const blocks = topSessions.map((row, index) => {
        const turns = sessionTurns(result, row.key);
        const analysis = bySession.get(row.key);
        const unavailableReason = validated.unavailable.find((reason) => reason.startsWith(row.key + ":"))
            ?? validated.unavailable.find((reason) => !topSessions.some((session) => reason.startsWith(session.key + ":")));
        const title = sessionTitle(row, locale);
        const titleId = "key-session-title-" + index;
        const chartId = "key-session-chart-" + index;
        const totalDuration = sessionActiveTime(result, row.key);
        const concentration = concentrationText(turns, row.value, locale);
        const topDuration = [...turns].filter((turn) => numericValue(turn.durationMs) !== null).sort((left, right) => numericValue(right.durationMs) - numericValue(left.durationMs))[0];
        const fact = topDuration
            ? keySessionMessages.factWithDuration(concentration, roundLabel(topDuration, locale), durationText(topDuration.durationMs, locale))
            : keySessionMessages.factWithoutDuration(concentration);
        const primaryFinding = analysis?.primaryFinding;
        const supportLabel = primaryFinding
            ? keySessionMessages.support[primaryFinding.support]
            : "";
        const finding = !analysis
            ? "<article class=\"finding\"><div class=\"analysis-label\"><span>" + escapeHtml(labels.interpretation) + "</span></div><p class=\"analysis-unavailable\">" + escapeHtml(labels.analysisUnavailable + keySessionUnavailableReason(unavailableReason, locale)) + "</p><p class=\"quiet\">" + escapeHtml(keySessionMessages.deterministicTrajectoryAvailable) + "</p></article>"
            : "<article class=\"finding\"><div class=\"analysis-label\"><span>" + escapeHtml(labels.interpretation) + "</span>" + (primaryFinding ? "<span class=\"evidence-strength\">" + escapeHtml(keySessionMessages.evidenceStrength(supportLabel)) + "</span>" : "") + "</div>" + (primaryFinding
                ? "<p class=\"finding-lead\">" + escapeHtml(primaryFinding.observation) + "</p><p class=\"fact-line\"><strong>" + escapeHtml(fact) + "</strong></p><p class=\"quiet\">" + escapeHtml([primaryFinding.interpretation, ...primaryFinding.alternativeExplanations].filter(Boolean).join(keySessionMessages.alternativeSeparator)) + "</p>"
                : "<p class=\"finding-lead\">" + escapeHtml(labels.noStrongEvidence) + "</p><p class=\"fact-line\"><strong>" + escapeHtml(fact) + "</strong></p>") + "</article>";
        const action = analysis?.recommendation
            ? "<article class=\"action\"><div class=\"analysis-label\"><span>" + escapeHtml(labels.improvementAction) + "</span></div><h4>" + escapeHtml(analysis.recommendation.action) + "</h4><p class=\"action-copy\">" + escapeHtml(analysis.recommendation.rationale) + "</p><p class=\"applicability\">" + escapeHtml([analysis.recommendation.applicability, analysis.recommendation.tradeoff].filter(Boolean).join(locale === "zh-CN" ? " " : " · ")) + "</p><p class=\"verify\"><span class=\"analysis-label\">" + escapeHtml(labels.verificationMethod) + "</span>" + escapeHtml(analysis.recommendation.verification) + "</p></article>"
            : "";
        const taskContext = analysis?.taskContext ?? keySessionMessages.fallbackTaskContext;
        const metrics = "<div class=\"key-session-metrics\" aria-label=\"" + escapeHtml(keySessionMessages.sessionSummaryAria) + "\"><div class=\"key-session-metric\"><span class=\"key-session-metric-value\">" + escapeHtml(durationText(totalDuration, locale)) + "</span><span class=\"key-session-metric-label\">" + escapeHtml(labels.totalDuration) + "</span></div><div class=\"key-session-metric\"><span class=\"key-session-metric-value\" data-sort=\"" + String(turns.length) + "\">" + escapeHtml(String(turns.length)) + "</span><span class=\"key-session-metric-label\">" + escapeHtml(labels.roundCount) + "</span></div><div class=\"key-session-metric\"><span class=\"key-session-metric-value\">" + escapeHtml(concentration) + "</span><span class=\"key-session-metric-label\">" + escapeHtml(keySessionMessages.tokenShareLabel) + "</span></div></div>";
        const sessionTotal = keyValueText(row.value, locale);
        const trajectoryNote = labels.trajectoryIntro;
        const promptCount = turns.filter((turn) => promptByTurn.get(row.key + "\0" + turn.turnId)?.content !== null && promptByTurn.has(row.key + "\0" + turn.turnId)).length;
        const promptNote = promptCount > 0 ? keySessionMessages.promptAvailable(promptCount) : keySessionMessages.promptMissing;
        const decisionState = !analysis
            ? "unavailable"
            : analysis.recommendation
                ? "testable"
                : "not_recommended";
        const decisionBadgeText = keySessionMessages.decisionState[decisionState === "not_recommended" ? "notRecommended" : decisionState];
        let collapsedFinding = "";
        if (!analysis) {
            collapsedFinding = labels.analysisUnavailable + keySessionUnavailableReason(unavailableReason, locale);
        }
        else if (primaryFinding) {
            collapsedFinding = firstSentence(primaryFinding.observation);
        }
        else {
            const limitation = analysis.limitations.find((value) => value.trim() && !/Host Agent|Content Evidence|schema|validation|Evidence selection|Session-specific/i.test(value));
            collapsedFinding = limitation ? firstSentence(limitation) : labels.noStrongEvidence;
        }
        const detailSummary = keySessionMessages.roundsSummary(turns.length);
        const trajectory = "<section class=\"key-session-section key-session-trajectory\" aria-labelledby=\"" + chartId + "-title\"><div class=\"key-session-section-head\"><h4 id=\"" + chartId + "-title\">" + escapeHtml(labels.turnTrajectory) + "</h4><p>" + escapeHtml(trajectoryNote) + "</p></div><figure class=\"key-session-chart-frame ivory-group chart-ivory\" aria-labelledby=\"" + chartId + "-caption\"><div class=\"key-session-chart-toolbar\"><div><strong>" + escapeHtml(keySessionMessages.chartRounds(turns.length)) + "</strong><small>" + escapeHtml(labels.chartHint) + "</small></div><div class=\"key-session-legend\" aria-label=\"" + escapeHtml(keySessionMessages.legendAria) + "\"><span class=\"hot\">" + escapeHtml(keySessionMessages.hotspots) + "</span><span>" + escapeHtml(keySessionMessages.otherRounds) + "</span><span class=\"time\">" + escapeHtml(labels.roundDuration) + "</span></div></div><div id=\"" + chartId + "\" class=\"echart key-session-chart\" role=\"img\" aria-label=\"" + escapeHtml(keySessionMessages.chartAria(turns.length)) + "\"></div><figcaption id=\"" + chartId + "-caption\" class=\"key-session-chart-note\"><strong>" + escapeHtml(keySessionMessages.focus) + "</strong>" + escapeHtml(fact) + "</figcaption><p class=\"key-session-prompt-note\">" + escapeHtml(promptNote) + "</p><noscript><p class=\"key-session-chart-note\">" + escapeHtml(keySessionMessages.noScript) + "</p></noscript></figure><details class=\"key-session-appendix\"><summary><span>" + escapeHtml(detailSummary) + "</span><small>" + escapeHtml(labels.detailNote) + "</small></summary><div class=\"table-scroll\">" + renderTurnTrajectory(result, row.key, locale) + "</div></details></section>";
        return "<details class=\"key-session-entry" + (index === 0 ? " key-session-entry--primary\" open" : "\"") + "><summary aria-controls=\"" + titleId + "\"><span class=\"key-session-summary\"><span class=\"session-summary-header\"><span class=\"session-summary-main\"><span class=\"session-decision-badge session-decision-badge--" + decisionState + "\">" + escapeHtml(decisionBadgeText) + "</span><span class=\"session-summary-title\">" + escapeHtml(title) + "</span><span class=\"session-summary-id\">" + escapeHtml(shortenedId(row.key)) + " · " + escapeHtml(String(turns.length)) + " " + escapeHtml(keySessionMessages.roundUnit) + "</span></span><small>" + escapeHtml(index === 0 ? keySessionMessages.openByDefault : keySessionMessages.collapsed) + "</small></span><span class=\"session-summary-lead\">" + escapeHtml(collapsedFinding) + "</span></span></summary><div id=\"" + titleId + "\" class=\"key-session-content\"><header class=\"key-session-head\"><div class=\"key-session-heading\"><div><span class=\"session-rank\">" + escapeHtml(keySessionMessages.rank(index + 1, topSessions.length)) + "</span><h3 class=\"session-title\">" + escapeHtml(title) + "</h3><p class=\"task-title\">" + escapeHtml(taskContext) + "</p><p class=\"session-id\">" + escapeHtml(row.key) + " · " + escapeHtml(result.scope.harness) + "</p></div><div class=\"session-total\"><strong>" + escapeHtml(sessionTotal) + "</strong><span>" + escapeHtml(labels.sessionToken) + "</span></div></div>" + metrics + "</header><section class=\"key-session-section key-session-judgment\" aria-labelledby=\"" + titleId + "-judgment\"><div class=\"key-session-section-head\"><h4 id=\"" + titleId + "-judgment\">" + escapeHtml(labels.primaryFinding) + "</h4><p>" + escapeHtml(keySessionMessages.judgmentNote) + "</p></div><div class=\"judgment\">" + finding + action + "</div></section>" + trajectory + "</div></details>";
    }).join("");
    return "<section class=\"key-session-analysis-section\"><header class=\"key-session-module-head\"><span class=\"key-session-module-kicker\">" + escapeHtml(keySessionMessages.moduleKicker(result.scope.harness)) + "</span><h2>" + escapeHtml(labels.keySessionAnalysis) + "</h2><p class=\"key-session-module-deck\">" + escapeHtml(labels.moduleDeck) + "</p><p class=\"key-session-privacy\" role=\"note\">" + escapeHtml(keySessionMessages.privacyNote) + "</p></header><div class=\"key-session-list\" aria-label=\"" + escapeHtml(keySessionMessages.listAria) + "\">" + blocks + "</div></section>";
}
function renderExplainableSessions(result, locale) {
    const labels = labelsFor(locale);
    const rows = result.rankings.sessions.slice(0, 10);
    if (rows.length === 0)
        return emptyState(labels);
    return "<table class=\"kami-table sortable explainable-sessions\"><thead><tr><th>" + escapeHtml(labels.session) + "</th><th>" + escapeHtml(labels.tokens) + "</th><th>" + escapeHtml(labels.share) + "</th><th>" + escapeHtml(labels.turn) + "</th><th>" + escapeHtml(labels.totalDuration) + "</th><th>" + escapeHtml(labels.evidenceCompleteness) + "</th></tr></thead><tbody>" + rows.map((row) => {
        const turnCount = reportDerivedEvidence(sessionTurns(result, row.key).length, "count of Turn records in the Session");
        return "<tr><th scope=\"row\">" + escapeHtml(sessionLabel(row, locale)) + "</th><td>" + tokenCell(row.value, locale) + "</td><td>" + percentageHtml(row.sharePercent, locale) + "</td><td>" + tokenCell(turnCount, locale) + "</td><td>" + tokenCell(sessionActiveTime(result, row.key), locale) + "</td><td>" + percentageHtml(sessionCompleteness(result, row.key), locale) + "</td></tr>";
    }).join("") + "</tbody></table>";
}
function renderDaily(result, locale) {
    const labels = labelsFor(locale);
    const rows = result.report.dailyUsage;
    if (rows.length === 0)
        return emptyState(labels);
    return "<table class=\"kami-table compact sortable\"><thead><tr><th>" + escapeHtml(labels.date) + "</th><th>" + escapeHtml(labels.totalTokens) + "</th><th>" + escapeHtml(labels.share) + "</th><th>" +
        escapeHtml(labels.input) + "</th><th>" + escapeHtml(labels.cachedInput) + "</th><th>" + escapeHtml(labels.cacheWrite) + "</th><th>" + escapeHtml(labels.output) + "</th><th>" + escapeHtml(labels.charts.unclassified) + "</th></tr></thead><tbody>" +
        rows.map((row) => "<tr><th scope=\"row\">" + escapeHtml(formatDateKey(row.key, locale)) + "</th><td>" + tokenCell(row.totalTokens, locale) + "</td><td>" +
            percentageHtml(row.sharePercent, locale) + "</td><td>" + tokenCell(row.inputTokens, locale) + "</td><td>" + tokenCell(row.cachedInputTokens, locale) +
            "</td><td>" + tokenCell(row.cacheWriteTokens, locale) + "</td><td>" + tokenCell(row.outputTokens, locale) + "</td><td>" + tokenCell(row.unclassifiedTokens, locale) + "</td></tr>").join("") +
        "</tbody></table>";
}
function renderModels(result, locale) {
    const labels = labelsFor(locale);
    const rows = result.rankings.models;
    if (rows.length === 0)
        return emptyState(labels);
    return "<table class=\"kami-table sortable\"><thead><tr><th>" + escapeHtml(labels.model) + "</th><th>" + escapeHtml(labels.tokens) + "</th><th>" + escapeHtml(labels.share) + "</th><th>" + escapeHtml(labels.calls) + "</th></tr></thead><tbody>" +
        rows.map((row) => "<tr><th scope=\"row\">" + escapeHtml(modelLabel(row.key, locale)) + "</th><td>" + tokenCell(row.value, locale) +
            "</td><td>" + percentageHtml(row.sharePercent, locale) + "</td><td>" + tokenCell(row.count, locale) + "</td></tr>").join("") +
        "</tbody></table>";
}
function renderSessions(result, locale) {
    if ((result.turns ?? []).length > 0)
        return renderExplainableSessions(result, locale);
    const labels = labelsFor(locale);
    const rows = result.rankings.sessions.slice(0, 10);
    if (rows.length === 0)
        return emptyState(labels);
    return "<table class=\"kami-table sortable\"><thead><tr><th>" + escapeHtml(labels.session) + "</th><th>" + escapeHtml(labels.tokens) + "</th><th>" + escapeHtml(labels.share) + "</th><th>" + escapeHtml(labels.calls) + "</th></tr></thead><tbody>" +
        rows.map((row) => "<tr><th scope=\"row\">" + escapeHtml(sessionLabel(row, locale)) + "</th><td>" + tokenCell(row.value, locale) +
            "</td><td>" + percentageHtml(row.sharePercent, locale) + "</td><td>" + tokenCell(row.count, locale) + "</td></tr>").join("") +
        "</tbody></table>";
}
function renderTools(result, locale) {
    const labels = labelsFor(locale);
    const rows = result.report.tools;
    if (rows.length === 0)
        return emptyState(labels, labels.noToolData);
    const showErrors = rows.some((row) => row.errors.value !== null);
    return "<p class=\"coverage-note\">" + escapeHtml(labels.toolImpactNote) + "</p><table class=\"kami-table compact sortable\"><thead><tr><th>" + escapeHtml(labels.tool) + "</th><th>" + escapeHtml(labels.calls) + "</th><th>" + escapeHtml(labels.pairedResults) + "</th>" +
        (showErrors ? "<th>" + escapeHtml(labels.errors) + "</th>" : "") + "<th>" +
        escapeHtml(labels.injected) + "</th><th>" + escapeHtml(labels.amplified) + "</th><th>" + escapeHtml(labels.share) + "</th></tr></thead><tbody>" +
        rows.map((row) => "<tr><th scope=\"row\">" + escapeHtml(publicLabel(row.key, labels.unavailable)) + "</th><td>" + tokenCell(row.calls, locale) +
            "</td><td>" + tokenCell(row.pairedResults, locale) + "</td>" + (showErrors ? "<td>" + tokenCell(row.errors, locale) + "</td>" : "") + "<td>" + tokenCell(row.injectedTokens, locale) +
            "</td><td>" + tokenCell(row.amplifiedTokens, locale) + "</td><td>" + percentageHtml(row.sharePercent, locale) + "</td></tr>").join("") +
        "</tbody></table>";
}
function methodText(value, locale) {
    return labelsFor(locale).method(value.method);
}
function methodPairText(first, second, locale) {
    const terminal = locale === "zh-CN" ? /[。！？]+$/u : /[.!?]+$/u;
    const parts = [first, second].map((part) => part.trim().replace(terminal, "")).filter(Boolean);
    return parts.length === 0 ? "" : parts.join(proseSeparator(locale)) + (locale === "zh-CN" ? "。" : ".");
}
function limitationListText(values, locale) {
    const terminal = locale === "zh-CN" ? /[。！？]+$/u : /[.!?]+$/u;
    const parts = values.map((value) => labelsFor(locale).limitation(value).trim().replace(terminal, "")).filter(Boolean);
    return parts.length === 0 ? "" : parts.join(proseSeparator(locale)) + (locale === "zh-CN" ? "。" : ".");
}
function skillStateLabel(state, locale) {
    return labelsFor(locale).skillStates[state] ?? state;
}
function skillLabel(name, locale) {
    if (name === "<unknown-skill>")
        return labelsFor(locale).unknownSkill;
    return publicLabel(name, labelsFor(locale).unavailable);
}
function skillEvidenceNote(locale) {
    return labelsFor(locale).skillEvidenceNote;
}
function renderCacheText(result, locale) {
    const labels = labelsFor(locale);
    const cache = result.report.cacheEconomics;
    const lines = [
        labels.cacheEconomics,
        labels.cacheReadRate + ": " + percentagePlain(cache.cacheReadRatePercent, locale) + "; " + labels.cacheWriteRate + ": " + percentagePlain(cache.cacheWriteRatePercent, locale) + "; " + labels.cacheCoverage + ": " + percentagePlain(cache.coveragePercent, locale) + ".",
        labels.observedApiCost + ": " + currencyPlain(cache.observedApiEquivalentCost, locale, false) + "; " + labels.allUncachedApiCost + ": " + currencyPlain(cache.allUncachedApiEquivalentCost, locale, false) + "; " + labels.cacheSavings + ": " + currencyPlain(cache.cacheSavings, locale, false) + " (" + percentagePlain(cache.cacheSavingsPercent, locale) + "); " + labels.priceCoverage + ": " + percentagePlain(cache.pricedUsageCoveragePercent, locale) + ".",
        labels.methodPrefix + methodPairText(methodText(cache.cacheReadRatePercent, locale), methodText(cache.observedApiEquivalentCost, locale), locale),
    ];
    if (cache.limitations.length > 0)
        lines.push(labels.limitationPrefix + limitationListText(cache.limitations, locale));
    return lines;
}
function renderFirstRequestText(result, locale) {
    const labels = labelsFor(locale);
    const first = result.report.firstRequestBurden;
    const lines = [
        labels.firstRequestBurden,
        labels.firstRequestMedian + ": " + evidencePlain(first.medianTokens, locale, false) + "; " + labels.firstRequestShare + ": " + percentagePlain(first.sharePercent, locale) + "; " + labels.firstRequestCoverage + ": " + percentagePlain(first.coveragePercent, locale) + ".",
        labels.cacheCompositionPrefix + evidencePlain(first.inputTokens, locale, false) + "; " + labels.cachedInput + " " + evidencePlain(first.cachedInputTokens, locale, false) + "; " + labels.cacheWrite + " " + evidencePlain(first.cacheWriteTokens, locale, false) + "; " + labels.output + " " + evidencePlain(first.outputTokens, locale, false) + ".",
        labels.firstRequestCompositionCoverage + ": " + percentagePlain(first.compositionCoveragePercent, locale) + "; " + labels.coldFirstRequestRate + ": " + percentagePlain(first.coldSessionRatePercent, locale) + ".",
        labels.methodPrefix + methodPairText(methodText(first.medianTokens, locale), labels.firstRequestMethodNote, locale),
    ];
    if (first.topLevel)
        lines.push(labels.topLevelPrefix + evidencePlain(first.topLevel.medianTokens, locale, false) + "; " + labels.firstRequestCoverage + " " + percentagePlain(first.topLevel.compositionCoveragePercent, locale) + ".");
    if (first.subagent)
        lines.push(labels.subagentPrefix + evidencePlain(first.subagent.medianTokens, locale, false) + "; " + labels.firstRequestCoverage + " " + percentagePlain(first.subagent.compositionCoveragePercent, locale) + ".");
    lines.push(labels.identityCoveragePrefix + percentagePlain(first.identityCoveragePercent, locale) + ".");
    if (first.limitations.length > 0)
        lines.push(labels.limitationPrefix + limitationListText(first.limitations, locale));
    return lines;
}
function renderSkillsText(result, locale) {
    const labels = labelsFor(locale);
    if (result.report.skills.length === 0)
        return [labels.skillEvidence, labels.noSkillEvidence];
    const lines = [labels.skillEvidence, skillEvidenceNote(locale)];
    for (const skill of result.report.skills) {
        lines.push(skillLabel(skill.name, locale) +
            ": " + labels.invocationCount + " " + evidencePlain(skill.invocationCount, locale, false) + "; " + labels.skillSessions + " " + evidencePlain(skill.sessionCount, locale, false) +
            "; " + labels.attributedTokens + " " + evidencePlain(skill.attributedTokens, locale, false) + "; " + labels.attributedCost + " " + currencyPlain(skill.attributedApiEquivalentCost, locale, false) + ".");
    }
    return lines;
}
function renderCacheHtml(result, locale) {
    const labels = labelsFor(locale);
    const cache = result.report.cacheEconomics;
    const efficiencyMetrics = [
        [labels.cacheReadRate, cache.cacheReadRatePercent, "percentage"],
        [labels.cacheWriteRate, cache.cacheWriteRatePercent, "percentage"],
        [labels.cacheCoverage, cache.coveragePercent, "percentage"],
        [labels.priceCoverage, cache.pricedUsageCoveragePercent, "percentage"],
    ];
    const impactMetrics = [
        [labels.observedApiCost, cache.observedApiEquivalentCost, "currency"],
        [labels.allUncachedApiCost, cache.allUncachedApiEquivalentCost, "currency"],
        [labels.cacheSavings, cache.cacheSavings, "currency"],
        [labels.cacheSavingsPercent, cache.cacheSavingsPercent, "percentage"],
    ];
    const limitations = renderCacheLimitations(cache, locale);
    const groups = "<div class=\"comparison-grid economic-groups\"><div class=\"ivory-group\"><h3>" + escapeHtml(labels.cacheEfficiencyTitle) + "</h3>" + renderMetrics(efficiencyMetrics, locale, "economic") + "</div><div class=\"ivory-group\"><h3>" + escapeHtml(labels.costImpactTitle) + "</h3>" + renderMetrics(impactMetrics, locale, "economic") + "</div></div>";
    return "<section class=\"cache-economics\"><h2>" + escapeHtml(labels.cacheEconomics) + "</h2>" + groups + "<p class=\"coverage-note\">" + escapeHtml(labels.cacheRatioMethodNotePrefix + methodPairText(methodText(cache.cacheReadRatePercent, locale), methodText(cache.observedApiEquivalentCost, locale), locale)) + "</p>" + limitations + "</section>";
}
function renderFirstGroupHtml(group, label, locale) {
    if (!group)
        return "";
    const labels = labelsFor(locale);
    return "<div class=\"ivory-group comparison-card\"><h3>" + escapeHtml(label) + "</h3>" + renderMetrics([
        [labels.firstRequestMedian, group.medianTokens, "metric", false],
        [labels.firstRequestCompositionCoverage, group.compositionCoveragePercent, "percentage"],
        [labels.coldFirstRequestRate, group.coldSessionRatePercent, "percentage"],
    ], locale, "group") + "</div>";
}
function renderFirstRequestHtml(result, locale) {
    const labels = labelsFor(locale);
    const first = result.report.firstRequestBurden;
    const metrics = [
        [labels.firstRequestMedian, first.medianTokens, "metric"],
        [labels.firstRequestShare, first.sharePercent, "percentage"],
        [labels.firstRequestCoverage, first.coveragePercent, "percentage"],
        [labels.firstRequestCompositionCoverage, first.compositionCoveragePercent, "percentage"],
        [labels.coldFirstRequestRate, first.coldSessionRatePercent, "percentage"],
        [labels.identityCoverage, first.identityCoveragePercent, "percentage"],
    ];
    const limitations = first.limitations.length > 0 ? "<ul class=\"editorial-list\">" + first.limitations.map((limitation) => "<li>" + escapeHtml(labels.limitation(limitation)) + "</li>").join("") + "</ul>" : "";
    const comparisonGroups = [renderFirstGroupHtml(first.topLevel, labels.topLevelSessions, locale), renderFirstGroupHtml(first.subagent, labels.subagentSessions, locale)].filter(Boolean).join("");
    const comparison = comparisonGroups ? "<div class=\"comparison-grid\">" + comparisonGroups + "</div>" : "";
    return "<section class=\"first-request\"><h2>" + escapeHtml(labels.firstRequestBurden) + "</h2>" + renderMetrics(metrics, locale, "first-request") + "<p class=\"coverage-note\">" + escapeHtml(labels.firstRequestNote) + "</p>" + comparison + limitations + "</section>";
}
function skillMetricLabel(metric, locale) {
    const labels = locale === "zh-CN"
        ? {
            top4CallShare: "前 4 个 Skill 调用占比",
            lowFrequencySkillCount: "低频 Skill 数",
            lowFrequencyCallCount: "低频调用数",
            lowFrequencySkillShare: "低频 Skill 占比",
            lowFrequencyCallShare: "低频调用占比",
            callShare: "调用占比",
            calls: "调用次数",
            tasks: "相关任务数",
            callsPerTask: "每个任务的调用次数",
            median: "全体中位数",
            p75: "全体 P75",
            p90: "全体 P90",
            max: "全体最大值",
            totalCalls: "家族调用数",
            totalTasks: "家族相关任务数",
            memberCount: "家族成员数",
            totalSkillCalls: "全体 Skill 调用数",
        }
        : {
            top4CallShare: "Top 4 call share",
            lowFrequencySkillCount: "low-frequency Skills",
            lowFrequencyCallCount: "low-frequency calls",
            lowFrequencySkillShare: "low-frequency Skill share",
            lowFrequencyCallShare: "low-frequency call share",
            callShare: "call share",
            calls: "calls",
            tasks: "related tasks",
            callsPerTask: "calls per task",
            median: "population median",
            p75: "population P75",
            p90: "population P90",
            max: "population maximum",
            totalCalls: "family calls",
            totalTasks: "family tasks",
            memberCount: "family members",
            totalSkillCalls: "all Skill calls",
        };
    return metric && metric in labels ? labels[metric] : locale === "zh-CN" ? "证据" : "Evidence";
}
function formatSkillMetricValue(metric, value, locale) {
    if (value === undefined || value === null)
        return "—";
    if (typeof value !== "number" || !Number.isFinite(value))
        return String(value);
    const percentageMetrics = new Set(["top4CallShare", "lowFrequencySkillShare", "lowFrequencyCallShare", "callShare"]);
    if (percentageMetrics.has(metric ?? "")) {
        return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(value);
    }
    const rounded = Math.abs(value) >= 10 ? Math.round(value * 10) / 10 : Math.round(value * 100) / 100;
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(rounded);
}
function revealEvidence(item) {
    return item.reveal.evidenceRefs
        .map((reference) => item.evidence.find((entry) => (0, skill_insights_1.skillInsightEvidenceMatchesReference)(entry, reference)))
        .filter((entry) => Boolean(entry));
}
function revealMetric(item, kind, metric, skillId) {
    return item.evidence.find((entry) => entry.kind === kind && entry.metric === metric && (!skillId || entry.skillId === skillId));
}
function renderSkillInsightReveal(item, locale) {
    const semantic = item.reveal.semantic;
    if (item.reveal.pattern === "share_inversion") {
        const skillShare = revealMetric(item, "global_metric", "lowFrequencySkillShare");
        const callShare = revealMetric(item, "global_metric", "lowFrequencyCallShare");
        if (skillShare && callShare) {
            return locale === "zh-CN"
                ? `${formatSkillMetricValue("lowFrequencySkillShare", skillShare.value, locale)} 的 Skill，只承担了 ${formatSkillMetricValue("lowFrequencyCallShare", callShare.value, locale)} 的调用`
                : `${formatSkillMetricValue("lowFrequencySkillShare", skillShare.value, locale)} of Skills account for only ${formatSkillMetricValue("lowFrequencyCallShare", callShare.value, locale)} of calls`;
        }
    }
    if (item.reveal.pattern === "distribution_outlier") {
        const baseline = revealMetric(item, "distribution_metric", "median") ?? revealMetric(item, "distribution_metric", "p90");
        const members = revealEvidence(item).filter((entry) => entry.kind === "skill_metric" && entry.metric === "callsPerTask");
        if (baseline && members.length >= 2) {
            const values = members.slice(0, 2).map((entry) => `${entry.skillId ?? "Skill"} ${formatSkillMetricValue(entry.metric, entry.value, locale)}`).join(locale === "zh-CN" ? "；" : "; ");
            return locale === "zh-CN"
                ? `普通 Skill 每个任务约 ${formatSkillMetricValue(baseline.metric, baseline.value, locale)} 次，这个 family 的两个主变体分别是 ${values}`
                : `A typical Skill appears about ${formatSkillMetricValue(baseline.metric, baseline.value, locale)} times per task; the two main variants are ${values}`;
        }
        const member = members[0];
        if (baseline && member) {
            return locale === "zh-CN"
                ? `普通 Skill 每个任务约 ${formatSkillMetricValue(baseline.metric, baseline.value, locale)} 次，这个 Skill 达到 ${formatSkillMetricValue(member.metric, member.value, locale)} 次`
                : `A typical Skill appears about ${formatSkillMetricValue(baseline.metric, baseline.value, locale)} times per task; this Skill reaches ${formatSkillMetricValue(member.metric, member.value, locale)}`;
        }
    }
    if (item.reveal.pattern === "family_concentration") {
        const familyShare = revealMetric(item, "family_metric", "callShare");
        if (familyShare) {
            return locale === "zh-CN"
                ? `${formatSkillMetricValue(familyShare.metric, familyShare.value, locale)} 的 Skill 调用，都带着同一个名字前缀`
                : `${formatSkillMetricValue(familyShare.metric, familyShare.value, locale)} of Skill calls share the same name prefix`;
        }
    }
    return semantic;
}
function renderSkillInsightProof(item, locale) {
    const evidenceItems = revealEvidence(item);
    const rendered = evidenceItems.map((ev) => {
        if (ev.kind.includes("metric")) {
            const separator = locale === "zh-CN" ? "：" : ": ";
            const valStr = separator + formatSkillMetricValue(ev.metric, ev.value, locale);
            return "<span class=\"kami-badge metric-badge\">" + escapeHtml(skillMetricLabel(ev.metric, locale) + valStr) + "</span>";
        }
        return "<blockquote class=\"skill-excerpt\">&ldquo;" + escapeHtml(ev.evidenceExcerpt || "") + "&rdquo;</blockquote>";
    }).join("");
    return rendered ? "<div class=\"insight-proof\"><strong>" + escapeHtml(locale === "zh-CN" ? "关键对照：" : "Proof: ") + "</strong>" + rendered + "</div>" : "";
}
function renderSkillInsightsHtml(composition, locale) {
    const insights = composition?.skillInsights;
    if (!insights || insights.length === 0 || !composition?.skillInsightsSnapshotId)
        return "";
    if (insights.some((item) => item.snapshotId !== composition.skillInsightsSnapshotId))
        return "";
    const cards = insights.map((item) => {
        const reveal = renderSkillInsightReveal(item, locale);
        const proof = renderSkillInsightProof(item, locale);
        const soWhat = item.decisionDelta
            ? "<p class=\"insight-so-what\"><strong>" + escapeHtml(locale === "zh-CN" ? "这意味着：" : "So what: ") + "</strong>" + escapeHtml(item.decisionDelta.after) + "</p>"
            : "";
        return ("<div class=\"quiet-card skill-insight-card\">" +
            "<div class=\"card-header\">" +
            "<div class=\"card-title-group\">" +
            "<h3 class=\"card-title\">" + escapeHtml(reveal) + "</h3>" +
            "</div>" +
            "</div>" +
            "<div class=\"card-body\">" +
            proof +
            soWhat +
            "</div>" +
            "</div>");
    }).join("");
    return ("<section class=\"skill-insights\">" +
        "<h2>" + escapeHtml(labelsFor(locale).skillInsightsTitle) + "</h2>" +
        "<p class=\"coverage-note\">" + escapeHtml(labelsFor(locale).skillInsightsNote) + "</p>" +
        "<div class=\"quiet-cards-grid skill-insights-grid\">" + cards + "</div>" +
        "</section>");
}
function renderSkillsHtml(result, locale) {
    const labels = labelsFor(locale);
    if (result.report.skills.length === 0)
        return "<section><h2>" + escapeHtml(labels.skillEvidence) + "</h2>" + emptyState(labels, labels.noSkillEvidence) + "</section>";
    const rows = result.report.skills.map((skill) => "<tr><th scope=\"row\">" + escapeHtml(skillLabel(skill.name, locale)) + "</th><td>" + evidenceHtml(skill.invocationCount, locale, false) + "</td><td>" + evidenceHtml(skill.sessionCount, locale, false) + "</td><td>" + evidenceHtml(skill.attributedTokens, locale) + "</td><td>" + evidenceHtml(skill.attributedApiEquivalentCost, locale, false, true) + "</td></tr>").join("");
    return "<section class=\"skill-evidence\"><h2>" + escapeHtml(labels.skillEvidence) + "</h2><p class=\"coverage-note\">" + escapeHtml(skillEvidenceNote(locale)) + "</p><table class=\"kami-table compact sortable skills-table\"><thead><tr><th scope=\"col\">" + escapeHtml(labels.skill) + "</th><th scope=\"col\">" + escapeHtml(labels.invocationCount) + "</th><th scope=\"col\">" + escapeHtml(labels.skillSessions) + "</th><th scope=\"col\">" + escapeHtml(labels.attributedTokens) + "</th><th scope=\"col\">" + escapeHtml(labels.attributedCost) + "</th></tr></thead><tbody>" + rows + "</tbody></table></section>";
}
function numericValue(value) {
    return typeof value.value === "number" && Number.isFinite(value.value) ? value.value : null;
}
function renderBarSvg(title, rows, locale, chartId) {
    const chartRows = rows.filter((row) => numericValue(row.value) !== null);
    const values = chartRows.map((row) => numericValue(row.value)).filter((value) => value !== null);
    if (chartRows.length === 0 || values.length === 0)
        return "";
    const width = 880;
    const rowHeight = 32;
    const height = Math.max(80, chartRows.slice(0, 20).length * rowHeight + 20);
    const max = Math.max(...values, 1);
    const titleId = "chart-title-" + chartId;
    const parts = [
        "<svg class=\"chart\" role=\"img\" aria-labelledby=\"" + titleId + "\" viewBox=\"0 0 " + width + " " + height + "\">",
        "<title id=\"" + titleId + "\">" + escapeHtml(title) + "</title>",
    ];
    chartRows.slice(0, 20).forEach((row, index) => {
        const value = numericValue(row.value);
        const y = index * rowHeight + 10;
        const barWidth = Math.max(1, Math.round((value / max) * 500));
        parts.push("<text x=\"185\" y=\"" + (y + 15) + "\" text-anchor=\"end\" class=\"chart-label\">" + escapeHtml(row.key) + "</text>");
        parts.push("<rect x=\"205\" y=\"" + y + "\" width=\"" + barWidth + "\" height=\"18\" rx=\"4\" class=\"chart-bar\"><title>" +
            escapeHtml(row.key + ": " + metricPlain(row.value, locale)) + "</title></rect>");
        parts.push("<text x=\"725\" y=\"" + (y + 15) + "\" text-anchor=\"start\" class=\"chart-value\">" + escapeHtml(metricPlain(row.value, locale)) + "</text>");
    });
    parts.push("</svg>");
    return parts.join("");
}
function renderDailyComposition(result, locale) {
    const labels = labelsFor(locale);
    const rows = result.report.dailyUsage.filter((row) => numericValue(row.totalTokens) !== null).slice(-31);
    if (rows.length === 0)
        return "";
    const max = Math.max(...rows.map((row) => numericValue(row.totalTokens) ?? 0), 1);
    const width = 880;
    const rowHeight = 34;
    const height = rows.length * rowHeight + 58;
    const barX = 165;
    const barMax = 520;
    const segments = [
        { label: labels.input, field: "inputTokens", className: "segment-input" },
        { label: labels.cachedInput, field: "cachedInputTokens", className: "segment-cached" },
        { label: labels.cacheWrite, field: "cacheWriteTokens", className: "segment-cache-write" },
        { label: labels.output, field: "outputTokens", className: "segment-output" },
        { label: labels.reasoning, field: "reasoningTokens", className: "segment-reasoning" },
    ];
    const titleId = "chart-title-daily";
    const parts = [
        "<svg class=\"chart daily-composition\" role=\"img\" aria-labelledby=\"" + titleId + "\" viewBox=\"0 0 " + width + " " + height + "\">",
        "<title id=\"" + titleId + "\">" + escapeHtml(labels.dailyUsage) + "</title>",
    ];
    rows.forEach((row, index) => {
        const y = index * rowHeight + 10;
        const total = numericValue(row.totalTokens) ?? 0;
        const totalWidth = Math.max(1, Math.round((total / max) * barMax));
        const dateLabel = formatDateKey(row.key, locale, false);
        parts.push("<text x=\"145\" y=\"" + (y + 15) + "\" text-anchor=\"end\" class=\"chart-label\">" + escapeHtml(dateLabel) + "</text>");
        parts.push("<rect x=\"" + barX + "\" y=\"" + y + "\" width=\"" + totalWidth + "\" height=\"18\" rx=\"4\" class=\"chart-track\"><title>" + escapeHtml(dateLabel + ": " + metricPlain(row.totalTokens, locale)) + "</title></rect>");
        let segmentX = barX;
        for (const segment of segments) {
            const evidence = row[segment.field];
            const value = numericValue(evidence);
            if (value === null || value <= 0)
                continue;
            const segmentWidth = Math.max(1, Math.round((value / max) * barMax));
            parts.push("<rect x=\"" + segmentX + "\" y=\"" + y + "\" width=\"" + segmentWidth + "\" height=\"18\" class=\"" + segment.className + "\"><title>" +
                escapeHtml(dateLabel + " · " + segment.label + ": " + metricPlain(evidence, locale)) + "</title></rect>");
            segmentX += segmentWidth;
        }
        parts.push("<text x=\"705\" y=\"" + (y + 15) + "\" text-anchor=\"start\" class=\"chart-value\">" + escapeHtml(metricPlain(row.totalTokens, locale)) + "</text>");
    });
    parts.push("<g class=\"chart-legend\">");
    segments.forEach((segment, index) => {
        const x = 165 + index * 130;
        const y = height - 24;
        parts.push("<rect x=\"" + x + "\" y=\"" + (y - 10) + "\" width=\"12\" height=\"12\" rx=\"2\" class=\"" + segment.className + "\"></rect>");
        parts.push("<text x=\"" + (x + 18) + "\" y=\"" + y + "\" class=\"chart-label\">" + escapeHtml(segment.label) + "</text>");
    });
    parts.push("</g></svg>");
    return parts.join("");
}
function localHour(value, locale) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return null;
    const parts = new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        hour12: false,
    }).formatToParts(date);
    const part = (type) => parts.find((item) => item.type === type)?.value ?? "";
    const hour = Number(part("hour")) % 24;
    const dateKey = part("year") + "-" + part("month") + "-" + part("day");
    return {
        dateKey,
        dateLabel: formatDateKey(dateKey, locale, false),
        hour,
        timeLabel: formatDateTime(value, locale),
    };
}
function hourlyChartData(result, locale) {
    const entries = result.report.hourlyActivity.flatMap((row) => {
        const local = localHour(row.key, locale);
        return local ? [{ row, local }] : [];
    });
    const dates = [...new Map(entries.map((entry) => [entry.local.dateKey, entry.local.dateLabel])).entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, label]) => ({ key, label }));
    const values = new Map(entries.map((entry) => [entry.local.dateKey + ":" + entry.local.hour, entry]));
    const cells = dates.flatMap(({ key: dateKey, label: dateLabel }, dateIndex) => Array.from({ length: 24 }, (_, hour) => {
        const entry = values.get(dateKey + ":" + hour);
        const tokens = entry ? numericValue(entry.row.totalTokens) : null;
        const calls = entry ? numericValue(entry.row.modelCallCount) : null;
        const share = entry ? numericValue(entry.row.sharePercent) : null;
        const average = tokens !== null && calls !== null && calls > 0 ? tokens / calls : null;
        const endHour = hour === 23 ? "24" : String(hour + 1).padStart(2, "0");
        return {
            dateKey,
            dateLabel,
            dateIndex,
            hour,
            label: dateLabel + " " + String(hour).padStart(2, "0") + ":00–" + endHour + ":00",
            hasRecord: Boolean(entry),
            tokens,
            calls,
            share,
            average,
        };
    }));
    return {
        dates,
        cells,
        max: Math.max(...cells.map((cell) => cell.tokens ?? 0), 1),
    };
}
function renderHourly(result, locale) {
    const labels = labelsFor(locale);
    const rows = result.report.hourlyActivity;
    if (!result.report.hourlySupported || rows.length === 0)
        return emptyState(labels, labels.noTimestampData);
    const data = hourlyChartData(result, locale);
    if (data.dates.length === 0)
        return emptyState(labels, labels.noTimestampData);
    const chartHeight = Math.min(760, Math.max(300, data.dates.length * 30 + 64));
    return "<div class=\"ivory-group chart-ivory\"><div id=\"hourly-heatmap\" class=\"echart hourly-heatmap\" role=\"img\" aria-label=\"" + escapeHtml(labels.charts.hourlyDescription) + "\" aria-describedby=\"hourly-heatmap-description\" style=\"height:" + chartHeight + "px\"></div><p id=\"hourly-heatmap-description\" class=\"chart-summary\">" + escapeHtml(labels.charts.hourlySummary) + "</p></div>" +
        "<details><summary>" + escapeHtml(labels.charts.hourlyDetails) + "</summary><table class=\"kami-table sortable\"><thead><tr><th>" +
        escapeHtml(labels.charts.localTime) + "</th><th>" + escapeHtml(labels.tokens) + "</th><th>" + escapeHtml(labels.calls) + "</th><th>" + escapeHtml(labels.share) + "</th></tr></thead><tbody>" +
        rows.map((row) => "<tr><th scope=\"row\">" + escapeHtml(localHour(row.key, locale)?.timeLabel ?? row.key) + "</th><td>" + tokenCell(row.totalTokens, locale) + "</td><td>" +
            tokenCell(row.modelCallCount, locale) + "</td><td>" + percentageHtml(row.sharePercent, locale) + "</td></tr>").join("") + "</tbody></table></details>";
}
function renderRolling(result, locale) {
    const labels = labelsFor(locale);
    const rolling = result.report.rollingWindow;
    if (!rolling)
        return emptyState(labels, labels.noTimestampData);
    const quotaMetrics = [];
    if (rolling.providerQuota.value !== null)
        quotaMetrics.push([labels.providerQuota, rolling.providerQuota, "metric"]);
    if (rolling.resetAt.value !== null)
        quotaMetrics.push([labels.resetTime, rolling.resetAt, "metric"]);
    return "<div class=\"ivory-group rolling-activity\"><span class=\"tag tag--quiet\">" + escapeHtml(labels.charts.localObservation) + "</span><p class=\"coverage-note\">" + escapeHtml(labels.localOnly) + "</p><div class=\"window-note\"><span>" + escapeHtml(formatDateTime(rolling.startAt, locale) + " → " + formatDateTime(rolling.endAt, locale)) + "</span></div>" +
        renderMetrics([
            [labels.calls, rolling.observedModelCallCount, "metric"],
            [labels.latestWindowTokens, rolling.observedTokens, "metric"],
            [labels.historicalPeakTokens, rolling.historicalPeakObservedTokens, "metric"],
            ...quotaMetrics,
        ], locale, "window") +
        "</div>";
}
function renderWeekChanges(rows, heading, locale) {
    const labels = labelsFor(locale);
    if (rows.length === 0)
        return "<h3>" + escapeHtml(heading) + "</h3>" + emptyState(labels);
    return "<h3>" + escapeHtml(heading) + "</h3><table class=\"kami-table sortable\"><thead><tr><th>" + escapeHtml(labels.key) + "</th><th>" + escapeHtml(labels.currentWeek) + "</th><th>" +
        escapeHtml(labels.previousWeek) + "</th><th>" + escapeHtml(labels.change) + "</th></tr></thead><tbody>" +
        rows.slice(0, 20).map((row) => "<tr><th scope=\"row\">" + escapeHtml(publicLabel(row.key, labels.unavailable)) + "</th><td>" + tokenCell(row.current, locale) +
            "</td><td>" + tokenCell(row.previous, locale) + "</td><td>" + tokenCell(row.change, locale) + "</td></tr>").join("") + "</tbody></table>";
}
function renderWeek(result, locale) {
    if (!result.weekComparison)
        return emptyState(labelsFor(locale), labelsFor(locale).noComparison);
    const comparison = result.weekComparison;
    const labels = labelsFor(locale);
    return "<div class=\"week-ranges\"><div><strong>" + escapeHtml(labels.currentWeek) + "</strong><span>" + escapeHtml(formatDateTime(comparison.currentFrom, locale) + " → " + formatDateTime(comparison.currentTo, locale)) +
        "</span></div><div><strong>" + escapeHtml(labels.previousWeek) + "</strong><span>" + escapeHtml(formatDateTime(comparison.previousFrom, locale) + " → " + formatDateTime(comparison.previousTo, locale)) + "</span></div></div>" +
        "<table class=\"kami-table sortable\"><thead><tr><th></th><th>" + escapeHtml(labels.currentWeek) + "</th><th>" + escapeHtml(labels.previousWeek) + "</th><th>" + escapeHtml(labels.change) + "</th></tr></thead><tbody>" +
        "<tr><th scope=\"row\">" + escapeHtml(labels.totalTokens) + "</th><td>" + tokenCell(comparison.current.summary.totalTokens, locale) + "</td><td>" +
        tokenCell(comparison.previous.summary.totalTokens, locale) + "</td><td>" + tokenCell(comparison.changes.totalTokens, locale) + "</td></tr>" +
        "<tr><th scope=\"row\">" + escapeHtml(labels.modelCalls) + "</th><td>" + tokenCell(comparison.current.summary.modelCallCount, locale) + "</td><td>" +
        tokenCell(comparison.previous.summary.modelCallCount, locale) + "</td><td>" + tokenCell(comparison.changes.modelCallCount, locale) + "</td></tr>" +
        "<tr><th scope=\"row\">" + escapeHtml(labels.amplified) + "</th><td>" + tokenCell(comparison.current.report.totalToolAmplifiedTokens, locale) + "</td><td>" +
        tokenCell(comparison.previous.report.totalToolAmplifiedTokens, locale) + "</td><td>" + tokenCell(comparison.changes.toolAmplifiedTokens, locale) + "</td></tr>" +
        "</tbody></table>" +
        renderWeekChanges(comparison.modelChanges, labels.models, locale) +
        renderWeekChanges(comparison.toolChanges, labels.tools, locale);
}
let cachedChartRuntime = null;
function chartRuntime() {
    if (cachedChartRuntime !== null)
        return cachedChartRuntime;
    try {
        cachedChartRuntime = (0, node_fs_1.readFileSync)((0, node_path_1.join)(__dirname, "assets", "echarts.min.js"), "utf8");
    }
    catch {
        try {
            cachedChartRuntime = (0, node_fs_1.readFileSync)((0, node_path_1.join)(__dirname, "..", "assets", "echarts.min.js"), "utf8");
        }
        catch {
            cachedChartRuntime = "";
        }
    }
    return cachedChartRuntime;
}
const fontDataCache = new Map();
function fontAsset(filePath) {
    const location = (0, node_path_1.resolve)(filePath);
    const cached = fontDataCache.get(location);
    if (cached)
        return cached;
    try {
        const extension = (0, node_path_1.extname)(location).toLowerCase();
        const metadata = extension === ".woff2"
            ? { mime: "font/woff2", format: "woff2" }
            : extension === ".woff"
                ? { mime: "font/woff", format: "woff" }
                : extension === ".otf"
                    ? { mime: "font/otf", format: "opentype" }
                    : { mime: "font/ttf", format: "truetype" };
        const dataUrl = "data:" + metadata.mime + ";base64," + (0, node_fs_1.readFileSync)(location).toString("base64");
        const asset = { dataUrl, format: metadata.format };
        fontDataCache.set(location, asset);
        return asset;
    }
    catch {
        // Keep the safe local-first fallback when a configured or bundled font is absent.
        return null;
    }
}
function cssString(value) {
    return "\"" + value
        .replaceAll("\\", "\\\\")
        .replaceAll("\"", "\\\"")
        .replace(/[\u0000-\u001f\u007f]/g, " ") + "\"";
}
function fontFaceMarkup(comment, family, asset, weight) {
    return "/* " + comment + " */@font-face{font-family:" + cssString(family) + ";src:url(\"" + asset.dataUrl + "\") format(\"" + asset.format + "\");font-weight:" + weight + ";font-style:normal;font-display:swap}";
}
function bundledFontAsset(fileName) {
    const locations = [(0, node_path_1.join)(__dirname, "assets", "fonts", fileName), (0, node_path_1.join)(__dirname, "..", "assets", "fonts", fileName)];
    for (const location of locations) {
        const asset = fontAsset(location);
        if (asset)
            return asset;
    }
    return null;
}
let cachedBundledFontFaces = null;
function authorizedFontFaces(fontConfig) {
    if (fontConfig) {
        const configured = fontAsset(fontConfig.filePath);
        if (configured) {
            const family = fontConfig.family?.trim() || "ReportConfiguredFont";
            return {
                css: fontFaceMarkup("configured report font 400", family, configured, 400) + fontFaceMarkup("configured report font 500", family, configured, 500),
                family,
            };
        }
        console.warn("[where-tokens-went] Configured font could not be read; using the bundled report font.");
    }
    if (cachedBundledFontFaces !== null)
        return cachedBundledFontFaces;
    const body = bundledFontAsset("TsangerJinKai02-W04.ttf");
    const heading = bundledFontAsset("TsangerJinKai02-W05.ttf");
    if (!body || !heading)
        return { css: "", family: null };
    const result = {
        css: fontFaceMarkup("authorized TsangerJinKai02-W04", "TsangerJinKai02", body, 400) + fontFaceMarkup("authorized TsangerJinKai02-W05", "TsangerJinKai02", heading, 500),
        family: null,
    };
    cachedBundledFontFaces = result;
    return result;
}
function configuredFontVariables(family) {
    const value = cssString(family);
    return ":root{--serif:" + value + ",Charter,Georgia,Palatino,\"Times New Roman\",serif;--sans:var(--serif)}html[lang=\"zh-CN\"]{--serif:" + value + ",\"Source Han Serif SC\",\"Source Han Serif CN\",\"Noto Serif CJK SC\",\"Noto Serif SC\",\"Songti SC\",\"STSong\",Georgia,serif;--sans:var(--serif)}";
}
const FONT_DATA_URL_PATTERN = /data:font\/(?:ttf|otf|woff|woff2);base64,[A-Za-z0-9+/=]+/g;
const FONT_FACE_SOURCE_PATTERN = /src:url\("(data:font\/(?:ttf|otf|woff|woff2);base64,[A-Za-z0-9+/=]+)"\) format\("([^"]+)"\);font-weight:(400|500);/g;
const REQUIRED_FONT_CHARACTERS = " \u00a0\uFFFD0123456789，。！？；：、“”‘’（）【】《》—…·";
function collectReportFontCharacters(html) {
    const characters = new Set();
    for (const character of Array.from(html.replace(FONT_DATA_URL_PATTERN, "")))
        characters.add(character);
    for (const character of Array.from(REQUIRED_FONT_CHARACTERS))
        characters.add(character);
    return [...characters].join("");
}
function warnFontSubsettingFailure() {
    console.warn("[where-tokens-went] Font subsetting was unavailable; keeping the full embedded font data.");
}
function getFontCacheDir() {
    if (process.env.FONT_CACHE_DIR)
        return process.env.FONT_CACHE_DIR;
    return (0, node_path_1.join)(process.cwd(), ".scratch", "font-cache");
}
function loadCachedFontEntries(fontFingerprint, weight) {
    const cacheDir = getFontCacheDir();
    const entries = [];
    try {
        const files = (0, node_fs_1.readdirSync)(cacheDir);
        const prefix = fontFingerprint + "-" + weight + "-";
        for (const file of files) {
            if (file.startsWith(prefix) && file.endsWith(".json")) {
                const jsonPath = (0, node_path_1.join)(cacheDir, file);
                const woff2Path = (0, node_path_1.join)(cacheDir, file.replace(/\.json$/, ".woff2"));
                if (!(0, node_fs_1.existsSync)(woff2Path))
                    continue;
                const meta = JSON.parse((0, node_fs_1.readFileSync)(jsonPath, "utf8"));
                if (typeof meta.chars === "string") {
                    const charSet = new Set(meta.chars);
                    entries.push({
                        file: woff2Path,
                        charSet,
                        charsCount: charSet.size,
                    });
                }
            }
        }
    }
    catch {
        // Cache directory absent or unreadable
    }
    entries.sort((a, b) => a.charsCount - b.charsCount);
    return entries;
}
function findSupersetFont(entries, requiredCharacters) {
    for (const entry of entries) {
        let coversAll = true;
        for (const char of requiredCharacters) {
            if (!entry.charSet.has(char)) {
                coversAll = false;
                break;
            }
        }
        if (coversAll) {
            try {
                const buf = (0, node_fs_1.readFileSync)(entry.file);
                if (buf.length >= 4 && buf.subarray(0, 4).toString("ascii") === "wOF2") {
                    return buf;
                }
            }
            catch { }
        }
    }
    return null;
}
function saveCachedFont(fontFingerprint, weight, chars, woff2Buffer) {
    const cacheDir = getFontCacheDir();
    try {
        (0, node_fs_1.mkdirSync)(cacheDir, { recursive: true });
        const subsetHash = (0, node_crypto_1.createHash)("sha256").update(chars).digest("hex").slice(0, 12);
        const baseName = fontFingerprint + "-" + weight + "-" + subsetHash;
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(cacheDir, baseName + ".woff2"), woff2Buffer);
        (0, node_fs_1.writeFileSync)((0, node_path_1.join)(cacheDir, baseName + ".json"), JSON.stringify({ chars }), "utf8");
    }
    catch {
        // Best effort caching
    }
}
async function subsetReportFonts(html) {
    FONT_FACE_SOURCE_PATTERN.lastIndex = 0;
    const sources = [...html.matchAll(FONT_FACE_SOURCE_PATTERN)];
    if (sources.length === 0)
        return html;
    const weights = new Set(sources.map((source) => source[3]));
    if (sources.length !== 2 || weights.size !== 2 || !weights.has("400") || !weights.has("500"))
        return html;
    try {
        const subsetFont = require("subset-font");
        const characters = collectReportFontCharacters(html);
        const replacements = [];
        for (const source of sources) {
            const weight = source[3];
            const input = Buffer.from(source[1].split(",")[1], "base64");
            const fontFingerprint = (0, node_crypto_1.createHash)("sha256").update(input).digest("hex").slice(0, 12);
            const cachedEntries = loadCachedFontEntries(fontFingerprint, weight);
            let subset = findSupersetFont(cachedEntries, characters);
            if (!subset) {
                const largestCached = cachedEntries.length > 0 ? cachedEntries[cachedEntries.length - 1].charSet : null;
                const targetCharacters = largestCached && largestCached.size < 6000
                    ? [...new Set([...characters, ...largestCached])].sort().join("")
                    : characters;
                subset = Buffer.from(await subsetFont(input, targetCharacters, { targetFormat: "woff2" }));
                if (subset.length < 4 || subset.subarray(0, 4).toString("ascii") !== "wOF2")
                    throw new Error("The subset font was not WOFF2.");
                saveCachedFont(fontFingerprint, weight, targetCharacters, subset);
            }
            replacements.push({
                start: source.index ?? 0,
                end: (source.index ?? 0) + source[0].length,
                value: source[0].replace(source[1], "data:font/woff2;base64," + subset.toString("base64")).replace("format(\"" + source[2] + "\")", "format(\"woff2\")"),
            });
        }
        let optimized = html;
        for (const replacement of replacements.reverse()) {
            optimized = optimized.slice(0, replacement.start) + replacement.value + optimized.slice(replacement.end);
        }
        return optimized;
    }
    catch {
        warnFontSubsettingFailure();
        return html;
    }
}
function scriptSafeJson(value) {
    return (JSON.stringify(value) ?? "null")
        .replaceAll("&", "\\u0026")
        .replaceAll("<", "\\u003c")
        .replaceAll(">", "\\u003e")
        .replaceAll("\u2028", "\\u2028")
        .replaceAll("\u2029", "\\u2029");
}
function keySessionChartData(result, locale, firstUserMessages) {
    const promptByTurn = new Map(firstUserMessages.map((record) => [record.sessionId + "\0" + record.turnId, record]));
    return result.rankings.sessions.slice(0, 3).map((row, index) => {
        const turns = sessionTurns(result, row.key);
        const hot = hotTurnIds(turns);
        return {
            chartId: "key-session-chart-" + index,
            turns: turns.map((turn) => {
                const prompt = promptByTurn.get(row.key + "\0" + turn.turnId);
                const events = processEvents(turn, locale);
                return {
                    n: numericValue(turn.ordinal),
                    label: roundLabel(turn, locale),
                    token: numericValue(turn.tokens.totalTokens),
                    share: numericValue(turn.sessionSharePercent),
                    composition: [
                        labelsFor(locale).input + " " + labelsFor(locale).tokens + labelsFor(locale).exactSeparator + keyValueText(turn.tokens.inputTokens, locale),
                        labelsFor(locale).cachedInput + " " + labelsFor(locale).tokens + labelsFor(locale).exactSeparator + keyValueText(turn.tokens.cachedInputTokens, locale),
                        labelsFor(locale).output + " " + labelsFor(locale).tokens + labelsFor(locale).exactSeparator + keyValueText(turn.tokens.outputTokens, locale),
                    ].join(proseSeparator(locale)),
                    duration: numericValue(turn.durationMs),
                    tools: numericValue(turn.toolCallCount),
                    result: resultSizeText(turn, locale),
                    event: events.join(" · "),
                    prompt: prompt?.content ?? null,
                    promptNote: prompt?.content === null
                        ? labelsFor(locale).keySession.promptUnavailable
                        : prompt ? "" : labelsFor(locale).noUserMessage,
                    hot: hot.has(turn.turnId),
                };
            }),
        };
    });
}
function keyChartScript(locale) {
    const labels = labelsFor(locale);
    const ui = scriptSafeJson({
        firstUserMessage: labels.firstUserMessage,
        tokens: labels.tokens,
        share: labels.share,
        duration: labels.roundDuration,
        tools: labels.toolCalls,
        result: labels.resultSize,
        events: labels.processEvents,
        shareAxis: labels.charts.keyShareAxis,
        durationUnits: labels.duration,
        keyTrajectoryDescription: labels.charts.keyTrajectoryDescription,
        unavailable: labels.unavailable,
    });
    return [
        "const keyUi=" + ui + ";",
        "const escapeTooltip=value=>String(value??'').replace(/[&<>]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[char])).replace(/\"/g,'&quot;').replace(/'/g,'&#39;');",
        "const fmtInt=value=>value==null?'—':new Intl.NumberFormat(d.locale,{maximumFractionDigits:0}).format(value);",
        "const fmtPct=value=>value==null?'—':Number(value).toFixed(2)+'%';",
        "const fmtDuration=value=>{if(value==null)return'—';const total=Math.max(0,Math.round(value/1000)),seconds=total%60,minutes=Math.floor(total/60)%60,hours=Math.floor(total/3600),d=keyUi.durationUnits;if(hours)return hours+d.hour+(minutes?d.separator+minutes+d.minute:'')+(seconds?d.separator+seconds+d.second:'');if(minutes)return Math.floor(total/60)+d.minute+(seconds?d.separator+seconds+d.second:'');return seconds+d.second};",
        "d.keySessions.forEach(session=>{const tooltip=params=>{const item=Array.isArray(params)?params[0]:params;const turn=session.turns[item?.dataIndex??-1];if(!turn)return'';const prompt=turn.prompt===null?'<div class=\"key-session-tooltip-prompt key-session-tooltip-unavailable\"><div class=\"key-session-tooltip-label\">'+escapeTooltip(keyUi.firstUserMessage)+' · '+escapeTooltip(keyUi.unavailable)+'</div><div>'+escapeTooltip(turn.promptNote)+'</div></div>':'<div class=\"key-session-tooltip-prompt\"><div class=\"key-session-tooltip-label\">'+escapeTooltip(keyUi.firstUserMessage)+'</div><div class=\"key-session-tooltip-text\">'+escapeTooltip(turn.prompt)+'</div></div>';return'<div class=\"key-session-tooltip\"><div class=\"key-session-tooltip-title\">'+escapeTooltip(turn.label)+'</div><div class=\"key-session-tooltip-grid\"><span>'+escapeTooltip(keyUi.tokens)+'</span><b>'+fmtInt(turn.token)+'</b><span>'+escapeTooltip(keyUi.share)+'</span><b>'+fmtPct(turn.share)+'</b><span>'+escapeTooltip(keyUi.duration)+'</span><b>'+fmtDuration(turn.duration)+'</b><span>'+escapeTooltip(keyUi.tools)+'</span><b>'+(turn.tools==null?'—':fmtInt(turn.tools))+'</b><span>'+escapeTooltip(keyUi.result)+'</span><b>'+escapeTooltip(turn.result||'—')+'</b><span>'+escapeTooltip(keyUi.events)+'</span><b>'+escapeTooltip(turn.event||'—')+'</b></div>'+prompt+'</div>'};const shares=session.turns.map(turn=>({value:turn.share==null?0:turn.share,itemStyle:{color:turn.hot?p.brand:p.chartMuted,opacity:turn.share==null?.22:turn.hot?1:.78}}));const maxShare=Math.max(10,...session.turns.map(turn=>turn.share??0));make(session.chartId,{aria:{show:true,description:keyUi.keyTrajectoryDescription},animationDuration:450,tooltip:{trigger:'axis',enterable:true,confine:true,backgroundColor:'#faf9f5',borderColor:'#e8e6dc',borderWidth:1,textStyle:{fontFamily:serifFont,color:p.darkWarm},axisPointer:{type:'shadow',shadowStyle:{color:'rgba(27,54,93,.08)'}},extraCssText:'max-width:min(460px,88vw);max-height:420px;overflow:auto;white-space:normal;border-radius:2px;box-shadow:0 8px 24px rgba(20,20,19,.12);padding:12px 14px;',formatter:tooltip},grid:{left:54,right:58,top:42,bottom:78,containLabel:true},xAxis:{type:'category',data:session.turns.map(turn=>turn.n==null?turn.label.replace(/^.*?([0-9]+)/,'$1'):String(turn.n)),axisLabel:{...axis.axisLabel,fontSize:11,hideOverlap:true},axisLine:axis.axisLine,axisTick:{show:false}},yAxis:[{type:'value',name:keyUi.shareAxis,max:Math.min(100,Math.max(10,Math.ceil(maxShare/5)*5)),axisLabel:{...axis.axisLabel,formatter:value=>value+'%'},axisLine:axis.axisLine,splitLine:{lineStyle:{color:'#e5e3d8'}}},{type:'value',name:keyUi.duration,axisLabel:{...axis.axisLabel,formatter:value=>Math.round(value/60000)+keyUi.durationUnits.minute},axisLine:axis.axisLine,splitLine:{show:false}}],dataZoom:[{type:'inside',start:0,end:session.turns.length>14?42:100},{type:'slider',height:16,bottom:18,start:0,end:session.turns.length>14?42:100,borderColor:'#e8e6dc',fillerColor:'rgba(27,54,93,.14)',handleStyle:{color:p.brand},textStyle:{color:p.stone,fontFamily:serifFont}}],series:[{name:keyUi.shareAxis,type:'bar',yAxisIndex:0,barMaxWidth:22,data:shares,itemStyle:{borderRadius:[4,4,0,0]},emphasis:{itemStyle:{color:p.brandLight,opacity:1}}},{name:keyUi.duration,type:'line',yAxisIndex:1,smooth:.18,symbol:'circle',symbolSize:5,data:session.turns.map(turn=>turn.duration),lineStyle:{color:p.olive,width:1.6},itemStyle:{color:p.olive},connectNulls:false}]})});",
    ].join("");
}
function renderInteractiveCharts(result, locale, firstUserMessages = []) {
    const labels = labelsFor(locale);
    const rows = result.report.dailyUsage.map((row) => ({
        time: formatDateKey(row.key, locale, false), total: numericValue(row.totalTokens), input: numericValue(row.inputTokens), cached: numericValue(row.cachedInputTokens), cacheWrite: numericValue(row.cacheWriteTokens), output: numericValue(row.outputTokens), unclassified: numericValue(row.unclassifiedTokens), cost: numericValue(row.apiEquivalentCost),
    }));
    const models = result.rankings.models.map((row) => ({ name: modelLabel(row.key, locale), value: numericValue(row.value), share: numericValue(row.sharePercent) }));
    const tools = result.report.tools.map((row) => ({ name: publicLabel(row.key, labels.unavailable), value: numericValue(row.injectedTokens) }));
    const hourly = hourlyChartData(result, locale);
    const keySessions = keySessionChartData(result, locale, firstUserMessages);
    const cost = result.report.apiEquivalentCost;
    const costVisible = typeof cost.total.value === "number";
    const data = scriptSafeJson({
        rows,
        models,
        tools,
        hourly,
        keySessions,
        locale,
        labels: {
            input: labels.input,
            cached: labels.cachedInput,
            cacheWrite: labels.cacheWrite,
            output: labels.output,
            unclassified: labels.charts.unclassified,
            cost: labels.charts.cost,
            tokens: labels.tokens,
            calls: labels.calls,
            share: labels.charts.hourlyShare,
            hourly: {
                description: labels.charts.hourlyDescription,
                average: labels.charts.hourlyAveragePerCall,
                noActivity: labels.charts.hourlyNoActivity,
                noTokenData: labels.charts.hourlyNoTokenData,
            },
            unavailable: labels.unavailable,
        },
        costVisible,
    });
    const runtime = chartRuntime();
    if (!runtime || (rows.length === 0 && hourly.dates.length === 0 && !keySessions.some((session) => session.turns.length > 0)))
        return "";
    const chartPalette = { parchment: "#f5f4ed", tagQuiet: "#eef2f7", tagBg: "#e4ecf5", brand: "#1b365d", brandLight: "#2d5a8a", olive: "#504e49", stone: "#6b6a64", darkWarm: "#3d3d3a", lightStone: "#b8b7b0", chartMuted: "#d4d3cd", ivory: "#faf9f5" };
    const unavailableLabel = JSON.stringify(labels.unavailable);
    const chartAria = JSON.stringify(labels.charts.tokenTrendDescription);
    const chartScript = [
        "addEventListener('DOMContentLoaded',()=>{const d=", data, ";const p=", JSON.stringify(chartPalette), ";const serifFont=getComputedStyle(document.documentElement).getPropertyValue('--serif').trim();const compact=new Intl.NumberFormat(d.locale,{notation:'compact',maximumFractionDigits:2});const exact=new Intl.NumberFormat(d.locale,{maximumFractionDigits:0});const escapeChart=value=>String(value??'').replace(/[&<>]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[char])).replace(/\"/g,'&quot;').replace(/'/g,'&#39;');",
        "const axis={axisLine:{lineStyle:{color:'#e8e6dc'}},axisLabel:{fontFamily:serifFont,color:p.stone}};",
        "const make=(id,option,fit)=>{const el=document.getElementById(id);if(!el||!window.echarts)return;if(fit)fit(el);const c=echarts.init(el,null,{renderer:'svg'});c.setOption({backgroundColor:'transparent',textStyle:{fontFamily:serifFont,color:p.olive},...option});addEventListener('resize',()=>{if(fit)fit(el);c.resize()})};",
        "const tooltip=params=>params.map(item=>item.value==null?item.seriesName+': '+" + unavailableLabel + ":item.seriesName===d.labels.cost?item.seriesName+': $'+compact.format(item.value):item.seriesName+': '+compact.format(item.value)).join('<br>');",
        "const hourlyTooltip=params=>{const item=Array.isArray(params)?params[0]:params;const cell=item?.data;if(!cell)return'';const title=escapeChart(cell.label);if(!cell.hasRecord)return'<div class=\"hourly-tooltip\"><div class=\"hourly-tooltip-title\">'+title+'</div><p class=\"hourly-tooltip-empty\">'+escapeChart(d.labels.hourly.noActivity)+'</p></div>';const token=cell.tokens==null?escapeChart(d.labels.unavailable):exact.format(cell.tokens);const calls=cell.calls==null?escapeChart(d.labels.unavailable):exact.format(cell.calls);const share=cell.share==null?escapeChart(d.labels.unavailable):Number(cell.share).toFixed(2)+'%';const average=cell.average==null?escapeChart(d.labels.unavailable):exact.format(Math.round(cell.average));const noToken=cell.tokens==null?'<p class=\"hourly-tooltip-empty\">'+escapeChart(d.labels.hourly.noTokenData)+'</p>':'';return'<div class=\"hourly-tooltip\"><div class=\"hourly-tooltip-title\">'+title+'</div><div class=\"hourly-tooltip-grid\"><span>'+escapeChart(d.labels.tokens)+'</span><b>'+token+'</b><span>'+escapeChart(d.labels.calls)+'</span><b>'+calls+'</b><span>'+escapeChart(d.labels.share)+'</span><b>'+share+'</b><span>'+escapeChart(d.labels.hourly.average)+'</span><b>'+average+'</b></div>'+noToken+'</div>'};",
        "const heatMax=Math.max(1,d.hourly.max);const heatPieces=[{value:0,color:p.parchment},{gt:0,lte:heatMax*.25,color:p.tagQuiet},{gt:heatMax*.25,lte:heatMax*.5,color:p.tagBg},{gt:heatMax*.5,lte:heatMax*.75,color:p.stone},{gt:heatMax*.75,color:p.brand}];const hourlyGrid={left:84,right:16,top:18,bottom:36,containLabel:false};const fitHourly=el=>{const plotWidth=Math.max(1,el.clientWidth-hourlyGrid.left-hourlyGrid.right);const cell=plotWidth/24;el.style.height=Math.ceil(hourlyGrid.top+hourlyGrid.bottom+cell*d.hourly.dates.length)+'px'};",
        "const series=[['input',d.labels.input,p.brand,'solid','circle',true],['cached',d.labels.cached,p.stone,'dashed','rect',false],['cacheWrite',d.labels.cacheWrite,p.olive,'dotted','diamond',false],['output',d.labels.output,p.brandLight,'solid','triangle',false],['unclassified',d.labels.unclassified,p.lightStone,'dashed','emptyCircle',false]].map(([key,name,color,lineType,symbol,focus])=>({name,type:'line',smooth:false,symbol,showSymbol:d.rows.length<=14,symbolSize:5,lineStyle:{color,width:focus?2.5:2,opacity:focus?1:.92,type:lineType},itemStyle:{color},...(focus?{areaStyle:{color,opacity:.1}}:{}),emphasis:{focus:'series',lineStyle:{color,width:3,opacity:1},...(focus?{areaStyle:{color,opacity:.12}}:{})},data:d.rows.map(r=>r[key])}));",
        "if(d.costVisible)series.push({name:d.labels.cost,type:'line',yAxisIndex:1,symbol:'diamond',showSymbol:d.rows.length<=14,symbolSize:5,connectNulls:false,data:d.rows.map(r=>r.cost),lineStyle:{color:p.darkWarm,width:2,type:'dashed'},itemStyle:{color:p.darkWarm},emphasis:{focus:'series',lineStyle:{color:p.darkWarm,width:3,opacity:1}}});",
        "if(d.rows.length)make('token-trend',{aria:{show:true,description:", chartAria, "},tooltip:{trigger:'axis',backgroundColor:'#faf9f5',borderColor:'#e8e6dc',borderWidth:1,textStyle:{fontFamily:serifFont,color:p.darkWarm},formatter:tooltip},legend:{type:'scroll',textStyle:{fontFamily:serifFont,color:p.olive},itemWidth:28,itemHeight:8},grid:{left:56,right:d.costVisible?64:22,top:42,bottom:48,containLabel:true},xAxis:{type:'category',data:d.rows.map(r=>r.time),axisLabel:{...axis.axisLabel,hideOverlap:true},axisLine:axis.axisLine},yAxis:[{type:'value',name:'Token',axisLabel:{...axis.axisLabel,formatter:v=>compact.format(v)},axisLine:axis.axisLine,splitLine:{lineStyle:{color:'#e5e3d8'}}},...(d.costVisible?[{type:'value',name:'USD',axisLabel:{...axis.axisLabel,formatter:v=>'$'+compact.format(v)},axisLine:axis.axisLine,splitLine:{show:false}}]:[])],series});",
        "if(d.hourly.dates.length)make('hourly-heatmap',{aria:{show:true,description:d.labels.hourly.description},tooltip:{trigger:'item',confine:true,enterable:true,backgroundColor:'#faf9f5',borderColor:'#e8e6dc',borderWidth:1,textStyle:{fontFamily:serifFont,color:p.darkWarm},extraCssText:'max-width:min(360px,88vw);white-space:normal;border-radius:2px;box-shadow:0 8px 24px rgba(20,20,19,.12);padding:12px 14px;',formatter:hourlyTooltip},grid:hourlyGrid,xAxis:{type:'category',data:Array.from({length:24},(_,hour)=>String(hour).padStart(2,'0')),axisLabel:{...axis.axisLabel,interval:2},axisLine:axis.axisLine,axisTick:{show:false},splitLine:{show:false}},yAxis:{type:'category',data:d.hourly.dates.map(date=>date.label),axisLabel:{...axis.axisLabel},axisLine:axis.axisLine,axisTick:{show:false}},visualMap:{show:false,type:'piecewise',dimension:2,pieces:heatPieces},series:[{type:'heatmap',data:d.hourly.cells.map(cell=>({value:[cell.hour,cell.dateIndex,cell.tokens??0],...cell,itemStyle:{borderColor:p.ivory,borderWidth:2,borderRadius:3,...(cell.hasRecord?{}:{color:p.parchment,opacity:.64})}})),itemStyle:{borderColor:p.ivory,borderWidth:2,borderRadius:3},emphasis:{itemStyle:{borderColor:p.brand,borderWidth:2,shadowBlur:0}}}]},fitHourly);",
        "make('model-chart',{aria:{show:true,description:", JSON.stringify(labels.charts.modelAria), "},tooltip:{trigger:'axis',backgroundColor:'#faf9f5',borderColor:'#e8e6dc',borderWidth:1,textStyle:{fontFamily:serifFont,color:p.darkWarm},valueFormatter:v=>compact.format(v)},grid:{left:24,right:24,top:18,bottom:48,containLabel:true},xAxis:{type:'category',data:d.models.map(r=>r.name),axisLabel:{...axis.axisLabel,interval:0,rotate:24,hideOverlap:true},axisLine:axis.axisLine},yAxis:{type:'value',axisLabel:{...axis.axisLabel,formatter:v=>compact.format(v)},axisLine:axis.axisLine,splitLine:{lineStyle:{color:'#e5e3d8'}}},series:[{type:'bar',barMaxWidth:42,data:d.models.map(r=>r.value),itemStyle:{color:p.brand,borderRadius:[4,4,0,0]}}]});",
        "if(d.models.length>0&&d.models.length<=6)make('model-share-chart',{aria:{show:true,description:", JSON.stringify(labels.charts.modelShareDescription), "},color:[p.brand,p.brandLight,p.olive,p.stone,p.lightStone,p.chartMuted],tooltip:{trigger:'item',backgroundColor:'#faf9f5',borderColor:'#e8e6dc',borderWidth:1,textStyle:{fontFamily:serifFont,color:p.darkWarm},formatter:item=>item.name+': '+compact.format(item.value)+' ('+item.percent.toFixed(2)+'%)'},legend:{type:'scroll',orient:'vertical',left:'60%',top:16,bottom:16,width:'40%',textStyle:{fontFamily:serifFont,color:p.olive}},series:[{type:'pie',radius:['42%','58%'],center:['31%','50%'],label:{show:false},emphasis:{label:{show:true,color:p.darkWarm,fontFamily:serifFont,formatter:item=>item.percent.toFixed(2)+'%'}},itemStyle:{borderColor:p.ivory,borderWidth:2,borderRadius:4},data:d.models.map(r=>({name:r.name,value:r.value}))}]});",
        "make('tool-chart',{aria:{show:true,description:", JSON.stringify(labels.charts.toolDescription), "},tooltip:{trigger:'axis',backgroundColor:'#faf9f5',borderColor:'#e8e6dc',borderWidth:1,textStyle:{fontFamily:serifFont,color:p.darkWarm},formatter:params=>{const item=Array.isArray(params)?params[0]:params;const name=escapeChart(item?.name??'');const value=item?.value==null?escapeChart(d.labels.unavailable):compact.format(item.value);return name+': '+value}},grid:{left:132,right:24,top:18,bottom:18,containLabel:true},xAxis:{type:'value',axisLabel:{...axis.axisLabel,formatter:v=>compact.format(v)},axisLine:axis.axisLine,splitLine:{lineStyle:{color:'#e5e3d8'}}},yAxis:{type:'category',data:d.tools.map(r=>r.name),axisLabel:{...axis.axisLabel,formatter:value=>{const name=String(value??'');return name.length<=24?name:name.slice(0,23)+'…'},width:116,overflow:'truncate'},axisLine:axis.axisLine},series:[{type:'bar',barMaxWidth:42,data:d.tools.map(r=>r.value),itemStyle:{color:p.brandLight,borderRadius:[0,4,4,0]}}]});",
        keyChartScript(locale),
        "document.querySelectorAll('table.sortable').forEach(table=>{const headers=[...table.tHead.rows[0].cells];headers.forEach((th,index)=>{const label=th.textContent.trim();const b=document.createElement('button');b.type='button';b.className='sort-button';b.textContent=label;b.setAttribute('aria-label',label+' sort');th.textContent='';th.append(b);b.onclick=()=>{const asc=th.getAttribute('aria-sort')!=='ascending';headers.forEach(h=>h.removeAttribute('aria-sort'));th.setAttribute('aria-sort',asc?'ascending':'descending');const rows=[...table.tBodies[0].rows].map((row,order)=>({row,order,key:(row.cells[index].querySelector('[data-sort]')?.getAttribute('data-sort')??row.cells[index].getAttribute('data-sort')??row.cells[index].textContent.trim())}));rows.sort((a,b)=>{const an=Number(a.key),bn=Number(b.key),am=a.key===''||a.key==='unavailable',bm=b.key===''||b.key==='unavailable';if(am||bm)return am===bm?a.order-b.order:am?1:-1;const cmp=Number.isFinite(an)&&Number.isFinite(bn)?an-bn:a.key.localeCompare(b.key,d.locale);return cmp===0?a.order-b.order:(asc?cmp:-cmp)});rows.forEach(x=>table.tBodies[0].append(x.row))}})})});</script>"
    ].join('');
    const script = "<script>" + runtime + "</script><script>" + chartScript;
    return `<div class="ivory-group chart-ivory"><div id="token-trend" class="echart" role="img" aria-label="${escapeHtml(labels.dailyUsage)}"></div><p class="chart-summary">${escapeHtml(labels.charts.summary)}</p></div>${script}`;
}
let cachedStylesheet = null;
function readStylesheet() {
    if (cachedStylesheet !== null)
        return cachedStylesheet;
    try {
        cachedStylesheet = (0, node_fs_1.readFileSync)((0, node_path_1.join)(__dirname, "report.css"), "utf8");
    }
    catch {
        try {
            cachedStylesheet = (0, node_fs_1.readFileSync)((0, node_path_1.join)(__dirname, "..", "report.css"), "utf8");
        }
        catch {
            cachedStylesheet = "";
        }
    }
    return cachedStylesheet;
}
function renderStyles(fontConfig) {
    const stylesheet = readStylesheet();
    const faces = authorizedFontFaces(fontConfig);
    return "<style>" + faces.css + "\n" + stylesheet + (faces.family ? "\n" + configuredFontVariables(faces.family) : "") + "</style>";
}
function renderHtml(result, locale = "en-US", composition, localFirstUserMessages, fontConfig) {
    const labels = labelsFor(locale);
    const prompts = result.view === "share" ? [] : localFirstUserMessages ?? composition?.firstUserMessages ?? [];
    const modelBars = result.rankings.models.map((row) => ({ key: modelLabel(row.key, locale), value: row.value }));
    const parts = [
        "<!doctype html><html lang=\"" + labels.htmlLang + "\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" +
            escapeHtml(labels.title) + "</title>" + renderStyles(fontConfig) + "</head><body><main>",
        renderReportHeader(result, locale, composition),
        "<div class=\"report-stage report-stage--overview\">" + renderSectionMarker(labels.sectionMarkers.overview) + renderPrimaryAnswer(result, locale, composition) + "</div>",
        "<section><h2>" + escapeHtml(labels.scope) + "</h2>" + renderScope(result, locale) + "<h2>" + escapeHtml(labels.coverage) + "</h2>" + renderCoverage(result, locale) + "<p class=\"report-method-note\">" + escapeHtml(labels.methodNote) + "</p></section>",
        renderKpis(result, locale),
        renderSectionMarker(labels.sectionMarkers.diagnosis),
        renderFindings(result, locale, composition),
        renderCacheHtml(result, locale),
        renderFirstRequestHtml(result, locale),
        renderSkillInsightsHtml(composition, locale),
        renderSkillsHtml(result, locale),
        renderSectionMarker(labels.sectionMarkers.patterns),
        result.weekComparison ? "<section><h2>" + escapeHtml(labels.weekView) + "</h2>" + renderWeek(result, locale) + "</section>" : "",
        "<section><h2>" + escapeHtml(labels.time) + "</h2><h3>" + escapeHtml(labels.dailyUsage) + "</h3>" +
            renderInteractiveCharts(result, locale, prompts) + renderDaily(result, locale) +
            "<h3>" + escapeHtml(labels.hourlyActivity) + "</h3>" + renderHourly(result, locale) +
            "<h3>" + escapeHtml(labels.observedActivity) + "</h3>" + renderRolling(result, locale) + "</section>",
        "<section><h2>" + escapeHtml(labels.models) + "</h2><div class=\"ivory-group chart-ivory\"><div class=\"model-chart-grid\"><div id=\"model-chart\" class=\"echart\" role=\"img\" aria-label=\"" + escapeHtml(labels.models) + "\"></div>" +
            (result.rankings.models.length > 0 && result.rankings.models.length <= 6 ? "<div id=\"model-share-chart\" class=\"echart\" role=\"img\" aria-label=\"" + escapeHtml(labels.charts.modelShareAria) + "\"></div>" : "") +
            "</div></div>" + renderModels(result, locale) + "</section>",
        "<section class=\"tool-impact\"><h2>" + escapeHtml(labels.tools) + "</h2><div class=\"ivory-group chart-ivory\"><div id=\"tool-chart\" class=\"echart\" role=\"img\" aria-label=\"" + escapeHtml(labels.charts.toolAria) + "\"></div></div>" + renderTools(result, locale) + "</section>",
        "<section><h2>" + escapeHtml(labels.sessionsByUsage) + "</h2>" + renderSessions(result, locale) + "</section>",
        renderSectionMarker(labels.sectionMarkers.trace),
        renderKeySessionAnalysis(result, locale, composition, prompts),
        renderSectionMarker(labels.sectionMarkers.caveats),
        "<section><h2>" + escapeHtml(labels.limitations) + "</h2>" +
            renderWarningList(result, locale) + "</section>",
        "<footer><strong>" + escapeHtml(labels.privacy) + "</strong><p>" + escapeHtml(labels.privacyNote) + "</p></footer>",
        "</main></body></html>",
    ];
    return parts.join("");
}
function renderTopLine(result, locale) {
    const labels = labelsFor(locale);
    const sessionBreakdown = result.summary.topLevelSessionCount.value !== null && result.summary.subagentSessionCount.value !== null
        ? "; " + labels.topLevelSessions + ": " + evidencePlain(result.summary.topLevelSessionCount, locale, false) + "; " + labels.subagentSessions + ": " + evidencePlain(result.summary.subagentSessionCount, locale, false)
        : "";
    return [
        labels.auditPrefix + result.scope.harness + "; " + (result.scope.allProjects ? labels.allProjects : labels.currentProject) + "; " + labels.since + " " + formatDateTime(result.scope.since, locale),
        labels.coverage + ": " + coverageLineText(result, locale),
        labels.totalTokens + ": " + evidencePlain(result.summary.totalTokens, locale) + "; " + labels.sessions + ": " + evidencePlain(result.summary.sessionCount, locale, false) + sessionBreakdown + "; " + labels.modelCalls + ": " + evidencePlain(result.summary.modelCallCount, locale, false) + ".",
    ];
}
function percentageText(value, locale) {
    return value.value === null ? "—" : provenancePrefix(value.provenance, locale) + formatExact(value.value, locale) + "%";
}
function renderText(result, locale = "en-US", view = "full") {
    const labels = labelsFor(locale);
    if (view === "window") {
        const rolling = result.report.rollingWindow;
        const hasQuotaEvidence = rolling && (rolling.providerQuota.value !== null || rolling.resetAt.value !== null);
        const lines = [labels.methodNote, labels.windowView + (!rolling ? " — " + labels.noTimestampData : hasQuotaEvidence ? " — " + labels.localOnly : "")];
        if (rolling) {
            lines.push(labels.calls + ": " + evidencePlain(rolling.observedModelCallCount, locale, false) + "; " + labels.latestWindowTokens + ": " + evidencePlain(rolling.observedTokens, locale) + "; " + labels.historicalPeakTokens + ": " + evidencePlain(rolling.historicalPeakObservedTokens, locale) + ".");
            if (rolling.providerQuota.value !== null || rolling.resetAt.value !== null) {
                lines.push(labels.providerQuota + ": " + evidencePlain(rolling.providerQuota, locale) + "; " + labels.resetTime + ": " + evidencePlain(rolling.resetAt, locale) + ".");
            }
        }
        return lines.join("\n") + "\n";
    }
    if (view === "tools") {
        const lines = [labels.methodNote, labels.toolsView];
        if (result.report.tools.length === 0)
            lines.push(labels.noToolData);
        for (const tool of result.report.tools.slice(0, 10)) {
            lines.push(publicLabel(tool.key, labels.unavailable) + ": " + labels.calls + " " + evidencePlain(tool.calls, locale, false) +
                "; " + labels.amplified + " " + evidencePlain(tool.amplifiedTokens, locale) + "; " + labels.share + " " + percentageText(tool.sharePercent, locale) + ".");
        }
        return lines.join("\n") + "\n";
    }
    if (view === "usage") {
        const lines = [labels.methodNote, labels.usageView, ...renderTopLine(result, locale), ...renderCacheText(result, locale), ...renderFirstRequestText(result, locale), ...renderSkillsText(result, locale)];
        const model = result.rankings.models.slice(0, 5).map((entry) => modelLabel(entry.key, locale) + " " + evidencePlain(entry.value, locale) + " / " + percentageText(entry.sharePercent, locale)).join(", ");
        if (model)
            lines.push(labels.models + ": " + model + ".");
        const session = result.rankings.sessions[0];
        if (session)
            lines.push(labels.sessionsByUsage + ": " + sessionLabel(session, locale) + " — " + evidencePlain(session.value, locale) + ".");
        return lines.join("\n") + "\n";
    }
    const lines = [labels.methodNote, ...renderTopLine(result, locale)];
    if (result.checks.length > 0)
        lines.push(labels.diagnosticSignals + ":", ...result.checks.map((check) => checkLine(check, locale)));
    lines.push(...renderCacheText(result, locale), ...renderFirstRequestText(result, locale), ...renderSkillsText(result, locale));
    const topSession = result.rankings.sessions[0];
    if (topSession) {
        lines.push(labels.topSession + ": " + sessionLabel(topSession, locale) +
            proseSeparator(locale) + labels.tokens + " " + evidencePlain(topSession.value, locale, false) + proseSeparator(locale) + labels.share + labels.exactSeparator +
            percentageText(topSession.sharePercent, locale) + ".");
    }
    const modelSummary = result.rankings.models.slice(0, 5)
        .map((entry) => modelLabel(entry.key, locale) + ": " + formatExact(entry.value.value, locale) + " " + labels.tokens + " (" + percentageText(entry.sharePercent, locale) + ")")
        .join(", ");
    if (modelSummary)
        lines.push(labels.modelsHeading + ": " + modelSummary + ".");
    return lines.join("\n") + "\n";
}
function snapshotResult(snapshot) {
    return snapshot;
}
function renderWeekText(comparison, locale = "en-US") {
    const labels = labelsFor(locale);
    const current = snapshotResult(comparison.current);
    const previous = snapshotResult(comparison.previous);
    return [
        labels.weekView,
        labels.methodNote,
        labels.currentWeek + ": " + formatDateTime(comparison.currentFrom, locale) + " → " + formatDateTime(comparison.currentTo, locale),
        labels.previousWeek + ": " + formatDateTime(comparison.previousFrom, locale) + " → " + formatDateTime(comparison.previousTo, locale),
        labels.totalTokens + ": " + evidencePlain(current.summary.totalTokens, locale) + " vs " + evidencePlain(previous.summary.totalTokens, locale) + "; " + labels.change + ": " + evidencePlain(comparison.changes.totalTokens, locale) + ".",
        labels.modelCalls + ": " + evidencePlain(current.summary.modelCallCount, locale, false) + " vs " + evidencePlain(previous.summary.modelCallCount, locale, false) + "; " + labels.change + ": " + evidencePlain(comparison.changes.modelCallCount, locale, false) + ".",
    ].join("\n") + "\n";
}
function redactedModelKey(row, locale) {
    return publicLabel(row.key, labelsFor(locale).otherModel);
}
function renderShare(result, locale = "en-US") {
    const labels = labelsFor(locale);
    const lines = [
        "# " + labels.redactedShare,
        "",
        labels.methodNote,
        "",
        "- " + labels.harness + ": " + result.scope.harness,
        "- " + labels.scope + ": " + (result.scope.allProjects ? labels.allProjects : labels.currentProject),
        "- " + labels.since + ": " + formatDateTime(result.scope.since, locale),
        "- " + labels.totalTokens + ": " + evidencePlain(result.summary.totalTokens, locale, false),
        "- " + labels.sessions + ": " + evidencePlain(result.summary.sessionCount, locale, false),
        "- " + labels.modelCalls + ": " + evidencePlain(result.summary.modelCallCount, locale, false),
        "- " + labels.coverage + ": " + coverageLineText(result, locale),
        "- " + labels.cacheReadRate + ": " + percentagePlain(result.report.cacheEconomics.cacheReadRatePercent, locale),
        "- " + labels.cacheWriteRate + ": " + percentagePlain(result.report.cacheEconomics.cacheWriteRatePercent, locale),
        "- " + labels.cacheCoverage + ": " + percentagePlain(result.report.cacheEconomics.coveragePercent, locale),
        "- " + labels.observedApiCost + ": " + currencyPlain(result.report.cacheEconomics.observedApiEquivalentCost, locale, false),
        "- " + labels.allUncachedApiCost + ": " + currencyPlain(result.report.cacheEconomics.allUncachedApiEquivalentCost, locale, false),
        "- " + labels.cacheSavings + ": " + currencyPlain(result.report.cacheEconomics.cacheSavings, locale, false),
        "- " + labels.cacheSavingsPercent + ": " + percentagePlain(result.report.cacheEconomics.cacheSavingsPercent, locale),
        "- " + labels.priceCoverage + ": " + percentagePlain(result.report.cacheEconomics.pricedUsageCoveragePercent, locale),
        "- " + labels.firstRequestBurden + ": " + labels.firstRequestMedian + " " + evidencePlain(result.report.firstRequestBurden.medianTokens, locale, false) + "; " + labels.firstRequestShare + " " + percentagePlain(result.report.firstRequestBurden.sharePercent, locale) + "; " + labels.firstRequestCoverage + " " + percentagePlain(result.report.firstRequestBurden.coveragePercent, locale),
        "",
        "## " + labels.models,
        "",
        "| " + labels.model + " | " + labels.tokens + " | " + labels.share + " |",
        "| --- | ---: | ---: |",
    ];
    for (const row of result.rankings.models)
        lines.push("| " + redactedModelKey(row, locale) + " | " + evidencePlain(row.value, locale, false) + " | " + percentageText(row.sharePercent, locale) + " |");
    lines.push("", "## " + labels.time, "", "| " + labels.date + " | " + labels.tokens + " | " + labels.share + " |", "| --- | ---: | ---: |");
    for (const row of result.report.dailyUsage)
        lines.push("| " + formatDateKey(row.key, locale) + " | " + evidencePlain(row.totalTokens, locale, false) + " | " + percentageText(row.sharePercent, locale) + " |");
    lines.push("", "## " + labels.tools, "", "| " + labels.toolCategory + " | " + labels.calls + " | " + labels.amplified + " | " + labels.share + " |", "| --- | ---: | ---: |");
    for (const row of result.report.tools)
        lines.push("| " + publicLabel(row.key, labels.otherTool) + " | " + evidencePlain(row.calls, locale, false) + " | " + evidencePlain(row.amplifiedTokens, locale, false) + " | " + percentageText(row.sharePercent, locale) + " |");
    lines.push("", "## " + labels.skillEvidence, "");
    if (result.report.skills.length === 0) {
        lines.push(labels.noSkillEvidence);
    }
    else {
        lines.push(skillEvidenceNote(locale));
        lines.push("| " + labels.skill + " | " + labels.invocationCount + " | " + labels.skillSessions + " | " + labels.attributedTokens + " | " + labels.attributedCost + " |", "| --- | ---: | ---: | ---: | ---: |");
        for (const skill of result.report.skills)
            lines.push("| " + skillLabel(skill.name, locale) + " | " + evidencePlain(skill.invocationCount, locale, false) + " | " + evidencePlain(skill.sessionCount, locale, false) + " | " + evidencePlain(skill.attributedTokens, locale, false) + " | " + currencyPlain(skill.attributedApiEquivalentCost, locale, false) + " |");
    }
    lines.push(labels.cacheMethodPrefix + methodPairText(methodText(result.report.cacheEconomics.cacheReadRatePercent, locale), methodText(result.report.cacheEconomics.observedApiEquivalentCost, locale), locale));
    lines.push(labels.firstRequestMethodPrefix + methodText(result.report.firstRequestBurden.medianTokens, locale));
    if (result.report.cacheEconomics.limitations.length > 0)
        lines.push(labels.cacheLimitationsPrefix + limitationListText(result.report.cacheEconomics.limitations, locale));
    if (result.report.firstRequestBurden.limitations.length > 0)
        lines.push(labels.firstRequestLimitationsPrefix + limitationListText(result.report.firstRequestBurden.limitations, locale));
    lines.push("", "## " + labels.diagnosticSignals);
    for (const check of result.checks)
        lines.push("- " + checkLine(check, locale));
    lines.push("", labels.privacyNote);
    return lines.join("\n") + "\n";
}
