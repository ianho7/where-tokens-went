import { createHash } from "node:crypto";
import type {
  AuditResult,
  ContributionEntry,
  ContributionRankings,
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
): ContributionEntry[] {
  const groups = new Map<string, { tokens: number; complete: boolean; reported: boolean }>();
  for (const call of calls) {
    const key = keyOf(call);
    const existing = groups.get(key) ?? { tokens: 0, complete: true, reported: true };
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
      value: {
        value: group.tokens,
        provenance: group.reported ? "reported" : "derived",
        method: `${label} group sum of complete ModelCall token totals`,
      },
    }));
}

function timeBucket(timestamp: string | null): string {
  if (!timestamp) return "<unknown-time>";
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? "<unknown-time>" : parsed.toISOString().slice(0, 10);
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

export function analyseAudit(scope: ReadScope, read: ReadResult, harness: Harness): AuditResult {
  const tokenTotal = sumTokens(read.modelCalls);
  const reportedCost = sumReportedCost(read.modelCalls);
  const largest = topSession(read.sessions, read.modelCalls);
  const largestCalls = largest ? read.modelCalls.filter((call) => call.sessionId === largest.session.sessionId) : [];
  const amplification = toolAmplification(read);
  const extraLifecycle = read.lifecycle.filter((event) => event.kind !== "compaction");
  const sessionProjects = new Map(read.sessions.map((session) => [session.sessionId, session.projectCwd]));
  const rankings: ContributionRankings = {
    sessions: rankContributions(read.modelCalls, (call) => call.sessionId, "Session"),
    projects: rankContributions(read.modelCalls, (call) => projectKey(sessionProjects.get(call.sessionId) ?? null, scope), "project"),
    models: rankContributions(read.modelCalls, (call) => call.model ?? "<unknown-model>", "model"),
    timeBuckets: rankContributions(read.modelCalls, (call) => timeBucket(call.timestamp), "time bucket"),
  };
  const share = largest && tokenTotal.value !== null && tokenTotal.value > 0
    ? largest.tokens / tokenTotal.value
    : null;
  const summary: Record<string, EvidenceValue> = {
    sessionCount: countEvidence(read.sessions.length, "count of selected Session records"),
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

  if (amplification.largestTokens !== null && amplification.largestTokens > 0 && amplification.tool) {
    const toolFinding: NonNullable<AuditResult["topFinding"]> = {
      kind: "tool_amplification",
      headline: `Tool ${amplification.tool.toolName} produced an estimated ${Math.round(amplification.largestTokens)} amplified tokens across later calls.`,
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
    if (!topFinding || toolFinding.impact.value! > topFinding.impact.value!) topFinding = toolFinding;
  }

  if (extraLifecycle.length > 0) {
    const extraFinding: NonNullable<AuditResult["topFinding"]> = {
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
    if (!topFinding) topFinding = extraFinding;
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
    topFinding,
  };
}

export function analyseCodex(scope: ReadScope, read: ReadResult): AuditResult {
  return analyseAudit(scope, read, "codex");
}
