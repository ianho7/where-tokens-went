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
exports.readCodexResponseOutput = readCodexResponseOutput;
exports.resolveCodexProvenance = resolveCodexProvenance;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function sha256(value) {
    return (0, node_crypto_1.createHash)("sha256").update(value).digest("hex");
}
function fail(code) {
    throw new Error(code);
}
function stringField(value, code) {
    if (typeof value !== "string" || value.length === 0)
        fail(code);
    return value;
}
function numberField(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
function isoTimestamp(value, code) {
    const result = stringField(value, code);
    if (!Number.isFinite(Date.parse(result)))
        fail(code);
    return result;
}
function recordOrdinal(record) {
    if (typeof record.ordinal !== "number" || !Number.isInteger(record.ordinal) || record.ordinal < 0)
        fail("CODEX_PROVENANCE_RECORD_ORDINAL_INVALID");
    return record.ordinal;
}
function recordPayload(record) {
    if (!isRecord(record.payload))
        fail("CODEX_PROVENANCE_PAYLOAD_INVALID");
    return record.payload;
}
function outputText(payload) {
    const content = payload.content;
    if (!Array.isArray(content))
        fail("CODEX_PROVENANCE_RESPONSE_CONTENT_MISSING");
    const textBlocks = content.filter((item) => isRecord(item) && (item.type === "output_text" || item.type === "text") && typeof item.text === "string");
    if (textBlocks.length !== 1)
        fail("CODEX_PROVENANCE_RESPONSE_CONTENT_AMBIGUOUS");
    return textBlocks[0].text;
}
function normalizedUsage(payload) {
    if (!isRecord(payload.usage))
        return null;
    const usage = payload.usage;
    return {
        inputTokens: numberField(usage.input_tokens),
        outputTokens: numberField(usage.output_tokens),
        totalTokens: numberField(usage.total_tokens),
    };
}
function tokenValue(usage, metric) {
    if (!usage)
        return null;
    return metric === "output_tokens" ? usage.outputTokens : usage.totalTokens;
}
function turnIdFromResponse(payload) {
    const metadata = payload.internal_chat_message_metadata_passthrough;
    return isRecord(metadata) && typeof metadata.turn_id === "string" ? metadata.turn_id : null;
}
function terminalTokenEvent(records, usageOrdinal, expectedUsage) {
    const afterUsage = records.filter((record) => recordOrdinal(record) > usageOrdinal);
    const nextUsage = afterUsage.find((record) => record.type === "token_usage_record");
    const candidates = afterUsage.filter((record) => {
        const ordinal = recordOrdinal(record);
        if (nextUsage && ordinal > recordOrdinal(nextUsage))
            return false;
        if (record.type !== "event_msg")
            return false;
        const payload = isRecord(record.payload) ? record.payload : null;
        return payload?.type === "token_count";
    });
    // Codex can emit intermediate token_count events. The terminal event is
    // the last token_count before the next usage record (or end of rollout).
    const tokenRecord = candidates[candidates.length - 1];
    if (!tokenRecord)
        fail("CODEX_PROVENANCE_TERMINAL_TOKEN_EVENT_MISSING");
    const payload = recordPayload(tokenRecord);
    const info = isRecord(payload.info) ? payload.info : null;
    const lastUsage = info && isRecord(info.last_token_usage) ? info.last_token_usage : null;
    if (expectedUsage && lastUsage && expectedUsage.totalTokens !== numberField(lastUsage.total_tokens))
        fail("CODEX_PROVENANCE_TOKEN_EVENT_MISMATCH");
    return { record: tokenRecord, payload };
}
async function loadRollout(rolloutPathValue) {
    const rolloutPath = path.resolve(rolloutPathValue);
    const ownedRoot = path.resolve(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "sessions");
    const relative = path.relative(ownedRoot, rolloutPath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
        fail("CODEX_PROVENANCE_ROLLOUT_NOT_HARNESS_OWNED");
    const bytes = await (0, promises_1.readFile)(rolloutPath).catch(() => fail("CODEX_PROVENANCE_ROLLOUT_UNREADABLE"));
    const rolloutHash = sha256(bytes);
    const records = [];
    for (const line of bytes.toString("utf8").split(/\r?\n/)) {
        if (!line.trim())
            continue;
        try {
            const parsed = JSON.parse(line);
            if (!isRecord(parsed))
                fail("CODEX_PROVENANCE_RECORD_INVALID");
            // Codex JSONL does not promise an ordinal field. Line position is the
            // immutable, adapter-owned ordering identity for this rollout.
            records.push({ ...parsed, ordinal: records.length + 1 });
        }
        catch (error) {
            if (error instanceof Error && error.message.startsWith("CODEX_PROVENANCE_"))
                throw error;
            fail("CODEX_PROVENANCE_JSONL_UNPARSEABLE");
        }
    }
    return { rolloutPath, rolloutHash, records };
}
function validateSessionAndResponse(records, request) {
    const session = records.find((record) => record.type === "session_meta");
    const sessionPayload = session ? recordPayload(session) : null;
    if (!sessionPayload || (sessionPayload.originator !== "Codex Desktop" && sessionPayload.originator !== "Codex CLI") || typeof sessionPayload.cli_version !== "string" || typeof sessionPayload.model_provider !== "string")
        fail("CODEX_PROVENANCE_HARNESS_MARKER_MISSING");
    const sessionIdentities = sessionPayload ? [sessionPayload.session_id, sessionPayload.id].filter((value) => typeof value === "string" && value.length > 0) : [];
    if (!sessionPayload || !sessionIdentities.includes(request.sessionId))
        fail("CODEX_PROVENANCE_SESSION_MISMATCH");
    const responseRecord = records.find((record) => {
        if (record.type !== "response_item")
            return false;
        const payload = isRecord(record.payload) ? record.payload : null;
        return payload?.type === "message" && payload.id === request.responseItemId;
    });
    if (!responseRecord)
        fail("CODEX_PROVENANCE_RESPONSE_ITEM_MISSING");
    const responsePayload = recordPayload(responseRecord);
    if (turnIdFromResponse(responsePayload) !== request.turnId)
        fail("CODEX_PROVENANCE_RESPONSE_TURN_MISMATCH");
    return { responseRecord, responsePayload };
}
async function readCodexResponseOutput(request) {
    const loaded = await loadRollout(request.rolloutPath);
    const { responsePayload } = validateSessionAndResponse(loaded.records, request);
    const text = outputText(responsePayload);
    const provenance = await resolveCodexProvenance({ ...request, rawOutput: text });
    return { text, outputHash: sha256(text), provenance };
}
async function resolveCodexProvenance(request) {
    const { rolloutPath, rolloutHash, records } = await loadRollout(request.rolloutPath);
    const { responseRecord, responsePayload } = validateSessionAndResponse(records, request);
    const responseRaw = outputText(responsePayload);
    const responseHash = sha256(responseRaw);
    const outputHash = request.rawOutput === null ? responseHash : sha256(request.rawOutput);
    if (request.rawOutput !== null && (responseHash !== outputHash || responseRaw !== request.rawOutput))
        fail("CODEX_PROVENANCE_OUTPUT_HASH_MISMATCH");
    const usageRecords = records.filter((record) => {
        if (record.type !== "token_usage_record")
            return false;
        const payload = isRecord(record.payload) ? record.payload : null;
        return payload?.session_id === request.sessionId && payload.thread_id === request.threadId && payload.turn_id === request.turnId;
    });
    const usageRecord = usageRecords.at(-1);
    if (!usageRecord)
        fail("CODEX_PROVENANCE_TOKEN_USAGE_RECORD_MISSING");
    const usagePayload = recordPayload(usageRecord);
    const usage = normalizedUsage(usagePayload);
    const terminal = terminalTokenEvent(records, recordOrdinal(usageRecord), usage);
    const startedRecord = records.find((record) => {
        if (record.type !== "event_msg")
            return false;
        const payload = isRecord(record.payload) ? record.payload : null;
        return payload?.type === "task_started" && payload.turn_id === request.turnId;
    });
    const startedAt = startedRecord ? isoTimestamp(startedRecord.timestamp, "CODEX_PROVENANCE_START_TIME_MISSING") : isoTimestamp(responseRecord.timestamp, "CODEX_PROVENANCE_START_TIME_MISSING");
    const endedAt = isoTimestamp(terminal.record.timestamp, "CODEX_PROVENANCE_END_TIME_MISSING");
    if (Date.parse(startedAt) > Date.parse(endedAt))
        fail("CODEX_PROVENANCE_TIME_RANGE_INVALID");
    const responseId = stringField(usagePayload.response_id, "CODEX_PROVENANCE_RESPONSE_ID_MISSING");
    return {
        harness: "codex",
        rolloutPath,
        rolloutHash,
        sessionId: request.sessionId,
        threadId: request.threadId,
        turnId: request.turnId,
        responseItemId: request.responseItemId,
        responseItemOrdinal: recordOrdinal(responseRecord),
        tokenUsageRecordOrdinal: recordOrdinal(usageRecord),
        tokenEventOrdinal: recordOrdinal(terminal.record),
        responseId,
        startedAt,
        endedAt,
        usage,
        tokenMetric: request.tokenMetric,
        tokenValue: tokenValue(usage, request.tokenMetric),
        outputHash,
    };
}
