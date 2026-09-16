"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeLocale = normalizeLocale;
exports.formatCompact = formatCompact;
exports.resolveReportProjectName = resolveReportProjectName;
exports.renderHtml = renderHtml;
exports.renderText = renderText;
exports.renderWeekText = renderWeekText;
exports.renderShare = renderShare;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const key_session_analysis_1 = require("./key-session-analysis");
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
    };
    return known[key] ?? labels.findingEvidence;
}
function reportFindingEvidence(result, reference, locale) {
    const labels = labelsFor(locale);
    const match = (0, key_session_analysis_1.resolveReportEvidence)(result, reference);
    if (!match)
        return labels.findingEvidence + labels.exactSeparator + labels.unavailable;
    if (match.kind === "check") {
        const outcome = result.checks.find((check) => check.id === match.key.split(":", 1)[0])?.outcome;
        const checkId = match.key.split(":", 1)[0];
        const valueLabels = checkEvidenceLabels(checkId, locale);
        const facts = match.evidence.map((value, index) => reportEvidenceFact(value, valueLabels[index]?.[0] ?? labels.findingEvidence, locale, valueLabels[index]?.[1] ?? "metric"));
        return labels.automatedCheckEvidence + labels.exactSeparator + (outcome ? outcomeLabel(outcome, locale) + proseSeparator(locale) : "") + facts.join(proseSeparator(locale));
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
        return labels.findingEvidence + labels.exactSeparator + name + "（" + match.evidence.map((value, index) => reportEvidenceFact(value, facts[index]?.[0] ?? labels.findingEvidence, locale, facts[index]?.[1] ?? "metric")).join(proseSeparator(locale)) + "）";
    }
    if (match.kind === "turn") {
        const turn = result.turns.find((candidate) => candidate.evidenceId === reference);
        const facts = [[labels.tokens, "metric"], [labels.share, "percentage"], [labels.modelCalls, "metric"]];
        return labels.findingEvidence + labels.exactSeparator + (turn ? roundLabel(turn, locale) : labels.unavailable) + "（" + match.evidence.map((value, index) => reportEvidenceFact(value, facts[index]?.[0] ?? labels.findingEvidence, locale, facts[index]?.[1] ?? "metric")).join(proseSeparator(locale)) + "）";
    }
    return labels.findingEvidence + labels.exactSeparator + match.evidence.map((value) => reportEvidenceFact(value, labels.findingEvidence, locale)).join(proseSeparator(locale));
}
function renderReportFinding(result, finding, locale) {
    const labels = labelsFor(locale);
    const support = labels.findingSupport[finding.support];
    const evidence = finding.evidenceRefs.map((reference) => reportFindingEvidence(result, reference, locale)).join(proseSeparator(locale));
    const uncertainty = finding.uncertainty === null ? "" : labels.findingUncertainty + labels.exactSeparator + completeSentence(finding.uncertainty, locale);
    const method = [labels.findingEvidence + labels.exactSeparator + evidence, labels.findingSupport[finding.support], uncertainty].filter(Boolean).join(proseSeparator(locale));
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
        const detailSummary = keySessionMessages.roundsSummary(turns.length);
        const trajectory = "<section class=\"key-session-section key-session-trajectory\" aria-labelledby=\"" + chartId + "-title\"><div class=\"key-session-section-head\"><h4 id=\"" + chartId + "-title\">" + escapeHtml(labels.turnTrajectory) + "</h4><p>" + escapeHtml(trajectoryNote) + "</p></div><figure class=\"key-session-chart-frame ivory-group chart-ivory\" aria-labelledby=\"" + chartId + "-caption\"><div class=\"key-session-chart-toolbar\"><div><strong>" + escapeHtml(keySessionMessages.chartRounds(turns.length)) + "</strong><small>" + escapeHtml(labels.chartHint) + "</small></div><div class=\"key-session-legend\" aria-label=\"" + escapeHtml(keySessionMessages.legendAria) + "\"><span class=\"hot\">" + escapeHtml(keySessionMessages.hotspots) + "</span><span>" + escapeHtml(keySessionMessages.otherRounds) + "</span><span class=\"time\">" + escapeHtml(labels.roundDuration) + "</span></div></div><div id=\"" + chartId + "\" class=\"echart key-session-chart\" role=\"img\" aria-label=\"" + escapeHtml(keySessionMessages.chartAria(turns.length)) + "\"></div><figcaption id=\"" + chartId + "-caption\" class=\"key-session-chart-note\"><strong>" + escapeHtml(keySessionMessages.focus) + "</strong>" + escapeHtml(fact) + "</figcaption><p class=\"key-session-prompt-note\">" + escapeHtml(promptNote) + "</p><noscript><p class=\"key-session-chart-note\">" + escapeHtml(keySessionMessages.noScript) + "</p></noscript></figure><details class=\"key-session-appendix\"><summary><span>" + escapeHtml(detailSummary) + "</span><small>" + escapeHtml(labels.detailNote) + "</small></summary><div class=\"table-scroll\">" + renderTurnTrajectory(result, row.key, locale) + "</div></details></section>";
        return "<details class=\"key-session-entry" + (index === 0 ? " key-session-entry--primary\" open" : "\"") + "><summary aria-controls=\"" + titleId + "\"><span class=\"key-session-summary\"><span class=\"session-summary-main\"><span class=\"session-summary-title\">" + escapeHtml(title) + "</span><span class=\"session-summary-id\">" + escapeHtml(shortenedId(row.key)) + " · " + escapeHtml(String(turns.length)) + " " + escapeHtml(keySessionMessages.roundUnit) + "</span></span><small>" + escapeHtml(index === 0 ? keySessionMessages.openByDefault : keySessionMessages.collapsed) + "</small></span></summary><div id=\"" + titleId + "\" class=\"key-session-content\"><header class=\"key-session-head\"><div class=\"key-session-heading\"><div><span class=\"session-rank\">" + escapeHtml(keySessionMessages.rank(index + 1, topSessions.length)) + "</span><h3 class=\"session-title\">" + escapeHtml(title) + "</h3><p class=\"task-title\">" + escapeHtml(taskContext) + "</p><p class=\"session-id\">" + escapeHtml(row.key) + " · " + escapeHtml(result.scope.harness) + "</p></div><div class=\"session-total\"><strong>" + escapeHtml(sessionTotal) + "</strong><span>" + escapeHtml(labels.sessionToken) + "</span></div></div>" + metrics + "</header><section class=\"key-session-section key-session-judgment\" aria-labelledby=\"" + titleId + "-judgment\"><div class=\"key-session-section-head\"><h4 id=\"" + titleId + "-judgment\">" + escapeHtml(labels.primaryFinding) + "</h4><p>" + escapeHtml(keySessionMessages.judgmentNote) + "</p></div><div class=\"judgment\">" + finding + action + "</div></section>" + trajectory + "</div></details>";
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
function chartRuntime() {
    try {
        return (0, node_fs_1.readFileSync)((0, node_path_1.join)(__dirname, "assets", "echarts.min.js"), "utf8");
    }
    catch {
        try {
            return (0, node_fs_1.readFileSync)((0, node_path_1.join)(__dirname, "..", "assets", "echarts.min.js"), "utf8");
        }
        catch {
            return "";
        }
    }
}
const fontDataCache = new Map();
function fontDataUrl(fileName) {
    const cached = fontDataCache.get(fileName);
    if (cached)
        return cached;
    const locations = [(0, node_path_1.join)(__dirname, "assets", "fonts", fileName), (0, node_path_1.join)(__dirname, "..", "assets", "fonts", fileName)];
    for (const location of locations) {
        try {
            const dataUrl = "data:font/ttf;base64," + (0, node_fs_1.readFileSync)(location).toString("base64");
            fontDataCache.set(fileName, dataUrl);
            return dataUrl;
        }
        catch {
            // Keep the safe local-first fallback when the authorized font assets are absent.
        }
    }
    return "";
}
function authorizedFontFaces() {
    const body = fontDataUrl("TsangerJinKai02-W04.ttf");
    const heading = fontDataUrl("TsangerJinKai02-W05.ttf");
    if (!body || !heading)
        return "";
    return "/* authorized TsangerJinKai02-W04 */@font-face{font-family:\"TsangerJinKai02\";src:url(\"" + body + "\") format(\"truetype\");font-weight:400;font-style:normal;font-display:swap}/* authorized TsangerJinKai02-W05 */@font-face{font-family:\"TsangerJinKai02\";src:url(\"" + heading + "\") format(\"truetype\");font-weight:500;font-style:normal;font-display:swap}";
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
        "if(d.models.length>0&&d.models.length<=6)make('model-share-chart',{aria:{show:true,description:", JSON.stringify(labels.charts.modelShareDescription), "},color:[p.brand,p.brandLight,p.olive,p.stone,p.lightStone,p.chartMuted],tooltip:{trigger:'item',backgroundColor:'#faf9f5',borderColor:'#e8e6dc',borderWidth:1,textStyle:{fontFamily:serifFont,color:p.darkWarm},formatter:item=>item.name+': '+compact.format(item.value)+' ('+item.percent.toFixed(2)+'%)'},legend:{type:'scroll',orient:'vertical',right:0,top:24,bottom:24,textStyle:{fontFamily:serifFont,color:p.olive}},series:[{type:'pie',radius:['48%','72%'],center:['36%','50%'],label:{show:false},emphasis:{label:{show:true,color:p.darkWarm,fontFamily:serifFont,formatter:item=>item.percent.toFixed(2)+'%'}},itemStyle:{borderColor:p.ivory,borderWidth:2,borderRadius:4},data:d.models.map(r=>({name:r.name,value:r.value}))}]});",
        "make('tool-chart',{aria:{show:true,description:", JSON.stringify(labels.charts.toolDescription), "},tooltip:{trigger:'axis',backgroundColor:'#faf9f5',borderColor:'#e8e6dc',borderWidth:1,textStyle:{fontFamily:serifFont,color:p.darkWarm},formatter:params=>{const item=Array.isArray(params)?params[0]:params;const name=escapeChart(item?.name??'');const value=item?.value==null?escapeChart(d.labels.unavailable):compact.format(item.value);return name+': '+value}},grid:{left:132,right:24,top:18,bottom:18,containLabel:true},xAxis:{type:'value',axisLabel:{...axis.axisLabel,formatter:v=>compact.format(v)},axisLine:axis.axisLine,splitLine:{lineStyle:{color:'#e5e3d8'}}},yAxis:{type:'category',data:d.tools.map(r=>r.name),axisLabel:{...axis.axisLabel,formatter:value=>{const name=String(value??'');return name.length<=24?name:name.slice(0,23)+'…'},width:116,overflow:'truncate'},axisLine:axis.axisLine},series:[{type:'bar',barMaxWidth:42,data:d.tools.map(r=>r.value),itemStyle:{color:p.brandLight,borderRadius:[0,4,4,0]}}]});",
        keyChartScript(locale),
        "document.querySelectorAll('table.sortable').forEach(table=>{const headers=[...table.tHead.rows[0].cells];headers.forEach((th,index)=>{const label=th.textContent.trim();const b=document.createElement('button');b.type='button';b.className='sort-button';b.textContent=label;b.setAttribute('aria-label',label+' sort');th.textContent='';th.append(b);b.onclick=()=>{const asc=th.getAttribute('aria-sort')!=='ascending';headers.forEach(h=>h.removeAttribute('aria-sort'));th.setAttribute('aria-sort',asc?'ascending':'descending');const rows=[...table.tBodies[0].rows].map((row,order)=>({row,order,key:(row.cells[index].querySelector('[data-sort]')?.getAttribute('data-sort')??row.cells[index].getAttribute('data-sort')??row.cells[index].textContent.trim())}));rows.sort((a,b)=>{const an=Number(a.key),bn=Number(b.key),am=a.key===''||a.key==='unavailable',bm=b.key===''||b.key==='unavailable';if(am||bm)return am===bm?a.order-b.order:am?1:-1;const cmp=Number.isFinite(an)&&Number.isFinite(bn)?an-bn:a.key.localeCompare(b.key,d.locale);return cmp===0?a.order-b.order:(asc?cmp:-cmp)});rows.forEach(x=>table.tBodies[0].append(x.row))}})})});</script>"
    ].join('');
    const script = "<script>" + runtime + "</script><script>" + chartScript;
    return `<div class="ivory-group chart-ivory"><div id="token-trend" class="echart" role="img" aria-label="${escapeHtml(labels.dailyUsage)}"></div><p class="chart-summary">${escapeHtml(labels.charts.summary)}</p></div>${script}`;
}
function renderStyles() {
    const fontFaces = authorizedFontFaces();
    return `<style>${fontFaces}
:root{color-scheme:light;--parchment:#f5f4ed;--ivory:#faf9f5;--warm-sand:#e8e6dc;--inline-code:#f0eee6;--deep-dark:#141413;--brand:#1b365d;--brand-light:#2d5a8a;--near-black:#141413;--dark-warm:#3d3d3a;--olive:#504e49;--stone:#6b6a64;--border:#e8e6dc;--border-soft:#e5e3d8;--tag-bg:#e4ecf5;--tag-quiet:#eef2f7;--brand-tint:#eef2f7;--chart-muted:#d4d3cd;--serif:Charter,Georgia,Palatino,"Times New Roman",serif;--sans:var(--serif);--mono:"JetBrains Mono","SF Mono","Fira Code",Consolas,Monaco,monospace}
html[lang="zh-CN"]{--serif:"TsangerJinKai02","Source Han Serif SC","Source Han Serif CN","Noto Serif CJK SC","Noto Serif SC","Songti SC","STSong",Georgia,serif;--sans:var(--serif)}
*{box-sizing:border-box}html,body{margin:0;padding:0}body{background:var(--parchment);color:var(--near-black);font-family:var(--serif);font-size:15px;font-weight:400;line-height:1.55;letter-spacing:0;font-synthesis:none;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}html[lang="zh-CN"] body{letter-spacing:.3px}
main{max-width:1120px;margin:0 auto;padding:56px 64px 120px}.report-header{margin:0 0 24px;break-inside:avoid}.report-header__main{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,.36fr);gap:48px;align-items:start}.report-eyebrow{display:flex;align-items:baseline;gap:7px;font-family:var(--sans);font-size:12px;font-weight:500;line-height:1.2;letter-spacing:.5px;text-transform:none;color:var(--brand);margin:0 0 14px}.report-eyebrow__rule{display:inline-block;flex:0 0 11px;width:11px;height:1px;background:var(--brand);transform:translateY(-2px)}.report-header h1{display:flex;align-items:baseline;gap:7px;margin:0 0 9px;line-height:1.05;letter-spacing:-.2px}.report-header__project{font-size:36px;font-weight:500;color:var(--near-black)}.report-header__suffix{font-size:16px;font-weight:400;color:var(--stone);white-space:nowrap}.report-deck{max-width:none;font-family:var(--serif);font-size:14px;line-height:1.35;color:var(--olive);margin:0;white-space:nowrap}.report-header__primary{align-self:start;padding-top:0;text-align:right}.report-header__value{display:block;color:var(--near-black);font-family:var(--serif);font-size:36px;font-weight:500;line-height:1;font-variant-numeric:lining-nums tabular-nums;white-space:nowrap}.report-header__value .metric-main{font-size:inherit}.report-header__primary-label{display:block;margin-top:7px;color:var(--olive);font-size:12px;line-height:1.25;white-space:nowrap}.report-header__primary-label .metric-main{font-size:inherit;color:inherit}.report-header__primary-date{display:block;margin-top:5px;color:var(--stone);font-size:12px;line-height:1.25;white-space:nowrap}.report-header__metrics{display:grid;grid-template-columns:1.15fr .95fr 1.18fr 1fr;gap:24px;margin-top:16px;padding:18px 0 17px;border-top:.5px solid var(--border);border-bottom:.5px solid var(--border)}.report-header__metric{display:flex;align-items:baseline;gap:6px;min-width:0;white-space:nowrap}.report-header__metric-value{color:var(--brand);font-family:var(--serif);font-weight:500;line-height:1;font-variant-numeric:lining-nums tabular-nums}.report-header__metric-value .metric-main,.report-header__metric-value .percentage{font-size:18px}.report-header__metric-label{color:var(--olive);font-size:12px;line-height:1.35;white-space:nowrap}h1,h2,h3{font-family:var(--serif);font-weight:500;color:var(--near-black)}h1{font-size:38px;line-height:1.1;letter-spacing:-.4px;margin:0 0 12px}h2{font-size:24px;line-height:1.2;margin:0 0 20px}h3{font-size:18px;line-height:1.3;margin:32px 0 12px}section{margin:0 0 56px;padding:0;background:transparent;border:0;border-radius:0}section>h2{margin-top:0}
.metadata-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;margin:0 0 32px}.metadata-grid div{padding:0 16px 14px 0;border-bottom:1px solid var(--border-soft)}.metadata-grid dt,.metric-label{color:var(--stone);font-size:12px;line-height:1.35}.metadata-grid dd{margin:6px 0 0;font-weight:500;line-height:1.45;overflow-wrap:anywhere}
.metrics{display:grid;gap:24px;margin:0 0 24px}.metrics--summary{grid-template-columns:repeat(3,minmax(0,1fr));gap:32px 28px;margin-bottom:56px}.metrics--coverage{grid-template-columns:repeat(5,minmax(0,1fr));margin-bottom:16px}.metrics--economic{grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 24px;margin-bottom:0}.metrics--first-request{grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:24px}.metrics--group{grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:0}.metrics--window{grid-template-columns:repeat(5,minmax(0,1fr));margin-bottom:0}.metric{min-width:0}.metric-label{display:block}.metric-value{display:block;margin-top:6px;font-family:var(--serif);font-size:22px;font-weight:500;line-height:1.1;color:var(--brand);font-variant-numeric:lining-nums tabular-nums}.metrics--summary .metric-value{font-size:32px}.metrics--coverage .metric-value,.metrics--window .metric-value{font-size:24px}.metric-stack{display:inline-flex;flex-direction:column;align-items:flex-start;gap:2px;font-variant-numeric:lining-nums tabular-nums}.metric-main{display:block}.percentage{display:block;white-space:nowrap}.unavailable{color:var(--stone);font-style:normal}.finding-evidence{display:inline-flex;vertical-align:baseline;flex-direction:column;align-items:flex-start;gap:1px;margin:0 2px;color:inherit;font-size:inherit;line-height:1.2}.finding-value{display:inline;margin:0;color:inherit;font-size:inherit}.coverage-percentage{display:inline-flex;align-items:baseline;gap:2px;font-variant-numeric:lining-nums tabular-nums}
.comparison-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;margin:24px 0 0}.ivory-group{background:var(--ivory);border:0;border-radius:10px;padding:20px 22px;break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact}.ivory-group h3{margin:0 0 16px}.ivory-group .metrics{margin-bottom:0}.rolling-activity .coverage-note{margin:10px 0 12px}.rolling-activity .window-note{justify-content:flex-start;margin-bottom:18px}
.coverage-note,.empty,.report-method-note{color:var(--olive);font-size:13px;line-height:1.5}.report-method-note{margin:16px 0 0;color:var(--stone)}.quiet-callout{background:var(--ivory);border:0;border-radius:8px;padding:12px 16px;margin:16px 0 0;color:var(--dark-warm)}.quiet-callout p{margin:8px 0 0}.quiet-callout .finding-evidence{vertical-align:middle}.tag{display:inline-block;border:0;border-radius:2px;padding:2px 6px;font-family:var(--sans);font-size:11px;font-weight:500;line-height:1.35;color:var(--brand);white-space:nowrap}.tag--quiet{background:transparent;color:var(--stone);padding:0;letter-spacing:.08em}.tag--default{background:var(--tag-bg)}
.editorial-list{margin:12px 0 0;padding-left:20px;color:var(--olive);font-size:13px;line-height:1.5}.editorial-list li+li{margin-top:8px}.supporting-findings ul{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 32px;list-style:none;margin:0;padding:0}.editorial-item{padding:18px 0;border-top:1px solid var(--border-soft)}.editorial-tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}.editorial-title{display:block;font-size:16px;font-weight:500;line-height:1.4}.editorial-detail{margin:6px 0 0;color:var(--olive);font-size:14px;line-height:1.5}.editorial-method{display:block;margin-top:8px;color:var(--stone);font-size:12px;line-height:1.45}
.kami-table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px;line-height:1.45;font-variant-numeric:lining-nums tabular-nums}.kami-table th,.kami-table td{text-align:left;border-bottom:.5px solid var(--border-soft);padding:8px 0 8px 16px;vertical-align:top}.kami-table th:first-child,.kami-table td:first-child{padding-left:0}.kami-table thead th{color:var(--dark-warm);font-size:12px;font-weight:500;line-height:1.35;border-bottom:1px solid var(--border)}.kami-table th:not(:first-child),.kami-table td:not(:first-child){text-align:right}.kami-table tbody th{font-weight:500;text-align:left}.kami-table tbody tr:last-child th,.kami-table tbody tr:last-child td{border-bottom:0}.kami-table.skills-table th:nth-child(2),.kami-table.skills-table td:nth-child(2),.kami-table.skills-table th:nth-child(9),.kami-table.skills-table td:nth-child(9),.kami-table.skills-table th:nth-child(10),.kami-table.skills-table td:nth-child(10){text-align:left}.kami-table.compact th,.kami-table.compact td{padding-top:6px;padding-bottom:6px}.sortable button{appearance:none;border:0;background:transparent;color:inherit;font:inherit;font-weight:500;padding:0;cursor:pointer;text-align:left;width:100%}.sort-button::after{color:var(--stone);font-size:.9em;font-weight:400}.kami-table th:not([aria-sort]) .sort-button:hover::after,.kami-table th:not([aria-sort]) .sort-button:focus-visible::after{content:" ↕"}.kami-table th[aria-sort="ascending"] .sort-button::after{content:" ↑"}.kami-table th[aria-sort="descending"] .sort-button::after{content:" ↓"}.kami-table th:not(:first-child) button{text-align:right}.sortable button:focus-visible,summary:focus-visible{outline:2px solid var(--brand);outline-offset:3px}.empty{margin:8px 0}
.echart{width:100%;height:300px;margin:0 0 12px;background:transparent;border:0;border-radius:0}.chart-summary{color:var(--olive);font-size:12px;line-height:1.45}.chart{display:block;width:100%;height:auto;margin:0 0 20px;background:transparent;border-radius:0;padding:0;overflow:visible}.chart-label,.chart-value,.heat-hour{font-family:var(--serif);font-size:12px;fill:var(--stone)}.chart-value{font-variant-numeric:lining-nums tabular-nums;fill:var(--near-black)}.chart-bar{fill:var(--brand)}.chart-track{fill:var(--border)}.segment-input{fill:var(--brand)}.segment-cached{fill:var(--stone)}.segment-cache-write{fill:var(--olive)}.segment-output{fill:var(--brand-light)}.segment-reasoning{fill:var(--chart-muted)}.heat-0{fill:var(--parchment)}.heat-1{fill:var(--tag-quiet)}.heat-2{fill:var(--tag-bg)}.heat-3{fill:var(--stone)}.heat-4{fill:var(--brand)}
.hourly-tooltip{min-width:230px;max-width:340px;color:var(--dark-warm);font-family:var(--serif);font-size:12px;line-height:1.5}.hourly-tooltip-title{color:var(--near-black);font-size:16px;line-height:1.2}.hourly-tooltip-grid{display:grid;grid-template-columns:auto minmax(0,1fr);gap:3px 14px;margin:10px 0 0}.hourly-tooltip-grid span{color:var(--stone)}.hourly-tooltip-grid b{color:var(--dark-warm);font-weight:500}.hourly-tooltip-empty{margin:10px 0 0;color:var(--stone)}
details{margin-top:24px;padding-top:4px}summary{cursor:pointer;list-style:none;color:var(--brand);font-weight:500;line-height:1.4;margin:0}summary::-webkit-details-marker{display:none}summary::after{content:""}.window-note{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:0 0 16px}.window-note span,.week-ranges span{color:var(--stone);font-size:12px;line-height:1.4}.week-ranges{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;margin-bottom:24px}.week-ranges div{background:var(--ivory);border-radius:8px;padding:14px 16px}.week-ranges strong,.week-ranges span{display:block}footer{color:var(--stone);font-size:12px;line-height:1.45;border-top:1px solid var(--border-soft);margin-top:24px;padding-top:24px}footer p{margin:6px 0 16px}
@media print{@page{size:A4;margin:14mm 16mm;background:#f5f4ed}body{background:#f5f4ed;-webkit-print-color-adjust:exact;print-color-adjust:exact}main{max-width:none;padding:0}.report-header{break-inside:avoid}.report-header__metrics{break-inside:avoid}section{break-inside:auto;margin-bottom:36px}.quiet-callout,.ivory-group,.editorial-item,.week-ranges div,.kami-table,.echart,.chart{break-inside:avoid}.sortable button{color:inherit}}
@media(max-width:880px){main{padding:48px 32px 88px}.report-header__main{gap:28px}.report-header__project{font-size:32px}.report-header__suffix{font-size:16px}.report-header__metrics{gap:16px}.metadata-grid,.metrics--coverage,.metrics--summary,.metrics--economic,.metrics--first-request,.metrics--group,.metrics--window{grid-template-columns:repeat(2,minmax(0,1fr))}.comparison-grid{gap:18px}.week-ranges{grid-template-columns:1fr}h1{font-size:40px}.supporting-findings ul{grid-template-columns:1fr}}
@media(max-width:480px){main{padding:36px 20px 64px}.report-header{margin-bottom:24px}.report-header__main{grid-template-columns:1fr;gap:0}.report-header__primary{text-align:left;margin-top:16px}.report-header__value{font-size:36px}.report-header__project{font-size:30px}.report-header__suffix{font-size:14px}.report-header__metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 14px;margin-top:16px;padding:16px 0 17px}.report-header__metric{gap:5px}.report-header__metric-value .metric-main{font-size:18px}.report-header__metric-label{font-size:12px}h1{font-size:30px;letter-spacing:0}h2{font-size:22px}h3{font-size:16px;margin-top:24px}section{margin-bottom:40px}.metadata-grid{grid-template-columns:1fr;gap:16px}.metrics--coverage,.metrics--summary,.metrics--economic,.metrics--first-request,.metrics--group,.metrics--window{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.comparison-grid,.week-ranges{grid-template-columns:1fr;gap:16px}.ivory-group{padding:18px}.metrics--summary{margin-bottom:40px}.metrics--summary .metric-value{font-size:30px}.echart{height:260px}.kami-table{display:block;overflow-x:auto;white-space:nowrap}}
.tool-impact .coverage-note{color:var(--stone)}
.report-header{padding-bottom:40px;margin:0 0 48px}
.report-header__main{display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,.46fr);gap:32px;align-items:end}
.report-eyebrow{display:block;font-family:var(--sans);font-size:12px;font-weight:500;line-height:1.2;letter-spacing:1.2px;text-transform:uppercase;color:var(--stone);margin:0 0 18px}
.report-eyebrow__rule{display:none}
.report-header h1{display:flex;align-items:baseline;flex-wrap:nowrap;gap:10px;margin:0 0 14px;line-height:1.08;letter-spacing:0;white-space:nowrap;min-width:0}
.report-header__project{font-size:clamp(44px,5vw,64px);font-weight:500;color:var(--near-black);white-space:nowrap;letter-spacing:-.03em}
.report-header__suffix{font-size:20px;font-weight:400;color:var(--stone);white-space:nowrap;flex:0 0 auto;margin-left:0}
 .report-deck{max-width:820px;font-size:18px;line-height:1.5;color:var(--olive);margin:0;white-space:normal;letter-spacing:.3px}.report-overview-evidence{display:flex;flex-wrap:wrap;gap:5px 14px;margin-top:12px;color:var(--stone);font-size:12px;line-height:1.45}.report-overview-evidence__label{color:var(--brand);font-weight:500}.report-overview-evidence__item{overflow-wrap:anywhere}
.report-header__primary{display:grid;grid-template-columns:minmax(0,1fr);justify-items:end;align-content:end;gap:6px;justify-self:end;align-self:end;margin-top:32px;padding-top:0;text-align:right}
.report-header__value{font-size:36px;line-height:1.05;white-space:normal}
.report-header__primary-label,.report-header__primary-date{display:block;white-space:nowrap}
.report-header__primary-label{margin-top:0}
.report-header__primary-date{margin-top:0}
.report-header__metrics{grid-template-columns:repeat(4,minmax(0,1fr));gap:24px;margin-top:32px;padding:20px 0 0;border-top:1px solid var(--border);border-bottom:0}
.report-header__metric{white-space:normal}
main{padding:88px 64px 120px}
@media(max-width:880px){main{padding:64px 32px 88px}.report-header__project{font-size:clamp(32px,7.3vw,56px)}.report-header__suffix{font-size:18px}.report-header__metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 24px}.report-header__main{display:block;gap:0}.report-header__primary{justify-self:initial;justify-items:start;text-align:left}}
@media(max-width:480px){main{padding:48px 20px 64px}.report-header{padding-bottom:32px;margin-bottom:48px}.report-header h1{flex-wrap:wrap;white-space:normal;gap:6px}.report-header__project{font-size:clamp(26px,8.5vw,46px)}.report-header__suffix{font-size:16px;margin-left:6px}.report-deck{font-size:16px;line-height:1.55}.report-header__primary{display:block;margin-top:24px}.report-header__primary-label,.report-header__primary-date{display:block;margin-top:8px}.report-header__metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 14px;margin-top:24px;padding-top:16px}.report-header__metric{gap:5px}.report-header__metric-value .metric-main,.report-header__metric-value .percentage{font-size:18px}.report-header__metric-label{font-size:12px;line-height:1.4}}
.report-section,
section{margin-bottom:72px}
section > h2{font-size:32px;line-height:1.2;margin:0 0 24px;letter-spacing:0}
.section-num{display:block;margin:0 0 14px;color:var(--brand);font-family:var(--sans);font-size:12px;font-weight:500;line-height:1.3;letter-spacing:.08em}
section > h3{font-size:18px;line-height:1.3;margin:32px 0 14px}
.metadata-grid{gap:24px;margin-bottom:32px}
.metadata-grid div{padding:0 16px 14px 0;border-bottom:1px solid var(--border-soft)}
.metrics{gap:24px;margin-bottom:24px}
.metrics--summary{grid-template-columns:repeat(3,minmax(0,1fr));gap:32px 28px;margin-bottom:32px}
.metrics--summary,.metrics--first-request,.metrics--group{grid-template-rows:repeat(2,auto)}
.metrics--summary .metric,.metrics--first-request .metric,.metrics--group .metric{display:grid;grid-row:span 2;grid-template-rows:subgrid;align-content:start}
.metrics--coverage,.metrics--window{grid-template-columns:repeat(3,minmax(0,1fr))}
.metric-value{font-size:30px;line-height:1.05}
.metrics--summary .metric-value{font-size:36px}
.metrics--coverage .metric-value,.metrics--window .metric-value{font-size:30px}
.metric-label{font-size:12px;line-height:1.4}
.ivory-group{border-radius:8px;padding:24px;background:var(--ivory);box-shadow:none}
.comparison-grid{gap:24px;margin-top:24px}
.supporting-findings ul{gap:0 32px}
.editorial-item{padding:20px 0}
@media(max-width:880px){section{margin-bottom:54px}section > h2{font-size:28px}.metrics--coverage,.metrics--window{grid-template-columns:repeat(2,minmax(0,1fr))}.metrics--summary{grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.metrics--summary .metric-value{font-size:32px}}
@media(max-width:480px){section{margin-bottom:48px}section > h2{font-size:24px;margin-bottom:20px}section > h3{font-size:16px;margin:24px 0 12px}.metrics--coverage,.metrics--summary,.metrics--window{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.metrics--summary{margin-bottom:32px}.metrics--summary .metric-value,.metrics--coverage .metric-value,.metrics--window .metric-value{font-size:30px}.ivory-group{padding:20px}.chart-ivory{padding:20px}.editorial-item{padding:18px 0}}
html,body{overflow-x:clip}
.chart-ivory{padding:24px}.model-chart-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(260px,.85fr);gap:32px;align-items:center}.model-chart-grid .echart{min-width:0}
.kami-table th,.kami-table td{padding-top:10px;padding-bottom:10px}
.echart{max-width:100%;overflow:hidden}
.key-session-analysis-section{margin-top:72px}
.key-session-module-head{padding:28px 0 26px;border-bottom:.5px solid var(--border)}
.key-session-module-kicker{display:block;margin-bottom:10px;color:var(--stone);font-family:var(--sans);font-size:11px;font-weight:500;letter-spacing:.1em}
.key-session-module-head h2{margin:0 0 10px;font-size:32px;line-height:1.2}
.key-session-module-deck{max-width:68ch;margin:0;color:var(--olive);font-size:14px;line-height:1.5}
.key-session-privacy{margin:12px 0 0;color:var(--stone);font-size:12px;line-height:1.4}
.key-session-list{margin-top:26px}
.key-session-entry{margin:0;border-bottom:.5px solid var(--border);padding:0}
.key-session-entry>summary{display:flex;align-items:baseline;gap:20px;padding:17px 0;cursor:pointer;list-style:none;color:var(--dark-warm)}
.key-session-entry>summary::-webkit-details-marker{display:none}
.key-session-entry>summary::before{content:"＋";flex:0 0 16px;width:16px;color:var(--brand);font-size:15px;line-height:1}
.key-session-entry[open]>summary::before{content:"−"}
.key-session-summary{display:flex;justify-content:space-between;align-items:baseline;gap:20px;flex:1;min-width:0}
.session-summary-main{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px;min-width:0}
.session-summary-title{font-size:18px;line-height:1.4;font-weight:500}
.session-summary-id{color:var(--stone);font:12px/1.5 var(--mono);overflow-wrap:anywhere}
.key-session-entry>summary small{flex:0 0 auto;color:var(--stone);font-size:12px;font-weight:400}
.key-session-content{padding-bottom:6px}
.key-session-head{padding:28px 0 26px;border-bottom:.5px solid var(--border)}
.key-session-heading{display:grid;grid-template-columns:minmax(0,1fr) minmax(170px,.32fr);gap:32px;align-items:end}
.session-rank{display:block;margin-bottom:12px;color:var(--stone);font-family:var(--sans);font-size:12px;font-weight:500;letter-spacing:.08em}
.key-session-heading .session-title{margin:0 0 10px;font-size:18px;line-height:1.4;font-weight:500}
.key-session-heading .task-title{margin:0 0 6px;color:var(--olive);font-size:13px;line-height:1.45}
.key-session-heading .session-id{margin:0;color:var(--stone);font:12px/1.5 var(--mono);overflow-wrap:anywhere}
.session-total{justify-self:end;text-align:right}
.session-total strong{display:block;color:var(--brand);font-size:32px;font-weight:500;line-height:1;font-variant-numeric:lining-nums tabular-nums}
.session-total span{display:block;margin-top:7px;color:var(--olive);font-size:12px}
.key-session-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;margin-top:24px;padding-top:18px;border-top:.5px solid var(--border)}
.key-session-metric{min-width:0}
.key-session-metric-value{display:block;color:var(--brand);font-size:22px;line-height:1.1;font-variant-numeric:lining-nums tabular-nums}
.key-session-metric-label{display:block;margin-top:6px;color:var(--stone);font-size:12px;line-height:1.35}
.key-session-section{margin:48px 0 64px}
.key-session-section-head{display:grid;grid-template-columns:minmax(200px,.75fr) minmax(0,1.5fr);gap:32px;margin-bottom:24px}
.key-session-section-head h4{margin:0;color:var(--near-black);font-size:24px;font-weight:500;line-height:1.25}
.key-session-section-head p{max-width:66ch;margin:0;color:var(--olive);font-size:14px;line-height:1.5}
.key-session-judgment .judgment{border-top:.5px solid var(--border);border-bottom:.5px solid var(--border)}
.key-session-judgment .finding{max-width:82ch;padding:22px 0 24px}
.key-session-judgment .action{padding:22px 0 24px;border-top:.5px solid var(--border)}
.analysis-label{display:flex;align-items:baseline;gap:10px;margin-bottom:9px;color:var(--brand);font-family:var(--sans);font-size:11px;font-weight:500;letter-spacing:.08em}
.evidence-strength{color:var(--stone);font-size:11px;font-weight:400;letter-spacing:.02em}
.finding-lead{max-width:34ch;margin:0 0 16px;font-size:clamp(23px,3vw,30px);line-height:1.38}
.fact-line{margin:0 0 12px;color:var(--dark-warm)}
.fact-line strong{font-weight:500}
.quiet{margin:0;color:var(--olive);font-size:13px;line-height:1.5}
.key-session-judgment .action h4{max-width:38ch;margin:0 0 12px;font-size:20px;font-weight:500;line-height:1.35}
.action-copy{max-width:70ch;margin:0;color:var(--dark-warm)}
.applicability{margin:12px 0 0;color:var(--stone);font-size:13px}
.verify{max-width:78ch;margin:18px 0 0;padding-top:13px;border-top:.5px solid var(--border);color:var(--olive);font-size:13px;line-height:1.5}
.verify .analysis-label{display:inline;margin:0 10px 0 0;color:var(--stone);font-size:11px}
.analysis-unavailable{margin:0;color:var(--stone);font-size:14px;line-height:1.5}
.key-session-chart-frame{margin:0}
.key-session-chart-toolbar{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:14px 0 3px;color:var(--stone);font-size:12px}
.key-session-chart-toolbar strong{display:block;color:var(--dark-warm);font-size:14px;font-weight:500}
.key-session-chart-toolbar small{display:block;margin-top:3px;color:var(--stone);font-size:12px}
.key-session-legend{display:flex;flex-wrap:wrap;gap:14px;white-space:nowrap}
.key-session-legend span::before{content:"";display:inline-block;width:10px;height:10px;margin-right:6px;vertical-align:-1px;background:var(--chart-muted)}
.key-session-legend .hot::before{background:var(--brand)}
.key-session-legend .time::before{width:15px;height:2px;vertical-align:3px;background:var(--olive)}
.key-session-chart{height:390px}
.key-session-chart-note{margin:0;padding:0 0 16px;color:var(--olive);font-size:12px;line-height:1.45}
.key-session-chart-note strong{color:var(--dark-warm);font-weight:500}
.key-session-prompt-note{margin:0 0 16px;color:var(--stone);font-size:12px;line-height:1.4}
.key-session-appendix{min-width:0;max-width:100%;margin-top:20px;padding-top:4px;border-top:.5px solid var(--border);border-bottom:.5px solid var(--border);overflow:hidden}
.key-session-appendix>summary{display:flex;justify-content:space-between;gap:20px;padding:14px 0;cursor:pointer;color:var(--brand);font-size:14px;font-weight:500}
.key-session-appendix>summary small{color:var(--stone);font-size:12px;font-weight:400}
.key-session-appendix .table-scroll{width:100%;max-width:100%;overflow-x:auto;padding-bottom:8px}
.turn-detail-table{min-width:820px;font-size:12px}
.turn-detail-table .composition,.turn-detail-table .event{white-space:nowrap}
.turn-detail-table tr.hot-row{background:transparent}
.turn-detail-table tr.hot-row>th:first-child::before{content:"";display:inline-block;width:5px;height:5px;margin:0 7px 2px 0;border-radius:50%;background:var(--brand)}
.turn-detail-table tr.hot-row>th:first-child,.turn-detail-table tr.hot-row>td:nth-child(2),.turn-detail-table tr.hot-row>td:nth-child(3){font-weight:500}
.turn-number,.turn-token,.turn-share{font-variant-numeric:lining-nums tabular-nums}
.key-session-tooltip{min-width:270px;max-width:430px;color:var(--dark-warm);font-family:var(--serif);font-size:12px;line-height:1.5}
.key-session-tooltip-title{color:var(--near-black);font-size:18px;line-height:1.15}
.key-session-tooltip-grid{display:grid;grid-template-columns:auto minmax(0,1fr);gap:3px 14px;margin:10px 0 12px}
.key-session-tooltip-grid span{color:var(--stone)}
.key-session-tooltip-grid b{color:var(--dark-warm);font-weight:500}
.key-session-tooltip-prompt{padding-top:9px;border-top:.5px solid var(--border)}
.key-session-tooltip-label{margin-bottom:4px;color:var(--brand);font-family:var(--sans);font-size:11px;font-weight:500;letter-spacing:.06em}
.key-session-tooltip-text{white-space:pre-wrap;overflow-wrap:anywhere}
.key-session-tooltip-unavailable{color:var(--stone)}
@media(max-width:880px){.key-session-heading{grid-template-columns:1fr;gap:18px}.key-session-heading .session-total{justify-self:start;text-align:left}.key-session-section-head{grid-template-columns:1fr;gap:10px}}
@media(max-width:480px){.key-session-module-head h2{font-size:24px}.key-session-metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 16px}.key-session-chart-toolbar{display:block}.key-session-legend{margin-top:8px;white-space:normal}.key-session-chart{height:360px}.key-session-appendix>summary small{display:none}}
.primary-answer{margin:0 0 72px;padding:0 0 30px;border:0;break-inside:avoid}.primary-answer__head{margin-bottom:28px}.primary-answer__kicker{display:block;margin-bottom:10px;color:var(--stone);font-family:var(--sans);font-size:11px;font-weight:500;line-height:1.3;letter-spacing:.1em}.primary-answer__head h2{margin:0;font-size:36px;line-height:1.2}.primary-answer__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 32px}.primary-answer__item{min-width:0;padding:0 0 22px}.primary-answer__item h3{margin:0 0 10px;color:var(--stone);font-family:var(--sans);font-size:12px;font-weight:500;letter-spacing:.06em}.primary-answer__item p{max-width:66ch;margin:0;color:var(--dark-warm);font-size:15px;line-height:1.55}.primary-answer__destination{display:flex;flex-wrap:wrap;align-items:baseline;gap:7px 16px}.primary-answer__destination-name{font-size:21px;font-weight:500;line-height:1.35}.primary-answer__destination-value{color:var(--brand);font-size:30px;font-weight:500;line-height:1.1;white-space:nowrap}.primary-answer__destination-value .key-value{font-size:inherit}.primary-answer__destination-share{color:var(--olive);font-size:13px;white-space:nowrap}.primary-answer__observation{margin-bottom:8px!important;color:var(--olive)!important}.primary-answer__item--mechanism{grid-column:1 / -1;padding-top:4px;border-top:.5px solid var(--border)}.primary-answer__item--action{grid-column:1 / -1;padding-top:20px;border-top:.5px solid var(--border)}.primary-answer__action-title{font-size:18px!important;font-weight:500}.primary-answer__item--action p+p{margin-top:7px}.primary-answer__verification{padding-top:10px;color:var(--stone)!important;font-size:13px!important}.primary-answer__verification span{color:var(--olive)}.primary-answer__item--limitation{grid-column:1 / -1;padding-top:18px;border-top:.5px solid var(--border)}.primary-answer__item--limitation p{color:var(--stone);font-size:13px}.primary-answer__metric{font-size:inherit}@media(max-width:880px){.primary-answer{margin-bottom:54px}.primary-answer__grid{grid-template-columns:1fr;gap:0}.primary-answer__item--mechanism,.primary-answer__item--action,.primary-answer__item--limitation{grid-column:auto}}@media(max-width:480px){.primary-answer{margin-bottom:48px;padding:0 0 24px}.primary-answer__head{margin-bottom:22px}.primary-answer__head h2{font-size:28px}.primary-answer__grid{display:block}.primary-answer__destination-name{font-size:18px}.primary-answer__destination-value{font-size:26px}.primary-answer__item p{font-size:14px}.primary-answer__item--action,.primary-answer__item--limitation{padding-top:16px}}@media print{.primary-answer{break-inside:avoid}.primary-answer__item{break-inside:avoid}}
details > .kami-table{margin-top:16px}
@media(max-width:480px){.kami-table{display:block;width:max-content;min-width:100%;max-width:100%;overflow-x:auto;white-space:nowrap}.echart{height:260px}}
@media(max-width:880px){.model-chart-grid{grid-template-columns:1fr;gap:18px}}
@media(scripting:none){details > :not(summary){display:block}}
@media print{.echart{display:none}details > :not(summary){display:block}details > summary{display:none}.kami-table{display:table;width:100%;max-width:none;white-space:normal;overflow:visible}}
/* Kami visual repair: keep chapter markers, answer hierarchy, and print fallbacks distinct. */
@media(max-width:480px){.report-header__project{white-space:normal;overflow-wrap:anywhere}.report-header__suffix{white-space:normal;flex:0 1 auto}.report-header__metric{flex-direction:column;align-items:flex-start;gap:4px}.report-header__metric-label{white-space:normal;overflow-wrap:anywhere}.primary-answer{padding:0 0 24px}.primary-answer__head h2{font-size:28px}}
@media print{.report-stage--overview{break-inside:auto}.report-stage--overview>.section-num{break-after:avoid}.primary-answer{break-inside:auto}.primary-answer__grid{display:block}.primary-answer__item--destination{break-inside:auto}.chart-ivory{background:transparent;padding:0}.chart-ivory .key-session-chart-toolbar,.chart-ivory .key-session-prompt-note{display:none}main>section:last-of-type{margin-bottom:0}footer{break-inside:avoid;break-before:avoid;margin-top:0;padding-top:8px}}
/* Kami desktop report repair */
@media(min-width:881px){.metrics--count-1{grid-template-columns:minmax(0,1fr)}.metrics--count-2{grid-template-columns:repeat(2,minmax(0,1fr))}.metrics--count-4{grid-template-columns:repeat(4,minmax(0,1fr))}.metrics--count-5{grid-template-columns:repeat(5,minmax(0,1fr))}.primary-answer__grid{display:block}.primary-answer__item--destination{padding-bottom:0}.primary-answer__item--mechanism{padding-top:20px;border-top:0}.primary-answer__item--action{margin-top:8px;padding-top:24px;border-top:0}.primary-answer__item--limitation{margin-top:8px;padding-top:24px;border-top:0}.primary-answer__head h2{font-size:32px}section > h2{font-size:30px}.key-session-module-head h2{font-size:30px}.key-session-section-head h4{font-size:20px}.finding-lead{font-size:clamp(24px,2.2vw,26px)}}
/* Primary answer repair: use the available desktop measure and let spacing replace rules. */
.primary-answer__item p{max-width:none}
.primary-answer__item--mechanism{padding-top:20px;border-top:0}
.primary-answer__item--action{margin-top:8px;padding-top:24px;border-top:0}
.primary-answer__item--limitation{margin-top:8px;padding-top:24px;border-top:0}
@media(max-width:480px){.primary-answer__item--mechanism{padding-top:16px}.primary-answer__item--action,.primary-answer__item--limitation{margin-top:8px;padding-top:16px}}
/* Key session narrative repair: use the available measure for evidence and action copy. */
.key-session-judgment .finding,.key-session-judgment .finding-lead,.key-session-judgment .action h4,.key-session-judgment .action-copy,.key-session-judgment .verify{max-width:none}
/* Metric alignment repair: reserve a shared two-line label track before values. */
.metrics--coverage .metric,.metrics--economic .metric{display:grid;grid-template-rows:minmax(2.7em,auto) auto;align-content:start}
.metrics--coverage .metric-label,.metrics--economic .metric-label{line-height:1.35}
.metrics--economic.metrics--count-4{grid-template-columns:repeat(2,minmax(0,1fr))}
</style>`;
}
function renderHtml(result, locale = "en-US", composition, localFirstUserMessages) {
    const labels = labelsFor(locale);
    const prompts = result.view === "share" ? [] : localFirstUserMessages ?? composition?.firstUserMessages ?? [];
    const modelBars = result.rankings.models.map((row) => ({ key: modelLabel(row.key, locale), value: row.value }));
    const parts = [
        "<!doctype html><html lang=\"" + labels.htmlLang + "\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" +
            escapeHtml(labels.title) + "</title>" + renderStyles() + "</head><body><main>",
        renderReportHeader(result, locale, composition),
        "<div class=\"report-stage report-stage--overview\">" + renderSectionMarker(labels.sectionMarkers.overview) + renderPrimaryAnswer(result, locale, composition) + "</div>",
        "<section><h2>" + escapeHtml(labels.scope) + "</h2>" + renderScope(result, locale) + "<h2>" + escapeHtml(labels.coverage) + "</h2>" + renderCoverage(result, locale) + "<p class=\"report-method-note\">" + escapeHtml(labels.methodNote) + "</p></section>",
        renderKpis(result, locale),
        renderSectionMarker(labels.sectionMarkers.diagnosis),
        renderFindings(result, locale, composition),
        renderCacheHtml(result, locale),
        renderFirstRequestHtml(result, locale),
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
