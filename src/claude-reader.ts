import { readFile, readdir } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  FirstUserMessageRecord,
  LifecycleRecord,
  ModelCallRecord,
  ReadResult,
  ReadScope,
  SessionRecord,
  SessionCostRecord,
  SkillUseRecord,
  ToolCallRecord,
  TurnRecord,
} from "./types";
import { firstUserMessageText } from "./prompt-projection";

type JsonObject = Record<string, unknown>;

interface PendingSession {
  session: SessionRecord;
  eventTimes: number[];
  modelCalls: ModelCallRecord[];
  turns: TurnRecord[];
  activeTurnId: string | null;
  tools: ToolCallRecord[];
  lifecycle: LifecycleRecord[];
  skillEvidence: SkillUseRecord[];
  firstUserMessages: Map<string, string | null>;
  sessionCosts: SessionCostRecord[];
  unsupported: boolean;
  missingTimestamp: boolean;
}

function objectValue(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function stringValue(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function numberValue(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function booleanValue(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (value === "true" || value === "false") return value === "true";
  }
  return null;
}

function timestampValue(...values: unknown[]): string | null {
  const value = stringValue(...values);
  return value && !Number.isNaN(Date.parse(value)) ? value : null;
}

function byteLength(value: unknown): number | null {
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  if (value === null || value === undefined) return null;
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return null;
  }
}

function characterLength(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "string" ? value : (() => {
    try { return JSON.stringify(value); } catch { return null; }
  })();
  return text === null ? null : Array.from(text).length;
}

function contentBlocks(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.map(objectValue).filter((item): item is JsonObject => item !== null);
  const object = objectValue(value);
  return object ? [object] : [];
}

function skillNameValue(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string") {
      const cleaned = value.trim().replace(/^\/+/, "").replace(/\\/g, "/");
      const match = /(?:^|\/)([^/]+?)(?:\/SKILL\.md)?$/i.exec(cleaned);
      const candidate = match?.[1] ?? cleaned;
      if (candidate && candidate.length <= 80 && /^[A-Za-z0-9_.:@-]+$/.test(candidate)) return candidate;
    }
    const object = objectValue(value);
    if (object) {
      const nested = skillNameValue(object.name, object.skill, object.skill_name, object.skillName, object.id);
      if (nested) return nested;
    }
  }
  return null;
}

function redactedSource(file: string): string {
  return "transcript:" + path.basename(file, ".jsonl");
}

function skillRecord(
  sessionId: string,
  skillName: string | null,
  state: SkillUseRecord["state"],
  evidenceType: SkillUseRecord["evidenceType"],
  callId: string | null,
  timestamp: string | null,
  sourceLocation: string,
  provenance: SkillUseRecord["provenance"],
  turnId: string | null = null,
): SkillUseRecord {
  return { sessionId, skillName, state, evidenceType, turnId, callId, timestamp, sourceLocation, provenance };
}

function listedSkillNames(...values: unknown[]): string[] {
  const names: string[] = [];
  for (const value of values) {
    const items = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
    for (const item of items) {
      const name = skillNameValue(item);
      if (name) names.push(name);
    }
  }
  return [...new Set(names)].sort();
}

function explicitSkillName(...values: unknown[]): string | null {
  for (const value of values) {
    const object = objectValue(value);
    const name = object
      ? skillNameValue(object.skill_name, object.skillName, object.skill, object.name)
      : skillNameValue(value);
    if (name) return name;
  }
  return null;
}

function createSession(sessionId: string, filePath?: string): PendingSession {
  return {
    session: {
      harness: "claude",
      sessionId,
      projectCwd: null,
      startedAt: null,
      endedAt: null,
      parentSessionId: null,
      sourceVersion: null,
      filePath: filePath ?? null,
    },
    eventTimes: [],
    modelCalls: [],
    turns: [],
    activeTurnId: null,
    tools: [],
    lifecycle: [],
    skillEvidence: [],
    firstUserMessages: new Map(),
    sessionCosts: [],
    unsupported: false,
    missingTimestamp: false,
  };
}

function ensureTurn(pending: PendingSession, turnId: string, timestamp: string | null): TurnRecord {
  const existing = pending.turns.find((turn) => turn.turnId === turnId);
  if (existing) return existing;
  const turn: TurnRecord = {
    sessionId: pending.session.sessionId,
    turnId,
    ordinal: pending.turns.length + 1,
    startedAt: timestamp,
    endedAt: timestamp,
    durationMs: null,
    timeToFirstTokenMs: null,
    status: "open",
    timingProvenance: timestamp ? "derived" : "unavailable",
  };
  pending.turns.push(turn);
  return turn;
}

function updateTime(pending: PendingSession, timestamp: string | null): void {
  if (!timestamp) return;
  const time = Date.parse(timestamp);
  if (Number.isNaN(time)) return;
  pending.eventTimes.push(time);
  if (!pending.session.startedAt || Date.parse(pending.session.startedAt) > time) pending.session.startedAt = timestamp;
  if (!pending.session.endedAt || Date.parse(pending.session.endedAt) < time) pending.session.endedAt = timestamp;
}

function usageCall(
  sessionId: string,
  callId: string | null,
  timestamp: string | null,
  model: string | null,
  provider: string | null,
  usageValue: unknown,
  status: ModelCallRecord["status"],
): ModelCallRecord | null {
  const usage = objectValue(usageValue);
  if (!usage) return null;
  const inputTokens = numberValue(usage.input_tokens, usage.inputTokens);
  const cachedInputTokens = numberValue(usage.cache_read_input_tokens, usage.cacheReadInputTokens);
  const cacheWriteTokens = numberValue(usage.cache_creation_input_tokens, usage.cacheCreationInputTokens);
  const cacheCreation = objectValue(usage.cache_creation) ?? objectValue(usage.cacheCreation);
  const cacheWrite5mTokens = numberValue(
    cacheCreation?.ephemeral_5m_input_tokens,
    cacheCreation?.ephemeral5mInputTokens,
    usage.cache_creation_5m_input_tokens,
    usage.cacheCreation5mInputTokens,
  );
  const cacheWrite1hTokens = numberValue(
    cacheCreation?.ephemeral_1h_input_tokens,
    cacheCreation?.ephemeral1hInputTokens,
    usage.cache_creation_1h_input_tokens,
    usage.cacheCreation1hInputTokens,
  );
  const outputTokens = numberValue(usage.output_tokens, usage.outputTokens);
  const reasoningTokens = numberValue(usage.reasoning_tokens, usage.reasoningTokens);
  const reportedTotal = numberValue(usage.total_tokens, usage.totalTokens);
  if ([inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens, reasoningTokens, reportedTotal].every((value) => value === null)) return null;
  const totalTokens = reportedTotal ?? (
    inputTokens !== null && cachedInputTokens !== null && cacheWriteTokens !== null
      && outputTokens !== null
      ? inputTokens + cachedInputTokens + cacheWriteTokens + outputTokens
      : null
  );
  const cacheWriteTtl = cacheWriteTokens === null || cacheWriteTokens === 0
    ? null
    : cacheWrite5mTokens !== null && cacheWrite1hTokens !== null && cacheWrite5mTokens + cacheWrite1hTokens === cacheWriteTokens
      ? cacheWrite5mTokens > 0 && cacheWrite1hTokens > 0 ? "mixed" as const : cacheWrite5mTokens > 0 ? "5m" as const : "1h" as const
      : cacheWrite5mTokens !== null && cacheWrite5mTokens === cacheWriteTokens
        ? "5m" as const
        : cacheWrite1hTokens !== null && cacheWrite1hTokens === cacheWriteTokens
          ? "1h" as const
          : null;
  return {
    sessionId,
    callId,
    timestamp,
    provider,
    model,
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    reportedCost: null,
    status,
    tokenProvenance: reportedTotal !== null ? "reported" : totalTokens === null ? "unavailable" : "derived",
    cacheWrite5mTokens,
    cacheWrite1hTokens,
    cacheWriteTtl,
  };
}

function completeScore(call: ModelCallRecord): number {
  return [call.inputTokens, call.cachedInputTokens, call.cacheWriteTokens, call.outputTokens, call.reasoningTokens, call.totalTokens].filter((value) => value !== null).length;
}

async function jsonlFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(fullPath);
    }
  }
  await visit(root);
  return files.sort();
}

function sameCwd(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  const normalise = (value: string) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalise(left) === normalise(right);
}

function selected(pending: PendingSession, scope: ReadScope): boolean {
  if (!scope.allProjects && !sameCwd(pending.session.projectCwd, scope.cwd)) return false;
  const until = scope.until?.getTime();
  return pending.eventTimes.some((time) => time >= scope.since.getTime() && (until === undefined || time < until));
}

function inScope(value: string | null, scope: ReadScope): boolean {
  if (!value) return false;
  const time = Date.parse(value);
  if (Number.isNaN(time) || time < scope.since.getTime()) return false;
  return scope.until === undefined || time < scope.until.getTime();
}

const knownClaudeTypes = new Set([
  "user", "assistant", "system", "summary", "progress", "queue-operation", "file-history-snapshot", "cost-state",
  "last-prompt", "result", "tool_result", "tool-result", "skill", "skill-listing", "skill_listing",
]);

function accountingSensitiveClaudeType(type: string): boolean {
  return /usage|token|response|assistant|message|tool|call|retry|interrupt|compact|subagent|error/i.test(type);
}

export async function readClaude(scope: ReadScope): Promise<ReadResult> {
  const root = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const files = await jsonlFiles(path.join(root, "projects"));
  const selectedSourceFiles = new Set<string>();
  const coverage = { filesRead: 0, recordsRead: 0, recordsSkipped: 0, partialSessions: 0, warnings: [] as string[] };
  const pendingById = new Map<string, PendingSession>();
  let fallbackIndex = 0;

  for (const file of files) {
    coverage.filesRead += 1;
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      coverage.recordsSkipped += 1;
      coverage.warnings.push("A Claude Code transcript could not be read and was skipped.");
      continue;
    }
    const lines = text.split(/\r?\n/);
    const trailingNewline = /\r?\n$/.test(text);
    if (trailingNewline) lines.pop();
    let activeSessionId: string | null = null;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      if (!lines[lineIndex].trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(lines[lineIndex]);
      } catch {
        coverage.recordsSkipped += 1;
        if (lineIndex === lines.length - 1 && !trailingNewline) coverage.partialSessions += 1;
        continue;
      }
      const record = objectValue(parsed);
      if (!record) {
        coverage.recordsSkipped += 1;
        continue;
      }
      coverage.recordsRead += 1;
      const message = objectValue(record.message);
      const timestamp = timestampValue(record.timestamp, record.time, message?.timestamp);
      if (scope.until !== undefined && timestamp !== null && !Number.isNaN(Date.parse(timestamp)) && Date.parse(timestamp) >= scope.until.getTime()) continue;
      const sessionId: string = stringValue(record.session_id, record.sessionId, message?.session_id, message?.sessionId) ?? activeSessionId ?? `unknown-session-${fallbackIndex++}`;
      activeSessionId = sessionId;
      const pending = pendingById.get(sessionId) ?? createSession(sessionId, file);
      if (!pending.session.filePath) pending.session.filePath = file;
      pendingById.set(sessionId, pending);
      updateTime(pending, timestamp);
      const cwd = stringValue(record.cwd, record.project_cwd, record.projectCwd, message?.cwd);
      if (cwd) pending.session.projectCwd = cwd;
      const sourceVersion = stringValue(record.version, record.claude_code_version, record.claudeCodeVersion);
      if (sourceVersion) pending.session.sourceVersion = sourceVersion;
      const parentSessionId = stringValue(record.parent_session_id, record.parentSessionId);
      if (parentSessionId) pending.session.parentSessionId = parentSessionId;
      if (typeof record.isSidechain === "boolean" || typeof record.is_sidechain === "boolean") {
        pending.session.isSubagent = record.isSidechain === true || record.is_sidechain === true;
      } else if (parentSessionId) {
        pending.session.isSubagent = true;
      }

      const type = stringValue(record.type, record.kind)?.toLowerCase() ?? "";
      const role = stringValue(message?.role)?.toLowerCase();
      if (type && !knownClaudeTypes.has(type) && role !== "assistant" && role !== "user") {
        coverage.recordsSkipped += 1;
        if (accountingSensitiveClaudeType(type)) {
          pending.unsupported = true;
          if (!timestamp) pending.missingTimestamp = true;
        }
        continue;
      }
      if (type === "user" || role === "user") {
        const isToolResult = contentBlocks(message?.content ?? record.content).some((block) => stringValue(block.type) === "tool_result");
        if (!isToolResult || !pending.activeTurnId) {
          pending.activeTurnId = stringValue(record.uuid, record.id, message?.uuid, message?.id) ?? `turn-${lineIndex}`;
          ensureTurn(pending, pending.activeTurnId, timestamp);
        }
        const activeTurn = pending.turns.find((turn) => turn.turnId === pending.activeTurnId);
        if (activeTurn && timestamp) activeTurn.endedAt = timestamp;
        if (!isToolResult && activeTurn && !pending.firstUserMessages.has(activeTurn.turnId)) {
          pending.firstUserMessages.set(activeTurn.turnId, firstUserMessageText(message?.content ?? record.content));
        }
      }
      const sourceLocation = redactedSource(file);
      const listingNames = listedSkillNames(
        record.available_skills,
        record.availableSkills,
        record.skill_listing,
        record.skillListing,
        message?.available_skills,
        message?.availableSkills,
        message?.skill_listing,
        message?.skillListing,
      );
      for (const skillName of listingNames) pending.skillEvidence.push(skillRecord(sessionId, skillName, "available", "listing", null, timestamp, sourceLocation, "reported", pending.activeTurnId));
      if (type === "cost-state") {
        const costState = objectValue(record.cost) ?? objectValue(record.costState) ?? record;
        const totalCost = numberValue(record.totalCostUSD, record.total_cost_usd, costState?.totalCostUSD, costState?.total_cost_usd);
        if (totalCost !== null && totalCost >= 0) pending.sessionCosts.push({ sessionId, totalCost, timestamp, provenance: "reported" });
      }
      if (type === "assistant" || message?.role === "assistant") {
        const usage = message?.usage ?? record.usage;
        const stopReason = stringValue(message?.stop_reason, message?.stopReason) ?? "";
        const errorMarker = stringValue(message?.errorMessage, message?.error_message, record.error);
        const status: ModelCallRecord["status"] = errorMarker || /error|abort|cancel/i.test(stopReason) ? "error" : "ok";
        const callId = stringValue(message?.id, record.requestId, record.request_id, record.id) ?? `assistant-${lineIndex}`;
        const call = usageCall(sessionId, callId, timestamp, stringValue(message?.model, record.model), stringValue(record.provider, record.model_provider), usage, status);
        const turnId = pending.activeTurnId ?? `turn-${callId}`;
        pending.activeTurnId = turnId;
        const turn = ensureTurn(pending, turnId, timestamp);
        turn.endedAt = timestamp ?? turn.endedAt;
        turn.status = status === "error" ? "error" : "ok";
        if (call) call.turnId = turnId;
        const attribution = explicitSkillName(record.attributionSkill, record.attribution_skill, message?.attributionSkill, message?.attribution_skill);
        if (attribution) pending.skillEvidence.push(skillRecord(sessionId, attribution, "attributed", "versioned-attribution", callId, timestamp, sourceLocation, "reported", turnId));
        if (call) {
          if (!call.timestamp) pending.missingTimestamp = true;
          const index = pending.modelCalls.findIndex((candidate) => candidate.callId === call.callId);
          if (index >= 0) {
            if (completeScore(call) >= completeScore(pending.modelCalls[index])) pending.modelCalls[index] = call;
          } else {
            pending.modelCalls.push(call);
          }
        }
        for (const block of contentBlocks(message?.content ?? record.content)) {
          if (stringValue(block.type) === "tool_use") {
            const toolId = stringValue(block.id, block.tool_use_id, block.toolUseId);
            if (toolId && !pending.tools.some((candidate) => candidate.callId === toolId)) {
              if (!timestamp) pending.missingTimestamp = true;
              pending.tools.push({
              sessionId,
              callId: toolId,
              timestamp,
              toolName: stringValue(block.name) ?? "unknown-tool",
              inputBytes: byteLength(block.input),
              resultBytes: null,
              resultChars: null,
              turnId,
              isError: null,
              });
            }
            if (/^(skill|load[_-]?skill|use[_-]?skill)$/i.test(stringValue(block.name) ?? "")) {
              const input = objectValue(block.input) ?? objectValue(block.arguments) ?? block.input ?? block.arguments;
              const invokedSkill = explicitSkillName(input);
              pending.skillEvidence.push(skillRecord(sessionId, invokedSkill, "invoked", "explicit-input", toolId, timestamp, sourceLocation, "reported", turnId));
            }
          }
        }
      }

      if (type === "user" || message?.role === "user") {
        for (const block of contentBlocks(message?.content ?? record.content)) {
          if (stringValue(block.type) !== "tool_result") continue;
          const toolId = stringValue(block.tool_use_id, block.toolUseId, block.id);
          if (!toolId) continue;
          if (!timestamp) pending.missingTimestamp = true;
          const tool = pending.tools.find((candidate) => candidate.callId === toolId);
          if (tool) {
            const result = block.content ?? block.result;
            tool.resultBytes = byteLength(result);
            tool.resultChars = characterLength(result);
            tool.isError = booleanValue(block.is_error, block.isError);
            tool.turnId = tool.turnId ?? pending.activeTurnId;
            tool.endedAt = timestamp;
          } else {
            const result = block.content ?? block.result;
            pending.tools.push({ sessionId, callId: toolId, timestamp, toolName: "unknown-tool", inputBytes: null, resultBytes: byteLength(result), resultChars: characterLength(result), turnId: pending.activeTurnId, endedAt: timestamp, isError: booleanValue(block.is_error, block.isError) });
          }
        }
      }
      if (record.isSidechain === true || record.is_sidechain === true) {
        pending.lifecycle.push({ sessionId, timestamp, kind: "subagent", relatedId: null, turnId: pending.activeTurnId });
        if (!timestamp) pending.missingTimestamp = true;
      }
      if (type.includes("compact") || type === "summary" || stringValue(record.subtype)?.includes("compact")) {
        pending.lifecycle.push({ sessionId, timestamp, kind: "compaction", relatedId: null, turnId: pending.activeTurnId });
        if (!timestamp) pending.missingTimestamp = true;
      }
      if (type.includes("error") || record.error) {
        pending.lifecycle.push({ sessionId, timestamp, kind: "retry", relatedId: null, turnId: pending.activeTurnId });
        if (!timestamp) pending.missingTimestamp = true;
      }
      if (type.includes("interrupt")) {
        pending.lifecycle.push({ sessionId, timestamp, kind: "interrupted", relatedId: null, turnId: pending.activeTurnId });
        if (!timestamp) pending.missingTimestamp = true;
      }
    }
  }

  const sessions: SessionRecord[] = [];
  const turns: TurnRecord[] = [];
  const modelCalls: ModelCallRecord[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const lifecycle: LifecycleRecord[] = [];
  const skillEvidence: SkillUseRecord[] = [];
  const sessionCosts: SessionCostRecord[] = [];
  const firstUserMessages: FirstUserMessageRecord[] = [];
  for (const pending of pendingById.values()) {
    if (!selected(pending, scope)) {
      if (pending.missingTimestamp && (scope.allProjects || sameCwd(pending.session.projectCwd, scope.cwd))) {
        coverage.partialSessions += 1;
        coverage.warnings.push("A Claude Code Session contains accounting records without a usable timestamp; only time-scoped records were analysed.");
      }
      continue;
    }
    if (pending.session.filePath) selectedSourceFiles.add(pending.session.filePath);
    if (pending.unsupported) {
      coverage.warnings.push("A Claude Code Session contains unsupported accounting records; only a partial audit is reported.");
    }
    let partial = pending.unsupported;
    if (pending.missingTimestamp) {
      partial = true;
      coverage.warnings.push("A Claude Code Session contains accounting records without a usable timestamp; only time-scoped records were analysed.");
    }
    if (partial) coverage.partialSessions += 1;
    pending.session.partial = partial;
    sessions.push(pending.session);
    turns.push(...pending.turns);
    for (const turn of pending.turns) {
      const hasMessage = pending.firstUserMessages.has(turn.turnId);
      const content = pending.firstUserMessages.get(turn.turnId) ?? null;
      firstUserMessages.push({
        sessionId: pending.session.sessionId,
        turnId: turn.turnId,
        content,
        unavailableReason: hasMessage
          ? content === null ? "The first user message content was unavailable in the source record." : null
          : "No first user message was mapped to this source Turn.",
      });
    }
    for (const call of pending.modelCalls) if (inScope(call.timestamp, scope)) modelCalls.push(call);
    toolCalls.push(...pending.tools.filter((tool) => inScope(tool.timestamp, scope)));
    lifecycle.push(...pending.lifecycle.filter((event) => inScope(event.timestamp, scope)));
    skillEvidence.push(...pending.skillEvidence.filter((record) => inScope(record.timestamp, scope)));
    const finalCost = [...pending.sessionCosts].reverse().find((record) => inScope(record.timestamp, scope));
    if (finalCost) sessionCosts.push(finalCost);
  }
  if (files.length === 0) coverage.warnings.push("No Claude Code transcript history was found for the selected scope.");
  return { sessions, turns, modelCalls, toolCalls, lifecycle, skillEvidence, sessionCosts, firstUserMessages, sourceFiles: [...selectedSourceFiles].sort(), coverage };
}
