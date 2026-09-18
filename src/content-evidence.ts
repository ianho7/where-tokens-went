import { readFile, readdir, stat } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  AuditResult,
  ContentEvidenceItem,
  ContentEvidencePacket,
  ContentEvidenceScope,
  ContentEvidenceSelection,
} from "./types";

type JsonObject = Record<string, unknown>;

export interface SessionFileLocation {
  sessionId: string;
  filePath: string;
}

interface EvidenceRequest {
  scope: ContentEvidenceScope;
  audit: AuditResult;
  selections: ContentEvidenceSelection[];
  maxItemsPerSession?: number;
  maxCharsPerItem?: number;
  sessionFiles?: SessionFileLocation[] | Map<string, string> | Record<string, string>;
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

function recordPayload(record: JsonObject): JsonObject {
  return objectValue(record.payload) ?? record;
}

function timestamp(record: JsonObject, payload: JsonObject): number | null {
  const value = stringValue(record.timestamp, record.time, payload.timestamp, payload.time);
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function inScope(time: number | null, scope: ContentEvidenceScope): boolean {
  if (time === null || time < scope.since.getTime()) return false;
  return scope.until === undefined || time < scope.until.getTime();
}

function normaliseCwd(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function sameCwd(left: string | null, right: string | null): boolean {
  return left !== null && right !== null && normaliseCwd(left) === normaliseCwd(right);
}

async function jsonlFiles(root: string, prefix?: string): Promise<string[]> {
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
      else if (entry.isFile() && entry.name.endsWith(".jsonl") && (!prefix || entry.name.startsWith(prefix))) files.push(fullPath);
    }
  }
  await visit(root);
  return files.sort();
}

function redactedContent(value: unknown, maxChars: number): { content: string; truncated: boolean } {
  let content: string;
  if (typeof value === "string") content = value;
  else {
    try { content = JSON.stringify(value); } catch { content = "[unserializable historical content]"; }
  }
  content = content
    .replace(/((?:api[_-]?key|access[_-]?token|password|secret|credential)\s*[:=]\s*["']?)[^\s,"'}]+/gi, "$1<redacted>")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer <redacted>");
  const truncated = Array.from(content).length > maxChars;
  return { content: truncated ? Array.from(content).slice(0, maxChars).join("") + "…" : content, truncated };
}

function contentValue(record: JsonObject, payload: JsonObject): unknown {
  const message = objectValue(payload.message) ?? objectValue(record.message);
  const item = objectValue(payload.item) ?? objectValue(payload.tool_item);
  return payload.text ?? payload.content ?? payload.output ?? payload.result ?? payload.command ?? message?.content ?? message?.text ?? item?.content ?? item?.output ?? item?.result ?? item?.text ?? item?.input ?? record.content ?? record.text;
}

function classify(record: JsonObject, payload: JsonObject): ContentEvidenceItem["kind"] {
  const item = objectValue(payload.item) ?? objectValue(payload.tool_item);
  const type = [record.type, payload.type, payload.item_type, payload.itemType, item?.type]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  const role = (stringValue(payload.role, objectValue(payload.message)?.role, objectValue(record.message)?.role, item?.role) ?? "").toLowerCase();
  if (role === "user" || type.includes("user")) return "user";
  if (role === "assistant" || type.includes("assistant") || type.includes("agent") || type.includes("response")) return "assistant";
  if (type.includes("tool") || type.includes("function") || type.includes("shell") || type.includes("command") || type.includes("result") || type.includes("output")) return "tool";
  return "metadata";
}

function stableIds(record: JsonObject, payload: JsonObject): { callId: string | null; turnId: string | null } {
  const item = objectValue(payload.item) ?? objectValue(payload.tool_item);
  return {
    callId: stringValue(payload.response_id, payload.responseId, payload.call_id, payload.callId, payload.tool_call_id, payload.toolCallId, payload.id, item?.id, item?.call_id, item?.callId),
    turnId: stringValue(payload.turn_id, payload.turnId, payload.task_id, payload.taskId, record.turn_id, record.turnId),
  };
}

function withinSelection(item: { turnId: string | null; callId: string | null }, selection: ContentEvidenceSelection): boolean {
  if (selection.callIds?.length && item.callId && selection.callIds.includes(item.callId)) return true;
  if (item.turnId && selection.turnIds.includes(item.turnId)) return true;
  return selection.turnIds.length === 1 && !selection.callIds?.length && item.turnId === null;
}

function packet(scope: ContentEvidenceScope, selection: ContentEvidenceSelection, items: ContentEvidenceItem[], warnings: string[]): ContentEvidencePacket {
  return {
    scope: {
      harness: scope.harness,
      cwd: scope.allProjects ? null : "<current-project>",
      allProjects: scope.allProjects,
      since: scope.since.toISOString(),
      ...(scope.until ? { until: scope.until.toISOString() } : {}),
    },
    sessionId: selection.sessionId,
    turnIds: [...selection.turnIds],
    selectionReason: selection.selectionReason,
    unreadScope: selection.unreadScope,
    items,
    warnings,
  };
}

function selectedSessionIds(audit: AuditResult): Set<string> {
  return new Set(audit.rankings.sessions.slice(0, 3).map((entry) => entry.key));
}

function validateRequest(request: EvidenceRequest): void {
  const { audit, scope, selections } = request;
  if (audit.scope.harness !== scope.harness) throw new Error("Content Evidence Harness does not match the originating Audit Scope.");
  if (audit.scope.allProjects !== scope.allProjects) throw new Error("Content Evidence project scope does not match the originating Audit Scope.");
  if (Date.parse(audit.scope.since) !== scope.since.getTime()) throw new Error("Content Evidence time range does not match the originating Audit Scope.");
  if (audit.scope.until !== undefined || scope.until !== undefined) {
    if (audit.scope.until === undefined || scope.until?.getTime() !== Date.parse(audit.scope.until)) throw new Error("Content Evidence upper time boundary does not match the originating Audit Scope.");
  }
  const allowed = selectedSessionIds(audit);
  const auditedTurns = new Map<string, Set<string>>();
  for (const turn of audit.turns ?? []) auditedTurns.set(turn.sessionId, new Set([...(auditedTurns.get(turn.sessionId) ?? []), turn.turnId]));
  if (selections.length === 0 || selections.length > 3) throw new Error("Content Evidence accepts one to three selected Sessions.");
  const seen = new Set<string>();
  for (const selection of selections) {
    if (!allowed.has(selection.sessionId)) throw new Error("Content Evidence Session is outside the Token-ranked Top 3.");
    if (seen.has(selection.sessionId)) throw new Error("Content Evidence cannot select the same Session twice.");
    if (selection.turnIds.length === 0 || selection.turnIds.length > 12) throw new Error("Content Evidence requires one to twelve selected Turn identifiers per Session.");
    if (selection.turnIds.some((turnId) => !auditedTurns.get(selection.sessionId)?.has(turnId))) throw new Error("Content Evidence Turn is outside the originating Session or Audit Scope.");
    seen.add(selection.sessionId);
  }
}

function getSessionFilePath(request: EvidenceRequest, sessionId: string): string | null {
  if (!request.sessionFiles) return null;
  if (request.sessionFiles instanceof Map) {
    return request.sessionFiles.get(sessionId) ?? null;
  }
  if (Array.isArray(request.sessionFiles)) {
    const entry = request.sessionFiles.find((s) => s.sessionId === sessionId);
    return entry?.filePath ?? null;
  }
  return (request.sessionFiles as Record<string, string>)[sessionId] ?? null;
}

async function resolveDirectFiles(root: string, request: EvidenceRequest): Promise<string[] | null> {
  if (!request.sessionFiles || request.selections.length === 0) return null;
  const candidateFiles: string[] = [];
  for (const selection of request.selections) {
    const rawPath = getSessionFilePath(request, selection.sessionId);
    if (!rawPath) return null;
    const candidates = [
      rawPath,
      path.isAbsolute(rawPath) ? rawPath : path.resolve(root, rawPath),
      path.isAbsolute(rawPath) ? rawPath : path.resolve(root, "..", rawPath),
    ];
    let resolved: string | null = null;
    for (const c of candidates) {
      try {
        const info = await stat(c);
        if (info.isFile()) {
          resolved = c;
          break;
        }
      } catch {}
    }
    if (resolved) {
      candidateFiles.push(resolved);
    } else {
      return null;
    }
  }
  return [...new Set(candidateFiles)];
}

async function readCodexEvidence(request: EvidenceRequest): Promise<ContentEvidencePacket[]> {
  const root = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const directFiles = await resolveDirectFiles(path.join(root, "sessions"), request);
  const files = directFiles ?? await jsonlFiles(path.join(root, "sessions"), "rollout-");
  const selections = new Map(request.selections.map((selection) => [selection.sessionId, selection]));
  const items = new Map<string, ContentEvidenceItem[]>();
  const warnings = new Map<string, string[]>();
  const cwdBySession = new Map<string, string | null>();
  const scopeRejected = new Set<string>();
  for (const file of files) {
    let text: string;
    try { text = await readFile(file, "utf8"); } catch { continue; }
    const lines = text.split(/\r?\n/);
    let activeSessionId: string | null = null;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      if (!lines[lineIndex].trim()) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(lines[lineIndex]); } catch { continue; }
      const record = objectValue(parsed);
      if (!record) continue;
      const payload = recordPayload(record);
      const type = (stringValue(record.type, payload.type) ?? "").toLowerCase();
      const explicitSessionId = stringValue(record.session_id, record.sessionId, payload.session_id, payload.sessionId, payload.thread_id, payload.threadId);
      if (type === "session_meta" || type === "session_metadata") {
        activeSessionId = activeSessionId ?? stringValue(payload.id, payload.session_id, payload.sessionId, payload.thread_id, payload.threadId) ?? explicitSessionId;
        if (activeSessionId) cwdBySession.set(activeSessionId, stringValue(payload.cwd, payload.project_cwd, payload.projectCwd));
      }
      const sessionId = activeSessionId ?? explicitSessionId;
      if (!sessionId || !selections.has(sessionId)) continue;
      const selection = selections.get(sessionId)!;
      const sessionCwd = cwdBySession.get(sessionId) ?? stringValue(payload.cwd, payload.project_cwd, payload.projectCwd);
      if (!request.scope.allProjects && !sameCwd(sessionCwd, request.scope.cwd)) {
        scopeRejected.add(sessionId);
        continue;
      }
      const eventTime = timestamp(record, payload);
      if (!inScope(eventTime, request.scope)) continue;
      const ids = stableIds(record, payload);
      if (!withinSelection(ids, selection)) continue;
      const value = contentValue(record, payload);
      if (value === undefined) continue;
      const result = redactedContent(value, request.maxCharsPerItem ?? 1200);
      const list = items.get(sessionId) ?? [];
      if (list.length >= (request.maxItemsPerSession ?? 24)) continue;
      list.push({ sessionId, turnId: ids.turnId, callId: ids.callId, kind: classify(record, payload), sourceLocation: "rollout:" + path.basename(file, ".jsonl") + "#" + (lineIndex + 1), ...result, untrusted: true });
      items.set(sessionId, list);
    }
  }
  if (scopeRejected.size > 0) throw new Error("Content Evidence Session is outside the originating project scope.");
  return request.selections.map((selection) => packet(request.scope, selection, items.get(selection.sessionId) ?? [], warnings.get(selection.sessionId) ?? []));
}

async function readClaudeEvidence(request: EvidenceRequest): Promise<ContentEvidencePacket[]> {
  const root = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const directFiles = await resolveDirectFiles(path.join(root, "projects"), request);
  const files = directFiles ?? await jsonlFiles(path.join(root, "projects"));
  const selections = new Map(request.selections.map((selection) => [selection.sessionId, selection]));
  const packets = new Map<string, ContentEvidenceItem[]>();
  const scopeRejected = new Set<string>();
  for (const file of files) {
    let text: string;
    try { text = await readFile(file, "utf8"); } catch { continue; }
    const lines = text.split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      if (!lines[lineIndex].trim()) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(lines[lineIndex]); } catch { continue; }
      const record = objectValue(parsed);
      if (!record) continue;
      const payload = objectValue(record.message) ?? record;
      const sessionId = stringValue(record.session_id, record.sessionId, payload.session_id, payload.sessionId);
      if (!sessionId || !selections.has(sessionId)) continue;
      const selection = selections.get(sessionId)!;
      const sessionCwd = stringValue(record.cwd, record.project_cwd, record.projectCwd, payload.cwd);
      if (!request.scope.allProjects && !sameCwd(sessionCwd, request.scope.cwd)) {
        scopeRejected.add(sessionId);
        continue;
      }
      const eventTime = timestamp(record, payload);
      if (!inScope(eventTime, request.scope)) continue;
      const ids = stableIds(record, payload);
      if (!withinSelection(ids, selection) && !(selection.turnIds.length === 1 && !selection.callIds?.length && (stringValue(record.type) === "user" || stringValue(payload.role) === "user" || stringValue(record.type) === "assistant" || stringValue(payload.role) === "assistant"))) continue;
      const value = contentValue(record, payload);
      if (value === undefined) continue;
      const result = redactedContent(value, request.maxCharsPerItem ?? 1200);
      const list = packets.get(sessionId) ?? [];
      if (list.length >= (request.maxItemsPerSession ?? 24)) continue;
      list.push({ sessionId, turnId: ids.turnId, callId: ids.callId, kind: classify(record, payload), sourceLocation: "transcript:" + path.basename(file, ".jsonl") + "#" + (lineIndex + 1), ...result, untrusted: true });
      packets.set(sessionId, list);
    }
  }
  if (scopeRejected.size > 0) throw new Error("Content Evidence Session is outside the originating project scope.");
  return request.selections.map((selection) => packet(request.scope, selection, packets.get(selection.sessionId) ?? [], []));
}

export async function readContentEvidence(request: EvidenceRequest): Promise<ContentEvidencePacket[]> {
  validateRequest(request);
  return request.scope.harness === "codex" ? readCodexEvidence(request) : readClaudeEvidence(request);
}

export type { EvidenceRequest as ContentEvidenceRequest };
