"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyseAudit = analyseAudit;
exports.analyseCodex = analyseCodex;
const node_crypto_1 = require("node:crypto");
const rates_1 = require("./rates");
function unavailable(method) {
    return { value: null, provenance: "unavailable", method };
}
function countEvidence(value, method) {
    return { value, provenance: "derived", method };
}
function sharePercentEvidence(tokens, totalTokens, label, source) {
    if (totalTokens === null || totalTokens <= 0) {
        return unavailable(`the complete selected token total was unavailable for ${label} share calculation`);
    }
    return {
        value: Math.round((tokens / totalTokens) * 10000) / 100,
        provenance: "derived",
        method: `${label} tokens divided by complete selected tokens, expressed as percentage points and rounded to two decimals`,
        ...(source ? { source } : {}),
    };
}
function callTokens(call) {
    return call.totalTokens;
}
function sessionTotal(sessionId, calls) {
    const ownCalls = calls.filter((call) => call.sessionId === sessionId);
    if (ownCalls.length === 0 || ownCalls.some((call) => callTokens(call) === null))
        return null;
    return ownCalls.reduce((total, call) => total + callTokens(call), 0);
}
function sumTokens(calls) {
    if (calls.length === 0 || calls.some((call) => callTokens(call) === null)) {
        return { value: null, provenance: "unavailable" };
    }
    const value = calls.reduce((total, call) => total + callTokens(call), 0);
    const allReported = calls.every((call) => call.tokenProvenance === "reported");
    return { value, provenance: allReported ? "reported" : "derived" };
}
function sumReportedCost(calls) {
    if (calls.length === 0 || calls.some((call) => call.reportedCost === null))
        return null;
    return calls.reduce((total, call) => total + call.reportedCost, 0);
}
function rankContributions(calls, keyOf, label, totalTokens, displayNameOf) {
    const groups = new Map();
    for (const call of calls) {
        const key = keyOf(call);
        const existing = groups.get(key) ?? { tokens: 0, complete: true, reported: true, count: 0 };
        existing.count += 1;
        if (call.totalTokens === null) {
            existing.complete = false;
        }
        else {
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
function sessionDisplayName(session) {
    return session.title ? `${session.title} (${session.sessionId})` : session.sessionId;
}
function timeBucket(timestamp) {
    if (!timestamp)
        return "<unknown-time>";
    const parsed = new Date(timestamp);
    return Number.isNaN(parsed.getTime()) ? "<unknown-time>" : parsed.toISOString().slice(0, 10);
}
function totalTokenEvidence(calls, label) {
    const total = sumTokens(calls);
    if (total.value === null)
        return unavailable(label + " was not reported for every selected ModelCall");
    return { value: total.value, provenance: total.provenance, method: "sum of non-cumulative ModelCall token totals for " + label };
}
function composition(call, harness) {
    const { totalTokens: total, inputTokens: input, cachedInputTokens: cached, cacheWriteTokens: cacheWrite, outputTokens: output } = call;
    if ([total, input, cached, cacheWrite, output].some((value) => value === null))
        return null;
    if (harness === "deepseek") {
        const unclassified = total - input - cached - cacheWrite - output;
        return unclassified >= 0 ? { input: input, cached: cached, cacheWrite: cacheWrite, output: output, unclassified } : null;
    }
    if (call.reasoningTokens === null || input + cached + cacheWrite + output + call.reasoningTokens !== total)
        return null;
    return { input: input, cached: cached, cacheWrite: cacheWrite, output: output, unclassified: call.reasoningTokens };
}
function tokenBreakdown(calls, label, harness) {
    const parts = calls.map((call) => composition(call, harness));
    const totalTokens = totalTokenEvidence(calls, label);
    if (calls.length === 0 || parts.some((part) => part === null)) {
        const missing = unavailable(label + " lacks a source-proven mutually exclusive Token composition");
        return { inputTokens: missing, cachedInputTokens: missing, cacheWriteTokens: missing, outputTokens: missing, unclassifiedTokens: missing, reasoningTokens: unavailable(label + " reasoning tokens were retained only as raw evidence"), totalTokens };
    }
    const sum = (field, method) => ({ value: parts.reduce((total, part) => total + part[field], 0), provenance: "derived", method });
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
function apiCost(calls, harness) {
    let total = 0;
    let pricedTokens = 0;
    let relevantTokens = 0;
    const unpricedModels = new Set();
    const limitations = new Set();
    for (const call of calls) {
        if (typeof call.totalTokens !== "number") {
            limitations.add("missing Token total");
            continue;
        }
        relevantTokens += call.totalTokens;
        const rate = rates_1.API_RATES.find((candidate) => candidate.model === call.model);
        const part = composition(call, harness);
        if (!rate) {
            unpricedModels.add(call.model ?? "<unknown-model>");
            continue;
        }
        if (!part || part.cacheWrite !== 0 || part.unclassified !== 0 || rate.cachedInputPerMillion === null) {
            limitations.add("missing compatible price dimension");
            continue;
        }
        total += (part.input * rate.inputPerMillion + part.cached * rate.cachedInputPerMillion + part.output * rate.outputPerMillion) / 1_000_000;
        pricedTokens += call.totalTokens;
    }
    return {
        cost: pricedTokens === 0 ? unavailable("no selected ModelCall exactly matched a local public API rate with compatible Token dimensions") : { value: total, provenance: "estimated", method: "exact model match against local API rate table " + rates_1.API_RATE_SOURCE.version },
        pricedTokens, relevantTokens, unpricedModels: [...unpricedModels].sort(), limitations: [...limitations].sort(),
    };
}
function hourBucket(timestamp) {
    if (!timestamp)
        return null;
    const parsed = new Date(timestamp);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 13) + ":00Z";
}
function buildDailyUsage(calls, totalTokens, harness) {
    const groups = new Map();
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
function buildHourlyActivity(calls, totalTokens) {
    const groups = new Map();
    for (const call of calls) {
        const key = hourBucket(call.timestamp);
        if (key)
            groups.set(key, [...(groups.get(key) ?? []), call]);
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
function safeToolName(name) {
    const value = name.trim();
    return value && value.length <= 80 && /^[A-Za-z0-9_.:-]+$/.test(value) ? value : "other-tool";
}
function buildToolAnalysis(read) {
    const groups = new Map();
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
        if (tool.isError === null)
            group.errorStatusComplete = false;
        if (tool.isError === true)
            group.errors += 1;
        if (tool.resultChars !== null && tool.resultChars !== undefined) {
            group.pairedResults += 1;
            group.hasResult = true;
            group.injectedTokens += tool.resultChars / 4;
            group.amplifiedTokens += (tool.resultChars / 4) * laterCalls(tool, read.modelCalls.filter((call) => call.activeBranch !== false), read.lifecycle);
        }
        groups.set(key, group);
    }
    const hasResult = [...groups.values()].some((group) => group.hasResult);
    const totalAmplified = [...groups.values()].reduce((total, group) => total + group.amplifiedTokens, 0);
    const total = hasResult
        ? {
            value: totalAmplified,
            provenance: "estimated",
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
                provenance: "estimated",
                method: "paired tool-result Unicode text characters divided by 4; content is not returned",
            }
            : unavailable("no paired result size was available for " + key),
        amplifiedTokens: group.hasResult
            ? {
                value: group.amplifiedTokens,
                provenance: "estimated",
                method: "paired result text characters / 4 multiplied by later ModelCall records before the next observable active-context boundary",
            }
            : unavailable("no paired result size was available for " + key),
        sharePercent: group.hasResult
            ? sharePercentEvidence(group.amplifiedTokens, totalAmplified > 0 ? totalAmplified : null, "tool " + key)
            : unavailable("no paired result size was available for " + key + " share calculation"),
    }));
    return { entries, total };
}
function timestampMs(timestamp) {
    if (!timestamp)
        return null;
    const value = Date.parse(timestamp);
    return Number.isNaN(value) ? null : value;
}
function observedTokenEvidence(calls, label) {
    if (calls.length === 0) {
        return { value: 0, provenance: "derived", method: "no timestamped ModelCall records were observed in the " + label };
    }
    return totalTokenEvidence(calls, label);
}
function historicalPeakTokens(calls, windowMilliseconds) {
    const timed = calls
        .map((call) => ({ call, time: timestampMs(call.timestamp) }))
        .filter((entry) => entry.time !== null)
        .sort((left, right) => left.time - right.time);
    if (timed.length === 0)
        return unavailable("no usable ModelCall timestamps were available for a historical rolling-window peak");
    let peak = null;
    // ponytail: O(n²) local window scan keeps the boundary logic explicit; add an indexed scan only if history size makes this measurable.
    for (let start = 0; start < timed.length; start += 1) {
        const end = timed[start].time + windowMilliseconds;
        const window = timed.filter((entry) => entry.time >= timed[start].time && entry.time <= end).map((entry) => entry.call);
        if (window.some((call) => call.totalTokens === null))
            continue;
        const total = window.reduce((sum, call) => sum + call.totalTokens, 0);
        if (peak === null || total > peak)
            peak = total;
    }
    return peak === null
        ? unavailable("a complete token total was unavailable for every timestamped rolling-window candidate")
        : {
            value: peak,
            provenance: "derived",
            method: "maximum sum of complete ModelCall token totals in any five-hour timestamp window",
        };
}
function buildRollingWindow(calls) {
    const end = Date.now();
    const start = end - 5 * 60 * 60 * 1000;
    const timed = calls.filter((call) => timestampMs(call.timestamp) !== null);
    if (timed.length === 0)
        return null;
    const observed = timed.filter((call) => timestampMs(call.timestamp) >= start && timestampMs(call.timestamp) <= end);
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
function buildReportData(read, totalTokens, harness) {
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
            return { total: cost.cost, pricedTokens: countEvidence(cost.pricedTokens, "Token total with exact compatible local API rate"), relevantTokens: countEvidence(cost.relevantTokens, "selected Token total considered for API-equivalent pricing"), coveragePercent: coverage === null ? unavailable("no Token total was available for price coverage") : { value: coverage, provenance: "derived", method: "priced Token total divided by relevant Token total" }, unpricedModels: cost.unpricedModels, limitations: cost.limitations, source: { version: rates_1.API_RATE_SOURCE.version, retrievedAt: rates_1.API_RATE_SOURCE.retrievedAt, currency: rates_1.API_RATE_SOURCE.currency, unit: rates_1.API_RATE_SOURCE.unit } };
        })(),
    };
}
function projectKey(cwd, scope) {
    if (!cwd)
        return "<unknown-project>";
    if (!scope.allProjects)
        return "<current-project>";
    return `project-${(0, node_crypto_1.createHash)("sha256").update(cwd).digest("hex").slice(0, 12)}`;
}
function topSession(sessions, calls) {
    const candidates = sessions
        .map((session) => ({ session, tokens: sessionTotal(session.sessionId, calls), calls: calls.filter((call) => call.sessionId === session.sessionId).length }))
        .filter((candidate) => candidate.tokens !== null && candidate.calls > 0)
        .sort((left, right) => right.tokens - left.tokens || left.session.sessionId.localeCompare(right.session.sessionId));
    return candidates[0] ? { session: candidates[0].session, tokens: candidates[0].tokens } : null;
}
function laterCalls(tool, calls, lifecycle) {
    if (!tool.timestamp)
        return 0;
    const toolTime = Date.parse(tool.timestamp);
    if (Number.isNaN(toolTime))
        return 0;
    const nextCompaction = lifecycle
        .filter((event) => event.sessionId === tool.sessionId && event.kind === "compaction" && event.timestamp)
        .map((event) => Date.parse(event.timestamp))
        .filter((time) => !Number.isNaN(time) && time > toolTime)
        .sort((left, right) => left - right)[0];
    return calls.filter((call) => {
        if (call.sessionId !== tool.sessionId || !call.timestamp)
            return false;
        const callTime = Date.parse(call.timestamp);
        return !Number.isNaN(callTime) && callTime > toolTime && (nextCompaction === undefined || callTime < nextCompaction);
    }).length;
}
function toolAmplification(read) {
    const contextCalls = read.modelCalls.filter((call) => call.activeBranch !== false);
    let total = 0;
    let hasResult = false;
    let largest = null;
    for (const tool of read.toolCalls) {
        if (tool.resultChars === null || tool.resultChars === undefined)
            continue;
        hasResult = true;
        const estimatedResultTokens = tool.resultChars / 4;
        const following = laterCalls(tool, contextCalls, read.lifecycle);
        const tokens = estimatedResultTokens * following;
        total += tokens;
        if (!largest || tokens > largest.tokens)
            largest = { tool, tokens, laterCalls: following };
    }
    return {
        tokens: hasResult ? total : null,
        largestTokens: largest?.tokens ?? null,
        tool: largest?.tool ?? null,
        laterCalls: largest?.laterCalls ?? 0,
    };
}
function evidenceForCount(value, method) {
    return { value, provenance: "derived", method };
}
function analyseAudit(scope, read, harness) {
    const tokenTotal = sumTokens(read.modelCalls);
    const reportedCost = sumReportedCost(read.modelCalls);
    const largest = topSession(read.sessions, read.modelCalls);
    const largestCalls = largest ? read.modelCalls.filter((call) => call.sessionId === largest.session.sessionId) : [];
    const amplification = toolAmplification(read);
    const extraLifecycle = read.lifecycle.filter((event) => event.kind !== "compaction");
    const sessionProjects = new Map(read.sessions.map((session) => [session.sessionId, session.projectCwd]));
    const sessionById = new Map(read.sessions.map((session) => [session.sessionId, session]));
    const rankings = {
        sessions: rankContributions(read.modelCalls, (call) => call.sessionId, "Session", tokenTotal.value, (key) => {
            const session = sessionById.get(key);
            return session ? sessionDisplayName(session) : undefined;
        }),
        projects: rankContributions(read.modelCalls, (call) => projectKey(sessionProjects.get(call.sessionId) ?? null, scope), "project", tokenTotal.value),
        models: rankContributions(read.modelCalls, (call) => call.model ?? "<unknown-model>", "model", tokenTotal.value),
        timeBuckets: rankContributions(read.modelCalls, (call) => timeBucket(call.timestamp), "time bucket", tokenTotal.value),
    };
    const shareFraction = largest && tokenTotal.value !== null && tokenTotal.value > 0
        ? largest.tokens / tokenTotal.value
        : null;
    const summary = {
        sessionCount: countEvidence(read.sessions.length, "count of selected Session records"),
        modelCallCount: countEvidence(read.modelCalls.length, "count of selected ModelCall records"),
        activeBranchModelCallCount: countEvidence(read.modelCalls.filter((call) => call.activeBranch !== false).length, "count of selected ModelCall records in the active context; non-Pi calls are treated as active"),
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
        pairedToolResultCount: evidenceForCount(read.toolCalls.filter((tool) => tool.resultBytes !== null).length, "count of ToolCall records with a paired result size"),
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
    let topFinding = null;
    if (largest &&
        largestCalls.length >= 2 &&
        shareFraction !== null &&
        shareFraction >= 0.5) {
        topFinding = {
            id: "long-session",
            severity: "primary",
            kind: "long_session",
            headline: `Session ${sessionDisplayName(largest.session)} accounts for ${(shareFraction * 100).toFixed(1)}% of known usage across ${largestCalls.length} model calls.`,
            explanation: "A concentrated multi-call Session is the strongest supported contributor in this scope. Continuing the same context can make later requests carry more history.",
            impact: {
                value: largest.tokens,
                provenance: "derived",
                method: "sum of non-cumulative ModelCall token totals for the largest Session",
                source: { sessionId: largest.session.sessionId },
            },
            evidence: [
                {
                    value: largest.tokens,
                    provenance: "derived",
                    method: "sum of non-cumulative ModelCall token totals",
                    source: { sessionId: largest.session.sessionId },
                },
                {
                    value: largestCalls.length,
                    provenance: "derived",
                    method: "count of ModelCall records in the Session",
                    source: { sessionId: largest.session.sessionId },
                },
                {
                    ...sharePercentEvidence(largest.tokens, tokenTotal.value, "largest complete Session", { sessionId: largest.session.sessionId }),
                },
            ],
            recommendation: "Start a fresh Session or split and narrow the task before the context grows further.",
        };
    }
    if (amplification.largestTokens !== null && amplification.largestTokens > 0 && amplification.tool) {
        const toolFinding = {
            id: "tool-amplification",
            severity: "primary",
            kind: "tool_amplification",
            headline: `Tool ${safeToolName(amplification.tool.toolName)} produced an estimated ${Math.round(amplification.largestTokens)} amplified tokens across later calls.`,
            explanation: "A paired tool result was large enough to be carried into later model calls in the same active context. The impact is an estimate based on result size, not billed tokens.",
            impact: {
                value: amplification.largestTokens,
                provenance: "estimated",
                method: "UTF-8 text characters divided by 4, multiplied by later ModelCall records in the same active context",
                source: { sessionId: amplification.tool.sessionId, recordId: amplification.tool.callId, timestamp: amplification.tool.timestamp ?? undefined },
            },
            evidence: [
                {
                    value: amplification.tool.resultChars ?? null,
                    provenance: "derived",
                    method: "Unicode text-character length of the paired tool result; content is not returned",
                    source: { sessionId: amplification.tool.sessionId, recordId: amplification.tool.callId, timestamp: amplification.tool.timestamp ?? undefined },
                },
                {
                    value: amplification.laterCalls,
                    provenance: "derived",
                    method: "later ModelCall records in the same active Session",
                    source: { sessionId: amplification.tool.sessionId, recordId: amplification.tool.callId },
                },
                {
                    value: amplification.largestTokens,
                    provenance: "estimated",
                    method: "result text characters / 4 × later ModelCall records",
                    source: { sessionId: amplification.tool.sessionId, recordId: amplification.tool.callId },
                },
            ],
            recommendation: "Summarize or narrow large tool results before carrying them into more model calls.",
        };
        if (!topFinding || toolFinding.impact.value > topFinding.impact.value)
            topFinding = toolFinding;
    }
    if (extraLifecycle.length > 0) {
        const extraFinding = {
            id: "extra-calls",
            severity: "primary",
            kind: "extra_calls",
            headline: `${extraLifecycle.length} retry, interruption, or subagent lifecycle event(s) were observed.`,
            explanation: "Lifecycle events indicate additional work around model calls. The history does not always expose exact attempt cost, so this signal is kept separate from token totals.",
            impact: {
                value: extraLifecycle.length,
                provenance: "derived",
                method: "count of observed retry, interruption, and subagent lifecycle records",
                source: extraLifecycle[0] ? { sessionId: extraLifecycle[0].sessionId, timestamp: extraLifecycle[0].timestamp ?? undefined } : undefined,
            },
            evidence: [evidenceForCount(extraLifecycle.length, "count of observed retry, interruption, and subagent lifecycle records")],
            recommendation: "Inspect the error or retry cause before repeating the same large task.",
        };
        // Token- and character-impact findings are comparable within their own
        // units; keep the stable priority order rather than comparing unlike units.
        if (!topFinding)
            topFinding = extraFinding;
    }
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
        topFinding,
        findings: topFinding ? [topFinding] : [],
        healthChecks: [],
    };
}
function analyseCodex(scope, read) {
    return analyseAudit(scope, read, "codex");
}
