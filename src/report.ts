import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  AutomatedCheck,
  AuditResult,
  AuditSnapshot,
  AuditView,
  ContributionEntry,
  EvidenceValue,
  ReportLocale,
  ToolAnalysisEntry,
  WeekComparison,
  WeekStructureChange,
} from "./types";

interface Labels {
  title: string;
  scope: string;
  coverage: string;
  currentProject: string;
  allProjects: string;
  since: string;
  harness: string;
  files: string;
  records: string;
  skipped: string;
  partialSessions: string;
  totalTokens: string;
  sessions: string;
  topLevelSessions: string;
  subagentSessions: string;
  modelCalls: string;
  reportedCost: string;
  noFinding: string;
  time: string;
  dailyUsage: string;
  hourlyActivity: string;
  models: string;
  tools: string;
  toolImpactNote: string;
  sessionsByUsage: string;
  limitations: string;
  provenance: string;
  privacy: string;
  unavailable: string;
  exact: string;
  tokens: string;
  share: string;
  calls: string;
  pairedResults: string;
  errors: string;
  injected: string;
  amplified: string;
  observedActivity: string;
  localOnly: string;
  providerQuota: string;
  resetTime: string;
  input: string;
  cachedInput: string;
  cacheWrite: string;
  output: string;
  reasoning: string;
  date: string;
  model: string;
  session: string;
  kindLongSession: string;
  kindToolAmplification: string;
  kindExtraCalls: string;
  reported: string;
  derived: string;
  estimated: string;
  unavailableProvenance: string;
  noData: string;
  noTimestampData: string;
  noToolData: string;
  noQuota: string;
  checksNote: string;
  diagnosticSignals: string;
  privacyNote: string;
  methodNote: string;
  usageView: string;
  windowView: string;
  toolsView: string;
  reportWritten: string;
  weekView: string;
  currentWeek: string;
  previousWeek: string;
  change: string;
  noComparison: string;
  redactedShare: string;
}

const ZH: Labels = {
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
  topLevelSessions: "顶层任务",
  subagentSessions: "子 Agent Session",
  modelCalls: "模型调用",
  reportedCost: "记录成本",
  noFinding: "现有证据不支持明确的主要原因。",
  time: "时间分布",
  dailyUsage: "每日 Token 趋势",
  hourlyActivity: "小时活动热图",
  models: "模型分布",
  tools: "工具上下文影响",
  toolImpactNote: "注入估算是工具结果加入上下文的大小；放大估算是其在同一活跃上下文后续调用中可能重复携带的量。两者均不是账单，也不是最终问题结论。",
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
  input: "普通输入",
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
  checksNote: "这些是自动发现；Host Agent 会结合你的问题和完整 Evidence 在对话中给出综合判断。",
  diagnosticSignals: "Findings",
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

const EN: Labels = {
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
  toolImpactNote: "The injected estimate is the tool-result size added to context; the amplified estimate is how much it may be carried by later calls in the same active context. Neither is a bill or a final problem conclusion.",
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

export interface ReportProjection {
  result: AuditResult;
  locale: ReportLocale;
  labels: Labels;
  finding: {
    kind: string;
    title: string;
    explanation: string;
    } | null;
}

export function normalizeLocale(value?: string): ReportLocale {
  return value && value.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

function labelsFor(locale: ReportLocale): Labels {
  return locale === "zh-CN" ? ZH : EN;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function numberFormatter(locale: ReportLocale): Intl.NumberFormat {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
}

export function formatCompact(value: number | null, locale: ReportLocale): string {
  if (value === null || !Number.isFinite(value)) return labelsFor(locale).unavailable;
  const absolute = Math.abs(value);
  if (locale === "zh-CN" && absolute >= 100000000) return numberFormatter(locale).format(value / 100000000) + "亿";
  if (locale === "zh-CN" && absolute >= 10000) return numberFormatter(locale).format(value / 10000) + "万";
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatExact(value: number | string | null, locale: ReportLocale): string {
  if (value === null) return labelsFor(locale).unavailable;
  return typeof value === "number" ? new Intl.NumberFormat(locale, { maximumFractionDigits: 20 }).format(value) : String(value);
}

function formatDateKey(value: string, locale: ReportLocale): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatDateTime(value: string, locale: ReportLocale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
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

function provenanceLabel(provenance: EvidenceValue["provenance"], locale: ReportLocale): string {
  const labels = labelsFor(locale);
  return provenance === "reported"
    ? labels.reported
    : provenance === "derived"
      ? labels.derived
      : provenance === "estimated"
        ? labels.estimated
        : labels.unavailableProvenance;
}

function evidencePlain(value: EvidenceValue, locale: ReportLocale, compact = true): string {
  if (value.value === null) return labelsFor(locale).unavailable;
  const raw = typeof value.value === "number"
    ? compact ? formatCompact(value.value, locale) : formatExact(value.value, locale)
    : String(value.value);
  return (value.provenance === "estimated" ? "≈ " : "") + raw + " (" + provenanceLabel(value.provenance, locale) + ")";
}

function metricPlain(value: EvidenceValue, locale: ReportLocale, compact = true): string {
  if (value.value === null) return labelsFor(locale).unavailable;
  const raw = typeof value.value === "number"
    ? compact ? formatCompact(value.value, locale) : formatExact(value.value, locale)
    : String(value.value);
  return (value.provenance === "estimated" ? "≈ " : "") + raw;
}

function evidenceHtml(value: EvidenceValue, locale: ReportLocale, compact = true): string {
  const labels = labelsFor(locale);
  if (value.value === null) {
    return "<span class=\"metric-stack\" data-provenance=\"unavailable\"><span class=\"unavailable\">" + escapeHtml(labels.unavailable) + "</span></span>";
  }
  const compactValue = typeof value.value === "number" && compact ? formatCompact(value.value, locale) : formatExact(value.value, locale);
  const exactValue = formatExact(value.value, locale);
  const prefix = value.provenance === "estimated" ? "≈ " : "";
  const estimate = value.provenance === "estimated"
    ? "<small class=\"estimate\">" + escapeHtml(labels.estimated) + "</small>"
    : "";
  return "<span class=\"metric-stack\" data-provenance=\"" + value.provenance + "\" data-sort=\"" + (typeof value.value === "number" ? String(value.value) : "") + "\"><span class=\"metric-main\" title=\"" +
    escapeHtml(labels.exact + (locale === "zh-CN" ? "：" : ": ") + exactValue) + "\">" +
    escapeHtml(prefix + compactValue) + "</span>" + estimate + "</span>";
}

function percentageHtml(value: EvidenceValue, locale: ReportLocale): string {
  const labels = labelsFor(locale);
  if (value.value === null) return evidenceHtml(value, locale, false);
  const prefix = value.provenance === "estimated" ? "≈ " : "";
  const estimate = value.provenance === "estimated"
    ? "<small class=\"estimate\">" + escapeHtml(labels.estimated) + "</small>"
    : "";
  return "<span class=\"metric-stack\" data-provenance=\"" + value.provenance + "\" data-sort=\"" + String(value.value) + "\"><span class=\"percentage\">" +
    escapeHtml(prefix + formatExact(value.value, locale) + "%") + "</span>" + estimate + "</span>";
}

function publicLabel(value: string, fallback: string): string {
  return value.length <= 80 && /^[A-Za-z0-9_.:@-]+$/.test(value) ? value : fallback;
}

function modelLabel(value: string, locale: ReportLocale): string {
  if (value === "<unknown-model>") return locale === "zh-CN" ? "未知模型" : "Unknown model";
  return publicLabel(value, labelsFor(locale).unavailable);
}

function emptyState(labels: Labels, message = labels.noData): string {
  return "<p class=\"empty\">" + escapeHtml(message) + "</p>";
}

function localizeWarning(warning: string, locale: ReportLocale): string {
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

function renderWarningList(result: AuditResult, locale: ReportLocale): string {
  const labels = labelsFor(locale);
  if (result.coverage.warnings.length === 0) return emptyState(labels);
  return "<ul class=\"warning-list\">" + result.coverage.warnings
    .map((warning) => "<li>" + escapeHtml(localizeWarning(warning, locale)) + "</li>")
    .join("") + "</ul>";
}

function renderCoverage(result: AuditResult, locale: ReportLocale): string {
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

function renderScope(result: AuditResult, locale: ReportLocale): string {
  const labels = labelsFor(locale);
  return "<dl class=\"scope-grid\">" +
    "<div><dt>" + escapeHtml(labels.harness) + "</dt><dd>" + escapeHtml(result.scope.harness) + "</dd></div>" +
    "<div><dt>" + escapeHtml(labels.scope) + "</dt><dd>" + escapeHtml(result.scope.allProjects ? labels.allProjects : labels.currentProject) + "</dd></div>" +
    "<div><dt>" + escapeHtml(labels.since) + "</dt><dd>" + escapeHtml(formatDateTime(result.scope.since, locale)) + "</dd></div>" +
    "</dl>";
}

function renderKpis(result: AuditResult, locale: ReportLocale): string {
  const labels = labelsFor(locale);
  const sessionBreakdown = result.summary.topLevelSessionCount.value !== null && result.summary.subagentSessionCount.value !== null
    ? [[labels.topLevelSessions, result.summary.topLevelSessionCount], [labels.subagentSessions, result.summary.subagentSessionCount]] as Array<[string, EvidenceValue]>
    : [];
  const items: Array<[string, EvidenceValue]> = [
    [labels.totalTokens, result.summary.totalTokens],
    [labels.sessions, result.summary.sessionCount],
    [labels.modelCalls, result.summary.modelCallCount],
    ...sessionBreakdown,
    ...(result.summary.reportedCost.value === null ? [] : [[labels.reportedCost, result.summary.reportedCost] as [string, EvidenceValue]]),
    ...(typeof result.report.apiEquivalentCost.coveragePercent.value === "number" && result.report.apiEquivalentCost.coveragePercent.value >= 80 && result.report.apiEquivalentCost.total.value !== null ? [[locale === "zh-CN" ? "API 等价估算（USD）" : "API-equivalent estimate (USD)", result.report.apiEquivalentCost.total] as [string, EvidenceValue]] : []),
  ];
  return "<div class=\"kpis\">" + items.map(([label, value]) =>
    "<div class=\"kpi\"><span>" + escapeHtml(label) + "</span><strong>" + evidenceHtml(value, locale) + "</strong></div>",
  ).join("") + "</div>";
}

interface PresentedCheck {
  marker: string;
  headline: string;
  detail: string;
  method: string;
}

function presentCheck(check: AutomatedCheck, locale: ReportLocale): PresentedCheck {
  const evidence = (index: number) => evidencePlain(check.evidence[index], locale);
  const chinese = locale === "zh-CN";
  const marker = check.outcome === "pass" ? "✓" : "▲";
  if (check.id === "long_session") return {
    marker,
    headline: chinese ? "一个 Session 占完整 Token 的 " + evidence(2) : "One Session accounts for " + evidence(2) + " of complete tokens",
    detail: chinese ? evidence(1) + " 次模型调用；" + evidence(0) + " 完整 Token。" : evidence(1) + " ModelCall records; " + evidence(0) + " complete tokens.",
    method: check.method,
  };
  if (check.id === "tool_amplification") return {
    marker,
    headline: chinese ? "一个工具结果估算重复进入上下文 " + evidence(2) : "One tool result adds an estimated " + evidence(2) + " of repeated context",
    detail: chinese ? "配对结果 " + evidence(0) + "；其后有 " + evidence(1) + " 次模型调用。" : "Paired result: " + evidence(0) + "; later ModelCall records: " + evidence(1) + ".",
    method: check.method,
  };
  if (check.id === "extra_calls") return {
    marker,
    headline: chinese ? "观察到 " + evidence(0) + " 条重试、中断或子 Agent 生命周期记录" : evidence(0) + " retry, interruption, or subagent lifecycle records observed",
    detail: chinese ? "该检查只计数已观察到的生命周期记录。" : "This check counts only observed lifecycle records.",
    method: check.method,
  };
  if (check.id === "model_concentration") return {
    marker,
    headline: chinese ? evidence(0) + " 占完整 Token 的 " + evidence(1) : evidence(0) + " accounts for " + evidence(1) + " of complete tokens",
    detail: chinese ? evidence(2) + " 次模型调用。" : evidence(2) + " ModelCall records.",
    method: check.method,
  };
  if (check.outcome === "pass") return {
    marker,
    headline: chinese ? "历史记录未报告覆盖警告" : "History parsed without coverage warnings",
    detail: chinese ? evidence(1) + " 条记录来自 " + evidence(0) + " 个文件；没有跳过或不完整 Session。" : evidence(1) + " records from " + evidence(0) + " files; no skipped or partial Sessions.",
    method: check.method,
  };
  return {
    marker,
    headline: chinese ? "覆盖范围报告存在跳过、不完整或警告记录" : "Coverage reports skipped, partial, or warning records",
    detail: chinese ? evidence(2) + " 条跳过记录；" + evidence(3) + " 个不完整 Session；" + evidence(4) + " 条覆盖警告。" : evidence(2) + " skipped records; " + evidence(3) + " partial Sessions; " + evidence(4) + " coverage warnings.",
    method: check.method,
  };
}

function checkLine(check: AutomatedCheck, locale: ReportLocale): string {
  const presented = presentCheck(check, locale);
  return presented.marker + " " + presented.headline + " — " + presented.detail + " " + (locale === "zh-CN" ? "方法：" : "Method: ") + presented.method;
}

function renderChecks(result: AuditResult, locale: ReportLocale): string {
  const title = labelsFor(locale).diagnosticSignals;
  const none = locale === "zh-CN" ? "没有足够的可靠 Evidence 支持自动发现。" : "No automated finding is supported by the available evidence.";
  if (result.checks.length === 0) return "<section><h2>" + escapeHtml(title) + "</h2>" + emptyState(labelsFor(locale), none) + "</section>";
  return "<section class=\"supporting-findings\"><h2>" + escapeHtml(title) + "</h2><p class=\"coverage-note\">" + escapeHtml(labelsFor(locale).checksNote) + "</p><ul>" + result.checks.map((check) => {
    const presented = presentCheck(check, locale);
    return "<li class=\"supporting-finding\"><div><strong><span class=\"check-marker\" aria-label=\"" + escapeHtml(check.outcome) + "\">" + presented.marker + "</span> <span class=\"finding-source\">" + escapeHtml(locale === "zh-CN" ? "自动" : "Automated") + "</span> " + escapeHtml(presented.headline) + "</strong><span>" + escapeHtml(presented.detail) + "</span><small>" + escapeHtml(locale === "zh-CN" ? "方法：" : "Method: ") + escapeHtml(presented.method) + "</small></div></li>";
  }).join("") + "</ul></section>";
}
function tokenCell(value: EvidenceValue, locale: ReportLocale): string {
  return evidenceHtml(value, locale);
}

function shortenedId(value: string): string {
  return value.length > 20 ? value.slice(0, 8) + "…" + value.slice(-4) : value;
}

function sessionLabel(row: ContributionEntry, locale: ReportLocale): string {
  if (row.displayName && row.displayName !== row.key) return row.displayName;
  return (locale === "zh-CN" ? "未命名 Session" : "Untitled Session") + " · " + shortenedId(row.key);
}

function renderDaily(result: AuditResult, locale: ReportLocale): string {
  const labels = labelsFor(locale);
  const rows = result.report.dailyUsage;
  if (rows.length === 0) return emptyState(labels);
  return "<table class=\"sortable\"><thead><tr><th>" + escapeHtml(labels.date) + "</th><th>" + escapeHtml(labels.totalTokens) + "</th><th>" + escapeHtml(labels.share) + "</th><th>" +
    escapeHtml(labels.input) + "</th><th>" + escapeHtml(labels.cachedInput) + "</th><th>" + escapeHtml(labels.cacheWrite) + "</th><th>" + escapeHtml(labels.output) + "</th><th>" + escapeHtml(locale === "zh-CN" ? "未分类余量" : "unclassified remainder") + "</th></tr></thead><tbody>" +
    rows.map((row) => "<tr><th scope=\"row\">" + escapeHtml(formatDateKey(row.key, locale)) + "</th><td>" + tokenCell(row.totalTokens, locale) + "</td><td>" +
      percentageHtml(row.sharePercent, locale) + "</td><td>" + tokenCell(row.inputTokens, locale) + "</td><td>" + tokenCell(row.cachedInputTokens, locale) +
      "</td><td>" + tokenCell(row.cacheWriteTokens, locale) + "</td><td>" + tokenCell(row.outputTokens, locale) + "</td><td>" + tokenCell(row.unclassifiedTokens, locale) + "</td></tr>").join("") +
    "</tbody></table>";
}

function renderModels(result: AuditResult, locale: ReportLocale): string {
  const labels = labelsFor(locale);
  const rows = result.rankings.models;
  if (rows.length === 0) return emptyState(labels);
  return "<table class=\"sortable\"><thead><tr><th>" + escapeHtml(labels.model) + "</th><th>" + escapeHtml(labels.tokens) + "</th><th>" + escapeHtml(labels.share) + "</th><th>" + escapeHtml(labels.calls) + "</th></tr></thead><tbody>" +
    rows.map((row) => "<tr><th scope=\"row\">" + escapeHtml(modelLabel(row.key, locale)) + "</th><td>" + tokenCell(row.value, locale) +
      "</td><td>" + percentageHtml(row.sharePercent, locale) + "</td><td>" + tokenCell(row.count, locale) + "</td></tr>").join("") +
    "</tbody></table>";
}

function renderSessions(result: AuditResult, locale: ReportLocale): string {
  const labels = labelsFor(locale);
  const rows = result.rankings.sessions.slice(0, 10);
  if (rows.length === 0) return emptyState(labels);
  return "<table class=\"sortable\"><thead><tr><th>" + escapeHtml(labels.session) + "</th><th>" + escapeHtml(labels.tokens) + "</th><th>" + escapeHtml(labels.share) + "</th><th>" + escapeHtml(labels.calls) + "</th></tr></thead><tbody>" +
    rows.map((row) => "<tr><th scope=\"row\">" + escapeHtml(sessionLabel(row, locale)) + "</th><td>" + tokenCell(row.value, locale) +
      "</td><td>" + percentageHtml(row.sharePercent, locale) + "</td><td>" + tokenCell(row.count, locale) + "</td></tr>").join("") +
    "</tbody></table>";
}

function renderTools(result: AuditResult, locale: ReportLocale): string {
  const labels = labelsFor(locale);
  const rows = result.report.tools;
  if (rows.length === 0) return emptyState(labels, labels.noToolData);
  const showErrors = rows.some((row) => row.errors.value !== null);
  return "<p class=\"coverage-note\">" + escapeHtml(labels.toolImpactNote) + "</p><table class=\"sortable\"><thead><tr><th>Tool</th><th>" + escapeHtml(labels.calls) + "</th><th>" + escapeHtml(labels.pairedResults) + "</th>" +
    (showErrors ? "<th>" + escapeHtml(labels.errors) + "</th>" : "") + "<th>" +
    escapeHtml(labels.injected) + "</th><th>" + escapeHtml(labels.amplified) + "</th><th>" + escapeHtml(labels.share) + "</th></tr></thead><tbody>" +
    rows.map((row: ToolAnalysisEntry) => "<tr><th scope=\"row\">" + escapeHtml(publicLabel(row.key, labels.unavailable)) + "</th><td>" + tokenCell(row.calls, locale) +
      "</td><td>" + tokenCell(row.pairedResults, locale) + "</td>" + (showErrors ? "<td>" + tokenCell(row.errors, locale) + "</td>" : "") + "<td>" + tokenCell(row.injectedTokens, locale) +
      "</td><td>" + tokenCell(row.amplifiedTokens, locale) + "</td><td>" + percentageHtml(row.sharePercent, locale) + "</td></tr>").join("") +
    "</tbody></table>";
}

function numericValue(value: EvidenceValue): number | null {
  return typeof value.value === "number" && Number.isFinite(value.value) ? value.value : null;
}

function renderBarSvg(title: string, rows: Array<{ key: string; value: EvidenceValue }>, locale: ReportLocale, chartId: string): string {
  const chartRows = rows.filter((row) => numericValue(row.value) !== null);
  const values = chartRows.map((row) => numericValue(row.value)!).filter((value): value is number => value !== null);
  if (chartRows.length === 0 || values.length === 0) return "";
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
    const value = numericValue(row.value)!;
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

function renderDailyComposition(result: AuditResult, locale: ReportLocale): string {
  const labels = labelsFor(locale);
  const rows = result.report.dailyUsage.filter((row) => numericValue(row.totalTokens) !== null).slice(-31);
  if (rows.length === 0) return "";
  const max = Math.max(...rows.map((row) => numericValue(row.totalTokens) ?? 0), 1);
  const width = 880;
  const rowHeight = 34;
  const height = rows.length * rowHeight + 58;
  const barX = 165;
  const barMax = 520;
  const segments: Array<{ label: string; field: keyof typeof rows[number]; className: string }> = [
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
      const evidence = row[segment.field] as EvidenceValue;
      const value = numericValue(evidence);
      if (value === null || value <= 0) continue;
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

function localHour(value: string, locale: ReportLocale): { dateKey: string; dateLabel: string; hour: number; timeLabel: string } | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === type)?.value ?? "";
  const hour = Number(part("hour")) % 24;
  const dateKey = part("year") + "-" + part("month") + "-" + part("day");
  return {
    dateKey,
    dateLabel: formatDateKey(dateKey, locale),
    hour,
    timeLabel: formatDateTime(value, locale),
  };
}

function renderHourlyHeatmap(result: AuditResult, locale: ReportLocale): string {
  const labels = labelsFor(locale);
  const entries = result.report.hourlyActivity.flatMap((row) => {
    const local = localHour(row.key, locale);
    const value = numericValue(row.totalTokens);
    return local && value !== null ? [{ row, local, value }] : [];
  });
  if (entries.length === 0) return "";
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

function renderHourly(result: AuditResult, locale: ReportLocale): string {
  const labels = labelsFor(locale);
  const rows = result.report.hourlyActivity;
  if (!result.report.hourlySupported || rows.length === 0) return emptyState(labels, labels.noTimestampData);
  return renderHourlyHeatmap(result, locale) +
    "<details><summary>" + escapeHtml(locale === "zh-CN" ? "查看小时明细" : "View hourly details") + "</summary><table class=\"sortable\"><thead><tr><th>" +
    escapeHtml(locale === "zh-CN" ? "本地时间" : "Local time") + "</th><th>" + escapeHtml(labels.tokens) + "</th><th>" + escapeHtml(labels.calls) + "</th><th>" + escapeHtml(labels.share) + "</th></tr></thead><tbody>" +
    rows.map((row) => "<tr><th scope=\"row\">" + escapeHtml(localHour(row.key, locale)?.timeLabel ?? row.key) + "</th><td>" + tokenCell(row.totalTokens, locale) + "</td><td>" +
      tokenCell(row.modelCallCount, locale) + "</td><td>" + percentageHtml(row.sharePercent, locale) + "</td></tr>").join("") + "</tbody></table></details>";
}

function renderRolling(result: AuditResult, locale: ReportLocale): string {
  const labels = labelsFor(locale);
  const rolling = result.report.rollingWindow;
  if (!rolling) return emptyState(labels, labels.noTimestampData);
  return "<div class=\"window-note\"><strong>" + escapeHtml(labels.localOnly) + "</strong><span>" + escapeHtml(formatDateTime(rolling.startAt, locale) + " → " + formatDateTime(rolling.endAt, locale)) + "</span></div>" +
    "<div class=\"window-grid\">" +
    "<div><span>" + escapeHtml(labels.calls) + "</span><strong>" + tokenCell(rolling.observedModelCallCount, locale) + "</strong></div>" +
    "<div><span>" + escapeHtml(labels.tokens) + "</span><strong>" + tokenCell(rolling.observedTokens, locale) + "</strong></div>" +
    "<div><span>5h peak</span><strong>" + tokenCell(rolling.historicalPeakObservedTokens, locale) + "</strong></div>" +
    "<div><span>" + escapeHtml(labels.providerQuota) + "</span><strong>" + tokenCell(rolling.providerQuota, locale) + "</strong></div>" +
    "<div><span>" + escapeHtml(labels.resetTime) + "</span><strong>" + tokenCell(rolling.resetAt, locale) + "</strong></div>" +
    "</div><p class=\"empty\">" + escapeHtml(labels.noQuota) + "</p>";
}

function renderWeekChanges(rows: WeekStructureChange[], heading: string, locale: ReportLocale): string {
  const labels = labelsFor(locale);
  if (rows.length === 0) return "<h3>" + escapeHtml(heading) + "</h3>" + emptyState(labels);
  return "<h3>" + escapeHtml(heading) + "</h3><table class=\"sortable\"><thead><tr><th>Key</th><th>" + escapeHtml(labels.currentWeek) + "</th><th>" +
    escapeHtml(labels.previousWeek) + "</th><th>" + escapeHtml(labels.change) + "</th></tr></thead><tbody>" +
    rows.slice(0, 20).map((row) => "<tr><th scope=\"row\">" + escapeHtml(publicLabel(row.key, labels.unavailable)) + "</th><td>" + tokenCell(row.current, locale) +
      "</td><td>" + tokenCell(row.previous, locale) + "</td><td>" + tokenCell(row.change, locale) + "</td></tr>").join("") + "</tbody></table>";
}

function renderWeek(result: AuditResult, locale: ReportLocale): string {
  if (!result.weekComparison) return emptyState(labelsFor(locale), labelsFor(locale).noComparison);
  const comparison = result.weekComparison;
  const labels = labelsFor(locale);
  return "<div class=\"week-ranges\"><div><strong>" + escapeHtml(labels.currentWeek) + "</strong><span>" + escapeHtml(formatDateTime(comparison.currentFrom, locale) + " → " + formatDateTime(comparison.currentTo, locale)) +
    "</span></div><div><strong>" + escapeHtml(labels.previousWeek) + "</strong><span>" + escapeHtml(formatDateTime(comparison.previousFrom, locale) + " → " + formatDateTime(comparison.previousTo, locale)) + "</span></div></div>" +
    "<table class=\"sortable\"><thead><tr><th></th><th>" + escapeHtml(labels.currentWeek) + "</th><th>" + escapeHtml(labels.previousWeek) + "</th><th>" + escapeHtml(labels.change) + "</th></tr></thead><tbody>" +
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

function chartRuntime(): string {
  try { return readFileSync(join(__dirname, "assets", "echarts.min.js"), "utf8"); } catch { try { return readFileSync(join(__dirname, "..", "assets", "echarts.min.js"), "utf8"); } catch { return ""; } }
}

function renderInteractiveCharts(result: AuditResult, locale: ReportLocale): string {
  const labels = labelsFor(locale);
  const rows = result.report.dailyUsage.map((row) => ({
    time: formatDateKey(row.key, locale), total: numericValue(row.totalTokens), input: numericValue(row.inputTokens), cached: numericValue(row.cachedInputTokens), cacheWrite: numericValue(row.cacheWriteTokens), output: numericValue(row.outputTokens), unclassified: numericValue(row.unclassifiedTokens), cost: numericValue(row.apiEquivalentCost),
  }));
  const models = result.rankings.models.map((row) => ({ name: modelLabel(row.key, locale), value: numericValue(row.value) }));
  const tools = result.report.tools.map((row) => ({ name: publicLabel(row.key, labels.unavailable), value: numericValue(row.amplifiedTokens) }));
  const cost = result.report.apiEquivalentCost;
  const costVisible = typeof cost.coveragePercent.value === "number" && cost.coveragePercent.value >= 80 && typeof cost.total.value === "number";
  const data = JSON.stringify({ rows, models, tools, locale, labels: { input: labels.input, cached: labels.cachedInput, cacheWrite: labels.cacheWrite, output: labels.output, unclassified: locale === "zh-CN" ? "未分类余量" : "unclassified remainder", cost: locale === "zh-CN" ? "API 等价估算（USD）" : "API-equivalent estimate (USD)" }, costVisible }).replaceAll("<", "\\u003c");
  const runtime = chartRuntime();
  if (!runtime || rows.length === 0) return "";
  const script = `<script>${runtime}</script><script>addEventListener('DOMContentLoaded',()=>{const d=${data};const compact=new Intl.NumberFormat(d.locale,{notation:'compact',maximumFractionDigits:2});const make=(id,option)=>{const el=document.getElementById(id);if(!el||!window.echarts)return;const c=echarts.init(el,null,{renderer:'svg'});c.setOption(option);addEventListener('resize',()=>c.resize())};const series=[['input',d.labels.input,'#b76448'],['cached',d.labels.cached,'#d99a78'],['cacheWrite',d.labels.cacheWrite,'#8b7667'],['output',d.labels.output,'#557c70'],['unclassified',d.labels.unclassified,'#8d6a9f']].map(([key,name,color])=>({name,type:'line',smooth:false,symbol:'none',lineStyle:{color,width:2,opacity:1},itemStyle:{color},areaStyle:{color,opacity:.18},emphasis:{focus:'series',lineStyle:{width:3,opacity:1},areaStyle:{opacity:.35}},data:d.rows.map(r=>r[key])}));if(d.costVisible)series.push({name:d.labels.cost,type:'line',yAxisIndex:1,symbol:'circle',connectNulls:false,data:d.rows.map(r=>r.cost),lineStyle:{color:'#273c75'}});make('token-trend',{aria:{show:true,description:'${locale === "zh-CN" ? "每条曲线和悬停值均为该分量原始 Token 值；各分量不堆叠。" : "Each curve and hover value is the raw Token value of that component; components are not stacked."}'},tooltip:{trigger:'axis',valueFormatter:v=>v==null?'${locale === "zh-CN" ? "不可用" : "unavailable"}':compact.format(v)},legend:{type:'scroll'},grid:{left:56,right:d.costVisible?64:22,top:42,bottom:48,containLabel:true},xAxis:{type:'category',data:d.rows.map(r=>r.time),axisLabel:{hideOverlap:true}},yAxis:[{type:'value',name:'Token',axisLabel:{formatter:v=>compact.format(v)}},...(d.costVisible?[{type:'value',name:'USD',axisLabel:{formatter:v=>'$'+compact.format(v)}}]:[])],series});make('model-chart',{aria:{show:true,description:'${locale === "zh-CN" ? "按模型的 Token 分布；下方表格提供等价数据。" : "Token distribution by model; the table below provides equivalent data."}'},tooltip:{trigger:'axis',valueFormatter:v=>compact.format(v)},grid:{left:24,right:24,top:18,bottom:48,containLabel:true},xAxis:{type:'category',data:d.models.map(r=>r.name),axisLabel:{interval:0,rotate:24,hideOverlap:true}},yAxis:{type:'value',axisLabel:{formatter:v=>compact.format(v)}},series:[{type:'bar',data:d.models.map(r=>r.value),itemStyle:{color:'#b76448'}}]});make('tool-chart',{aria:{show:true,description:'${locale === "zh-CN" ? "按工具的上下文放大估算；下方表格提供等价数据。" : "Estimated context amplification by tool; the table below provides equivalent data."}'},tooltip:{trigger:'axis',valueFormatter:v=>compact.format(v)},grid:{left:96,right:24,top:18,bottom:18,containLabel:true},xAxis:{type:'value',axisLabel:{formatter:v=>compact.format(v)}},yAxis:{type:'category',data:d.tools.map(r=>r.name),axisLabel:{width:88,overflow:'truncate'}},series:[{type:'bar',data:d.tools.map(r=>r.value),itemStyle:{color:'#557c70'}}]});document.querySelectorAll('table.sortable').forEach(table=>{const headers=[...table.tHead.rows[0].cells];headers.forEach((th,index)=>{const label=th.textContent;const b=document.createElement('button');b.type='button';b.textContent=label+' ↕';b.setAttribute('aria-label',label+' sort');th.textContent='';th.append(b);b.onclick=()=>{const asc=th.getAttribute('aria-sort')!=='ascending';headers.forEach(h=>h.removeAttribute('aria-sort'));th.setAttribute('aria-sort',asc?'ascending':'descending');const rows=[...table.tBodies[0].rows].map((row,order)=>({row,order,key:(row.cells[index].querySelector('[data-sort]')?.getAttribute('data-sort')??row.cells[index].getAttribute('data-sort')??row.cells[index].textContent.trim())}));rows.sort((a,b)=>{const an=Number(a.key),bn=Number(b.key),am=a.key===''||a.key==='unavailable',bm=b.key===''||b.key==='unavailable';if(am||bm)return am===bm?a.order-b.order:am?1:-1;const cmp=Number.isFinite(an)&&Number.isFinite(bn)?an-bn:a.key.localeCompare(b.key,d.locale);return cmp===0?a.order-b.order:(asc?cmp:-cmp)});rows.forEach(x=>table.tBodies[0].append(x.row))}})})});</script>`;
  return `<div id="token-trend" class="echart" role="img" aria-label="${escapeHtml(labels.dailyUsage)}"></div><p class="chart-summary">${escapeHtml(locale === "zh-CN" ? "每条线的纵坐标和悬停值都是该 Token 分量自身的值；各分量不堆叠。" : "Each curve and hover value is the raw Token value of that component; components are not stacked.")}</p>${script}`;
}
function renderStyles(): string {
  return "<style>" +
    ":root{color-scheme:light;--ink:#27231f;--muted:#766d64;--line:#e6ddd4;--paper:#fffdf9;--bg:#f2eee8;--accent:#b76448;--accent-soft:#f5e0d7;--ok:#3c725c}" +
    "*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif}" +
    "main{max-width:1060px;margin:0 auto;padding:38px 24px 64px}header{margin-bottom:28px}h1{font-size:32px;line-height:1.1;margin:0 0 12px;letter-spacing:-.03em}h2{font-size:19px;margin:0 0 14px}h3{font-size:16px;margin:24px 0 12px}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:var(--accent);font-weight:700}section{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:22px;margin:16px 0;box-shadow:0 6px 22px rgba(53,38,25,.04)}.scope-grid,.coverage-grid,.kpis,.window-grid,.week-ranges{display:grid;gap:12px}.scope-grid{grid-template-columns:repeat(3,1fr);margin:0}.scope-grid div{background:#faf7f2;border-radius:10px;padding:12px}.scope-grid dt{color:var(--muted);font-size:12px}.scope-grid dd{margin:4px 0 0;font-weight:650;overflow-wrap:anywhere}.coverage-grid{grid-template-columns:repeat(4,1fr);margin-bottom:14px}.coverage-grid div,.window-grid div{padding:12px;border:1px solid var(--line);border-radius:10px}.coverage-grid strong,.coverage-grid span,.window-grid strong,.window-grid span{display:block}.coverage-grid strong{font-size:20px}.coverage-grid span,.window-grid span{color:var(--muted);font-size:12px}.warning-list{margin:10px 0 0;padding-left:20px}.coverage-note{color:var(--muted)}.ok{color:var(--ok)}.kpis{grid-template-columns:repeat(4,1fr)}.kpi{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:16px}.kpi>span{display:block;color:var(--muted);font-size:12px}.kpi strong{display:block;font-size:22px;line-height:1.2;margin-top:6px;font-variant-numeric:tabular-nums}.metric-stack{display:inline-flex;flex-direction:column;align-items:flex-start;gap:2px;font-variant-numeric:tabular-nums}.metric-main{display:block}.estimate{display:block;color:var(--muted);font-size:11px;font-weight:400;line-height:1.3}.percentage{display:block;white-space:nowrap}.unavailable{color:var(--muted);font-style:italic}.finding{border-color:#e8c4b5;background:linear-gradient(135deg,#fffdf9,#fff5ef)}.finding.neutral{border-color:var(--line)}.finding h2{font-size:23px;max-width:800px}.finding p{max-width:820px}.evidence{display:flex;flex-wrap:wrap;gap:9px;list-style:none;padding:0;margin:18px 0}.evidence li{background:var(--accent-soft);border-radius:9px;padding:8px 10px}.recommendation{border-top:1px solid #e8c4b5;padding-top:12px}.recommendation strong{color:var(--accent)}.recommendation p{margin:4px 0 0;font-weight:650}.supporting-findings ul{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;list-style:none;margin:0;padding:0}.supporting-finding{padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:#faf7f2}.supporting-finding strong,.supporting-finding span,.supporting-finding small{display:block}.supporting-finding strong{font-size:14px}.supporting-finding>div>span,.supporting-finding small{margin-top:5px;color:var(--muted);font-size:12px}.check-marker{display:inline!important;margin:0!important;color:var(--accent);font-size:14px!important}.finding-source{display:inline!important;margin:0 5px 0 0!important;border:1px solid var(--line);border-radius:999px;padding:1px 6px;color:var(--muted);font-size:11px!important;font-weight:500}.supporting-finding small{font-size:11px}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{text-align:left;border-bottom:1px solid var(--line);padding:10px 8px;vertical-align:top}thead th{color:var(--muted);font-size:12px;font-weight:650}tbody th{font-weight:650}tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}.empty{color:var(--muted);margin:8px 0}.echart{width:100%;height:330px;margin:0 0 12px;background:#faf7f2;border-radius:12px}.chart-summary{color:var(--muted);font-size:12px}.chart{display:block;width:100%;height:auto;margin:0 0 20px;background:#faf7f2;border-radius:12px;padding:10px;overflow:visible}.chart-label,.chart-value,.heat-hour{font:12px system-ui,sans-serif;fill:var(--muted)}.chart-value{font-variant-numeric:tabular-nums;fill:var(--ink)}.chart-bar{fill:var(--accent)}.chart-track{fill:#ece6df}.segment-input{fill:#b76448}.segment-cached{fill:#d99a78}.segment-cache-write{fill:#8b7667}.segment-output{fill:#557c70}.segment-reasoning{fill:#8d6a9f}.heat-0{fill:#ebe5de}.heat-1{fill:#edd7ca}.heat-2{fill:#dda98d}.heat-3{fill:#c67f5e}.heat-4{fill:#9f4f36}details{border-top:1px solid var(--line);padding-top:12px}summary{cursor:pointer;color:var(--accent);font-weight:650;margin-bottom:10px}.window-note{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;background:#f7f1e7;border-radius:10px;padding:12px;margin-bottom:12px}.window-note span,.week-ranges span{color:var(--muted);font-size:12px}.window-grid{grid-template-columns:repeat(5,1fr)}.window-grid strong{margin-top:5px}.week-ranges{grid-template-columns:repeat(2,1fr);margin-bottom:16px}.week-ranges div{background:#faf7f2;border-radius:10px;padding:12px}.week-ranges strong,.week-ranges span{display:block}footer{color:var(--muted);font-size:12px;border-top:1px solid var(--line);margin-top:26px;padding-top:16px}footer p{margin:5px 0}@media(max-width:760px){main{padding:24px 14px}.scope-grid,.kpis,.coverage-grid,.window-grid,.week-ranges{grid-template-columns:1fr 1fr}table{display:block;overflow-x:auto;white-space:nowrap}.finding h2{font-size:20px}}@media(max-width:480px){.scope-grid,.kpis,.coverage-grid,.window-grid,.week-ranges{grid-template-columns:1fr}}" +
    "</style>";
}

export function renderHtml(result: AuditResult, locale: ReportLocale = "en-US"): string {
  const labels = labelsFor(locale);
  const modelBars = result.rankings.models.map((row) => ({ key: modelLabel(row.key, locale), value: row.value }));
  const parts = [
    "<!doctype html><html lang=\"" + (locale === "zh-CN" ? "zh-CN" : "en") + "\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" +
      escapeHtml(labels.title) + "</title>" + renderStyles() + "</head><body><main>",
    "<header><div class=\"eyebrow\">Agent Audit</div><h1>" + escapeHtml(labels.title) + "</h1><p>" + escapeHtml(labels.methodNote) + "</p></header>",
    "<section><h2>" + escapeHtml(labels.scope) + "</h2>" + renderScope(result, locale) + "<h2>" + escapeHtml(labels.coverage) + "</h2>" + renderCoverage(result, locale) + "</section>",
    renderKpis(result, locale),
    renderChecks(result, locale),
    result.weekComparison ? "<section><h2>" + escapeHtml(labels.weekView) + "</h2>" + renderWeek(result, locale) + "</section>" : "",
    "<section><h2>" + escapeHtml(labels.time) + "</h2><h3>" + escapeHtml(labels.dailyUsage) + "</h3>" +
      renderInteractiveCharts(result, locale) + renderDaily(result, locale) +
      "<h3>" + escapeHtml(labels.hourlyActivity) + "</h3>" + renderHourly(result, locale) +
      "<h3>" + escapeHtml(labels.observedActivity) + "</h3>" + renderRolling(result, locale) + "</section>",
    "<section><h2>" + escapeHtml(labels.models) + "</h2><div id=\"model-chart\" class=\"echart\" role=\"img\" aria-label=\"" + escapeHtml(labels.models) + "\"></div>" + renderModels(result, locale) + "</section>",
    "<section><h2>" + escapeHtml(labels.tools) + "</h2><div id=\"tool-chart\" class=\"echart\" role=\"img\" aria-label=\"" + escapeHtml(labels.tools) + "\"></div>" + renderTools(result, locale) + "</section>",
    "<section><h2>" + escapeHtml(labels.sessionsByUsage) + "</h2>" + renderSessions(result, locale) + "</section>",
    "<section><h2>" + escapeHtml(labels.limitations) + "</h2><p>" + escapeHtml(labels.methodNote) + "</p>" +
      renderWarningList(result, locale) + "</section>",
    "<footer><strong>" + escapeHtml(labels.provenance) + "</strong><p>" + escapeHtml(labels.reported + " = source value; " + labels.derived + " = calculated from records; " + labels.estimated + " = approximation; " + labels.unavailableProvenance + " = missing source data.") + "</p>" +
      "<strong>" + escapeHtml(labels.privacy) + "</strong><p>" + escapeHtml(labels.privacyNote) + "</p></footer>",
    "</main></body></html>",
  ];
  return parts.join("");
}

function renderTopLine(result: AuditResult, locale: ReportLocale): string[] {
  const labels = labelsFor(locale);
  const sessionBreakdown = result.summary.topLevelSessionCount.value !== null && result.summary.subagentSessionCount.value !== null
    ? "; " + labels.topLevelSessions + ": " + evidencePlain(result.summary.topLevelSessionCount, locale, false) + "; " + labels.subagentSessions + ": " + evidencePlain(result.summary.subagentSessionCount, locale, false)
    : "";
  return [
    "Audit: " + result.scope.harness + "; " + (result.scope.allProjects ? labels.allProjects : labels.currentProject) + "; " + labels.since + " " + formatDateTime(result.scope.since, locale),
    labels.coverage + ": " + result.coverage.filesRead + " " + labels.files + ", " + result.coverage.recordsRead + " " + labels.records + ", " + result.coverage.recordsSkipped + " " + labels.skipped + ", " + result.coverage.partialSessions + " " + labels.partialSessions + ".",
    labels.totalTokens + ": " + evidencePlain(result.summary.totalTokens, locale) + "; " + labels.sessions + ": " + evidencePlain(result.summary.sessionCount, locale, false) + sessionBreakdown + "; " + labels.modelCalls + ": " + evidencePlain(result.summary.modelCallCount, locale, false) + ".",
  ];
}
function percentageText(value: EvidenceValue, locale: ReportLocale): string {
  return value.value === null ? labelsFor(locale).unavailable : formatExact(value.value, locale) + "%";
}

export function renderText(result: AuditResult, locale: ReportLocale = "en-US", view: AuditView = "full"): string {
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
    if (result.report.tools.length === 0) lines.push(labels.noToolData);
    for (const tool of result.report.tools.slice(0, 10)) {
      lines.push(publicLabel(tool.key, labels.unavailable) + ": " + labels.calls + " " + evidencePlain(tool.calls, locale, false) +
        "; " + labels.amplified + " " + evidencePlain(tool.amplifiedTokens, locale) + "; " + labels.share + " " + percentageText(tool.sharePercent, locale) + ".");
    }
    return lines.join("\n") + "\n";
  }
  if (view === "usage") {
    const lines = [labels.usageView, ...renderTopLine(result, locale)];
    const model = result.rankings.models.slice(0, 5).map((entry) => modelLabel(entry.key, locale) + " " + evidencePlain(entry.value, locale) + " / " + percentageText(entry.sharePercent, locale)).join(", ");
    if (model) lines.push(labels.models + ": " + model + ".");
    const session = result.rankings.sessions[0];
    if (session) lines.push(labels.sessionsByUsage + ": " + sessionLabel(session, locale) + " — " + evidencePlain(session.value, locale) + ".");
    return lines.join("\n") + "\n";
  }
  const lines = renderTopLine(result, locale);
  if (result.checks.length > 0) lines.push(labels.diagnosticSignals + ":", ...result.checks.map((check) => checkLine(check, locale)));
  const topSession = result.rankings.sessions[0];
  if (topSession) {
    lines.push(
      (locale === "zh-CN" ? "主要 Session" : "Top Session") + ": " + sessionLabel(topSession, locale) +
      "; " + evidencePlain(topSession.value, locale, false) + "; " + (locale === "zh-CN" ? "占比" : "share") + ": " +
      percentageText(topSession.sharePercent, locale) + ".",
    );
  }
  const modelSummary = result.rankings.models.slice(0, 5)
    .map((entry) => modelLabel(entry.key, locale) + ": " + formatExact(entry.value.value, locale) + " " + labels.tokens + " (" + percentageText(entry.sharePercent, locale) + ")")
    .join(", ");
  if (modelSummary) lines.push((locale === "zh-CN" ? labels.models : "Models") + ": " + modelSummary + ".");
  return lines.join("\n") + "\n";
}

function snapshotResult(snapshot: AuditSnapshot): AuditResult {
  return snapshot as AuditResult;
}

export function renderWeekText(comparison: WeekComparison, locale: ReportLocale = "en-US"): string {
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

function redactedModelKey(row: ContributionEntry): string {
  return publicLabel(row.key, "other-model");
}

export function renderShare(result: AuditResult, locale: ReportLocale = "en-US"): string {
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
  for (const row of result.rankings.models) lines.push("| " + redactedModelKey(row) + " | " + evidencePlain(row.value, locale, false) + " | " + percentageText(row.sharePercent, locale) + " |");
  lines.push("", "## " + labels.time, "", "| " + labels.date + " | " + labels.tokens + " | " + labels.share + " |", "| --- | ---: | ---: |");
  for (const row of result.report.dailyUsage) lines.push("| " + formatDateKey(row.key, locale) + " | " + evidencePlain(row.totalTokens, locale, false) + " | " + percentageText(row.sharePercent, locale) + " |");
  lines.push("", "## " + labels.tools, "", "| Tool category | " + labels.calls + " | " + labels.amplified + " | " + labels.share + " |", "| --- | ---: | ---: |");
  for (const row of result.report.tools) lines.push("| " + publicLabel(row.key, "other-tool") + " | " + evidencePlain(row.calls, locale, false) + " | " + evidencePlain(row.amplifiedTokens, locale, false) + " | " + percentageText(row.sharePercent, locale) + " |");
  lines.push("", "## " + labels.diagnosticSignals);
  for (const check of result.checks) lines.push("- " + checkLine(check, locale));
  lines.push("", labels.methodNote, labels.privacyNote);
  return lines.join("\n") + "\n";
}
