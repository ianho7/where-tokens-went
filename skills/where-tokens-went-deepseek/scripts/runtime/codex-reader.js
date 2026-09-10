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
exports.readCodex = readCodex;
const promises_1 = require("node:fs/promises");
const path = __importStar(require("node:path"));
const os = __importStar(require("node:os"));
function asObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value
        : null;
}
function firstObject(...values) {
    for (const value of values) {
        const object = asObject(value);
        if (object)
            return object;
    }
    return null;
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
function numberValue(...values) {
    for (const value of values) {
        if (typeof value === "number" && Number.isFinite(value))
            return value;
        if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
            return Number(value);
        }
    }
    return null;
}
function booleanValue(...values) {
    for (const value of values) {
        if (typeof value === "boolean")
            return value;
        if (typeof value === "string" && (value === "true" || value === "false"))
            return value === "true";
    }
    return null;
}
function timestampValue(...values) {
    const value = stringValue(...values);
    if (!value)
        return null;
    return Number.isNaN(Date.parse(value)) ? null : value;
}
function getNested(object, ...keys) {
    if (!object)
        return undefined;
    for (const key of keys) {
        if (key in object)
            return object[key];
    }
    return undefined;
}
function usageValues(value) {
    const usage = asObject(value) ?? {};
    const inputTokens = numberValue(usage.input_tokens, usage.inputTokens, usage.input);
    const cachedInputTokens = numberValue(usage.cached_input_tokens, usage.cachedInputTokens, usage.cache_read_input_tokens, usage.cacheReadInputTokens);
    const cacheWriteTokens = numberValue(usage.cache_write_input_tokens, usage.cacheWriteInputTokens, usage.cache_creation_input_tokens, usage.cacheCreationInputTokens);
    const outputTokens = numberValue(usage.output_tokens, usage.outputTokens, usage.output);
    const reasoningTokens = numberValue(usage.reasoning_output_tokens, usage.reasoningOutputTokens, usage.reasoning_tokens, usage.reasoningTokens);
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
function callFromUsage(sessionId, callId, timestamp, model, provider, usage) {
    const totalTokens = usage.totalTokens ?? (usage.inputTokens !== null && usage.cachedInputTokens !== null && usage.cacheWriteTokens !== null
        && usage.outputTokens !== null && usage.reasoningTokens !== null
        ? usage.inputTokens + usage.cachedInputTokens + usage.cacheWriteTokens + usage.outputTokens + usage.reasoningTokens
        : null);
    const tokenProvenance = usage.totalTokens !== null ? "reported" : (totalTokens === null ? "unavailable" : "derived");
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
    };
}
function normaliseCwd(value) {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
function sameCwd(left, right) {
    if (!left || !right)
        return false;
    return normaliseCwd(left) === normaliseCwd(right);
}
async function rolloutFiles(root) {
    const found = [];
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
            if (entry.isDirectory()) {
                await visit(fullPath);
            }
            else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
                found.push(fullPath);
            }
        }
    }
    await visit(root);
    return found.sort();
}
function recordPayload(record) {
    return asObject(record.payload) ?? record;
}
function recordTimestamp(record, payload) {
    return timestampValue(record.timestamp, record.time, payload.timestamp, payload.time);
}
function isType(record, payload, ...types) {
    return types.some((type) => record.type === type || payload.type === type);
}
const knownCodexTypes = new Set([
    "session_meta", "session_metadata", "turn_context", "event_msg", "response_item", "token_count",
    "raw_response_completed", "raw_response_completed_event", "function_call", "function_call_output",
    "custom_tool_call", "custom_tool_call_output", "shell_command", "tool_call", "tool_result", "stream_error",
    "turn_aborted", "interrupted", "error", "compaction", "subagent",
]);
function accountingSensitiveCodexType(type) {
    return /usage|token|response|assistant|message|tool|call|turn|retry|interrupt|compact|subagent|error/i.test(type);
}
function responseUsage(record, payload) {
    const event = firstObject(isType(record, payload, "raw_response_completed") ? payload : null, isType(record, payload, "raw_response_completed_event") ? payload : null, payload.event, record.event);
    if (!event)
        return null;
    const eventType = stringValue(event.type, event.kind);
    if (eventType && eventType !== "raw_response_completed" && eventType !== "raw_response_completed_event") {
        return null;
    }
    const usage = usageValues(event.usage ?? event.token_usage ?? event.tokenUsage);
    const hasUsage = Object.values(usage).some((value) => value !== null);
    if (!hasUsage)
        return null;
    return {
        id: stringValue(event.response_id, event.responseId, event.id),
        usage,
    };
}
function tokenCountUsage(record, payload) {
    if (!isType(record, payload, "token_count"))
        return null;
    const info = firstObject(payload.info, record.info) ?? payload;
    const last = info.last_token_usage ?? info.lastTokenUsage;
    const total = info.total_token_usage ?? info.totalTokenUsage;
    const usageValue = last ?? total;
    const usage = usageValues(usageValue);
    const hasUsage = Object.values(usage).some((value) => value !== null);
    if (!hasUsage)
        return null;
    return {
        id: stringValue(payload.response_id, payload.responseId, payload.call_id, payload.callId),
        usage,
        isFinal: last === undefined && total !== undefined,
    };
}
function byteLength(value) {
    if (typeof value === "string")
        return Buffer.byteLength(value, "utf8");
    if (value === null || value === undefined)
        return null;
    try {
        return Buffer.byteLength(JSON.stringify(value), "utf8");
    }
    catch {
        return null;
    }
}
function characterLength(value) {
    if (value === null || value === undefined)
        return null;
    const text = typeof value === "string" ? value : (() => {
        try {
            return JSON.stringify(value);
        }
        catch {
            return null;
        }
    })();
    return text === null ? null : Array.from(text).length;
}
function toolEvent(record, payload) {
    const type = stringValue(payload.type, record.type)?.toLowerCase() ?? "";
    const callId = stringValue(payload.call_id, payload.callId, payload.tool_call_id, payload.toolCallId);
    if (!callId)
        return null;
    const isResult = type.includes("output") || type.includes("result") || type.includes("completed");
    const isCall = type.includes("function_call") || type.includes("custom_tool_call") || type.includes("tool_call") || type.includes("shell_command");
    if (!isCall && !isResult)
        return null;
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
function sessionIdFor(file, fallbackIndex) {
    const name = path.basename(file, ".jsonl");
    return name.startsWith("rollout-") && name.length > 8 ? name.slice(8) : `unknown-session-${fallbackIndex}`;
}
async function readSessionTitles(codexHome, warnings) {
    const titles = new Map();
    let text;
    try {
        text = await (0, promises_1.readFile)(path.join(codexHome, "session_index.jsonl"), "utf8");
    }
    catch {
        return titles;
    }
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim())
            continue;
        let parsed;
        try {
            parsed = JSON.parse(line);
        }
        catch {
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
        if (sessionId && title)
            titles.set(sessionId, title);
    }
    return titles;
}
function updateSessionTimes(pending, timestamp) {
    if (!timestamp)
        return;
    const milliseconds = Date.parse(timestamp);
    if (Number.isNaN(milliseconds))
        return;
    pending.eventTimes.push(milliseconds);
    if (!pending.session.startedAt || Date.parse(pending.session.startedAt) > milliseconds) {
        pending.session.startedAt = timestamp;
    }
    if (!pending.session.endedAt || Date.parse(pending.session.endedAt) < milliseconds) {
        pending.session.endedAt = timestamp;
    }
}
function subagentSource(value) {
    if (typeof value === "string")
        return value.toLowerCase() === "subagent";
    const source = asObject(value);
    if (!source)
        return null;
    if ("subagent" in source)
        return true;
    const kind = stringValue(source.type, source.kind);
    return kind ? kind.toLowerCase() === "subagent" : null;
}
function mergeSession(pending, payload, timestamp) {
    const cwd = stringValue(payload.cwd, payload.project_cwd, payload.projectCwd);
    const parentSessionId = stringValue(payload.parent_thread_id, payload.parentThreadId, payload.forked_from_id, payload.forkedFromId);
    const sourceVersion = stringValue(payload.cli_version, payload.cliVersion, payload.source_version, payload.sourceVersion);
    if (cwd)
        pending.session.projectCwd = cwd;
    if (parentSessionId)
        pending.session.parentSessionId = parentSessionId;
    const isSubagent = subagentSource(payload.source);
    if (isSubagent !== null)
        pending.session.isSubagent = isSubagent;
    if (sourceVersion)
        pending.session.sourceVersion = sourceVersion;
    updateSessionTimes(pending, timestamp);
}
function selectedByScope(session, eventTimes, scope) {
    if (!scope.allProjects && !sameCwd(session.projectCwd, scope.cwd))
        return false;
    const since = scope.since.getTime();
    return eventTimes.some((time) => time >= since);
}
async function readCodex(scope) {
    const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
    const files = await rolloutFiles(path.join(codexHome, "sessions"));
    const coverage = {
        filesRead: 0,
        recordsRead: 0,
        recordsSkipped: 0,
        partialSessions: 0,
        warnings: [],
    };
    const pendingById = new Map();
    let fallbackIndex = 0;
    const sessionTitles = await readSessionTitles(codexHome, coverage.warnings);
    for (const file of files) {
        coverage.filesRead += 1;
        let text;
        try {
            text = await (0, promises_1.readFile)(file, "utf8");
        }
        catch {
            coverage.recordsSkipped += 1;
            coverage.warnings.push("A Codex rollout could not be read and was skipped.");
            continue;
        }
        const lines = text.split(/\r?\n/);
        const hadTrailingNewline = /\r?\n$/.test(text);
        if (hadTrailingNewline)
            lines.pop();
        let activeSessionId = null;
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
            const line = lines[lineIndex];
            if (!line.trim())
                continue;
            let parsed;
            try {
                parsed = JSON.parse(line);
            }
            catch {
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
                    else
                        coverage.partialSessions += 1;
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
            let sessionId = activeSessionId;
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
                        unsupported: false,
                        missingTimestamp: false,
                        partial: false,
                        partialCoverageCounted: false,
                    });
                }
                mergeSession(pendingById.get(sessionId), payload, timestamp);
            }
            if (!sessionId) {
                sessionId = activeSessionId ?? sessionIdFor(file, fallbackIndex++);
                activeSessionId = sessionId;
            }
            const pending = pendingById.get(sessionId) ?? {
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
                    if (!timestamp)
                        pending.missingTimestamp = true;
                }
                continue;
            }
            if (isType(record, payload, "turn_context")) {
                mergeSession(pending, payload, timestamp);
                pending.currentModel = stringValue(payload.model, payload.model_name, payload.modelName) ?? pending.currentModel;
                pending.currentProvider = stringValue(payload.model_provider, payload.modelProvider, payload.provider) ?? pending.currentProvider;
            }
            const model = stringValue(payload.model, payload.model_name, payload.modelName) ?? pending.currentModel;
            const provider = stringValue(payload.model_provider, payload.modelProvider, payload.provider) ?? pending.currentProvider;
            const response = responseUsage(record, payload);
            if (response) {
                const call = callFromUsage(sessionId, response.id, timestamp, model, provider, response.usage);
                if (!call.timestamp)
                    pending.missingTimestamp = true;
                const existingIndex = response.id
                    ? pending.rawCalls.findIndex((candidate) => candidate.callId === response.id)
                    : -1;
                if (existingIndex >= 0) {
                    const existing = pending.rawCalls[existingIndex];
                    if (existing.totalTokens === null && call.totalTokens !== null)
                        pending.rawCalls[existingIndex] = call;
                }
                else {
                    pending.rawCalls.push(call);
                }
            }
            const tokenCount = tokenCountUsage(record, payload);
            if (tokenCount) {
                const call = callFromUsage(sessionId, tokenCount.id, timestamp, model, provider, tokenCount.usage);
                if (!call.timestamp)
                    pending.missingTimestamp = true;
                if (tokenCount.isFinal) {
                    pending.finalTotal = call;
                }
                else {
                    const existingIndex = tokenCount.id
                        ? pending.incrementalCalls.findIndex((candidate) => candidate.callId === tokenCount.id)
                        : -1;
                    if (existingIndex >= 0) {
                        const existing = pending.incrementalCalls[existingIndex];
                        if (existing.totalTokens === null && call.totalTokens !== null)
                            pending.incrementalCalls[existingIndex] = call;
                    }
                    else {
                        pending.incrementalCalls.push(call);
                    }
                }
            }
            const tool = toolEvent(record, payload);
            if (tool) {
                if (!timestamp)
                    pending.missingTimestamp = true;
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
                }
                else {
                    const existing = pending.toolCalls.find((candidate) => candidate.callId === tool.callId);
                    if (existing) {
                        existing.resultBytes = tool.resultBytes;
                        existing.resultChars = tool.resultChars;
                        existing.isError = tool.isError ?? existing.isError;
                    }
                    else {
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
                    if (last)
                        last.status = "error";
                    pending.lifecycle.push({ sessionId, timestamp, kind: "retry", relatedId: last?.callId ?? null });
                    if (!timestamp)
                        pending.missingTimestamp = true;
                }
                if (eventType === "turn_aborted" || eventType === "interrupted") {
                    const last = pending.rawCalls[pending.rawCalls.length - 1] ?? pending.incrementalCalls[pending.incrementalCalls.length - 1];
                    if (last)
                        last.status = "interrupted";
                    pending.lifecycle.push({ sessionId, timestamp, kind: "interrupted", relatedId: last?.callId ?? null });
                    if (!timestamp)
                        pending.missingTimestamp = true;
                }
                if (eventType?.includes("subagent")) {
                    pending.lifecycle.push({ sessionId, timestamp, kind: "subagent", relatedId: null });
                    if (!timestamp)
                        pending.missingTimestamp = true;
                }
                if (eventType?.includes("compaction")) {
                    pending.lifecycle.push({ sessionId, timestamp, kind: "compaction", relatedId: null });
                    if (!timestamp)
                        pending.missingTimestamp = true;
                }
            }
        }
    }
    const sessions = [];
    const modelCalls = [];
    const toolCalls = [];
    const lifecycle = [];
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
        const calls = pending.rawCalls.length > 0
            ? pending.rawCalls
            : pending.incrementalCalls.length > 0
                ? pending.incrementalCalls
                : pending.finalTotal
                    ? [pending.finalTotal]
                    : [];
        for (const call of calls) {
            if (!call.timestamp || Number.isNaN(Date.parse(call.timestamp)) || Date.parse(call.timestamp) < scope.since.getTime())
                continue;
            modelCalls.push(call);
        }
    }
    if (unsupportedSessions > 0) {
        coverage.warnings.push(unsupportedSessions + " Codex Session" + (unsupportedSessions === 1 ? " contains" : "s contain") +
            " unsupported accounting records; only a partial audit is reported.");
    }
    if (missingTimestampSessions > 0) {
        coverage.warnings.push(missingTimestampSessions + " Codex Session" + (missingTimestampSessions === 1 ? " contains" : "s contain") +
            " accounting records without a usable timestamp; only time-scoped records were analysed.");
    }
    if (files.length === 0)
        coverage.warnings.push("No Codex rollout history was found for the selected scope.");
    return {
        sessions: sessions.sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
        modelCalls,
        lifecycle,
        toolCalls,
        coverage,
    };
}
