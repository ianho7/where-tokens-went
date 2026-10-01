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
exports.selectSessionTurns = selectSessionTurns;
exports.selectAutoEvidence = selectAutoEvidence;
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
function inScope(time, scope) {
    if (time === null || time < scope.since.getTime())
        return false;
    return scope.until === undefined || time < scope.until.getTime();
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
function truncateUtf16(content, maxChars) {
    if (content.length <= maxChars) {
        return { content, truncated: false };
    }
    const ellipsis = "…";
    let limit = Math.max(0, maxChars - ellipsis.length);
    if (limit > 0) {
        const code = content.charCodeAt(limit - 1);
        if (code >= 0xd800 && code <= 0xdbff) {
            limit -= 1;
        }
    }
    return {
        content: content.slice(0, limit) + ellipsis,
        truncated: true,
    };
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
    return truncateUtf16(content, maxChars);
}
function contentValue(record, payload) {
    const message = objectValue(payload.message) ?? objectValue(record.message);
    const item = objectValue(payload.item) ?? objectValue(payload.tool_item);
    return payload.text ?? payload.content ?? payload.output ?? payload.result ?? payload.command ?? message?.content ?? message?.text ?? item?.content ?? item?.output ?? item?.result ?? item?.text ?? item?.input ?? record.content ?? record.text;
}
function classify(record, payload) {
    const item = objectValue(payload.item) ?? objectValue(payload.tool_item);
    const payloadType = stringValue(payload.type, payload.item_type, payload.itemType, item?.type)?.toLowerCase() ?? "";
    const recordType = stringValue(record.type)?.toLowerCase() ?? "";
    // 1. 先检查 payload 的实际形态是否为工具调用或输出
    const isToolPayload = payloadType.includes("function") ||
        payloadType.includes("tool") ||
        payloadType.includes("shell") ||
        payloadType.includes("command") ||
        payloadType.includes("action") ||
        payloadType.includes("output") ||
        payloadType.includes("result") ||
        payloadType === "call" ||
        stringValue(payload.call_id, payload.callId, payload.tool_call_id, payload.toolCallId) !== null;
    if (isToolPayload && payloadType !== "message") {
        return "tool";
    }
    // 2. message 按 role 分类
    const role = (stringValue(payload.role, objectValue(payload.message)?.role, objectValue(record.message)?.role, item?.role) ?? "").toLowerCase();
    if (role === "user" || payloadType === "user" || recordType === "user")
        return "user";
    if (role === "assistant" || payloadType === "assistant" || recordType === "assistant" || payloadType.includes("agent") || payloadType.includes("reasoning"))
        return "assistant";
    if (role === "tool")
        return "tool";
    // 3. 兜底检查 recordType
    if (recordType.includes("tool") ||
        recordType.includes("function") ||
        recordType.includes("shell") ||
        recordType.includes("command")) {
        return "tool";
    }
    return "metadata";
}
function stableIds(record, payload) {
    const item = objectValue(payload.item) ?? objectValue(payload.tool_item);
    return {
        callId: stringValue(payload.response_id, payload.responseId, payload.call_id, payload.callId, payload.tool_call_id, payload.toolCallId, payload.id, item?.id, item?.call_id, item?.callId),
        turnId: stringValue(payload.turn_id, payload.turnId, payload.task_id, payload.taskId, record.turn_id, record.turnId),
    };
}
function buildCallTurnMap(audit) {
    const map = new Map();
    const auditAny = audit;
    const toolCalls = Array.isArray(auditAny.toolCalls) ? auditAny.toolCalls : [];
    for (const tc of toolCalls) {
        if (tc.sessionId && tc.callId && tc.turnId) {
            map.set(`${tc.sessionId}:${tc.callId}`, tc.turnId);
        }
    }
    const modelCalls = Array.isArray(auditAny.modelCalls) ? auditAny.modelCalls : [];
    for (const mc of modelCalls) {
        if (mc.sessionId && mc.callId && mc.turnId) {
            map.set(`${mc.sessionId}:${mc.callId}`, mc.turnId);
        }
    }
    return map;
}
function allocateSessionItems(selection, candidates, audit, maxItems, maxCharsPerItem, hadUnattributed) {
    const itemsByTurn = new Map();
    for (const turnId of selection.turnIds) {
        itemsByTurn.set(turnId, []);
    }
    for (const item of candidates) {
        if (item.turnId && itemsByTurn.has(item.turnId)) {
            itemsByTurn.get(item.turnId).push(item);
        }
    }
    const allocatedItems = [];
    const usedItems = new Set();
    // Phase 1: 每个已选 Turn 的第一条 user 消息
    for (const turnId of selection.turnIds) {
        if (allocatedItems.length >= maxItems)
            break;
        const turnItems = itemsByTurn.get(turnId) ?? [];
        const firstUser = turnItems.find((it) => it.kind === "user" && !usedItems.has(it));
        if (firstUser) {
            allocatedItems.push(firstUser);
            usedItems.add(firstUser);
        }
    }
    // Phase 2: 每个已选 Turn 的第一条 tool 或 assistant 结果
    for (const turnId of selection.turnIds) {
        if (allocatedItems.length >= maxItems)
            break;
        const turnItems = itemsByTurn.get(turnId) ?? [];
        const firstToolOrAssistant = turnItems.find((it) => (it.kind === "tool" || it.kind === "assistant") && !usedItems.has(it));
        if (firstToolOrAssistant) {
            allocatedItems.push(firstToolOrAssistant);
            usedItems.add(firstToolOrAssistant);
        }
    }
    // Phase 3: 按已选 Turn 时间顺序轮流补项直至 maxItems
    let addedInRound = true;
    while (allocatedItems.length < maxItems && addedInRound) {
        addedInRound = false;
        for (const turnId of selection.turnIds) {
            if (allocatedItems.length >= maxItems)
                break;
            const turnItems = itemsByTurn.get(turnId) ?? [];
            const nextItem = turnItems.find((it) => !usedItems.has(it));
            if (nextItem) {
                allocatedItems.push(nextItem);
                usedItems.add(nextItem);
                addedInRound = true;
            }
        }
    }
    const warnings = [];
    if (hadUnattributed) {
        warnings.push("CONTENT_TURN_UNAVAILABLE: Unattributed content item could not be reliably associated with any Turn");
    }
    for (const turnId of selection.turnIds) {
        const turnItems = itemsByTurn.get(turnId) ?? [];
        if (turnItems.length === 0) {
            warnings.push(`Turn ${turnId} has no recorded content in rollout transcript`);
        }
        else if (!turnItems.some((it) => it.kind === "user")) {
            warnings.push(`Turn ${turnId} is missing initial user context message`);
        }
    }
    const truncatedCount = allocatedItems.filter((it) => it.truncated).length;
    if (truncatedCount > 0) {
        warnings.push(`${truncatedCount} content item(s) truncated to ${maxCharsPerItem} UTF-16 code units`);
    }
    if (candidates.length > allocatedItems.length) {
        const omittedCount = candidates.length - allocatedItems.length;
        warnings.push(`${omittedCount} content items omitted due to session budget limit (${maxItems} items)`);
    }
    const totalSessionTurns = (audit.turns ?? []).filter((t) => t.sessionId === selection.sessionId).length;
    if (totalSessionTurns > selection.turnIds.length) {
        const unreadTurns = totalSessionTurns - selection.turnIds.length;
        warnings.push(`${unreadTurns} Turns in session remained unread outside selection budget`);
    }
    if (allocatedItems.length === 0) {
        warnings.push("CONTENT_MISSING: No content items could be found or allocated for selected Turns");
    }
    return { items: allocatedItems, warnings };
}
function packet(scope, selection, items, warnings) {
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
    if (audit.scope.until !== undefined || scope.until !== undefined) {
        if (audit.scope.until === undefined || scope.until?.getTime() !== Date.parse(audit.scope.until))
            throw new Error("Content Evidence upper time boundary does not match the originating Audit Scope.");
    }
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
function getSessionFilePath(request, sessionId) {
    if (!request.sessionFiles)
        return null;
    if (request.sessionFiles instanceof Map) {
        return request.sessionFiles.get(sessionId) ?? null;
    }
    if (Array.isArray(request.sessionFiles)) {
        const entry = request.sessionFiles.find((s) => s.sessionId === sessionId);
        return entry?.filePath ?? null;
    }
    return request.sessionFiles[sessionId] ?? null;
}
async function resolveDirectFiles(root, request) {
    if (!request.sessionFiles || request.selections.length === 0)
        return null;
    const candidateFiles = [];
    for (const selection of request.selections) {
        const rawPath = getSessionFilePath(request, selection.sessionId);
        if (!rawPath)
            return null;
        const candidates = [
            rawPath,
            path.isAbsolute(rawPath) ? rawPath : path.resolve(root, rawPath),
            path.isAbsolute(rawPath) ? rawPath : path.resolve(root, "..", rawPath),
        ];
        let resolved = null;
        for (const c of candidates) {
            try {
                const info = await (0, promises_1.stat)(c);
                if (info.isFile()) {
                    resolved = c;
                    break;
                }
            }
            catch { }
        }
        if (resolved) {
            candidateFiles.push(resolved);
        }
        else {
            return null;
        }
    }
    return [...new Set(candidateFiles)];
}
async function readCodexEvidence(request) {
    const root = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
    const directFiles = await resolveDirectFiles(path.join(root, "sessions"), request);
    const files = directFiles ?? (await jsonlFiles(path.join(root, "sessions"), "rollout-"));
    const selections = new Map(request.selections.map((selection) => [selection.sessionId, selection]));
    const callTurnMap = buildCallTurnMap(request.audit);
    const rawCandidatesBySession = new Map();
    const unattributedBySession = new Map();
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
        let currentTurnId = null;
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
            const recordType = (stringValue(record.type) ?? "").toLowerCase();
            const payloadType = (stringValue(payload.type, payload.event_type, payload.eventType, payload.item_type, payload.itemType) ?? "").toLowerCase();
            const explicitSessionId = stringValue(record.session_id, record.sessionId, payload.session_id, payload.sessionId, payload.thread_id, payload.threadId);
            if (recordType === "session_meta" ||
                recordType === "session_metadata" ||
                payloadType === "session_meta" ||
                payloadType === "session_metadata") {
                activeSessionId =
                    activeSessionId ??
                        stringValue(payload.id, payload.session_id, payload.sessionId, payload.thread_id, payload.threadId) ??
                        explicitSessionId;
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
            if (!inScope(eventTime, request.scope))
                continue;
            if (recordType === "turn_context" ||
                payloadType === "turn_context" ||
                recordType.includes("turn_context") ||
                payloadType.includes("turn_context")) {
                currentTurnId = stringValue(payload.turn_id, payload.turnId, record.turn_id, record.turnId) ?? currentTurnId;
            }
            else if (recordType === "task_started" ||
                payloadType === "task_started" ||
                recordType.includes("task_started") ||
                payloadType.includes("task_started")) {
                currentTurnId =
                    stringValue(payload.turn_id, payload.turnId, payload.task_id, payload.taskId, payload.id, record.turn_id, record.turnId) ??
                        currentTurnId;
            }
            const ids = stableIds(record, payload);
            if (ids.callId && (ids.turnId ?? currentTurnId)) {
                callTurnMap.set(`${sessionId}:${ids.callId}`, (ids.turnId ?? currentTurnId));
            }
            const value = contentValue(record, payload);
            if (value === undefined)
                continue;
            const resolvedTurnId = ids.turnId ??
                currentTurnId ??
                (ids.callId ? callTurnMap.get(`${sessionId}:${ids.callId}`) : null) ??
                null;
            if (!resolvedTurnId) {
                unattributedBySession.set(sessionId, true);
                continue;
            }
            if (!selection.turnIds.includes(resolvedTurnId)) {
                continue;
            }
            const maxChars = request.maxCharsPerItem ?? 1200;
            const result = redactedContent(value, maxChars);
            const item = {
                sessionId,
                turnId: resolvedTurnId,
                callId: ids.callId,
                kind: classify(record, payload),
                sourceLocation: "rollout:" + path.basename(file, ".jsonl") + "#" + (lineIndex + 1),
                ...result,
                untrusted: true,
            };
            const list = rawCandidatesBySession.get(sessionId) ?? [];
            list.push(item);
            rawCandidatesBySession.set(sessionId, list);
        }
    }
    if (scopeRejected.size > 0)
        throw new Error("Content Evidence Session is outside the originating project scope.");
    const maxItems = request.maxItemsPerSession ?? 24;
    const maxChars = request.maxCharsPerItem ?? 1200;
    return request.selections.map((selection) => {
        const candidates = rawCandidatesBySession.get(selection.sessionId) ?? [];
        const hadUnattributed = unattributedBySession.get(selection.sessionId) ?? false;
        const { items, warnings } = allocateSessionItems(selection, candidates, request.audit, maxItems, maxChars, hadUnattributed);
        return packet(request.scope, selection, items, warnings);
    });
}
async function readClaudeEvidence(request) {
    const root = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
    const directFiles = await resolveDirectFiles(path.join(root, "projects"), request);
    const files = directFiles ?? (await jsonlFiles(path.join(root, "projects")));
    const selections = new Map(request.selections.map((selection) => [selection.sessionId, selection]));
    const callTurnMap = buildCallTurnMap(request.audit);
    const rawCandidatesBySession = new Map();
    const unattributedBySession = new Map();
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
        let currentTurnId = null;
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
            if (!inScope(eventTime, request.scope))
                continue;
            const ids = stableIds(record, payload);
            if (ids.turnId)
                currentTurnId = ids.turnId;
            if (ids.callId && (ids.turnId ?? currentTurnId)) {
                callTurnMap.set(`${sessionId}:${ids.callId}`, (ids.turnId ?? currentTurnId));
            }
            const value = contentValue(record, payload);
            if (value === undefined)
                continue;
            const resolvedTurnId = ids.turnId ??
                currentTurnId ??
                (ids.callId ? callTurnMap.get(`${sessionId}:${ids.callId}`) : null) ??
                null;
            if (!resolvedTurnId) {
                unattributedBySession.set(sessionId, true);
                continue;
            }
            if (!selection.turnIds.includes(resolvedTurnId)) {
                continue;
            }
            const maxChars = request.maxCharsPerItem ?? 1200;
            const result = redactedContent(value, maxChars);
            const item = {
                sessionId,
                turnId: resolvedTurnId,
                callId: ids.callId,
                kind: classify(record, payload),
                sourceLocation: "transcript:" + path.basename(file, ".jsonl") + "#" + (lineIndex + 1),
                ...result,
                untrusted: true,
            };
            const list = rawCandidatesBySession.get(sessionId) ?? [];
            list.push(item);
            rawCandidatesBySession.set(sessionId, list);
        }
    }
    if (scopeRejected.size > 0)
        throw new Error("Content Evidence Session is outside the originating project scope.");
    const maxItems = request.maxItemsPerSession ?? 24;
    const maxChars = request.maxCharsPerItem ?? 1200;
    return request.selections.map((selection) => {
        const candidates = rawCandidatesBySession.get(selection.sessionId) ?? [];
        const hadUnattributed = unattributedBySession.get(selection.sessionId) ?? false;
        const { items, warnings } = allocateSessionItems(selection, candidates, request.audit, maxItems, maxChars, hadUnattributed);
        return packet(request.scope, selection, items, warnings);
    });
}
function selectSessionTurns(turns) {
    if (turns.length === 0) {
        return {
            turnIds: [],
            selectionReason: "Audit Top 3 Token-ranked Session auto selection (no turns in session)",
            unreadScope: "none",
        };
    }
    if (turns.length <= 8) {
        return {
            turnIds: turns.map((t) => t.turnId),
            selectionReason: "Audit Top 3 Token-ranked Session auto selection (all turns within budget)",
            unreadScope: "none",
        };
    }
    const firstTurn = turns[0];
    const lastTurn = turns[turns.length - 1];
    const selectedSet = new Set([firstTurn.turnId, lastTurn.turnId]);
    const turnIndexMap = new Map(turns.map((t, idx) => [t.turnId, idx]));
    const hasAvailableTokens = turns.some((t) => t.tokens?.totalTokens?.provenance !== "unavailable" &&
        typeof t.tokens?.totalTokens?.value === "number" &&
        t.tokens.totalTokens.value >= 0);
    let selectionReason = "";
    if (hasAvailableTokens) {
        selectionReason = "Audit Top 3 Token-ranked Session auto selection (token-weighted with context and endpoints)";
        const candidates = [...turns].sort((a, b) => {
            const aVal = a.tokens?.totalTokens?.provenance !== "unavailable" && typeof a.tokens?.totalTokens?.value === "number"
                ? a.tokens.totalTokens.value
                : -1;
            const bVal = b.tokens?.totalTokens?.provenance !== "unavailable" && typeof b.tokens?.totalTokens?.value === "number"
                ? b.tokens.totalTokens.value
                : -1;
            if (bVal !== aVal)
                return bVal - aVal;
            const aOrd = typeof a.ordinal?.value === "number" ? a.ordinal.value : null;
            const bOrd = typeof b.ordinal?.value === "number" ? b.ordinal.value : null;
            if (aOrd !== null && bOrd !== null && aOrd !== bOrd)
                return aOrd - bOrd;
            return (turnIndexMap.get(a.turnId) ?? 0) - (turnIndexMap.get(b.turnId) ?? 0);
        });
        for (const cand of candidates) {
            if (selectedSet.size >= 8)
                break;
            const candIdx = turnIndexMap.get(cand.turnId);
            if (selectedSet.has(cand.turnId)) {
                if (candIdx > 0) {
                    const prevTurn = turns[candIdx - 1];
                    if (!selectedSet.has(prevTurn.turnId)) {
                        selectedSet.add(prevTurn.turnId);
                    }
                }
            }
            else {
                selectedSet.add(cand.turnId);
                if (selectedSet.size < 8 && candIdx > 0) {
                    const prevTurn = turns[candIdx - 1];
                    if (!selectedSet.has(prevTurn.turnId)) {
                        selectedSet.add(prevTurn.turnId);
                    }
                }
            }
        }
    }
    else {
        const hasAvailableToolBytes = turns.some((t) => t.toolResultBytes?.provenance !== "unavailable" &&
            typeof t.toolResultBytes?.value === "number" &&
            t.toolResultBytes.value >= 0);
        if (hasAvailableToolBytes) {
            selectionReason = "Audit Top 3 Token-ranked Session auto selection (tool-bytes fallback with context and endpoints)";
            const candidates = [...turns].sort((a, b) => {
                const aVal = a.toolResultBytes?.provenance !== "unavailable" && typeof a.toolResultBytes?.value === "number"
                    ? a.toolResultBytes.value
                    : -1;
                const bVal = b.toolResultBytes?.provenance !== "unavailable" && typeof b.toolResultBytes?.value === "number"
                    ? b.toolResultBytes.value
                    : -1;
                if (bVal !== aVal)
                    return bVal - aVal;
                const aOrd = typeof a.ordinal?.value === "number" ? a.ordinal.value : null;
                const bOrd = typeof b.ordinal?.value === "number" ? b.ordinal.value : null;
                if (aOrd !== null && bOrd !== null && aOrd !== bOrd)
                    return aOrd - bOrd;
                return (turnIndexMap.get(a.turnId) ?? 0) - (turnIndexMap.get(b.turnId) ?? 0);
            });
            for (const cand of candidates) {
                if (selectedSet.size >= 8)
                    break;
                const candIdx = turnIndexMap.get(cand.turnId);
                if (selectedSet.has(cand.turnId)) {
                    if (candIdx > 0) {
                        const prevTurn = turns[candIdx - 1];
                        if (!selectedSet.has(prevTurn.turnId)) {
                            selectedSet.add(prevTurn.turnId);
                        }
                    }
                }
                else {
                    selectedSet.add(cand.turnId);
                    if (selectedSet.size < 8 && candIdx > 0) {
                        const prevTurn = turns[candIdx - 1];
                        if (!selectedSet.has(prevTurn.turnId)) {
                            selectedSet.add(prevTurn.turnId);
                        }
                    }
                }
            }
        }
        else {
            selectionReason = "Audit Top 3 Token-ranked Session auto selection (TURN_SELECTION_USAGE_UNAVAILABLE, sequential fallback)";
            for (const turn of turns) {
                if (selectedSet.size >= 8)
                    break;
                selectedSet.add(turn.turnId);
            }
        }
    }
    const finalTurnIds = turns.filter((t) => selectedSet.has(t.turnId)).map((t) => t.turnId);
    const unreadCount = turns.length - finalTurnIds.length;
    const unreadScope = `${unreadCount} remaining Turns in the same selected Session and Audit Scope`;
    return {
        turnIds: finalTurnIds,
        selectionReason,
        unreadScope,
    };
}
function selectAutoEvidence(audit, topSessions) {
    return topSessions.slice(0, 3).map((session) => {
        const sessionTurns = (audit.turns ?? []).filter((turn) => turn.sessionId === session.sessionId);
        const { turnIds, selectionReason, unreadScope } = selectSessionTurns(sessionTurns);
        return {
            sessionId: session.sessionId,
            turnIds,
            selectionReason,
            unreadScope,
        };
    });
}
async function readContentEvidence(request) {
    validateRequest(request);
    return request.scope.harness === "codex" ? readCodexEvidence(request) : readClaudeEvidence(request);
}
