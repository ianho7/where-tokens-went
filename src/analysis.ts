import type {
  AuditResult,
  EvidenceValue,
  Harness,
  ModelCallRecord,
  ReadResult,
  ReadScope,
  SessionRecord,
  ToolCallRecord,
} from "./types";

function unavailable(method: string): EvidenceValue {
  return { value: null, provenance: "unavailable", method };
}

function countEvidence(value: number, method: string): EvidenceValue {
  return { value, provenance: "derived", method };
}

function callTokens(call: ModelCallRecord): number | null {
  return call.totalTokens;
}

function sessionTotal(sessionId: string, calls: ModelCallRecord[]): number | null {
  const ownCalls = calls.filter((call) => call.sessionId === sessionId);
  if (ownCalls.length === 0 || ownCalls.some((call) => callTokens(call) === null)) return null;
  return ownCalls.reduce((total, call) => total + (callTokens(call) ?? 0), 0);
}

function sumTokens(calls: ModelCallRecord[]): { value: number | null; provenance: "reported" | "derived" | "unavailable" } {
  if (calls.length === 0 || calls.some((call) => callTokens(call) === null)) {
    return { value: null, provenance: "unavailable" };
  }
  const value = calls.reduce((total, call) => total + (callTokens(call) ?? 0), 0);
  const allReported = calls.every((call) => call.tokenProvenance === "reported");
  return { value, provenance: allReported ? "reported" : "derived" };
}

function sumReportedCost(calls: ModelCallRecord[]): number | null {
  if (calls.length === 0 || calls.some((call) => call.reportedCost === null)) return null;
  return calls.reduce((total, call) => total + (call.reportedCost ?? 0), 0);
}

function topSession(sessions: SessionRecord[], calls: ModelCallRecord[]): { session: SessionRecord; tokens: number } | null {
  const candidates = sessions
    .map((session) => ({ session, tokens: sessionTotal(session.sessionId, calls), calls: calls.filter((call) => call.sessionId === session.sessionId).length }))
    .filter((candidate): candidate is { session: SessionRecord; tokens: number; calls: number } => candidate.tokens !== null && candidate.calls > 0)
    .sort((left, right) => right.tokens - left.tokens || left.session.sessionId.localeCompare(right.session.sessionId));
  return candidates[0] ? { session: candidates[0].session, tokens: candidates[0].tokens } : null;
}

function laterCalls(tool: ToolCallRecord, calls: ModelCallRecord[]): number {
  if (!tool.timestamp) return 0;
  const toolTime = Date.parse(tool.timestamp);
  if (Number.isNaN(toolTime)) return 0;
  return calls.filter((call) => {
    if (call.sessionId !== tool.sessionId || !call.timestamp) return false;
    const callTime = Date.parse(call.timestamp);
    return !Number.isNaN(callTime) && callTime > toolTime;
  }).length;
}

function toolAmplification(read: ReadResult): {
  tokens: number | null;
  tool: ToolCallRecord | null;
  laterCalls: number;
} {
  let total = 0;
  let hasResult = false;
  let largest: { tool: ToolCallRecord; tokens: number; laterCalls: number } | null = null;
  for (const tool of read.toolCalls) {
    if (tool.resultBytes === null) continue;
    hasResult = true;
    const estimatedResultTokens = tool.resultBytes / 4;
    const following = laterCalls(tool, read.modelCalls);
    const tokens = estimatedResultTokens * following;
    total += tokens;
    if (!largest || tokens > largest.tokens) largest = { tool, tokens, laterCalls: following };
  }
  return {
    tokens: hasResult ? total : null,
    tool: largest?.tool ?? null,
    laterCalls: largest?.laterCalls ?? 0,
  };
}

function evidenceForCount(value: number, method: string): EvidenceValue {
  return { value, provenance: "derived", method };
}

export function analyseAudit(scope: ReadScope, read: ReadResult, harness: Harness): AuditResult {
  const tokenTotal = sumTokens(read.modelCalls);
  const reportedCost = sumReportedCost(read.modelCalls);
  const largest = topSession(read.sessions, read.modelCalls);
  const largestCalls = largest ? read.modelCalls.filter((call) => call.sessionId === largest.session.sessionId) : [];
  const amplification = toolAmplification(read);
  const share = largest && tokenTotal.value !== null && tokenTotal.value > 0
    ? largest.tokens / tokenTotal.value
    : null;
  const summary: Record<string, EvidenceValue> = {
    sessionCount: countEvidence(read.sessions.length, "count of selected Session records"),
    modelCallCount: countEvidence(read.modelCalls.length, "count of selected ModelCall records"),
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
        method: "UTF-8 result bytes divided by 4, multiplied by later ModelCall records in the same Session",
        source: amplification.tool ? { sessionId: amplification.tool.sessionId, recordId: amplification.tool.callId, timestamp: amplification.tool.timestamp ?? undefined } : undefined,
      },
    extraLifecycleCount: evidenceForCount(read.lifecycle.length, "count of retry, compaction, subagent, and interrupted lifecycle records"),
  };

  let topFinding: AuditResult["topFinding"] = null;
  if (
    largest &&
    largestCalls.length >= 2 &&
    share !== null &&
    share >= 0.5
  ) {
    topFinding = {
      kind: "long_session",
      headline: `Session ${largest.session.sessionId} accounts for ${(share * 100).toFixed(1)}% of known usage across ${largestCalls.length} model calls.`,
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
          value: share,
          provenance: "derived",
          method: "largest complete Session tokens divided by complete selected tokens",
          source: { sessionId: largest.session.sessionId },
        },
      ],
      recommendation: "Start a fresh Session or split and narrow the task before the context grows further.",
    };
  }

  if (amplification.tokens !== null && amplification.tokens > 0 && amplification.tool) {
    const toolFinding: NonNullable<AuditResult["topFinding"]> = {
      kind: "tool_amplification",
      headline: `Tool ${amplification.tool.toolName} produced an estimated ${Math.round(amplification.tokens)} amplified tokens across later calls.`,
      explanation: "A paired tool result was large enough to be carried into later model calls in the same active context. The impact is an estimate based on result size, not billed tokens.",
      impact: {
        value: amplification.tokens,
        provenance: "estimated",
        method: "UTF-8 result bytes divided by 4, multiplied by later ModelCall records in the same Session",
        source: { sessionId: amplification.tool.sessionId, recordId: amplification.tool.callId, timestamp: amplification.tool.timestamp ?? undefined },
      },
      evidence: [
        {
          value: amplification.tool.resultBytes,
          provenance: "derived",
          method: "UTF-8 byte length of the paired tool result; content is not returned",
          source: { sessionId: amplification.tool.sessionId, recordId: amplification.tool.callId, timestamp: amplification.tool.timestamp ?? undefined },
        },
        {
          value: amplification.laterCalls,
          provenance: "derived",
          method: "later ModelCall records in the same active Session",
          source: { sessionId: amplification.tool.sessionId, recordId: amplification.tool.callId },
        },
        {
          value: amplification.tokens,
          provenance: "estimated",
          method: "result bytes / 4 × later ModelCall records",
          source: { sessionId: amplification.tool.sessionId, recordId: amplification.tool.callId },
        },
      ],
      recommendation: "Summarize or narrow large tool results before carrying them into more model calls.",
    };
    if (!topFinding || toolFinding.impact.value! > topFinding.impact.value!) topFinding = toolFinding;
  }

  if (read.lifecycle.length > 0) {
    const extraFinding: NonNullable<AuditResult["topFinding"]> = {
      kind: "extra_calls",
      headline: `${read.lifecycle.length} retry, interruption, compaction, or subagent lifecycle event(s) were observed.`,
      explanation: "Lifecycle events indicate additional work around model calls. The history does not always expose exact attempt cost, so this signal is kept separate from token totals.",
      impact: {
        value: read.lifecycle.length,
        provenance: "derived",
        method: "count of observed lifecycle records",
        source: read.lifecycle[0] ? { sessionId: read.lifecycle[0].sessionId, timestamp: read.lifecycle[0].timestamp ?? undefined } : undefined,
      },
      evidence: [evidenceForCount(read.lifecycle.length, "count of observed lifecycle records")],
      recommendation: "Inspect the error or retry cause before repeating the same large task.",
    };
    if (!topFinding || extraFinding.impact.value! > topFinding.impact.value!) topFinding = extraFinding;
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
    topFinding,
  };
}

export function analyseCodex(scope: ReadScope, read: ReadResult): AuditResult {
  return analyseAudit(scope, read, "codex");
}
