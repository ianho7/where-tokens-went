import { readFile, readdir } from "node:fs/promises";
import { decompress as decompressZstd } from "fzstd";
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
  attemptCalls: Array<{ stepId: string | null; call: ModelCallRecord }>;
  messageSteps: Set<string>;
  tools: ToolCallRecord[];
  lifecycle: LifecycleRecord[];
  seenSeq: Set<string>;
  lastSeq: number | null;
  currentModel: string | null;
  currentProvider: string | null;
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
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
    if (typeof value === "string" && value.trim() && !Number.isNaN(Date.parse(value))) return value;
  }
  return null;
}

function byteLength(value: unknown): number | null {
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  if (value === null || value === undefined) return null;
  try { return Buffer.byteLength(JSON.stringify(value), "utf8"); } catch { return null; }
}

function characterLength(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "string" ? value : (() => {
    try { return JSON.stringify(value); } catch { return null; }
  })();
  return text === null ? null : Array.from(text).length;
}

function createSession(sessionId: string): PendingSession {
  return {
    session: { harness: "deepseek", sessionId, projectCwd: null, startedAt: null, endedAt: null, parentSessionId: null, sourceVersion: null },
    eventTimes: [],
    modelCalls: [],
    attemptCalls: [],
    messageSteps: new Set(),
    tools: [],
    lifecycle: [],
    seenSeq: new Set(),
    lastSeq: null,
    currentModel: null,
    currentProvider: null,
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
  callId: string,
  timestamp: string | null,
  model: string | null,
  provider: string | null,
  usageValue: unknown,
): ModelCallRecord | null {
  const usage = objectValue(usageValue);
  if (!usage) return null;
  const inputTokens = numberValue(usage.inputTokens, usage.input_tokens);
  const cachedInputTokens = numberValue(usage.cacheReadTokens, usage.cache_read_tokens, usage.cache_read_input_tokens);
  const cacheWriteTokens = numberValue(usage.cacheWriteTokens, usage.cache_write_tokens, usage.cache_write_input_tokens);
  const outputTokens = numberValue(usage.outputTokens, usage.output_tokens);
  const reasoningTokens = numberValue(usage.reasoningTokens, usage.reasoning_tokens);
  const reportedTotal = numberValue(usage.totalTokens, usage.total_tokens, usage.total);
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

async function sessionFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile() && (entry.name === "session.jsonl" || entry.name.endsWith(".jsonl") || entry.name.endsWith(".jsonl.zstd"))) files.push(fullPath);
    }
  }
  await visit(root);
  return files.sort();
}

const knownEvents = new Set([
  "header", "session", "request/header", "request/context", "turn/start", "turn/end", "step/start", "step/end",
  "assistant/chunk", "assistant/message", "assistant/attempt", "tool/call", "tool/result", "retry", "interrupted",
  "compaction/start", "compaction/summary", "compaction/end", "subagent/start", "subagent/end",
  "text-chunks", "reasoning-chunks", "tool-call-chunks",
]);

const packedEvents = new Set(["text-chunks", "reasoning-chunks", "tool-call-chunks"]);

function packedSpan(record: JsonObject, data: JsonObject, type: string): { start: number; end: number } | null {
  if (!packedEvents.has(type)) return null;
  const start = numberValue(record.seq0, data.seq0);
  if (start === null) return null;
  const valuesKeys = type === "text-chunks"
    ? ["texts"]
    : type === "reasoning-chunks"
      ? ["reasonings", "reasoning", "thoughts"]
      : ["toolCalls", "tool_calls", "calls"];
  const values = valuesKeys.map((key) => data[key]).find((value) => Array.isArray(value));
  const count = Array.isArray(values) ? values.length : Array.isArray(data.dt) ? data.dt.length : 0;
  return count > 0 ? { start, end: start + count - 1 } : null;
}

function expandPackedRecord(record: JsonObject): JsonObject[] {
  const type = stringValue(record.type, record.kind) ?? "";
  if (!packedEvents.has(type)) return [record];
  const data = objectValue(record.data) ?? record;
  const span = packedSpan(record, data, type);
  if (!span) return [record];
  const valuesKeys = type === "text-chunks"
    ? ["texts"]
    : type === "reasoning-chunks"
      ? ["reasonings", "reasoning", "thoughts"]
      : ["toolCalls", "tool_calls", "calls"];
  const values = valuesKeys.map((key) => data[key]).find((value) => Array.isArray(value)) as unknown[] | undefined;
  const count = span.end - span.start + 1;
  const deltas = Array.isArray(data.dt) ? data.dt : [];
  const startTime = numberValue(record.time0, data.time0);
  let time = startTime ?? 0;
  return Array.from({ length: count }, (_, index) => {
    if (index > 0) time += numberValue(deltas[index]) ?? 0;
    const value = values?.[index];
    const chunk = objectValue(value) ?? { value: value ?? null };
    return {
      type: "assistant/chunk",
      seq: span.start + index,
      ...(startTime === null ? {} : { time: new Date(time).toISOString() }),
      data: { ...data, ...chunk, chunk },
    };
  });
}

function accountingSensitive(type: string): boolean {
  return /usage|token|response|assistant|message|tool|call|request|turn|step|retry|interrupt|compact|subagent|error/i.test(type);
}

export async function readDeepSeek(scope: ReadScope): Promise<ReadResult> {
  const explicit = process.env.DSH_SESSION_JSONL;
  const root = process.env.DSH_JSONL_ROOT || process.env.DSH_PERSISTENCE_ROOT;
  const files = explicit ? [explicit] : root ? await sessionFiles(root) : [];
  const coverage = { filesRead: 0, recordsRead: 0, recordsSkipped: 0, partialSessions: 0, warnings: [] as string[] };
  const pendingById = new Map<string, PendingSession>();
  let fallbackIndex = 0;

  for (const file of files) {
    coverage.filesRead += 1;
    let logical: string;
    try {
      const bytes = await readFile(file);
      logical = file.endsWith(".zstd") ? Buffer.from(decompressZstd(bytes)).toString("utf8") : bytes.toString("utf8");
    } catch {
      coverage.recordsSkipped += 1;
      coverage.partialSessions += 1;
      coverage.warnings.push("A DeepSeek Harness Session could not be decoded and was skipped.");
      continue;
    }
    const physicalLines = logical.split(/\r?\n/);
    const trailingNewline = /\r?\n$/.test(logical);
    if (trailingNewline) physicalLines.pop();
    let records: JsonObject[] = [];
    for (let lineIndex = 0; lineIndex < physicalLines.length; lineIndex += 1) {
      const line = physicalLines[lineIndex];
      if (!line.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const object = objectValue(item);
            if (object) records.push(object);
          }
        } else {
          const object = objectValue(parsed);
          if (object) records.push(object);
          else coverage.recordsSkipped += 1;
        }
      } catch {
        coverage.recordsSkipped += 1;
        if (lineIndex === physicalLines.length - 1 && !trailingNewline) coverage.partialSessions += 1;
      }
    }
    records = records.flatMap(expandPackedRecord);
    let currentSessionId: string | null = null;
    for (const record of records) {
      const type = stringValue(record.type, record.kind) ?? "";
      const data = objectValue(record.data) ?? record;
      const seq = stringValue(record.seq, record.sequence, record.seq0);
      const timestamp = timestampValue(record.time, record.timestamp, record.time0, data.time, data.timestamp, data.time0);
      coverage.recordsRead += 1;
      if (type === "header" || type === "session") {
        currentSessionId = stringValue(record.sessionId, record.session_id, record.id, data.sessionId, data.session_id, data.id) ?? `unknown-session-${fallbackIndex++}`;
        const pending = pendingById.get(currentSessionId) ?? createSession(currentSessionId);
        pendingById.set(currentSessionId, pending);
        pending.session.projectCwd = stringValue(record.cwd, data.cwd, record.projectCwd, data.projectCwd);
        pending.session.parentSessionId = stringValue(record.parentSession, data.parentSession, record.parent_session, data.parent_session);
        pending.session.sourceVersion = stringValue(record.version, data.version);
        updateTime(pending, timestamp);
        continue;
      }
      if (!currentSessionId) currentSessionId = `unknown-session-${fallbackIndex++}`;
      const pending = pendingById.get(currentSessionId) ?? createSession(currentSessionId);
      pendingById.set(currentSessionId, pending);
      const span = packedSpan(record, data, type);
      const sequenceStart = span?.start ?? numberValue(record.seq, record.sequence, record.seq0);
      const sequenceEnd = span?.end ?? sequenceStart;
      if (span) {
        const duplicate = Array.from({ length: span.end - span.start + 1 }, (_, index) => String(span.start + index)).some((value) => pending.seenSeq.has(value));
        if (duplicate) continue;
        for (let value = span.start; value <= span.end; value += 1) pending.seenSeq.add(String(value));
      } else if (seq && pending.seenSeq.has(seq)) {
        continue;
      } else if (seq) {
        pending.seenSeq.add(seq);
      }
      if (sequenceStart !== null && sequenceEnd !== null) {
        if (pending.lastSeq !== null && sequenceStart !== pending.lastSeq + 1) pending.unsupported = true;
        pending.lastSeq = sequenceEnd;
      }
      updateTime(pending, timestamp);
      if (!knownEvents.has(type)) {
        coverage.recordsSkipped += 1;
        if (accountingSensitive(type)) pending.unsupported = true;
        continue;
      }
      if (type === "request/header" || type === "request/context") {
        pending.currentModel = stringValue(data.model, data.modelId, data.model_id) ?? pending.currentModel;
        pending.currentProvider = stringValue(data.provider) ?? pending.currentProvider;
      }
      if (type === "assistant/message") {
        const stepId = stringValue(data.stepId, data.step_id);
        const callId = stringValue(data.messageId, data.message_id, data.callId, data.call_id, stepId, seq) ?? `assistant-${pending.modelCalls.length}`;
        const call = usageCall(currentSessionId, callId, timestamp, stringValue(data.model) ?? pending.currentModel, stringValue(data.provider) ?? pending.currentProvider, data.usage);
        if (call && !pending.modelCalls.some((candidate) => candidate.callId === call.callId)) pending.modelCalls.push(call);
        if (stepId) pending.messageSteps.add(stepId);
        const content = Array.isArray(data.content) ? data.content : [];
        for (const item of content) {
          const block = objectValue(item);
          if (!block || !stringValue(block.type)?.includes("tool")) continue;
          const toolId = stringValue(block.callId, block.call_id, block.id);
          if (toolId && !pending.tools.some((tool) => tool.callId === toolId)) pending.tools.push({ sessionId: currentSessionId, callId: toolId, timestamp, toolName: stringValue(block.name, block.toolName) ?? "unknown-tool", inputBytes: byteLength(block.arguments ?? block.input), resultBytes: null, isError: null });
        }
      }
      if (type === "assistant/attempt") {
        const stepId = stringValue(data.stepId, data.step_id);
        const callId = stringValue(data.attemptId, data.attempt_id, data.callId, data.call_id, stepId, seq) ?? `attempt-${pending.attemptCalls.length}`;
        const call = usageCall(currentSessionId, callId, timestamp, stringValue(data.model) ?? pending.currentModel, stringValue(data.provider) ?? pending.currentProvider, data.usage ?? data.streamUsage ?? data.stream_usage);
        if (call) pending.attemptCalls.push({ stepId, call });
      }
      if (type === "tool/call") {
        const toolId = stringValue(data.callId, data.call_id, data.id);
        if (toolId && !pending.tools.some((tool) => tool.callId === toolId)) pending.tools.push({ sessionId: currentSessionId, callId: toolId, timestamp, toolName: stringValue(data.name, data.toolName) ?? "unknown-tool", inputBytes: byteLength(data.arguments ?? data.input), resultBytes: null, isError: null });
      }
      if (type === "tool/result") {
        const toolId = stringValue(data.callId, data.call_id, data.toolCallId, data.tool_call_id);
        if (toolId) {
          const tool = pending.tools.find((candidate) => candidate.callId === toolId);
          const result = data.result ?? data.content ?? data.output;
          if (tool) { tool.resultBytes = byteLength(result); tool.resultChars = characterLength(result); tool.isError = booleanValue(data.isError, data.is_error); }
          else pending.tools.push({ sessionId: currentSessionId, callId: toolId, timestamp, toolName: stringValue(data.name, data.toolName) ?? "unknown-tool", inputBytes: null, resultBytes: byteLength(result), resultChars: characterLength(result), isError: booleanValue(data.isError, data.is_error) });
        }
      }
      if (type === "retry") pending.lifecycle.push({ sessionId: currentSessionId, timestamp, kind: "retry", relatedId: stringValue(data.attemptId, data.attempt_id) });
      if (type === "interrupted") pending.lifecycle.push({ sessionId: currentSessionId, timestamp, kind: "interrupted", relatedId: null });
      if (type.startsWith("compaction/")) pending.lifecycle.push({ sessionId: currentSessionId, timestamp, kind: "compaction", relatedId: null });
      if (type.startsWith("subagent/")) pending.lifecycle.push({ sessionId: currentSessionId, timestamp, kind: "subagent", relatedId: stringValue(data.sessionId, data.session_id) });
    }
  }

  const sessions: SessionRecord[] = [];
  const modelCalls: ModelCallRecord[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const lifecycle: LifecycleRecord[] = [];
  for (const pending of pendingById.values()) {
    if (!sameCwd(pending.session.projectCwd, scope.cwd) && !scope.allProjects) continue;
    if (pending.eventTimes.length > 0 && !pending.eventTimes.some((time) => time >= scope.since.getTime())) continue;
    if (pending.unsupported) {
      coverage.partialSessions += 1;
      coverage.warnings.push("A DeepSeek Harness Session contains unsupported or non-contiguous records; only a partial audit is reported.");
    }
    sessions.push(pending.session);
    const calls = [...pending.modelCalls, ...pending.attemptCalls.filter((entry) => !entry.stepId || !pending.messageSteps.has(entry.stepId)).map((entry) => entry.call)];
    for (const call of calls) if (call.timestamp && !Number.isNaN(Date.parse(call.timestamp)) && Date.parse(call.timestamp) >= scope.since.getTime()) modelCalls.push(call);
    toolCalls.push(...pending.tools.filter((tool) => tool.timestamp && !Number.isNaN(Date.parse(tool.timestamp)) && Date.parse(tool.timestamp) >= scope.since.getTime()));
    lifecycle.push(...pending.lifecycle.filter((event) => event.timestamp && !Number.isNaN(Date.parse(event.timestamp)) && Date.parse(event.timestamp) >= scope.since.getTime()));
  }
  if (files.length === 0) coverage.warnings.push("No DeepSeek Harness Session history was found for the selected scope.");
  return { sessions, modelCalls, toolCalls, lifecycle, coverage };
}
