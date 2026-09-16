"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.readContentEvidence = readContentEvidence;
const promises_1 = require("node:fs/promises");
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
function objectValue(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function stringValue(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim())
            return value;
        if (typeof value === "number" && Number.isFinite(value))
            return String(value);
    }
    return null;
}
function recordPayload(record) {
    return objectValue(record.payload) ?? record;
}
function timestamp(record, payload) {
    const value = stringValue(record.timestamp, record.time, payload.timestamp, payload.time);
    if (!value)
        return null;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
}
function normaliseCwd(value) {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
function sameCwd(left, right) {
    return left !== null && right !== null && normaliseCwd(left) === normaliseCwd(right);
}
async function jsonlFiles(root, prefix) {
    const files = [];
    async function visit(directory) {
        let entries;
        try {
            entries = await (0, promises_1.readdir)(directory, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const fullPath = path.join(directory, entry.name);
            if (entry.isDirectory())
                await visit(fullPath);
            else if (entry.isFile() && entry.name.endsWith(".jsonl") && (!prefix || entry.name.startsWith(prefix)))
                files.push(fullPath);
        }
    }
    await visit(root);
    return files.sort();
}
function redactedContent(value, maxChars) {
    let content;
    if (typeof value === "string")
        content = value;
    else {
        try {
            content = JSON.stringify(value);
        }
        catch {
            content = "[unserializable historical content]";
        }
    }
    content = content
        .replace(/((?:api[_-]?key|access[_-]?token|password|secret|credential)\s*[:=]\s*["']?)[^\s,"'}]+/gi, "$1<redacted>")
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer <redacted>");
    const truncated = Array.from(content).length > maxChars;
    return { content: truncated ? Array.from(content).slice(0, maxChars).join("") + "…" : content, truncated };
}
function contentValue(record, payload) {
    const message = objectValue(payload.message) ?? objectValue(record.message);
    const item = objectValue(payload.item) ?? objectValue(payload.tool_item);
    return payload.text ?? payload.content ?? payload.output ?? payload.result ?? payload.command ?? message?.content ?? message?.text ?? item?.content ?? item?.output ?? item?.result ?? item?.text ?? item?.input ?? record.content ?? record.text;
}
function classify(record, payload) {
    const item = objectValue(payload.item) ?? objectValue(payload.tool_item);
    const type = [record.type, payload.type, payload.item_type, payload.itemType, item?.type]
        .filter((value) => typeof value === "string")
        .join(" ")
        .toLowerCase();
    const role = (stringValue(payload.role, objectValue(payload.message)?.role, objectValue(record.message)?.role, item?.role) ?? "").toLowerCase();
    if (role === "user" || type.includes("user"))
        return "user";
    if (role === "assistant" || type.includes("assistant") || type.includes("agent") || type.includes("response"))
        return "assistant";
    if (type.includes("tool") || type.includes("function") || type.includes("shell") || type.includes("command") || type.includes("result") || type.includes("output"))
        return "tool";
    return "metadata";
}
function stableIds(record, payload) {
    const item = objectValue(payload.item) ?? objectValue(payload.tool_item);
    return {
        callId: stringValue(payload.response_id, payload.responseId, payload.call_id, payload.callId, payload.tool_call_id, payload.toolCallId, payload.id, item?.id, item?.call_id, item?.callId),
        turnId: stringValue(payload.turn_id, payload.turnId, payload.task_id, payload.taskId, record.turn_id, record.turnId),
    };
}
function withinSelection(item, selection) {
    if (selection.callIds?.length && item.callId && selection.callIds.includes(item.callId))
        return true;
    if (item.turnId && selection.turnIds.includes(item.turnId))
        return true;
    return selection.turnIds.length === 1 && !selection.callIds?.length && item.turnId === null;
}
function packet(scope, selection, items, warnings) {
    return {
        scope: { harness: scope.harness, cwd: scope.allProjects ? null : "<current-project>", allProjects: scope.allProjects, since: scope.since.toISOString() },
        sessionId: selection.sessionId,
        turnIds: [...selection.turnIds],
        selectionReason: selection.selectionReason,
        unreadScope: selection.unreadScope,
        items,
        warnings,
    };
}
function selectedSessionIds(audit) {
    return new Set(audit.rankings.sessions.slice(0, 3).map((entry) => entry.key));
}
function validateRequest(request) {
    const { audit, scope, selections } = request;
    if (audit.scope.harness !== scope.harness)
        throw new Error("Content Evidence Harness does not match the originating Audit Scope.");
    if (audit.scope.allProjects !== scope.allProjects)
        throw new Error("Content Evidence project scope does not match the originating Audit Scope.");
    if (Date.parse(audit.scope.since) !== scope.since.getTime())
        throw new Error("Content Evidence time range does not match the originating Audit Scope.");
    const allowed = selectedSessionIds(audit);
    const auditedTurns = new Map();
    for (const turn of audit.turns ?? [])
        auditedTurns.set(turn.sessionId, new Set([...(auditedTurns.get(turn.sessionId) ?? []), turn.turnId]));
    if (selections.length === 0 || selections.length > 3)
        throw new Error("Content Evidence accepts one to three selected Sessions.");
    const seen = new Set();
    for (const selection of selections) {
        if (!allowed.has(selection.sessionId))
            throw new Error("Content Evidence Session is outside the Token-ranked Top 3.");
        if (seen.has(selection.sessionId))
            throw new Error("Content Evidence cannot select the same Session twice.");
        if (selection.turnIds.length === 0 || selection.turnIds.length > 12)
            throw new Error("Content Evidence requires one to twelve selected Turn identifiers per Session.");
        if (selection.turnIds.some((turnId) => !auditedTurns.get(selection.sessionId)?.has(turnId)))
            throw new Error("Content Evidence Turn is outside the originating Session or Audit Scope.");
        seen.add(selection.sessionId);
    }
}
async function readCodexEvidence(request) {
    const root = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
    const files = await jsonlFiles(path.join(root, "sessions"), "rollout-");
    const selections = new Map(request.selections.map((selection) => [selection.sessionId, selection]));
    const items = new Map();
    const warnings = new Map();
    const cwdBySession = new Map();
    const scopeRejected = new Set();
    for (const file of files) {
        let text;
        try {
            text = await (0, promises_1.readFile)(file, "utf8");
        }
        catch {
            continue;
        }
        const lines = text.split(/\r?\n/);
        let activeSessionId = null;
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
            if (!lines[lineIndex].trim())
                continue;
            let parsed;
            try {
                parsed = JSON.parse(lines[lineIndex]);
            }
            catch {
                continue;
            }
            const record = objectValue(parsed);
            if (!record)
                continue;
            const payload = recordPayload(record);
            const type = (stringValue(record.type, payload.type) ?? "").toLowerCase();
            const explicitSessionId = stringValue(record.session_id, record.sessionId, payload.session_id, payload.sessionId, payload.thread_id, payload.threadId);
            if (type === "session_meta" || type === "session_metadata") {
                activeSessionId = activeSessionId ?? stringValue(payload.id, payload.session_id, payload.sessionId, payload.thread_id, payload.threadId) ?? explicitSessionId;
                if (activeSessionId)
                    cwdBySession.set(activeSessionId, stringValue(payload.cwd, payload.project_cwd, payload.projectCwd));
            }
            const sessionId = activeSessionId ?? explicitSessionId;
            if (!sessionId || !selections.has(sessionId))
                continue;
            const selection = selections.get(sessionId);
            const sessionCwd = cwdBySession.get(sessionId) ?? stringValue(payload.cwd, payload.project_cwd, payload.projectCwd);
            if (!request.scope.allProjects && !sameCwd(sessionCwd, request.scope.cwd)) {
                scopeRejected.add(sessionId);
                continue;
            }
            const eventTime = timestamp(record, payload);
            if (eventTime === null || eventTime < request.scope.since.getTime())
                continue;
            const ids = stableIds(record, payload);
            if (!withinSelection(ids, selection))
                continue;
            const value = contentValue(record, payload);
            if (value === undefined)
                continue;
            const result = redactedContent(value, request.maxCharsPerItem ?? 1200);
            const list = items.get(sessionId) ?? [];
            if (list.length >= (request.maxItemsPerSession ?? 24))
                continue;
            list.push({ sessionId, turnId: ids.turnId, callId: ids.callId, kind: classify(record, payload), sourceLocation: "rollout:" + path.basename(file, ".jsonl") + "#" + (lineIndex + 1), ...result, untrusted: true });
            items.set(sessionId, list);
        }
    }
    if (scopeRejected.size > 0)
        throw new Error("Content Evidence Session is outside the originating project scope.");
    return request.selections.map((selection) => packet(request.scope, selection, items.get(selection.sessionId) ?? [], warnings.get(selection.sessionId) ?? []));
}
async function readClaudeEvidence(request) {
    const root = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
    const files = await jsonlFiles(path.join(root, "projects"));
    const selections = new Map(request.selections.map((selection) => [selection.sessionId, selection]));
    const packets = new Map();
    const scopeRejected = new Set();
    for (const file of files) {
        let text;
        try {
            text = await (0, promises_1.readFile)(file, "utf8");
        }
        catch {
            continue;
        }
        const lines = text.split(/\r?\n/);
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
            if (!lines[lineIndex].trim())
                continue;
            let parsed;
            try {
                parsed = JSON.parse(lines[lineIndex]);
            }
            catch {
                continue;
            }
            const record = objectValue(parsed);
            if (!record)
                continue;
            const payload = objectValue(record.message) ?? record;
            const sessionId = stringValue(record.session_id, record.sessionId, payload.session_id, payload.sessionId);
            if (!sessionId || !selections.has(sessionId))
                continue;
            const selection = selections.get(sessionId);
            const sessionCwd = stringValue(record.cwd, record.project_cwd, record.projectCwd, payload.cwd);
            if (!request.scope.allProjects && !sameCwd(sessionCwd, request.scope.cwd)) {
                scopeRejected.add(sessionId);
                continue;
            }
            const eventTime = timestamp(record, payload);
            if (eventTime === null || eventTime < request.scope.since.getTime())
                continue;
            const ids = stableIds(record, payload);
            if (!withinSelection(ids, selection) && !(selection.turnIds.length === 1 && !selection.callIds?.length && (stringValue(record.type) === "user" || stringValue(payload.role) === "user" || stringValue(record.type) === "assistant" || stringValue(payload.role) === "assistant")))
                continue;
            const value = contentValue(record, payload);
            if (value === undefined)
                continue;
            const result = redactedContent(value, request.maxCharsPerItem ?? 1200);
            const list = packets.get(sessionId) ?? [];
            if (list.length >= (request.maxItemsPerSession ?? 24))
                continue;
            list.push({ sessionId, turnId: ids.turnId, callId: ids.callId, kind: classify(record, payload), sourceLocation: "transcript:" + path.basename(file, ".jsonl") + "#" + (lineIndex + 1), ...result, untrusted: true });
            packets.set(sessionId, list);
        }
    }
    if (scopeRejected.size > 0)
        throw new Error("Content Evidence Session is outside the originating project scope.");
    return request.selections.map((selection) => packet(request.scope, selection, packets.get(selection.sessionId) ?? [], []));
}
async function readContentEvidence(request) {
    validateRequest(request);
    return request.scope.harness === "codex" ? readCodexEvidence(request) : readClaudeEvidence(request);
}
