"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeLocale = normalizeLocale;
exports.formatCompact = formatCompact;
exports.projectReport = projectReport;
exports.renderHtml = renderHtml;
exports.renderText = renderText;
exports.renderWeekText = renderWeekText;
exports.renderShare = renderShare;
const ZH = {
    title: "Agent Audit 诊断报告",
    scope: "审计范围",
    coverage: "覆盖情况",
    currentProject: "当前项目",
    allProjects: "所有项目",
    since: "起始时间",
    harness: "Harness",
    files: "文件",
    records: "记录",
    skipped: "跳过",
    partialSessions: "不完整 Session",
    totalTokens: "总 Token",
    sessions: "Session",
    modelCalls: "模型调用",
    reportedCost: "记录成本",
    topFinding: "主要 Finding",
    noFinding: "现有证据不支持明确的主要原因。",
    recommendation: "建议动作",
    time: "时间分布",
    dailyUsage: "每日 Token 组成",
    hourlyActivity: "小时活动热图",
    models: "模型分布",
    tools: "工具上下文影响",
    sessionsByUsage: "高用量 Session",
    limitations: "限制与缺失",
    provenance: "Provenance",
    privacy: "隐私与口径",
    unavailable: "不可用",
    exact: "精确值",
    tokens: "Token",
    share: "占比",
    calls: "调用",
    pairedResults: "配对结果",
    errors: "错误",
    injected: "注入估算",
    amplified: "放大估算",
    observedActivity: "本地观察到的滚动活动",
    localOnly: "仅表示本地历史中观察到的活动，不是 Provider 额度。",
    providerQuota: "Provider 额度",
    resetTime: "重置时间",
    input: "输入",
    cachedInput: "缓存读取",
    cacheWrite: "缓存写入",
    output: "输出",
    reasoning: "推理",
    date: "日期",
    model: "模型",
    session: "Session",
    kindLongSession: "长 Session",
    kindToolAmplification: "工具上下文放大",
    kindExtraCalls: "额外调用",
    reported: "已报告",
    derived: "推导",
    estimated: "估算",
    unavailableProvenance: "不可用",
    noData: "没有可展示的数据。",
    noTimestampData: "没有足够的可用时间戳，小时与滚动活动不可用。",
    noToolData: "没有可配对的工具结果，工具影响不可用。",
    noQuota: "没有来自该 Harness 的第一方额度数据。",
    privacyNote: "报告只保留安全元数据、大小、哈希、聚合和计算方法；不包含 prompt、源代码、回复、工具结果、参数、凭据或绝对路径。",
    methodNote: "估算值不是账单 Token；缺失值保持不可用。",
    usageView: "用量概览",
    windowView: "滚动窗口",
    toolsView: "工具分析",
    reportWritten: "本地 HTML 报告已生成。",
    weekView: "本周与上周",
    currentWeek: "本周",
    previousWeek: "上周",
    change: "变化",
    noComparison: "没有足够的完整数据进行周对比。",
    redactedShare: "脱敏分享稿",
};
const EN = {
    title: "Agent Audit diagnostic report",
    scope: "Audit scope",
    coverage: "Coverage",
    currentProject: "current project",
    allProjects: "all projects",
    since: "since",
    harness: "Harness",
    files: "files",
    records: "records",
    skipped: "skipped",
    partialSessions: "partial Sessions",
    totalTokens: "total tokens",
    sessions: "Sessions",
    modelCalls: "model calls",
    reportedCost: "reported cost",
    topFinding: "Top Finding",
    noFinding: "The available Evidence does not support a strong primary cause.",
    recommendation: "Recommended action",
    time: "Time distribution",
    dailyUsage: "Daily token composition",
    hourlyActivity: "Hourly activity heatmap",
    models: "Model distribution",
    tools: "Tool context impact",
    sessionsByUsage: "Heavy Sessions",
    limitations: "Limitations and missing data",
    provenance: "Provenance",
    privacy: "Privacy and methods",
    unavailable: "unavailable",
    exact: "exact value",
    tokens: "tokens",
    share: "share",
    calls: "calls",
    pairedResults: "paired results",
    errors: "errors",
    injected: "injected estimate",
    amplified: "amplified estimate",
    observedActivity: "Locally observed rolling activity",
    localOnly: "This is activity observed in local history, not Provider quota.",
    providerQuota: "Provider quota",
    resetTime: "reset time",
    input: "input",
    cachedInput: "cached input",
    cacheWrite: "cache write",
    output: "output",
    reasoning: "reasoning",
    date: "date",
    model: "model",
    session: "Session",
    kindLongSession: "long Session",
    kindToolAmplification: "tool context amplification",
    kindExtraCalls: "extra calls",
    reported: "reported",
    derived: "derived",
    estimated: "estimated",
    unavailableProvenance: "unavailable",
    noData: "No data is available for this panel.",
    noTimestampData: "There are not enough usable timestamps for hourly or rolling activity.",
    noToolData: "No paired tool results are available for tool impact.",
    noQuota: "No first-party quota data is available from this Harness.",
    privacyNote: "The report keeps safe metadata, sizes, hashes, aggregates, and methods; it excludes prompts, source, responses, tool results, arguments, credentials, and absolute paths.",
    methodNote: "Estimated values are not billed tokens; missing values remain unavailable.",
    usageView: "Usage overview",
    windowView: "Rolling window",
    toolsView: "Tool analysis",
    reportWritten: "Local HTML report generated.",
    weekView: "Current and previous week",
    currentWeek: "current week",
    previousWeek: "previous week",
    change: "change",
    noComparison: "There is not enough complete data for a week comparison.",
    redactedShare: "Redacted share",
};
function normalizeLocale(value) {
    return value && value.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}
function labelsFor(locale) {
    return locale === "zh-CN" ? ZH : EN;
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
    if (locale === "zh-CN" && absolute >= 100000000)
        return numberFormatter(locale).format(value / 100000000) + "亿";
    if (locale === "zh-CN" && absolute >= 10000)
        return numberFormatter(locale).format(value / 10000) + "万";
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
function formatDateKey(value, locale) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match)
        return value;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
    return new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
    }).format(date);
}
function formatDateTime(value, locale) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return value;
    return new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZoneName: "short",
    }).format(date);
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
function evidencePlain(value, locale, compact = true) {
    if (value.value === null)
        return labelsFor(locale).unavailable;
    const raw = typeof value.value === "number"
        ? compact ? formatCompact(value.value, locale) : formatExact(value.value, locale)
        : String(value.value);
    return (value.provenance === "estimated" ? "≈ " : "") + raw + " (" + provenanceLabel(value.provenance, locale) + ")";
}
function metricPlain(value, locale, compact = true) {
    if (value.value === null)
        return labelsFor(locale).unavailable;
    const raw = typeof value.value === "number"
        ? compact ? formatCompact(value.value, locale) : formatExact(value.value, locale)
        : String(value.value);
    return (value.provenance === "estimated" ? "≈ " : "") + raw;
}
function evidenceHtml(value, locale, compact = true) {
    const labels = labelsFor(locale);
    if (value.value === null) {
        return "<span class=\"metric-stack\" data-provenance=\"unavailable\"><span class=\"unavailable\">" + escapeHtml(labels.unavailable) + "</span></span>";
    }
    const compactValue = typeof value.value === "number" && compact ? formatCompact(value.value, locale) : formatExact(value.value, locale);
    const exactValue = formatExact(value.value, locale);
    const prefix = value.provenance === "estimated" ? "≈ " : "";
    const exact = typeof value.value === "number" && compact && compactValue !== exactValue
        ? "<small class=\"metric-exact\">" + escapeHtml(labels.exact + (locale === "zh-CN" ? "：" : ": ") + exactValue) + "</small>"
        : "";
    const estimate = value.provenance === "estimated"
        ? "<small class=\"estimate\">" + escapeHtml(labels.estimated) + "</small>"
        : "";
    return "<span class=\"metric-stack\" data-provenance=\"" + value.provenance + "\"><span class=\"metric-main\" title=\"" +
        escapeHtml(labels.exact + (locale === "zh-CN" ? "：" : ": ") + exactValue) + "\">" +
        escapeHtml(prefix + compactValue) + "</span>" + exact + estimate + "</span>";
}
function percentageHtml(value, locale) {
    const labels = labelsFor(locale);
    if (value.value === null)
        return evidenceHtml(value, locale, false);
    const prefix = value.provenance === "estimated" ? "≈ " : "";
    const estimate = value.provenance === "estimated"
        ? "<small class=\"estimate\">" + escapeHtml(labels.estimated) + "</small>"
        : "";
    return "<span class=\"metric-stack\" data-provenance=\"" + value.provenance + "\"><span class=\"percentage\">" +
        escapeHtml(prefix + formatExact(value.value, locale) + "%") + "</span>" + estimate + "</span>";
}
function publicLabel(value, fallback) {
    return value.length <= 80 && /^[A-Za-z0-9_.:@-]+$/.test(value) ? value : fallback;
}
function findingProjection(result, locale, labels) {
    const finding = result.topFinding;
    if (!finding)
        return null;
    const share = finding.evidence[2] && finding.evidence[2].value !== null
        ? percentageText(finding.evidence[2], locale)
        : labels.unavailable;
    if (finding.kind === "long_session") {
        return {
            kind: labels.kindLongSession,
            title: locale === "zh-CN"
                ? "长 Session 占已知用量的 " + share
                : "A long Session accounts for " + share + " of known usage",
            explanation: locale === "zh-CN"
                ? "一个包含多次模型调用的集中式 Session 是当前范围内最有力的贡献者；继续沿用同一上下文会让后续请求携带更多历史。"
                : "A concentrated multi-call Session is the strongest supported contributor in this scope; continuing the same context can make later requests carry more history.",
            recommendation: locale === "zh-CN"
                ? "在上下文继续增长前开启新的 Session，或拆分并收窄任务。"
                : "Start a fresh Session or split and narrow the task before the context grows further.",
        };
    }
    if (finding.kind === "tool_amplification") {
        return {
            kind: labels.kindToolAmplification,
            title: locale === "zh-CN"
                ? "工具结果造成约 " + metricPlain(finding.impact, locale) + " 的上下文放大"
                : "Tool results caused an estimated " + metricPlain(finding.impact, locale) + " of context amplification",
            explanation: locale === "zh-CN"
                ? "一个已配对的工具结果足够大，并在同一可观察活动上下文的后续模型调用中重复出现；这是估算值，不是账单 Token。"
                : "A paired tool result was large enough to be carried into later model calls in the same observable active context; this is an estimate, not billed tokens.",
            recommendation: locale === "zh-CN"
                ? "在让大型工具结果进入更多模型调用前，先摘要化或收窄结果。"
                : "Summarize or narrow large tool results before carrying them into more model calls.",
        };
    }
    return {
        kind: labels.kindExtraCalls,
        title: locale === "zh-CN" ? "观察到额外的重试、中断或子智能体调用" : "Extra retry, interruption, or subagent calls were observed",
        explanation: locale === "zh-CN"
            ? "生命周期记录显示模型调用周围发生了额外工作；历史不总能提供每次尝试的精确成本，因此该信号与 Token 总量分开呈现。"
            : "Lifecycle records show extra work around model calls; the history does not always expose exact attempt cost, so this signal stays separate from token totals.",
        recommendation: locale === "zh-CN"
            ? "先检查错误或重试原因，再重复同一个大任务。"
            : "Inspect the error or retry cause before repeating the same large task.",
    };
}
function projectReport(result, locale = "en-US") {
    const labels = labelsFor(locale);
    return { result, locale, labels, finding: findingProjection(result, locale, labels) };
}
function emptyState(labels, message = labels.noData) {
    return "<p class=\"empty\">" + escapeHtml(message) + "</p>";
}
function localizeWarning(warning, locale) {
    const unsupported = /^(\d+) Codex Session(?:s)? contain(?:s)? unsupported accounting records; only a partial audit is reported\.$/.exec(warning);
    if (unsupported) {
        return locale === "zh-CN"
            ? unsupported[1] + " 个 Codex Session 包含尚未支持的计量记录，报告可能不完整。"
            : unsupported[1] + " Codex Session" + (unsupported[1] === "1" ? "" : "s") + " contain unsupported accounting records; the audit may be partial.";
    }
    const missingTime = /^(\d+) Codex Session(?:s)? contain(?:s)? accounting records without a usable timestamp; only time-scoped records were analysed\.$/.exec(warning);
    if (missingTime) {
        return locale === "zh-CN"
            ? missingTime[1] + " 个 Codex Session 含有无法使用的时间戳；仅统计可确定时间范围的记录。"
            : missingTime[1] + " Codex Session" + (missingTime[1] === "1" ? "" : "s") + " contain records without usable timestamps; only time-scoped records were analysed.";
    }
    return warning;
}
function renderWarningList(result, locale) {
    const labels = labelsFor(locale);
    if (result.coverage.warnings.length === 0)
        return emptyState(labels);
    return "<ul class=\"warning-list\">" + result.coverage.warnings
        .map((warning) => "<li>" + escapeHtml(localizeWarning(warning, locale)) + "</li>")
        .join("") + "</ul>";
}
function renderCoverage(result, locale) {
    const labels = labelsFor(locale);
    const status = result.coverage.warnings.length === 0
        ? (locale === "zh-CN" ? "历史记录解析完成，未发现覆盖警告。" : "History parsed without coverage warnings.")
        : (locale === "zh-CN"
            ? result.coverage.partialSessions + " 个 Session 数据不完整，详情见“限制与缺失”。"
            : result.coverage.partialSessions + " Sessions are partial; see Limitations and missing data.");
    return "<div class=\"coverage-grid\">" +
        "<div><strong>" + result.coverage.filesRead + "</strong><span>" + escapeHtml(labels.files) + "</span></div>" +
        "<div><strong>" + result.coverage.recordsRead + "</strong><span>" + escapeHtml(labels.records) + "</span></div>" +
        "<div><strong>" + result.coverage.recordsSkipped + "</strong><span>" + escapeHtml(labels.skipped) + "</span></div>" +
        "<div><strong>" + result.coverage.partialSessions + "</strong><span>" + escapeHtml(labels.partialSessions) + "</span></div>" +
        "</div><p class=\"" + (result.coverage.warnings.length === 0 ? "ok" : "coverage-note") + "\">" + escapeHtml(status) + "</p>";
}
function renderScope(result, locale) {
    const labels = labelsFor(locale);
    return "<dl class=\"scope-grid\">" +
        "<div><dt>" + escapeHtml(labels.harness) + "</dt><dd>" + escapeHtml(result.scope.harness) + "</dd></div>" +
        "<div><dt>" + escapeHtml(labels.scope) + "</dt><dd>" + escapeHtml(result.scope.allProjects ? labels.allProjects : labels.currentProject) + "</dd></div>" +
        "<div><dt>" + escapeHtml(labels.since) + "</dt><dd>" + escapeHtml(formatDateTime(result.scope.since, locale)) + "</dd></div>" +
        "</dl>";
}
function renderKpis(result, locale) {
    const labels = labelsFor(locale);
    const items = [
        [labels.totalTokens, result.summary.totalTokens],
        [labels.sessions, result.summary.sessionCount],
        [labels.modelCalls, result.summary.modelCallCount],
        [labels.reportedCost, result.summary.reportedCost],
    ];
    return "<div class=\"kpis\">" + items.map(([label, value]) => "<div class=\"kpi\"><span>" + escapeHtml(label) + "</span><strong>" + evidenceHtml(value, locale) + "</strong></div>").join("") + "</div>";
}
function renderFinding(result, locale) {
    const projection = projectReport(result, locale);
    const labels = projection.labels;
    if (!projection.finding) {
        return "<section class=\"finding neutral\"><h2>" + escapeHtml(labels.topFinding) + "</h2><p>" + escapeHtml(labels.noFinding) + "</p></section>";
    }
    const finding = result.topFinding;
    const evidence = finding.evidence.map((value, index) => "<li>" +
        (finding.kind === "long_session" && index === 2 ? percentageHtml(value, locale) : evidenceHtml(value, locale)) +
        "</li>").join("");
    return "<section class=\"finding\"><div class=\"eyebrow\">" + escapeHtml(projection.finding.kind) + "</div>" +
        "<h2>" + escapeHtml(projection.finding.title) + "</h2>" +
        "<p>" + escapeHtml(projection.finding.explanation) + "</p>" +
        "<ul class=\"evidence\">" + evidence + "</ul>" +
        "<div class=\"recommendation\"><strong>" + escapeHtml(labels.recommendation) + "</strong><p>" + escapeHtml(projection.finding.recommendation) + "</p></div></section>";
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
    return (locale === "zh-CN" ? "未命名 Session" : "Untitled Session") + " · " + shortenedId(row.key);
}
function renderDaily(result, locale) {
    const labels = labelsFor(locale);
    const rows = result.report.dailyUsage;
    if (rows.length === 0)
        return emptyState(labels);
    return "<table><thead><tr><th>" + escapeHtml(labels.date) + "</th><th>" + escapeHtml(labels.totalTokens) + "</th><th>" + escapeHtml(labels.share) + "</th><th>" +
        escapeHtml(labels.input) + "</th><th>" + escapeHtml(labels.cachedInput) + "</th><th>" + escapeHtml(labels.output) + "</th><th>" + escapeHtml(labels.reasoning) + "</th></tr></thead><tbody>" +
        rows.map((row) => "<tr><th scope=\"row\">" + escapeHtml(formatDateKey(row.key, locale)) + "</th><td>" + tokenCell(row.totalTokens, locale) + "</td><td>" +
            percentageHtml(row.sharePercent, locale) + "</td><td>" + tokenCell(row.inputTokens, locale) + "</td><td>" + tokenCell(row.cachedInputTokens, locale) +
            "</td><td>" + tokenCell(row.outputTokens, locale) + "</td><td>" + tokenCell(row.reasoningTokens, locale) + "</td></tr>").join("") +
        "</tbody></table>";
}
function renderModels(result, locale) {
    const labels = labelsFor(locale);
    const rows = result.rankings.models;
    if (rows.length === 0)
        return emptyState(labels);
    return "<table><thead><tr><th>" + escapeHtml(labels.model) + "</th><th>" + escapeHtml(labels.tokens) + "</th><th>" + escapeHtml(labels.share) + "</th><th>" + escapeHtml(labels.calls) + "</th></tr></thead><tbody>" +
        rows.map((row) => "<tr><th scope=\"row\">" + escapeHtml(publicLabel(row.key, labels.unavailable)) + "</th><td>" + tokenCell(row.value, locale) +
            "</td><td>" + percentageHtml(row.sharePercent, locale) + "</td><td>" + tokenCell(row.count, locale) + "</td></tr>").join("") +
        "</tbody></table>";
}
function renderSessions(result, locale) {
    const labels = labelsFor(locale);
    const rows = result.rankings.sessions.slice(0, 10);
    if (rows.length === 0)
        return emptyState(labels);
    return "<table><thead><tr><th>" + escapeHtml(labels.session) + "</th><th>" + escapeHtml(labels.tokens) + "</th><th>" + escapeHtml(labels.share) + "</th><th>" + escapeHtml(labels.calls) + "</th></tr></thead><tbody>" +
        rows.map((row) => "<tr><th scope=\"row\">" + escapeHtml(sessionLabel(row, locale)) + "</th><td>" + tokenCell(row.value, locale) +
            "</td><td>" + percentageHtml(row.sharePercent, locale) + "</td><td>" + tokenCell(row.count, locale) + "</td></tr>").join("") +
        "</tbody></table>";
}
function renderTools(result, locale) {
    const labels = labelsFor(locale);
    const rows = result.report.tools;
    if (rows.length === 0)
        return emptyState(labels, labels.noToolData);
    return "<table><thead><tr><th>Tool</th><th>" + escapeHtml(labels.calls) + "</th><th>" + escapeHtml(labels.pairedResults) + "</th><th>" + escapeHtml(labels.errors) + "</th><th>" +
        escapeHtml(labels.injected) + "</th><th>" + escapeHtml(labels.amplified) + "</th><th>" + escapeHtml(labels.share) + "</th></tr></thead><tbody>" +
        rows.map((row) => "<tr><th scope=\"row\">" + escapeHtml(publicLabel(row.key, labels.unavailable)) + "</th><td>" + tokenCell(row.calls, locale) +
            "</td><td>" + tokenCell(row.pairedResults, locale) + "</td><td>" + tokenCell(row.errors, locale) + "</td><td>" + tokenCell(row.injectedTokens, locale) +
            "</td><td>" + tokenCell(row.amplifiedTokens, locale) + "</td><td>" + percentageHtml(row.sharePercent, locale) + "</td></tr>").join("") +
        "</tbody></table>";
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
        const dateLabel = formatDateKey(row.key, locale);
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
        dateLabel: formatDateKey(dateKey, locale),
        hour,
        timeLabel: formatDateTime(value, locale),
    };
}
function renderHourlyHeatmap(result, locale) {
    const labels = labelsFor(locale);
    const entries = result.report.hourlyActivity.flatMap((row) => {
        const local = localHour(row.key, locale);
        const value = numericValue(row.totalTokens);
        return local && value !== null ? [{ row, local, value }] : [];
    });
    if (entries.length === 0)
        return "";
    const dates = [...new Map(entries.map((entry) => [entry.local.dateKey, entry.local.dateLabel])).entries()].sort(([left], [right]) => left.localeCompare(right));
    const values = new Map(entries.map((entry) => [entry.local.dateKey + ":" + entry.local.hour, entry]));
    const max = Math.max(...entries.map((entry) => entry.value), 1);
    const width = 880;
    const cell = 26;
    const gridX = 155;
    const gridY = 34;
    const height = gridY + dates.length * cell + 35;
    const titleId = "chart-title-hourly";
    const parts = [
        "<svg class=\"chart hourly-heatmap\" role=\"img\" aria-labelledby=\"" + titleId + "\" viewBox=\"0 0 " + width + " " + height + "\">",
        "<title id=\"" + titleId + "\">" + escapeHtml(labels.hourlyActivity) + "</title>",
    ];
    for (let hour = 0; hour < 24; hour += 3) {
        parts.push("<text x=\"" + (gridX + hour * cell + 9) + "\" y=\"18\" text-anchor=\"middle\" class=\"heat-hour\">" + String(hour).padStart(2, "0") + "</text>");
    }
    dates.forEach(([dateKey, dateLabel], dateIndex) => {
        const y = gridY + dateIndex * cell;
        parts.push("<text x=\"140\" y=\"" + (y + 16) + "\" text-anchor=\"end\" class=\"chart-label\">" + escapeHtml(dateLabel) + "</text>");
        for (let hour = 0; hour < 24; hour++) {
            const entry = values.get(dateKey + ":" + hour);
            const level = entry ? Math.max(1, Math.min(4, Math.ceil((entry.value / max) * 4))) : 0;
            const description = entry
                ? dateLabel + " " + String(hour).padStart(2, "0") + ":00: " + metricPlain(entry.row.totalTokens, locale)
                : dateLabel + " " + String(hour).padStart(2, "0") + ":00: 0";
            parts.push("<rect x=\"" + (gridX + hour * cell) + "\" y=\"" + y + "\" width=\"21\" height=\"21\" rx=\"4\" class=\"heat-" + level + "\"><title>" + escapeHtml(description) + "</title></rect>");
        }
    });
    parts.push("<text x=\"" + gridX + "\" y=\"" + (height - 8) + "\" class=\"heat-hour\">" + escapeHtml(locale === "zh-CN" ? "本地时间" : "Local time") + "</text></svg>");
    return parts.join("");
}
function renderHourly(result, locale) {
    const labels = labelsFor(locale);
    const rows = result.report.hourlyActivity;
    if (!result.report.hourlySupported || rows.length === 0)
        return emptyState(labels, labels.noTimestampData);
    return renderHourlyHeatmap(result, locale) +
        "<details><summary>" + escapeHtml(locale === "zh-CN" ? "查看小时明细" : "View hourly details") + "</summary><table><thead><tr><th>" +
        escapeHtml(locale === "zh-CN" ? "本地时间" : "Local time") + "</th><th>" + escapeHtml(labels.tokens) + "</th><th>" + escapeHtml(labels.calls) + "</th><th>" + escapeHtml(labels.share) + "</th></tr></thead><tbody>" +
        rows.map((row) => "<tr><th scope=\"row\">" + escapeHtml(localHour(row.key, locale)?.timeLabel ?? row.key) + "</th><td>" + tokenCell(row.totalTokens, locale) + "</td><td>" +
            tokenCell(row.modelCallCount, locale) + "</td><td>" + percentageHtml(row.sharePercent, locale) + "</td></tr>").join("") + "</tbody></table></details>";
}
function renderRolling(result, locale) {
    const labels = labelsFor(locale);
    const rolling = result.report.rollingWindow;
    if (!rolling)
        return emptyState(labels, labels.noTimestampData);
    return "<div class=\"window-note\"><strong>" + escapeHtml(labels.localOnly) + "</strong><span>" + escapeHtml(formatDateTime(rolling.startAt, locale) + " → " + formatDateTime(rolling.endAt, locale)) + "</span></div>" +
        "<div class=\"window-grid\">" +
        "<div><span>" + escapeHtml(labels.calls) + "</span><strong>" + tokenCell(rolling.observedModelCallCount, locale) + "</strong></div>" +
        "<div><span>" + escapeHtml(labels.tokens) + "</span><strong>" + tokenCell(rolling.observedTokens, locale) + "</strong></div>" +
        "<div><span>5h peak</span><strong>" + tokenCell(rolling.historicalPeakObservedTokens, locale) + "</strong></div>" +
        "<div><span>" + escapeHtml(labels.providerQuota) + "</span><strong>" + tokenCell(rolling.providerQuota, locale) + "</strong></div>" +
        "<div><span>" + escapeHtml(labels.resetTime) + "</span><strong>" + tokenCell(rolling.resetAt, locale) + "</strong></div>" +
        "</div><p class=\"empty\">" + escapeHtml(labels.noQuota) + "</p>";
}
function renderWeekChanges(rows, heading, locale) {
    const labels = labelsFor(locale);
    if (rows.length === 0)
        return "<h3>" + escapeHtml(heading) + "</h3>" + emptyState(labels);
    return "<h3>" + escapeHtml(heading) + "</h3><table><thead><tr><th>Key</th><th>" + escapeHtml(labels.currentWeek) + "</th><th>" +
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
        "<table><thead><tr><th></th><th>" + escapeHtml(labels.currentWeek) + "</th><th>" + escapeHtml(labels.previousWeek) + "</th><th>" + escapeHtml(labels.change) + "</th></tr></thead><tbody>" +
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
function renderStyles() {
    return "<style>" +
        ":root{color-scheme:light;--ink:#27231f;--muted:#766d64;--line:#e6ddd4;--paper:#fffdf9;--bg:#f2eee8;--accent:#b76448;--accent-soft:#f5e0d7;--ok:#3c725c}" +
        "*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif}" +
        "main{max-width:1060px;margin:0 auto;padding:38px 24px 64px}header{margin-bottom:28px}h1{font-size:32px;line-height:1.1;margin:0 0 12px;letter-spacing:-.03em}h2{font-size:19px;margin:0 0 14px}h3{font-size:16px;margin:24px 0 12px}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:var(--accent);font-weight:700}section{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:22px;margin:16px 0;box-shadow:0 6px 22px rgba(53,38,25,.04)}.scope-grid,.coverage-grid,.kpis,.window-grid,.week-ranges{display:grid;gap:12px}.scope-grid{grid-template-columns:repeat(3,1fr);margin:0}.scope-grid div{background:#faf7f2;border-radius:10px;padding:12px}.scope-grid dt{color:var(--muted);font-size:12px}.scope-grid dd{margin:4px 0 0;font-weight:650;overflow-wrap:anywhere}.coverage-grid{grid-template-columns:repeat(4,1fr);margin-bottom:14px}.coverage-grid div,.window-grid div{padding:12px;border:1px solid var(--line);border-radius:10px}.coverage-grid strong,.coverage-grid span,.window-grid strong,.window-grid span{display:block}.coverage-grid strong{font-size:20px}.coverage-grid span,.window-grid span{color:var(--muted);font-size:12px}.warning-list{margin:10px 0 0;padding-left:20px}.coverage-note{color:var(--muted)}.ok{color:var(--ok)}.kpis{grid-template-columns:repeat(4,1fr)}.kpi{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:16px}.kpi>span{display:block;color:var(--muted);font-size:12px}.kpi strong{display:block;font-size:22px;line-height:1.2;margin-top:6px;font-variant-numeric:tabular-nums}.metric-stack{display:inline-flex;flex-direction:column;align-items:flex-start;gap:2px;font-variant-numeric:tabular-nums}.metric-main{display:block}.metric-exact,.estimate{display:block;color:var(--muted);font-size:11px;font-weight:400;line-height:1.3}.percentage{display:block;white-space:nowrap}.unavailable{color:var(--muted);font-style:italic}.finding{border-color:#e8c4b5;background:linear-gradient(135deg,#fffdf9,#fff5ef)}.finding.neutral{border-color:var(--line)}.finding h2{font-size:23px;max-width:800px}.finding p{max-width:820px}.evidence{display:flex;flex-wrap:wrap;gap:9px;list-style:none;padding:0;margin:18px 0}.evidence li{background:var(--accent-soft);border-radius:9px;padding:8px 10px}.recommendation{border-top:1px solid #e8c4b5;padding-top:12px}.recommendation strong{color:var(--accent)}.recommendation p{margin:4px 0 0;font-weight:650}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{text-align:left;border-bottom:1px solid var(--line);padding:10px 8px;vertical-align:top}thead th{color:var(--muted);font-size:12px;font-weight:650}tbody th{font-weight:650}tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}.empty{color:var(--muted);margin:8px 0}.chart{display:block;width:100%;height:auto;margin:0 0 20px;background:#faf7f2;border-radius:12px;padding:10px;overflow:visible}.chart-label,.chart-value,.heat-hour{font:12px system-ui,sans-serif;fill:var(--muted)}.chart-value{font-variant-numeric:tabular-nums;fill:var(--ink)}.chart-bar{fill:var(--accent)}.chart-track{fill:#ece6df}.segment-input{fill:#b76448}.segment-cached{fill:#d99a78}.segment-cache-write{fill:#8b7667}.segment-output{fill:#557c70}.segment-reasoning{fill:#8d6a9f}.heat-0{fill:#ebe5de}.heat-1{fill:#edd7ca}.heat-2{fill:#dda98d}.heat-3{fill:#c67f5e}.heat-4{fill:#9f4f36}details{border-top:1px solid var(--line);padding-top:12px}summary{cursor:pointer;color:var(--accent);font-weight:650;margin-bottom:10px}.window-note{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;background:#f7f1e7;border-radius:10px;padding:12px;margin-bottom:12px}.window-note span,.week-ranges span{color:var(--muted);font-size:12px}.window-grid{grid-template-columns:repeat(5,1fr)}.window-grid strong{margin-top:5px}.week-ranges{grid-template-columns:repeat(2,1fr);margin-bottom:16px}.week-ranges div{background:#faf7f2;border-radius:10px;padding:12px}.week-ranges strong,.week-ranges span{display:block}footer{color:var(--muted);font-size:12px;border-top:1px solid var(--line);margin-top:26px;padding-top:16px}footer p{margin:5px 0}@media(max-width:760px){main{padding:24px 14px}.scope-grid,.kpis,.coverage-grid,.window-grid,.week-ranges{grid-template-columns:1fr 1fr}table{display:block;overflow-x:auto;white-space:nowrap}.finding h2{font-size:20px}}@media(max-width:480px){.scope-grid,.kpis,.coverage-grid,.window-grid,.week-ranges{grid-template-columns:1fr}}" +
        "</style>";
}
function renderHtml(result, locale = "en-US") {
    const projection = projectReport(result, locale);
    const labels = projection.labels;
    const modelBars = result.rankings.models.map((row) => ({ key: publicLabel(row.key, labels.unavailable), value: row.value }));
    const parts = [
        "<!doctype html><html lang=\"" + (locale === "zh-CN" ? "zh-CN" : "en") + "\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" +
            escapeHtml(labels.title) + "</title>" + renderStyles() + "</head><body><main>",
        "<header><div class=\"eyebrow\">Agent Audit</div><h1>" + escapeHtml(labels.title) + "</h1><p>" + escapeHtml(labels.methodNote) + "</p></header>",
        "<section><h2>" + escapeHtml(labels.scope) + "</h2>" + renderScope(result, locale) + "<h2>" + escapeHtml(labels.coverage) + "</h2>" + renderCoverage(result, locale) + "</section>",
        renderKpis(result, locale),
        renderFinding(result, locale),
        result.weekComparison ? "<section><h2>" + escapeHtml(labels.weekView) + "</h2>" + renderWeek(result, locale) + "</section>" : "",
        "<section><h2>" + escapeHtml(labels.time) + "</h2><h3>" + escapeHtml(labels.dailyUsage) + "</h3>" +
            renderDailyComposition(result, locale) + renderDaily(result, locale) +
            "<h3>" + escapeHtml(labels.hourlyActivity) + "</h3>" + renderHourly(result, locale) +
            "<h3>" + escapeHtml(labels.observedActivity) + "</h3>" + renderRolling(result, locale) + "</section>",
        "<section><h2>" + escapeHtml(labels.models) + "</h2>" + renderBarSvg(labels.models, modelBars, locale, "models") + renderModels(result, locale) + "</section>",
        "<section><h2>" + escapeHtml(labels.tools) + "</h2>" + renderTools(result, locale) + "</section>",
        "<section><h2>" + escapeHtml(labels.sessionsByUsage) + "</h2>" + renderSessions(result, locale) + "</section>",
        "<section><h2>" + escapeHtml(labels.limitations) + "</h2><p>" + escapeHtml(labels.methodNote) + "</p>" +
            renderWarningList(result, locale) + "</section>",
        "<footer><strong>" + escapeHtml(labels.provenance) + "</strong><p>" + escapeHtml(labels.reported + " = source value; " + labels.derived + " = calculated from records; " + labels.estimated + " = approximation; " + labels.unavailableProvenance + " = missing source data.") + "</p>" +
            "<strong>" + escapeHtml(labels.privacy) + "</strong><p>" + escapeHtml(labels.privacyNote) + "</p></footer>",
        "</main></body></html>",
    ];
    return parts.join("");
}
function renderTopLine(result, locale) {
    const projection = projectReport(result, locale);
    const labels = projection.labels;
    const lines = [];
    if (projection.finding) {
        lines.push(projection.finding.kind + ": " + projection.finding.title);
        lines.push(labels.recommendation + ": " + projection.finding.recommendation);
    }
    else {
        lines.push(labels.topFinding + ": " + labels.noFinding);
    }
    lines.push("Audit: " + result.scope.harness + "; " + (result.scope.allProjects ? labels.allProjects : labels.currentProject) + "; " + labels.since + " " + formatDateTime(result.scope.since, locale));
    lines.push(labels.coverage + ": " + result.coverage.filesRead + " " + labels.files + ", " + result.coverage.recordsRead + " " + labels.records + ", " + result.coverage.recordsSkipped + " " + labels.skipped + ", " + result.coverage.partialSessions + " " + labels.partialSessions + ".");
    lines.push(labels.totalTokens + ": " + evidencePlain(result.summary.totalTokens, locale) + "; " + labels.sessions + ": " + evidencePlain(result.summary.sessionCount, locale, false) + "; " + labels.modelCalls + ": " + evidencePlain(result.summary.modelCallCount, locale, false) + ".");
    return lines;
}
function percentageText(value, locale) {
    return value.value === null ? labelsFor(locale).unavailable : formatExact(value.value, locale) + "%";
}
function renderText(result, locale = "en-US", view = "full") {
    const labels = labelsFor(locale);
    if (view === "window") {
        const rolling = result.report.rollingWindow;
        const lines = [labels.windowView + " — " + (rolling ? labels.localOnly : labels.noTimestampData)];
        if (rolling) {
            lines.push(labels.calls + ": " + evidencePlain(rolling.observedModelCallCount, locale, false) + "; " + labels.tokens + ": " + evidencePlain(rolling.observedTokens, locale) + ".");
            lines.push(labels.providerQuota + ": " + evidencePlain(rolling.providerQuota, locale) + "; " + labels.resetTime + ": " + evidencePlain(rolling.resetAt, locale) + ".");
        }
        return lines.join("\n") + "\n";
    }
    if (view === "tools") {
        const lines = [labels.toolsView];
        if (result.report.tools.length === 0)
            lines.push(labels.noToolData);
        for (const tool of result.report.tools.slice(0, 10)) {
            lines.push(publicLabel(tool.key, labels.unavailable) + ": " + labels.calls + " " + evidencePlain(tool.calls, locale, false) +
                "; " + labels.amplified + " " + evidencePlain(tool.amplifiedTokens, locale) + "; " + labels.share + " " + percentageText(tool.sharePercent, locale) + ".");
        }
        return lines.join("\n") + "\n";
    }
    if (view === "usage") {
        const lines = [labels.usageView, ...renderTopLine(result, locale)];
        const model = result.rankings.models.slice(0, 5).map((entry) => publicLabel(entry.key, labels.unavailable) + " " + evidencePlain(entry.value, locale) + " / " + percentageText(entry.sharePercent, locale)).join(", ");
        if (model)
            lines.push(labels.models + ": " + model + ".");
        const session = result.rankings.sessions[0];
        if (session)
            lines.push(labels.sessionsByUsage + ": " + sessionLabel(session, locale) + " — " + evidencePlain(session.value, locale) + ".");
        return lines.join("\n") + "\n";
    }
    const lines = renderTopLine(result, locale);
    const topSession = result.rankings.sessions[0];
    if (topSession) {
        lines.push((locale === "zh-CN" ? "主要 Session" : "Top Session") + ": " + sessionLabel(topSession, locale) +
            "; " + evidencePlain(topSession.value, locale, false) + "; " + (locale === "zh-CN" ? "占比" : "share") + ": " +
            percentageText(topSession.sharePercent, locale) + ".");
    }
    const modelSummary = result.rankings.models.slice(0, 5)
        .map((entry) => publicLabel(entry.key, labels.unavailable) + ": " + formatExact(entry.value.value, locale) + " " + labels.tokens + " (" + percentageText(entry.sharePercent, locale) + ")")
        .join(", ");
    if (modelSummary)
        lines.push((locale === "zh-CN" ? labels.models : "Models") + ": " + modelSummary + ".");
    if (result.topFinding) {
        const projection = projectReport(result, locale);
        lines.push((locale === "zh-CN" ? "主要 Finding" : "Top finding") + ": " + result.topFinding.kind + " — " + (projection.finding?.title ?? labels.noFinding));
    }
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
        labels.currentWeek + ": " + formatDateTime(comparison.currentFrom, locale) + " → " + formatDateTime(comparison.currentTo, locale),
        labels.previousWeek + ": " + formatDateTime(comparison.previousFrom, locale) + " → " + formatDateTime(comparison.previousTo, locale),
        labels.totalTokens + ": " + evidencePlain(current.summary.totalTokens, locale) + " vs " + evidencePlain(previous.summary.totalTokens, locale) + "; " + labels.change + ": " + evidencePlain(comparison.changes.totalTokens, locale) + ".",
        labels.modelCalls + ": " + evidencePlain(current.summary.modelCallCount, locale, false) + " vs " + evidencePlain(previous.summary.modelCallCount, locale, false) + "; " + labels.change + ": " + evidencePlain(comparison.changes.modelCallCount, locale, false) + ".",
    ].join("\n") + "\n";
}
function redactedModelKey(row) {
    return publicLabel(row.key, "other-model");
}
function renderShare(result, locale = "en-US") {
    const labels = labelsFor(locale);
    const lines = [
        "# " + labels.redactedShare,
        "",
        "- " + labels.harness + ": " + result.scope.harness,
        "- " + labels.scope + ": " + (result.scope.allProjects ? labels.allProjects : labels.currentProject),
        "- " + labels.since + ": " + formatDateTime(result.scope.since, locale),
        "- " + labels.totalTokens + ": " + evidencePlain(result.summary.totalTokens, locale, false),
        "- " + labels.sessions + ": " + evidencePlain(result.summary.sessionCount, locale, false),
        "- " + labels.modelCalls + ": " + evidencePlain(result.summary.modelCallCount, locale, false),
        "",
        "## " + labels.models,
        "",
        "| " + labels.model + " | " + labels.tokens + " | " + labels.share + " |",
        "| --- | ---: | ---: |",
    ];
    for (const row of result.rankings.models)
        lines.push("| " + redactedModelKey(row) + " | " + evidencePlain(row.value, locale, false) + " | " + percentageText(row.sharePercent, locale) + " |");
    lines.push("", "## " + labels.time, "", "| " + labels.date + " | " + labels.tokens + " | " + labels.share + " |", "| --- | ---: | ---: |");
    for (const row of result.report.dailyUsage)
        lines.push("| " + formatDateKey(row.key, locale) + " | " + evidencePlain(row.totalTokens, locale, false) + " | " + percentageText(row.sharePercent, locale) + " |");
    lines.push("", "## " + labels.tools, "", "| Tool category | " + labels.calls + " | " + labels.amplified + " | " + labels.share + " |", "| --- | ---: | ---: |");
    for (const row of result.report.tools)
        lines.push("| " + publicLabel(row.key, "other-tool") + " | " + evidencePlain(row.calls, locale, false) + " | " + evidencePlain(row.amplifiedTokens, locale, false) + " | " + percentageText(row.sharePercent, locale) + " |");
    lines.push("", "## " + labels.topFinding, "", projectReport(result, locale).finding?.title ?? labels.noFinding, "", labels.methodNote, labels.privacyNote);
    return lines.join("\n") + "\n";
}
