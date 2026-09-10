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
exports.readDeepSeek = readDeepSeek;
const promises_1 = require("node:fs/promises");
const fzstd_1 = require("./fzstd.js");
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
function numberValue(...values) {
    for (const value of values) {
        if (typeof value === "number" && Number.isFinite(value))
            return value;
        if (typeof value === "string" && value.trim() && Number.isFinite(Number(value)))
            return Number(value);
    }
    return null;
}
function booleanValue(...values) {
    for (const value of values) {
        if (typeof value === "boolean")
            return value;
        if (value === "true" || value === "false")
            return value === "true";
    }
    return null;
}
function timestampValue(...values) {
    for (const value of values) {
        if (typeof value === "number" && Number.isFinite(value)) {
            const date = new Date(value);
            if (!Number.isNaN(date.getTime()))
                return date.toISOString();
        }
        if (typeof value === "string" && value.trim() && !Number.isNaN(Date.parse(value)))
            return value;
    }
    return null;
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
function createSession(sessionId) {
    return {
        session: { harness: "deepseek", sessionId, projectCwd: null, startedAt: null, endedAt: null, parentSessionId: null, sourceVersion: null },
        eventTimes: [],
        modelCalls: [],
        attemptCalls: [],
        messageSteps: new Set(),
        tools: [],
        toolIdsByPosition: new Map(),
        lifecycle: [],
        seenSeq: new Set(),
        lastSeq: null,
        currentModel: null,
        currentProvider: null,
        unsupported: false,
        partial: false,
        missingTimestamp: false,
    };
}
function updateTime(pending, timestamp) {
    if (!timestamp)
        return;
    const time = Date.parse(timestamp);
    if (Number.isNaN(time))
        return;
    pending.eventTimes.push(time);
    if (!pending.session.startedAt || Date.parse(pending.session.startedAt) > time)
        pending.session.startedAt = timestamp;
    if (!pending.session.endedAt || Date.parse(pending.session.endedAt) < time)
        pending.session.endedAt = timestamp;
}
function usageCall(sessionId, callId, timestamp, model, provider, usageValue) {
    const usage = objectValue(usageValue);
    if (!usage)
        return null;
    const inputTokens = numberValue(usage.inputTokens, usage.input_tokens);
    const cachedInputTokens = numberValue(usage.cacheReadTokens, usage.cache_read_tokens, usage.cache_read_input_tokens);
    const cacheWriteTokens = numberValue(usage.cacheWriteTokens, usage.cache_write_tokens, usage.cache_write_input_tokens);
    const outputTokens = numberValue(usage.outputTokens, usage.output_tokens);
    const reasoningTokens = numberValue(usage.reasoningTokens, usage.reasoning_tokens);
    const reportedTotal = numberValue(usage.totalTokens, usage.total_tokens, usage.total);
    if ([inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens, reasoningTokens, reportedTotal].every((value) => value === null))
        return null;
    const totalTokens = reportedTotal ?? (inputTokens !== null && cachedInputTokens !== null && cacheWriteTokens !== null
        && outputTokens !== null && reasoningTokens !== null
        ? inputTokens + cachedInputTokens + cacheWriteTokens + outputTokens + reasoningTokens
        : null);
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
function sameCwd(left, right) {
    if (!left || !right)
        return false;
    const normalise = (value) => {
        const resolved = path.resolve(value);
        return process.platform === "win32" ? resolved.toLowerCase() : resolved;
    };
    return normalise(left) === normalise(right);
}
async function sessionFiles(root) {
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
            else if (entry.isFile() && (entry.name === "session.jsonl" || entry.name.endsWith(".jsonl") || entry.name.endsWith(".jsonl.zstd")))
                files.push(fullPath);
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
function packedSpan(record, data, type) {
    if (!packedEvents.has(type))
        return null;
    const start = numberValue(record.seq0, data.seq0);
    if (start === null)
        return null;
    const valuesKeys = type === "text-chunks"
        ? ["texts"]
        : type === "reasoning-chunks"
            ? ["reasonings", "reasoning", "thoughts"]
            : ["args", "arguments", "argumentDeltas", "toolCalls", "tool_calls", "calls"];
    const values = valuesKeys.map((key) => data[key]).find((value) => Array.isArray(value));
    const count = Array.isArray(values) ? values.length : Array.isArray(data.dt) ? data.dt.length : 0;
    return count > 0 ? { start, end: start + count - 1 } : null;
}
function expandPackedRecord(record) {
    const type = stringValue(record.type, record.kind) ?? "";
    if (!packedEvents.has(type))
        return [record];
    const data = objectValue(record.data) ?? record;
    const span = packedSpan(record, data, type);
    if (!span)
        return [record];
    const valuesKeys = type === "text-chunks"
        ? ["texts"]
        : type === "reasoning-chunks"
            ? ["reasonings", "reasoning", "thoughts"]
            : ["args", "arguments", "argumentDeltas", "toolCalls", "tool_calls", "calls"];
    const values = valuesKeys.map((key) => data[key]).find((value) => Array.isArray(value));
    const count = span.end - span.start + 1;
    const deltas = Array.isArray(data.dt) ? data.dt : [];
    const startTime = numberValue(record.time0, data.time0);
    let time = startTime ?? 0;
    return Array.from({ length: count }, (_, index) => {
        if (index > 0)
            time += numberValue(deltas[index]) ?? 0;
        const value = values?.[index];
        const chunk = objectValue(value) ?? { value: value ?? null };
        const isToolCall = type === "tool-call-chunks";
        return {
            type: "assistant/chunk",
            seq: span.start + index,
            ...(startTime === null ? {} : { time: new Date(time).toISOString() }),
            data: {
                ...data,
                ...chunk,
                chunk: isToolCall
                    ? {
                        type: "tool-call-delta",
                        index: data.index,
                        ...(typeof data.name === "string" ? { name: data.name } : {}),
                        argumentsDelta: typeof value === "string" ? value : JSON.stringify(value ?? ""),
                    }
                    : chunk,
            },
        };
    });
}
function decodeZstdPrefix(bytes) {
    const chunks = [];
    const decoder = new fzstd_1.Decompress((chunk) => {
        chunks.push(Buffer.from(chunk));
    });
    let partial = false;
    try {
        decoder.push(bytes, true);
    }
    catch {
        partial = true;
    }
    return { text: Buffer.concat(chunks).toString("utf8"), partial };
}
function toolPosition(data, record, chunk) {
    const turn = stringValue(chunk.turn, data.turn, record.turn);
    const step = stringValue(chunk.step, data.step, record.step);
    const index = stringValue(chunk.index, data.index, record.index);
    if (turn === null || step === null || index === null)
        return null;
    return `${turn}:${step}:${index}`;
}
function addBytes(current, value) {
    const size = byteLength(value);
    return size === null ? current : (current ?? 0) + size;
}
function accountingSensitive(type) {
    return /usage|token|response|assistant|message|tool|call|request|turn|step|retry|interrupt|compact|subagent|error/i.test(type);
}
async function readDeepSeek(scope) {
    const explicit = process.env.DSH_SESSION_JSONL;
    const root = process.env.DSH_JSONL_ROOT || process.env.DSH_PERSISTENCE_ROOT;
    const files = explicit ? [explicit] : root ? await sessionFiles(root) : [];
    const coverage = { filesRead: 0, recordsRead: 0, recordsSkipped: 0, partialSessions: 0, warnings: [] };
    const pendingById = new Map();
    let fallbackIndex = 0;
    for (const file of files) {
        coverage.filesRead += 1;
        let logical;
        let partialDecode = false;
        let partialTrailing = false;
        try {
            const bytes = await (0, promises_1.readFile)(file);
            if (file.endsWith(".zstd")) {
                const decoded = decodeZstdPrefix(bytes);
                logical = decoded.text;
                partialDecode = decoded.partial;
            }
            else {
                logical = bytes.toString("utf8");
            }
        }
        catch {
            coverage.recordsSkipped += 1;
            coverage.partialSessions += 1;
            coverage.warnings.push("A DeepSeek Harness Session could not be decoded and was skipped.");
            continue;
        }
        if (partialDecode) {
            coverage.recordsSkipped += 1;
            coverage.warnings.push("A DeepSeek Harness Session ended with a torn Zstandard frame; only the durable prefix was analysed.");
        }
        const physicalLines = logical.split(/\r?\n/);
        const trailingNewline = /\r?\n$/.test(logical);
        if (trailingNewline)
            physicalLines.pop();
        let records = [];
        for (let lineIndex = 0; lineIndex < physicalLines.length; lineIndex += 1) {
            const line = physicalLines[lineIndex];
            if (!line.trim())
                continue;
            try {
                const parsed = JSON.parse(line);
                if (Array.isArray(parsed)) {
                    for (const item of parsed) {
                        const object = objectValue(item);
                        if (object)
                            records.push(object);
                    }
                }
                else {
                    const object = objectValue(parsed);
                    if (object)
                        records.push(object);
                    else
                        coverage.recordsSkipped += 1;
                }
            }
            catch {
                coverage.recordsSkipped += 1;
                if (lineIndex === physicalLines.length - 1 && !trailingNewline)
                    partialTrailing = true;
            }
        }
        if (partialTrailing)
            coverage.warnings.push("A DeepSeek Harness Session ended with an incomplete JSON record; only the complete prefix was analysed.");
        const partialFile = partialDecode || partialTrailing;
        records = records.flatMap(expandPackedRecord);
        let currentSessionId = null;
        let partialFileAssigned = false;
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
                if (partialFile) {
                    pending.partial = true;
                    partialFileAssigned = true;
                }
                pending.session.projectCwd = stringValue(record.cwd, data.cwd, record.projectCwd, data.projectCwd);
                pending.session.parentSessionId = stringValue(record.parentSession, data.parentSession, record.parent_session, data.parent_session);
                pending.session.sourceVersion = stringValue(record.version, data.version);
                updateTime(pending, timestamp);
                continue;
            }
            if (!currentSessionId)
                currentSessionId = `unknown-session-${fallbackIndex++}`;
            const pending = pendingById.get(currentSessionId) ?? createSession(currentSessionId);
            pendingById.set(currentSessionId, pending);
            if (partialFile) {
                pending.partial = true;
                partialFileAssigned = true;
            }
            const span = packedSpan(record, data, type);
            const sequenceStart = span?.start ?? numberValue(record.seq, record.sequence, record.seq0);
            const sequenceEnd = span?.end ?? sequenceStart;
            if (span) {
                const duplicate = Array.from({ length: span.end - span.start + 1 }, (_, index) => String(span.start + index)).some((value) => pending.seenSeq.has(value));
                if (duplicate)
                    continue;
                for (let value = span.start; value <= span.end; value += 1)
                    pending.seenSeq.add(String(value));
            }
            else if (seq && pending.seenSeq.has(seq)) {
                continue;
            }
            else if (seq) {
                pending.seenSeq.add(seq);
            }
            if (sequenceStart !== null && sequenceEnd !== null) {
                if (pending.lastSeq !== null && sequenceStart !== pending.lastSeq + 1)
                    pending.unsupported = true;
                pending.lastSeq = sequenceEnd;
            }
            updateTime(pending, timestamp);
            if (!knownEvents.has(type)) {
                coverage.recordsSkipped += 1;
                if (accountingSensitive(type)) {
                    pending.unsupported = true;
                    if (!timestamp)
                        pending.missingTimestamp = true;
                }
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
                if (call) {
                    if (!call.timestamp)
                        pending.missingTimestamp = true;
                    if (!pending.modelCalls.some((candidate) => candidate.callId === call.callId))
                        pending.modelCalls.push(call);
                }
                if (stepId)
                    pending.messageSteps.add(stepId);
                const content = Array.isArray(data.content) ? data.content : [];
                for (const item of content) {
                    const block = objectValue(item);
                    if (!block || !stringValue(block.type)?.includes("tool"))
                        continue;
                    const toolId = stringValue(block.callId, block.call_id, block.id);
                    if (toolId && !pending.tools.some((tool) => tool.callId === toolId)) {
                        if (!timestamp)
                            pending.missingTimestamp = true;
                        pending.tools.push({ sessionId: currentSessionId, callId: toolId, timestamp, toolName: stringValue(block.name, block.toolName) ?? "unknown-tool", inputBytes: byteLength(block.arguments ?? block.input), resultBytes: null, isError: null });
                    }
                }
            }
            if (type === "assistant/chunk") {
                const chunk = objectValue(data.chunk) ?? data;
                const chunkType = stringValue(chunk.type)?.toLowerCase() ?? "";
                if (chunkType === "tool-call-delta" || chunkType.includes("tool-call")) {
                    if (!timestamp)
                        pending.missingTimestamp = true;
                    const position = toolPosition(data, record, chunk);
                    const toolId = stringValue(chunk.id) ?? (position ? pending.toolIdsByPosition.get(position) : null);
                    if (!toolId) {
                        pending.unsupported = true;
                        continue;
                    }
                    if (position)
                        pending.toolIdsByPosition.set(position, toolId);
                    let tool = pending.tools.find((candidate) => candidate.callId === toolId);
                    if (!tool) {
                        tool = {
                            sessionId: currentSessionId,
                            callId: toolId,
                            timestamp,
                            toolName: stringValue(chunk.name, data.name) ?? "unknown-tool",
                            inputBytes: null,
                            resultBytes: null,
                            resultChars: null,
                            isError: null,
                        };
                        pending.tools.push(tool);
                    }
                    else if (stringValue(chunk.name, data.name)) {
                        tool.toolName = stringValue(chunk.name, data.name) || tool.toolName;
                    }
                    tool.inputBytes = addBytes(tool.inputBytes, chunk.argumentsDelta ?? chunk.arguments_delta ?? chunk.arguments);
                }
            }
            if (type === "assistant/attempt") {
                const stepId = stringValue(data.stepId, data.step_id);
                const callId = stringValue(data.attemptId, data.attempt_id, data.callId, data.call_id, stepId, seq) ?? `attempt-${pending.attemptCalls.length}`;
                const call = usageCall(currentSessionId, callId, timestamp, stringValue(data.model) ?? pending.currentModel, stringValue(data.provider) ?? pending.currentProvider, data.usage ?? data.streamUsage ?? data.stream_usage);
                if (call) {
                    if (!call.timestamp)
                        pending.missingTimestamp = true;
                    pending.attemptCalls.push({ stepId, call });
                }
            }
            if (type === "tool/call") {
                const toolId = stringValue(data.callId, data.call_id, data.id);
                if (toolId && !pending.tools.some((tool) => tool.callId === toolId)) {
                    if (!timestamp)
                        pending.missingTimestamp = true;
                    pending.tools.push({ sessionId: currentSessionId, callId: toolId, timestamp, toolName: stringValue(data.name, data.toolName) ?? "unknown-tool", inputBytes: byteLength(data.arguments ?? data.input), resultBytes: null, isError: null });
                }
            }
            if (type === "tool/result") {
                const toolId = stringValue(data.callId, data.call_id, data.toolCallId, data.tool_call_id);
                if (toolId) {
                    if (!timestamp)
                        pending.missingTimestamp = true;
                    const tool = pending.tools.find((candidate) => candidate.callId === toolId);
                    const result = data.result ?? data.content ?? data.output;
                    if (tool) {
                        tool.resultBytes = byteLength(result);
                        tool.resultChars = characterLength(result);
                        tool.isError = booleanValue(data.isError, data.is_error);
                    }
                    else
                        pending.tools.push({ sessionId: currentSessionId, callId: toolId, timestamp, toolName: stringValue(data.name, data.toolName) ?? "unknown-tool", inputBytes: null, resultBytes: byteLength(result), resultChars: characterLength(result), isError: booleanValue(data.isError, data.is_error) });
                }
            }
            if (type === "retry") {
                pending.lifecycle.push({ sessionId: currentSessionId, timestamp, kind: "retry", relatedId: stringValue(data.attemptId, data.attempt_id) });
                if (!timestamp)
                    pending.missingTimestamp = true;
            }
            if (type === "interrupted") {
                pending.lifecycle.push({ sessionId: currentSessionId, timestamp, kind: "interrupted", relatedId: null });
                if (!timestamp)
                    pending.missingTimestamp = true;
            }
            if (type.startsWith("compaction/")) {
                pending.lifecycle.push({ sessionId: currentSessionId, timestamp, kind: "compaction", relatedId: null });
                if (!timestamp)
                    pending.missingTimestamp = true;
            }
            if (type.startsWith("subagent/")) {
                pending.lifecycle.push({ sessionId: currentSessionId, timestamp, kind: "subagent", relatedId: stringValue(data.sessionId, data.session_id) });
                if (!timestamp)
                    pending.missingTimestamp = true;
            }
        }
        if (partialFile && !partialFileAssigned)
            coverage.partialSessions += 1;
    }
    const sessions = [];
    const modelCalls = [];
    const toolCalls = [];
    const lifecycle = [];
    for (const pending of pendingById.values()) {
        if (!sameCwd(pending.session.projectCwd, scope.cwd) && !scope.allProjects)
            continue;
        if (!pending.eventTimes.some((time) => time >= scope.since.getTime())) {
            if (pending.missingTimestamp) {
                coverage.partialSessions += 1;
                coverage.warnings.push("A DeepSeek Harness Session contains accounting records without a usable timestamp; only time-scoped records were analysed.");
            }
            continue;
        }
        let partial = pending.partial;
        if (pending.unsupported) {
            partial = true;
            coverage.warnings.push("A DeepSeek Harness Session contains unsupported or non-contiguous records; only a partial audit is reported.");
        }
        if (pending.missingTimestamp) {
            partial = true;
            coverage.warnings.push("A DeepSeek Harness Session contains accounting records without a usable timestamp; only time-scoped records were analysed.");
        }
        if (partial)
            coverage.partialSessions += 1;
        sessions.push(pending.session);
        const calls = [...pending.modelCalls, ...pending.attemptCalls.filter((entry) => !entry.stepId || !pending.messageSteps.has(entry.stepId)).map((entry) => entry.call)];
        for (const call of calls)
            if (call.timestamp && !Number.isNaN(Date.parse(call.timestamp)) && Date.parse(call.timestamp) >= scope.since.getTime())
                modelCalls.push(call);
        toolCalls.push(...pending.tools.filter((tool) => tool.timestamp && !Number.isNaN(Date.parse(tool.timestamp)) && Date.parse(tool.timestamp) >= scope.since.getTime()));
        lifecycle.push(...pending.lifecycle.filter((event) => event.timestamp && !Number.isNaN(Date.parse(event.timestamp)) && Date.parse(event.timestamp) >= scope.since.getTime()));
    }
    if (files.length === 0)
        coverage.warnings.push("No DeepSeek Harness Session history was found for the selected scope.");
    return { sessions, modelCalls, toolCalls, lifecycle, coverage };
}
