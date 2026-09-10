import {
  readFile,
  readdir,
} from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type {
  LifecycleRecord,
  ModelCallRecord,
  ReadResult,
  ReadScope,
  SessionRecord,
  SkillUseRecord,
  ToolCallRecord,
} from "./types";

type JsonObject = Record<string, unknown>;

interface UsageValues {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
}

interface PendingSession {
  session: SessionRecord;
  eventTimes: number[];
  rawCalls: ModelCallRecord[];
  incrementalCalls: ModelCallRecord[];
  finalTotal: ModelCallRecord | null;
  toolCalls: ToolCallRecord[];
  lifecycle: LifecycleRecord[];
  currentModel: string | null;
  currentProvider: string | null;
  currentTurnId: string | null;
  skillEvidence: SkillUseRecord[];
  unsupported: boolean;
  missingTimestamp: boolean;
  partial: boolean;
  partialCoverageCounted: boolean;
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function firstObject(...values: unknown[]): JsonObject | null {
  for (const value of values) {
    const object = asObject(value);
    if (object) return object;
  }
  return null;
}

function stringValue(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function skillNameValue(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string") {
      const cleaned = value.trim().replace(/^\/+/, "").replace(/\\/g, "/");
      const match = /(?:^|\/)([^/]+?)(?:\/SKILL\.md)?$/i.exec(cleaned);
      const candidate = match?.[1] ?? cleaned;
      if (candidate && candidate.length <= 80 && /^[A-Za-z0-9_.:@-]+$/.test(candidate)) return candidate;
    }
    const object = asObject(value);
    if (object) {
      const nested = skillNameValue(object.name, object.skill, object.skill_name, object.skillName, object.id);
      if (nested) return nested;
    }
  }
  return null;
}

function redactedSource(file: string): string {
  return "rollout:" + path.basename(file, ".jsonl");
}

function skillRecord(
  sessionId: string,
  skillName: string | null,
  state: SkillUseRecord["state"],
  evidenceType: SkillUseRecord["evidenceType"],
  turnId: string | null,
  callId: string | null,
  timestamp: string | null,
  sourceLocation: string,
  provenance: SkillUseRecord["provenance"],
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

function skillPathEvidence(value: unknown): { name: string; evidenceType: "resource-read" | "script-execution" } | null {
  const text = typeof value === "string" ? value : (() => {
    try { return JSON.stringify(value); } catch { return null; }
  })();
  if (!text) return null;
  const normalized = text.replaceAll("\\", "/").replace(/\/+/g, "/");
  const match = /(?:^|\/)skills\/([^\/\"']+?)(?:\/SKILL\.md|\/scripts\/[^\/\"']+)/i.exec(normalized);
  if (!match) return null;
  return { name: skillNameValue(match[1])!, evidenceType: /\/SKILL\.md/i.test(match[0]) ? "resource-read" : "script-execution" };
}

function structuredSkillName(record: JsonObject, payload: JsonObject, payloadType: string | null): string | null {
  const explicitFields = [
    payload.skill_name,
    payload.skillName,
    payload.invoked_skill,
    payload.invokedSkill,
    record.skill_name,
    record.skillName,
    record.invoked_skill,
    record.invokedSkill,
  ];
  const explicit = skillNameValue(...explicitFields);
  if (explicit) return explicit;
  if (payloadType?.includes("skill")) return skillNameValue(payload.input, payload.arguments, payload.parameters, payload.skill, payload.name);
  return null;
}

function numberValue(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function booleanValue(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string" && (value === "true" || value === "false")) return value === "true";
  }
  return null;
}

function timestampValue(...values: unknown[]): string | null {
  const value = stringValue(...values);
  if (!value) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

function getNested(object: JsonObject | null, ...keys: string[]): unknown {
  if (!object) return undefined;
  for (const key of keys) {
    if (key in object) return object[key];
  }
  return undefined;
}

function usageValues(value: unknown): UsageValues {
  const usage = asObject(value) ?? {};
  const inputTokens = numberValue(usage.input_tokens, usage.inputTokens, usage.input);
  const cachedInputTokens = numberValue(
    usage.cached_input_tokens,
    usage.cachedInputTokens,
    usage.cache_read_input_tokens,
    usage.cacheReadInputTokens,
  );
  const cacheWriteTokens = numberValue(
    usage.cache_write_input_tokens,
    usage.cacheWriteInputTokens,
    usage.cache_creation_input_tokens,
    usage.cacheCreationInputTokens,
  );
  const outputTokens = numberValue(usage.output_tokens, usage.outputTokens, usage.output);
  const reasoningTokens = numberValue(
    usage.reasoning_output_tokens,
    usage.reasoningOutputTokens,
    usage.reasoning_tokens,
    usage.reasoningTokens,
  );
  const totalTokens = numberValue(usage.total_tokens, usage.totalTokens, usage.total);

  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
  };
}

function callFromUsage(
  sessionId: string,
  callId: string | null,
  timestamp: string | null,
  model: string | null,
  provider: string | null,
  turnId: string | null,
  usage: UsageValues,
): ModelCallRecord {
  const totalTokens = usage.totalTokens ?? (
    usage.inputTokens !== null && usage.outputTokens !== null && usage.reasoningTokens !== null
      ? usage.inputTokens + usage.outputTokens + usage.reasoningTokens
      : null
  );
  const tokenProvenance = usage.totalTokens !== null ? "reported" : (
    totalTokens === null ? "unavailable" : "derived"
  );
  return {
    sessionId,
    callId,
    timestamp,
    provider,
    model,
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
    totalTokens,
    reportedCost: null,
    status: "ok",
    tokenProvenance,
    turnId,
  };
}

function normaliseCwd(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function sameCwd(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  return normaliseCwd(left) === normaliseCwd(right);
}

async function rolloutFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function visit(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
        found.push(fullPath);
      }
    }
  }
  await visit(root);
  return found.sort();
}

function recordPayload(record: JsonObject): JsonObject {
  return asObject(record.payload) ?? record;
}

function recordTimestamp(record: JsonObject, payload: JsonObject): string | null {
  return timestampValue(record.timestamp, record.time, payload.timestamp, payload.time);
}

function isType(record: JsonObject, payload: JsonObject, ...types: string[]): boolean {
  return types.some((type) => record.type === type || payload.type === type);
}

const knownCodexTypes = new Set([
  "session_meta", "session_metadata", "turn_context", "event_msg", "response_item", "token_count",
  "raw_response_completed", "raw_response_completed_event", "function_call", "function_call_output",
  "custom_tool_call", "custom_tool_call_output", "shell_command", "tool_call", "tool_result", "stream_error",
  "turn_aborted", "interrupted", "error", "compaction", "subagent", "skill", "skill_input", "skill_invocation", "skill_listing", "skill-listing",
]);

function accountingSensitiveCodexType(type: string): boolean {
  return /usage|token|response|assistant|message|tool|call|turn|retry|interrupt|compact|subagent|error/i.test(type);
}

function responseUsage(record: JsonObject, payload: JsonObject): { id: string | null; usage: UsageValues } | null {
  const event = firstObject(
    isType(record, payload, "raw_response_completed") ? payload : null,
    isType(record, payload, "raw_response_completed_event") ? payload : null,
    payload.event,
    record.event,
  );
  if (!event) return null;
  const eventType = stringValue(event.type, event.kind);
  if (eventType && eventType !== "raw_response_completed" && eventType !== "raw_response_completed_event") {
    return null;
  }
  const usage = usageValues(event.usage ?? event.token_usage ?? event.tokenUsage);
  const hasUsage = Object.values(usage).some((value) => value !== null);
  if (!hasUsage) return null;
  return {
    id: stringValue(event.response_id, event.responseId, event.id),
    usage,
  };
}

function tokenCountUsage(record: JsonObject, payload: JsonObject): {
  id: string | null;
  usage: UsageValues;
  isFinal: boolean;
} | null {
  if (!isType(record, payload, "token_count")) return null;
  const info = firstObject(payload.info, record.info) ?? payload;
  const last = info.last_token_usage ?? info.lastTokenUsage;
  const total = info.total_token_usage ?? info.totalTokenUsage;
  const usageValue = last ?? total;
  const usage = usageValues(usageValue);
  const hasUsage = Object.values(usage).some((value) => value !== null);
  if (!hasUsage) return null;
  return {
    id: stringValue(payload.response_id, payload.responseId, payload.call_id, payload.callId),
    usage,
    isFinal: last === undefined && total !== undefined,
  };
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

function toolEvent(record: JsonObject, payload: JsonObject): {
  kind: "call" | "result";
  callId: string;
  toolName: string;
  inputBytes: number | null;
  resultBytes: number | null;
  resultChars: number | null;
  isError: boolean | null;
} | null {
  const type = stringValue(payload.type, record.type)?.toLowerCase() ?? "";
  const callId = stringValue(payload.call_id, payload.callId, payload.tool_call_id, payload.toolCallId);
  if (!callId) return null;
  const isResult = type.includes("output") || type.includes("result") || type.includes("completed");
  const isCall = type.includes("function_call") || type.includes("custom_tool_call") || type.includes("tool_call") || type.includes("shell_command");
  if (!isCall && !isResult) return null;
  const toolName = stringValue(payload.name, payload.tool_name, payload.toolName) ?? "unknown-tool";
  const input = getNested(payload, "arguments", "input", "command", "query");
  const output = getNested(payload, "output", "result", "content", "stdout", "stderr");
  return {
    kind: isResult ? "result" : "call",
    callId,
    toolName,
    inputBytes: isResult ? null : byteLength(input),
    resultBytes: isResult ? byteLength(output) : null,
    resultChars: isResult ? characterLength(output) : null,
    isError: booleanValue(payload.is_error, payload.isError, payload.error),
  };
}

function sessionIdFor(file: string, fallbackIndex: number): string {
  const name = path.basename(file, ".jsonl");
  return name.startsWith("rollout-") && name.length > 8 ? name.slice(8) : `unknown-session-${fallbackIndex}`;
}

async function readSessionTitles(codexHome: string, warnings: string[]): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  let text: string;
  try {
    text = await readFile(path.join(codexHome, "session_index.jsonl"), "utf8");
  } catch {
    return titles;
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      warnings.push("A Codex Session title index record was malformed; that title was skipped.");
      continue;
    }
    const record = asObject(parsed);
    if (!record) {
      warnings.push("A Codex Session title index record was not an object; that title was skipped.");
      continue;
    }
    const sessionId = stringValue(record.id, record.session_id, record.sessionId);
    const title = stringValue(record.thread_name, record.threadName, record.title);
    if (sessionId && title) titles.set(sessionId, title);
  }
  return titles;
}

function updateSessionTimes(pending: PendingSession, timestamp: string | null): void {
  if (!timestamp) return;
  const milliseconds = Date.parse(timestamp);
  if (Number.isNaN(milliseconds)) return;
  pending.eventTimes.push(milliseconds);
  if (!pending.session.startedAt || Date.parse(pending.session.startedAt) > milliseconds) {
    pending.session.startedAt = timestamp;
  }
  if (!pending.session.endedAt || Date.parse(pending.session.endedAt) < milliseconds) {
    pending.session.endedAt = timestamp;
  }
}

function subagentSource(value: unknown): boolean | null {
  if (typeof value === "string") return value.toLowerCase() === "subagent";
  const source = asObject(value);
  if (!source) return null;
  if ("subagent" in source) return true;
  const kind = stringValue(source.type, source.kind);
  return kind ? kind.toLowerCase() === "subagent" : null;
}

function mergeSession(pending: PendingSession, payload: JsonObject, timestamp: string | null): void {
  const cwd = stringValue(payload.cwd, payload.project_cwd, payload.projectCwd);
  const parentSessionId = stringValue(payload.parent_thread_id, payload.parentThreadId, payload.forked_from_id, payload.forkedFromId);
  const sourceVersion = stringValue(payload.cli_version, payload.cliVersion, payload.source_version, payload.sourceVersion);
  if (cwd) pending.session.projectCwd = cwd;
  if (parentSessionId) pending.session.parentSessionId = parentSessionId;
  const isSubagent = subagentSource(payload.source);
  if (isSubagent !== null) pending.session.isSubagent = isSubagent;
  if (sourceVersion) pending.session.sourceVersion = sourceVersion;
  updateSessionTimes(pending, timestamp);
}

function selectedByScope(session: SessionRecord, eventTimes: number[], scope: ReadScope): boolean {
  if (!scope.allProjects && !sameCwd(session.projectCwd, scope.cwd)) return false;
  const since = scope.since.getTime();
  return eventTimes.some((time) => time >= since);
}

export async function readCodex(scope: ReadScope): Promise<ReadResult> {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const files = await rolloutFiles(path.join(codexHome, "sessions"));
  const coverage = {
    filesRead: 0,
    recordsRead: 0,
    recordsSkipped: 0,
    partialSessions: 0,
    warnings: [] as string[],
  };
  const pendingById = new Map<string, PendingSession>();
  let fallbackIndex = 0;
  const sessionTitles = await readSessionTitles(codexHome, coverage.warnings);

  for (const file of files) {
    coverage.filesRead += 1;
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      coverage.recordsSkipped += 1;
      coverage.warnings.push("A Codex rollout could not be read and was skipped.");
      continue;
    }
    const lines = text.split(/\r?\n/);
    const hadTrailingNewline = /\r?\n$/.test(text);
    if (hadTrailingNewline) lines.pop();
    let activeSessionId: string | null = null;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        coverage.recordsSkipped += 1;
        if (lineIndex === lines.length - 1 && !hadTrailingNewline) {
          const pending = activeSessionId ? pendingById.get(activeSessionId) : undefined;
          if (pending) {
            pending.partial = true;
            if (!pending.partialCoverageCounted) {
              coverage.partialSessions += 1;
              pending.partialCoverageCounted = true;
            }
          }
          else coverage.partialSessions += 1;
        }
        continue;
      }
      const record = asObject(parsed);
      if (!record) {
        coverage.recordsSkipped += 1;
        continue;
      }
      coverage.recordsRead += 1;
      const payload = recordPayload(record);
      const timestamp = recordTimestamp(record, payload);
      let sessionId: string | null = activeSessionId;
      if (isType(record, payload, "session_meta", "session_metadata")) {
        sessionId = stringValue(payload.id, payload.session_id, payload.sessionId, payload.thread_id, payload.threadId)
          ?? sessionIdFor(file, fallbackIndex++);
        activeSessionId = sessionId;
        if (!pendingById.has(sessionId)) {
          pendingById.set(sessionId, {
            session: {
              harness: "codex",
              sessionId,
              projectCwd: null,
              startedAt: null,
              endedAt: null,
              parentSessionId: null,
              sourceVersion: null,
            },
            eventTimes: [],
            rawCalls: [],
            incrementalCalls: [],
            finalTotal: null,
            toolCalls: [],
            lifecycle: [],
            currentModel: null,
            currentProvider: null,
            currentTurnId: null,
            skillEvidence: [],
            unsupported: false,
            missingTimestamp: false,
            partial: false,
            partialCoverageCounted: false,
          });
        }
        mergeSession(pendingById.get(sessionId)!, payload, timestamp);
      }
      if (!sessionId) {
        sessionId = activeSessionId ?? sessionIdFor(file, fallbackIndex++);
        activeSessionId = sessionId;
      }
      const pending: PendingSession = pendingById.get(sessionId) ?? {
        session: {
          harness: "codex",
          sessionId,
          projectCwd: null,
          startedAt: null,
          endedAt: null,
          parentSessionId: null,
          sourceVersion: null,
        },
        eventTimes: [],
        rawCalls: [],
        incrementalCalls: [],
        finalTotal: null,
        toolCalls: [],
        lifecycle: [],
        currentModel: null,
        currentProvider: null,
        currentTurnId: null,
        skillEvidence: [],
        unsupported: false,
        missingTimestamp: false,
        partial: false,
        partialCoverageCounted: false,
      };
      pendingById.set(sessionId, pending);
      updateSessionTimes(pending, timestamp);

      const recordType = stringValue(record.type)?.toLowerCase();
      const payloadType = stringValue(payload.type)?.toLowerCase();
      if ((recordType || payloadType) && !knownCodexTypes.has(recordType ?? "") && !knownCodexTypes.has(payloadType ?? "")) {
        coverage.recordsSkipped += 1;
        if (accountingSensitiveCodexType(recordType ?? payloadType ?? "")) {
          pending.unsupported = true;
          pending.partial = true;
          if (!timestamp) pending.missingTimestamp = true;
        }
        continue;
      }

      const sourceLocation = redactedSource(file);
      const evidenceTurnId = stringValue(payload.turn_id, payload.turnId) ?? pending.currentTurnId;
      const isListing = recordType === "skill-listing" || recordType === "skill_listing" || payloadType === "skill-listing" || payloadType === "skill_listing";
      const listingNames = listedSkillNames(
        record.available_skills,
        record.availableSkills,
        record.skill_listing,
        record.skillListing,
        record.skills,
        payload.available_skills,
        payload.availableSkills,
        payload.skill_listing,
        payload.skillListing,
        payload.skills,
      );
      for (const skillName of listingNames) pending.skillEvidence.push(skillRecord(sessionId, skillName, "available", "listing", evidenceTurnId, null, timestamp, sourceLocation, "reported"));
      const explicit = !isListing ? structuredSkillName(record, payload, payloadType ?? recordType ?? null) : null;
      if (explicit) {
        const evidenceId = stringValue(payload.call_id, payload.callId, payload.id, record.id);
        pending.skillEvidence.push(skillRecord(sessionId, explicit, "invoked", "explicit-input", evidenceTurnId, evidenceId, timestamp, sourceLocation, "reported"));
      }
      const pathCandidates = [
        payload.path,
        payload.file,
        payload.resource,
        payload.arguments,
        payload.command,
        payload.input,
        record.path,
        record.file,
        record.resource,
        record.command,
      ];
      for (const candidate of pathCandidates) {
        const pathEvidence = skillPathEvidence(candidate);
        if (!pathEvidence) continue;
        const evidenceId = stringValue(payload.call_id, payload.callId, payload.id, record.id);
        pending.skillEvidence.push(skillRecord(sessionId, pathEvidence.name, "invoked", pathEvidence.evidenceType, evidenceTurnId, evidenceId, timestamp, sourceLocation, "derived"));
      }

      if (isType(record, payload, "turn_context")) {
        mergeSession(pending, payload, timestamp);
        pending.currentModel = stringValue(payload.model, payload.model_name, payload.modelName) ?? pending.currentModel;
        pending.currentProvider = stringValue(payload.model_provider, payload.modelProvider, payload.provider) ?? pending.currentProvider;
        pending.currentTurnId = stringValue(payload.turn_id, payload.turnId) ?? pending.currentTurnId;
      }

      const model = stringValue(payload.model, payload.model_name, payload.modelName) ?? pending.currentModel;
      const provider = stringValue(payload.model_provider, payload.modelProvider, payload.provider) ?? pending.currentProvider;
      const response = responseUsage(record, payload);
      if (response) {
        const call = callFromUsage(
          sessionId,
          response.id,
          timestamp,
          model,
          provider,
          pending.currentTurnId,
          response.usage,
        );
        if (!call.timestamp) pending.missingTimestamp = true;
        const existingIndex = response.id
          ? pending.rawCalls.findIndex((candidate) => candidate.callId === response.id)
          : -1;
        if (existingIndex >= 0) {
          const existing = pending.rawCalls[existingIndex];
          if (existing.totalTokens === null && call.totalTokens !== null) pending.rawCalls[existingIndex] = call;
        } else {
          pending.rawCalls.push(call);
        }
      }

      const tokenCount = tokenCountUsage(record, payload);
      if (tokenCount) {
        const call = callFromUsage(
          sessionId,
          tokenCount.id,
          timestamp,
          model,
          provider,
          pending.currentTurnId,
          tokenCount.usage,
        );
        if (!call.timestamp) pending.missingTimestamp = true;
        if (tokenCount.isFinal) {
          pending.finalTotal = call;
        } else {
          const existingIndex = tokenCount.id
            ? pending.incrementalCalls.findIndex((candidate) => candidate.callId === tokenCount.id)
            : -1;
          if (existingIndex >= 0) {
            const existing = pending.incrementalCalls[existingIndex];
            if (existing.totalTokens === null && call.totalTokens !== null) pending.incrementalCalls[existingIndex] = call;
          } else {
            pending.incrementalCalls.push(call);
          }
        }
      }

      const tool = toolEvent(record, payload);
      if (tool) {
        if (!timestamp) pending.missingTimestamp = true;
        if (tool.kind === "call") {
          pending.toolCalls.push({
            sessionId,
            callId: tool.callId,
            timestamp,
            toolName: tool.toolName,
            inputBytes: tool.inputBytes,
            resultBytes: null,
            resultChars: null,
            isError: tool.isError,
          });
        } else {
          const existing = pending.toolCalls.find((candidate) => candidate.callId === tool.callId);
          if (existing) {
            existing.resultBytes = tool.resultBytes;
            existing.resultChars = tool.resultChars;
            existing.isError = tool.isError ?? existing.isError;
          } else {
            pending.toolCalls.push({
              sessionId,
              callId: tool.callId,
              timestamp,
              toolName: tool.toolName,
              inputBytes: null,
              resultBytes: tool.resultBytes,
              resultChars: tool.resultChars,
              isError: tool.isError,
            });
          }
        }
      }

      if (isType(record, payload, "event_msg")) {
        const eventType = stringValue(payload.type, payload.event_type, payload.eventType);
        if (eventType === "error" || eventType === "stream_error") {
          const last = pending.rawCalls[pending.rawCalls.length - 1] ?? pending.incrementalCalls[pending.incrementalCalls.length - 1];
          if (last) last.status = "error";
          pending.lifecycle.push({ sessionId, timestamp, kind: "retry", relatedId: last?.callId ?? null });
          if (!timestamp) pending.missingTimestamp = true;
        }
        if (eventType === "turn_aborted" || eventType === "interrupted") {
          const last = pending.rawCalls[pending.rawCalls.length - 1] ?? pending.incrementalCalls[pending.incrementalCalls.length - 1];
          if (last) last.status = "interrupted";
          pending.lifecycle.push({ sessionId, timestamp, kind: "interrupted", relatedId: last?.callId ?? null });
          if (!timestamp) pending.missingTimestamp = true;
        }
        if (eventType?.includes("subagent")) {
          pending.lifecycle.push({ sessionId, timestamp, kind: "subagent", relatedId: null });
          if (!timestamp) pending.missingTimestamp = true;
        }
        if (eventType?.includes("compaction")) {
          pending.lifecycle.push({ sessionId, timestamp, kind: "compaction", relatedId: null });
          if (!timestamp) pending.missingTimestamp = true;
        }
      }
    }
  }

  const sessions: SessionRecord[] = [];
  const modelCalls: ModelCallRecord[] = [];
  const toolCalls = [] as ReadResult["toolCalls"];
  const lifecycle = [] as ReadResult["lifecycle"];
  const skillEvidence = [] as NonNullable<ReadResult["skillEvidence"]>;
  let unsupportedSessions = 0;
  let missingTimestampSessions = 0;
  for (const pending of pendingById.values()) {
    pending.session.title = sessionTitles.get(pending.session.sessionId) ?? null;
    const partial = pending.partial || pending.unsupported || pending.missingTimestamp;
    pending.session.partial = partial;
    if (!selectedByScope(pending.session, pending.eventTimes, scope)) {
      if (pending.missingTimestamp && (scope.allProjects || sameCwd(pending.session.projectCwd, scope.cwd))) {
        coverage.partialSessions += 1;
        missingTimestampSessions += 1;
      }
      continue;
    }
    if (pending.unsupported) {
      unsupportedSessions += 1;
    }
    if (pending.missingTimestamp) {
      missingTimestampSessions += 1;
    }
    if (partial && !pending.partialCoverageCounted) {
      coverage.partialSessions += 1;
      pending.partialCoverageCounted = true;
    }
    sessions.push(pending.session);
    toolCalls.push(...pending.toolCalls.filter((tool) => tool.timestamp !== null && !Number.isNaN(Date.parse(tool.timestamp)) && Date.parse(tool.timestamp) >= scope.since.getTime()));
    lifecycle.push(...pending.lifecycle.filter((event) => event.timestamp !== null && !Number.isNaN(Date.parse(event.timestamp)) && Date.parse(event.timestamp) >= scope.since.getTime()));
    skillEvidence.push(...pending.skillEvidence.filter((record) => record.timestamp !== null && !Number.isNaN(Date.parse(record.timestamp)) && Date.parse(record.timestamp) >= scope.since.getTime()));
    const calls = pending.rawCalls.length > 0
      ? pending.rawCalls
      : pending.incrementalCalls.length > 0
        ? pending.incrementalCalls
        : pending.finalTotal
          ? [pending.finalTotal]
          : [];
    for (const call of calls) {
      if (!call.timestamp || Number.isNaN(Date.parse(call.timestamp)) || Date.parse(call.timestamp) < scope.since.getTime()) continue;
      modelCalls.push(call);
    }
  }

  if (unsupportedSessions > 0) {
    coverage.warnings.push(
      unsupportedSessions + " Codex Session" + (unsupportedSessions === 1 ? " contains" : "s contain") +
      " unsupported accounting records; only a partial audit is reported.",
    );
  }
  if (missingTimestampSessions > 0) {
    coverage.warnings.push(
      missingTimestampSessions + " Codex Session" + (missingTimestampSessions === 1 ? " contains" : "s contain") +
      " accounting records without a usable timestamp; only time-scoped records were analysed.",
    );
  }
  if (files.length === 0) coverage.warnings.push("No Codex rollout history was found for the selected scope.");
  return {
    sessions: sessions.sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
    modelCalls,
    lifecycle,
    toolCalls,
    skillEvidence,
    coverage,
  };
}
