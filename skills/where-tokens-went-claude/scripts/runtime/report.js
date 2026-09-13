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
const ZH = {
    title: "where-tokens-went 诊断报告",
    scope: "审计范围",
    coverage: "覆盖情况",
    currentProject: "当前项目",
    allProjects: "所有项目",
    since: "起始时间",
    harness: "Harness",
    files: "文件",
    records: "记录",
    skipped: "跳过",
    warnings: "覆盖异常·警告级",
    partialSessions: "不完整 Session",
    totalTokens: "总 Token",
    sessions: "Session",
    topLevelSessions: "顶层任务",
    subagentSessions: "子 Agent Session",
    modelCalls: "模型调用",
    reportedCost: "记录成本",
    noFinding: "现有证据不足以确定主要原因。",
    time: "时间分布",
    dailyUsage: "每日 Token 趋势",
    hourlyActivity: "小时活动热图",
    models: "模型分布",
    tools: "工具上下文影响",
    toolImpactNote: "注入估算表示工具结果被算入上下文的大小；后续暴露估算（无上限）表示同一段对话中，后续调用可能再次带上的上下文量。这个估算不是账单，也不是真实新增 Token，不能与总 Token 相加。",
    sessionsByUsage: "高用量 Session",
    limitations: "限制与缺失",
    provenance: "证据来源",
    privacy: "隐私说明与统计方法",
    unavailable: "无数据",
    exact: "精确值",
    tokens: "Token",
    share: "占比",
    calls: "调用",
    pairedResults: "配对结果",
    errors: "错误",
    injected: "工具结果注入量（估算）",
    amplified: "后续暴露估算（无上限）",
    characters: "字符",
    latestWindowTokens: "最近 5 小时 Token",
    historicalPeakTokens: "所选范围内最高滚动 5 小时 Token",
    observedActivity: "最近一段时间的本地活动",
    localOnly: "只表示本地历史中观察到的活动，不是该工具官方提供的额度。",
    providerQuota: "Provider 额度",
    resetTime: "重置时间",
    input: "普通输入",
    cachedInput: "缓存读取",
    cacheWrite: "缓存写入",
    output: "输出",
    reasoning: "推理",
    date: "日期",
    model: "模型",
    session: "Session",
    kindLongSession: "长 Session",
    kindToolAmplification: "工具结果后续暴露",
    kindExtraCalls: "额外调用",
    reported: "记录值",
    derived: "计算值",
    estimated: "估算值",
    unavailableProvenance: "无数据",
    noData: "没有可展示的数据。",
    noTimestampData: "可用时间戳不足，无法显示小时和最近一段时间的活动。",
    noToolData: "没有找到可配对的工具结果，无法分析工具影响。",
    noQuota: "没有该工具官方提供的额度数据。",
    checksNote: "这些发现由规则自动生成；Host Agent 会结合你的问题和完整证据，在对话中给出综合判断。",
    diagnosticSignals: "发现",
    privacyNote: "报告只保留脱敏后的元数据、大小、哈希、聚合结果和计算方法；不包含 prompt、源代码、回复、工具结果、参数、凭据或绝对路径。",
    methodNote: "估算值仅作参考，不代表实际账单；“—”表示暂时没有数据。",
    usageView: "用量概览",
    windowView: "滚动窗口",
    toolsView: "工具分析",
    reportWritten: "本地 HTML 报告生成完成。",
    weekView: "本周与上周",
    currentWeek: "本周",
    previousWeek: "上周",
    change: "变化",
    noComparison: "完整数据不足，无法进行周对比。",
    redactedShare: "脱敏分享稿",
    cacheEconomics: "缓存经济性",
    cacheReadRate: "缓存读取率",
    cacheWriteRate: "缓存写入率",
    cacheCoverage: "缓存构成可分解比例",
    cacheSavings: "缓存带来的估算节省",
    cacheSavingsPercent: "估算节省比例",
    observedApiCost: "已观测的 API 折算金额",
    allUncachedApiCost: "不缓存情况下的 API 折算金额",
    priceCoverage: "已定价用量占比",
    firstRequestBurden: "首次请求 Token 量",
    firstRequestMedian: "首次请求 Token 中位数",
    firstRequestShare: "首次请求 Token 占比",
    firstRequestCoverage: "首次请求完整度",
    firstRequestCompositionCoverage: "首次请求 Token 构成完整度",
    coldFirstRequestRate: "首次请求未命中缓存的比例",
    identityCoverage: "Session 身份可信度",
    skillEvidence: "Skill 使用证据",
    skillState: "状态",
    availableSessions: "可用 Session",
    invocationCount: "调用次数",
    skillSessions: "调用 Session",
    observedFrom: "首次观察",
    observedTo: "最近观察",
    attributedTokens: "可追溯到该 Skill 的 Token",
    attributedCost: "可追溯到该 Skill 的 API 成本",
    evidenceCoverage: "有据可查比例",
    directResourceFootprint: "直接调用记录",
    observedAssociation: "时间上相关（ModelCall）",
    causalImpact: "有因果证明",
    noSkillEvidence: "所选历史中没有足够证据确认 Skill 列表、调用或资源使用情况。",
    turn: "轮次",
    activeTime: "本轮耗时",
    driver: "主要驱动",
    evidenceCompleteness: "证据完整度",
    turnTrajectory: "轮次轨迹",
    keySessionAnalysis: "关键 Session 分析",
    taskContext: "Session 摘要",
    primaryFinding: "核心判断",
    evidenceChain: "证据链",
    improvementAction: "改善提议",
    verificationMethod: "如何验证",
    interpretation: "AI 解读",
    proposal: "改善提议",
    analysisUnavailable: "关键 Session 分析不可用：",
    noStrongEvidence: "未发现需要优先处理的问题。",
    roundCount: "轮次",
    totalDuration: "总耗时",
    roundDuration: "本轮耗时",
    processEvents: "过程事件",
    resultSize: "结果大小",
    toolCalls: "工具调用",
    sessionToken: "Session Token",
    firstUserMessage: "第一条真实用户消息",
    chartHint: "点击或悬停数据点，查看完整真实 Prompt",
    noUserMessage: "日志未记录本轮独立的用户消息",
    allRoundDetails: "查看全部",
    detailNote: "审计附录 · 默认折叠 · 缺失值保留为 —",
    moduleDeck: "从 Token 排名进入单个 Session，按轮次追踪消耗集中、过程事件与真实用户消息。",
    trajectoryIntro: "柱形表示 Token 占比，折线表示本轮耗时。深色高点可直接点按或悬停；同一个 Tooltip 先给出证据，再显示该轮第一条真实用户消息。",
    noTrajectory: "没有可用的轮次证据。",
};
const EN = {
    title: "where-tokens-went diagnostic report",
    scope: "Audit scope",
    coverage: "Coverage",
    currentProject: "current project",
    allProjects: "all projects",
    since: "since",
    harness: "Harness",
    files: "files",
    records: "records",
    skipped: "skipped",
    warnings: "coverage warnings",
    partialSessions: "partial Sessions",
    totalTokens: "total tokens",
    sessions: "Sessions",
    topLevelSessions: "top-level tasks",
    subagentSessions: "subagent Sessions",
    modelCalls: "model calls",
    reportedCost: "reported cost",
    noFinding: "The available Evidence does not support a strong primary cause.",
    time: "Time distribution",
    dailyUsage: "Daily token trend",
    hourlyActivity: "Hourly activity heatmap",
    models: "Model distribution",
    tools: "Tool context impact",
    toolImpactNote: "The injected estimate is the tool-result size added to context; the carry-forward estimate is an uncapped exposure heuristic for how much it may be carried by later calls in the same active context. It is not a bill, actual new Token usage, or additive to total tokens.",
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
    amplified: "carry-forward estimate (uncapped)",
    characters: "characters",
    latestWindowTokens: "Latest 5h tokens",
    historicalPeakTokens: "Highest rolling 5h in selected range",
    observedActivity: "Locally observed rolling activity",
    localOnly: "This is activity observed in local history, not Provider quota.",
    providerQuota: "Provider quota",
    resetTime: "reset time",
    input: "ordinary input",
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
    checksNote: "These are automated findings; the Host Agent provides a synthesis for your question in conversation.",
    diagnosticSignals: "Findings",
    privacyNote: "The report keeps safe metadata, sizes, hashes, aggregates, and methods; it excludes prompts, source, responses, tool results, arguments, credentials, and absolute paths.",
    methodNote: "Estimated values are for reference only and do not represent an actual bill; “—” means data is unavailable.",
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
    cacheEconomics: "Cache economics",
    cacheReadRate: "cache-read rate",
    cacheWriteRate: "cache-write rate",
    cacheCoverage: "cache composition coverage",
    cacheSavings: "estimated cache savings",
    cacheSavingsPercent: "estimated cache savings percentage",
    observedApiCost: "observed API-equivalent cost",
    allUncachedApiCost: "all-uncached counterfactual cost",
    priceCoverage: "priced Usage coverage",
    firstRequestBurden: "First-request burden",
    firstRequestMedian: "median first request (Tokens)",
    firstRequestShare: "first-request Usage share",
    firstRequestCoverage: "first-request coverage",
    firstRequestCompositionCoverage: "first-request composition coverage",
    coldFirstRequestRate: "cold first-request rate",
    identityCoverage: "Session identity coverage",
    skillEvidence: "Skill evidence",
    skillState: "state",
    availableSessions: "available Sessions",
    invocationCount: "invocations",
    skillSessions: "invocation Sessions",
    observedFrom: "first observed",
    observedTo: "last observed",
    attributedTokens: "attributed tokens",
    attributedCost: "attributed API cost",
    evidenceCoverage: "Evidence coverage",
    directResourceFootprint: "direct resource evidence",
    observedAssociation: "associated ModelCalls",
    causalImpact: "causal impact",
    noSkillEvidence: "The selected history has no verifiable Skill listing, invocation, or resource-use evidence.",
    turn: "Rounds",
    activeTime: "round duration",
    driver: "main driver",
    evidenceCompleteness: "Evidence completeness",
    turnTrajectory: "Round Token trajectory",
    keySessionAnalysis: "Key Session Analysis",
    taskContext: "Session summary",
    primaryFinding: "Core judgment",
    evidenceChain: "Evidence chain",
    improvementAction: "Improvement proposal",
    verificationMethod: "How to verify",
    interpretation: "Host Agent interpretation",
    proposal: "Improvement proposal",
    analysisUnavailable: "Key Session Analysis unavailable: ",
    noStrongEvidence: "No Evidence supports a strong primary problem.",
    roundCount: "rounds",
    totalDuration: "total duration",
    roundDuration: "round duration",
    processEvents: "process events",
    resultSize: "result size",
    toolCalls: "tool calls",
    sessionToken: "Session Tokens",
    firstUserMessage: "first real user message",
    chartHint: "Click or hover a point to inspect the complete real Prompt",
    noUserMessage: "No independent user message was recorded for this round",
    allRoundDetails: "View all",
    detailNote: "Audit appendix · collapsed by default · missing values remain —",
    moduleDeck: "Enter a single Session from the Token ranking and follow concentration, process events, and real user messages by round.",
    trajectoryIntro: "Bars show Token share and the line shows round duration. Dark points mark hotspots; the same Tooltip gives evidence first, then the round's first real user message.",
    noTrajectory: "No round Evidence is available.",
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
    const parts = new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN-u-nu-latn" : "en-US-u-nu-latn", {
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
    return provenance === "estimated" ? (locale === "zh-CN" ? "约 " : "about ") : "";
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
    return labels.provenance + (locale === "zh-CN" ? "：" : ": ") + provenanceLabel(value.provenance, locale);
}
function provenanceSeparator(locale) {
    return locale === "zh-CN" ? "；" : "; ";
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
    const title = labels.exact + (locale === "zh-CN" ? "：" : ": ") + (currency ? usdText(exactValue) : exactValue) + provenanceSeparator(locale) + provenanceTitle(value, locale);
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
    const title = labels.exact + (locale === "zh-CN" ? "：" : ": ") + exactValue + provenanceSeparator(locale) + provenanceTitle(value, locale);
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
    const title = labels.exact + (locale === "zh-CN" ? "：" : ": ") + exactValue + provenanceSeparator(locale) + provenanceTitle(value, locale);
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
    return "<div class=\"metrics metrics--" + variant + "\">" + items.map(([label, value, kind, compact]) => renderMetric(label, value, locale, kind, compact ?? true)).join("") + "</div>";
}
function tagHtml(label, variant = "quiet") {
    return "<span class=\"tag tag--" + variant + "\">" + escapeHtml(label) + "</span>";
}
function outcomeLabel(outcome, locale) {
    if (locale === "zh-CN")
        return outcome === "warning" ? "警告" : outcome === "notice" ? "提示" : "通过";
    return outcome === "warning" ? "Warning" : outcome === "notice" ? "Notice" : "Pass";
}
function publicLabel(value, fallback) {
    return value.length <= 80 && /^[A-Za-z0-9_.:@-]+$/.test(value) ? value : fallback;
}
function modelLabel(value, locale) {
    if (value === "<unknown-model>")
        return locale === "zh-CN" ? "未知模型" : "Unknown model";
    return publicLabel(value, labelsFor(locale).unavailable);
}
function emptyState(labels, message = labels.noData) {
    return "<p class=\"empty\">" + escapeHtml(message) + "</p>";
}
function localizeWarning(warning, locale) {
    const unsupported = /^(\d+) Codex Session(?:s)? contain(?:s)? unsupported accounting records; only a partial audit is reported\.$/.exec(warning);
    if (unsupported) {
        return locale === "zh-CN"
            ? unsupported[1] + " 个 Codex Session 包含本报告暂时无法解析的用量记录，报告可能不完整。"
            : unsupported[1] + " Codex Session" + (unsupported[1] === "1" ? "" : "s") + " contain unsupported accounting records; the audit may be partial.";
    }
    const missingTime = /^(\d+) Codex Session(?:s)? contain(?:s)? accounting records without a usable timestamp; only time-scoped records were analysed\.$/.exec(warning);
    if (missingTime) {
        return locale === "zh-CN"
            ? missingTime[1] + " 个 Codex Session 包含无法使用的时间戳；只统计时间范围明确的记录。"
            : missingTime[1] + " Codex Session" + (missingTime[1] === "1" ? "" : "s") + " contain records without usable timestamps; only time-scoped records were analysed.";
    }
    return warning;
}
function localizeLimitation(limitation, locale) {
    if (locale !== "zh-CN")
        return limitation;
    const exactPrice = /^LiteLLM returned no exact price entry for (.+)$/.exec(limitation);
    if (exactPrice)
        return "LiteLLM 没有找到 " + exactPrice[1] + " 的精确价格条目";
    const failedPrice = /^LiteLLM price lookup failed for (.+)$/.exec(limitation);
    if (failedPrice)
        return "LiteLLM 查询 " + failedPrice[1] + " 的价格失败";
    const resolvedPrice = /^no resolved price entry for (.+)$/.exec(limitation);
    if (resolvedPrice)
        return "没有找到 " + resolvedPrice[1] + " 的价格条目";
    const derivedProvider = /^Provider was derived from the selected Harness for pricing: (.+)$/.exec(limitation);
    if (derivedProvider)
        return "定价时根据所选 Harness 推断 Provider：" + derivedProvider[1];
    const conflictingProvider = /^Provider did not match the selected Harness: (.+)$/.exec(limitation);
    if (conflictingProvider)
        return "Provider 与所选 Harness 不匹配：" + conflictingProvider[1];
    if (limitation === "LiteLLM price lookup was not performed")
        return "尚未执行 LiteLLM 价格查询";
    if (limitation === "cost estimate covers only priced Usage; unpriced or incompatible Usage is excluded")
        return "成本估算只统计已定价用量；未定价或不兼容的用量不计入";
    if (limitation === "missing compatible price dimension or mutually exclusive Token composition")
        return "缺少匹配的价格档位，或 Token 分类有重叠，无法直接计价";
    if (limitation === "missing compatible price dimension for a non-zero Token bucket")
        return "非零 Token 分桶缺少兼容的价格维度";
    if (limitation === "cache-write TTL or cache-write price dimension was unavailable")
        return "没有可用的缓存写入 TTL 或价格档位";
    if (limitation === "missing exact model identifier")
        return "缺少精确模型标识";
    if (limitation === "missing Token total")
        return "缺少 Token 总量";
    if (limitation === "calls with missing or inconsistent Token composition were excluded from cache ratios")
        return "Token 构成缺失或不一致的调用，不计入缓存比例";
    if (limitation === "cache Token ratios are unavailable because no selected call has compatible composition")
        return "没有调用提供可匹配的 Token 构成，因此无法计算缓存 Token 比例";
    if (limitation === "selected Token total was incomplete for cache composition coverage")
        return "所选 Token 总量不完整，因此无法计算缓存构成可分解比例";
    if (limitation === "no ModelCall had a complete mutually exclusive Token composition for cache coverage")
        return "没有 ModelCall 提供完整且不重叠的 Token 构成，因此无法计算缓存构成可分解比例";
    if (limitation === "no selected Token total was available for price coverage")
        return "没有可用的所选 Token 总量来计算已定价用量占比";
    if (limitation === "no Token total was available for price coverage")
        return "没有可用的 Token 总量来计算已定价用量占比";
    if (limitation === "the all-uncached comparison requires at least one selected ModelCall with compatible exact pricing")
        return "要比较不缓存情况下的成本，至少需要一个价格信息完整且匹配的所选 ModelCall";
    if (limitation === "currency requires at least one selected ModelCall with an exact Provider/model match and compatible non-zero price dimensions")
        return "要计算金额，至少需要一个 Provider、模型和非零价格档位都精确匹配的所选 ModelCall";
    if (limitation === "cache savings requires at least one priced Usage with complete compatible cost dimensions")
        return "要计算缓存节省，至少需要一条价格信息完整且匹配的已定价用量";
    if (limitation === "cache savings percentage requires at least one priced Usage with complete compatible cost dimensions")
        return "要计算缓存节省比例，至少需要一条价格信息完整且匹配的已定价用量";
    if (limitation === "cost difference requires at least one priced Usage with complete compatible cost dimensions")
        return "要计算成本差额，至少需要一条价格信息完整且匹配的已定价用量";
    if (limitation === "cost difference percentage requires at least one priced Usage with complete compatible cost dimensions")
        return "要计算成本差额比例，至少需要一条价格信息完整且匹配的已定价用量";
    if (limitation === "首次请求负担 is an observed earliest request size, not an exact removable startup tax")
        return "首次请求 Token 量是观测到的最早请求大小，不是可以精确剥离的启动成本";
    if (limitation === "Sessions without a timestamped valid ModelCall are excluded from first-request coverage")
        return "没有有效时间戳的 Session，不计入首次请求完整度";
    if (limitation === "first-request cache composition is partial because some earliest calls are missing compatible Token fields")
        return "部分最早请求缺少兼容 Token 字段，因此首次请求缓存构成不完整";
    if (limitation === "first-request coverage has no selected Session denominator")
        return "没有所选 Session 作为首次请求完整度的分母";
    if (limitation === "top-level versus Subagent first-request groups require source-proven identity for every selected Session")
        return "要比较顶层和子 Agent 的首次请求，必须确认每个所选 Session 的身份";
    if (limitation === "no selected Sessions were available for top-level or Subagent identity coverage")
        return "没有可用于确认顶层或子 Agent 身份的所选 Session";
    if (limitation === "causal Skill impact requires a valid comparison or counterfactual, which local history does not provide")
        return "无法验证 Skill 与结果之间的因果关系：本地历史没有提供有效对照数据";
    const missingSkillAssociation = /^no source-proven ModelCall association was available for (.+)$/.exec(limitation);
    if (missingSkillAssociation)
        return "没有足够证据把 ModelCall 关联到：" + missingSkillAssociation[1];
    if (limitation === "no source-proven ModelCall association was available")
        return "没有足够证据把 ModelCall 关联到对应 Skill";
    if (limitation === "no Skill evidence was available")
        return "没有可用的 Skill 证据";
    return "存在一项未满足的诊断条件";
}
function isPricingLimitation(limitation) {
    return /LiteLLM|price|priced Usage|Provider|model identifier|resolved price entry|currency requires|cost estimate|cost dimension/i.test(limitation);
}
function renderCacheLimitations(cache, locale) {
    const pricing = cache.limitations.some(isPricingLimitation) || (typeof cache.pricedUsageCoveragePercent.value === "number" && cache.pricedUsageCoveragePercent.value < 100);
    const other = cache.limitations.filter((limitation) => !isPricingLimitation(limitation));
    const parts = [];
    if (pricing) {
        parts.push("<p class=\"coverage-note pricing-note\">" + escapeHtml(locale === "zh-CN"
            ? "金额仅按能匹配精确单价的用量估算；仍有部分模型无法匹配价格，因此金额可能低于完整用量对应成本。"
            : "Amounts use only usage with an exact price match; some models remain unmatched, so the estimate may understate the cost of the full observed usage.") + "</p>");
    }
    if (other.length > 0) {
        parts.push("<ul class=\"editorial-list\">" + other.map((limitation) => "<li>" + escapeHtml(localizeLimitation(limitation, locale)) + "</li>").join("") + "</ul>");
    }
    return parts.join("");
}
function localizeMethod(method, locale) {
    if (!method)
        return labelsFor(locale).unavailable;
    if (locale !== "zh-CN")
        return method;
    const exact = {
        "cache-read Token count numerator divided by denominator, expressed as percentage points and rounded to two decimals": "缓存读取 Token 总量除以分母，换算为百分比并四舍五入到两位小数",
        "cache-write Token count numerator divided by denominator, expressed as percentage points and rounded to two decimals": "缓存写入 Token 总量除以分母，换算为百分比并四舍五入到两位小数",
        "median of earliest valid ModelCall Token totals in selected": "取所选 Session 中每个最早有效 ModelCall 的 Token 总量中位数",
        "largest paired tool-result estimate is greater than zero": "最大的一次工具结果，后续被再次带入上下文",
        "count of observed retry, interruption, and subagent lifecycle records is greater than zero": "观测到的重试、中断和子 Agent 启停记录数量大于零",
        "largest complete Session share is at least 40% with at least two ModelCall records": "至少有两个 ModelCall 记录时，最大完整 Session 占比至少为 40%",
        "largest complete model contribution share is at least 60% when more than one model is observed": "观测到多个模型时，最大完整模型贡献占比至少为 60%",
        "coverage reports skipped records, partial Sessions, or warnings": "数据中有跳过记录、不完整 Session 或异常",
        "coverage reports at least one record with no skipped records, partial Sessions, or warnings": "至少有一条记录，且没有跳过记录、不完整 Session 或异常",
    };
    if (exact[method])
        return exact[method];
    if (method.includes("Provider and model match against the LiteLLM model catalog")) {
        return method.startsWith("partial")
            ? "根据 LiteLLM 模型目录和 Harness 到 Provider 的映射，对已定价用量按 API 单价折算；未定价或不兼容的用量不计入；普通输入、缓存读取、缓存写入和输出分别计价，分类之间不重叠"
            : "根据 LiteLLM 模型目录和 Harness 到 Provider 的映射精确匹配 Provider 与模型；普通输入、缓存读取、缓存写入和输出分别计价，分类之间不重叠";
    }
    if (method.startsWith("partial all-uncached counterfactual"))
        return "按已定价用量计算“假设不缓存”的成本：普通输入、缓存读取和缓存写入按普通输入价格计价，输出价格不变；未定价用量不计入";
    if (method.startsWith("all-uncached counterfactual"))
        return "“不缓存情况下的成本”把普通输入、缓存读取和缓存写入按普通输入价格计价，输出价格不变";
    if (method.startsWith("all-uncached API-equivalent estimate minus observed API-equivalent estimate"))
        return "不缓存情况下的 API 折算金额减去已观测的 API 折算金额；正值表示缓存降低了估算金额";
    if (method.startsWith("cache savings divided by all-uncached API-equivalent cost"))
        return "估算节省金额除以不缓存情况下的 API 折算金额，换算为百分比并四舍五入到两位小数";
    if (method.startsWith("cost difference divided by all-uncached API-equivalent estimate"))
        return "成本差额除以不缓存情况下的 API 折算金额，换算为百分比并四舍五入到两位小数";
    if (method.startsWith("sum of compatible "))
        return method.replace(/^sum of compatible (.+) Token buckets$/, "把兼容的 $1 Token 分桶相加");
    if (method.startsWith("median of earliest valid ModelCall Token totals in "))
        return method.replace(/^median of earliest valid ModelCall Token totals in (.+)$/, "取 $1 中每个最早有效 ModelCall 的 Token 总量中位数");
    return "按所选历史记录和支持字段计算";
}
function renderWarningList(result, locale) {
    const labels = labelsFor(locale);
    if (result.coverage.warnings.length === 0)
        return emptyState(labels);
    return "<ul class=\"editorial-list\">" + result.coverage.warnings
        .map((warning) => "<li>" + escapeHtml(localizeWarning(warning, locale)) + "</li>")
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
    const title = labels.exact + (locale === "zh-CN" ? "：" : ": ") + exactValue + provenanceSeparator(locale) + provenanceTitle(value, locale);
    return "<span class=\"coverage-percentage\" data-provenance=\"" + escapeHtml(value.provenance) + "\" data-sort=\"" +
        String(value.value) + "\" aria-label=\"" + escapeHtml(title) + "\"><span title=\"" + escapeHtml(title) + "\">" +
        escapeHtml(provenancePrefix(value.provenance, locale) + exactValue) + "</span></span>";
}
function coverageMetricHtml(value, locale) {
    return evidenceHtml(value, locale, false);
}
function coverageNarrative(result, locale) {
    const chinese = locale === "zh-CN";
    const partialCount = coverageEvidence(result.coverage.partialSessions, "count of partial Sessions reported by coverage");
    const sessionCount = coverageSummaryEvidence(result, "sessionCount", "count of selected Session records");
    const rate = result.summary.partialSessionRatePercent ?? unavailableEvidence("source-proven partial Session rate was not reported");
    const partialTop = result.summary.partialTopLevelSessionCount ?? unavailableEvidence("source-proven partial top-level Session count was not reported");
    const partialSubagent = result.summary.partialSubagentSessionCount ?? unavailableEvidence("source-proven partial subagent Session count was not reported");
    const hasQualityGaps = result.coverage.partialSessions > 0 || result.coverage.recordsSkipped > 0 || result.coverage.warnings.length > 0;
    if (!hasQualityGaps) {
        const clean = chinese ? "历史记录解析完成，未发现覆盖异常。" : "History parsed without coverage warnings.";
        return { text: clean, html: escapeHtml(clean) };
    }
    const observedCaveat = chinese
        ? "总 Token 是已观测到、且报告能解析的记录之和；数据不完整时，实际使用量可能更高。"
        : "Total tokens are the sum of observed, supported records; incomplete coverage may undercount actual usage.";
    let text;
    let html;
    if (result.coverage.partialSessions > 0 && rate.value !== null) {
        const partialText = metricPlain(partialCount, locale, false);
        const sessionText = metricPlain(sessionCount, locale, false);
        const rateText = coveragePercentageText(rate, locale);
        text = chinese
            ? partialText + " / " + sessionText + " 个 Session（" + rateText + "）不完整。"
            : partialText + " of " + sessionText + " Sessions (" + rateText + ") are partial.";
        html = coverageMetricHtml(partialCount, locale) + (chinese ? " / " : " of ") + coverageMetricHtml(sessionCount, locale) +
            (chinese ? " 个 Session（" : " Sessions (") + coveragePercentageHtml(rate, locale) + (chinese ? "）不完整。" : ") are partial.");
        if (partialTop.value !== null && partialSubagent.value !== null) {
            const allSubagents = partialTop.value === 0 && partialSubagent.value === result.coverage.partialSessions;
            if (allSubagents) {
                text += chinese ? "所有不完整 Session 都是已确认来源的子 Agent Session。" : " All partial Sessions are source-proven subagent Sessions.";
                html += chinese ? "所有不完整 Session 都是已确认来源的子 Agent Session。" : " All partial Sessions are source-proven subagent Sessions.";
            }
            else {
                text += chinese
                    ? " 已确认来源的不完整 Session 组成：顶层 " + metricPlain(partialTop, locale, false) + "，子 Agent " + metricPlain(partialSubagent, locale, false) + "。"
                    : " Source-proven partial composition: " + metricPlain(partialTop, locale, false) + " top-level; " + metricPlain(partialSubagent, locale, false) + " subagent.";
                html += chinese
                    ? " 已确认来源的不完整 Session 组成：顶层 " + coverageMetricHtml(partialTop, locale) + "，子 Agent " + coverageMetricHtml(partialSubagent, locale) + "。"
                    : " Source-proven partial composition: " + coverageMetricHtml(partialTop, locale) + " top-level; " + coverageMetricHtml(partialSubagent, locale) + " subagent.";
            }
        }
    }
    else if (result.coverage.partialSessions > 0) {
        text = chinese
            ? metricPlain(partialCount, locale, false) + " 个 Session 数据不完整；暂时无法确认这些 Session 的来源交叉关系。"
            : metricPlain(partialCount, locale, false) + " partial Sessions; partial Session composition is unavailable because the source cannot prove the overlap.";
        html = coverageMetricHtml(partialCount, locale) + (chinese
            ? " 个 Session 数据不完整；暂时无法确认这些 Session 的来源交叉关系。"
            : " partial Sessions; partial Session composition is unavailable because the source cannot prove the overlap.");
    }
    else {
        text = chinese
            ? "数据中有跳过记录或异常；"
            : "Coverage includes skipped records or warnings;";
        html = escapeHtml(text);
    }
    text += (chinese ? " " : " ") + observedCaveat;
    html += (chinese ? " " : " ") + escapeHtml(observedCaveat);
    return { text, html };
}
function coverageLineText(result, locale) {
    const stats = locale === "zh-CN"
        ? result.coverage.filesRead + " 个文件，" + result.coverage.recordsRead + " 条记录，跳过 " + result.coverage.recordsSkipped + "，" + result.coverage.partialSessions + " 个不完整 Session，" + result.coverage.warnings.length + " 条覆盖异常·警告级。"
        : result.coverage.filesRead + " files, " + result.coverage.recordsRead + " records, " + result.coverage.recordsSkipped + " skipped, " + result.coverage.partialSessions + " partial Sessions, " + result.coverage.warnings.length + " coverage warnings.";
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
        ? "<aside class=\"quiet-callout\"><span class=\"tag tag--quiet\">" + escapeHtml(locale === "zh-CN" ? "覆盖异常·提示级" : "Coverage note") + "</span><p>" + narrative.html + "</p></aside>"
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
        return { repositoryName: null, name: null, description: "", hasBin: false };
    const repositoryName = readRepositoryName(cwd);
    try {
        const packageJson = JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.join)(cwd, "package.json"), "utf8"));
        return {
            repositoryName,
            name: typeof packageJson.name === "string" ? packageJson.name.replace(/^@[^/]+\//, "") : null,
            description: typeof packageJson.description === "string" ? packageJson.description : "",
            hasBin: packageJson.bin !== undefined,
        };
    }
    catch {
        try {
            const pyproject = (0, node_fs_1.readFileSync)((0, node_path_1.join)(cwd, "pyproject.toml"), "utf8");
            const name = /^\s*name\s*=\s*["']([^"']+)["']/m.exec(pyproject)?.[1] ?? null;
            const description = /^\s*description\s*=\s*["']([^"']+)["']/m.exec(pyproject)?.[1] ?? "";
            return { repositoryName, name, description, hasBin: false };
        }
        catch {
            return { repositoryName, name: null, description: "", hasBin: false };
        }
    }
}
function resolveReportProjectName(cwd) {
    const metadata = readProjectMetadata(cwd);
    return metadata.repositoryName ?? metadata.name ?? cwd?.split(/[\\/]/).filter(Boolean).pop() ?? null;
}
function projectName(result, metadata) {
    const explicit = result.projectName;
    if (typeof explicit === "string" && explicit.trim())
        return explicit.trim();
    if (metadata.repositoryName)
        return metadata.repositoryName;
    if (metadata.name)
        return metadata.name;
    const cwd = result.scope.cwd;
    const basename = cwd?.split(/[\\/]/).filter(Boolean).pop();
    return basename && !/^<[^>]+>$/.test(basename) ? basename : (result.scope.allProjects ? "all projects" : "project");
}
function projectProperty(result, metadata, locale) {
    const explicit = result.projectName;
    const text = (metadata.name + " " + (typeof explicit === "string" ? explicit : "") + " " + metadata.description).toLowerCase();
    if (/agent|harness|token|audit|llm|model/.test(text))
        return locale === "zh-CN" ? "AI Agent 分析工具" : "AI agent analytics tool";
    if (metadata.hasBin || /cli|command[- ]line|terminal/.test(text))
        return locale === "zh-CN" ? "CLI 工具" : "CLI tool";
    if (/web|frontend|react|vue|next\.js|vite/.test(text))
        return locale === "zh-CN" ? "Web 应用" : "Web application";
    if (/data|analytics|分析|统计/.test(text))
        return locale === "zh-CN" ? "数据分析工具" : "data analytics tool";
    if (/server|backend|api|service/.test(text))
        return locale === "zh-CN" ? "服务端应用" : "server application";
    return locale === "zh-CN" ? "开发者工具" : "developer tool";
}
function headerDiagnosticSummary(result, locale) {
    const chinese = locale === "zh-CN";
    const cacheRead = result.report.cacheEconomics.cacheReadRatePercent.value;
    const repeatedContext = typeof result.report.totalToolAmplifiedTokens.value === "number" && result.report.totalToolAmplifiedTokens.value > 0;
    const incomplete = result.coverage.partialSessions > 0 || result.coverage.recordsSkipped > 0 || result.coverage.warnings.length > 0;
    const concentrated = result.checks.some((check) => check.id === "model_concentration" && check.outcome !== "pass");
    const longSession = result.checks.some((check) => check.id === "long_session" && check.outcome !== "pass");
    if (typeof cacheRead === "number" && cacheRead >= 80 && repeatedContext)
        return chinese ? "高缓存命中仍被工具结果重复暴露拖累" : "High cache hits are still dragged down by repeated tool-result exposure";
    if (typeof cacheRead === "number" && cacheRead >= 80 && incomplete)
        return chinese ? "缓存命中率高，但数据完整度仍有限" : "Cache hits are strong, but the observed data remains incomplete";
    if (concentrated)
        return chinese ? "Token 集中于单一模型，使用结构仍偏集中" : "Token use is concentrated in one model, with limited diversification";
    if (longSession)
        return chinese ? "少数长 Session 占用较多 Token" : "A few long Sessions account for much of the Token use";
    if (typeof cacheRead === "number" && cacheRead < 20)
        return chinese ? "缓存命中偏低，输入上下文仍是主要成本" : "Cache hits are limited, leaving input context as the main cost";
    if (!incomplete)
        return chinese ? "当前用量结构平稳，暂未发现突出的诊断信号" : "Current usage is broadly stable, with no dominant diagnostic signal";
    return chinese ? "当前采集到的用量不足以形成稳定诊断结论" : "Observed usage is too limited for a stable diagnostic conclusion";
}
function renderHeaderMetric(label, value, locale, kind = "metric") {
    return "<div class=\"report-header__metric\"><strong class=\"report-header__metric-value\">" +
        metricValueHtml(value, locale, kind) + "</strong><span class=\"report-header__metric-label\">" +
        escapeHtml(label) + "</span></div>";
}
function renderReportHeader(result, locale) {
    const labels = labelsFor(locale);
    const metadata = readProjectMetadata(result.scope.cwd);
    const subject = result.scope.allProjects ? labels.allProjects : projectName(result, metadata);
    const eyebrow = locale === "zh-CN" ? reportDateRange(result, locale) + " 项目诊断" : reportDateRange(result, locale) + " PROJECT DIAGNOSTIC";
    const property = projectProperty(result, metadata, locale);
    const summary = headerDiagnosticSummary(result, locale);
    const apiCost = result.report.apiEquivalentCost.total;
    const apiCostText = typeof apiCost.value === "number"
        ? escapeHtml(locale === "zh-CN" ? "API 折算" : "API equivalent") + " " + metricValueHtml(apiCost, locale, "currency")
        : "";
    return "<header class=\"report-header\">" +
        "<div class=\"report-header__main\"><div class=\"report-header__identity\">" +
        "<div class=\"report-eyebrow\">" + escapeHtml(eyebrow) + "</div>" +
        "<h1><span class=\"report-header__project\">" + escapeHtml(subject) + "</span><span class=\"report-header__suffix\">" + escapeHtml(locale === "zh-CN" ? "诊断报告" : "diagnostic report") + "</span></h1>" +
        "<p class=\"report-deck\">" + escapeHtml(property + " · " + summary) + "</p></div>" +
        "<div class=\"report-header__primary\"><strong class=\"report-header__value\">" +
        metricValueHtml(result.summary.totalTokens, locale, "metric") + "</strong>" +
        "<span class=\"report-header__primary-label\">" + apiCostText + "</span>" +
        "<span class=\"report-header__primary-date\">" + escapeHtml(locale === "zh-CN" ? reportEndDate(result, locale) + " 截止" : "As of " + reportEndDate(result, locale)) + "</span></div></div>" +
        "<div class=\"report-header__metrics\" aria-label=\"" + escapeHtml(locale === "zh-CN" ? "报告关键指标" : "Report key metrics") + "\">" +
        renderHeaderMetric(labels.sessions, result.summary.sessionCount, locale) +
        renderHeaderMetric(labels.modelCalls, result.summary.modelCallCount, locale) +
        renderHeaderMetric(labels.cacheReadRate, result.report.cacheEconomics.cacheReadRatePercent, locale, "percentage") +
        renderHeaderMetric(labels.priceCoverage, result.report.cacheEconomics.pricedUsageCoveragePercent, locale, "percentage") +
        "</div></header>";
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
    const chinese = locale === "zh-CN";
    const labels = labelsFor(locale);
    const status = outcomeLabel(check.outcome, locale);
    if (check.id === "long_session")
        return {
            outcomeLabel: status,
            headline: chinese ? "一个 Session 占已观测 Token 的 " + percentage(2) : "One Session accounts for " + percentage(2) + " of observed tokens",
            detail: chinese ? evidence(1) + " 次模型调用；" + evidence(0) + " 个已观测 Token。" : evidence(1) + " ModelCall records; " + evidence(0) + " observed tokens.",
            headlineHtml: (chinese ? "一个 Session 占已观测 Token 的 " : "One Session accounts for ") + percentageHtmlValue(2) + (chinese ? "" : " of observed tokens"),
            detailHtml: (chinese ? metricHtml(1) + " 次模型调用；" + metricHtml(0) + " 个已观测 Token。" : metricHtml(1) + " ModelCall records; " + metricHtml(0) + " observed tokens."),
            method: localizeMethod(check.method, locale),
        };
    if (check.id === "tool_amplification")
        return {
            outcomeLabel: status,
            headline: chinese ? "一个工具结果可能会在后续对话中再次带入；估算暴露量为 " + evidence(2) : "One tool result may be carried forward; exposure estimate " + evidence(2),
            detail: chinese ? "工具结果大小 " + evidence(0) + " " + labels.characters + "；后续有 " + evidence(1) + " 次模型调用。" : "Paired result: " + evidence(0) + " " + labels.characters + "; later ModelCall records: " + evidence(1) + ".",
            headlineHtml: (chinese ? "一个工具结果可能会在后续对话中再次带入；估算暴露量为 " : "One tool result may be carried forward; exposure estimate ") + metricHtml(2),
            detailHtml: (chinese ? "工具结果大小 " + metricHtml(0) + " " + escapeHtml(labels.characters) + "；后续有 " + metricHtml(1) + " 次模型调用。" : "Paired result: " + metricHtml(0) + " " + escapeHtml(labels.characters) + "; later ModelCall records: " + metricHtml(1) + "."),
            method: localizeMethod(check.method, locale),
        };
    if (check.id === "extra_calls")
        return {
            outcomeLabel: status,
            headline: chinese ? "观察到 " + evidence(0) + " 条重试、中断或子 Agent 启停记录" : evidence(0) + " retry, interruption, or subagent lifecycle records observed",
            detail: chinese ? "这项检查只统计观测到的重试、中断和子 Agent 启停记录。" : "This check counts only observed lifecycle records.",
            headlineHtml: (chinese ? "观察到 " : "") + metricHtml(0) + (chinese ? " 条重试、中断或子 Agent 启停记录" : " retry, interruption, or subagent lifecycle records observed"),
            detailHtml: chinese ? "这项检查只统计观测到的重试、中断和子 Agent 启停记录。" : "This check counts only observed lifecycle records.",
            method: localizeMethod(check.method, locale),
        };
    if (check.id === "model_concentration")
        return {
            outcomeLabel: status,
            headline: chinese ? evidence(0) + " 占已观测 Token 的 " + percentage(1) : evidence(0) + " accounts for " + percentage(1) + " of observed tokens",
            detail: chinese ? evidence(2) + " 次模型调用。" : evidence(2) + " ModelCall records.",
            headlineHtml: metricHtml(0) + (chinese ? " 占已观测 Token 的 " : " accounts for ") + percentageHtmlValue(1) + (chinese ? "" : " of observed tokens"),
            detailHtml: metricHtml(2) + (chinese ? " 次模型调用。" : " ModelCall records."),
            method: localizeMethod(check.method, locale),
        };
    if (check.outcome === "pass")
        return {
            outcomeLabel: status,
            headline: chinese ? "历史记录未发现覆盖异常" : "History parsed without coverage warnings",
            detail: chinese ? evidence(1) + " 条记录来自 " + evidence(0) + " 个文件；没有跳过或不完整 Session。" : evidence(1) + " records from " + evidence(0) + " files; no skipped or partial Sessions.",
            headlineHtml: chinese ? "历史记录未发现覆盖异常" : "History parsed without coverage warnings",
            detailHtml: chinese ? metricHtml(1) + " 条记录来自 " + metricHtml(0) + " 个文件；没有跳过或不完整 Session。" : metricHtml(1) + " records from " + metricHtml(0) + " files; no skipped or partial Sessions.",
            method: localizeMethod(check.method, locale),
        };
    return {
        outcomeLabel: status,
        headline: chinese ? "数据中有跳过、不完整或异常记录" : "Coverage reports skipped, partial, or warning records",
        detail: chinese ? evidence(2) + " 条跳过记录；" + evidence(3) + " 个不完整 Session；" + evidence(4) + " 条覆盖异常·警告级。" : evidence(2) + " skipped records; " + evidence(3) + " partial Sessions; " + evidence(4) + " coverage warnings.",
        headlineHtml: chinese ? "数据中有跳过、不完整或异常记录" : "Coverage reports skipped, partial, or warning records",
        detailHtml: chinese ? metricHtml(2) + " 条跳过记录；" + metricHtml(3) + " 个不完整 Session；" + metricHtml(4) + " 条覆盖异常·警告级。" : metricHtml(2) + " skipped records; " + metricHtml(3) + " partial Sessions; " + metricHtml(4) + " coverage warnings.",
        method: localizeMethod(check.method, locale),
    };
}
function checkLine(check, locale) {
    const presented = presentCheck(check, locale);
    return presented.outcomeLabel + ": " + presented.headline + " — " + presented.detail + " " + (locale === "zh-CN" ? "方法：" : "Method: ") + presented.method;
}
function renderChecks(result, locale) {
    const title = labelsFor(locale).diagnosticSignals;
    const none = locale === "zh-CN" ? "没有足够的可靠证据支持自动生成发现。" : "No automated finding is supported by the available evidence.";
    if (result.checks.length === 0)
        return "<section><h2>" + escapeHtml(title) + "</h2>" + emptyState(labelsFor(locale), none) + "</section>";
    return "<section class=\"supporting-findings\"><h2>" + escapeHtml(title) + "</h2><p class=\"coverage-note\">" + escapeHtml(labelsFor(locale).checksNote) + "</p><ul>" + result.checks.map((check) => {
        const presented = presentCheck(check, locale);
        const severityTag = tagHtml(presented.outcomeLabel);
        return "<li class=\"editorial-item\" data-outcome=\"" + escapeHtml(check.outcome) + "\"><div class=\"editorial-tags\" aria-label=\"" + escapeHtml(check.outcome) + "\">" + severityTag + "</div><strong class=\"editorial-title\">" + presented.headlineHtml + "</strong><p class=\"editorial-detail\">" + presented.detailHtml + "</p><small class=\"editorial-method\">" + escapeHtml(locale === "zh-CN" ? "方法：" : "Method: ") + escapeHtml(presented.method) + "</small></li>";
    }).join("") + "</ul></section>";
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
function sessionDriver(result, sessionId, locale) {
    const candidate = (result.turnCandidates ?? []).find((item) => item.sessionId === sessionId);
    if (!candidate)
        return "—";
    const labels = locale === "zh-CN"
        ? { turn_concentration: "轮次集中", input_growth: "输入增长", tool_result_adjacency: "大工具结果邻接", compaction_change: "压缩边界", waiting_hotspot: "等待热点", failed_path: "失败路径" }
        : { turn_concentration: "round concentration", input_growth: "input growth", tool_result_adjacency: "tool-result adjacency", compaction_change: "compaction boundary", waiting_hotspot: "waiting hotspot", failed_path: "failed path" };
    return labels[candidate.kind] ?? candidate.kind;
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
    return locale === "zh-CN" ? "未命名 Session" : "Untitled Session";
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
    if (locale === "zh-CN") {
        if (hours > 0)
            return hours + "小时" + (minutes > 0 ? minutes + "分钟" : "") + (seconds > 0 ? seconds + "秒" : "");
        if (totalMinutes > 0)
            return totalMinutes + "分钟" + (seconds > 0 ? seconds + "秒" : "");
        return seconds + "秒";
    }
    if (hours > 0)
        return hours + "h" + (minutes > 0 ? " " + minutes + "m" : "") + (seconds > 0 ? " " + seconds + "s" : "");
    if (totalMinutes > 0)
        return totalMinutes + "m" + (seconds > 0 ? " " + seconds + "s" : "");
    return seconds + "s";
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
        return formatCompact(chars, locale) + (locale === "zh-CN" ? " 字符" : " chars");
    const bytes = numericValue(turn.toolResultBytes);
    return bytes === null ? "—" : formatCompact(bytes, locale) + " B";
}
function processEvents(turn, locale) {
    const labels = locale === "zh-CN"
        ? { retry: "重试", compaction: "自动压缩上下文", subagent: "Subagent", interrupted: "中断" }
        : { retry: "retry", compaction: "automatic context compaction", subagent: "Subagent", interrupted: "interrupted" };
    const events = turn.lifecycleMarkers.map((marker) => labels[marker]).filter((marker) => Boolean(marker));
    if (typeof turn.errorCount.value === "number" && turn.errorCount.value > 0)
        events.push(locale === "zh-CN" ? "错误" : "error");
    for (const skill of turn.skillMarkers ?? [])
        events.push("Skill: " + skill);
    return [...new Set(events)];
}
function roundLabel(turn, locale) {
    const ordinal = numericValue(turn.ordinal);
    if (ordinal === null)
        return shortenedId(turn.turnId);
    return locale === "zh-CN" ? "第 " + formatExact(ordinal, locale) + " 轮" : "Round " + formatExact(ordinal, locale);
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
    if (denominator === null || denominator <= 0 || valued.length === 0)
        return locale === "zh-CN" ? "前 5 轮合计占比不可用" : "Top 5 round share is unavailable";
    const count = Math.min(5, valued.length);
    const numerator = valued.slice(0, count).reduce((sum, turn) => sum + numericValue(turn.tokens.totalTokens), 0);
    const percent = Math.round((numerator / denominator) * 10000) / 100;
    return locale === "zh-CN" ? "前 " + count + " 轮合计占 " + fixedPercent(percent, locale) : "Top " + count + " rounds account for " + fixedPercent(percent, locale);
}
function keySessionUnavailableReason(reason, locale) {
    if (!reason)
        return locale === "zh-CN" ? "未返回合法的结构化分析。" : "No valid structured analysis was returned.";
    if (locale !== "zh-CN")
        return reason;
    if (reason === "未提供 Host Agent 结构化分析。")
        return reason;
    if (reason.includes("Codex Token accounting"))
        return "Codex Token 口径尚未完成核对。";
    if (reason.includes("Audit fingerprint"))
        return "结构化分析与当前审计不匹配。";
    if (reason.includes("Turn outside"))
        return "分析引用了当前 Session 之外的轮次。";
    if (reason.includes("primaryFinding"))
        return "核心判断没有通过内容或证据校验。";
    if (reason.includes("recommendation"))
        return "改善提议没有通过内容或证据校验。";
    if (reason.includes("evidenceRead"))
        return "分析没有说明读取的轮次范围。";
    return "Host Agent 返回的结构化分析未通过校验。";
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
        const composition = [turn.tokens.inputTokens, turn.tokens.cachedInputTokens, turn.tokens.outputTokens]
            .map((value) => keyValueText(value, locale)).join(" / ");
        return "<tr" + className + "><th scope=\"row\" class=\"turn-number\"><span>" + escapeHtml(roundLabel(turn, locale)) + "</span></th><td>" + keyMetricHtml(turn.tokens.totalTokens, locale, "turn-token") + "</td><td>" + keyPercentageHtml(turn.sessionSharePercent, locale, "turn-share") + "</td><td class=\"composition\">" + escapeHtml(composition) + "</td><td>" + keyDurationHtml(turn.durationMs, locale, "turn-duration") + "</td><td class=\"tool-result\"><span data-sort=\"" + (numericValue(turn.toolCallCount) ?? "") + "\">" + escapeHtml(keyValueText(turn.toolCallCount, locale, false)) + " / " + escapeHtml(resultSizeText(turn, locale)) + "</span></td><td class=\"event\">" + escapeHtml(events.join(" · ") || "—") + "</td></tr>";
    }).join("");
    return "<table class=\"kami-table compact sortable turn-detail-table\"><caption class=\"sr-only\">" + escapeHtml(labels.turnTrajectory) + "</caption><thead><tr><th scope=\"col\">" + escapeHtml(labels.turn) + "</th><th scope=\"col\">" + escapeHtml(labels.tokens) + "</th><th scope=\"col\">" + escapeHtml(labels.share) + "</th><th scope=\"col\">" + escapeHtml(labels.input) + " / " + escapeHtml(labels.cachedInput) + " / " + escapeHtml(labels.output) + "</th><th scope=\"col\">" + escapeHtml(labels.roundDuration) + "</th><th scope=\"col\">" + escapeHtml(labels.toolCalls) + " / " + escapeHtml(labels.resultSize) + "</th><th scope=\"col\">" + escapeHtml(labels.processEvents) + "</th></tr></thead><tbody>" + rows + "</tbody></table>";
}
function renderKeySessionAnalysis(result, locale, composition, localFirstUserMessages) {
    const labels = labelsFor(locale);
    const topSessions = result.rankings.sessions.slice(0, 3);
    if (topSessions.length === 0)
        return "";
    const promptRecords = localFirstUserMessages ?? composition?.firstUserMessages ?? [];
    const promptByTurn = new Map(promptRecords.map((record) => [record.sessionId + "\0" + record.turnId, record]));
    const validated = composition
        ? (0, key_session_analysis_1.composeKeySessionAnalyses)(result, composition.keySessionAnalyses)
        : { analyses: [], unavailable: [locale === "zh-CN" ? "未提供 Host Agent 结构化分析。" : "No Host Agent composition was provided."] };
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
            ? concentration + "。" + roundLabel(topDuration, locale) + (locale === "zh-CN" ? "本轮耗时 " : " has a round duration of ") + durationText(topDuration.durationMs, locale) + (locale === "zh-CN" ? "。" : ".")
            : concentration + (locale === "zh-CN" ? "。" : ".");
        const primaryFinding = analysis?.primaryFinding;
        const supportLabel = primaryFinding
            ? (locale === "zh-CN" ? { strong: "强", moderate: "中", limited: "有限" }[primaryFinding.support] : primaryFinding.support)
            : "";
        const finding = !analysis
            ? "<article class=\"finding\"><div class=\"analysis-label\"><span>" + escapeHtml(labels.interpretation) + "</span></div><p class=\"analysis-unavailable\">" + escapeHtml(labels.analysisUnavailable + keySessionUnavailableReason(unavailableReason, locale)) + "</p><p class=\"quiet\">" + escapeHtml(locale === "zh-CN" ? "确定性轮次轨迹仍保留。" : "The deterministic round trajectory remains available.") + "</p></article>"
            : "<article class=\"finding\"><div class=\"analysis-label\"><span>" + escapeHtml(labels.interpretation) + "</span>" + (primaryFinding ? "<span class=\"evidence-strength\">" + escapeHtml(locale === "zh-CN" ? "证据强度 · " + supportLabel : "Evidence strength · " + supportLabel) + "</span>" : "") + "</div>" + (primaryFinding
                ? "<p class=\"finding-lead\">" + escapeHtml(primaryFinding.observation) + "</p><p class=\"fact-line\"><strong>" + escapeHtml(fact) + "</strong></p><p class=\"quiet\">" + escapeHtml([primaryFinding.interpretation, ...primaryFinding.alternativeExplanations].filter(Boolean).join(locale === "zh-CN" ? "；" : " ")) + "</p>"
                : "<p class=\"finding-lead\">" + escapeHtml(labels.noStrongEvidence) + "</p><p class=\"fact-line\"><strong>" + escapeHtml(fact) + "</strong></p>") + "</article>";
        const action = analysis?.recommendation
            ? "<article class=\"action\"><div class=\"analysis-label\"><span>" + escapeHtml(labels.improvementAction) + "</span></div><h4>" + escapeHtml(analysis.recommendation.action) + "</h4><p class=\"action-copy\">" + escapeHtml(analysis.recommendation.rationale) + "</p><p class=\"applicability\">" + escapeHtml(analysis.recommendation.applicability) + (analysis.recommendation.tradeoff ? " · " + escapeHtml(analysis.recommendation.tradeoff) : "") + "</p><p class=\"verify\"><span class=\"analysis-label\">" + escapeHtml(labels.verificationMethod) + "</span>" + escapeHtml(analysis.recommendation.verification) + "</p></article>"
            : "";
        const taskContext = analysis?.taskContext ?? (locale === "zh-CN" ? "Host Agent 解读不可用；保留确定性轨迹。" : "Host Agent interpretation is unavailable; the deterministic trajectory remains.");
        const metrics = "<div class=\"key-session-metrics\" aria-label=\"" + escapeHtml(locale === "zh-CN" ? "Session 摘要" : "Session summary") + "\"><div class=\"key-session-metric\"><span class=\"key-session-metric-value\">" + escapeHtml(durationText(totalDuration, locale)) + "</span><span class=\"key-session-metric-label\">" + escapeHtml(labels.totalDuration) + "</span></div><div class=\"key-session-metric\"><span class=\"key-session-metric-value\" data-sort=\"" + String(turns.length) + "\">" + escapeHtml(String(turns.length)) + "</span><span class=\"key-session-metric-label\">" + escapeHtml(labels.roundCount) + "</span></div><div class=\"key-session-metric\"><span class=\"key-session-metric-value\">" + escapeHtml(concentration) + "</span><span class=\"key-session-metric-label\">" + escapeHtml(locale === "zh-CN" ? "前 5 轮 Token 占比" : "Top 5 round Token share") + "</span></div></div>";
        const sessionTotal = keyValueText(row.value, locale);
        const trajectoryNote = labels.trajectoryIntro;
        const promptCount = turns.filter((turn) => promptByTurn.get(row.key + "\0" + turn.turnId)?.content !== null && promptByTurn.has(row.key + "\0" + turn.turnId)).length;
        const promptNote = promptCount > 0
            ? (locale === "zh-CN" ? "本地 Tooltip 可查看 " + promptCount + " 个轮次的完整首条用户消息。" : "Local Tooltips include the complete first user message for " + promptCount + " rounds.")
            : (locale === "zh-CN" ? "首条用户消息不可用时会保留诚实的缺失说明。" : "Missing first user messages remain explicitly unavailable.");
        const detailSummary = labels.allRoundDetails + " " + turns.length + (locale === "zh-CN" ? " 个轮次明细" : " round details");
        const trajectory = "<section class=\"key-session-section key-session-trajectory\" aria-labelledby=\"" + chartId + "-title\"><div class=\"key-session-section-head\"><h4 id=\"" + chartId + "-title\">" + escapeHtml(labels.turnTrajectory) + "</h4><p>" + escapeHtml(trajectoryNote) + "</p></div><figure class=\"key-session-chart-frame\" aria-labelledby=\"" + chartId + "-caption\"><div class=\"key-session-chart-toolbar\"><div><strong>" + escapeHtml(String(turns.length) + (locale === "zh-CN" ? " 个轮次 · Token 占比 / 本轮耗时" : " rounds · Token share / round duration")) + "</strong><small>" + escapeHtml(labels.chartHint) + "</small></div><div class=\"key-session-legend\" aria-label=\"" + escapeHtml(locale === "zh-CN" ? "图例" : "Legend") + "\"><span class=\"hot\">" + escapeHtml(locale === "zh-CN" ? "高用量轮次" : "Token hotspots") + "</span><span>" + escapeHtml(locale === "zh-CN" ? "其他轮次" : "Other rounds") + "</span><span class=\"time\">" + escapeHtml(labels.roundDuration) + "</span></div></div><div id=\"" + chartId + "\" class=\"echart key-session-chart\" role=\"img\" aria-label=\"" + escapeHtml(String(turns.length) + (locale === "zh-CN" ? " 个轮次的 Token 占比和本轮耗时轨迹" : " rounds of Token share and round duration")) + "\"></div><figcaption id=\"" + chartId + "-caption\" class=\"key-session-chart-note\"><strong>" + escapeHtml(locale === "zh-CN" ? "重点：" : "Focus: ") + "</strong>" + escapeHtml(fact) + "</figcaption><p class=\"key-session-prompt-note\">" + escapeHtml(promptNote) + "</p><noscript><p class=\"key-session-chart-note\">" + escapeHtml(locale === "zh-CN" ? "图表需要 JavaScript；请展开下方完整轮次明细查看相同数据。" : "The chart needs JavaScript; expand the complete round details below for the equivalent data.") + "</p></noscript></figure><details class=\"key-session-appendix\"><summary><span>" + escapeHtml(detailSummary) + "</span><small>" + escapeHtml(labels.detailNote) + "</small></summary><div class=\"table-scroll\">" + renderTurnTrajectory(result, row.key, locale) + "</div></details></section>";
        return "<details class=\"key-session-entry" + (index === 0 ? " key-session-entry--primary\" open" : "\"") + "><summary aria-controls=\"" + titleId + "\"><span class=\"key-session-summary\"><span class=\"session-summary-main\"><span class=\"session-summary-title\">" + escapeHtml(title) + "</span><span class=\"session-summary-id\">" + escapeHtml(shortenedId(row.key)) + " · " + escapeHtml(String(turns.length)) + " " + escapeHtml(locale === "zh-CN" ? "轮" : "rounds") + "</span></span><small>" + escapeHtml(index === 0 ? (locale === "zh-CN" ? "默认展开" : "open by default") : (locale === "zh-CN" ? "折叠" : "collapsed")) + "</small></span></summary><div id=\"" + titleId + "\" class=\"key-session-content\"><header class=\"key-session-head\"><div class=\"key-session-heading\"><div><span class=\"session-rank\">" + escapeHtml((locale === "zh-CN" ? "TOKEN 排名 " : "TOKEN rank ") + String(index + 1).padStart(2, "0") + " / " + String(topSessions.length).padStart(2, "0") + " · " + (locale === "zh-CN" ? "当前 Session" : "Current Session")) + "</span><h3 class=\"session-title\">" + escapeHtml(title) + "</h3><p class=\"task-title\">" + escapeHtml(taskContext) + "</p><p class=\"session-id\">" + escapeHtml(row.key) + " · " + escapeHtml(result.scope.harness) + "</p></div><div class=\"session-total\"><strong>" + escapeHtml(sessionTotal) + "</strong><span>" + escapeHtml(labels.sessionToken) + "</span></div></div>" + metrics + "</header><section class=\"key-session-section key-session-judgment\" aria-labelledby=\"" + titleId + "-judgment\"><div class=\"key-session-section-head\"><h4 id=\"" + titleId + "-judgment\">" + escapeHtml(labels.primaryFinding) + "</h4><p>" + escapeHtml(locale === "zh-CN" ? "先陈述证据支持的判断，再单独给出改善提议与验证。" : "State the evidence-backed judgment first, then separate the improvement proposal and verification.") + "</p></div><div class=\"judgment\">" + finding + action + "</div></section>" + trajectory + "</div></details>";
    }).join("");
    return "<section class=\"key-session-analysis-section\"><header class=\"key-session-module-head\"><span class=\"key-session-module-kicker\">" + escapeHtml((locale === "zh-CN" ? "用量诊断 · " : "Usage diagnosis · ") + result.scope.harness) + "</span><h2>" + escapeHtml(labels.keySessionAnalysis) + "</h2><p class=\"key-session-module-deck\">" + escapeHtml(labels.moduleDeck) + "</p><p class=\"key-session-privacy\" role=\"note\">" + escapeHtml(locale === "zh-CN" ? "本地完整 HTML 的 Tooltip 可包含展示轮次的完整首条用户消息；分享稿、JSON 和文本不含 Prompt。" : "Local full HTML Tooltips may include the complete first user message for displayed rounds; share, JSON, and text outputs exclude Prompts.") + "</p></header><div class=\"key-session-list\" aria-label=\"" + escapeHtml(locale === "zh-CN" ? "关键 Session 列表" : "Key Session list") + "\">" + blocks + "</div></section>";
}
function renderExplainableSessions(result, locale) {
    const labels = labelsFor(locale);
    const rows = result.rankings.sessions.slice(0, 10);
    if (rows.length === 0)
        return emptyState(labels);
    return "<table class=\"kami-table sortable explainable-sessions\"><thead><tr><th>" + escapeHtml(labels.session) + "</th><th>" + escapeHtml(labels.tokens) + "</th><th>" + escapeHtml(labels.share) + "</th><th>" + escapeHtml(labels.turn) + "</th><th>" + escapeHtml(labels.totalDuration) + "</th><th>" + escapeHtml(labels.driver) + "</th><th>" + escapeHtml(labels.evidenceCompleteness) + "</th></tr></thead><tbody>" + rows.map((row) => {
        const turnCount = reportDerivedEvidence(sessionTurns(result, row.key).length, "count of Turn records in the Session");
        return "<tr><th scope=\"row\">" + escapeHtml(sessionLabel(row, locale)) + "</th><td>" + tokenCell(row.value, locale) + "</td><td>" + percentageHtml(row.sharePercent, locale) + "</td><td>" + tokenCell(turnCount, locale) + "</td><td>" + tokenCell(sessionActiveTime(result, row.key), locale) + "</td><td>" + escapeHtml(sessionDriver(result, row.key, locale)) + "</td><td>" + percentageHtml(sessionCompleteness(result, row.key), locale) + "</td></tr>";
    }).join("") + "</tbody></table>";
}
function renderDaily(result, locale) {
    const labels = labelsFor(locale);
    const rows = result.report.dailyUsage;
    if (rows.length === 0)
        return emptyState(labels);
    return "<table class=\"kami-table compact sortable\"><thead><tr><th>" + escapeHtml(labels.date) + "</th><th>" + escapeHtml(labels.totalTokens) + "</th><th>" + escapeHtml(labels.share) + "</th><th>" +
        escapeHtml(labels.input) + "</th><th>" + escapeHtml(labels.cachedInput) + "</th><th>" + escapeHtml(labels.cacheWrite) + "</th><th>" + escapeHtml(labels.output) + "</th><th>" + escapeHtml(locale === "zh-CN" ? "未分类部分" : "unclassified remainder") + "</th></tr></thead><tbody>" +
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
    return "<p class=\"coverage-note\">" + escapeHtml(labels.toolImpactNote) + "</p><table class=\"kami-table compact sortable\"><thead><tr><th>Tool</th><th>" + escapeHtml(labels.calls) + "</th><th>" + escapeHtml(labels.pairedResults) + "</th>" +
        (showErrors ? "<th>" + escapeHtml(labels.errors) + "</th>" : "") + "<th>" +
        escapeHtml(labels.injected) + "</th><th>" + escapeHtml(labels.amplified) + "</th><th>" + escapeHtml(labels.share) + "</th></tr></thead><tbody>" +
        rows.map((row) => "<tr><th scope=\"row\">" + escapeHtml(publicLabel(row.key, labels.unavailable)) + "</th><td>" + tokenCell(row.calls, locale) +
            "</td><td>" + tokenCell(row.pairedResults, locale) + "</td>" + (showErrors ? "<td>" + tokenCell(row.errors, locale) + "</td>" : "") + "<td>" + tokenCell(row.injectedTokens, locale) +
            "</td><td>" + tokenCell(row.amplifiedTokens, locale) + "</td><td>" + percentageHtml(row.sharePercent, locale) + "</td></tr>").join("") +
        "</tbody></table>";
}
function methodText(value, locale) {
    return localizeMethod(value.method, locale);
}
function skillStateLabel(state, locale) {
    if (locale === "zh-CN") {
        return state === "available" ? "可用" : state === "invoked" ? "已调用" : state === "attributed" ? "有据可查" : "无数据";
    }
    return state;
}
function skillLabel(name, locale) {
    if (name === "<unknown-skill>")
        return locale === "zh-CN" ? "未知 Skill" : "Unknown Skill";
    return publicLabel(name, labelsFor(locale).unavailable);
}
function skillEvidenceNote(locale) {
    return locale === "zh-CN"
        ? "这里的 API 折算金额只统计能够明确关联到该 Skill 的用量；本地历史无法证明 Skill 导致额外成本。"
        : "API-equivalent cost here includes only usage explicitly attributable to the Skill; local history cannot prove that a Skill caused extra cost.";
}
function renderCacheText(result, locale) {
    const labels = labelsFor(locale);
    const cache = result.report.cacheEconomics;
    const lines = [
        labels.cacheEconomics,
        labels.cacheReadRate + ": " + percentagePlain(cache.cacheReadRatePercent, locale) + "; " + labels.cacheWriteRate + ": " + percentagePlain(cache.cacheWriteRatePercent, locale) + "; " + labels.cacheCoverage + ": " + percentagePlain(cache.coveragePercent, locale) + ".",
        labels.observedApiCost + ": " + currencyPlain(cache.observedApiEquivalentCost, locale, false) + "; " + labels.allUncachedApiCost + ": " + currencyPlain(cache.allUncachedApiEquivalentCost, locale, false) + "; " + labels.cacheSavings + ": " + currencyPlain(cache.cacheSavings, locale, false) + " (" + percentagePlain(cache.cacheSavingsPercent, locale) + "); " + labels.priceCoverage + ": " + percentagePlain(cache.pricedUsageCoveragePercent, locale) + ".",
        (locale === "zh-CN" ? "方法：" : "Method: ") + methodText(cache.cacheReadRatePercent, locale) + "; " + methodText(cache.observedApiEquivalentCost, locale),
    ];
    if (cache.limitations.length > 0)
        lines.push((locale === "zh-CN" ? "限制：" : "Limitations: ") + cache.limitations.map((limitation) => localizeLimitation(limitation, locale)).join("; "));
    return lines;
}
function renderFirstRequestText(result, locale) {
    const labels = labelsFor(locale);
    const first = result.report.firstRequestBurden;
    const lines = [
        labels.firstRequestBurden,
        labels.firstRequestMedian + ": " + evidencePlain(first.medianTokens, locale, false) + "; " + labels.firstRequestShare + ": " + percentagePlain(first.sharePercent, locale) + "; " + labels.firstRequestCoverage + ": " + percentagePlain(first.coveragePercent, locale) + ".",
        (locale === "zh-CN" ? "缓存构成：普通输入 " : "Cache composition: ordinary input ") + evidencePlain(first.inputTokens, locale, false) + "; " + labels.cachedInput + " " + evidencePlain(first.cachedInputTokens, locale, false) + "; " + labels.cacheWrite + " " + evidencePlain(first.cacheWriteTokens, locale, false) + "; " + labels.output + " " + evidencePlain(first.outputTokens, locale, false) + ".",
        labels.firstRequestCompositionCoverage + ": " + percentagePlain(first.compositionCoveragePercent, locale) + "; " + labels.coldFirstRequestRate + ": " + percentagePlain(first.coldSessionRatePercent, locale) + ".",
        (locale === "zh-CN" ? "方法：" : "Method: ") + methodText(first.medianTokens, locale) + "; " + (locale === "zh-CN" ? "这是观测到的最早请求大小，无法精确区分系统、Skill 和用户输入各自占了多少。" : "This is the observed earliest request size; it cannot precisely decompose system, Skill, or user-input overhead."),
    ];
    if (first.topLevel)
        lines.push((locale === "zh-CN" ? "顶层：" : "Top-level: ") + evidencePlain(first.topLevel.medianTokens, locale, false) + "; " + labels.firstRequestCoverage + " " + percentagePlain(first.topLevel.compositionCoveragePercent, locale) + ".");
    if (first.subagent)
        lines.push((locale === "zh-CN" ? "子 Agent：" : "Subagent: ") + evidencePlain(first.subagent.medianTokens, locale, false) + "; " + labels.firstRequestCoverage + " " + percentagePlain(first.subagent.compositionCoveragePercent, locale) + ".");
    lines.push((locale === "zh-CN" ? labels.identityCoverage + "：" : "Identity coverage: ") + percentagePlain(first.identityCoveragePercent, locale) + ".");
    if (first.limitations.length > 0)
        lines.push((locale === "zh-CN" ? "限制：" : "Limitations: ") + first.limitations.map((limitation) => localizeLimitation(limitation, locale)).join("; "));
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
    const efficiencyTitle = locale === "zh-CN" ? "缓存效率" : "Cache efficiency";
    const impactTitle = locale === "zh-CN" ? "成本影响" : "Cost impact";
    const groups = "<div class=\"comparison-grid economic-groups\"><div class=\"ivory-group\"><h3>" + escapeHtml(efficiencyTitle) + "</h3>" + renderMetrics(efficiencyMetrics, locale, "economic") + "</div><div class=\"ivory-group\"><h3>" + escapeHtml(impactTitle) + "</h3>" + renderMetrics(impactMetrics, locale, "economic") + "</div></div>";
    return "<section class=\"cache-economics\"><h2>" + escapeHtml(labels.cacheEconomics) + "</h2>" + groups + "<p class=\"coverage-note\">" + escapeHtml((locale === "zh-CN" ? "缓存比例的算法：先把各类 Token 分别汇总，再计算比例；金额按 API 单价折算，只作估算，不是订阅账单。方法：" : "Cache ratios sum mutually exclusive Token buckets before division; currency is an API-equivalent estimate, not a subscription bill. Method: ") + methodText(cache.cacheReadRatePercent, locale) + "; " + methodText(cache.observedApiEquivalentCost, locale)) + "</p>" + limitations + "</section>";
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
    const limitations = first.limitations.length > 0 ? "<ul class=\"editorial-list\">" + first.limitations.map((limitation) => "<li>" + escapeHtml(localizeLimitation(limitation, locale)) + "</li>").join("") + "</ul>" : "";
    const comparisonGroups = [renderFirstGroupHtml(first.topLevel, labels.topLevelSessions, locale), renderFirstGroupHtml(first.subagent, labels.subagentSessions, locale)].filter(Boolean).join("");
    const comparison = comparisonGroups ? "<div class=\"comparison-grid\">" + comparisonGroups + "</div>" : "";
    return "<section class=\"first-request\"><h2>" + escapeHtml(labels.firstRequestBurden) + "</h2>" + renderMetrics(metrics, locale, "first-request") + "<p class=\"coverage-note\">" + escapeHtml(locale === "zh-CN" ? "这是每个 Session 最早有效请求的 Token 量，不是可以精确剥离的启动成本。" : "This is the observed burden in Tokens of each Session's earliest valid request, not an exact decomposable startup tax.") + "</p>" + comparison + limitations + "</section>";
}
function renderSkillsHtml(result, locale) {
    const labels = labelsFor(locale);
    if (result.report.skills.length === 0)
        return "<section><h2>" + escapeHtml(labels.skillEvidence) + "</h2>" + emptyState(labels, labels.noSkillEvidence) + "</section>";
    const rows = result.report.skills.map((skill) => "<tr><th scope=\"row\">" + escapeHtml(skillLabel(skill.name, locale)) + "</th><td>" + evidenceHtml(skill.invocationCount, locale, false) + "</td><td>" + evidenceHtml(skill.sessionCount, locale, false) + "</td><td>" + evidenceHtml(skill.attributedTokens, locale) + "</td><td>" + evidenceHtml(skill.attributedApiEquivalentCost, locale, false, true) + "</td></tr>").join("");
    return "<section class=\"skill-evidence\"><h2>" + escapeHtml(labels.skillEvidence) + "</h2><p class=\"coverage-note\">" + escapeHtml(skillEvidenceNote(locale)) + "</p><table class=\"kami-table compact sortable skills-table\"><thead><tr><th scope=\"col\">Skill</th><th scope=\"col\">" + escapeHtml(labels.invocationCount) + "</th><th scope=\"col\">" + escapeHtml(labels.skillSessions) + "</th><th scope=\"col\">" + escapeHtml(labels.attributedTokens) + "</th><th scope=\"col\">" + escapeHtml(labels.attributedCost) + "</th></tr></thead><tbody>" + rows + "</tbody></table></section>";
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
        "<details><summary>" + escapeHtml(locale === "zh-CN" ? "查看小时明细 ↓" : "View hourly details ↓") + "</summary><table class=\"kami-table sortable\"><thead><tr><th>" +
        escapeHtml(locale === "zh-CN" ? "本地时间" : "Local time") + "</th><th>" + escapeHtml(labels.tokens) + "</th><th>" + escapeHtml(labels.calls) + "</th><th>" + escapeHtml(labels.share) + "</th></tr></thead><tbody>" +
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
    return "<div class=\"ivory-group rolling-activity\"><span class=\"tag tag--quiet\">" + escapeHtml(locale === "zh-CN" ? "本地活动" : "Local observation") + "</span><p class=\"coverage-note\">" + escapeHtml(labels.localOnly) + "</p><div class=\"window-note\"><span>" + escapeHtml(formatDateTime(rolling.startAt, locale) + " → " + formatDateTime(rolling.endAt, locale)) + "</span></div>" +
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
    return "<h3>" + escapeHtml(heading) + "</h3><table class=\"kami-table sortable\"><thead><tr><th>Key</th><th>" + escapeHtml(labels.currentWeek) + "</th><th>" +
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
                    composition: [turn.tokens.inputTokens, turn.tokens.cachedInputTokens, turn.tokens.outputTokens].map((value) => keyValueText(value, locale)).join(" / "),
                    duration: numericValue(turn.durationMs),
                    tools: numericValue(turn.toolCallCount),
                    result: resultSizeText(turn, locale),
                    event: events.join(" · "),
                    prompt: prompt?.content ?? null,
                    promptNote: prompt?.content === null
                        ? locale === "zh-CN" ? "首条用户消息内容不可用" : "The first user message content is unavailable"
                        : prompt ? "" : locale === "zh-CN" ? "日志未记录本轮独立的用户消息" : "No independent user message was recorded for this round",
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
        shareAxis: locale === "zh-CN" ? "Token 占比" : "Token share",
        unavailable: labels.unavailable,
    });
    return [
        "const keyUi=" + ui + ";",
        "const escapeTooltip=value=>String(value??'').replace(/[&<>]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[char])).replace(/\"/g,'&quot;').replace(/'/g,'&#39;');",
        "const fmtInt=value=>value==null?'—':new Intl.NumberFormat(d.locale,{maximumFractionDigits:0}).format(value);",
        "const fmtPct=value=>value==null?'—':Number(value).toFixed(2)+'%';",
        "const fmtDuration=value=>{if(value==null)return'—';const total=Math.max(0,Math.round(value/1000)),seconds=total%60,minutes=Math.floor(total/60)%60,hours=Math.floor(total/3600);if(d.locale==='zh-CN'){if(hours)return hours+'小时'+(minutes?minutes+'分钟':'')+(seconds?seconds+'秒':'');if(minutes)return Math.floor(total/60)+'分钟'+(seconds?seconds+'秒':'');return seconds+'秒'}if(hours)return hours+'h'+(minutes?' '+minutes+'m':'')+(seconds?' '+seconds+'s':'');if(minutes)return Math.floor(total/60)+'m'+(seconds?' '+seconds+'s':'');return seconds+'s'};",
        "d.keySessions.forEach(session=>{const tooltip=params=>{const item=Array.isArray(params)?params[0]:params;const turn=session.turns[item?.dataIndex??-1];if(!turn)return'';const prompt=turn.prompt===null?'<div class=\"key-session-tooltip-prompt key-session-tooltip-unavailable\"><div class=\"key-session-tooltip-label\">'+escapeTooltip(keyUi.firstUserMessage)+' · '+escapeTooltip(keyUi.unavailable)+'</div><div>'+escapeTooltip(turn.promptNote)+'</div></div>':'<div class=\"key-session-tooltip-prompt\"><div class=\"key-session-tooltip-label\">'+escapeTooltip(keyUi.firstUserMessage)+'</div><div class=\"key-session-tooltip-text\">'+escapeTooltip(turn.prompt)+'</div></div>';return'<div class=\"key-session-tooltip\"><div class=\"key-session-tooltip-title\">'+escapeTooltip(turn.label)+'</div><div class=\"key-session-tooltip-grid\"><span>'+escapeTooltip(keyUi.tokens)+'</span><b>'+fmtInt(turn.token)+'</b><span>'+escapeTooltip(keyUi.share)+'</span><b>'+fmtPct(turn.share)+'</b><span>'+escapeTooltip(keyUi.duration)+'</span><b>'+fmtDuration(turn.duration)+'</b><span>'+escapeTooltip(keyUi.tools)+'</span><b>'+(turn.tools==null?'—':fmtInt(turn.tools))+'</b><span>'+escapeTooltip(keyUi.result)+'</span><b>'+escapeTooltip(turn.result||'—')+'</b><span>'+escapeTooltip(keyUi.events)+'</span><b>'+escapeTooltip(turn.event||'—')+'</b></div>'+prompt+'</div>'};const shares=session.turns.map(turn=>({value:turn.share==null?0:turn.share,itemStyle:{color:turn.hot?p.brand:p.chartMuted,opacity:turn.share==null?.22:turn.hot?1:.78}}));const maxShare=Math.max(10,...session.turns.map(turn=>turn.share??0));make(session.chartId,{aria:{show:true,description:d.locale==='zh-CN'?'每个轮次的 Token 占比和本轮耗时轨迹；Tooltip 包含完整首条用户消息。':'Token share and round duration by round; the Tooltip includes the complete first user message.'},animationDuration:450,tooltip:{trigger:'axis',enterable:true,confine:true,backgroundColor:'#faf9f5',borderColor:'#e8e6dc',borderWidth:1,textStyle:{fontFamily:serifFont,color:p.darkWarm},axisPointer:{type:'shadow',shadowStyle:{color:'rgba(27,54,93,.08)'}},extraCssText:'max-width:min(460px,88vw);max-height:420px;overflow:auto;white-space:normal;border-radius:2px;box-shadow:0 8px 24px rgba(20,20,19,.12);padding:12px 14px;',formatter:tooltip},grid:{left:54,right:58,top:42,bottom:78,containLabel:true},xAxis:{type:'category',data:session.turns.map(turn=>turn.n==null?turn.label.replace(/^.*?([0-9]+)/,'$1'):String(turn.n)),axisLabel:{...axis.axisLabel,fontSize:11,hideOverlap:true},axisLine:axis.axisLine,axisTick:{show:false}},yAxis:[{type:'value',name:keyUi.shareAxis,max:Math.min(100,Math.max(10,Math.ceil(maxShare/5)*5)),axisLabel:{...axis.axisLabel,formatter:value=>value+'%'},axisLine:axis.axisLine,splitLine:{lineStyle:{color:'#e5e3d8'}}},{type:'value',name:keyUi.duration,axisLabel:{...axis.axisLabel,formatter:value=>Math.round(value/60000)+(d.locale==='zh-CN'?'分钟':'m')},axisLine:axis.axisLine,splitLine:{show:false}}],dataZoom:[{type:'inside',start:0,end:session.turns.length>14?42:100},{type:'slider',height:16,bottom:18,start:0,end:session.turns.length>14?42:100,borderColor:'#e8e6dc',fillerColor:'rgba(27,54,93,.14)',handleStyle:{color:p.brand},textStyle:{color:p.stone,fontFamily:serifFont}}],series:[{name:keyUi.shareAxis,type:'bar',yAxisIndex:0,barMaxWidth:22,data:shares,emphasis:{itemStyle:{color:p.brandLight,opacity:1}}},{name:keyUi.duration,type:'line',yAxisIndex:1,smooth:.18,symbol:'circle',symbolSize:5,data:session.turns.map(turn=>turn.duration),lineStyle:{color:p.olive,width:1.6},itemStyle:{color:p.olive},connectNulls:false}]})});",
    ].join("");
}
function renderInteractiveCharts(result, locale, firstUserMessages = []) {
    const labels = labelsFor(locale);
    const rows = result.report.dailyUsage.map((row) => ({
        time: formatDateKey(row.key, locale, false), total: numericValue(row.totalTokens), input: numericValue(row.inputTokens), cached: numericValue(row.cachedInputTokens), cacheWrite: numericValue(row.cacheWriteTokens), output: numericValue(row.outputTokens), unclassified: numericValue(row.unclassifiedTokens), cost: numericValue(row.apiEquivalentCost),
    }));
    const models = result.rankings.models.map((row) => ({ name: modelLabel(row.key, locale), value: numericValue(row.value), share: numericValue(row.sharePercent) }));
    const tools = result.report.tools.map((row) => ({ name: publicLabel(row.key, labels.unavailable), value: numericValue(row.injectedTokens) }));
    const keySessions = keySessionChartData(result, locale, firstUserMessages);
    const cost = result.report.apiEquivalentCost;
    const costVisible = typeof cost.total.value === "number";
    const data = scriptSafeJson({ rows, models, tools, keySessions, locale, labels: { input: labels.input, cached: labels.cachedInput, cacheWrite: labels.cacheWrite, output: labels.output, unclassified: locale === "zh-CN" ? "未分类部分" : "unclassified remainder", cost: locale === "zh-CN" ? "按 API 单价折算的估算金额（USD）" : "API-equivalent estimate (USD)" }, costVisible });
    const runtime = chartRuntime();
    if (!runtime || (rows.length === 0 && !keySessions.some((session) => session.turns.length > 0)))
        return "";
    const chartPalette = { brand: "#1b365d", brandLight: "#2d4e7a", olive: "#504e49", stone: "#6b6a64", darkWarm: "#3d3d3a", lightStone: "#b8b7b0", chartMuted: "#d4d3cd" };
    const unavailableLabel = JSON.stringify(locale === "zh-CN" ? "无数据" : "unavailable");
    const chartAria = JSON.stringify(locale === "zh-CN" ? "每条曲线和悬停值均为该分量原始 Token 值；各分量不堆叠。" : "Each curve and hover value is the raw Token value of that component; components are not stacked.");
    const chartScript = [
        "addEventListener('DOMContentLoaded',()=>{const d=", data, ";const p=", JSON.stringify(chartPalette), ";const serifFont=getComputedStyle(document.documentElement).getPropertyValue('--serif').trim();const compact=new Intl.NumberFormat(d.locale,{notation:'compact',maximumFractionDigits:2});",
        "const axis={axisLine:{lineStyle:{color:'#e8e6dc'}},axisLabel:{fontFamily:serifFont,color:p.stone}};",
        "const make=(id,option)=>{const el=document.getElementById(id);if(!el||!window.echarts)return;const c=echarts.init(el,null,{renderer:'svg'});c.setOption({backgroundColor:'transparent',textStyle:{fontFamily:serifFont,color:p.olive},...option});addEventListener('resize',()=>c.resize())};",
        "const tooltip=params=>params.map(item=>item.value==null?item.seriesName+': '+" + unavailableLabel + ":item.seriesName===d.labels.cost?item.seriesName+': $'+compact.format(item.value):item.seriesName+': '+compact.format(item.value)).join('<br>');",
        "const series=[['input',d.labels.input,p.brand,'solid','circle',true],['cached',d.labels.cached,p.stone,'dashed','rect',false],['cacheWrite',d.labels.cacheWrite,p.olive,'dotted','diamond',false],['output',d.labels.output,p.brandLight,'solid','triangle',false],['unclassified',d.labels.unclassified,p.lightStone,'dashed','emptyCircle',false]].map(([key,name,color,lineType,symbol,focus])=>({name,type:'line',smooth:false,symbol,showSymbol:d.rows.length<=14,symbolSize:5,lineStyle:{color,width:focus?2.5:2,opacity:focus?1:.92,type:lineType},itemStyle:{color},...(focus?{areaStyle:{color,opacity:.1}}:{}),emphasis:{focus:'series',lineStyle:{color,width:3,opacity:1},...(focus?{areaStyle:{color,opacity:.12}}:{})},data:d.rows.map(r=>r[key])}));",
        "if(d.costVisible)series.push({name:d.labels.cost,type:'line',yAxisIndex:1,symbol:'diamond',showSymbol:d.rows.length<=14,symbolSize:5,connectNulls:false,data:d.rows.map(r=>r.cost),lineStyle:{color:p.darkWarm,width:2,type:'dashed'},itemStyle:{color:p.darkWarm},emphasis:{focus:'series',lineStyle:{color:p.darkWarm,width:3,opacity:1}}});",
        "if(d.rows.length)make('token-trend',{aria:{show:true,description:", chartAria, "},tooltip:{trigger:'axis',backgroundColor:'#faf9f5',borderColor:'#e8e6dc',borderWidth:1,textStyle:{fontFamily:serifFont,color:p.darkWarm},formatter:tooltip},legend:{type:'scroll',textStyle:{fontFamily:serifFont,color:p.olive},itemWidth:28,itemHeight:8},grid:{left:56,right:d.costVisible?64:22,top:42,bottom:48,containLabel:true},xAxis:{type:'category',data:d.rows.map(r=>r.time),axisLabel:{...axis.axisLabel,hideOverlap:true},axisLine:axis.axisLine},yAxis:[{type:'value',name:'Token',axisLabel:{...axis.axisLabel,formatter:v=>compact.format(v)},axisLine:axis.axisLine,splitLine:{lineStyle:{color:'#e5e3d8'}}},...(d.costVisible?[{type:'value',name:'USD',axisLabel:{...axis.axisLabel,formatter:v=>'$'+compact.format(v)},axisLine:axis.axisLine,splitLine:{show:false}}]:[])],series});",
        "make('model-chart',{aria:{show:true,description:", JSON.stringify(locale === "zh-CN" ? "按模型的 Token 分布；下方表格提供等价数据。" : "Token distribution by model; the table below provides equivalent data."), "},tooltip:{trigger:'axis',backgroundColor:'#faf9f5',borderColor:'#e8e6dc',borderWidth:1,textStyle:{fontFamily:serifFont,color:p.darkWarm},valueFormatter:v=>compact.format(v)},grid:{left:24,right:24,top:18,bottom:48,containLabel:true},xAxis:{type:'category',data:d.models.map(r=>r.name),axisLabel:{...axis.axisLabel,interval:0,rotate:24,hideOverlap:true},axisLine:axis.axisLine},yAxis:{type:'value',axisLabel:{...axis.axisLabel,formatter:v=>compact.format(v)},axisLine:axis.axisLine,splitLine:{lineStyle:{color:'#e5e3d8'}}},series:[{type:'bar',barMaxWidth:42,data:d.models.map(r=>r.value),itemStyle:{color:p.brand}}]});",
        "if(d.models.length>0&&d.models.length<=6)make('model-share-chart',{aria:{show:true,description:", JSON.stringify(locale === "zh-CN" ? "按模型查看 Token 占比；悬停可查看精确 Token 和占比。" : "Token share by model; hover to inspect exact Tokens and share."), "},color:[p.brand,p.brandLight,p.olive,p.stone,p.lightStone,p.chartMuted],tooltip:{trigger:'item',backgroundColor:'#faf9f5',borderColor:'#e8e6dc',borderWidth:1,textStyle:{fontFamily:serifFont,color:p.darkWarm},formatter:item=>item.name+': '+compact.format(item.value)+' ('+item.percent.toFixed(2)+'%)'},legend:{type:'scroll',orient:'vertical',right:0,top:24,bottom:24,textStyle:{fontFamily:serifFont,color:p.olive}},series:[{type:'pie',radius:['48%','72%'],center:['36%','50%'],label:{show:false},emphasis:{label:{show:true,color:p.darkWarm,fontFamily:serifFont,formatter:item=>item.percent.toFixed(2)+'%'}},itemStyle:{borderColor:'#f5f4ed',borderWidth:2},data:d.models.map(r=>({name:r.name,value:r.value}))}]});",
        "make('tool-chart',{aria:{show:true,description:", JSON.stringify(locale === "zh-CN" ? "按工具统计工具结果被算入上下文的估算大小；下方表格提供对应数据。" : "Estimated tool-result injection by tool; the table below provides equivalent data."), "},tooltip:{trigger:'axis',backgroundColor:'#faf9f5',borderColor:'#e8e6dc',borderWidth:1,textStyle:{fontFamily:serifFont,color:p.darkWarm},valueFormatter:v=>compact.format(v)},grid:{left:96,right:24,top:18,bottom:18,containLabel:true},xAxis:{type:'value',axisLabel:{...axis.axisLabel,formatter:v=>compact.format(v)},axisLine:axis.axisLine,splitLine:{lineStyle:{color:'#e5e3d8'}}},yAxis:{type:'category',data:d.tools.map(r=>r.name),axisLabel:{...axis.axisLabel,width:88,overflow:'truncate'},axisLine:axis.axisLine},series:[{type:'bar',barMaxWidth:42,data:d.tools.map(r=>r.value),itemStyle:{color:p.brandLight}}]});",
        keyChartScript(locale),
        "document.querySelectorAll('table.sortable').forEach(table=>{const headers=[...table.tHead.rows[0].cells];headers.forEach((th,index)=>{const label=th.textContent.trim();const b=document.createElement('button');b.type='button';b.className='sort-button';b.textContent=label;b.setAttribute('aria-label',label+' sort');th.textContent='';th.append(b);b.onclick=()=>{const asc=th.getAttribute('aria-sort')!=='ascending';headers.forEach(h=>h.removeAttribute('aria-sort'));th.setAttribute('aria-sort',asc?'ascending':'descending');const rows=[...table.tBodies[0].rows].map((row,order)=>({row,order,key:(row.cells[index].querySelector('[data-sort]')?.getAttribute('data-sort')??row.cells[index].getAttribute('data-sort')??row.cells[index].textContent.trim())}));rows.sort((a,b)=>{const an=Number(a.key),bn=Number(b.key),am=a.key===''||a.key==='unavailable',bm=b.key===''||b.key==='unavailable';if(am||bm)return am===bm?a.order-b.order:am?1:-1;const cmp=Number.isFinite(an)&&Number.isFinite(bn)?an-bn:a.key.localeCompare(b.key,d.locale);return cmp===0?a.order-b.order:(asc?cmp:-cmp)});rows.forEach(x=>table.tBodies[0].append(x.row))}})})});</script>"
    ].join('');
    const script = "<script>" + runtime + "</script><script>" + chartScript;
    return `<div id="token-trend" class="echart" role="img" aria-label="${escapeHtml(labels.dailyUsage)}"></div><p class="chart-summary">${escapeHtml(locale === "zh-CN" ? "每条线的纵坐标和悬停值都是该 Token 分量自身的值；各分量不堆叠。" : "Each curve and hover value is the raw Token value of that component; components are not stacked.")}</p>${script}`;
}
function renderStyles() {
    const fontFaces = authorizedFontFaces();
    return `<style>${fontFaces}
:root{color-scheme:light;--parchment:#f5f4ed;--ivory:#faf9f5;--warm-sand:#e8e6dc;--inline-code:#f0eee6;--deep-dark:#141413;--brand:#1b365d;--brand-light:#2d4e7a;--near-black:#141413;--dark-warm:#3d3d3a;--olive:#504e49;--stone:#6b6a64;--border:#e8e6dc;--border-soft:#e5e3d8;--tag-bg:#e4ecf5;--tag-quiet:#eef2f7;--brand-tint:#eef2f7;--chart-muted:#d4d3cd;--serif:Charter,Georgia,Palatino,"Times New Roman",serif;--sans:var(--serif);--mono:"JetBrains Mono","SF Mono","Fira Code",Consolas,Monaco,monospace}
html[lang="zh-CN"]{--serif:"TsangerJinKai02","Source Han Serif SC","Source Han Serif CN","Noto Serif CJK SC","Noto Serif SC","Songti SC","STSong",Georgia,serif;--sans:var(--serif)}
*{box-sizing:border-box}html,body{margin:0;padding:0}body{background:var(--parchment);color:var(--near-black);font-family:var(--serif);font-size:15px;font-weight:400;line-height:1.55;letter-spacing:0;font-synthesis:none;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}html[lang="zh-CN"] body{letter-spacing:.3px}
main{max-width:1120px;margin:0 auto;padding:56px 64px 120px}.report-header{margin:0 0 24px;break-inside:avoid}.report-header__main{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,.36fr);gap:48px;align-items:start}.report-eyebrow{display:flex;align-items:baseline;gap:7px;font-family:var(--sans);font-size:12px;font-weight:500;line-height:1.2;letter-spacing:.5px;text-transform:none;color:var(--brand);margin:0 0 14px}.report-eyebrow__rule{display:inline-block;flex:0 0 11px;width:11px;height:1px;background:var(--brand);transform:translateY(-2px)}.report-header h1{display:flex;align-items:baseline;gap:7px;margin:0 0 9px;line-height:1.05;letter-spacing:-.2px}.report-header__project{font-size:36px;font-weight:500;color:var(--near-black)}.report-header__suffix{font-size:16px;font-weight:400;color:var(--stone);white-space:nowrap}.report-deck{max-width:none;font-family:var(--serif);font-size:14px;line-height:1.35;color:var(--olive);margin:0;white-space:nowrap}.report-header__primary{align-self:start;padding-top:0;text-align:right}.report-header__value{display:block;color:var(--near-black);font-family:var(--serif);font-size:36px;font-weight:500;line-height:1;font-variant-numeric:lining-nums tabular-nums;white-space:nowrap}.report-header__value .metric-main{font-size:inherit}.report-header__primary-label{display:block;margin-top:7px;color:var(--olive);font-size:12px;line-height:1.25;white-space:nowrap}.report-header__primary-label .metric-main{font-size:inherit;color:inherit}.report-header__primary-date{display:block;margin-top:5px;color:var(--stone);font-size:12px;line-height:1.25;white-space:nowrap}.report-header__metrics{display:grid;grid-template-columns:1.15fr .95fr 1.18fr 1fr;gap:24px;margin-top:16px;padding:18px 0 17px;border-top:.5px solid var(--border);border-bottom:.5px solid var(--border)}.report-header__metric{display:flex;align-items:baseline;gap:6px;min-width:0;white-space:nowrap}.report-header__metric-value{color:var(--brand);font-family:var(--serif);font-weight:500;line-height:1;font-variant-numeric:lining-nums tabular-nums}.report-header__metric-value .metric-main,.report-header__metric-value .percentage{font-size:18px}.report-header__metric-label{color:var(--olive);font-size:12px;line-height:1.35;white-space:nowrap}h1,h2,h3{font-family:var(--serif);font-weight:500;color:var(--near-black)}h1{font-size:38px;line-height:1.1;letter-spacing:-.4px;margin:0 0 12px}h2{font-size:24px;line-height:1.2;margin:0 0 20px}h3{font-size:18px;line-height:1.3;margin:32px 0 12px}section{margin:0 0 56px;padding:0;background:transparent;border:0;border-radius:0}section>h2{margin-top:0}
.metadata-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;margin:0 0 32px}.metadata-grid div{padding:0 16px 14px 0;border-bottom:1px solid var(--border-soft)}.metadata-grid dt,.metric-label{color:var(--stone);font-size:12px;line-height:1.35}.metadata-grid dd{margin:6px 0 0;font-weight:500;line-height:1.45;overflow-wrap:anywhere}
.metrics{display:grid;gap:24px;margin:0 0 24px}.metrics--summary{grid-template-columns:repeat(3,minmax(0,1fr));gap:32px 28px;margin-bottom:56px}.metrics--coverage{grid-template-columns:repeat(5,minmax(0,1fr));margin-bottom:16px}.metrics--economic{grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 24px;margin-bottom:0}.metrics--first-request{grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:24px}.metrics--group{grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:0}.metrics--window{grid-template-columns:repeat(5,minmax(0,1fr));margin-bottom:0}.metric{min-width:0}.metric-label{display:block}.metric-value{display:block;margin-top:6px;font-family:var(--serif);font-size:22px;font-weight:500;line-height:1.1;color:var(--brand);font-variant-numeric:lining-nums tabular-nums}.metrics--summary .metric-value{font-size:32px}.metrics--coverage .metric-value,.metrics--window .metric-value{font-size:24px}.metric-stack{display:inline-flex;flex-direction:column;align-items:flex-start;gap:2px;font-variant-numeric:lining-nums tabular-nums}.metric-main{display:block}.percentage{display:block;white-space:nowrap}.unavailable{color:var(--stone);font-style:normal}.finding-evidence{display:inline-flex;vertical-align:baseline;flex-direction:column;align-items:flex-start;gap:1px;margin:0 2px;color:inherit;font-size:inherit;line-height:1.2}.finding-value{display:inline;margin:0;color:inherit;font-size:inherit}.coverage-percentage{display:inline-flex;align-items:baseline;gap:2px;font-variant-numeric:lining-nums tabular-nums}
.comparison-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;margin:24px 0 0}.ivory-group{background:var(--ivory);border:0;border-radius:10px;padding:20px 22px;break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact}.ivory-group h3{margin:0 0 16px}.ivory-group .metrics{margin-bottom:0}.rolling-activity .coverage-note{margin:10px 0 12px}.rolling-activity .window-note{justify-content:flex-start;margin-bottom:18px}
.coverage-note,.empty,.report-method-note{color:var(--olive);font-size:13px;line-height:1.5}.report-method-note{margin:16px 0 0;color:var(--stone)}.quiet-callout{background:var(--ivory);border:0;border-radius:8px;padding:12px 16px;margin:16px 0 0;color:var(--dark-warm)}.quiet-callout p{margin:8px 0 0}.quiet-callout .finding-evidence{vertical-align:middle}.tag{display:inline-block;border:0;border-radius:2px;padding:2px 6px;font-family:var(--sans);font-size:11px;font-weight:500;line-height:1.35;color:var(--brand);white-space:nowrap}.tag--quiet{background:var(--tag-quiet)}.tag--default{background:var(--tag-bg)}
.editorial-list{margin:12px 0 0;padding-left:20px;color:var(--olive);font-size:13px;line-height:1.5}.editorial-list li+li{margin-top:8px}.supporting-findings ul{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 32px;list-style:none;margin:0;padding:0}.editorial-item{padding:18px 0;border-top:1px solid var(--border-soft)}.editorial-tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}.editorial-title{display:block;font-size:16px;font-weight:500;line-height:1.4}.editorial-detail{margin:6px 0 0;color:var(--olive);font-size:14px;line-height:1.5}.editorial-method{display:block;margin-top:8px;color:var(--stone);font-size:12px;line-height:1.45}
.kami-table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px;line-height:1.45;font-variant-numeric:lining-nums tabular-nums}.kami-table th,.kami-table td{text-align:left;border-bottom:.5px solid var(--border-soft);padding:8px 0 8px 16px;vertical-align:top}.kami-table th:first-child,.kami-table td:first-child{padding-left:0}.kami-table thead th{color:var(--dark-warm);font-size:12px;font-weight:500;line-height:1.35;border-bottom:1px solid var(--border)}.kami-table th:not(:first-child),.kami-table td:not(:first-child){text-align:right}.kami-table tbody th{font-weight:500;text-align:left}.kami-table tbody tr:last-child th,.kami-table tbody tr:last-child td{border-bottom:0}.kami-table.skills-table th:nth-child(2),.kami-table.skills-table td:nth-child(2),.kami-table.skills-table th:nth-child(9),.kami-table.skills-table td:nth-child(9),.kami-table.skills-table th:nth-child(10),.kami-table.skills-table td:nth-child(10){text-align:left}.kami-table.compact th,.kami-table.compact td{padding-top:6px;padding-bottom:6px}.sortable button{appearance:none;border:0;background:transparent;color:inherit;font:inherit;font-weight:500;padding:0;cursor:pointer;text-align:left;width:100%}.sort-button::after{color:var(--stone);font-size:.9em;font-weight:400}.kami-table th:not([aria-sort]) .sort-button:hover::after,.kami-table th:not([aria-sort]) .sort-button:focus-visible::after{content:" ↕"}.kami-table th[aria-sort="ascending"] .sort-button::after{content:" ↑"}.kami-table th[aria-sort="descending"] .sort-button::after{content:" ↓"}.kami-table th:not(:first-child) button{text-align:right}.sortable button:focus-visible,summary:focus-visible{outline:2px solid var(--brand);outline-offset:3px}.empty{margin:8px 0}
.echart{width:100%;height:300px;margin:0 0 12px;background:transparent;border:0;border-radius:0}.chart-summary{color:var(--olive);font-size:12px;line-height:1.45}.chart{display:block;width:100%;height:auto;margin:0 0 20px;background:transparent;border-radius:0;padding:0;overflow:visible}.chart-label,.chart-value,.heat-hour{font-family:var(--serif);font-size:12px;fill:var(--stone)}.chart-value{font-variant-numeric:lining-nums tabular-nums;fill:var(--near-black)}.chart-bar{fill:var(--brand)}.chart-track{fill:var(--border)}.segment-input{fill:var(--brand)}.segment-cached{fill:var(--stone)}.segment-cache-write{fill:var(--olive)}.segment-output{fill:var(--brand-light)}.segment-reasoning{fill:var(--chart-muted)}.heat-0{fill:var(--parchment)}.heat-1{fill:var(--tag-quiet)}.heat-2{fill:var(--tag-bg)}.heat-3{fill:var(--stone)}.heat-4{fill:var(--brand)}
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
.report-deck{max-width:820px;font-size:18px;line-height:1.5;color:var(--olive);margin:0;white-space:normal;letter-spacing:.3px}
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
@media(max-width:480px){section{margin-bottom:48px}section > h2{font-size:24px;margin-bottom:20px}section > h3{font-size:16px;margin:24px 0 12px}.metrics--coverage,.metrics--summary,.metrics--window{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.metrics--summary{margin-bottom:32px}.metrics--summary .metric-value,.metrics--coverage .metric-value,.metrics--window .metric-value{font-size:30px}.ivory-group{padding:20px}.editorial-item{padding:18px 0}}
html,body{overflow-x:clip}
.model-chart-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(260px,.85fr);gap:32px;align-items:center}.model-chart-grid .echart{min-width:0}
.kami-table th,.kami-table td{padding-top:10px;padding-bottom:10px}
.echart{max-width:100%;overflow:hidden}
.key-session-analysis-section{margin-top:72px}
.key-session-module-head{padding:28px 0 26px;border-bottom:.5px solid var(--border)}
.key-session-module-kicker{display:block;margin-bottom:10px;color:var(--stone);font-family:var(--sans);font-size:12px;font-weight:500;letter-spacing:.08em}
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
.session-summary-title{font-size:18px;line-height:1.4;font-weight:600}
.session-summary-id{color:var(--stone);font:12px/1.5 var(--mono);overflow-wrap:anywhere}
.key-session-entry>summary small{flex:0 0 auto;color:var(--stone);font-size:12px;font-weight:400}
.key-session-content{padding-bottom:6px}
.key-session-head{padding:28px 0 26px;border-bottom:.5px solid var(--border)}
.key-session-heading{display:grid;grid-template-columns:minmax(0,1fr) minmax(170px,.32fr);gap:32px;align-items:end}
.session-rank{display:block;margin-bottom:12px;color:var(--stone);font-family:var(--sans);font-size:12px;font-weight:500;letter-spacing:.08em}
.key-session-heading .session-title{margin:0 0 10px;font-size:18px;line-height:1.4;font-weight:600}
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
.fact-line{margin:0 0 12px;padding-left:14px;border-left:2px solid var(--brand);color:var(--dark-warm)}
.fact-line strong{font-weight:500}
.quiet{margin:0;color:var(--olive);font-size:13px;line-height:1.5}
.key-session-judgment .action h4{max-width:38ch;margin:0 0 12px;font-size:20px;font-weight:500;line-height:1.35}
.action-copy{max-width:70ch;margin:0;color:var(--dark-warm)}
.applicability{margin:12px 0 0;color:var(--stone);font-size:13px}
.verify{max-width:78ch;margin:18px 0 0;padding-top:13px;border-top:.5px solid var(--border);color:var(--olive);font-size:13px;line-height:1.5}
.verify .analysis-label{display:inline;margin:0 10px 0 0;color:var(--stone);font-size:11px}
.analysis-unavailable{margin:0;color:var(--stone);font-size:14px;line-height:1.5}
.key-session-chart-frame{margin:0;border-top:.5px solid var(--border)}
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
.turn-detail-table tr.hot-row>th:first-child,.turn-detail-table tr.hot-row>td:nth-child(2),.turn-detail-table tr.hot-row>td:nth-child(3){font-weight:600}
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
details > .kami-table{margin-top:16px}
@media(max-width:480px){.kami-table{display:block;width:max-content;min-width:100%;max-width:100%;overflow-x:auto;white-space:nowrap}.echart{height:260px}}
@media(max-width:880px){.model-chart-grid{grid-template-columns:1fr;gap:18px}}
@media(scripting:none){details > :not(summary){display:block}}
@media print{.echart{display:none}details > :not(summary){display:block}details > summary{display:none}.kami-table{display:table;width:100%;max-width:none;white-space:normal;overflow:visible}}
</style>`;
}
function renderHtml(result, locale = "en-US", composition, localFirstUserMessages) {
    const labels = labelsFor(locale);
    const prompts = result.view === "share" ? [] : localFirstUserMessages ?? composition?.firstUserMessages ?? [];
    const modelBars = result.rankings.models.map((row) => ({ key: modelLabel(row.key, locale), value: row.value }));
    const parts = [
        "<!doctype html><html lang=\"" + (locale === "zh-CN" ? "zh-CN" : "en") + "\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" +
            escapeHtml(labels.title) + "</title>" + renderStyles() + "</head><body><main>",
        renderReportHeader(result, locale),
        "<section><h2>" + escapeHtml(labels.scope) + "</h2>" + renderScope(result, locale) + "<h2>" + escapeHtml(labels.coverage) + "</h2>" + renderCoverage(result, locale) + "<p class=\"report-method-note\">" + escapeHtml(labels.methodNote) + "</p></section>",
        renderKpis(result, locale),
        renderChecks(result, locale),
        renderCacheHtml(result, locale),
        renderFirstRequestHtml(result, locale),
        renderSkillsHtml(result, locale),
        result.weekComparison ? "<section><h2>" + escapeHtml(labels.weekView) + "</h2>" + renderWeek(result, locale) + "</section>" : "",
        "<section><h2>" + escapeHtml(labels.time) + "</h2><h3>" + escapeHtml(labels.dailyUsage) + "</h3>" +
            renderInteractiveCharts(result, locale, prompts) + renderDaily(result, locale) +
            "<h3>" + escapeHtml(labels.hourlyActivity) + "</h3>" + renderHourly(result, locale) +
            "<h3>" + escapeHtml(labels.observedActivity) + "</h3>" + renderRolling(result, locale) + "</section>",
        "<section><h2>" + escapeHtml(labels.models) + "</h2><div class=\"model-chart-grid\"><div id=\"model-chart\" class=\"echart\" role=\"img\" aria-label=\"" + escapeHtml(labels.models) + "\"></div>" +
            (result.rankings.models.length > 0 && result.rankings.models.length <= 6 ? "<div id=\"model-share-chart\" class=\"echart\" role=\"img\" aria-label=\"" + escapeHtml(locale === "zh-CN" ? "按模型查看 Token 占比" : "Token share by model") + "\"></div>" : "") +
            "</div>" + renderModels(result, locale) + "</section>",
        "<section class=\"tool-impact\"><h2>" + escapeHtml(labels.tools) + "</h2><div id=\"tool-chart\" class=\"echart\" role=\"img\" aria-label=\"" + escapeHtml(locale === "zh-CN" ? "按工具统计工具结果被算入上下文的估算大小" : "Estimated tool-result injection by tool") + "\"></div>" + renderTools(result, locale) + "</section>",
        "<section><h2>" + escapeHtml(labels.sessionsByUsage) + "</h2>" + renderSessions(result, locale) + "</section>",
        renderKeySessionAnalysis(result, locale, composition, prompts),
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
        (locale === "zh-CN" ? "审计：" : "Audit: ") + result.scope.harness + "; " + (result.scope.allProjects ? labels.allProjects : labels.currentProject) + "; " + labels.since + " " + formatDateTime(result.scope.since, locale),
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
        lines.push((locale === "zh-CN" ? "主要 Session" : "Top Session") + ": " + sessionLabel(topSession, locale) +
            "; " + evidencePlain(topSession.value, locale, false) + "; " + (locale === "zh-CN" ? "占比" : "share") + ": " +
            percentageText(topSession.sharePercent, locale) + ".");
    }
    const modelSummary = result.rankings.models.slice(0, 5)
        .map((entry) => modelLabel(entry.key, locale) + ": " + formatExact(entry.value.value, locale) + " " + labels.tokens + " (" + percentageText(entry.sharePercent, locale) + ")")
        .join(", ");
    if (modelSummary)
        lines.push((locale === "zh-CN" ? labels.models : "Models") + ": " + modelSummary + ".");
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
function redactedModelKey(row) {
    return publicLabel(row.key, "other-model");
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
        lines.push("| " + redactedModelKey(row) + " | " + evidencePlain(row.value, locale, false) + " | " + percentageText(row.sharePercent, locale) + " |");
    lines.push("", "## " + labels.time, "", "| " + labels.date + " | " + labels.tokens + " | " + labels.share + " |", "| --- | ---: | ---: |");
    for (const row of result.report.dailyUsage)
        lines.push("| " + formatDateKey(row.key, locale) + " | " + evidencePlain(row.totalTokens, locale, false) + " | " + percentageText(row.sharePercent, locale) + " |");
    lines.push("", "## " + labels.tools, "", "| Tool category | " + labels.calls + " | " + labels.amplified + " | " + labels.share + " |", "| --- | ---: | ---: |");
    for (const row of result.report.tools)
        lines.push("| " + publicLabel(row.key, "other-tool") + " | " + evidencePlain(row.calls, locale, false) + " | " + evidencePlain(row.amplifiedTokens, locale, false) + " | " + percentageText(row.sharePercent, locale) + " |");
    lines.push("", "## " + labels.skillEvidence, "");
    if (result.report.skills.length === 0) {
        lines.push(labels.noSkillEvidence);
    }
    else {
        lines.push(skillEvidenceNote(locale));
        lines.push("| Skill | " + labels.invocationCount + " | " + labels.skillSessions + " | " + labels.attributedTokens + " | " + labels.attributedCost + " |", "| --- | ---: | ---: | ---: | ---: |");
        for (const skill of result.report.skills)
            lines.push("| " + skillLabel(skill.name, locale) + " | " + evidencePlain(skill.invocationCount, locale, false) + " | " + evidencePlain(skill.sessionCount, locale, false) + " | " + evidencePlain(skill.attributedTokens, locale, false) + " | " + currencyPlain(skill.attributedApiEquivalentCost, locale, false) + " |");
    }
    lines.push((locale === "zh-CN" ? "缓存方法：" : "Cache method: ") + methodText(result.report.cacheEconomics.cacheReadRatePercent, locale) + "; " + methodText(result.report.cacheEconomics.observedApiEquivalentCost, locale));
    lines.push((locale === "zh-CN" ? "首次请求方法：" : "First-request method: ") + methodText(result.report.firstRequestBurden.medianTokens, locale));
    if (result.report.cacheEconomics.limitations.length > 0)
        lines.push((locale === "zh-CN" ? "缓存限制：" : "Cache limitations: ") + result.report.cacheEconomics.limitations.map((limitation) => localizeLimitation(limitation, locale)).join("; "));
    if (result.report.firstRequestBurden.limitations.length > 0)
        lines.push((locale === "zh-CN" ? "首次请求限制：" : "First-request limitations: ") + result.report.firstRequestBurden.limitations.map((limitation) => localizeLimitation(limitation, locale)).join("; "));
    lines.push("", "## " + labels.diagnosticSignals);
    for (const check of result.checks)
        lines.push("- " + checkLine(check, locale));
    lines.push("", labels.privacyNote);
    return lines.join("\n") + "\n";
}
