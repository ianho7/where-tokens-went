import { createHash } from "node:crypto";
import type {
  AuditResult,
  AutomatedCheck,
  CacheEconomics,
  ContributionEntry,
  ContributionRankings,
  EvidenceValue,
  FirstRequestBurden,
  FirstRequestGroup,
  Harness,
  ModelCallRecord,
  ReadResult,
  ReadScope,
  ReportData,
  SessionCostRecord,
  SessionRecord,
  SkillAnalysisEntry,
  SkillUseRecord,
  ToolAnalysisEntry,
  TokenBreakdown,
  TurnAnalysisEntry,
  TurnDiagnosticCandidate,
  TurnDiagnosticKind,
  TurnRecord,
  ToolCallRecord,
} from "./types";
import { pricingProviderForHarness, UNAVAILABLE_PRICING, rateForInput, type ApiPricingContext, type ApiRate } from "./rates";

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

function derivedTotal(call: ModelCallRecord, harness: Harness): number | null {
  if (harness === "claude") {
    if ([call.inputTokens, call.cachedInputTokens, call.cacheWriteTokens, call.outputTokens].some((value) => value === null)) return null;
    return call.inputTokens! + call.cachedInputTokens! + call.cacheWriteTokens! + call.outputTokens!;
  }
  if ([call.inputTokens, call.outputTokens, call.reasoningTokens].some((value) => value === null)) return null;
  return call.inputTokens! + call.outputTokens! + call.reasoningTokens!;
}

function callTokens(call: ModelCallRecord, harness: Harness): number | null {
  return call.totalTokens ?? derivedTotal(call, harness);
}

function sessionTotal(sessionId: string, calls: ModelCallRecord[], harness: Harness): number | null {
  const ownCalls = calls.filter((call) => call.sessionId === sessionId);
  if (ownCalls.length === 0 || ownCalls.some((call) => callTokens(call, harness) === null)) return null;
  return ownCalls.reduce((total, call) => total + callTokens(call, harness)!, 0);
}

function sumTokens(calls: ModelCallRecord[], harness: Harness): { value: number | null; provenance: "reported" | "derived" | "unavailable" } {
  if (calls.length === 0 || calls.some((call) => callTokens(call, harness) === null)) {
    return { value: null, provenance: "unavailable" };
  }
  const value = calls.reduce((total, call) => total + callTokens(call, harness)!, 0);
  const allReported = calls.every((call) => call.totalTokens !== null && call.tokenProvenance === "reported");
  return { value, provenance: allReported ? "reported" : "derived" };
}

function sumReportedCost(calls: ModelCallRecord[]): number | null {
  if (calls.length === 0 || calls.some((call) => call.reportedCost === null)) return null;
  return calls.reduce((total, call) => total + call.reportedCost!, 0);
}

function reportedCostForRead(read: ReadResult): number | null {
  const snapshots = read.sessionCosts ?? [];
  if (snapshots.length > 0) {
    const selectedSessionIds = new Set(read.sessions.map((session) => session.sessionId));
    const latest = (sessionId: string): SessionCostRecord | undefined => snapshots
      .filter((snapshot) => snapshot.sessionId === sessionId && snapshot.totalCost !== null)
      .sort((left, right) => (right.timestamp ?? "").localeCompare(left.timestamp ?? ""))[0];
    if (selectedSessionIds.size === 0 || [...selectedSessionIds].some((sessionId) => !latest(sessionId))) return null;
    return [...selectedSessionIds].reduce((total, sessionId) => total + latest(sessionId)!.totalCost!, 0);
  }
  return sumReportedCost(read.modelCalls);
}

function rankContributions(
  calls: ModelCallRecord[],
  keyOf: (call: ModelCallRecord) => string,
  label: string,
  totalTokens: number | null,
  harness: Harness,
  displayNameOf?: (key: string) => string | undefined,
): ContributionEntry[] {
  const groups = new Map<string, { tokens: number; complete: boolean; reported: boolean; count: number }>();
  for (const call of calls) {
    const key = keyOf(call);
    const existing = groups.get(key) ?? { tokens: 0, complete: true, reported: true, count: 0 };
    existing.count += 1;
    const total = callTokens(call, harness);
    if (total === null) {
      existing.complete = false;
    } else {
      existing.tokens += total;
    }
    existing.reported = existing.reported && call.totalTokens !== null && call.tokenProvenance === "reported";
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

type Composition = { input: number; cached: number; cacheWrite: number; output: number; unclassified: number; total: number };

function totalTokenEvidence(calls: ModelCallRecord[], label: string, harness: Harness): EvidenceValue {
  const total = sumTokens(calls, harness);
  if (total.value === null) return unavailable(label + " was not reported for every selected ModelCall");
  return { value: total.value, provenance: total.provenance, method: "sum of non-cumulative ModelCall token totals or complete Harness composition for " + label };
}

function composition(call: ModelCallRecord, harness: Harness): Composition | null {
  const total = callTokens(call, harness);
  const { inputTokens: input, cachedInputTokens: cached, cacheWriteTokens: cacheWrite, outputTokens: output } = call;
  if ([total, input, cached, cacheWrite, output].some((value) => value === null)) return null;
  if ([total, input, cached, cacheWrite, output].some((value) => value! < 0)) return null;
  if (harness === "codex") {
    const ordinaryInput = input! - cached! - cacheWrite!;
    const unclassified = total! - input! - output!;
    return ordinaryInput >= 0 && unclassified >= 0
      ? { input: ordinaryInput, cached: cached!, cacheWrite: cacheWrite!, output: output!, unclassified, total: total! }
      : null;
  }
  if (input! + cached! + cacheWrite! + output! !== total) return null;
  return { input: input!, cached: cached!, cacheWrite: cacheWrite!, output: output!, unclassified: 0, total: total! };
}

function tokenBreakdown(calls: ModelCallRecord[], label: string, harness: Harness): TokenBreakdown {
  const parts = calls.map((call) => composition(call, harness));
  const totalTokens = totalTokenEvidence(calls, label, harness);
  if (calls.length === 0 || parts.some((part) => part === null)) {
    const missing = unavailable(label + " lacks a source-proven mutually exclusive Token composition");
    return { inputTokens: missing, cachedInputTokens: missing, cacheWriteTokens: missing, outputTokens: missing, unclassifiedTokens: missing, reasoningTokens: unavailable(label + " reasoning tokens were retained only as raw evidence"), totalTokens };
  }
  const sum = (field: keyof Composition, method: string): EvidenceValue => ({ value: parts.reduce((total, part) => total + part![field], 0), provenance: "derived", method });
  const reasoning = calls.every((call) => call.reasoningTokens !== null)
    ? { value: calls.reduce((total, call) => total + call.reasoningTokens!, 0), provenance: "derived" as const, method: label + " sum of source-reported reasoning Token fields; reasoning is not added to output" }
    : unavailable(label + " reasoning was not reported for every selected ModelCall");
  return {
    inputTokens: sum("input", label + " ordinary input is source-proven non-cache input"),
    cachedInputTokens: sum("cached", label + " cache-hit input is mutually exclusive"),
    cacheWriteTokens: sum("cacheWrite", label + " cache-build input is mutually exclusive"),
    outputTokens: sum("output", label + " output is mutually exclusive"),
    unclassifiedTokens: sum("unclassified", label + " residual closes the reported Token total without reclassifying source fields"),
    reasoningTokens: reasoning,
    totalTokens,
  };
}

function cacheWritePrice(
  call: ModelCallRecord,
  part: Composition,
  harness: Harness,
  rate: ApiRate,
): number | null {
  if (part.cacheWrite === 0) return 0;
  if (harness !== "claude") {
    return rate.cacheWrite5mPerMillion === null ? null : part.cacheWrite * rate.cacheWrite5mPerMillion;
  }
  const five = call.cacheWrite5mTokens;
  const one = call.cacheWrite1hTokens;
  if (call.cacheWriteTtl === "5m" && (five === null || five === undefined || five === part.cacheWrite) && (one === null || one === undefined || one === 0)) {
    return rate.cacheWrite5mPerMillion === null ? null : part.cacheWrite * rate.cacheWrite5mPerMillion;
  }
  if (call.cacheWriteTtl === "1h" && (one === null || one === undefined || one === part.cacheWrite) && (five === null || five === undefined || five === 0)) {
    return rate.cacheWrite1hPerMillion === null ? null : part.cacheWrite * rate.cacheWrite1hPerMillion;
  }
  if (typeof five !== "number" || typeof one !== "number" || five < 0 || one < 0 || five + one !== part.cacheWrite) return null;
  if (five > 0 && rate.cacheWrite5mPerMillion === null) return null;
  if (one > 0 && rate.cacheWrite1hPerMillion === null) return null;
  return five * (rate.cacheWrite5mPerMillion ?? 0) + one * (rate.cacheWrite1hPerMillion ?? 0);
}

function roundCurrency(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}

function pricingSourceLabel(pricing: ApiPricingContext): string {
  return "the LiteLLM model catalog with the selected Harness-to-Provider mapping";
}

function apiCost(calls: ModelCallRecord[], harness: Harness, pricing: ApiPricingContext): {
  cost: EvidenceValue;
  allUncachedCost: EvidenceValue;
  pricedTokens: number;
  relevantTokens: number;
  unpricedModels: string[];
  limitations: string[];
} {
  let observed = 0; let allUncached = 0; let pricedTokens = 0; let relevantTokens = 0;
  const unpricedModels = new Set<string>(); const limitations = new Set(pricing.limitations);
  const expectedProvider = pricingProviderForHarness(harness);
  for (const call of calls) {
    const total = callTokens(call, harness);
    if (total === null) { limitations.add("missing Token total"); continue; }
    relevantTokens += total;
    const provider = call.provider ?? expectedProvider;
    const baseRate = call.model && provider === expectedProvider
      ? pricing.rates.find((candidate) => candidate.provider === provider && candidate.model === call.model)
      : undefined;
    const part = composition(call, harness);
    if (!call.provider) limitations.add("Provider was derived from the selected Harness for pricing: " + expectedProvider);
    if (call.provider && call.provider !== expectedProvider) limitations.add("Provider did not match the selected Harness: " + call.provider);
    if (!call.model) limitations.add("missing exact model identifier");
    if (!baseRate) {
      unpricedModels.add(call.model ?? "<unknown-model>");
      limitations.add("no resolved price entry for " + provider + "/" + (call.model ?? "<unknown-model>"));
      continue;
    }
    if (!part || part.unclassified !== 0) {
      limitations.add("missing compatible price dimension or mutually exclusive Token composition");
      continue;
    }
    const rate = rateForInput(baseRate, part.input + part.cached + part.cacheWrite);
    const inputPrice = rate.inputPerMillion;
    const cachedPrice = rate.cachedInputPerMillion;
    const outputPrice = rate.outputPerMillion;
    const writePrice = cacheWritePrice(call, part, harness, rate);
    const needsInputPrice = part.input + part.cached + part.cacheWrite > 0;
    if ((needsInputPrice && inputPrice === null) || (part.cached > 0 && cachedPrice === null) || (part.output > 0 && outputPrice === null) || writePrice === null) {
      limitations.add(writePrice === null && part.cacheWrite > 0
        ? "cache-write TTL or cache-write price dimension was unavailable"
        : "missing compatible price dimension for a non-zero Token bucket");
      continue;
    }
    observed += part.input * (inputPrice ?? 0) + part.cached * (cachedPrice ?? 0) + (writePrice ?? 0) + part.output * (outputPrice ?? 0);
    allUncached += (part.input + part.cached + part.cacheWrite) * (inputPrice ?? 0) + part.output * (outputPrice ?? 0);
    pricedTokens += total;
  }
  const hasPricedUsage = pricedTokens > 0;
  const exact = hasPricedUsage && pricedTokens === relevantTokens;
  const partialScope = exact
    ? ""
    : "; partial estimate covers priced Usage only; unpriced or incompatible Usage is excluded";
  const observedEvidence = hasPricedUsage
    ? { value: roundCurrency(observed / 1_000_000), provenance: "estimated" as const, method: (exact ? "exact" : "partial") + " Provider and model match against " + pricingSourceLabel(pricing) + partialScope + "; mutually exclusive input, cache-read, cache-write and output buckets are priced separately" }
    : unavailable("currency requires at least one selected ModelCall with an exact Provider/model match and compatible non-zero price dimensions");
  const allUncachedEvidence = hasPricedUsage
    ? { value: roundCurrency(allUncached / 1_000_000), provenance: "estimated" as const, method: (exact ? "all-uncached counterfactual" : "partial all-uncached counterfactual") + " prices ordinary input, cache-read and cache-write tokens at the resolved base input rate and leaves output unchanged" + partialScope }
    : unavailable("the all-uncached comparison requires at least one selected ModelCall with compatible exact pricing");
  if (hasPricedUsage && !exact) limitations.add("cost estimate covers only priced Usage; unpriced or incompatible Usage is excluded");
  return {
    cost: observedEvidence,
    allUncachedCost: allUncachedEvidence,
    pricedTokens,
    relevantTokens,
    unpricedModels: [...unpricedModels].sort(),
    limitations: [...limitations].sort(),
  };
}

function percentageEvidence(numerator: number, denominator: number, label: string): EvidenceValue {
  if (denominator <= 0) return unavailable("the " + label + " denominator was zero or unavailable");
  return {
    value: Math.round((numerator / denominator) * 10000) / 100,
    provenance: "derived",
    method: label + " numerator divided by denominator, expressed as percentage points and rounded to two decimals",
  };
}

function composedCalls(calls: ModelCallRecord[], harness: Harness): Array<{ call: ModelCallRecord; part: Composition }> {
  return calls
    .map((call) => ({ call, part: composition(call, harness) }))
    .filter((entry): entry is { call: ModelCallRecord; part: Composition } => entry.part !== null);
}

function cacheEconomics(calls: ModelCallRecord[], harness: Harness, cost: ReturnType<typeof apiCost>): CacheEconomics {
  const composed = composedCalls(calls, harness);
  const limitations = new Set(cost.limitations);
  if (composed.length !== calls.length) limitations.add("calls with missing or inconsistent Token composition were excluded from cache ratios");
  const totalInput = composed.reduce((sum, entry) => sum + entry.part.input + entry.part.cached + entry.part.cacheWrite, 0);
  const input = composed.reduce((sum, entry) => sum + entry.part.input, 0);
  const cached = composed.reduce((sum, entry) => sum + entry.part.cached, 0);
  const cacheWrite = composed.reduce((sum, entry) => sum + entry.part.cacheWrite, 0);
  const supportedTokens = composed.reduce((sum, entry) => sum + entry.part.total, 0);
  const selectedTotal = calls.map((call) => callTokens(call, harness));
  const hasCompleteSelectedTotal = selectedTotal.length > 0 && selectedTotal.every((value): value is number => value !== null);
  const coverage = composed.length === 0
    ? unavailable("no ModelCall had a complete mutually exclusive Token composition for cache coverage")
    : hasCompleteSelectedTotal
      ? percentageEvidence(supportedTokens, selectedTotal.reduce((sum, value) => sum + value, 0), "cache composition coverage")
      : unavailable("selected Token total was incomplete for cache composition coverage");
  const amount = (value: number, label: string): EvidenceValue => ({ value, provenance: "derived", method: "sum of compatible " + label + " Token buckets" });
  const readRate = totalInput > 0
    ? percentageEvidence(cached, totalInput, "cache-read Token count")
    : unavailable("cache-read rate requires a non-zero ordinary-input plus cache-read plus cache-write denominator");
  const writeRate = totalInput > 0
    ? percentageEvidence(cacheWrite, totalInput, "cache-write Token count")
    : unavailable("cache-write rate requires a non-zero ordinary-input plus cache-read plus cache-write denominator");
  const partialScope = cost.pricedTokens > 0 && cost.pricedTokens < cost.relevantTokens
    ? " over the priced Usage subset; unpriced or incompatible Usage is excluded"
    : "";
  const savings = typeof cost.cost.value === "number" && typeof cost.allUncachedCost.value === "number"
    ? { value: roundCurrency(cost.allUncachedCost.value - cost.cost.value), provenance: "estimated" as const, method: "all-uncached API-equivalent estimate minus observed API-equivalent estimate" + partialScope + "; positive means caching lowered the estimate" }
    : unavailable("cache savings requires at least one priced Usage with complete compatible cost dimensions");
  const savingsPercent = typeof savings.value === "number" && typeof cost.allUncachedCost.value === "number"
    ? { value: cost.allUncachedCost.value === 0 ? null : Math.round((savings.value / cost.allUncachedCost.value) * 10000) / 100, provenance: cost.allUncachedCost.value === 0 ? "unavailable" as const : "estimated" as const, method: cost.allUncachedCost.value === 0 ? "all-uncached API-equivalent cost was zero" : "cache savings divided by all-uncached API-equivalent cost" + partialScope + ", expressed as percentage points and rounded to two decimals" }
    : unavailable("cache savings percentage requires at least one priced Usage with complete compatible cost dimensions");
  if (composed.length === 0 && calls.length > 0) limitations.add("cache Token ratios are unavailable because no selected call has compatible composition");
  return {
    totalInputTokens: composed.length > 0 ? amount(totalInput, "request input") : unavailable("no compatible request input Token was available"),
    inputTokens: composed.length > 0 ? amount(input, "ordinary input") : unavailable("no compatible ordinary input Token was available"),
    cachedInputTokens: composed.length > 0 ? amount(cached, "cache-read input") : unavailable("no compatible cache-read input Token was available"),
    cacheWriteTokens: composed.length > 0 ? amount(cacheWrite, "cache-write input") : unavailable("no compatible cache-write input Token was available"),
    cacheReadRatePercent: readRate,
    cacheWriteRatePercent: writeRate,
    coveragePercent: coverage,
    observedApiEquivalentCost: cost.cost,
    allUncachedApiEquivalentCost: cost.allUncachedCost,
    cacheSavings: savings,
    cacheSavingsPercent: savingsPercent,
    pricedUsageCoveragePercent: cost.relevantTokens > 0
      ? percentageEvidence(cost.pricedTokens, cost.relevantTokens, "priced Usage")
      : unavailable("no selected Token total was available for price coverage"),
    limitations: [...limitations].sort(),
  };
}

function apiEquivalentCost(calls: ModelCallRecord[], harness: Harness, pricing: ApiPricingContext): ReportData["apiEquivalentCost"] {
  const cost = apiCost(calls, harness, pricing);
  const partialScope = cost.pricedTokens > 0 && cost.pricedTokens < cost.relevantTokens
    ? " over the priced Usage subset; unpriced or incompatible Usage is excluded"
    : "";
  const difference = typeof cost.allUncachedCost.value === "number" && typeof cost.cost.value === "number"
    ? { value: roundCurrency(cost.allUncachedCost.value - cost.cost.value), provenance: "estimated" as const, method: "all-uncached API-equivalent estimate minus observed API-equivalent estimate" + partialScope }
    : unavailable("cost difference requires at least one priced Usage with complete compatible cost dimensions");
  const differencePercent = typeof difference.value === "number" && typeof cost.allUncachedCost.value === "number"
    ? cost.allUncachedCost.value === 0
      ? unavailable("cost difference percentage requires a non-zero all-uncached estimate")
      : { value: Math.round((difference.value / cost.allUncachedCost.value) * 10000) / 100, provenance: "estimated" as const, method: "cost difference divided by all-uncached API-equivalent estimate" + partialScope + ", expressed as percentage points and rounded to two decimals" }
    : unavailable("cost difference percentage requires at least one priced Usage with complete compatible cost dimensions");
  return {
    total: cost.cost,
    allUncachedTotal: cost.allUncachedCost,
    difference,
    differencePercent,
    pricedTokens: { value: cost.pricedTokens, provenance: "derived", method: "Token total of ModelCalls with exact compatible resolved API pricing" },
    relevantTokens: { value: cost.relevantTokens, provenance: "derived", method: "selected ModelCall Token total considered for API-equivalent pricing" },
    coveragePercent: cost.relevantTokens > 0
      ? percentageEvidence(cost.pricedTokens, cost.relevantTokens, "priced Token total")
      : unavailable("no Token total was available for price coverage"),
    unpricedModels: cost.unpricedModels,
    limitations: cost.limitations,
    source: pricing.source,
  };
}

function callQuality(call: ModelCallRecord): number {
  return [call.inputTokens, call.cachedInputTokens, call.cacheWriteTokens, call.outputTokens, call.reasoningTokens, call.totalTokens]
    .filter((value) => value !== null).length;
}

function dedupeModelCalls(calls: ModelCallRecord[]): ModelCallRecord[] {
  const byIdentity = new Map<string, ModelCallRecord>();
  for (const call of calls) {
    const identity = call.callId
      ? call.sessionId + "|call|" + call.callId
      : call.sessionId + "|shape|" + [call.timestamp, call.provider, call.model, call.inputTokens, call.cachedInputTokens, call.cacheWriteTokens, call.outputTokens, call.reasoningTokens, call.totalTokens].join("|");
    const existing = byIdentity.get(identity);
    if (!existing || callQuality(call) > callQuality(existing)) byIdentity.set(identity, call);
  }
  return [...byIdentity.values()];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function firstRequestGroup(calls: ModelCallRecord[], totalTokens: number | null, label: string, harness: Harness): FirstRequestGroup {
  const tokens = calls.map((call) => callTokens(call, harness)).filter((value): value is number => value !== null);
  const composed = composedCalls(calls, harness);
  const total = tokens.reduce((sum, value) => sum + value, 0);
  const requestInput = composed.reduce((sum, entry) => sum + entry.part.input + entry.part.cached + entry.part.cacheWrite, 0);
  const cached = composed.reduce((sum, entry) => sum + entry.part.cached, 0);
  const cacheWrite = composed.reduce((sum, entry) => sum + entry.part.cacheWrite, 0);
  const input = composed.reduce((sum, entry) => sum + entry.part.input, 0);
  const output = composed.reduce((sum, entry) => sum + entry.part.output, 0);
  const medianValue = median(tokens);
  const compositionCoverage = composed.length === 0
    ? unavailable(label + " has no compatible Token composition")
    : percentageEvidence(composed.reduce((sum, entry) => sum + entry.part.total, 0), tokens.length > 0 ? total : 0, label + " compatible Token composition");
  const cold = composed.filter((entry) => entry.part.cached === 0).length;
  return {
    sessionCount: { value: calls.length, provenance: "derived", method: "count of selected Sessions with one earliest valid ModelCall in " + label },
    medianTokens: medianValue === null ? unavailable("no valid first-request Token totals were available for " + label) : { value: medianValue, provenance: "derived", method: "median of earliest valid ModelCall Token totals in " + label },
    totalTokens: tokens.length === calls.length && calls.length > 0
      ? { value: total, provenance: "derived", method: "sum of one earliest valid ModelCall Token total per Session in " + label }
      : unavailable("a complete first-request Token total was unavailable for " + label),
    sharePercent: sharePercentEvidence(total, totalTokens, label + " first-request Token total", undefined, "complete selected Token total"),
    compositionCoveragePercent: compositionCoverage,
    inputTokens: composed.length > 0 ? { value: input, provenance: "derived", method: "sum of compatible ordinary input in " + label } : unavailable("ordinary input composition was unavailable for " + label),
    cachedInputTokens: composed.length > 0 ? { value: cached, provenance: "derived", method: "sum of compatible cache-read input in " + label } : unavailable("cache-read composition was unavailable for " + label),
    cacheWriteTokens: composed.length > 0 ? { value: cacheWrite, provenance: "derived", method: "sum of compatible cache-write input in " + label } : unavailable("cache-write composition was unavailable for " + label),
    outputTokens: composed.length > 0 ? { value: output, provenance: "derived", method: "sum of compatible output in " + label } : unavailable("output composition was unavailable for " + label),
    cacheReadRatePercent: requestInput > 0 ? percentageEvidence(cached, requestInput, label + " cache-read Token count") : unavailable(label + " cache-read rate has a zero request-input denominator"),
    coldSessionCount: composed.length > 0 ? { value: cold, provenance: "derived", method: "count of first requests with zero cache-read input in " + label } : unavailable("cold first-request count was unavailable for " + label),
    coldSessionRatePercent: composed.length > 0 ? percentageEvidence(cold, composed.length, label + " cold first-request count") : unavailable("cold first-request rate was unavailable for " + label),
  };
}

function firstRequestBurden(read: ReadResult, harness: Harness): FirstRequestBurden {
  const deduped = dedupeModelCalls(read.modelCalls);
  const firstBySession = new Map<string, ModelCallRecord>();
  for (const call of deduped) {
    if (callTokens(call, harness) === null || timestampMs(call.timestamp) === null) continue;
    const current = firstBySession.get(call.sessionId);
    const currentTime = current ? timestampMs(current.timestamp)! : null;
    const time = timestampMs(call.timestamp)!;
    if (!current || time < currentTime! || (time === currentTime && (call.callId ?? "").localeCompare(current.callId ?? "") < 0)) firstBySession.set(call.sessionId, call);
  }
  const firstCalls = [...firstBySession.values()].sort((left, right) => (timestampMs(left.timestamp)! - timestampMs(right.timestamp)!) || (left.sessionId.localeCompare(right.sessionId)));
  const selectedTotal = sumTokens(read.modelCalls, harness);
  const group = firstRequestGroup(firstCalls, selectedTotal.value, "selected", harness);
  const limitations = new Set<string>(["首次请求负担 is an observed earliest request size, not an exact removable startup tax"]);
  if (firstCalls.length < read.sessions.length) limitations.add("Sessions without a timestamped valid ModelCall are excluded from first-request coverage");
  const composed = composedCalls(firstCalls, harness);
  if (composed.length < firstCalls.length) limitations.add("first-request cache composition is partial because some earliest calls are missing compatible Token fields");
  const knownIdentity = read.sessions.filter((session) => typeof session.isSubagent === "boolean").length;
  const identityCoverage = read.sessions.length > 0
    ? percentageEvidence(knownIdentity, read.sessions.length, "source-proven Session identity")
    : unavailable("no selected Sessions were available for top-level or Subagent identity coverage");
  let topLevel: FirstRequestGroup | null = null;
  let subagent: FirstRequestGroup | null = null;
  if (read.sessions.length > 0 && knownIdentity === read.sessions.length) {
    const identityBySession = new Map(read.sessions.map((session) => [session.sessionId, session.isSubagent]));
    topLevel = firstRequestGroup(firstCalls.filter((call) => identityBySession.get(call.sessionId) === false), selectedTotal.value, "top-level", harness);
    subagent = firstRequestGroup(firstCalls.filter((call) => identityBySession.get(call.sessionId) === true), selectedTotal.value, "Subagent", harness);
  } else {
    limitations.add("top-level versus Subagent first-request groups require source-proven identity for every selected Session");
  }
  return {
    sessionCount: { value: read.sessions.length, provenance: "derived", method: "count of selected Sessions in the Audit Scope" },
    validFirstRequestCount: { value: firstCalls.length, provenance: "derived", method: "count of Sessions with one earliest valid, deduplicated and timestamped ModelCall" },
    coveragePercent: read.sessions.length > 0 ? percentageEvidence(firstCalls.length, read.sessions.length, "valid first-request Session") : unavailable("first-request coverage has no selected Session denominator"),
    medianTokens: group.medianTokens,
    totalTokens: group.totalTokens,
    sharePercent: group.sharePercent,
    compositionCoveragePercent: group.compositionCoveragePercent,
    inputTokens: group.inputTokens,
    cachedInputTokens: group.cachedInputTokens,
    cacheWriteTokens: group.cacheWriteTokens,
    outputTokens: group.outputTokens,
    cacheReadRatePercent: group.cacheReadRatePercent,
    coldSessionCount: group.coldSessionCount,
    coldSessionRatePercent: group.coldSessionRatePercent,
    topLevel,
    subagent,
    identityCoveragePercent: identityCoverage,
    limitations: [...limitations].sort(),
  };
}

function skillEvidenceKey(record: SkillUseRecord): string {
  if (record.evidenceType === "listing") return [record.sessionId, record.skillName, record.evidenceType].join("|");
  return [record.sessionId, record.skillName, record.evidenceType, record.turnId, record.callId, record.timestamp, record.sourceLocation].join("|");
}

function dedupeSkillEvidence(records: SkillUseRecord[]): SkillUseRecord[] {
  const byKey = new Map<string, SkillUseRecord>();
  for (const record of records) {
    const key = skillEvidenceKey(record);
    const existing = byKey.get(key);
    if (!existing || (record.state === "attributed" && existing.state !== "attributed")) byKey.set(key, record);
  }
  return [...byKey.values()];
}

function skillAnalysis(read: ReadResult, harness: Harness, pricing: ApiPricingContext): SkillAnalysisEntry[] {
  const records = dedupeSkillEvidence(read.skillEvidence ?? []);
  if (records.length === 0) return [];
  const names = [...new Set(records.map((record) => record.skillName ?? "<unknown-skill>"))].sort();
  const calls = dedupeModelCalls(read.modelCalls);
  const strongAttributionBoundaries = new Set(records
    .filter((record) => record.evidenceType === "versioned-attribution")
    .map((record) => [record.sessionId, record.timestamp, record.skillName].join("|")));
  return names.map((name) => {
    const own = records.filter((record) => (record.skillName ?? "<unknown-skill>") === name);
    const invocationRecords = own.filter((record) => record.evidenceType !== "listing" && (record.state === "invoked" || record.state === "attributed") && (
      record.evidenceType === "versioned-attribution" || !strongAttributionBoundaries.has([record.sessionId, record.timestamp, record.skillName].join("|"))
    ));
    const matchedCalls = calls.filter((call) => invocationRecords.some((record) => record.sessionId === call.sessionId && ((record.callId !== null && record.callId === call.callId && record.evidenceType === "versioned-attribution") || (record.turnId !== null && record.turnId === call.turnId))));
    const state: SkillAnalysisEntry["state"] = matchedCalls.length > 0 || own.some((record) => record.state === "attributed")
      ? "attributed"
      : invocationRecords.length > 0
        ? "invoked"
        : own.some((record) => record.state === "available")
          ? "available"
          : "unavailable";
    const boundaries = new Set(invocationRecords.map((record) => [record.sessionId, record.turnId, record.callId, record.timestamp].join("|")));
    const associatedTokens = matchedCalls.length === 0 || matchedCalls.some((call) => callTokens(call, harness) === null)
      ? unavailable("no complete source-proven ModelCall Token total was associated with " + name)
      : { value: matchedCalls.reduce((sum, call) => sum + callTokens(call, harness)!, 0), provenance: "derived" as const, method: "sum of ModelCall Token totals matched by the Skill's source-proven call or turn boundary" };
    const associatedCost = matchedCalls.length === 0
      ? unavailable("no source-proven ModelCall was associated with " + name)
      : apiCost(matchedCalls, harness, pricing).cost;
    const timeValues = own.map((record) => record.timestamp).filter((value): value is string => value !== null && !Number.isNaN(Date.parse(value))).sort();
    const hasListing = own.some((record) => record.evidenceType === "listing");
    const directResources = invocationRecords.filter((record) => record.evidenceType === "resource-read" || record.evidenceType === "script-execution").length;
    const evidenceWithBoundary = own.filter((record) => record.timestamp !== null && (record.evidenceType === "listing" || record.callId !== null || record.turnId !== null)).length;
    return {
      name,
      state,
      availableSessions: hasListing
        ? { value: new Set(own.filter((record) => record.evidenceType === "listing").map((record) => record.sessionId)).size, provenance: "derived", method: "count of selected Sessions with an explicit Skill listing record" }
        : unavailable("Skill availability listing was not present in the selected history"),
      invocationCount: { value: boundaries.size, provenance: "derived", method: "count of deduplicated Skill invocation boundaries" },
      sessionCount: { value: new Set(invocationRecords.map((record) => record.sessionId)).size, provenance: "derived", method: "count of Sessions with a deduplicated Skill invocation boundary" },
      firstObservedAt: timeValues.length > 0 ? { value: timeValues[0], provenance: "reported", method: "earliest timestamp on the Skill evidence record" } : unavailable("Skill evidence had no usable timestamp"),
      lastObservedAt: timeValues.length > 0 ? { value: timeValues[timeValues.length - 1], provenance: "reported", method: "latest timestamp on the Skill evidence record" } : unavailable("Skill evidence had no usable timestamp"),
      attributedTokens: associatedTokens,
      attributedApiEquivalentCost: associatedCost,
      evidenceCoveragePercent: own.length > 0 ? percentageEvidence(evidenceWithBoundary, own.length, "usable " + name + " Skill evidence") : unavailable("no Skill evidence was available"),
      directResourceFootprint: { value: directResources, provenance: "derived", method: "count of directly evidenced Skill resource-read or Skill-owned script records; resource content is omitted" },
      observedAssociation: matchedCalls.length > 0 ? { value: matchedCalls.length, provenance: "derived", method: "count of ModelCalls associated with the Skill by a source-proven call or turn boundary" } : unavailable("no source-proven ModelCall association was available for " + name),
      causalImpact: unavailable("causal Skill impact requires a valid comparison or counterfactual, which local history does not provide"),
      evidenceTypes: [...new Set(own.map((record) => record.evidenceType))].sort(),
      sourceLocations: [...new Set(own.map((record) => record.sourceLocation).filter((value): value is string => value !== null))].sort(),
    };
  });
}

function hourBucket(timestamp: string | null): string | null {
  if (!timestamp) return null;
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 13) + ":00Z";
}

function buildDailyUsage(calls: ModelCallRecord[], totalTokens: number | null, harness: Harness, pricing: ApiPricingContext): ReportData["dailyUsage"] {
  const groups = new Map<string, ModelCallRecord[]>();
  for (const call of calls) {
    const key = timeBucket(call.timestamp);
    groups.set(key, [...(groups.get(key) ?? []), call]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, group]) => {
      const breakdown = tokenBreakdown(group, "day " + key, harness);
      const cost = apiCost(group, harness, pricing).cost;
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

function buildHourlyActivity(calls: ModelCallRecord[], totalTokens: number | null, harness: Harness): ReportData["hourlyActivity"] {
  const groups = new Map<string, ModelCallRecord[]>();
  for (const call of calls) {
    const key = hourBucket(call.timestamp);
    if (key) groups.set(key, [...(groups.get(key) ?? []), call]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, group]) => {
      const total = totalTokenEvidence(group, "hour " + key, harness);
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

function observedTokenEvidence(calls: ModelCallRecord[], label: string, harness: Harness): EvidenceValue {
  if (calls.length === 0) {
    return { value: 0, provenance: "derived", method: "no timestamped ModelCall records were observed in the " + label };
  }
  return totalTokenEvidence(calls, label, harness);
}

function historicalPeakTokens(calls: ModelCallRecord[], windowMilliseconds: number, harness: Harness): EvidenceValue {
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
    if (window.some((call) => callTokens(call, harness) === null)) continue;
    const total = window.reduce((sum, call) => sum + callTokens(call, harness)!, 0);
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

function buildRollingWindow(calls: ModelCallRecord[], harness: Harness): ReportData["rollingWindow"] {
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
    observedTokens: observedTokenEvidence(observed, "latest five-hour observed activity", harness),
    historicalPeakObservedTokens: historicalPeakTokens(timed, 5 * 60 * 60 * 1000, harness),
    providerQuota: unavailable("no first-party Provider quota data is available from the selected Harness"),
    remainingProviderQuota: unavailable("remaining Provider quota is unavailable without first-party allowance data"),
    resetAt: unavailable("Provider reset time is unavailable without first-party allowance data"),
  };
}

function timeEvidence(value: string | null, label: string): EvidenceValue {
  return value ? { value, provenance: "reported", method: label } : unavailable(label + " was unavailable");
}

function numericEvidence(value: number | null, provenance: EvidenceValue["provenance"], method: string): EvidenceValue {
  return value === null ? unavailable(method) : { value, provenance, method };
}

function turnObservedSpan(turn: TurnRecord): EvidenceValue {
  if (!turn.startedAt || !turn.endedAt) return unavailable("Turn observed span requires both a start and end timestamp");
  const started = Date.parse(turn.startedAt);
  const ended = Date.parse(turn.endedAt);
  return Number.isNaN(started) || Number.isNaN(ended) || ended < started
    ? unavailable("Turn observed span has unusable or reversed timestamps")
    : { value: ended - started, provenance: "derived", method: "Turn end timestamp minus Turn start timestamp; this is an observed span, not API latency" };
}

function turnEvidenceId(sessionId: string, turnId: string): string {
  return "turn:" + createHash("sha256").update(sessionId + "\0" + turnId).digest("hex").slice(0, 16);
}

function turnCoverage(turn: TurnAnalysisEntry): EvidenceValue {
  const fields = [
    turn.tokens.totalTokens.value !== null,
    turn.startedAt.value !== null,
    turn.endedAt.value !== null,
    turn.durationMs.value !== null,
    turn.timeToFirstTokenMs.value !== null,
    turn.modelCallCount.value !== null,
    turn.toolCallCount.value !== null,
    turn.errorCount.value !== null,
  ];
  return {
    value: Math.round((fields.filter(Boolean).length / fields.length) * 10000) / 100,
    provenance: "derived",
    method: "available Turn evidence fields divided by the eight Turn trajectory fields, expressed as percentage points",
  };
}

function buildTurnAnalysis(read: ReadResult, totalTokens: number | null, harness: Harness): {
  turns: TurnAnalysisEntry[];
  candidates: TurnDiagnosticCandidate[];
} {
  const sourceTurns = read.turns ?? [];
  const callsByTurn = new Map<string, ModelCallRecord[]>();
  for (const call of read.modelCalls) {
    if (!call.turnId) continue;
    const key = call.sessionId + "\0" + call.turnId;
    callsByTurn.set(key, [...(callsByTurn.get(key) ?? []), call]);
  }
  const turns: TurnAnalysisEntry[] = sourceTurns.map((turn) => {
    const key = turn.sessionId + "\0" + turn.turnId;
    const calls = callsByTurn.get(key) ?? (sourceTurns.filter((item) => item.sessionId === turn.sessionId).length === 1
      ? read.modelCalls.filter((call) => call.sessionId === turn.sessionId && !call.turnId)
      : []);
    const tools = read.toolCalls.filter((tool) => tool.sessionId === turn.sessionId && tool.turnId === turn.turnId);
    const lifecycle = read.lifecycle.filter((event) => event.sessionId === turn.sessionId && event.turnId === turn.turnId);
    const total = calls.every((call) => callTokens(call, harness) !== null) && calls.length > 0
      ? calls.reduce((sum, call) => sum + callTokens(call, harness)!, 0)
      : null;
    const entry: TurnAnalysisEntry = {
      sessionId: turn.sessionId,
      turnId: turn.turnId,
      ordinal: numericEvidence(turn.ordinal, "reported", "source Turn ordinal"),
      tokens: tokenBreakdown(calls, "Turn " + turn.turnId, harness),
      sessionSharePercent: sharePercentEvidence(total ?? 0, sessionTotal(turn.sessionId, read.modelCalls, harness), "Turn " + turn.turnId, { sessionId: turn.sessionId, recordId: turn.turnId }),
      modelCallCount: countEvidence(calls.length, "count of ModelCall records in Turn " + turn.turnId),
      startedAt: timeEvidence(turn.startedAt, "source Turn start timestamp"),
      endedAt: timeEvidence(turn.endedAt, "source Turn end timestamp"),
      durationMs: numericEvidence(turn.durationMs, turn.timingProvenance, "source Turn duration"),
      timeToFirstTokenMs: numericEvidence(turn.timeToFirstTokenMs, turn.timingProvenance, "source Turn time-to-first-token"),
      observedSpanMs: turnObservedSpan(turn),
      toolCallCount: countEvidence(tools.length, "count of ToolCall records in Turn " + turn.turnId),
      pairedToolResultCount: countEvidence(tools.filter((tool) => tool.resultBytes !== null).length, "count of paired ToolCall results in Turn " + turn.turnId),
      toolResultChars: tools.some((tool) => tool.resultChars !== null && tool.resultChars !== undefined)
        ? numericEvidence(tools.reduce((sum, tool) => sum + (tool.resultChars ?? 0), 0), "derived", "sum of paired ToolCall Unicode result characters in Turn " + turn.turnId)
        : unavailable("Turn " + turn.turnId + " has no paired ToolCall result character count"),
      toolResultBytes: tools.some((tool) => tool.resultBytes !== null)
        ? numericEvidence(tools.reduce((sum, tool) => sum + (tool.resultBytes ?? 0), 0), "derived", "sum of paired ToolCall result bytes in Turn " + turn.turnId)
        : unavailable("Turn " + turn.turnId + " has no paired ToolCall result byte count"),
      errorCount: numericEvidence(
        calls.filter((call) => call.status === "error" || call.status === "interrupted").length + tools.filter((tool) => tool.isError === true).length,
        "derived",
        "count of reported ModelCall and ToolCall errors or interruptions in Turn " + turn.turnId,
      ),
      lifecycleMarkers: [...new Set(lifecycle.map((event) => event.kind))].sort(),
      evidenceId: turnEvidenceId(turn.sessionId, turn.turnId),
      method: harness === "codex"
        ? "Codex Turn boundaries and per-response Usage grouped by source turn_id"
        : "Claude user/assistant message boundaries grouped with capability-dependent observed timing",
      coverage: unavailable("Turn coverage is calculated after all trajectory fields are assembled"),
    };
    entry.coverage = turnCoverage(entry);
    return entry;
  }).sort((left, right) => left.sessionId.localeCompare(right.sessionId) || ((left.ordinal.value as number | null) ?? Number.MAX_SAFE_INTEGER) - ((right.ordinal.value as number | null) ?? Number.MAX_SAFE_INTEGER));

  const candidates: TurnDiagnosticCandidate[] = [];
  const addCandidate = (kind: TurnDiagnosticKind, sessionId: string, entries: TurnAnalysisEntry[], evidence: EvidenceValue[], method: string) => {
    if (entries.length === 0 || evidence.every((item) => item.value === null)) return;
    candidates.push({
      id: kind + ":" + createHash("sha256").update(sessionId + "\0" + entries.map((entry) => entry.turnId).join("\0")).digest("hex").slice(0, 16),
      kind,
      sessionId,
      evidenceIds: entries.map((entry) => entry.evidenceId),
      evidence,
      method,
      coverage: { value: Math.round((evidence.filter((item) => item.value !== null).length / Math.max(1, evidence.length)) * 10000) / 100, provenance: "derived", method: "candidate Evidence values available divided by candidate Evidence values" },
    });
  };
  const sessionIds = [...new Set(turns.map((turn) => turn.sessionId))];
  for (const sessionId of sessionIds) {
    const sessionTurns = turns.filter((turn) => turn.sessionId === sessionId && typeof turn.tokens.totalTokens.value === "number");
    const sorted = [...sessionTurns].sort((left, right) => (right.tokens.totalTokens.value as number) - (left.tokens.totalTokens.value as number));
    const sessionTotalValue = sessionTotal(sessionId, read.modelCalls, harness);
    if (sorted.length > 0 && sessionTotalValue !== null && sessionTotalValue > 0) {
      const top = sorted[0];
      const topThree = sorted.slice(0, 3);
      addCandidate("turn_concentration", sessionId, topThree, [
        top.tokens.totalTokens,
        sharePercentEvidence(top.tokens.totalTokens.value as number, sessionTotalValue, "largest Turn", { sessionId, recordId: top.turnId }),
        sharePercentEvidence(topThree.reduce((sum, entry) => sum + (entry.tokens.totalTokens.value as number), 0), sessionTotalValue, "largest three Turns", { sessionId }),
      ], "rank complete Turn Token totals and divide the largest Turn and largest three Turns by the complete Session total");
    }
    const ordered = [...sessionTurns].sort((left, right) => ((left.ordinal.value as number | null) ?? 0) - ((right.ordinal.value as number | null) ?? 0));
    if (ordered.length >= 4) {
      const midpoint = Math.ceil(ordered.length / 2);
      const first = ordered.slice(0, midpoint).map((entry) => entry.tokens.inputTokens.value).filter((value): value is number => typeof value === "number");
      const second = ordered.slice(midpoint).map((entry) => entry.tokens.inputTokens.value).filter((value): value is number => typeof value === "number");
      const firstMedian = median(first);
      const secondMedian = median(second);
      const ratio = firstMedian !== null && firstMedian > 0 && secondMedian !== null ? secondMedian / firstMedian : null;
      addCandidate("input_growth", sessionId, ordered, [
        numericEvidence(firstMedian, "derived", "median input Tokens in the first half of Turns"),
        numericEvidence(secondMedian, "derived", "median input Tokens in the second half of Turns"),
        numericEvidence(ratio, "derived", "second-half median input divided by first-half median input"),
      ], "split ordered Turns into two halves and compare the medians of source-proven input Token composition");
    }
    const toolTurns = sessionTurns.filter((entry) => typeof entry.toolResultChars.value === "number" && entry.toolResultChars.value > 0);
    if (toolTurns.length > 0) {
      addCandidate("tool_result_adjacency", sessionId, toolTurns, [
        toolTurns[0].toolResultChars,
        toolTurns[0].tokens.totalTokens,
      ], "report paired ToolCall result size and the adjacent Turn Token total without asserting causality");
    }
    const compactionTurns = sessionTurns.filter((entry) => entry.lifecycleMarkers.includes("compaction"));
    addCandidate("compaction_change", sessionId, compactionTurns, compactionTurns.flatMap((entry) => [entry.tokens.inputTokens, entry.tokens.cachedInputTokens]), "compare the Token composition at Turns explicitly marked by a source compaction boundary");
    const waitingTurns = sessionTurns.filter((entry) => entry.durationMs.value !== null || entry.timeToFirstTokenMs.value !== null).sort((left, right) => (Number(right.durationMs.value ?? 0) - Number(left.durationMs.value ?? 0)));
    if (waitingTurns.length > 0) addCandidate("waiting_hotspot", sessionId, waitingTurns.slice(0, 1), [waitingTurns[0].durationMs, waitingTurns[0].timeToFirstTokenMs], "select the slowest source-reported Turn duration and TTFT available in the Session");
    const failedTurns = sessionTurns.filter((entry) => (typeof entry.errorCount.value === "number" && entry.errorCount.value > 0) || entry.lifecycleMarkers.some((marker) => marker === "retry" || marker === "interrupted"));
    addCandidate("failed_path", sessionId, failedTurns, failedTurns.flatMap((entry) => [entry.errorCount, entry.tokens.totalTokens]), "associate only explicitly reported errors, interruptions, retries, or their ModelCall Tokens with a failed path");
  }
  return { turns, candidates };
}

function buildReportData(read: ReadResult, totalTokens: number | null, harness: Harness, pricing: ApiPricingContext): ReportData {
  const tools = buildToolAnalysis(read);
  const apiEquivalent = apiEquivalentCost(read.modelCalls, harness, pricing);
  const cost = apiCost(read.modelCalls, harness, pricing);
  return {
    dailyUsage: buildDailyUsage(read.modelCalls, totalTokens, harness, pricing),
    hourlyActivity: buildHourlyActivity(read.modelCalls, totalTokens, harness),
    hourlySupported: read.modelCalls.some((call) => timestampMs(call.timestamp) !== null),
    rollingWindow: buildRollingWindow(read.modelCalls, harness),
    tools: tools.entries,
    totalToolAmplifiedTokens: tools.total,
    apiEquivalentCost: apiEquivalent,
    cacheEconomics: cacheEconomics(read.modelCalls, harness, cost),
    firstRequestBurden: firstRequestBurden(read, harness),
    skills: skillAnalysis(read, harness, pricing),
  };
}

function projectKey(cwd: string | null, scope: ReadScope): string {
  if (!cwd) return "<unknown-project>";
  if (!scope.allProjects) return "<current-project>";
  return `project-${createHash("sha256").update(cwd).digest("hex").slice(0, 12)}`;
}

function topSession(sessions: SessionRecord[], calls: ModelCallRecord[], harness: Harness): { session: SessionRecord; tokens: number } | null {
  const candidates = sessions
    .map((session) => ({ session, tokens: sessionTotal(session.sessionId, calls, harness), calls: calls.filter((call) => call.sessionId === session.sessionId).length }))
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

function codexSessionComposition(read: ReadResult, harness: Harness): {
  topLevel: EvidenceValue;
  subagent: EvidenceValue;
  partialTopLevel: EvidenceValue;
  partialSubagent: EvidenceValue;
  partialRate: EvidenceValue;
} {
  if (harness !== "codex") {
    const value = unavailable("this Harness does not expose Codex subagent source metadata");
    const partial = unavailable("this Harness does not expose source-proven partial Session metadata");
    return { topLevel: value, subagent: value, partialTopLevel: partial, partialSubagent: partial, partialRate: partial };
  }
  if (read.sessions.some((session) => session.isSubagent === null || session.isSubagent === undefined)) {
    const value = unavailable("one or more selected Codex Sessions lack source metadata needed to classify subagents");
    const partial = unavailable("one or more selected Codex Sessions lack source metadata needed to attribute partial coverage");
    return { topLevel: value, subagent: value, partialTopLevel: partial, partialSubagent: partial, partialRate: partial };
  }
  const subagent = read.sessions.filter((session) => session.isSubagent === true).length;
  const partialUnavailable = unavailable("partial Session attribution is unavailable without source-proven partial metadata for every selected Codex Session");
  if (read.sessions.length === 0 || read.sessions.some((session) => typeof session.partial !== "boolean")) {
    return {
      topLevel: evidenceForCount(read.sessions.length - subagent, "count of selected Codex Sessions whose source metadata is not subagent"),
      subagent: evidenceForCount(subagent, "count of selected Codex Sessions whose source metadata is subagent"),
      partialTopLevel: partialUnavailable,
      partialSubagent: partialUnavailable,
      partialRate: partialUnavailable,
    };
  }
  const partialSessions = read.sessions.filter((session) => session.partial === true);
  if (partialSessions.length !== read.coverage.partialSessions) {
    return {
      topLevel: evidenceForCount(read.sessions.length - subagent, "count of selected Codex Sessions whose source metadata is not subagent"),
      subagent: evidenceForCount(subagent, "count of selected Codex Sessions whose source metadata is subagent"),
      partialTopLevel: partialUnavailable,
      partialSubagent: partialUnavailable,
      partialRate: partialUnavailable,
    };
  }
  const partialTopLevel = partialSessions.filter((session) => session.isSubagent === false).length;
  const partialSubagent = partialSessions.filter((session) => session.isSubagent === true).length;
  return {
    topLevel: evidenceForCount(read.sessions.length - subagent, "count of selected Codex Sessions whose source metadata is not subagent"),
    subagent: evidenceForCount(subagent, "count of selected Codex Sessions whose source metadata is subagent"),
    partialTopLevel: evidenceForCount(partialTopLevel, "count of source-proven partial top-level Codex Sessions"),
    partialSubagent: evidenceForCount(partialSubagent, "count of source-proven partial Codex subagent Sessions"),
    partialRate: {
      value: Math.round((partialSessions.length / read.sessions.length) * 10000) / 100,
      provenance: "derived",
      method: "source-proven partial selected Session count divided by selected Session count, expressed as percentage points and rounded to two decimals",
    },
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
export function analyseAudit(scope: ReadScope, read: ReadResult, harness: Harness, pricing: ApiPricingContext = UNAVAILABLE_PRICING): AuditResult {
  const tokenTotal = sumTokens(read.modelCalls, harness);
  const reportedCost = reportedCostForRead(read);
  const largest = topSession(read.sessions, read.modelCalls, harness);
  const largestCalls = largest ? read.modelCalls.filter((call) => call.sessionId === largest.session.sessionId) : [];
  const amplification = toolAmplification(read);
  const extraLifecycle = read.lifecycle.filter((event) => event.kind !== "compaction");
  const sessionComposition = codexSessionComposition(read, harness);
  const trajectory = buildTurnAnalysis(read, tokenTotal.value, harness);
  const sessionProjects = new Map(read.sessions.map((session) => [session.sessionId, session.projectCwd]));
  const sessionById = new Map(read.sessions.map((session) => [session.sessionId, session]));
  const rankings: ContributionRankings = {
    sessions: rankContributions(
      read.modelCalls,
      (call) => call.sessionId,
      "Session",
      tokenTotal.value,
      harness,
      (key) => {
        const session = sessionById.get(key);
        return session ? sessionDisplayName(session) : undefined;
      },
    ),
    projects: rankContributions(read.modelCalls, (call) => projectKey(sessionProjects.get(call.sessionId) ?? null, scope), "project", tokenTotal.value, harness),
    models: rankContributions(read.modelCalls, (call) => call.model ?? "<unknown-model>", "model", tokenTotal.value, harness),
    timeBuckets: rankContributions(read.modelCalls, (call) => timeBucket(call.timestamp), "time bucket", tokenTotal.value, harness),
  };
  const keySessionTokenAccounting = harness === "codex" && read.tokenAccounting
    ? rankings.sessions.length > 0 && rankings.sessions.slice(0, 3).every((entry) => read.tokenAccounting!.reconciledSessionIds.includes(entry.key))
      ? { value: "reconciled", provenance: "derived" as const, method: "every Token-ranked Top 3 Session has exact per-response to per-Turn reconciliation" }
      : { value: "mismatch", provenance: "derived" as const, method: "at least one Token-ranked Top 3 Session lacks exact per-response to per-Turn reconciliation" }
    : unavailable("Key Session Token accounting is only available for Codex Reader results");
  const shareFraction = largest && tokenTotal.value !== null && tokenTotal.value > 0
    ? largest.tokens / tokenTotal.value
    : null;
  const summary: Record<string, EvidenceValue> = {
    sessionCount: countEvidence(read.sessions.length, "count of selected Session records"),
    topLevelSessionCount: sessionComposition.topLevel,
    subagentSessionCount: sessionComposition.subagent,
    partialTopLevelSessionCount: sessionComposition.partialTopLevel,
    partialSubagentSessionCount: sessionComposition.partialSubagent,
    partialSessionRatePercent: sessionComposition.partialRate,
    modelCallCount: countEvidence(read.modelCalls.length, "count of selected ModelCall records"),
    activeBranchModelCallCount: countEvidence(
      read.modelCalls.filter((call) => call.activeBranch !== false).length,
      "count of selected ModelCall records in the active context; calls without a branch marker are treated as active",
    ),
    activeBranchTokens: (() => {
      const active = sumTokens(read.modelCalls.filter((call) => call.activeBranch !== false), harness);
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
    tokenAccountingStatus: read.tokenAccounting
      ? { value: read.tokenAccounting.status, provenance: "derived", method: read.tokenAccounting.method }
      : unavailable("the selected Reader did not provide a Token accounting invariant"),
    keySessionTokenAccountingStatus: keySessionTokenAccounting,
    responseUsageTotal: read.tokenAccounting && read.tokenAccounting.responseTotal !== null
      ? { value: read.tokenAccounting.responseTotal, provenance: "reported", method: "deduplicated single-response Usage total used for accounting" }
      : unavailable("a complete deduplicated response Usage total was unavailable"),
    cumulativeTurnTotal: read.tokenAccounting && read.tokenAccounting.turnTotal !== null
      ? { value: read.tokenAccounting.turnTotal, provenance: "reported", method: "latest cumulative per-Turn total used only for invariant validation" }
      : unavailable("a cumulative per-Turn total was unavailable for invariant validation"),
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
    turns: trajectory.turns,
    turnCandidates: trajectory.candidates,
    report: buildReportData(read, tokenTotal.value, harness, pricing),
    checks,
  };
}

export function analyseCodex(scope: ReadScope, read: ReadResult): AuditResult {
  return analyseAudit(scope, read, "codex");
}
