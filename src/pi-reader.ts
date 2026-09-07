import { readFile, readdir } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  LifecycleRecord,
  ModelCallRecord,
  ReadResult,
  ReadScope,
  SessionRecord,
  ToolCallRecord,
} from "./types";

type JsonObject = Record<string, unknown>;

interface ParsedEntry {
  id: string;
  parentId: string | null;
  callIds: string[];
  toolIds: string[];
}

interface PendingSession {
  session: SessionRecord;
  eventTimes: number[];
  modelCalls: ModelCallRecord[];
  tools: ToolCallRecord[];
  lifecycle: LifecycleRecord[];
  entries: ParsedEntry[];
  currentModel: string | null;
  currentProvider: string | null;
  unsupported: boolean;
  partial: boolean;
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

function blocks(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.map(objectValue).filter((item): item is JsonObject => item !== null);
  const object = objectValue(value);
  return object ? [object] : [];
}

function createSession(sessionId: string): PendingSession {
  return {
    session: { harness: "pi", sessionId, projectCwd: null, startedAt: null, endedAt: null, parentSessionId: null, sourceVersion: null },
    eventTimes: [],
    modelCalls: [],
    tools: [],
    lifecycle: [],
    entries: [],
    currentModel: null,
    currentProvider: null,
    unsupported: false,
    partial: false,
    missingTimestamp: false,
  };
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
  callId: string,
  timestamp: string | null,
  model: string | null,
  provider: string | null,
  usageValue: unknown,
): ModelCallRecord | null {
  const usage = objectValue(usageValue);
  if (!usage) return null;
  const inputTokens = numberValue(usage.input, usage.input_tokens, usage.inputTokens);
  const cachedInputTokens = numberValue(usage.cacheRead, usage.cache_read, usage.cache_read_input_tokens, usage.cacheReadTokens);
  const cacheWriteTokens = numberValue(usage.cacheWrite, usage.cache_write, usage.cache_write_input_tokens, usage.cacheWriteTokens);
  const outputTokens = numberValue(usage.output, usage.output_tokens, usage.outputTokens);
  const reasoningTokens = numberValue(usage.reasoning, usage.reasoning_tokens, usage.reasoningTokens);
  const reportedTotal = numberValue(usage.totalTokens, usage.total_tokens, usage.total);
  const costObject = objectValue(usage.cost);
  const reportedCost = numberValue(costObject?.total, costObject?.totalCost, usage.cost);
  if ([inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens, reasoningTokens, reportedTotal, reportedCost].every((value) => value === null)) return null;
  const totalTokens = reportedTotal ?? (
    inputTokens !== null && cachedInputTokens !== null && cacheWriteTokens !== null
      && outputTokens !== null && reasoningTokens !== null
      ? inputTokens + cachedInputTokens + cacheWriteTokens + outputTokens + reasoningTokens
      : null
  );
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
    reportedCost,
    status: "ok",
    tokenProvenance: reportedTotal !== null ? "reported" : totalTokens === null ? "unavailable" : "derived",
  };
}

function sameCwd(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  const normalise = (value: string) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalise(left) === normalise(right);
}

async function jsonlFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(fullPath);
    }
  }
  await visit(root);
  return files.sort();
}

function activeEntryIds(entries: ParsedEntry[]): Set<string> {
  if (entries.length === 0) return new Set();
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const active = new Set<string>();
  let current: ParsedEntry | undefined = entries[entries.length - 1];
  while (current && !active.has(current.id)) {
    active.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return active;
}

function selected(pending: PendingSession, scope: ReadScope): boolean {
  if (!scope.allProjects && !sameCwd(pending.session.projectCwd, scope.cwd)) return false;
  return pending.eventTimes.some((time) => time >= scope.since.getTime());
}

const knownPiTypes = new Set([
  "session", "session_header", "message", "model_change", "model-change", "thinking_level_change",
  "thinking-level-change", "compaction", "branch_summary", "branch-summary", "custom", "label", "session_info",
]);

function accountingSensitivePiType(type: string): boolean {
  return /usage|token|response|assistant|message|tool|call|retry|interrupt|compact|subagent|error/i.test(type);
}

export async function readPi(scope: ReadScope): Promise<ReadResult> {
  const root = process.env.PI_SESSIONS_DIR || path.join(os.homedir(), ".pi", "agent", "sessions");
  const files = await jsonlFiles(root);
  const coverage = { filesRead: 0, recordsRead: 0, recordsSkipped: 0, partialSessions: 0, warnings: [] as string[] };
  const pendingById = new Map<string, PendingSession>();
  let fallbackIndex = 0;

  for (const file of files) {
    coverage.filesRead += 1;
    let text: string;
    try { text = await readFile(file, "utf8"); } catch { coverage.recordsSkipped += 1; coverage.warnings.push("A Pi Session could not be read and was skipped."); continue; }
    const lines = text.split(/\r?\n/);
    const trailingNewline = /\r?\n$/.test(text);
    if (trailingNewline) lines.pop();
    let sessionId: string | null = null;
    let pending: PendingSession | null = null;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      if (!lines[lineIndex].trim()) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(lines[lineIndex]); } catch {
        coverage.recordsSkipped += 1;
        if (lineIndex === lines.length - 1 && !trailingNewline) coverage.partialSessions += 1;
        continue;
      }
      const record = objectValue(parsed);
      if (!record) { coverage.recordsSkipped += 1; continue; }
      coverage.recordsRead += 1;
      const type = stringValue(record.type)?.toLowerCase() ?? "";
      const message = objectValue(record.message);
      const timestamp = timestampValue(record.timestamp, record.time, message?.timestamp);
      if (type === "session" || type === "session_header") {
        sessionId = stringValue(record.id, record.sessionId, record.session_id) ?? `unknown-session-${fallbackIndex++}`;
        pending = pendingById.get(sessionId) ?? createSession(sessionId);
        pendingById.set(sessionId, pending);
        const version = numberValue(record.version);
        if (version !== null) {
          pending.session.sourceVersion = String(version);
          if (version > 3) pending.unsupported = true;
        }
        pending.session.projectCwd = stringValue(record.cwd, record.projectCwd);
        pending.session.parentSessionId = stringValue(record.parentSession, record.parent_session, record.parentSessionId);
        updateTime(pending, timestamp);
        continue;
      }
      if (!pending || !sessionId) {
        sessionId = sessionId ?? `unknown-session-${fallbackIndex++}`;
        pending = pending ?? createSession(sessionId);
        pendingById.set(sessionId, pending);
      }
      const currentSessionId = sessionId as string;
      updateTime(pending, timestamp);
      const entryId = stringValue(record.id, record.entryId, record.entry_id);
      const entry: ParsedEntry | null = entryId ? { id: entryId, parentId: stringValue(record.parentId, record.parent_id), callIds: [], toolIds: [] } : null;
      if (entry) pending.entries.push(entry);
      if (type === "model_change" || type === "model-change") {
        pending.currentModel = stringValue(record.model, record.modelId, record.model_id) ?? pending.currentModel;
        pending.currentProvider = stringValue(record.provider) ?? pending.currentProvider;
      }
      const role = stringValue(message?.role, record.role)?.toLowerCase() ?? "";
      if (type && !knownPiTypes.has(type) && !role) {
        coverage.recordsSkipped += 1;
        if (accountingSensitivePiType(type)) {
          pending.partial = true;
          if (!timestamp) pending.missingTimestamp = true;
        }
        continue;
      }
      if (role === "assistant" || type === "assistant") {
        const usage = message?.usage ?? record.usage;
        const callId = stringValue(message?.id, record.callId, record.call_id, entryId) ?? `assistant-${lineIndex}`;
        const call = usageCall(currentSessionId, callId, timestamp, stringValue(message?.model, record.model) ?? pending.currentModel, stringValue(message?.provider, record.provider) ?? pending.currentProvider, usage);
        if (call && !call.timestamp) pending.missingTimestamp = true;
        if (call && !pending.modelCalls.some((candidate) => candidate.callId === call.callId)) {
          pending.modelCalls.push(call);
          if (entry && call.callId) entry.callIds.push(call.callId);
        }
        for (const block of blocks(message?.content ?? record.content)) {
          const blockType = stringValue(block.type)?.toLowerCase();
          if (!blockType?.includes("toolcall") && blockType !== "tool_use") continue;
          const toolId = stringValue(block.id, block.toolCallId, block.tool_call_id);
          if (toolId && !pending.tools.some((tool) => tool.callId === toolId)) {
            if (!timestamp) pending.missingTimestamp = true;
            pending.tools.push({ sessionId: currentSessionId, callId: toolId, timestamp, toolName: stringValue(block.name, block.toolName) ?? "unknown-tool", inputBytes: byteLength(block.arguments ?? block.input), resultBytes: null, resultChars: null, entryId, isError: null });
            if (entry) entry.toolIds.push(toolId);
          }
        }
      }
      if (role === "toolresult" || role === "tool_result" || type === "tool_result") {
        const toolId = stringValue(message?.toolCallId, message?.tool_call_id, record.toolCallId, record.tool_call_id);
        if (toolId) {
          if (!timestamp) pending.missingTimestamp = true;
          const tool = pending.tools.find((candidate) => candidate.callId === toolId);
          if (tool) {
            if (entry && !entry.toolIds.includes(toolId)) entry.toolIds.push(toolId);
            const result = message?.content ?? record.content ?? record.result;
            tool.resultBytes = byteLength(result);
            tool.resultChars = characterLength(result);
            tool.isError = booleanValue(message?.isError, message?.is_error, record.isError, record.is_error);
          } else {
            const result = message?.content ?? record.content ?? record.result;
            pending.tools.push({ sessionId: currentSessionId, callId: toolId, timestamp, toolName: stringValue(message?.toolName, record.toolName) ?? "unknown-tool", inputBytes: null, resultBytes: byteLength(result), resultChars: characterLength(result), entryId, isError: booleanValue(message?.isError, message?.is_error, record.isError, record.is_error) });
            if (entry) entry.toolIds.push(toolId);
          }
        }
      }
      if (type === "compaction" || type === "branch_summary") {
        pending.lifecycle.push({ sessionId, timestamp, kind: "compaction", relatedId: entryId });
        if (!timestamp) pending.missingTimestamp = true;
      }
      if (type.includes("error") || stringValue(message?.stopReason, message?.stop_reason)?.includes("error")) {
        pending.lifecycle.push({ sessionId, timestamp, kind: "retry", relatedId: entryId });
        if (!timestamp) pending.missingTimestamp = true;
      }
      if (type.includes("interrupt") || stringValue(message?.stopReason, message?.stop_reason)?.includes("abort")) {
        pending.lifecycle.push({ sessionId, timestamp, kind: "interrupted", relatedId: entryId });
        if (!timestamp) pending.missingTimestamp = true;
      }
      if (type.includes("subagent") || stringValue(record.origin)?.includes("subagent")) {
        pending.lifecycle.push({ sessionId, timestamp, kind: "subagent", relatedId: entryId });
        if (!timestamp) pending.missingTimestamp = true;
      }
    }
  }

  const sessions: SessionRecord[] = [];
  const modelCalls: ModelCallRecord[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const lifecycle: LifecycleRecord[] = [];
  for (const pending of pendingById.values()) {
    if (!selected(pending, scope)) {
      if (pending.missingTimestamp && (scope.allProjects || sameCwd(pending.session.projectCwd, scope.cwd))) {
        coverage.partialSessions += 1;
        coverage.warnings.push("A Pi Session contains accounting records without a usable timestamp; only time-scoped records were analysed.");
      }
      continue;
    }
    if (pending.unsupported) {
      coverage.recordsSkipped += 1;
      coverage.warnings.push("A Pi Session uses an unsupported future format version and was skipped.");
      continue;
    }
    let partial = false;
    if (pending.partial) {
      partial = true;
      coverage.warnings.push("A Pi Session contains unsupported accounting records; only a partial audit is reported.");
    }
    if (pending.missingTimestamp) {
      partial = true;
      coverage.warnings.push("A Pi Session contains accounting records without a usable timestamp; only time-scoped records were analysed.");
    }
    if (partial) coverage.partialSessions += 1;
    sessions.push(pending.session);
    const active = activeEntryIds(pending.entries);
    const activeCallIds = new Set(
      pending.entries
        .filter((entry) => active.has(entry.id))
        .flatMap((entry) => entry.callIds),
    );
    for (const call of pending.modelCalls) {
      if (!call.timestamp || Number.isNaN(Date.parse(call.timestamp)) || Date.parse(call.timestamp) < scope.since.getTime()) continue;
      modelCalls.push({ ...call, activeBranch: active.size === 0 || activeCallIds.has(call.callId ?? "") });
    }
    const activeTools = active.size === 0
      ? pending.tools
      : pending.tools.filter((tool) => !tool.entryId || active.has(tool.entryId));
    const activeLifecycle = active.size === 0
      ? pending.lifecycle
      : pending.lifecycle.filter((event) => !event.relatedId || active.has(event.relatedId));
    toolCalls.push(...activeTools.filter((tool) => tool.timestamp && !Number.isNaN(Date.parse(tool.timestamp)) && Date.parse(tool.timestamp) >= scope.since.getTime()));
    lifecycle.push(...activeLifecycle.filter((event) => event.timestamp && !Number.isNaN(Date.parse(event.timestamp)) && Date.parse(event.timestamp) >= scope.since.getTime()));
  }
  if (files.length === 0) coverage.warnings.push("No Pi Session history was found for the selected scope.");
  return { sessions, modelCalls, toolCalls, lifecycle, coverage };
}
