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
function skillNameValue(...values) {
    for (const value of values) {
        if (typeof value === "string") {
            const cleaned = value.trim().replace(/^\/+/, "").replace(/\\/g, "/");
            const match = /(?:^|\/)([^/]+?)(?:\/SKILL\.md)?$/i.exec(cleaned);
            const candidate = match?.[1] ?? cleaned;
            if (candidate && candidate.length <= 80 && /^[A-Za-z0-9_.:@-]+$/.test(candidate))
                return candidate;
        }
        const object = asObject(value);
        if (object) {
            const nested = skillNameValue(object.name, object.skill, object.skill_name, object.skillName, object.id);
            if (nested)
                return nested;
        }
    }
    return null;
}
function redactedSource(file) {
    return "rollout:" + path.basename(file, ".jsonl");
}
function skillRecord(sessionId, skillName, state, evidenceType, turnId, callId, timestamp, sourceLocation, provenance) {
    return { sessionId, skillName, state, evidenceType, turnId, callId, timestamp, sourceLocation, provenance };
}
function listedSkillNames(...values) {
    const names = [];
    for (const value of values) {
        const items = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
        for (const item of items) {
            const name = skillNameValue(item);
            if (name)
                names.push(name);
        }
    }
    return [...new Set(names)].sort();
}
function skillPathEvidence(value) {
    const text = typeof value === "string" ? value : (() => {
        try {
            return JSON.stringify(value);
        }
        catch {
            return null;
        }
    })();
    if (!text)
        return null;
    const normalized = text.replaceAll("\\", "/").replace(/\/+/g, "/");
    const match = /(?:^|\/)skills\/([^\/\"']+?)(?:\/SKILL\.md|\/scripts\/[^\/\"']+)/i.exec(normalized);
    if (!match)
        return null;
    return { name: skillNameValue(match[1]), evidenceType: /\/SKILL\.md/i.test(match[0]) ? "resource-read" : "script-execution" };
}
function structuredSkillName(record, payload, payloadType) {
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
    if (explicit)
        return explicit;
    if (payloadType?.includes("skill"))
        return skillNameValue(payload.input, payload.arguments, payload.parameters, payload.skill, payload.name);
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
function usageTotal(usage) {
    return usage?.totalTokens ?? null;
}
function completeUsageSnapshot(value) {
    const usage = usageValues(value);
    return usageTotal(usage) === null ? null : usage;
}
function callFromUsage(sessionId, callId, timestamp, model, provider, turnId, usage) {
    const totalTokens = usage.totalTokens ?? (usage.inputTokens !== null && usage.outputTokens !== null && usage.reasoningTokens !== null
        ? usage.inputTokens + usage.outputTokens + usage.reasoningTokens
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
        turnId,
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
    "token_usage_record", "task_started", "task_complete", "task_completed", "item_started", "item_completed", "compacted",
    "turn_aborted", "interrupted", "error", "compaction", "subagent", "skill", "skill_input", "skill_invocation", "skill_listing", "skill-listing",
]);
function accountingSensitiveCodexType(type) {
    return /usage|token|response|assistant|message|tool|call|turn|retry|interrupt|compact|subagent|error/i.test(type);
}
function responseUsage(record, payload) {
    const event = firstObject(isType(record, payload, "raw_response_completed") ? payload : null, isType(record, payload, "raw_response_completed_event") ? payload : null, isType(record, payload, "token_usage_record") ? payload : null, payload.event, record.event);
    if (!event)
        return null;
    const eventType = stringValue(event.type, event.kind);
    if (eventType && eventType !== "raw_response_completed" && eventType !== "raw_response_completed_event" && eventType !== "token_usage_record") {
        return null;
    }
    const usage = usageValues(event.usage ?? event.token_usage ?? event.tokenUsage);
    const hasUsage = Object.values(usage).some((value) => value !== null);
    if (!hasUsage)
        return null;
    return {
        id: stringValue(event.response_id, event.responseId, event.id),
        usage,
        turnId: stringValue(event.turn_id, event.turnId, payload.turn_id, payload.turnId),
        turnTokenUsage: completeUsageSnapshot(event.turn_token_usage ?? event.turnTokenUsage ?? payload.turn_token_usage ?? payload.turnTokenUsage),
        threadTokenUsage: completeUsageSnapshot(event.thread_token_usage ?? event.threadTokenUsage ?? payload.thread_token_usage ?? payload.threadTokenUsage),
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
    const item = firstObject(payload.item, payload.tool_item, payload.toolItem);
    const callId = stringValue(payload.call_id, payload.callId, payload.tool_call_id, payload.toolCallId, item?.call_id, item?.callId, item?.id);
    if (!callId)
        return null;
    const itemType = stringValue(item?.type)?.toLowerCase() ?? "";
    const isResult = type.includes("output") || type.includes("result") || type.includes("completed") || itemType.includes("output") || itemType.includes("result");
    const isCall = type.includes("function_call") || type.includes("custom_tool_call") || type.includes("tool_call") || type.includes("shell_command") || type === "item_started" || itemType.includes("call") || itemType.includes("command");
    if (!isCall && !isResult)
        return null;
    const toolName = stringValue(payload.name, payload.tool_name, payload.toolName, item?.name, item?.tool_name, item?.toolName) ?? "unknown-tool";
    const input = getNested(payload, "arguments", "input", "command", "query") ?? getNested(item, "arguments", "input", "command", "query");
    const output = getNested(payload, "output", "result", "content", "stdout", "stderr") ?? getNested(item, "output", "result", "content", "stdout", "stderr");
    return {
        kind: isResult ? "result" : "call",
        callId,
        toolName,
        inputBytes: isResult ? null : byteLength(input),
        resultBytes: isResult ? byteLength(output) : null,
        resultChars: isResult ? characterLength(output) : null,
        isError: booleanValue(payload.is_error, payload.isError, payload.error, item?.is_error, item?.isError, item?.error),
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
function ensureTurn(pending, turnId, timestamp) {
    if (!turnId)
        return null;
    const existing = pending.turns.find((turn) => turn.turnId === turnId);
    if (existing) {
        if (timestamp && (!existing.startedAt || Date.parse(existing.startedAt) > Date.parse(timestamp)))
            existing.startedAt = timestamp;
        return existing;
    }
    const turn = {
        sessionId: pending.session.sessionId,
        turnId,
        ordinal: pending.turns.length + 1,
        startedAt: timestamp,
        endedAt: null,
        durationMs: null,
        timeToFirstTokenMs: null,
        status: "open",
        timingProvenance: timestamp ? "reported" : "unavailable",
    };
    pending.turns.push(turn);
    return turn;
}
function updateTurnFromTask(pending, payload, timestamp, complete) {
    const turnId = stringValue(payload.turn_id, payload.turnId, payload.task_id, payload.taskId, payload.id);
    const turn = ensureTurn(pending, turnId, timestamp);
    if (!turn)
        return;
    const startedAt = timestampValue(payload.started_at, payload.startedAt, payload.start_time, payload.startTime);
    const endedAt = timestampValue(payload.ended_at, payload.endedAt, payload.end_time, payload.endTime) ?? (complete ? timestamp : null);
    if (startedAt)
        turn.startedAt = startedAt;
    if (endedAt)
        turn.endedAt = endedAt;
    const durationMs = numberValue(payload.duration_ms, payload.durationMs);
    if (durationMs !== null) {
        turn.durationMs = durationMs;
        turn.timingProvenance = "reported";
    }
    const ttft = numberValue(payload.time_to_first_token_ms, payload.timeToFirstTokenMs);
    if (ttft !== null) {
        turn.timeToFirstTokenMs = ttft;
        turn.timingProvenance = "reported";
    }
    if (complete) {
        const status = stringValue(payload.status, payload.outcome, payload.stop_reason, payload.stopReason)?.toLowerCase() ?? "";
        turn.status = /error|fail/.test(status) || payload.error ? "error" : /abort|interrupt|cancel/.test(status) ? "interrupted" : "ok";
    }
}
function appendLifecycle(pending, event) {
    const duplicate = pending.lifecycle.some((existing) => existing.kind === event.kind &&
        existing.relatedId === event.relatedId &&
        existing.timestamp === event.timestamp &&
        existing.turnId === event.turnId);
    if (!duplicate)
        pending.lifecycle.push(event);
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
                // A subagent rollout can repeat the parent's SessionMeta after its own
                // metadata. Keep the first Session identity for the file so child
                // responses cannot be reattributed to the parent Session.
                const declaredSessionId = stringValue(payload.id, payload.session_id, payload.sessionId, payload.thread_id, payload.threadId);
                const firstSessionMeta = !activeSessionId;
                if (firstSessionMeta) {
                    activeSessionId = declaredSessionId
                        ?? sessionIdFor(file, fallbackIndex++);
                }
                const selectedSessionId = activeSessionId;
                sessionId = selectedSessionId;
                if (!pendingById.has(selectedSessionId)) {
                    pendingById.set(selectedSessionId, {
                        session: {
                            harness: "codex",
                            sessionId: selectedSessionId,
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
                        turns: [],
                        turnTokenSnapshots: new Map(),
                        threadTokenSnapshot: null,
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
                if (firstSessionMeta || declaredSessionId === activeSessionId) {
                    mergeSession(pendingById.get(selectedSessionId), payload, timestamp);
                }
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
                turns: [],
                turnTokenSnapshots: new Map(),
                threadTokenSnapshot: null,
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
                    if (!timestamp)
                        pending.missingTimestamp = true;
                }
                continue;
            }
            const sourceLocation = redactedSource(file);
            const evidenceTurnId = stringValue(payload.turn_id, payload.turnId) ?? pending.currentTurnId;
            const isListing = recordType === "skill-listing" || recordType === "skill_listing" || payloadType === "skill-listing" || payloadType === "skill_listing";
            const listingNames = listedSkillNames(record.available_skills, record.availableSkills, record.skill_listing, record.skillListing, record.skills, payload.available_skills, payload.availableSkills, payload.skill_listing, payload.skillListing, payload.skills);
            for (const skillName of listingNames)
                pending.skillEvidence.push(skillRecord(sessionId, skillName, "available", "listing", evidenceTurnId, null, timestamp, sourceLocation, "reported"));
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
                if (!pathEvidence)
                    continue;
                const evidenceId = stringValue(payload.call_id, payload.callId, payload.id, record.id);
                pending.skillEvidence.push(skillRecord(sessionId, pathEvidence.name, "invoked", pathEvidence.evidenceType, evidenceTurnId, evidenceId, timestamp, sourceLocation, "derived"));
            }
            if (isType(record, payload, "turn_context")) {
                mergeSession(pending, payload, timestamp);
                pending.currentModel = stringValue(payload.model, payload.model_name, payload.modelName) ?? pending.currentModel;
                pending.currentProvider = stringValue(payload.model_provider, payload.modelProvider, payload.provider) ?? pending.currentProvider;
                pending.currentTurnId = stringValue(payload.turn_id, payload.turnId) ?? pending.currentTurnId;
                ensureTurn(pending, pending.currentTurnId, timestamp);
            }
            const eventType = stringValue(payload.type, payload.event_type, payload.eventType, record.type)?.toLowerCase();
            if (eventType === "task_started")
                updateTurnFromTask(pending, payload, timestamp, false);
            if (eventType === "task_complete" || eventType === "task_completed")
                updateTurnFromTask(pending, payload, timestamp, true);
            const model = stringValue(payload.model, payload.model_name, payload.modelName) ?? pending.currentModel;
            const provider = stringValue(payload.model_provider, payload.modelProvider, payload.provider) ?? pending.currentProvider;
            const response = responseUsage(record, payload);
            if (response) {
                const responseTurnId = response.turnId ?? pending.currentTurnId;
                ensureTurn(pending, responseTurnId, timestamp);
                if (responseTurnId && response.turnTokenUsage)
                    pending.turnTokenSnapshots.set(responseTurnId, response.turnTokenUsage);
                if (response.threadTokenUsage)
                    pending.threadTokenSnapshot = response.threadTokenUsage;
                const call = callFromUsage(sessionId, response.id, timestamp, model, provider, responseTurnId, response.usage);
                if (!call.timestamp)
                    pending.missingTimestamp = true;
                const existingIndex = response.id
                    ? pending.rawCalls.findIndex((candidate) => candidate.callId === response.id)
                    : -1;
                if (existingIndex >= 0) {
                    const existing = pending.rawCalls[existingIndex];
                    const existingCompleteness = Object.values(existing).filter((value) => value !== null && value !== undefined).length;
                    const callCompleteness = Object.values(call).filter((value) => value !== null && value !== undefined).length;
                    if (callCompleteness > existingCompleteness)
                        pending.rawCalls[existingIndex] = call;
                }
                else {
                    pending.rawCalls.push(call);
                }
            }
            const tokenCount = tokenCountUsage(record, payload);
            if (tokenCount) {
                const call = callFromUsage(sessionId, tokenCount.id, timestamp, model, provider, pending.currentTurnId, tokenCount.usage);
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
                        turnId: evidenceTurnId,
                        startedAt: eventType === "item_started" ? timestamp : null,
                        endedAt: null,
                        durationMs: null,
                        isError: tool.isError,
                    });
                }
                else {
                    const existing = pending.toolCalls.find((candidate) => candidate.callId === tool.callId);
                    if (existing) {
                        existing.resultBytes = tool.resultBytes;
                        existing.resultChars = tool.resultChars;
                        existing.isError = tool.isError ?? existing.isError;
                        existing.turnId = existing.turnId ?? evidenceTurnId;
                        existing.endedAt = timestamp;
                        const durationMs = numberValue(payload.duration_ms, payload.durationMs);
                        if (durationMs !== null)
                            existing.durationMs = durationMs;
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
                            turnId: evidenceTurnId,
                            startedAt: null,
                            endedAt: timestamp,
                            durationMs: numberValue(payload.duration_ms, payload.durationMs),
                            isError: tool.isError,
                        });
                    }
                }
            }
            if (isType(record, payload, "event_msg") || eventType === "compacted" || eventType === "compaction") {
                if (eventType === "error" || eventType === "stream_error") {
                    const last = pending.rawCalls[pending.rawCalls.length - 1] ?? pending.incrementalCalls[pending.incrementalCalls.length - 1];
                    if (last)
                        last.status = "error";
                    appendLifecycle(pending, { sessionId, timestamp, kind: "retry", relatedId: last?.callId ?? null, turnId: evidenceTurnId });
                    if (!timestamp)
                        pending.missingTimestamp = true;
                }
                if (eventType === "turn_aborted" || eventType === "interrupted") {
                    const last = pending.rawCalls[pending.rawCalls.length - 1] ?? pending.incrementalCalls[pending.incrementalCalls.length - 1];
                    if (last)
                        last.status = "interrupted";
                    appendLifecycle(pending, { sessionId, timestamp, kind: "interrupted", relatedId: last?.callId ?? null, turnId: evidenceTurnId });
                    if (!timestamp)
                        pending.missingTimestamp = true;
                }
                if (eventType?.includes("subagent")) {
                    appendLifecycle(pending, { sessionId, timestamp, kind: "subagent", relatedId: stringValue(payload.id, payload.related_id, payload.relatedId), turnId: evidenceTurnId });
                    if (!timestamp)
                        pending.missingTimestamp = true;
                }
                if (eventType?.includes("compaction") || eventType === "compacted") {
                    appendLifecycle(pending, { sessionId, timestamp, kind: "compaction", relatedId: stringValue(payload.id, payload.compaction_id, payload.compactionId), turnId: evidenceTurnId });
                    if (!timestamp)
                        pending.missingTimestamp = true;
                }
            }
        }
    }
    const sessions = [];
    const turns = [];
    const modelCalls = [];
    const toolCalls = [];
    const lifecycle = [];
    const skillEvidence = [];
    let unsupportedSessions = 0;
    let missingTimestampSessions = 0;
    let responseTotal = 0;
    let responseComplete = true;
    let turnTotal = 0;
    let turnComplete = true;
    let accountedSessionCount = 0;
    const reconciledSessionIds = [];
    const mismatchedSessionIds = [];
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
        turns.push(...pending.turns);
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
            if (!call.timestamp || Number.isNaN(Date.parse(call.timestamp)) || Date.parse(call.timestamp) < scope.since.getTime())
                continue;
            modelCalls.push(call);
        }
        // A selected Session can contain only lifecycle/tool records (for example a
        // subagent that never reached a model response). It contributes no Token
        // total and must not make the Usage invariant unavailable for Sessions that
        // do have exact response records.
        if (calls.length === 0)
            continue;
        accountedSessionCount += 1;
        const sessionResponseComplete = calls.every((call) => call.totalTokens !== null);
        const sessionResponseTotal = sessionResponseComplete
            ? calls.reduce((sum, call) => sum + call.totalTokens, 0)
            : null;
        const sessionTurnComplete = pending.turnTokenSnapshots.size > 0 && [...pending.turnTokenSnapshots.values()].every((usage) => usageTotal(usage) !== null);
        const sessionTurnTotal = sessionTurnComplete
            ? [...pending.turnTokenSnapshots.values()].reduce((sum, usage) => sum + usageTotal(usage), 0)
            : null;
        if (!sessionResponseComplete)
            responseComplete = false;
        else
            responseTotal += sessionResponseTotal;
        if (!sessionTurnComplete)
            turnComplete = false;
        else
            turnTotal += sessionTurnTotal;
        if (sessionResponseTotal !== null &&
            sessionTurnTotal !== null &&
            sessionResponseTotal !== sessionTurnTotal) {
            mismatchedSessionIds.push(pending.session.sessionId);
        }
        else if (sessionResponseTotal !== null && sessionTurnTotal !== null) {
            reconciledSessionIds.push(pending.session.sessionId);
        }
    }
    const tokenAccounting = accountedSessionCount === 0 || !responseComplete
        ? { responseTotal: responseComplete ? responseTotal : null, turnTotal: turnComplete ? turnTotal : null, threadTotal: null, reconciledSessionIds, mismatchedSessionIds, status: "unavailable", method: "single-response Usage is required before cumulative per-Turn snapshots can reconcile" }
        : turnComplete && mismatchedSessionIds.length === 0
            ? { responseTotal, turnTotal, threadTotal: null, reconciledSessionIds, mismatchedSessionIds, status: "reconciled", method: "deduplicated exact response Usage equals the latest cumulative per-Turn snapshot within each Token-bearing Session" }
            : { responseTotal, turnTotal: turnComplete ? turnTotal : null, threadTotal: null, reconciledSessionIds, mismatchedSessionIds, status: "mismatch", method: "deduplicated exact response Usage did not equal the latest cumulative per-Turn snapshot for every Token-bearing Session" };
    if (mismatchedSessionIds.length > 0)
        coverage.warnings.push("Some Codex Sessions have Turn snapshots that do not reconcile to their per-response Usage; only individually reconciled Sessions are eligible for AI analysis.");
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
        turns: turns.sort((a, b) => a.sessionId.localeCompare(b.sessionId) || (a.ordinal ?? Number.MAX_SAFE_INTEGER) - (b.ordinal ?? Number.MAX_SAFE_INTEGER)),
        modelCalls,
        lifecycle,
        toolCalls,
        skillEvidence,
        tokenAccounting,
        coverage,
    };
}
