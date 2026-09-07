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

interface PendingSession {
  session: SessionRecord;
  eventTimes: number[];
  modelCalls: ModelCallRecord[];
  tools: ToolCallRecord[];
  lifecycle: LifecycleRecord[];
  unsupported: boolean;
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

function createSession(sessionId: string): PendingSession {
  return {
    session: {
      harness: "claude",
      sessionId,
      projectCwd: null,
      startedAt: null,
      endedAt: null,
      parentSessionId: null,
      sourceVersion: null,
    },
    eventTimes: [],
    modelCalls: [],
    tools: [],
    lifecycle: [],
    unsupported: false,
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
  const outputTokens = numberValue(usage.output_tokens, usage.outputTokens);
  const reasoningTokens = numberValue(usage.reasoning_tokens, usage.reasoningTokens);
  const reportedTotal = numberValue(usage.total_tokens, usage.totalTokens);
  if ([inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens, reasoningTokens, reportedTotal].every((value) => value === null)) return null;
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
    reportedCost: null,
    status,
    tokenProvenance: reportedTotal !== null ? "reported" : totalTokens === null ? "unavailable" : "derived",
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
  return pending.eventTimes.some((time) => time >= scope.since.getTime());
}

const knownClaudeTypes = new Set([
  "user", "assistant", "system", "summary", "progress", "queue-operation", "file-history-snapshot",
  "last-prompt", "result", "tool_result", "tool-result",
]);

function accountingSensitiveClaudeType(type: string): boolean {
  return /usage|token|response|assistant|message|tool|call|retry|interrupt|compact|subagent|error/i.test(type);
}

export async function readClaude(scope: ReadScope): Promise<ReadResult> {
  const root = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const files = await jsonlFiles(path.join(root, "projects"));
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
      const sessionId: string = stringValue(record.session_id, record.sessionId, message?.session_id, message?.sessionId) ?? activeSessionId ?? `unknown-session-${fallbackIndex++}`;
      activeSessionId = sessionId;
      const pending = pendingById.get(sessionId) ?? createSession(sessionId);
      pendingById.set(sessionId, pending);
      updateTime(pending, timestamp);
      const cwd = stringValue(record.cwd, record.project_cwd, record.projectCwd, message?.cwd);
      if (cwd) pending.session.projectCwd = cwd;
      const sourceVersion = stringValue(record.version, record.claude_code_version, record.claudeCodeVersion);
      if (sourceVersion) pending.session.sourceVersion = sourceVersion;
      const parentSessionId = stringValue(record.parent_session_id, record.parentSessionId);
      if (parentSessionId) pending.session.parentSessionId = parentSessionId;

      const type = stringValue(record.type, record.kind)?.toLowerCase() ?? "";
      const role = stringValue(message?.role)?.toLowerCase();
      if (type && !knownClaudeTypes.has(type) && role !== "assistant" && role !== "user") {
        coverage.recordsSkipped += 1;
        if (accountingSensitiveClaudeType(type)) pending.unsupported = true;
        continue;
      }
      if (type === "assistant" || message?.role === "assistant") {
        const usage = message?.usage ?? record.usage;
        const stopReason = stringValue(message?.stop_reason, message?.stopReason) ?? "";
        const errorMarker = stringValue(message?.errorMessage, message?.error_message, record.error);
        const status: ModelCallRecord["status"] = errorMarker || /error|abort|cancel/i.test(stopReason) ? "error" : "ok";
        const callId = stringValue(message?.id, record.requestId, record.request_id, record.id) ?? `assistant-${lineIndex}`;
        const call = usageCall(sessionId, callId, timestamp, stringValue(message?.model, record.model), stringValue(record.provider, record.model_provider), usage, status);
        if (call) {
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
            if (toolId && !pending.tools.some((candidate) => candidate.callId === toolId)) pending.tools.push({
              sessionId,
              callId: toolId,
              timestamp,
              toolName: stringValue(block.name) ?? "unknown-tool",
              inputBytes: byteLength(block.input),
              resultBytes: null,
              resultChars: null,
              isError: null,
            });
          }
        }
      }

      if (type === "user" || message?.role === "user") {
        for (const block of contentBlocks(message?.content ?? record.content)) {
          if (stringValue(block.type) !== "tool_result") continue;
          const toolId = stringValue(block.tool_use_id, block.toolUseId, block.id);
          if (!toolId) continue;
          const tool = pending.tools.find((candidate) => candidate.callId === toolId);
          if (tool) {
            const result = block.content ?? block.result;
            tool.resultBytes = byteLength(result);
            tool.resultChars = characterLength(result);
            tool.isError = booleanValue(block.is_error, block.isError);
          } else {
            const result = block.content ?? block.result;
            pending.tools.push({ sessionId, callId: toolId, timestamp, toolName: "unknown-tool", inputBytes: null, resultBytes: byteLength(result), resultChars: characterLength(result), isError: booleanValue(block.is_error, block.isError) });
          }
        }
      }
      if (record.isSidechain === true || record.is_sidechain === true) pending.lifecycle.push({ sessionId, timestamp, kind: "subagent", relatedId: null });
      if (type.includes("compact") || type === "summary" || stringValue(record.subtype)?.includes("compact")) pending.lifecycle.push({ sessionId, timestamp, kind: "compaction", relatedId: null });
      if (type.includes("error") || record.error) pending.lifecycle.push({ sessionId, timestamp, kind: "retry", relatedId: null });
      if (type.includes("interrupt")) pending.lifecycle.push({ sessionId, timestamp, kind: "interrupted", relatedId: null });
    }
  }

  const sessions: SessionRecord[] = [];
  const modelCalls: ModelCallRecord[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const lifecycle: LifecycleRecord[] = [];
  for (const pending of pendingById.values()) {
    if (!selected(pending, scope)) continue;
    if (pending.unsupported) {
      coverage.partialSessions += 1;
      coverage.warnings.push("A Claude Code Session contains unsupported accounting records; only a partial audit is reported.");
    }
    sessions.push(pending.session);
    for (const call of pending.modelCalls) if (call.timestamp && !Number.isNaN(Date.parse(call.timestamp)) && Date.parse(call.timestamp) >= scope.since.getTime()) modelCalls.push(call);
    toolCalls.push(...pending.tools.filter((tool) => tool.timestamp && !Number.isNaN(Date.parse(tool.timestamp)) && Date.parse(tool.timestamp) >= scope.since.getTime()));
    lifecycle.push(...pending.lifecycle.filter((event) => event.timestamp && !Number.isNaN(Date.parse(event.timestamp)) && Date.parse(event.timestamp) >= scope.since.getTime()));
  }
  if (files.length === 0) coverage.warnings.push("No Claude Code transcript history was found for the selected scope.");
  return { sessions, modelCalls, toolCalls, lifecycle, coverage };
}
