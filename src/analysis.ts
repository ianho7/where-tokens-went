import { createHash } from "node:crypto";
import type {
  AuditResult,
  AutomatedCheck,
  ContributionEntry,
  ContributionRankings,
  EvidenceValue,
  Harness,
  ModelCallRecord,
  ReadResult,
  ReadScope,
  ReportData,
  SessionRecord,
  ToolAnalysisEntry,
  TokenBreakdown,
  ToolCallRecord,
} from "./types";
import { API_RATES, API_RATE_SOURCE } from "./rates";

function unavailable(method: string): EvidenceValue {
  return { value: null, provenance: "unavailable", method };
}

function countEvidence(value: number, method: string): EvidenceValue {
  return { value, provenance: "derived", method };
}

function sharePercentEvidence(tokens: number, totalTokens: number | null, label: string, source?: EvidenceValue["source"], denominatorLabel = "complete selected tokens"): EvidenceValue {
  if (totalTokens === null || totalTokens <= 0) {
    return unavailable(`the complete selected token total was unavailable for ${label} share calculation`);
  }
  return {
    value: Math.round((tokens / totalTokens) * 10000) / 100,
    provenance: "derived",
    method: `${label} tokens divided by ${denominatorLabel}, expressed as percentage points and rounded to two decimals`,
    ...(source ? { source } : {}),
  };
}

function callTokens(call: ModelCallRecord): number | null {
  return call.totalTokens;
}

function sessionTotal(sessionId: string, calls: ModelCallRecord[]): number | null {
  const ownCalls = calls.filter((call) => call.sessionId === sessionId);
  if (ownCalls.length === 0 || ownCalls.some((call) => callTokens(call) === null)) return null;
  return ownCalls.reduce((total, call) => total + callTokens(call)!, 0);
}

function sumTokens(calls: ModelCallRecord[]): { value: number | null; provenance: "reported" | "derived" | "unavailable" } {
  if (calls.length === 0 || calls.some((call) => callTokens(call) === null)) {
    return { value: null, provenance: "unavailable" };
  }
  const value = calls.reduce((total, call) => total + callTokens(call)!, 0);
  const allReported = calls.every((call) => call.tokenProvenance === "reported");
  return { value, provenance: allReported ? "reported" : "derived" };
}

function sumReportedCost(calls: ModelCallRecord[]): number | null {
  if (calls.length === 0 || calls.some((call) => call.reportedCost === null)) return null;
  return calls.reduce((total, call) => total + call.reportedCost!, 0);
}

function rankContributions(
  calls: ModelCallRecord[],
  keyOf: (call: ModelCallRecord) => string,
  label: string,
  totalTokens: number | null,
  displayNameOf?: (key: string) => string | undefined,
): ContributionEntry[] {
  const groups = new Map<string, { tokens: number; complete: boolean; reported: boolean; count: number }>();
  for (const call of calls) {
    const key = keyOf(call);
    const existing = groups.get(key) ?? { tokens: 0, complete: true, reported: true, count: 0 };
    existing.count += 1;
    if (call.totalTokens === null) {
      existing.complete = false;
    } else {
      existing.tokens += call.totalTokens;
    }
    existing.reported = existing.reported && call.tokenProvenance === "reported";
    groups.set(key, existing);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.complete)
    .sort((left, right) => right[1].tokens - left[1].tokens || left[0].localeCompare(right[0]))
    .map(([key, group]) => ({
      key,
      ...(displayNameOf?.(key) ? { displayName: displayNameOf(key) } : {}),
      value: {
        value: group.tokens,
        provenance: group.reported ? "reported" : "derived",
        method: `${label} group sum of complete ModelCall token totals`,
      },
      sharePercent: sharePercentEvidence(group.tokens, totalTokens, label),
      count: countEvidence(group.count, "count of ModelCall records in " + label + " group"),
    }));
}

function sessionDisplayName(session: SessionRecord): string {
  return session.title ? `${session.title} (${session.sessionId})` : session.sessionId;
}

function timeBucket(timestamp: string | null): string {
  if (!timestamp) return "<unknown-time>";
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? "<unknown-time>" : parsed.toISOString().slice(0, 10);
}

type Composition = { input: number; cached: number; cacheWrite: number; output: number; unclassified: number };

function totalTokenEvidence(calls: ModelCallRecord[], label: string): EvidenceValue {
  const total = sumTokens(calls);
  if (total.value === null) return unavailable(label + " was not reported for every selected ModelCall");
  return { value: total.value, provenance: total.provenance, method: "sum of non-cumulative ModelCall token totals for " + label };
}

function composition(call: ModelCallRecord, harness: Harness): Composition | null {
  const { totalTokens: total, inputTokens: input, cachedInputTokens: cached, cacheWriteTokens: cacheWrite, outputTokens: output } = call;
  if ([total, input, cached, cacheWrite, output].some((value) => value === null)) return null;
  if (harness === "codex") {
    const ordinaryInput = input! - cached! - cacheWrite!;
    const unclassified = total! - input! - output!;
    return ordinaryInput >= 0 && unclassified >= 0
      ? { input: ordinaryInput, cached: cached!, cacheWrite: cacheWrite!, output: output!, unclassified }
      : null;
  }
  if (harness === "deepseek") {
    const unclassified = total! - input! - cached! - cacheWrite! - output!;
    return unclassified >= 0 ? { input: input!, cached: cached!, cacheWrite: cacheWrite!, output: output!, unclassified } : null;
  }
  if (call.reasoningTokens === null || input! + cached! + cacheWrite! + output! + call.reasoningTokens !== total) return null;
  return { input: input!, cached: cached!, cacheWrite: cacheWrite!, output: output!, unclassified: call.reasoningTokens };
}

function tokenBreakdown(calls: ModelCallRecord[], label: string, harness: Harness): TokenBreakdown {
  const parts = calls.map((call) => composition(call, harness));
  const totalTokens = totalTokenEvidence(calls, label);
  if (calls.length === 0 || parts.some((part) => part === null)) {
    const missing = unavailable(label + " lacks a source-proven mutually exclusive Token composition");
    return { inputTokens: missing, cachedInputTokens: missing, cacheWriteTokens: missing, outputTokens: missing, unclassifiedTokens: missing, reasoningTokens: unavailable(label + " reasoning tokens were retained only as raw evidence"), totalTokens };
  }
  const sum = (field: keyof Composition, method: string): EvidenceValue => ({ value: parts.reduce((total, part) => total + part![field], 0), provenance: "derived", method });
  return {
    inputTokens: sum("input", label + " ordinary input is source-proven non-cache input"),
    cachedInputTokens: sum("cached", label + " cache-hit input is mutually exclusive"),
    cacheWriteTokens: sum("cacheWrite", label + " cache-build input is mutually exclusive"),
    outputTokens: sum("output", label + " output is mutually exclusive"),
    unclassifiedTokens: sum("unclassified", label + " residual closes the reported Token total without reclassifying source fields"),
    reasoningTokens: unavailable(label + " reasoning is not stacked because output inclusion is Harness-specific"),
    totalTokens,
  };
}

function apiCost(calls: ModelCallRecord[], harness: Harness): { cost: EvidenceValue; pricedTokens: number; relevantTokens: number; unpricedModels: string[]; limitations: string[] } {
  let total = 0; let pricedTokens = 0; let relevantTokens = 0;
  const unpricedModels = new Set<string>(); const limitations = new Set<string>();
  for (const call of calls) {
    if (typeof call.totalTokens !== "number") { limitations.add("missing Token total"); continue; }
    relevantTokens += call.totalTokens;
    const rate = API_RATES.find((candidate) => candidate.model === call.model);
    const part = composition(call, harness);
    if (!rate) { unpricedModels.add(call.model ?? "<unknown-model>"); continue; }
    if (!part || part.cacheWrite !== 0 || part.unclassified !== 0 || rate.cachedInputPerMillion === null) { limitations.add("missing compatible price dimension"); continue; }
    total += (part.input * rate.inputPerMillion + part.cached * rate.cachedInputPerMillion + part.output * rate.outputPerMillion) / 1_000_000;
    pricedTokens += call.totalTokens;
  }
  return {
    cost: pricedTokens === 0 ? unavailable("no selected ModelCall exactly matched a local public API rate with compatible Token dimensions") : { value: total, provenance: "estimated", method: "exact model match against local API rate table " + API_RATE_SOURCE.version },
    pricedTokens, relevantTokens, unpricedModels: [...unpricedModels].sort(), limitations: [...limitations].sort(),
  };
}

function hourBucket(timestamp: string | null): string | null {
  if (!timestamp) return null;
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 13) + ":00Z";
}

function buildDailyUsage(calls: ModelCallRecord[], totalTokens: number | null, harness: Harness): ReportData["dailyUsage"] {
  const groups = new Map<string, ModelCallRecord[]>();
  for (const call of calls) {
    const key = timeBucket(call.timestamp);
    groups.set(key, [...(groups.get(key) ?? []), call]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, group]) => {
      const breakdown = tokenBreakdown(group, "day " + key, harness);
      const cost = apiCost(group, harness).cost;
      return {
        key,
        ...breakdown,
        modelCallCount: countEvidence(group.length, "count of ModelCall records in day " + key),
        apiEquivalentCost: cost,
        sharePercent: typeof breakdown.totalTokens.value !== "number"
          ? unavailable("the complete token total was unavailable for day " + key + " share calculation")
          : sharePercentEvidence(breakdown.totalTokens.value, totalTokens, "day " + key),
      };
    });
}

function buildHourlyActivity(calls: ModelCallRecord[], totalTokens: number | null): ReportData["hourlyActivity"] {
  const groups = new Map<string, ModelCallRecord[]>();
  for (const call of calls) {
    const key = hourBucket(call.timestamp);
    if (key) groups.set(key, [...(groups.get(key) ?? []), call]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, group]) => {
      const total = totalTokenEvidence(group, "hour " + key);
      return {
        key,
        modelCallCount: countEvidence(group.length, "count of ModelCall records in hour " + key),
        totalTokens: total,
        sharePercent: typeof total.value !== "number"
          ? unavailable("the complete token total was unavailable for hour " + key + " share calculation")
          : sharePercentEvidence(total.value, totalTokens, "hour " + key),
      };
    });
}

function safeToolName(name: string): string {
  const value = name.trim();
  return value && value.length <= 80 && /^[A-Za-z0-9_.:-]+$/.test(value) ? value : "other-tool";
}

function buildToolAnalysis(read: ReadResult): { entries: ToolAnalysisEntry[]; total: EvidenceValue } {
  const groups = new Map<string, {
    calls: number;
    pairedResults: number;
    errors: number;
    errorStatusComplete: boolean;
    injectedTokens: number;
    amplifiedTokens: number;
    hasResult: boolean;
  }>();
  for (const tool of read.toolCalls) {
    const key = safeToolName(tool.toolName);
    const group = groups.get(key) ?? {
      calls: 0,
      pairedResults: 0,
      errors: 0,
      errorStatusComplete: true,
      injectedTokens: 0,
      amplifiedTokens: 0,
      hasResult: false,
    };
    group.calls += 1;
    if (tool.isError === null) group.errorStatusComplete = false;
    if (tool.isError === true) group.errors += 1;
    if (tool.resultChars !== null && tool.resultChars !== undefined) {
      group.pairedResults += 1;
      group.hasResult = true;
      group.injectedTokens += tool.resultChars / 4;
      group.amplifiedTokens += (tool.resultChars / 4) * laterCalls(
        tool,
        read.modelCalls.filter((call) => call.activeBranch !== false),
        read.lifecycle,
      );
    }
    groups.set(key, group);
  }
  const hasResult = [...groups.values()].some((group) => group.hasResult);
  const totalAmplified = [...groups.values()].reduce((total, group) => total + group.amplifiedTokens, 0);
  const total = hasResult
    ? {
      value: totalAmplified,
      provenance: "estimated" as const,
      method: "sum of per-tool UTF-8 text-character estimates divided by 4 and multiplied within active-context boundaries",
    }
    : unavailable("no paired tool result size was available");
  const entries = [...groups.entries()]
    .sort((left, right) => right[1].amplifiedTokens - left[1].amplifiedTokens || left[0].localeCompare(right[0]))
    .map(([key, group]) => ({
      key,
      calls: countEvidence(group.calls, "count of ToolCall records for " + key),
      pairedResults: countEvidence(group.pairedResults, "count of paired ToolCall results for " + key),
      errors: group.errorStatusComplete
        ? countEvidence(group.errors, "count of reported ToolCall errors for " + key)
        : unavailable("error status was missing for at least one " + key + " ToolCall"),
      injectedTokens: group.hasResult
        ? {
          value: group.injectedTokens,
          provenance: "estimated" as const,
          method: "paired tool-result Unicode text characters divided by 4; content is not returned",
        }
        : unavailable("no paired result size was available for " + key),
      amplifiedTokens: group.hasResult
        ? {
          value: group.amplifiedTokens,
          provenance: "estimated" as const,
          method: "paired result text characters / 4 multiplied by later ModelCall records before the next observable active-context boundary",
        }
        : unavailable("no paired result size was available for " + key),
      sharePercent: group.hasResult
        ? sharePercentEvidence(group.amplifiedTokens, totalAmplified > 0 ? totalAmplified : null, "tool " + key, undefined, "total tool amplification estimate")
        : unavailable("no paired result size was available for " + key + " share calculation"),
    }));
  return { entries, total };
}

function timestampMs(timestamp: string | null): number | null {
  if (!timestamp) return null;
  const value = Date.parse(timestamp);
  return Number.isNaN(value) ? null : value;
}

function observedTokenEvidence(calls: ModelCallRecord[], label: string): EvidenceValue {
  if (calls.length === 0) {
    return { value: 0, provenance: "derived", method: "no timestamped ModelCall records were observed in the " + label };
  }
  return totalTokenEvidence(calls, label);
}

function historicalPeakTokens(calls: ModelCallRecord[], windowMilliseconds: number): EvidenceValue {
  const timed = calls
    .map((call) => ({ call, time: timestampMs(call.timestamp) }))
    .filter((entry): entry is { call: ModelCallRecord; time: number } => entry.time !== null)
    .sort((left, right) => left.time - right.time);
  if (timed.length === 0) return unavailable("no usable ModelCall timestamps were available for a historical rolling-window peak");
  let peak: number | null = null;
  // ponytail: O(n²) local window scan keeps the boundary logic explicit; add an indexed scan only if history size makes this measurable.
  for (let start = 0; start < timed.length; start += 1) {
    const end = timed[start].time + windowMilliseconds;
    const window = timed.filter((entry) => entry.time >= timed[start].time && entry.time <= end).map((entry) => entry.call);
    if (window.some((call) => call.totalTokens === null)) continue;
    const total = window.reduce((sum, call) => sum + call.totalTokens!, 0);
    if (peak === null || total > peak) peak = total;
  }
  return peak === null
    ? unavailable("a complete token total was unavailable for every timestamped rolling-window candidate")
    : {
      value: peak,
      provenance: "derived",
      method: "maximum sum of complete ModelCall token totals in any five-hour timestamp window",
    };
}

function buildRollingWindow(calls: ModelCallRecord[]): ReportData["rollingWindow"] {
  const end = Date.now();
  const start = end - 5 * 60 * 60 * 1000;
  const timed = calls.filter((call) => timestampMs(call.timestamp) !== null);
  if (timed.length === 0) return null;
  const observed = timed.filter((call) => timestampMs(call.timestamp)! >= start && timestampMs(call.timestamp)! <= end);
  return {
    windowHours: 5,
    startAt: new Date(start).toISOString(),
    endAt: new Date(end).toISOString(),
    observedModelCallCount: countEvidence(observed.length, "count of timestamped ModelCall records observed in the latest five-hour window"),
    observedTokens: observedTokenEvidence(observed, "latest five-hour observed activity"),
    historicalPeakObservedTokens: historicalPeakTokens(timed, 5 * 60 * 60 * 1000),
    providerQuota: unavailable("no first-party Provider quota data is available from the selected Harness"),
    remainingProviderQuota: unavailable("remaining Provider quota is unavailable without first-party allowance data"),
    resetAt: unavailable("Provider reset time is unavailable without first-party allowance data"),
  };
}

function buildReportData(read: ReadResult, totalTokens: number | null, harness: Harness): ReportData {
  const tools = buildToolAnalysis(read);
  return {
    dailyUsage: buildDailyUsage(read.modelCalls, totalTokens, harness),
    hourlyActivity: buildHourlyActivity(read.modelCalls, totalTokens),
    hourlySupported: read.modelCalls.some((call) => timestampMs(call.timestamp) !== null),
    rollingWindow: buildRollingWindow(read.modelCalls),
    tools: tools.entries,
    totalToolAmplifiedTokens: tools.total,
    apiEquivalentCost: (() => {
      const cost = apiCost(read.modelCalls, harness);
      const coverage = cost.relevantTokens > 0 ? Math.round(cost.pricedTokens / cost.relevantTokens * 10000) / 100 : null;
      return { total: cost.cost, pricedTokens: countEvidence(cost.pricedTokens, "Token total with exact compatible local API rate"), relevantTokens: countEvidence(cost.relevantTokens, "selected Token total considered for API-equivalent pricing"), coveragePercent: coverage === null ? unavailable("no Token total was available for price coverage") : { value: coverage, provenance: "derived", method: "priced Token total divided by relevant Token total" }, unpricedModels: cost.unpricedModels, limitations: cost.limitations, source: { version: API_RATE_SOURCE.version, retrievedAt: API_RATE_SOURCE.retrievedAt, currency: API_RATE_SOURCE.currency, unit: API_RATE_SOURCE.unit } };
    })(),
  };
}

function projectKey(cwd: string | null, scope: ReadScope): string {
  if (!cwd) return "<unknown-project>";
  if (!scope.allProjects) return "<current-project>";
  return `project-${createHash("sha256").update(cwd).digest("hex").slice(0, 12)}`;
}

function topSession(sessions: SessionRecord[], calls: ModelCallRecord[]): { session: SessionRecord; tokens: number } | null {
  const candidates = sessions
    .map((session) => ({ session, tokens: sessionTotal(session.sessionId, calls), calls: calls.filter((call) => call.sessionId === session.sessionId).length }))
    .filter((candidate): candidate is { session: SessionRecord; tokens: number; calls: number } => candidate.tokens !== null && candidate.calls > 0)
    .sort((left, right) => right.tokens - left.tokens || left.session.sessionId.localeCompare(right.session.sessionId));
  return candidates[0] ? { session: candidates[0].session, tokens: candidates[0].tokens } : null;
}

function laterCalls(tool: ToolCallRecord, calls: ModelCallRecord[], lifecycle: ReadResult["lifecycle"]): number {
  if (!tool.timestamp) return 0;
  const toolTime = Date.parse(tool.timestamp);
  if (Number.isNaN(toolTime)) return 0;
  const nextCompaction = lifecycle
    .filter((event) => event.sessionId === tool.sessionId && event.kind === "compaction" && event.timestamp)
    .map((event) => Date.parse(event.timestamp!))
    .filter((time) => !Number.isNaN(time) && time > toolTime)
    .sort((left, right) => left - right)[0];
  return calls.filter((call) => {
    if (call.sessionId !== tool.sessionId || !call.timestamp) return false;
    const callTime = Date.parse(call.timestamp);
    return !Number.isNaN(callTime) && callTime > toolTime && (nextCompaction === undefined || callTime < nextCompaction);
  }).length;
}

function toolAmplification(read: ReadResult): {
  tokens: number | null;
  largestTokens: number | null;
  tool: ToolCallRecord | null;
  laterCalls: number;
} {
  const contextCalls = read.modelCalls.filter((call) => call.activeBranch !== false);
  let total = 0;
  let hasResult = false;
  let largest: { tool: ToolCallRecord; tokens: number; laterCalls: number } | null = null;
  for (const tool of read.toolCalls) {
    if (tool.resultChars === null || tool.resultChars === undefined) continue;
    hasResult = true;
    const estimatedResultTokens = tool.resultChars / 4;
    const following = laterCalls(tool, contextCalls, read.lifecycle);
    const tokens = estimatedResultTokens * following;
    total += tokens;
    if (!largest || tokens > largest.tokens) largest = { tool, tokens, laterCalls: following };
  }
  return {
    tokens: hasResult ? total : null,
    largestTokens: largest?.tokens ?? null,
    tool: largest?.tool ?? null,
    laterCalls: largest?.laterCalls ?? 0,
  };
}

function evidenceForCount(value: number, method: string): EvidenceValue {
  return { value, provenance: "derived", method };
}

function codexSessionComposition(read: ReadResult, harness: Harness): { topLevel: EvidenceValue; subagent: EvidenceValue } {
  if (harness !== "codex") {
    const value = unavailable("this Harness does not expose Codex subagent source metadata");
    return { topLevel: value, subagent: value };
  }
  if (read.sessions.some((session) => session.isSubagent === null || session.isSubagent === undefined)) {
    const value = unavailable("one or more selected Codex Sessions lack source metadata needed to classify subagents");
    return { topLevel: value, subagent: value };
  }
  const subagent = read.sessions.filter((session) => session.isSubagent === true).length;
  return {
    topLevel: evidenceForCount(read.sessions.length - subagent, "count of selected Codex Sessions whose source metadata is not subagent"),
    subagent: evidenceForCount(subagent, "count of selected Codex Sessions whose source metadata is subagent"),
  };
}

function automatedChecks(
  largest: { session: SessionRecord; tokens: number } | null,
  largestCalls: ModelCallRecord[],
  tokenTotal: number | null,
  amplification: ReturnType<typeof toolAmplification>,
  extraLifecycle: ReadResult["lifecycle"],
  rankings: ContributionRankings,
  coverage: ReadResult["coverage"],
): AutomatedCheck[] {
  const checks: AutomatedCheck[] = [];
  if (largest && largestCalls.length >= 2 && tokenTotal !== null && tokenTotal > 0 && largest.tokens / tokenTotal >= 0.4) checks.push({ id: "long_session", outcome: "warning", method: "largest complete Session share is at least 40% with at least two ModelCall records", evidence: [{ value: largest.tokens, provenance: "derived", method: "sum of complete ModelCall token totals", source: { sessionId: largest.session.sessionId } }, evidenceForCount(largestCalls.length, "count of ModelCall records in the Session"), sharePercentEvidence(largest.tokens, tokenTotal, "largest complete Session", { sessionId: largest.session.sessionId })] });
  if (amplification.largestTokens !== null && amplification.largestTokens > 0 && amplification.tool) checks.push({ id: "tool_amplification", outcome: "warning", method: "largest paired tool-result estimate is greater than zero", evidence: [{ value: amplification.tool.resultChars ?? null, provenance: "derived", method: "Unicode text-character length of the paired tool result; content is not returned", source: { sessionId: amplification.tool.sessionId, recordId: amplification.tool.callId, timestamp: amplification.tool.timestamp ?? undefined } }, evidenceForCount(amplification.laterCalls, "later ModelCall records in the same active Session"), { value: amplification.largestTokens, provenance: "estimated", method: "result text characters / 4 × later ModelCall records", source: { sessionId: amplification.tool.sessionId, recordId: amplification.tool.callId } }] });
  if (extraLifecycle.length > 0) checks.push({ id: "extra_calls", outcome: "notice", method: "count of observed retry, interruption, and subagent lifecycle records is greater than zero", evidence: [evidenceForCount(extraLifecycle.length, "count of observed retry, interruption, and subagent lifecycle records")] });
  const topModel = rankings.models[0];
  if (topModel && rankings.models.length >= 2 && typeof topModel.sharePercent.value === "number" && topModel.sharePercent.value >= 60) checks.push({ id: "model_concentration", outcome: "notice", method: "largest complete model contribution share is at least 60% when more than one model is observed", evidence: [topModel.value, topModel.sharePercent, topModel.count] });
  const coverageEvidence = [
    evidenceForCount(coverage.filesRead, "count of source files read"),
    evidenceForCount(coverage.recordsRead, "count of source records read"),
    evidenceForCount(coverage.recordsSkipped, "count of skipped records"),
    evidenceForCount(coverage.partialSessions, "count of partial Sessions"),
    evidenceForCount(coverage.warnings.length, "count of coverage warnings"),
  ];
  if (coverage.recordsSkipped > 0 || coverage.partialSessions > 0 || coverage.warnings.length > 0) {
    checks.push({ id: "data_quality", outcome: "warning", method: "coverage reports skipped records, partial Sessions, or warnings", evidence: coverageEvidence });
  } else if (coverage.recordsRead > 0) {
    checks.push({ id: "data_quality", outcome: "pass", method: "coverage reports at least one record with no skipped records, partial Sessions, or warnings", evidence: coverageEvidence });
  }
  return checks;
}
export function analyseAudit(scope: ReadScope, read: ReadResult, harness: Harness): AuditResult {
  const tokenTotal = sumTokens(read.modelCalls);
  const reportedCost = sumReportedCost(read.modelCalls);
  const largest = topSession(read.sessions, read.modelCalls);
  const largestCalls = largest ? read.modelCalls.filter((call) => call.sessionId === largest.session.sessionId) : [];
  const amplification = toolAmplification(read);
  const extraLifecycle = read.lifecycle.filter((event) => event.kind !== "compaction");
  const sessionComposition = codexSessionComposition(read, harness);
  const sessionProjects = new Map(read.sessions.map((session) => [session.sessionId, session.projectCwd]));
  const sessionById = new Map(read.sessions.map((session) => [session.sessionId, session]));
  const rankings: ContributionRankings = {
    sessions: rankContributions(
      read.modelCalls,
      (call) => call.sessionId,
      "Session",
      tokenTotal.value,
      (key) => {
        const session = sessionById.get(key);
        return session ? sessionDisplayName(session) : undefined;
      },
    ),
    projects: rankContributions(read.modelCalls, (call) => projectKey(sessionProjects.get(call.sessionId) ?? null, scope), "project", tokenTotal.value),
    models: rankContributions(read.modelCalls, (call) => call.model ?? "<unknown-model>", "model", tokenTotal.value),
    timeBuckets: rankContributions(read.modelCalls, (call) => timeBucket(call.timestamp), "time bucket", tokenTotal.value),
  };
  const shareFraction = largest && tokenTotal.value !== null && tokenTotal.value > 0
    ? largest.tokens / tokenTotal.value
    : null;
  const summary: Record<string, EvidenceValue> = {
    sessionCount: countEvidence(read.sessions.length, "count of selected Session records"),
    topLevelSessionCount: sessionComposition.topLevel,
    subagentSessionCount: sessionComposition.subagent,
    modelCallCount: countEvidence(read.modelCalls.length, "count of selected ModelCall records"),
    activeBranchModelCallCount: countEvidence(
      read.modelCalls.filter((call) => call.activeBranch !== false).length,
      "count of selected ModelCall records in the active context; non-Pi calls are treated as active",
    ),
    activeBranchTokens: (() => {
      const active = sumTokens(read.modelCalls.filter((call) => call.activeBranch !== false));
      return active.value === null
        ? unavailable("a complete active-context token total was not reported for every selected model call")
        : { value: active.value, provenance: active.provenance, method: "sum of selected active-context ModelCall token totals" };
    })(),
    totalTokens: tokenTotal.value === null
      ? unavailable("a complete token total was not reported for every selected model call")
      : {
        value: tokenTotal.value,
        provenance: tokenTotal.provenance,
        method: tokenTotal.provenance === "reported"
          ? "sum of non-cumulative per-response usage"
          : "sum of available per-call token totals",
      },
    reportedCost: reportedCost === null
      ? unavailable("the selected history did not report a complete cost total")
      : { value: reportedCost, provenance: "reported", method: "sum of reported per-call cost values" },
    topSessionId: largest
      ? { value: largest.session.sessionId, provenance: "derived", method: "largest complete Session token total" }
      : unavailable("no Session has a complete token total"),
    topSessionTokens: largest
      ? { value: largest.tokens, provenance: "derived", method: "sum of that Session's complete ModelCall totals", source: { sessionId: largest.session.sessionId } }
      : unavailable("no Session has a complete token total"),
    topSessionTitle: largest && largest.session.title
      ? { value: largest.session.title, provenance: "reported", method: "title from the Harness Session metadata", source: { sessionId: largest.session.sessionId } }
      : unavailable("the selected Harness did not provide a title for the largest Session"),
    topSessionSharePercent: largest
      ? sharePercentEvidence(largest.tokens, tokenTotal.value, "largest complete Session", { sessionId: largest.session.sessionId })
      : unavailable("no Session has a complete token total"),
    topProject: rankings.projects[0]?.value ?? unavailable("no project has a complete token total"),
    topModel: rankings.models[0]?.value ?? unavailable("no model has a complete token total"),
    topTimeBucket: rankings.timeBuckets[0]?.value ?? unavailable("no time bucket has a complete token total"),
    toolCallCount: evidenceForCount(read.toolCalls.length, "count of selected ToolCall records"),
    pairedToolResultCount: evidenceForCount(
      read.toolCalls.filter((tool) => tool.resultBytes !== null).length,
      "count of ToolCall records with a paired result size",
    ),
    estimatedToolAmplifiedTokens: amplification.tokens === null
      ? unavailable("no paired tool result size was available")
      : {
        value: amplification.tokens,
        provenance: "estimated",
        method: "UTF-8 text characters divided by 4, multiplied by later ModelCall records in the same active context",
        source: amplification.tool ? { sessionId: amplification.tool.sessionId, recordId: amplification.tool.callId, timestamp: amplification.tool.timestamp ?? undefined } : undefined,
      },
    lifecycleCount: evidenceForCount(read.lifecycle.length, "count of retry, compaction, subagent, and interrupted lifecycle records"),
    extraLifecycleCount: evidenceForCount(extraLifecycle.length, "count of retry, interruption, and subagent lifecycle records"),
  };

  const checks = automatedChecks(largest, largestCalls, tokenTotal.value, amplification, extraLifecycle, rankings, read.coverage);

  return {
    scope: {
      harness,
      cwd: scope.allProjects ? null : "<current-project>",
      allProjects: scope.allProjects,
      since: scope.since.toISOString(),
    },
    coverage: read.coverage,
    summary,
    rankings,
    report: buildReportData(read, tokenTotal.value, harness),
    checks,
  };
}

export function analyseCodex(scope: ReadScope, read: ReadResult): AuditResult {
  return analyseAudit(scope, read, "codex");
}
