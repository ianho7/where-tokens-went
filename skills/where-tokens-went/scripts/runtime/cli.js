#!/usr/bin/env node
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
exports.parseArgs = parseArgs;
exports.main = main;
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
const bundle_version_1 = require("./bundle-version");
const analysis_1 = require("./analysis");
const claude_reader_1 = require("./claude-reader");
const codex_reader_1 = require("./codex-reader");
const content_evidence_1 = require("./content-evidence");
const key_session_analysis_1 = require("./key-session-analysis");
const rates_1 = require("./rates");
const report_run_1 = require("./report-run");
const lane_contract_1 = require("./lane-contract");
const report_1 = require("./report");
const skill_insights_1 = require("./skill-insights");
function usage() {
    return [
        "Usage: where-tokens-went inspect --harness <codex> --cwd <absolute-path> [--since 7d] [--format json|text] [--locale zh-CN|en-US] [--font <font-file>] [--font-family <name>] [--pricing litellm] [--view full|usage|window|report|tools|week|share]",
        "       where-tokens-went inspect --harness <codex> --all-projects [--since 7d] [--format json|text] [--locale zh-CN|en-US] [--font <font-file>] [--font-family <name>] [--pricing litellm] [--view full|usage|window|report|tools|week|share]",
        "       where-tokens-went compose-report --locale zh-CN|en-US --font <font-file> [--font-family <name>] --html <final-path> < composition JSON envelope",
        "       where-tokens-went render-report --json <report.json> --html <final-path> [--run-dir <directory>]",
        "       where-tokens-went report-run preflight [--skill-root <path>]",
        "       where-tokens-went report-run advance --run-dir <directory> [--html <final-path>] [--ui completed|queued|failed|unavailable]",
        "       where-tokens-went report-run run-all start --harness <codex> (--cwd <absolute-path>|--all-projects) [--since 7d] [--locale zh-CN|en-US] [--pricing litellm] [--run-dir <directory>]",
        "       where-tokens-went report-run run-all finish --run-dir <directory> [--html <final-path>]",
        "       where-tokens-went report-run prepare --harness <codex> (--cwd <absolute-path>|--all-projects) [--since 7d] [--locale zh-CN|en-US] [--pricing litellm] [--run-dir <directory>]",
        "       where-tokens-went report-run evidence --run-dir <directory> < evidence selection JSON",
        "       where-tokens-went report-run evidence --run-dir <directory> --auto",
        "       where-tokens-went report-run ai-start|ai-accept|ai-fallback --run-dir <directory> --lane <lane> ...",
        "       where-tokens-went report-run compose --run-dir <directory> --locale zh-CN|en-US (--json|--html <final-path>)",
        "       where-tokens-went report-run event|status|finalize|cleanup --run-dir <directory> ...",
    ].join("\n");
}
function parseDuration(value, now = Date.now()) {
    const match = /^(\d+)([hdwm])$/i.exec(value.trim());
    if (!match)
        throw new Error(`Invalid --since duration: ${value}. Use values such as 7d, 24h, or 2w.`);
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const milliseconds = unit === "h"
        ? amount * 60 * 60 * 1000
        : unit === "d"
            ? amount * 24 * 60 * 60 * 1000
            : unit === "w"
                ? amount * 7 * 24 * 60 * 60 * 1000
                : amount * 30 * 24 * 60 * 60 * 1000;
    return new Date(now - milliseconds);
}
function requireValue(args, index, flag) {
    const value = args[index + 1];
    if (!value || value.startsWith("--"))
        throw new Error(`${flag} requires a value.\n${usage()}`);
    return value;
}
function parseArgs(args, now = Date.now()) {
    if (args[0] !== "inspect")
        throw new Error(`Use inspect or compose-report.\n${usage()}`);
    let harness = null;
    let cwd = null;
    let allProjects = false;
    let since = parseDuration("7d", now);
    let sinceExplicit = false;
    let format = "json";
    let locale = "en-US";
    let view = "full";
    let htmlPath = null;
    let sharePath = null;
    let fontPath = null;
    let fontFamily = null;
    let pricing = "litellm";
    for (let index = 1; index < args.length; index += 1) {
        const flag = args[index];
        if (flag === "--harness") {
            const value = requireValue(args, index, flag);
            index += 1;
            if (value === "claude")
                throw new Error("Claude Code support is paused. 此调用未读取 Claude Code 或 Codex 历史记录。请在 Codex 中调用 where-tokens-went。\n" + usage());
            if (value !== "codex")
                throw new Error(`Unsupported Harness ${value}; the active Harness is codex.\n${usage()}`);
            harness = value;
        }
        else if (flag === "--cwd") {
            cwd = requireValue(args, index, flag);
            index += 1;
            if (!path.isAbsolute(cwd))
                throw new Error("--cwd must be an absolute path.");
        }
        else if (flag === "--all-projects") {
            allProjects = true;
        }
        else if (flag === "--since") {
            since = parseDuration(requireValue(args, index, flag), now);
            sinceExplicit = true;
            index += 1;
        }
        else if (flag === "--format") {
            const value = requireValue(args, index, flag);
            index += 1;
            if (value !== "json" && value !== "text")
                throw new Error("--format must be json or text.");
            format = value;
        }
        else if (flag === "--locale" || flag === "--lang") {
            locale = (0, report_1.normalizeLocale)(requireValue(args, index, flag));
            index += 1;
        }
        else if (flag === "--pricing") {
            const value = requireValue(args, index, flag);
            index += 1;
            if (value !== "litellm")
                throw new Error("--pricing must be litellm.");
            pricing = value;
        }
        else if (flag === "--view") {
            const value = requireValue(args, index, flag);
            index += 1;
            if (!["full", "usage", "window", "report", "tools", "week", "share", "question"].includes(value)) {
                throw new Error("--view must be full, usage, window, report, tools, week, share, or question.\n" + usage());
            }
            view = value;
        }
        else if (flag === "--html") {
            htmlPath = requireValue(args, index, flag);
            index += 1;
        }
        else if (flag === "--share") {
            sharePath = requireValue(args, index, flag);
            index += 1;
        }
        else if (flag === "--font") {
            fontPath = requireValue(args, index, flag);
            index += 1;
        }
        else if (flag === "--font-family") {
            fontFamily = requireValue(args, index, flag);
            index += 1;
        }
        else {
            throw new Error(`Unknown argument: ${flag}.\n${usage()}`);
        }
    }
    if (!harness)
        throw new Error(`--harness is required.\n${usage()}`);
    if (cwd && allProjects)
        throw new Error("--cwd and --all-projects are mutually exclusive.");
    if (!cwd && !allProjects)
        throw new Error("Provide --cwd or --all-projects.");
    if (fontFamily && !fontPath)
        throw new Error("--font-family requires --font <font-file>.");
    return { harness, cwd, allProjects, since, sinceExplicit, format, locale, view, htmlPath, sharePath, fontPath, fontFamily, pricing };
}
async function readHarness(harness, scope) {
    return harness === "codex"
        ? (0, codex_reader_1.readCodex)(scope)
        : (0, claude_reader_1.readClaude)(scope);
}
function differenceEvidence(left, right, label) {
    if (typeof left.value !== "number" || typeof right.value !== "number") {
        return { value: null, provenance: "unavailable", method: label + " requires complete numeric values in both periods" };
    }
    return { value: left.value - right.value, provenance: "derived", method: "current period minus previous period for " + label };
}
function snapshotOf(result) {
    const { view: _view, weekComparison: _comparison, ...snapshot } = result;
    return snapshot;
}
function inRange(timestamp, from, to) {
    if (!timestamp)
        return false;
    const value = Date.parse(timestamp);
    return !Number.isNaN(value) && value >= from.getTime() && value < to.getTime();
}
function sliceRead(read, from, to) {
    const modelCalls = read.modelCalls.filter((call) => inRange(call.timestamp, from, to));
    const toolCalls = read.toolCalls.filter((call) => inRange(call.timestamp, from, to));
    const lifecycle = read.lifecycle.filter((event) => inRange(event.timestamp, from, to));
    const skillEvidence = read.skillEvidence?.filter((record) => inRange(record.timestamp, from, to));
    const sessionCosts = read.sessionCosts?.filter((record) => inRange(record.timestamp, from, to));
    const sessionIds = new Set([
        ...modelCalls.map((call) => call.sessionId),
        ...toolCalls.map((call) => call.sessionId),
        ...lifecycle.map((event) => event.sessionId),
        ...(skillEvidence ?? []).map((record) => record.sessionId),
        ...(sessionCosts ?? []).map((record) => record.sessionId),
    ]);
    return {
        ...read,
        sessions: read.sessions.filter((session) => sessionIds.has(session.sessionId)),
        modelCalls,
        toolCalls,
        lifecycle,
        ...(read.skillEvidence ? { skillEvidence } : {}),
        ...(read.sessionCosts ? { sessionCosts } : {}),
    };
}
function missingWeekEvidence(label) {
    return { value: null, provenance: "unavailable", method: label + " was absent from one comparison period" };
}
function structureChanges(currentEntries, previousEntries, label) {
    const current = new Map(currentEntries.map((entry) => [entry.key, entry.value]));
    const previous = new Map(previousEntries.map((entry) => [entry.key, entry.value]));
    return [...new Set([...current.keys(), ...previous.keys()])]
        .sort()
        .map((key) => {
        const currentValue = current.get(key) ?? missingWeekEvidence(label + " current value for " + key);
        const previousValue = previous.get(key) ?? missingWeekEvidence(label + " previous value for " + key);
        return { key, current: currentValue, previous: previousValue, change: differenceEvidence(currentValue, previousValue, label + " " + key) };
    });
}
function makeWeekComparison(current, previous, currentFrom, currentTo, previousFrom) {
    return {
        currentFrom: currentFrom.toISOString(),
        currentTo: currentTo.toISOString(),
        previousFrom: previousFrom.toISOString(),
        previousTo: currentFrom.toISOString(),
        current: snapshotOf(current),
        previous: snapshotOf(previous),
        changes: {
            totalTokens: differenceEvidence(current.summary.totalTokens, previous.summary.totalTokens, "total tokens"),
            modelCallCount: differenceEvidence(current.summary.modelCallCount, previous.summary.modelCallCount, "model call count"),
            toolAmplifiedTokens: differenceEvidence(current.report.totalToolAmplifiedTokens, previous.report.totalToolAmplifiedTokens, "tool amplification"),
        },
        modelChanges: structureChanges(current.rankings.models, previous.rankings.models, "model tokens"),
        toolChanges: structureChanges(current.report.tools.map((entry) => ({ key: entry.key, value: entry.amplifiedTokens })), previous.report.tools.map((entry) => ({ key: entry.key, value: entry.amplifiedTokens })), "tool amplification"),
    };
}
function defaultOutputPath(harness, kind, extension) {
    return path.join(os.tmpdir(), "where-tokens-went-" + harness + "-" + kind + "-" + Date.now() + extension);
}
async function writeLocalFile(filePath, contents) {
    const absolute = path.resolve(filePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, contents, "utf8");
    return absolute;
}
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function parseComposeArgs(args) {
    let locale = "en-US";
    let htmlPath = null;
    let fontPath = null;
    let fontFamily = null;
    for (let index = 0; index < args.length; index += 1) {
        const flag = args[index];
        if (flag === "--locale" || flag === "--lang") {
            locale = (0, report_1.normalizeLocale)(requireValue(args, index, flag));
            index += 1;
        }
        else if (flag === "--html") {
            htmlPath = requireValue(args, index, flag);
            index += 1;
        }
        else if (flag === "--font") {
            fontPath = requireValue(args, index, flag);
            index += 1;
        }
        else if (flag === "--font-family") {
            fontFamily = requireValue(args, index, flag);
            index += 1;
        }
        else {
            throw new Error(`Unknown compose-report argument: ${flag}.\n${usage()}`);
        }
    }
    if (!htmlPath)
        throw new Error(`compose-report requires --html.\n${usage()}`);
    if (fontFamily && !fontPath)
        throw new Error("--font-family requires --font <font-file>.");
    return { locale, htmlPath, fontPath, fontFamily };
}
function reportFontConfig(fontPath, fontFamily) {
    return fontPath ? { filePath: fontPath, ...(fontFamily ? { family: fontFamily } : {}) } : undefined;
}
async function readStdin() {
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    return Buffer.concat(chunks).toString("utf8");
}
function extractRunDirectory(args) {
    let runDir = null;
    const rest = [];
    for (let index = 0; index < args.length; index += 1) {
        if (args[index] === "--run-dir") {
            if (runDir !== null)
                throw new Error("--run-dir may only be provided once.");
            runDir = requireValue(args, index, "--run-dir");
            index += 1;
        }
        else {
            rest.push(args[index]);
        }
    }
    return { runDir, rest };
}
function requireRunDirectory(runDir) {
    if (!runDir)
        throw new Error(`--run-dir is required.\n${usage()}`);
    return (0, report_run_1.assertLocalSensitiveRunDirectory)(runDir);
}
function parseLane(value) {
    if (value === "report-synthesis" || value === "key-session-analysis" || value === "skill-insights")
        return value;
    throw new Error("--lane must be report-synthesis, key-session-analysis, or skill-insights.");
}
function lanePromptHash(manifest, lane) {
    const hash = lane === "report-synthesis"
        ? manifest.promptHashes.reportSynthesis
        : lane === "key-session-analysis"
            ? manifest.promptHashes.keySessionAnalysis
            : manifest.promptHashes.skillInsights;
    if (!hash)
        throw new Error(`Report Run Prompt hash is unavailable for ${lane}.`);
    return hash;
}
function parseLaneCommandArgs(args) {
    const extracted = extractRunDirectory(args);
    let lane = null;
    for (let index = 0; index < extracted.rest.length; index += 1) {
        const flag = extracted.rest[index];
        if (flag !== "--lane")
            throw new Error(`Unknown lane command argument: ${flag}.`);
        lane = parseLane(requireValue(extracted.rest, index, "--lane"));
        index += 1;
    }
    if (!lane)
        throw new Error("--lane is required.");
    return { runDir: requireRunDirectory(extracted.runDir), lane };
}
function sha256Text(value) {
    return (0, node_crypto_1.createHash)("sha256").update(value, "utf8").digest("hex");
}
const SCENARIO_METADATA_KEYS = new Set(["id", "caseId", "split", "inputArtifact", "inputHash", "expectedOutcome", "originFailure", "snapshotId", "auditFingerprint", "createdAt"]);
function canonicalScenario(value) {
    if (Array.isArray(value))
        return value.map(canonicalScenario);
    if (!isRecord(value))
        return value;
    return Object.fromEntries(Object.keys(value)
        .filter((key) => !SCENARIO_METADATA_KEYS.has(key))
        .sort()
        .map((key) => [key, canonicalScenario(value[key])]));
}
function scenarioContentHash(raw) {
    return sha256Text(JSON.stringify(canonicalScenario(JSON.parse(raw))));
}
function runSummary(run) {
    return {
        runId: run.manifest.runId,
        runDir: run.runDir,
        manifestPath: run.manifestFile,
        tracePath: run.traceFile,
        status: run.manifest.status,
        scope: run.manifest.scope,
        auditFingerprint: run.manifest.auditFingerprint,
        bundleVersion: run.manifest.bundleVersion,
        topSessions: run.manifest.topSessions,
        artifacts: run.manifest.artifacts,
        stageStatus: run.manifest.stageStatus,
        traceCompleteness: run.manifest.traceCompleteness,
        traceErrorCode: run.manifest.traceErrorCode,
        totalDurationMs: run.manifest.totalDurationMs,
        promptHashes: run.manifest.promptHashes,
        runtimeHash: run.manifest.runtimeHash,
        executionMode: run.manifest.executionMode,
        executionModeReasonCode: run.manifest.executionModeReasonCode,
        warnings: run.manifest.warnings,
        laneStatus: run.manifest.laneStatus,
        deliveryStatus: run.manifest.deliveryStatus,
        cleanupStatus: run.manifest.cleanupStatus,
        degraded: run.manifest.degraded,
        uiDispatch: run.manifest.uiDispatch,
        laneArtifacts: run.manifest.laneArtifacts,
    };
}
function outputRunSummary(run, extra = {}) {
    process.stdout.write(JSON.stringify({ ...runSummary(run), ...extra }) + "\n");
}
function scopeFromManifest(manifest) {
    const since = new Date(manifest.scope.since);
    const until = new Date(manifest.scope.until);
    if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime()))
        throw new Error("Report Run manifest has an invalid frozen time range.");
    return {
        cwd: manifest.scope.cwd,
        allProjects: manifest.scope.allProjects,
        since,
        until,
    };
}
async function readCanonicalAudit(run) {
    const value = await (0, report_run_1.readRunArtifact)(run.runDir, "audit");
    if (!isRecord(value))
        throw new Error("Report Run Audit artifact is malformed.");
    const audit = value;
    if (!isRecord(audit.scope) || !isRecord(audit.coverage) || !isRecord(audit.rankings))
        throw new Error("Report Run Audit artifact is malformed.");
    if (audit.scope.harness !== run.manifest.scope.harness || audit.scope.allProjects !== run.manifest.scope.allProjects) {
        throw new Error("Report Run Audit Scope does not match the manifest.");
    }
    if (audit.scope.since !== run.manifest.scope.since || audit.scope.until !== run.manifest.scope.until) {
        throw new Error("Report Run Audit time range does not match the manifest.");
    }
    const fingerprint = (0, key_session_analysis_1.auditFingerprint)(audit);
    if (run.manifest.auditFingerprint !== fingerprint)
        throw new Error("Report Run Audit fingerprint does not match the manifest.");
    return audit;
}
function positiveLimit(value, flag, fallback) {
    if (value === undefined)
        return fallback;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 100_000)
        throw new Error(`${flag} must be an integer between 1 and 100000.`);
    return value;
}
function parseEvidenceInput(input) {
    if (!input.trim())
        throw new Error("report-run evidence requires one JSON selection object on stdin.");
    const parsed = JSON.parse(input);
    const source = Array.isArray(parsed) ? { selections: parsed } : parsed;
    if (!isRecord(source) || !Array.isArray(source.selections))
        throw new Error("report-run evidence requires a selections array.");
    const selections = source.selections;
    if (!selections.every((selection) => isRecord(selection) && typeof selection.sessionId === "string" && Array.isArray(selection.turnIds) && selection.turnIds.every((turnId) => typeof turnId === "string") && typeof selection.selectionReason === "string" && typeof selection.unreadScope === "string")) {
        throw new Error("Each evidence selection requires sessionId, turnIds, selectionReason, and unreadScope.");
    }
    return {
        selections: selections,
        maxItemsPerSession: source.maxItemsPerSession === undefined ? undefined : positiveLimit(source.maxItemsPerSession, "maxItemsPerSession", 24),
        maxCharsPerItem: source.maxCharsPerItem === undefined ? undefined : positiveLimit(source.maxCharsPerItem, "maxCharsPerItem", 1200),
    };
}
function evidenceArtifactMatches(value, run, input) {
    if (!isRecord(value) || value.version !== 1 || value.runId !== run.manifest.runId || value.auditFingerprint !== run.manifest.auditFingerprint || JSON.stringify(value.scope) !== JSON.stringify(run.manifest.scope) || !Array.isArray(value.packets) || !Array.isArray(value.selections))
        return false;
    const maxItems = input.maxItemsPerSession ?? 24;
    const maxChars = input.maxCharsPerItem ?? 1200;
    return value.maxItemsPerSession === maxItems && value.maxCharsPerItem === maxChars && JSON.stringify(value.selections) === JSON.stringify(input.selections);
}
function packetSummary(packets) {
    return packets.map((packet) => ({
        sessionId: packet.sessionId,
        turnCount: packet.turnIds.length,
        itemCount: packet.items.length,
        truncatedItemCount: packet.items.filter((item) => item.truncated).length,
        unreadScope: packet.unreadScope,
        warningCount: packet.warnings.length,
    }));
}
async function writeAtomicLocal(filePath, contents) {
    const absolute = path.resolve(filePath);
    const temporary = absolute + ".tmp-" + process.pid + "-" + (0, node_crypto_1.randomUUID)();
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(temporary, contents, "utf8");
    try {
        await fs.rename(temporary, absolute);
    }
    catch (error) {
        await fs.unlink(temporary).catch(() => undefined);
        const atomicError = new Error(`Atomic replacement failed for ${path.basename(absolute)}.`);
        atomicError.code = "RUN_ATOMIC_REPLACE_FAILED";
        atomicError.cause = error;
        throw atomicError;
    }
    return absolute;
}
async function markPreparedRunFailed(run) {
    try {
        await (0, report_run_1.finalizeReportRun)(run, "failed");
    }
    catch {
        await (0, report_run_1.setReportRunStatus)(run, "failed").catch(() => undefined);
    }
}
async function recordPricingTiming(run, event) {
    await (0, report_run_1.recordCompletedRunSpan)(run, {
        phase: "price-request",
        operation: "litellm-" + event.kind,
        source: "network",
        startedAt: event.startedAt,
        endedAt: event.endedAt,
        durationMs: event.durationMs,
        status: event.outcome === "success" ? "completed" : "failed",
        metadata: {
            provider: event.provider,
            model: event.model,
            requestKind: event.kind,
            httpStatus: event.status,
            responseBytes: event.responseBytes,
            outcome: event.outcome,
        },
    });
}
async function prepareReportRunInternal(args, runDir, installedBundle) {
    const frozenNow = Date.now();
    const options = parseArgs(["inspect", ...args], frozenNow);
    if (options.view !== "full")
        throw new Error("report-run prepare only supports the full report workflow.");
    if (options.htmlPath || options.sharePath)
        throw new Error("report-run prepare does not write HTML or share output.");
    const scope = {
        harness: options.harness,
        cwd: options.cwd,
        allProjects: options.allProjects,
        since: options.since,
        until: new Date(frozenNow),
        locale: options.locale,
        bundleVersion: installedBundle.bundleVersion,
    };
    let run = null;
    try {
        run = await (0, report_run_1.createReportRun)(scope, runDir ?? undefined);
        await (0, report_run_1.withRunSpan)(run, { phase: "scope-freeze", operation: "freeze-report-scope", source: "runner" }, async () => undefined);
        await (0, report_run_1.withRunSpan)(run, { phase: "skill-read", operation: "verify-installed-skill", source: "filesystem" }, async () => undefined);
        const contract = await (0, report_run_1.withRunSpan)(run, { phase: "prompt-read", operation: "resolve-report-contract", source: "filesystem" }, async () => {
            const metadata = await (0, report_run_1.resolveRunContractMetadata)();
            if (!metadata.promptHashes.reportSynthesis || !metadata.promptHashes.keySessionAnalysis || !metadata.promptHashes.skillInsights)
                throw new Error("Authoritative Report Prompts are unavailable for this run.");
            if (!metadata.bundleVersion || metadata.bundleVersion.bundleVersion !== installedBundle.bundleVersion)
                throw new Error("The packaged bundle changed before Report Run preparation completed. Run npm run install-local.");
            return metadata;
        });
        await (0, report_run_1.setRunPromptHashes)(run, contract.promptHashes, contract.runtimeHash);
        const read = await (0, report_run_1.withRunSpan)(run, { phase: "history-read", operation: "read-historical-records", source: "filesystem" }, () => readHarness(scope.harness, scope));
        const before = await (0, report_run_1.withRunSpan)(run, { phase: "source-inventory", operation: "inventory-scoped-files-before", source: "filesystem" }, () => (0, report_run_1.captureSourceInventory)(scope.harness, read.sourceFiles));
        const pricing = await (0, report_run_1.withRunSpan)(run, { phase: "price-resolution", operation: "resolve-api-pricing", source: "runner" }, () => (0, rates_1.resolveApiPricing)(read.modelCalls, scope.harness, options.pricing, undefined, undefined, (event) => recordPricingTiming(run, event)));
        const audit = await (0, report_run_1.withRunSpan)(run, { phase: "deterministic-analysis", operation: "analyse-audit", source: "runner" }, async () => (0, analysis_1.analyseAudit)(scope, read, scope.harness, pricing));
        const after = await (0, report_run_1.withRunSpan)(run, { phase: "source-inventory", operation: "inventory-scoped-files-after", source: "filesystem", attempt: 2 }, () => (0, report_run_1.captureSourceInventory)(scope.harness, read.sourceFiles));
        await (0, report_run_1.setRunSourceInventory)(run, before, after);
        if (run.manifest.sourceInventory?.mutated === true && !audit.coverage.warnings.includes("History source files changed while the Audit was being read.")) {
            audit.coverage.warnings.push("History source files changed while the Audit was being read.");
        }
        await (0, report_run_1.writeRunArtifact)(run, "audit", audit);
        await (0, report_run_1.writeRunArtifact)(run, "firstUserMessages", read.firstUserMessages ?? []);
        await (0, report_run_1.setRunTopSessions)(run, audit.rankings.sessions, read.sessions);
        await (0, report_run_1.setRunAuditFingerprint)(run, (0, key_session_analysis_1.auditFingerprint)(audit));
        if (audit.rankings.sessions.length === 0) {
            await (0, report_run_1.setRunNoHistoryInScope)(run);
            const finalBundle = await (0, bundle_version_1.verifyInstalledSkill)();
            (0, report_run_1.assertRunBundleVersion)(run, finalBundle.bundleVersion);
            await (0, report_run_1.setReportRunStatus)(run, "prepared");
            return run;
        }
        const totalTasks = typeof audit.summary.sessionCount?.value === "number" ? audit.summary.sessionCount.value : 0;
        const candidatesResult = await (0, report_run_1.withRunSpan)(run, { phase: "skill-candidate-select", operation: "select-skill-candidates", source: "runner" }, async () => {
            return (0, skill_insights_1.selectSkillCandidates)(audit.report.skills ?? [], totalTasks);
        });
        const snapshot = await (0, report_run_1.withRunSpan)(run, { phase: "skill-snapshot", operation: "load-skill-snapshot", source: "filesystem" }, async () => {
            return (0, skill_insights_1.loadSkillSnapshot)(scope.harness, scope.cwd, candidatesResult.candidates, (0, key_session_analysis_1.auditFingerprint)(audit), candidatesResult.global);
        });
        const finalBundle = await (0, bundle_version_1.verifyInstalledSkill)();
        (0, report_run_1.assertRunBundleVersion)(run, finalBundle.bundleVersion);
        await (0, report_run_1.writeRunArtifact)(run, "skillSnapshot", snapshot);
        await (0, report_run_1.setReportRunStatus)(run, "prepared");
        return run;
    }
    catch (error) {
        if (run)
            await markPreparedRunFailed(run);
        throw error;
    }
}
async function reportRunPrepareMain(args) {
    const { runDir, rest } = extractRunDirectory(args);
    const installedBundle = await (0, bundle_version_1.verifyInstalledSkill)();
    const run = await prepareReportRunInternal(rest, runDir, installedBundle);
    outputRunSummary(run, { next: ["evidence", "report-synthesis", "key-session-analysis", "skill-insights", "compose", "finalize"] });
    return 0;
}
async function autoEvidenceRunInternal(run) {
    if (run.manifest.topSessions.length === 0) {
        return [];
    }
    const audit = await readCanonicalAudit(run);
    const input = await (0, report_run_1.withRunSpan)(run, { phase: "content-selection", operation: "auto-evidence-selection", source: "runner" }, async () => ({
        selections: (0, content_evidence_1.selectAutoEvidence)(audit, run.manifest.topSessions),
    }));
    const maxItemsPerSession = input.maxItemsPerSession ?? 24;
    const maxCharsPerItem = input.maxCharsPerItem ?? 1200;
    const existing = run.manifest.artifacts.evidence ? await (0, report_run_1.readRunArtifact)(run.runDir, "evidence") : null;
    if (existing !== null) {
        if (!evidenceArtifactMatches(existing, run, input))
            throw new Error("Report Run already contains Evidence for a different selection or limit; start a new run for a different request.");
        const cached = existing;
        await (0, report_run_1.recordCompletedRunSpan)(run, {
            phase: "content-read",
            operation: "reuse-content-evidence",
            source: "filesystem",
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
            durationMs: 0,
            status: "reused",
            metadata: { itemCount: cached.packets.reduce((sum, packet) => sum + packet.items.length, 0) },
        });
        await (0, report_run_1.setReportRunStatus)(run, "evidence-ready");
        return cached.packets;
    }
    const scope = scopeFromManifest(run.manifest);
    const evidenceRequest = {
        scope: { ...scope, harness: run.manifest.scope.harness },
        audit,
        selections: input.selections,
        maxItemsPerSession,
        maxCharsPerItem,
        sessionFiles: (run.manifest.topSessions ?? [])
            .map((s) => ({
            sessionId: s.sessionId,
            filePath: s.filePath ?? null,
            filePaths: Array.isArray(s.filePaths) && s.filePaths.length > 0 ? s.filePaths : (s.filePath ? [s.filePath] : []),
        })),
    };
    const packets = await (0, report_run_1.withRunSpan)(run, { phase: "content-read", operation: "read-content-evidence", source: "filesystem" }, async () => {
        const value = await (0, content_evidence_1.readContentEvidence)(evidenceRequest);
        const artifact = {
            version: 1,
            runId: run.manifest.runId,
            auditFingerprint: run.manifest.auditFingerprint,
            scope: run.manifest.scope,
            selections: input.selections,
            maxItemsPerSession,
            maxCharsPerItem,
            packets: value,
        };
        await (0, report_run_1.writeRunArtifact)(run, "evidence", artifact);
        return value;
    });
    await (0, report_run_1.setReportRunStatus)(run, "evidence-ready");
    return packets;
}
async function reportRunEvidenceMain(args) {
    const { runDir, rest } = extractRunDirectory(args);
    const auto = rest.length === 1 && rest[0] === "--auto";
    if (rest.length > 0 && !auto)
        throw new Error(`Unknown report-run evidence argument: ${rest[0]}.\n${usage()}`);
    const installedBundle = await (0, bundle_version_1.verifyInstalledSkill)();
    const run = await (0, report_run_1.openReportRun)(requireRunDirectory(runDir));
    (0, report_run_1.assertRunBundleVersion)(run, installedBundle.bundleVersion);
    if (auto) {
        const existing = run.manifest.artifacts.evidence ? await (0, report_run_1.readRunArtifact)(run.runDir, "evidence") : null;
        const isReused = existing !== null;
        const packets = await autoEvidenceRunInternal(run);
        outputRunSummary(run, { evidence: packetSummary(packets), reused: isReused });
        return 0;
    }
    const audit = await readCanonicalAudit(run);
    const input = await (0, report_run_1.withRunSpan)(run, { phase: "content-selection", operation: "parse-evidence-selection", source: "runner" }, async () => parseEvidenceInput(await readStdin()));
    const maxItemsPerSession = input.maxItemsPerSession ?? 24;
    const maxCharsPerItem = input.maxCharsPerItem ?? 1200;
    const existing = run.manifest.artifacts.evidence ? await (0, report_run_1.readRunArtifact)(run.runDir, "evidence") : null;
    if (existing !== null) {
        if (!evidenceArtifactMatches(existing, run, input))
            throw new Error("Report Run already contains Evidence for a different selection or limit; start a new run for a different request.");
        const cached = existing;
        await (0, report_run_1.recordCompletedRunSpan)(run, {
            phase: "content-read",
            operation: "reuse-content-evidence",
            source: "filesystem",
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
            durationMs: 0,
            status: "reused",
            metadata: { itemCount: cached.packets.reduce((sum, packet) => sum + packet.items.length, 0) },
        });
        await (0, report_run_1.setReportRunStatus)(run, "evidence-ready");
        outputRunSummary(run, { evidence: packetSummary(cached.packets), reused: true });
        return 0;
    }
    const scope = scopeFromManifest(run.manifest);
    const evidenceRequest = {
        scope: { ...scope, harness: run.manifest.scope.harness },
        audit,
        selections: input.selections,
        maxItemsPerSession,
        maxCharsPerItem,
        sessionFiles: (run.manifest.topSessions ?? [])
            .map((s) => ({
            sessionId: s.sessionId,
            filePath: s.filePath ?? null,
            filePaths: Array.isArray(s.filePaths) && s.filePaths.length > 0 ? s.filePaths : (s.filePath ? [s.filePath] : []),
        })),
    };
    const packets = await (0, report_run_1.withRunSpan)(run, { phase: "content-read", operation: "read-content-evidence", source: "filesystem" }, async () => {
        const value = await (0, content_evidence_1.readContentEvidence)(evidenceRequest);
        const artifact = {
            version: 1,
            runId: run.manifest.runId,
            auditFingerprint: run.manifest.auditFingerprint,
            scope: run.manifest.scope,
            selections: input.selections,
            maxItemsPerSession,
            maxCharsPerItem,
            packets: value,
        };
        await (0, report_run_1.writeRunArtifact)(run, "evidence", artifact);
        return value;
    });
    await (0, report_run_1.setReportRunStatus)(run, "evidence-ready");
    outputRunSummary(run, { evidence: packetSummary(packets), reused: false });
    return 0;
}
function parseRunComposeArgs(args) {
    const extracted = extractRunDirectory(args);
    let locale = "en-US";
    let htmlPath = null;
    let jsonOnly = false;
    let fontPath = null;
    let fontFamily = null;
    for (let index = 0; index < extracted.rest.length; index += 1) {
        const flag = extracted.rest[index];
        if (flag === "--locale" || flag === "--lang") {
            locale = (0, report_1.normalizeLocale)(requireValue(extracted.rest, index, flag));
            index += 1;
        }
        else if (flag === "--html") {
            if (htmlPath || jsonOnly)
                throw new Error("report-run compose accepts exactly one output: --json or --html.");
            htmlPath = requireValue(extracted.rest, index, flag);
            index += 1;
        }
        else if (flag === "--json") {
            if (htmlPath || jsonOnly)
                throw new Error("report-run compose accepts exactly one output: --json or --html.");
            jsonOnly = true;
        }
        else if (flag === "--font") {
            fontPath = requireValue(extracted.rest, index, flag);
            index += 1;
        }
        else if (flag === "--font-family") {
            fontFamily = requireValue(extracted.rest, index, flag);
            index += 1;
        }
        else {
            throw new Error(`Unknown report-run compose argument: ${flag}.\n${usage()}`);
        }
    }
    if (!htmlPath && !jsonOnly)
        throw new Error(`report-run compose requires --json or --html.\n${usage()}`);
    if (fontFamily && !fontPath)
        throw new Error("--font-family requires --font <font-file>.");
    return { runDir: requireRunDirectory(extracted.runDir), locale, htmlPath, jsonOnly, fontPath, fontFamily };
}
function assertRunContract(run, installedBundle, contract) {
    (0, report_run_1.assertRunBundleVersion)(run, installedBundle.bundleVersion);
    if (!contract.runtimeHash || !contract.promptHashes.reportSynthesis || !contract.promptHashes.keySessionAnalysis || !contract.promptHashes.skillInsights)
        throw new Error("Authoritative Report Prompts or runtime contract is unavailable.");
    if (!contract.bundleVersion || contract.bundleVersion.bundleVersion !== run.manifest.bundleVersion)
        throw new Error("Report Run bundle version changed during execution. Run npm run install-local.");
    if (run.manifest.runtimeHash !== contract.runtimeHash || run.manifest.promptHashes.reportSynthesis !== contract.promptHashes.reportSynthesis || run.manifest.promptHashes.keySessionAnalysis !== contract.promptHashes.keySessionAnalysis || run.manifest.promptHashes.skillInsights !== contract.promptHashes.skillInsights)
        throw new Error("Report Prompt or runtime contract changed during execution; the Run cannot continue. Run npm run install-local.");
}
function buildLaneTicket(run, lane, snapshotId) {
    const current = run.manifest.laneStatus[lane];
    const spanId = run.manifest.stageStatus[lane]?.spanId ?? "";
    return {
        runId: run.manifest.runId,
        lane,
        attempt: current.attempts,
        spanId,
        locale: run.manifest.scope.locale,
        auditFingerprint: run.manifest.auditFingerprint,
        bundleVersion: run.manifest.bundleVersion,
        promptHash: lanePromptHash(run.manifest, lane),
        runtimeHash: run.manifest.runtimeHash,
        inputArtifact: current.inputArtifact ?? `lanes/${lane}/input.json`,
        promptArtifact: `lanes/${lane}/prompt.json`,
        outputContractVersion: run.manifest.outputContractVersion ?? lane_contract_1.OUTPUT_CONTRACT_VERSION,
        ...(snapshotId ? { snapshotId } : {}),
    };
}
async function startLaneInternal(run, lane) {
    const audit = await readCanonicalAudit(run);
    const promptHash = lanePromptHash(run.manifest, lane);
    const bundleVersion = run.manifest.bundleVersion;
    if (!bundleVersion)
        throw new Error("Bundle version is unavailable for Report Run.");
    const auditFingerprint = run.manifest.auditFingerprint;
    if (!auditFingerprint)
        throw new Error("Audit fingerprint is unavailable for Report Run.");
    const context = {
        runId: run.manifest.runId,
        lane,
        scope: run.manifest.scope,
        locale: run.manifest.scope.locale,
        auditFingerprint,
        bundleVersion,
        promptHash,
    };
    let projection;
    let snapshotId;
    if (lane === "report-synthesis") {
        const { directory } = (0, lane_contract_1.buildLaneDirectory)("report-synthesis", {
            audit,
            turns: audit.turns ?? [],
            locale: run.manifest.scope.locale,
            hash: sha256Text,
        });
        projection = (0, report_run_1.projectReportSynthesisInput)(context, audit, directory);
    }
    else if (lane === "key-session-analysis") {
        const evidence = run.manifest.artifacts.evidence ? await (0, report_run_1.readRunArtifact)(run.runDir, "evidence") : null;
        if (!evidence)
            throw new Error("Key Session Analysis requires report-run evidence --auto before ai-start.");
        const sessions = audit.rankings.sessions.slice(0, 3);
        const topSessionIds = new Set(sessions.map((session) => session.key));
        const turns = (audit.turns ?? []).filter((turn) => topSessionIds.has(turn.sessionId));
        const { directory } = (0, lane_contract_1.buildLaneDirectory)("key-session-analysis", {
            audit,
            sessions,
            turns,
            locale: run.manifest.scope.locale,
            hash: sha256Text,
        });
        projection = (0, report_run_1.projectKeySessionAnalysisInput)(context, audit, evidence, directory);
    }
    else {
        if (!run.manifest.artifacts.skillSnapshot)
            throw new Error("Skill Insights requires a frozen Skill Snapshot.");
        const snapshot = await (0, report_run_1.readRunArtifact)(run.runDir, "skillSnapshot");
        snapshotId = snapshot.snapshotId;
        const { directory } = (0, lane_contract_1.buildLaneDirectory)("skill-insights", {
            snapshot,
            locale: run.manifest.scope.locale,
            hash: sha256Text,
        });
        projection = (0, report_run_1.projectSkillInsightsInput)(context, snapshot, directory);
    }
    const inputRef = await (0, report_run_1.writeRunLaneArtifact)(run, lane, "input", projection);
    await (0, report_run_1.recordRunProjection)(run, lane, inputRef);
    const promptRef = await (0, report_run_1.writeRunLaneArtifact)(run, lane, "prompt", { version: 1, lane, promptHash, bundleVersion });
    const started = await (0, report_run_1.startReportLane)(run, lane, inputRef.file);
    return {
        runId: run.manifest.runId,
        lane,
        attempt: started.attempt,
        spanId: started.spanId,
        locale: run.manifest.scope.locale,
        auditFingerprint,
        bundleVersion,
        promptHash,
        runtimeHash: run.manifest.runtimeHash,
        inputArtifact: inputRef.file,
        promptArtifact: promptRef.file,
        outputContractVersion: run.manifest.outputContractVersion ?? lane_contract_1.OUTPUT_CONTRACT_VERSION,
        ...(snapshotId ? { snapshotId } : {}),
    };
}
async function reportRunAiStartMain(args) {
    const { runDir, lane } = parseLaneCommandArgs(args);
    const installedBundle = await (0, bundle_version_1.verifyInstalledSkill)();
    const run = await (0, report_run_1.openReportRun)(runDir);
    const contract = await (0, report_run_1.resolveRunContractMetadata)();
    assertRunContract(run, installedBundle, contract);
    const ticket = await startLaneInternal(run, lane);
    process.stdout.write(JSON.stringify(ticket) + "\n");
    return 0;
}
function aiAcceptUsage() {
    return [
        "Usage: where-tokens-went report-run ai-accept --run-dir <directory> --lane <report-synthesis|key-session-analysis|skill-insights> [--attempt <number>] [--span-id <span-id>] [--output-contract <2|1>] < lane output JSON on stdin",
        "",
        "Accept model-generated JSON output for an active Report Run lane from stdin.",
        "",
        "Arguments:",
        "  --run-dir <directory>       Report Run workspace directory (required)",
        "  --lane <lane>               Report lane: report-synthesis, key-session-analysis, or skill-insights (required)",
        "  --attempt <number>          Attempt number (optional; defaults to the lane's current attempt)",
        "  --span-id <span-id>         Active span identifier (optional; defaults to the lane's current span)",
        "  --output-contract <2|1>     Output contract (optional; defaults to the Run contract version 2).",
        "                              v1 is an explicit diagnostic compatibility entry for the earlier",
        "                              canonical-reference output; it is never inferred from JSON shape.",
        "  --help, -h                  Show this help message",
        "",
        "Input:",
        "  Requires non-empty model-generated JSON on stdin matching the selected lane output contract.",
    ].join("\n");
}
function parseAiAcceptArgs(args) {
    const extracted = extractRunDirectory(args);
    let lane = null;
    let attempt = null;
    let spanId = null;
    let outputContract = null;
    for (let index = 0; index < extracted.rest.length; index += 1) {
        const flag = extracted.rest[index];
        if (flag === "--lane")
            lane = parseLane(requireValue(extracted.rest, index, flag));
        else if (flag === "--attempt") {
            const value = Number(requireValue(extracted.rest, index, flag));
            if (!Number.isInteger(value) || value < 1)
                throw new Error("--attempt must be a positive integer.");
            attempt = value;
        }
        else if (flag === "--span-id")
            spanId = requireValue(extracted.rest, index, flag);
        else if (flag === "--output-contract") {
            const value = requireValue(extracted.rest, index, flag);
            if (value !== "1" && value !== "2")
                throw new Error("--output-contract must be 1 or 2.");
            outputContract = value === "1" ? 1 : 2;
        }
        else
            throw new Error(`Unknown ai-accept argument: ${flag}.\n${aiAcceptUsage()}`);
        index += 1;
    }
    if (!extracted.runDir)
        throw new Error(`--run-dir is required.\n${aiAcceptUsage()}`);
    if (!lane)
        throw new Error(`--lane is required.\n${aiAcceptUsage()}`);
    return { runDir: (0, report_run_1.assertLocalSensitiveRunDirectory)(extracted.runDir), lane, attempt, spanId, outputContract };
}
/**
 * v1 is a diagnostic compatibility entry only. Output that carries v2
 * directory handles must never be silently read as v1: the code field guard
 * below and the explicit contract flag keep the two protocols apart.
 */
function legacyContractViolation(raw) {
    const v2OnlyFields = ["sessionHandle", "skillHandle", "familyHandle", "contentRef", "evidenceRef"];
    const found = [];
    const visit = (value, path) => {
        if (Array.isArray(value)) {
            value.forEach((item, index) => visit(item, `${path}[${index}]`));
            return;
        }
        if (!value || typeof value !== "object")
            return;
        for (const [key, nested] of Object.entries(value)) {
            if (v2OnlyFields.includes(key))
                found.push(`${path}.${key}`);
            visit(nested, `${path}.${key}`);
        }
    };
    visit(raw, "$");
    return found.length > 0
        ? `v1 output must not carry v2 directory fields (${[...new Set(found)].join(", ")}).`
        : null;
}
async function readHostResponseTiming(run, lane, currentLane, outputHash) {
    const file = path.join(run.runDir, `lanes/${lane}/host-response.json`);
    let contents;
    try {
        contents = await fs.readFile(file, "utf8");
    }
    catch {
        return { status: "unavailable", reasonCode: "HOST_TIMING_UNAVAILABLE" };
    }
    let parsed;
    try {
        parsed = JSON.parse(contents);
    }
    catch {
        return { status: "unavailable", reasonCode: "HOST_TIMING_INVALID" };
    }
    const value = isRecord(parsed) ? parsed : null;
    const provenance = value && isRecord(value.provenance) ? value.provenance : null;
    const expectedPromptHash = lanePromptHash(run.manifest, lane);
    const errors = [];
    if (!value || value.kind !== "host-agent-response" || (value.source !== "codex-host-agent" && value.source !== "host-agent"))
        errors.push("kind/source");
    if (!value || value.runId !== run.manifest.runId || value.lane !== lane || value.auditFingerprint !== run.manifest.auditFingerprint)
        errors.push("run binding");
    if (!value || value.bundleVersion !== run.manifest.bundleVersion || value.promptHash !== expectedPromptHash || value.inputArtifact !== currentLane.inputArtifact || value.promptArtifact !== `lanes/${lane}/prompt.json`)
        errors.push("contract binding");
    if (!value || value.outputHash !== outputHash)
        errors.push("output hash");
    if (value && typeof value.attempt === "number" && value.attempt !== currentLane.attempts)
        errors.push("attempt binding");
    const activeSpanId = run.manifest.stageStatus[lane]?.spanId;
    if (value && typeof value.spanId === "string" && activeSpanId && value.spanId !== activeSpanId)
        errors.push("span binding");
    if (!provenance || provenance.status !== "completed" || typeof provenance.threadId !== "string" || typeof provenance.turnId !== "string" || typeof provenance.responseItemId !== "string" || typeof provenance.durationMs !== "number" || !Number.isFinite(provenance.durationMs) || provenance.durationMs < 0)
        errors.push("provenance");
    if (provenance && typeof provenance.endedAt === "string" && currentLane.spanStartedAt) {
        if (Date.parse(provenance.endedAt) < Date.parse(currentLane.spanStartedAt))
            errors.push("expired");
    }
    if (errors.length > 0)
        return { status: "unavailable", reasonCode: "HOST_TIMING_INVALID" };
    return {
        status: "observed",
        durationMs: provenance.durationMs,
        metadata: {
            timingScope: "host-agent-wall",
            hostResponseFile: `lanes/${lane}/host-response.json`,
            hostResponseSha256: sha256Text(contents),
            hostThreadId: provenance.threadId,
            hostTurnId: provenance.turnId,
            hostResponseItemId: provenance.responseItemId,
        },
    };
}
async function reportRunAiAcceptMain(args) {
    if (args.includes("--help") || args.includes("-h")) {
        process.stdout.write(aiAcceptUsage() + "\n");
        return 0;
    }
    const options = parseAiAcceptArgs(args);
    const installedBundle = await (0, bundle_version_1.verifyInstalledSkill)();
    const run = await (0, report_run_1.openReportRun)(options.runDir);
    const contract = await (0, report_run_1.resolveRunContractMetadata)();
    assertRunContract(run, installedBundle, contract);
    const currentLane = run.manifest.laneStatus[options.lane];
    if (!currentLane || currentLane.status !== "running")
        throw new Error(`Lane ${options.lane} is not running; start it with report-run ai-start.`);
    const attempt = options.attempt ?? currentLane.attempts;
    if (attempt !== currentLane.attempts)
        throw new Error(`Lane ${options.lane} attempt does not match the current Run attempt.`);
    const spanId = options.spanId ?? run.manifest.stageStatus[options.lane]?.spanId;
    if (!spanId)
        throw new Error(`Lane ${options.lane} span is unavailable.`);
    const activeSpanId = run.manifest.stageStatus[options.lane]?.spanId;
    if (!activeSpanId || spanId !== activeSpanId)
        throw new Error("RUN_LANE_SPAN_MISMATCH");
    const input = await (0, report_run_1.readRunLaneArtifact)(run.runDir, options.lane, "input");
    (0, report_run_1.validateLaneProjection)(run, options.lane, input, lanePromptHash(run.manifest, options.lane));
    const rawText = await readStdin();
    if (!rawText.trim()) {
        throw new Error(`ai-accept requires non-empty model output on stdin.\n${aiAcceptUsage()}`);
    }
    const outputHash = sha256Text(rawText);
    let raw;
    let parseError = null;
    try {
        raw = JSON.parse(rawText);
    }
    catch {
        parseError = "MODEL_OUTPUT_INVALID_JSON";
        raw = { invalidJson: true };
    }
    const rawRef = await (0, report_run_1.writeRunLaneRawArtifact)(run, options.lane, rawText, attempt);
    if (rawRef.sha256 !== outputHash)
        throw new Error("RUN_LANE_RAW_HASH_MISMATCH");
    const hostTiming = await readHostResponseTiming(run, options.lane, currentLane, outputHash);
    const contractVersion = options.outputContract ?? run.manifest.outputContractVersion ?? lane_contract_1.OUTPUT_CONTRACT_VERSION;
    let errors = parseError ? [{ code: parseError, fieldPath: null, message: "Model output was not valid JSON." }] : [];
    let validationRejectionReasons = [];
    let unsupportedClaimsDropped = 0;
    let accepted = null;
    let validationAccepted = false;
    if (!parseError && contractVersion === 1) {
        // v1 is an explicitly requested diagnostic contract; v2 handle output shapes
        // must never be silently read as v1.
        const legacyViolation = legacyContractViolation(raw);
        if (legacyViolation)
            errors = [{ code: "LEGACY_CONTRACT_VIOLATION", fieldPath: null, message: legacyViolation }];
    }
    if (!parseError && errors.length === 0) {
        const audit = await readCanonicalAudit(run);
        if (contractVersion === 1) {
            if (options.lane === "report-synthesis") {
                const result = (0, key_session_analysis_1.validateReportSynthesis)(audit, raw);
                if (result.valid) {
                    accepted = result.synthesis;
                    validationAccepted = true;
                    errors = result.errors.map((message) => ({ code: "REPORT_SYNTHESIS_INVALID", fieldPath: null, message }));
                }
                else
                    errors = result.errors.map((message) => ({ code: "REPORT_SYNTHESIS_INVALID", fieldPath: null, message }));
            }
            else if (options.lane === "key-session-analysis") {
                const packets = run.manifest.artifacts.evidence ? (await (0, report_run_1.readRunArtifact)(run.runDir, "evidence")).packets : [];
                const result = (0, lane_contract_1.acceptKeySessionAnalyses)({
                    audit,
                    contractVersion: 1,
                    raw,
                    locale: run.manifest.scope.locale,
                    packets,
                    runFingerprint: run.manifest.auditFingerprint ?? (0, key_session_analysis_1.auditFingerprint)(audit),
                });
                accepted = result.accepted;
                validationAccepted = result.validationAccepted;
                errors = result.errors;
            }
            else {
                const snapshot = await (0, report_run_1.readRunArtifact)(run.runDir, "skillSnapshot");
                const result = (0, skill_insights_1.validateSkillInsights)(raw, snapshot);
                validationRejectionReasons = result.rejectionReasons;
                unsupportedClaimsDropped = result.unsupportedClaimsDropped;
                errors = result.errors.map((message) => ({ code: "SKILL_INSIGHTS_INVALID", fieldPath: null, message }));
                if (result.valid && result.insights.length > 0) {
                    accepted = result.insights;
                    validationAccepted = true;
                }
            }
        }
        else if (!(0, lane_contract_1.isLaneDirectory)(input.directory)) {
            errors = [{ code: "LANE_DIRECTORY_UNAVAILABLE", fieldPath: null, message: "The current Lane projection does not carry a verifiable Evidence Directory." }];
        }
        else if (options.lane === "report-synthesis") {
            const parsed = (0, lane_contract_1.parseReportSynthesisV2)(raw, { directory: input.directory, locale: run.manifest.scope.locale });
            if (parsed.accepted) {
                const result = (0, key_session_analysis_1.validateReportSynthesis)(audit, { ...parsed.accepted, auditFingerprint: (0, key_session_analysis_1.auditFingerprint)(audit) });
                if (result.valid) {
                    accepted = result.synthesis;
                    validationAccepted = true;
                    // Partial acceptance keeps the dropped-item reasons; a fully valid
                    // submission must not carry a fallback rejection code.
                    const resultErrors = result.errors.map((message) => ({ code: "REPORT_SYNTHESIS_INVALID", fieldPath: null, message }));
                    const parsedErrors = (0, lane_contract_1.laneIssueErrors)(parsed.issues, "REPORT_SYNTHESIS_INVALID");
                    errors = [...parsedErrors, ...resultErrors];
                }
                else {
                    errors = result.errors.map((message) => ({ code: "REPORT_SYNTHESIS_INVALID", fieldPath: null, message }));
                }
            }
            else {
                errors = (0, lane_contract_1.laneIssueErrors)(parsed.issues, "REPORT_SYNTHESIS_INVALID");
            }
        }
        else if (options.lane === "key-session-analysis") {
            const packets = run.manifest.artifacts.evidence ? (await (0, report_run_1.readRunArtifact)(run.runDir, "evidence")).packets : [];
            const result = (0, lane_contract_1.acceptKeySessionAnalyses)({
                audit,
                contractVersion: 2,
                raw,
                directory: input.directory,
                locale: run.manifest.scope.locale,
                packets,
                runFingerprint: run.manifest.auditFingerprint ?? (0, key_session_analysis_1.auditFingerprint)(audit),
            });
            accepted = result.accepted;
            validationAccepted = result.validationAccepted;
            errors = result.errors;
        }
        else {
            const snapshot = await (0, report_run_1.readRunArtifact)(run.runDir, "skillSnapshot");
            const projectedSnapshot = isRecord(input.snapshot) ? input.snapshot : null;
            const contentByHandle = new Map();
            if (projectedSnapshot && projectedSnapshot.snapshotId !== snapshot.snapshotId) {
                errors = [{ code: "SKILL_SNAPSHOT_MISMATCH", fieldPath: null, message: "Skill Insights projection does not match the frozen Skill Snapshot." }];
            }
            else {
                const directory = input.directory;
                for (const skill of projectedSnapshot?.selectedSkills ?? []) {
                    if (typeof skill.skillMdContent !== "string")
                        continue;
                    const ownerHandle = directory.skills.find((entry) => entry.canonicalId === skill.skillId)?.handle;
                    if (!ownerHandle)
                        continue;
                    for (const entry of directory.content) {
                        if (entry.skillHandle !== ownerHandle || !entry.available)
                            continue;
                        contentByHandle.set(entry.handle, skill.skillMdContent.slice(entry.startOffset, entry.endOffset));
                    }
                }
                const parsed = (0, lane_contract_1.parseSkillInsightsV2)(raw, { directory, contentByHandle, snapshotId: snapshot.snapshotId });
                errors = parsed.issues.length > 0 ? (0, lane_contract_1.laneIssueErrors)(parsed.issues, "SKILL_INSIGHTS_INVALID") : [];
                validationRejectionReasons = parsed.accepted?.rejectionReasons ?? [];
                if (parsed.accepted) {
                    accepted = parsed.accepted.insights;
                    validationAccepted = true;
                }
            }
        }
    }
    const validationStatus = validationAccepted ? "accepted" : "rejected";
    const timing = hostTiming.status === "observed"
        ? { status: "observed", durationMs: hostTiming.durationMs }
        : { status: "unavailable", reasonCode: hostTiming.reasonCode };
    const inputArtifactFile = currentLane.inputArtifact ?? `lanes/${options.lane}/input.json`;
    const projectionBinding = {
        projectionHash: typeof input.projectionHash === "string" ? input.projectionHash : null,
        projectionSchemaVersion: typeof input.projectionSchemaVersion === "number" ? input.projectionSchemaVersion : null,
        inputArtifact: inputArtifactFile,
        inputArtifactSha256: run.manifest.laneArtifacts[`${options.lane}/${path.basename(inputArtifactFile)}`]?.sha256 ?? null,
    };
    await (0, report_run_1.writeRunLaneArtifact)(run, options.lane, "validation", {
        version: 1, runId: run.manifest.runId, lane: options.lane, attempt, status: validationStatus,
        outputContractVersion: contractVersion,
        ...projectionBinding,
        outputHash,
        errors,
        rejectionReasons: [...new Set([...errors.map((error) => error.code), ...validationRejectionReasons])],
        generationTiming: timing,
        ...(unsupportedClaimsDropped > 0 ? { unsupportedClaimsDropped } : {}),
        ...(hostTiming.status === "observed" ? { generation: hostTiming.metadata } : {}),
    }, attempt);
    const durationMs = hostTiming.status === "observed" ? hostTiming.durationMs : null;
    const traceMetadata = hostTiming.status === "observed"
        ? { ...hostTiming.metadata, generationTimingStatus: "observed" }
        : { generationTimingStatus: "unavailable", generationTimingReasonCode: hostTiming.reasonCode };
    if (validationAccepted) {
        const snapshotId = options.lane === "skill-insights"
            ? (await (0, report_run_1.readRunArtifact)(run.runDir, "skillSnapshot")).snapshotId
            : undefined;
        const acceptedRef = await (0, report_run_1.writeRunLaneArtifact)(run, options.lane, "accepted", {
            version: 2,
            runId: run.manifest.runId,
            lane: options.lane,
            attempt,
            outputContractVersion: contractVersion,
            ...projectionBinding,
            outputHash,
            ...(snapshotId ? { snapshotId } : {}),
            value: accepted,
        });
        await (0, report_run_1.finishReportLane)(run, options.lane, attempt, spanId, currentLane.spanStartedAt ?? new Date().toISOString(), "accepted", durationMs, null, acceptedRef.file, hostTiming.status === "observed" ? "host-agent" : "runner", traceMetadata);
        process.stdout.write(JSON.stringify({
            runId: run.manifest.runId,
            lane: options.lane,
            attempt,
            status: "accepted",
            validationStatus: "accepted",
            generationTiming: timing,
            outputHash,
            rawArtifact: rawRef.file,
            validationArtifact: `lanes/${options.lane}/attempt-${attempt}.validation.json`,
            acceptedArtifact: acceptedRef.file,
            errors,
        }) + "\n");
        return 0;
    }
    const reasonCode = errors[0]?.code ?? "AI_VALIDATION_FAILED";
    await (0, report_run_1.writeRunLaneArtifact)(run, options.lane, "fallback", {
        version: 1,
        runId: run.manifest.runId,
        lane: options.lane,
        attempt,
        status: "fallback",
        reasonCode,
        validationArtifact: `lanes/${options.lane}/attempt-${attempt}.validation.json`,
        outputHash,
    }, attempt);
    await (0, report_run_1.finishReportLane)(run, options.lane, attempt, spanId, currentLane.spanStartedAt ?? new Date().toISOString(), "fallback", durationMs, reasonCode, null, hostTiming.status === "observed" ? "host-agent" : "runner", traceMetadata);
    if (attempt === 1) {
        const started2 = await (0, report_run_1.startReportLane)(run, options.lane, currentLane.inputArtifact ?? `lanes/${options.lane}/input.json`);
        const snapshotId = options.lane === "skill-insights"
            ? (await (0, report_run_1.readRunArtifact)(run.runDir, "skillSnapshot")).snapshotId
            : undefined;
        const retryTicket = {
            runId: run.manifest.runId,
            lane: options.lane,
            attempt: started2.attempt,
            spanId: started2.spanId,
            locale: run.manifest.scope.locale,
            auditFingerprint: run.manifest.auditFingerprint,
            bundleVersion: run.manifest.bundleVersion,
            promptHash: lanePromptHash(run.manifest, options.lane),
            runtimeHash: run.manifest.runtimeHash,
            inputArtifact: currentLane.inputArtifact ?? `lanes/${options.lane}/input.json`,
            promptArtifact: `lanes/${options.lane}/prompt.json`,
            validationArtifact: `lanes/${options.lane}/attempt-1.validation.json`,
            errors,
            ...(snapshotId ? { snapshotId } : {}),
        };
        process.stdout.write(JSON.stringify({
            runId: run.manifest.runId,
            lane: options.lane,
            attempt: 1,
            status: "retrying",
            validationStatus: "rejected",
            reasonCode,
            generationTiming: timing,
            outputHash,
            rawArtifact: rawRef.file,
            validationArtifact: `lanes/${options.lane}/attempt-1.validation.json`,
            acceptedArtifact: null,
            errors,
            retryTicket,
        }) + "\n");
        return 0;
    }
    process.stdout.write(JSON.stringify({
        runId: run.manifest.runId,
        lane: options.lane,
        attempt,
        status: "fallback",
        validationStatus: "rejected",
        reasonCode,
        generationTiming: timing,
        outputHash,
        rawArtifact: rawRef.file,
        validationArtifact: `lanes/${options.lane}/attempt-${attempt}.validation.json`,
        acceptedArtifact: null,
        errors,
    }) + "\n");
    return 0;
}
function parseAiFallbackArgs(args) {
    const extracted = extractRunDirectory(args);
    let lane = null;
    let status = "unavailable";
    let reasonCode = null;
    let attempt;
    let spanId;
    for (let index = 0; index < extracted.rest.length; index += 1) {
        const flag = extracted.rest[index];
        if (flag === "--lane")
            lane = parseLane(requireValue(extracted.rest, index, flag));
        else if (flag === "--status") {
            const value = requireValue(extracted.rest, index, flag);
            if (value !== "unavailable")
                throw new Error("--status must be unavailable.");
            status = "unavailable";
        }
        else if (flag === "--reason-code") {
            reasonCode = requireValue(extracted.rest, index, flag);
            if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(reasonCode))
                throw new Error("--reason-code must be a short safe label.");
        }
        else if (flag === "--attempt") {
            const value = Number(requireValue(extracted.rest, index, flag));
            if (!Number.isInteger(value) || value < 1)
                throw new Error("--attempt must be a positive integer.");
            attempt = value;
        }
        else if (flag === "--span-id") {
            spanId = requireValue(extracted.rest, index, flag);
        }
        else
            throw new Error(`Unknown ai-fallback argument: ${flag}.`);
        index += 1;
    }
    if (!lane)
        throw new Error("--lane is required.");
    return { runDir: requireRunDirectory(extracted.runDir), lane, status, reasonCode, attempt, spanId };
}
async function reportRunAiFallbackMain(args) {
    const options = parseAiFallbackArgs(args);
    const installedBundle = await (0, bundle_version_1.verifyInstalledSkill)();
    const run = await (0, report_run_1.openReportRun)(options.runDir);
    const contract = await (0, report_run_1.resolveRunContractMetadata)();
    assertRunContract(run, installedBundle, contract);
    const currentLane = run.manifest.laneStatus[options.lane];
    if (!currentLane || currentLane.status !== "running")
        throw new Error(`Lane ${options.lane} is not running; start it with report-run ai-start.`);
    const attempt = options.attempt ?? currentLane.attempts;
    if (attempt !== currentLane.attempts)
        throw new Error(`Lane ${options.lane} attempt does not match the current Run attempt.`);
    const spanId = options.spanId ?? run.manifest.stageStatus[options.lane]?.spanId;
    if (!spanId)
        throw new Error(`Lane ${options.lane} span is unavailable.`);
    const activeSpanId = run.manifest.stageStatus[options.lane]?.spanId;
    if (!activeSpanId || spanId !== activeSpanId)
        throw new Error("RUN_LANE_SPAN_MISMATCH");
    if (!options.reasonCode) {
        throw new Error("REASON_CODE_REQUIRED: ai-fallback requires an explicit --reason-code.");
    }
    if (/timing/i.test(options.reasonCode)) {
        throw new Error(`TIMING_CANNOT_AUTHORIZE_UNAVAILABLE: Timing telemetry is passive and cannot authorize lane degradation (${options.reasonCode}).`);
    }
    if (!(0, report_run_1.isAllowedGenerationFailureReason)(options.reasonCode)) {
        throw new Error(`ILLEGAL_REASON_CODE: '${options.reasonCode}' is not an allowed generation failure category. Allowed: ${report_run_1.ALLOWED_GENERATION_FAILURE_REASONS.join(", ")}`);
    }
    const receiptCandidates = [
        path.join(run.runDir, `lanes/${options.lane}/host-failure.json`),
        path.join(run.runDir, `lanes/${options.lane}/host-response.json`),
    ];
    let receiptData = null;
    let receiptFile = null;
    for (const candidate of receiptCandidates) {
        try {
            const contents = await fs.readFile(candidate, "utf8");
            receiptData = JSON.parse(contents);
            receiptFile = path.relative(run.runDir, candidate);
            break;
        }
        catch {
            // Continue to next candidate
        }
    }
    if (!receiptData) {
        throw new Error(`HOST_FAILURE_RECEIPT_REQUIRED: ai-fallback for lane ${options.lane} requires a bound Host failure receipt in the lane directory.`);
    }
    const validation = await (0, report_run_1.validateHostFailureReceipt)(run, options.lane, currentLane, receiptData, options.reasonCode, activeSpanId, attempt);
    if (!validation.valid) {
        throw new Error(`HOST_FAILURE_RECEIPT_INVALID: ${validation.errors.join(", ")}`);
    }
    const fallbackRef = await (0, report_run_1.writeRunLaneArtifact)(run, options.lane, "fallback", {
        version: 1,
        runId: run.manifest.runId,
        lane: options.lane,
        attempt,
        status: options.status,
        reasonCode: options.reasonCode,
        failureReceipt: receiptFile,
    }, attempt);
    await (0, report_run_1.finishReportLane)(run, options.lane, attempt, spanId, currentLane.spanStartedAt ?? new Date().toISOString(), "unavailable", null, options.reasonCode, null, "host-agent", {
        generationTimingStatus: "unavailable",
        hostObservationSource: validation.receipt.source,
        failureReceiptFile: receiptFile,
    });
    process.stdout.write(JSON.stringify({ runId: run.manifest.runId, lane: options.lane, attempt, status: options.status, reasonCode: options.reasonCode, fallbackArtifact: fallbackRef.file }) + "\n");
    return 0;
}
function validExternalSource(value) {
    return value === "runner" || value === "skill" || value === "host-agent" || value === "network" || value === "filesystem" || value === "ui";
}
function validTerminalStatus(value) {
    return value === "completed" || value === "failed" || value === "fallback" || value === "queued" || value === "reused" || value === "skipped" || value === "unavailable" || value === "interrupted";
}
async function composeAndRenderRun(run, options) {
    const audit = await readCanonicalAudit(run);
    const runFingerprint = run.manifest.auditFingerprint;
    if (!runFingerprint)
        throw new Error("Report Run Audit fingerprint is unavailable.");
    if (!options.jsonOnly) {
        if (!options.htmlPath)
            throw new Error("report-run compose requires --html when JSON-only output is not selected.");
        const resolvedTargetPath = path.resolve(options.htmlPath);
        if (run.manifest.delivery && run.manifest.delivery.targetPath !== resolvedTargetPath) {
            throw new Error(`Cannot change --html delivery target for an existing Report Run (expected ${run.manifest.delivery.targetPath}, got ${resolvedTargetPath}).`);
        }
    }
    await (0, report_run_1.setReportRunStatus)(run, "composing");
    let synthesisCandidate = null;
    let analyses = [];
    let validatedSynthesis = null;
    let packets;
    let validatedSkillInsights = [];
    let skillInsightsSnapshotId = null;
    let skillInsightsStatus = "skipped";
    let skillInsightsValid = false;
    let skillInsightsRejectionReasons = [];
    const laneIntegrityFailed = {
        "report-synthesis": false,
        "key-session-analysis": false,
        "skill-insights": false,
    };
    try {
        const currentContract = await (0, report_run_1.withRunSpan)(run, { phase: "prompt-read", operation: "verify-report-contract", source: "filesystem" }, async () => {
            const metadata = await (0, report_run_1.resolveRunContractMetadata)();
            if (!metadata.promptHashes.reportSynthesis || !metadata.promptHashes.keySessionAnalysis || !metadata.promptHashes.skillInsights || !metadata.runtimeHash)
                throw new Error("Authoritative Report Prompts or runtime contract is unavailable.");
            if (!metadata.bundleVersion || metadata.bundleVersion.bundleVersion !== run.manifest.bundleVersion)
                throw new Error("Report Run bundle version changed during execution. Run npm run install-local.");
            return metadata;
        });
        const currentPromptHashes = {
            reportSynthesis: currentContract.promptHashes.reportSynthesis,
            keySessionAnalysis: currentContract.promptHashes.keySessionAnalysis,
            skillInsights: currentContract.promptHashes.skillInsights,
        };
        const currentRuntimeHash = currentContract.runtimeHash;
        if (run.manifest.artifacts.evidence) {
            const value = await (0, report_run_1.readRunArtifact)(run.runDir, "evidence");
            if (!isRecord(value) || value.version !== 1 || value.runId !== run.manifest.runId || value.auditFingerprint !== run.manifest.auditFingerprint || JSON.stringify(value.scope) !== JSON.stringify(run.manifest.scope) || !Array.isArray(value.packets))
                throw new Error("Report Run Evidence artifact is stale or malformed.");
            packets = value.packets;
        }
        await (0, report_run_1.withRunSpan)(run, { phase: "validation", operation: "validate-ai-output", source: "runner" }, async () => {
            let acceptedSynthesis = null;
            let acceptedAnalyses = [];
            let acceptedSkills = null;
            const synthesisStatus = run.manifest.laneStatus["report-synthesis"]?.status;
            const synthesisHasAccepted = synthesisStatus === "accepted" || Boolean(run.manifest.laneStatus["report-synthesis"]?.acceptedArtifact);
            if (synthesisHasAccepted) {
                try {
                    const acceptedArtifact = await (0, report_run_1.readRunLaneArtifact)(run.runDir, "report-synthesis", "accepted");
                    acceptedSynthesis = acceptedArtifact?.value ?? null;
                }
                catch (error) {
                    laneIntegrityFailed["report-synthesis"] = true;
                    acceptedSynthesis = null;
                    await (0, report_run_1.appendRunWarnings)(run, [`Report Run lane artifact integrity verification failed for report-synthesis: ${error?.message ?? String(error)}`]);
                }
            }
            const keySessionStatus = run.manifest.laneStatus["key-session-analysis"]?.status;
            const keySessionHasAccepted = keySessionStatus === "accepted" || Boolean(run.manifest.laneStatus["key-session-analysis"]?.acceptedArtifact);
            if (keySessionHasAccepted) {
                try {
                    const acceptedArtifact = await (0, report_run_1.readRunLaneArtifact)(run.runDir, "key-session-analysis", "accepted");
                    const value = acceptedArtifact?.value;
                    acceptedAnalyses = Array.isArray(value) ? value : [];
                }
                catch (error) {
                    laneIntegrityFailed["key-session-analysis"] = true;
                    acceptedAnalyses = [];
                    await (0, report_run_1.appendRunWarnings)(run, [`Report Run lane artifact integrity verification failed for key-session-analysis: ${error?.message ?? String(error)}`]);
                }
            }
            const skillStatus = run.manifest.laneStatus["skill-insights"]?.status;
            const skillHasAccepted = skillStatus === "accepted" || Boolean(run.manifest.laneStatus["skill-insights"]?.acceptedArtifact);
            if (skillHasAccepted) {
                try {
                    const acceptedArtifact = await (0, report_run_1.readRunLaneArtifact)(run.runDir, "skill-insights", "accepted");
                    acceptedSkills = typeof acceptedArtifact?.snapshotId === "string" && Array.isArray(acceptedArtifact?.value)
                        ? {
                            snapshotId: acceptedArtifact.snapshotId,
                            insights: acceptedArtifact.value,
                            outputContractVersion: typeof acceptedArtifact.outputContractVersion === "number" ? acceptedArtifact.outputContractVersion : 1,
                        }
                        : null;
                }
                catch (error) {
                    laneIntegrityFailed["skill-insights"] = true;
                    acceptedSkills = null;
                    await (0, report_run_1.appendRunWarnings)(run, [`Report Run lane artifact integrity verification failed for skill-insights: ${error?.message ?? String(error)}`]);
                }
            }
            synthesisCandidate = acceptedSynthesis === null ? null : acceptedSynthesis;
            analyses = acceptedAnalyses.slice(0, 3);
            if (analyses.length > 0 && packets === undefined)
                throw new Error("Key Session Analysis requires the run-scoped Evidence artifact.");
            const rawSkillInsights = acceptedSkills;
            if (rawSkillInsights !== undefined && rawSkillInsights !== null) {
                skillInsightsStatus = "fallback";
            }
            if (run.manifest.artifacts.skillSnapshot) {
                try {
                    const snapshot = await (0, report_run_1.readRunArtifact)(run.runDir, "skillSnapshot");
                    if (snapshot) {
                        skillInsightsSnapshotId = snapshot.snapshotId;
                        if (rawSkillInsights) {
                            // v2 already completed the domain judgment at accept time. Compose
                            // re-verifies binding and restored content instead of re-imposing the
                            // v1 reference scheme or running a second semantic elimination pass.
                            const validation = rawSkillInsights.outputContractVersion === 2
                                ? (0, lane_contract_1.verifyAcceptedSkillInsightsV2)(rawSkillInsights.insights, snapshot.snapshotId)
                                : (0, skill_insights_1.validateSkillInsights)(rawSkillInsights, snapshot);
                            skillInsightsRejectionReasons = validation.rejectionReasons;
                            if (validation.valid) {
                                validatedSkillInsights = validation.insights;
                                skillInsightsValid = true;
                                skillInsightsStatus = "completed";
                            }
                            if (validation.errors.length > 0) {
                                await (0, report_run_1.appendRunWarnings)(run, [`Skill Insights validation: ${validation.errors.join("; ")}`]);
                            }
                        }
                        else if (snapshot.selectedSkills.some((skill) => skill.contentState === "available" && Boolean(skill.skillMdContent))) {
                            skillInsightsRejectionReasons = ["usage_content_relation_unclear"];
                        }
                    }
                }
                catch {
                    // ignore error reading snapshot
                }
            }
            const synthesisValidation = (0, key_session_analysis_1.validateReportSynthesis)(audit, synthesisCandidate);
            validatedSynthesis = synthesisValidation.valid ? synthesisValidation.synthesis : null;
            if (!synthesisValidation.valid)
                await (0, report_run_1.appendRunWarnings)(run, ["Report Synthesis was unavailable or failed validation; deterministic fallback is used."]);
            const keyValidation = analyses.map((candidate) => {
                if (!isRecord(candidate))
                    return { valid: false, errors: ["Candidate analysis is not an object."] };
                try {
                    return (0, key_session_analysis_1.validateKeySessionAnalysis)(audit, candidate, packets?.filter((packet) => packet.sessionId === candidate.sessionId));
                }
                catch (error) {
                    return { valid: false, errors: [error instanceof Error ? error.message : String(error)] };
                }
            });
            const validKeyCount = keyValidation.filter((result) => result.valid).length;
            const invalidKeys = keyValidation.filter((result) => !result.valid);
            const invalidKeyCount = invalidKeys.length;
            if (invalidKeyCount > 0) {
                const errorDetails = invalidKeys.flatMap((result) => result.errors).filter(Boolean);
                await (0, report_run_1.appendRunWarnings)(run, [`${invalidKeyCount} Key Session Analysis entr${invalidKeyCount === 1 ? "y" : "ies"} failed validation and will be omitted.${errorDetails.length > 0 ? " Reasons: " + errorDetails.join("; ") : ""}`]);
            }
            await (0, report_run_1.writeRunArtifact)(run, "reportSynthesis", {
                version: 1,
                runId: run.manifest.runId,
                auditFingerprint: runFingerprint,
                promptHashes: currentPromptHashes,
                runtimeHash: currentRuntimeHash,
                attempt: run.manifest.stageStatus["report-synthesis"]?.attempt ?? null,
                status: synthesisValidation.valid ? "completed" : "fallback",
                value: synthesisCandidate,
                valid: synthesisValidation.valid,
            });
            await (0, report_run_1.writeRunArtifact)(run, "keySessionAnalyses", {
                version: 1,
                runId: run.manifest.runId,
                auditFingerprint: runFingerprint,
                promptHashes: currentPromptHashes,
                runtimeHash: currentRuntimeHash,
                attempt: run.manifest.stageStatus["key-session-analysis"]?.attempt ?? null,
                status: analyses.length === 0 ? "skipped" : invalidKeyCount > 0 ? "fallback" : "completed",
                value: analyses,
                validCount: validKeyCount,
                invalidCount: invalidKeyCount,
            });
            await (0, report_run_1.writeRunArtifact)(run, "skillInsights", {
                version: 1,
                runId: run.manifest.runId,
                auditFingerprint: runFingerprint,
                promptHashes: currentPromptHashes,
                runtimeHash: currentRuntimeHash,
                attempt: run.manifest.stageStatus["skill-insights"]?.attempt ?? null,
                snapshotId: skillInsightsSnapshotId,
                status: skillInsightsStatus,
                value: validatedSkillInsights,
                valid: skillInsightsValid,
                rejectionReasons: skillInsightsRejectionReasons,
            });
        });
        const composition = await (0, report_run_1.withRunSpan)(run, { phase: "compose", operation: "compose-report", source: "runner" }, async () => (0, key_session_analysis_1.reportComposition)(audit, analyses, validatedSynthesis, packets, validatedSkillInsights, skillInsightsSnapshotId ?? undefined));
        await (0, report_run_1.writeRunArtifact)(run, "composition", {
            runId: run.manifest.runId,
            auditFingerprint: run.manifest.auditFingerprint,
            reportSynthesis: composition.reportSynthesis,
            keySessionAnalyses: composition.keySessionAnalyses,
            skillInsights: composition.skillInsights,
            skillInsightsSnapshotId: composition.skillInsightsSnapshotId,
        });
        const firstUserMessages = run.manifest.artifacts.firstUserMessages
            ? await (0, report_run_1.readRunArtifact)(run.runDir, "firstUserMessages")
            : [];
        const projectName = run.manifest.scope.cwd ? (0, report_1.resolveReportProjectName)(run.manifest.scope.cwd) ?? undefined : undefined;
        const renderComposition = projectName ? { ...composition, projectName } : composition;
        const selectedSessionIds = new Set(composition.keySessionAnalyses.map((analysis) => analysis.sessionId));
        const reportSynthesisFallbackReason = composition.reportSynthesis
            ? null
            : laneIntegrityFailed["report-synthesis"]
                ? "ARTIFACT_INTEGRITY_FAILED"
                : run.manifest.laneStatus["report-synthesis"].reasonCode ?? "REPORT_SYNTHESIS_UNAVAILABLE_OR_INVALID";
        const keySessionFallbackReason = laneIntegrityFailed["key-session-analysis"]
            ? "ARTIFACT_INTEGRITY_FAILED"
            : audit.rankings.sessions.slice(0, 3).some((session) => !selectedSessionIds.has(session.key))
                ? run.manifest.laneStatus["key-session-analysis"].reasonCode ?? "KEY_SESSION_ANALYSIS_UNAVAILABLE_OR_INVALID"
                : null;
        const skillInsightsFallbackReason = laneIntegrityFailed["skill-insights"]
            ? "ARTIFACT_INTEGRITY_FAILED"
            : skillInsightsValid
                ? null
                : run.manifest.laneStatus["skill-insights"].reasonCode ?? "SKILL_INSIGHTS_UNAVAILABLE_OR_INVALID";
        const reportJson = {
            version: 1,
            audit,
            ai: {
                reportSynthesis: {
                    result: composition.reportSynthesis,
                    fallbackReason: reportSynthesisFallbackReason,
                },
                keySessionAnalyses: { result: composition.keySessionAnalyses, fallbackReason: keySessionFallbackReason },
                skillInsights: {
                    result: composition.skillInsights ?? [],
                    fallbackReason: skillInsightsFallbackReason,
                },
            },
            render: {
                locale: options.locale,
                projectName: projectName ?? null,
                font: options.fontPath
                    ? { source: "custom", filePath: options.fontPath, family: options.fontFamily?.trim() || null }
                    : { source: "bundled" },
                firstUserMessages,
            },
        };
        await (0, report_run_1.writeRunArtifact)(run, "reportJson", reportJson);
        if (options.jsonOnly) {
            return { output: path.join(run.runDir, "report.json"), composition, reportJson };
        }
        const htmlPath = options.htmlPath;
        if (!htmlPath)
            throw new Error("report-run compose requires --html when JSON-only output is not selected.");
        const resolvedTargetPath = path.resolve(htmlPath);
        if (run.manifest.delivery && run.manifest.delivery.targetPath !== resolvedTargetPath) {
            throw new Error(`Cannot change --html delivery target for an existing Report Run (expected ${run.manifest.delivery.targetPath}, got ${resolvedTargetPath}).`);
        }
        const fontConfig = reportFontConfig(options.fontPath ?? null, options.fontFamily ?? null);
        const rendered = await (0, report_run_1.withRunSpan)(run, { phase: "render", operation: "render-html", source: "runner" }, async () => (0, report_1.renderHtml)(audit, options.locale, renderComposition, firstUserMessages, fontConfig));
        const subsetted = await (0, report_run_1.withRunSpan)(run, { phase: "font-subset", operation: "subset-report-fonts", source: "runner" }, async () => (0, report_1.subsetReportFonts)(rendered));
        const output = await (0, report_run_1.withRunSpan)(run, { phase: "html-write", operation: "write-final-html", source: "filesystem" }, async () => {
            await (0, report_run_1.writeRunTextArtifact)(run, "html", subsetted);
            return writeAtomicLocal(resolvedTargetPath, subsetted);
        });
        const contentsBuffer = Buffer.from(subsetted, "utf8");
        const htmlBytes = contentsBuffer.byteLength;
        const htmlHash = (0, node_crypto_1.createHash)("sha256").update(contentsBuffer).digest("hex");
        const actionId = run.manifest.delivery?.actionId ?? (0, node_crypto_1.randomUUID)();
        await (0, report_run_1.completeRunComposing)(run, {
            actionId,
            targetPath: resolvedTargetPath,
            bytes: htmlBytes,
            sha256: htmlHash,
            bundleVersion: run.manifest.bundleVersion ?? currentContract.bundleVersion?.bundleVersion ?? "",
            uiStatus: "pending",
        });
        return { output, composition, reportJson };
    }
    catch (error) {
        await (0, report_run_1.setReportRunStatus)(run, "failed").catch(() => undefined);
        throw error;
    }
}
async function reportRunComposeMain(args) {
    const options = parseRunComposeArgs(args);
    const installedBundle = await (0, bundle_version_1.verifyInstalledSkill)();
    const run = await (0, report_run_1.openReportRun)(options.runDir);
    (0, report_run_1.assertRunBundleVersion)(run, installedBundle.bundleVersion);
    if (options.locale !== run.manifest.scope.locale)
        throw new Error("Report Run locale does not match the compose request.");
    const composeStdin = await readStdin();
    if (composeStdin.trim())
        throw new Error("REPORT_COMPOSE_STDIN_FORBIDDEN: normal report-run compose reads only registered Run lane artifacts.");
    const eligibleLanes = Object.keys(run.manifest.laneStatus).filter((lane) => run.manifest.eligibleStages.includes(lane));
    const runningLanes = eligibleLanes.filter((lane) => {
        const current = run.manifest.laneStatus[lane];
        return current.status === "running";
    });
    if (runningLanes.length > 0) {
        throw new Error(`REPORT_COMPOSE_LANES_INCOMPLETE: eligible AI lanes still running: ${runningLanes.join(", ")}`);
    }
    const result = await composeAndRenderRun(run, options);
    if (options.jsonOnly) {
        outputRunSummary(run, {
            reportStatus: result.composition.reportSynthesis ? "ai-enhanced" : "fallback",
            fallback: result.composition.reportSynthesis === null,
            reportJsonPath: path.join(run.runDir, "report.json"),
            next: ["render report.json"],
        });
        return 0;
    }
    outputRunSummary(run, {
        reportStatus: result.composition.reportSynthesis ? "ai-enhanced" : "fallback",
        fallback: result.composition.reportSynthesis === null,
        htmlPath: result.output,
        next: ["record codex-open", "finalize"],
    });
    return 0;
}
async function reportRunEventMain(args) {
    const { runDir, rest } = extractRunDirectory(args);
    if (rest.length > 0)
        throw new Error(`Unknown report-run event argument: ${rest[0]}.\n${usage()}`);
    const installedBundle = await (0, bundle_version_1.verifyInstalledSkill)();
    const input = await readStdin();
    if (!input.trim())
        throw new Error("report-run event requires one JSON event object on stdin.");
    const parsed = JSON.parse(input);
    if (!isRecord(parsed) || (parsed.event !== "start" && parsed.event !== "end") || typeof parsed.phase !== "string" || typeof parsed.operation !== "string" || !validExternalSource(parsed.source))
        throw new Error("report-run event requires event, phase, operation, and a supported source.");
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(parsed.phase) || !/^[A-Za-z0-9_.:-]{1,128}$/.test(parsed.operation))
        throw new Error("report-run event phase and operation must be short safe labels.");
    const spanId = typeof parsed.spanId === "string" && parsed.spanId ? parsed.spanId : (0, node_crypto_1.randomUUID)();
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(spanId))
        throw new Error("report-run event spanId must be a short safe label.");
    const startedAt = typeof parsed.startedAt === "string" ? parsed.startedAt : new Date().toISOString();
    if (startedAt.length > 64 || /[\r\n]/.test(startedAt))
        throw new Error("report-run event startedAt is invalid.");
    const event = {
        event: parsed.event,
        spanId,
        phase: parsed.phase,
        operation: parsed.operation,
        source: parsed.source,
        startedAt,
        ...(typeof parsed.endedAt === "string" ? { endedAt: parsed.endedAt } : {}),
        ...(typeof parsed.durationMs === "number" ? { durationMs: parsed.durationMs } : {}),
        ...(typeof parsed.parentSpanId === "string" || parsed.parentSpanId === null ? { parentSpanId: parsed.parentSpanId } : {}),
        ...(typeof parsed.attempt === "number" ? { attempt: parsed.attempt } : {}),
        ...(validTerminalStatus(parsed.status) ? { status: parsed.status } : {}),
        ...(typeof parsed.errorCode === "string" ? { errorCode: parsed.errorCode } : {}),
        ...(isRecord(parsed.metadata) ? { metadata: parsed.metadata } : {}),
    };
    if (event.event === "end" && !event.endedAt)
        event.endedAt = new Date().toISOString();
    if (event.endedAt && (event.endedAt.length > 64 || /[\r\n]/.test(event.endedAt)))
        throw new Error("report-run event endedAt is invalid.");
    const resolvedRunDir = requireRunDirectory(runDir);
    const currentRun = await (0, report_run_1.openReportRun)(resolvedRunDir);
    if (currentRun.manifest.bundleVersion)
        (0, report_run_1.assertRunBundleVersion)(currentRun, installedBundle.bundleVersion);
    const manifest = await (0, report_run_1.recordRunSpan)(resolvedRunDir, event);
    process.stdout.write(JSON.stringify({ runId: manifest.runId, runDir: resolvedRunDir, status: manifest.status, phase: event.phase, traceCompleteness: manifest.traceCompleteness }) + "\n");
    return 0;
}
async function reportRunStatusMain(args) {
    const { runDir, rest } = extractRunDirectory(args);
    if (rest.length > 0)
        throw new Error(`Unknown report-run status argument: ${rest[0]}.\n${usage()}`);
    const run = await (0, report_run_1.openReportRun)(requireRunDirectory(runDir));
    outputRunSummary(run);
    return 0;
}
async function reportRunFinalizeMain(args) {
    const { runDir, rest } = extractRunDirectory(args);
    let requested = "completed";
    for (let index = 0; index < rest.length; index += 1) {
        if (rest[index] !== "--status")
            throw new Error(`Unknown report-run finalize argument: ${rest[index]}.\n${usage()}`);
        const value = requireValue(rest, index, "--status");
        index += 1;
        if (value !== "completed" && value !== "failed" && value !== "incomplete")
            throw new Error("--status must be completed, failed, or incomplete.");
        requested = value;
    }
    const installedBundle = await (0, bundle_version_1.verifyInstalledSkill)();
    const run = await (0, report_run_1.openReportRun)(requireRunDirectory(runDir));
    (0, report_run_1.assertRunBundleVersion)(run, installedBundle.bundleVersion);
    await (0, report_run_1.finalizeReportRun)(run, requested);
    outputRunSummary(run);
    return requested === "completed" && run.manifest.status !== "completed" ? 2 : 0;
}
async function reportRunCleanupMain(args) {
    const { runDir, rest } = extractRunDirectory(args);
    if (rest.length > 0)
        throw new Error(`Unknown report-run cleanup argument: ${rest[0]}.\n${usage()}`);
    const run = await (0, report_run_1.openReportRun)(requireRunDirectory(runDir));
    if (!run.manifest.artifacts.html && run.manifest.status !== "failed" && run.manifest.status !== "incomplete" && run.manifest.deliveryStatus !== "completed") {
        throw new Error("REPORT_RUN_CLEANUP_REQUIRES_FINAL_HTML_OR_FAILED_STATUS");
    }
    const manifest = await (0, report_run_1.cleanupSensitiveRunArtifacts)(run);
    const isCleaned = manifest.cleanupStatus === "completed";
    outputRunSummary(run, {
        sensitiveArtifacts: isCleaned ? "cleaned" : "cleanup-failed",
        cleanedUp: isCleaned,
        cleanupStatus: manifest.cleanupStatus,
        retention: manifest.retention,
    });
    return isCleaned ? 0 : 2;
}
async function reportRunRunAllStartMain(args) {
    const { runDir, rest } = extractRunDirectory(args);
    const installedBundle = await (0, bundle_version_1.verifyInstalledSkill)();
    const resolvedRunDir = runDir ? (0, report_run_1.assertLocalSensitiveRunDirectory)(runDir) : null;
    let manifestExists = false;
    if (resolvedRunDir) {
        try {
            await fs.stat(path.join(resolvedRunDir, "manifest.json"));
            manifestExists = true;
        }
        catch {
            manifestExists = false;
        }
    }
    let run;
    if (manifestExists) {
        run = await (0, report_run_1.openReportRun)(resolvedRunDir);
        (0, report_run_1.assertRunBundleVersion)(run, installedBundle.bundleVersion);
        const contract = await (0, report_run_1.resolveRunContractMetadata)();
        assertRunContract(run, installedBundle, contract);
        if (run.manifest.status === "completed" && (run.manifest.cleanupStatus === "completed" || run.manifest.retention?.cleanedAt !== null)) {
            const targetHtmlPath = run.manifest.delivery?.targetPath ?? (run.manifest.artifacts.html ? path.join(run.runDir, run.manifest.artifacts.html.file) : "report.html");
            process.stdout.write(JSON.stringify({
                status: "completed",
                deliveryStatus: "completed",
                runId: run.manifest.runId,
                runDir: run.runDir,
                htmlPath: targetHtmlPath,
                cleanedUp: true,
            }) + "\n");
            return 0;
        }
        if (run.manifest.deliveryStatus === "completed") {
            const targetHtmlPath = run.manifest.delivery?.targetPath ?? (run.manifest.artifacts.html ? path.join(run.runDir, run.manifest.artifacts.html.file) : "report.html");
            process.stdout.write(JSON.stringify({
                status: run.manifest.status,
                deliveryStatus: "completed",
                runId: run.manifest.runId,
                runDir: run.runDir,
                htmlPath: targetHtmlPath,
                cleanedUp: run.manifest.cleanupStatus === "completed" || run.manifest.retention?.cleanedAt !== null,
            }) + "\n");
            return 0;
        }
        if (run.manifest.status === "awaiting-ui-dispatch" || (run.manifest.status === "incomplete" && run.manifest.artifacts.html)) {
            const targetHtmlPath = run.manifest.delivery?.targetPath ?? (run.manifest.artifacts.html ? path.join(run.runDir, run.manifest.artifacts.html.file) : "report.html");
            process.stdout.write(JSON.stringify({
                action: "open-html",
                status: run.manifest.status,
                runId: run.manifest.runId,
                runDir: run.runDir,
                htmlPath: targetHtmlPath,
                reportStatus: run.manifest.artifacts.reportSynthesis ? "ai-enhanced" : "fallback",
                fallback: !run.manifest.artifacts.reportSynthesis,
            }) + "\n");
            return 0;
        }
        if (run.manifest.status === "prepared" && !run.manifest.artifacts.evidence && run.manifest.laneStatus["report-synthesis"]?.reasonCode !== "NO_HISTORY_IN_SCOPE") {
            await autoEvidenceRunInternal(run);
        }
    }
    else {
        run = await prepareReportRunInternal(rest, runDir, installedBundle);
        if (run.manifest.laneStatus["report-synthesis"]?.reasonCode !== "NO_HISTORY_IN_SCOPE") {
            await autoEvidenceRunInternal(run);
        }
    }
    if (run.manifest.laneStatus["report-synthesis"]?.reasonCode === "NO_HISTORY_IN_SCOPE") {
        process.stdout.write(JSON.stringify({
            action: "advance",
            status: "lanes-ready",
            runId: run.manifest.runId,
            runDir: run.runDir,
            auditFingerprint: run.manifest.auditFingerprint,
            bundleVersion: run.manifest.bundleVersion,
            locale: run.manifest.scope.locale,
            tickets: {},
            reason: "NO_HISTORY_IN_SCOPE",
        }) + "\n");
        return 0;
    }
    const snapshot = run.manifest.artifacts.skillSnapshot
        ? await (0, report_run_1.readRunArtifact)(run.runDir, "skillSnapshot")
        : null;
    const snapshotId = snapshot?.snapshotId;
    const tickets = {};
    let hasInFlightDispatchedWorkers = false;
    for (const lane of report_run_1.REPORT_LANES) {
        const laneInfo = run.manifest.laneStatus[lane];
        if ((0, report_run_1.isLaneTerminal)(laneInfo)) {
            continue;
        }
        const laneDispatched = (0, report_run_1.isLaneWorkerDispatched)(run.manifest, lane);
        if (!laneDispatched) {
            if (laneInfo.attempts === 0 && laneInfo.status === "pending") {
                tickets[lane] = await startLaneInternal(run, lane);
            }
            else {
                tickets[lane] = buildLaneTicket(run, lane, lane === "skill-insights" ? snapshotId : undefined);
            }
        }
        else {
            hasInFlightDispatchedWorkers = true;
        }
    }
    if (Object.keys(tickets).length > 0) {
        if (run.manifest.status === "prepared" || run.manifest.status === "evidence-ready") {
            await (0, report_run_1.setReportRunStatus)(run, "awaiting-ai");
        }
        process.stdout.write(JSON.stringify({
            status: "lanes-ready",
            runId: run.manifest.runId,
            runDir: run.runDir,
            auditFingerprint: run.manifest.auditFingerprint,
            bundleVersion: run.manifest.bundleVersion,
            locale: run.manifest.scope.locale,
            tickets,
        }) + "\n");
        return 0;
    }
    if (hasInFlightDispatchedWorkers) {
        process.stdout.write(JSON.stringify({
            status: "wait-workers",
            runId: run.manifest.runId,
            runDir: run.runDir,
            auditFingerprint: run.manifest.auditFingerprint,
            bundleVersion: run.manifest.bundleVersion,
            locale: run.manifest.scope.locale,
            tickets: {},
        }) + "\n");
        return 0;
    }
    process.stdout.write(JSON.stringify({
        action: "advance",
        status: "awaiting-advance",
        runId: run.manifest.runId,
        runDir: run.runDir,
        auditFingerprint: run.manifest.auditFingerprint,
        bundleVersion: run.manifest.bundleVersion,
        locale: run.manifest.scope.locale,
        tickets: {},
    }) + "\n");
    return 0;
}
async function reportRunAdvanceMain(args) {
    const { runDir, rest } = extractRunDirectory(args);
    if (!runDir)
        throw new Error(`report-run advance requires --run-dir <directory>.\n${usage()}`);
    let htmlPath = null;
    let locale = null;
    let fontPath = null;
    let fontFamily = null;
    let uiStatus = null;
    const workerObservations = [];
    let workerLane = null;
    let workerOutcome = null;
    let workerReason = null;
    for (let index = 0; index < rest.length; index += 1) {
        const flag = rest[index];
        if (flag === "--html") {
            htmlPath = requireValue(rest, index, flag);
            index += 1;
        }
        else if (flag === "--ui") {
            const val = requireValue(rest, index, flag);
            if (val !== "completed" && val !== "queued" && val !== "failed" && val !== "unavailable") {
                throw new Error(`--ui must be completed, queued, failed, or unavailable.\n${usage()}`);
            }
            uiStatus = val;
            index += 1;
        }
        else if (flag === "--locale" || flag === "--lang") {
            locale = (0, report_1.normalizeLocale)(requireValue(rest, index, flag));
            index += 1;
        }
        else if (flag === "--font") {
            fontPath = requireValue(rest, index, flag);
            index += 1;
        }
        else if (flag === "--font-family") {
            fontFamily = requireValue(rest, index, flag);
            index += 1;
        }
        else if (flag === "--worker-observation") {
            const raw = requireValue(rest, index, flag);
            index += 1;
            try {
                const parsed = JSON.parse(raw);
                const list = Array.isArray(parsed) ? parsed : [parsed];
                for (const item of list) {
                    if (!isRecord(item) || typeof item.lane !== "string" || typeof item.outcome !== "string") {
                        throw new Error("Invalid worker observation shape");
                    }
                    const lane = parseLane(item.lane);
                    const outcome = item.outcome;
                    if (outcome !== "crash" && outcome !== "timeout" && outcome !== "failed" && outcome !== "unavailable") {
                        throw new Error(`Invalid worker outcome: ${outcome}`);
                    }
                    workerObservations.push({
                        lane,
                        outcome,
                        reason: typeof item.reason === "string" ? item.reason : null,
                    });
                }
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                throw new Error(`Invalid --worker-observation: ${msg}.\n${usage()}`);
            }
        }
        else if (flag === "--worker-lane") {
            workerLane = parseLane(requireValue(rest, index, flag));
            index += 1;
        }
        else if (flag === "--worker-outcome") {
            const val = requireValue(rest, index, flag);
            if (val !== "crash" && val !== "timeout" && val !== "failed" && val !== "unavailable") {
                throw new Error(`--worker-outcome must be crash, timeout, failed, or unavailable.\n${usage()}`);
            }
            workerOutcome = val;
            index += 1;
        }
        else if (flag === "--worker-reason") {
            workerReason = requireValue(rest, index, flag);
            index += 1;
        }
        else {
            throw new Error(`Unknown report-run advance argument: ${flag}.\n${usage()}`);
        }
    }
    if (workerLane !== null && workerOutcome !== null) {
        workerObservations.push({
            lane: workerLane,
            outcome: workerOutcome,
            reason: workerReason,
        });
    }
    else if (workerLane !== null || workerOutcome !== null) {
        throw new Error(`--worker-lane and --worker-outcome must be specified together.\n${usage()}`);
    }
    const installedBundle = await (0, bundle_version_1.verifyInstalledSkill)();
    const run = await (0, report_run_1.openReportRun)(requireRunDirectory(runDir));
    (0, report_run_1.assertRunBundleVersion)(run, installedBundle.bundleVersion);
    const contract = await (0, report_run_1.resolveRunContractMetadata)();
    assertRunContract(run, installedBundle, contract);
    for (const obs of workerObservations) {
        const laneInfo = run.manifest.laneStatus[obs.lane];
        if (laneInfo && !(0, report_run_1.isLaneTerminal)(laneInfo)) {
            const reasonCode = obs.reason?.trim()
                ? obs.reason.trim()
                : obs.outcome === "timeout"
                    ? "WORKER_TIMEOUT"
                    : obs.outcome === "crash"
                        ? "WORKER_CRASHED"
                        : "WORKER_UNAVAILABLE";
            await (0, report_run_1.writeRunLaneArtifact)(run, obs.lane, "fallback", {
                version: 1,
                runId: run.manifest.runId,
                lane: obs.lane,
                attempt: laneInfo.attempts,
                status: "fallback",
                reasonCode,
                outputHash: null,
            }, laneInfo.attempts);
            await (0, report_run_1.finishReportLane)(run, obs.lane, laneInfo.attempts, run.manifest.stageStatus[obs.lane]?.spanId ?? (0, node_crypto_1.randomUUID)(), laneInfo.spanStartedAt ?? new Date().toISOString(), "unavailable", null, reasonCode, null, "host-agent", { workerOutcome: obs.outcome, observedReason: obs.reason ?? null });
        }
    }
    if (uiStatus === null) {
        if (run.manifest.status === "completed" && (run.manifest.cleanupStatus === "completed" || run.manifest.retention?.cleanedAt !== null)) {
            const targetHtmlPath = run.manifest.delivery?.targetPath ?? (run.manifest.artifacts.html ? path.join(run.runDir, run.manifest.artifacts.html.file) : "report.html");
            process.stdout.write(JSON.stringify({
                status: "completed",
                deliveryStatus: "completed",
                runId: run.manifest.runId,
                runDir: run.runDir,
                htmlPath: targetHtmlPath,
                cleanedUp: true,
            }) + "\n");
            return 0;
        }
        if (run.manifest.deliveryStatus === "completed") {
            const htmlRef = run.manifest.artifacts.html;
            const actualTargetPath = run.manifest.delivery?.targetPath ?? (htmlRef ? path.join(run.runDir, htmlRef.file) : null);
            let targetValid = true;
            if (actualTargetPath) {
                try {
                    const targetStat = await fs.stat(actualTargetPath);
                    const targetContents = await fs.readFile(actualTargetPath);
                    const expectedBytes = run.manifest.delivery?.bytes ?? htmlRef?.bytes;
                    const expectedHash = run.manifest.delivery?.sha256 ?? htmlRef?.sha256;
                    targetValid = targetStat.isFile()
                        && targetContents.byteLength === expectedBytes
                        && (0, node_crypto_1.createHash)("sha256").update(targetContents).digest("hex") === expectedHash
                        && (!run.manifest.delivery || run.manifest.delivery.bundleVersion === installedBundle.bundleVersion);
                }
                catch {
                    targetValid = false;
                }
            }
            if (!targetValid) {
                await (0, report_run_1.recordDeliveryTargetFailure)(run, "Actual delivery target file is missing, modified, or has bundle version drift.");
                process.stdout.write(JSON.stringify({
                    status: "incomplete",
                    deliveryStatus: "incomplete",
                    retryable: true,
                    runId: run.manifest.runId,
                    runDir: run.runDir,
                    uiDispatch: run.manifest.uiDispatch,
                    traceCompleteness: run.manifest.traceCompleteness,
                    warnings: run.manifest.warnings,
                    cleanedUp: false,
                    error: "DELIVERY_TARGET_INTEGRITY_FAILED",
                }) + "\n");
                return 0;
            }
            const cleanedManifest = await (0, report_run_1.cleanupSensitiveRunArtifacts)(run);
            const isCleaned = cleanedManifest.cleanupStatus === "completed";
            process.stdout.write(JSON.stringify({
                status: cleanedManifest.status,
                deliveryStatus: cleanedManifest.deliveryStatus,
                runId: cleanedManifest.runId,
                runDir: run.runDir,
                uiDispatch: cleanedManifest.uiDispatch,
                traceCompleteness: cleanedManifest.traceCompleteness,
                warnings: cleanedManifest.warnings,
                cleanedUp: isCleaned,
                ...(isCleaned ? {} : { retryable: true }),
            }) + "\n");
            return 0;
        }
        if (run.manifest.status === "awaiting-ui-dispatch" || (run.manifest.status === "incomplete" && run.manifest.artifacts.html)) {
            const targetHtmlPath = run.manifest.delivery?.targetPath ?? (run.manifest.artifacts.html ? path.join(run.runDir, run.manifest.artifacts.html.file) : "report.html");
            process.stdout.write(JSON.stringify({
                action: "open-html",
                status: run.manifest.status,
                runId: run.manifest.runId,
                runDir: run.runDir,
                htmlPath: targetHtmlPath,
                reportStatus: run.manifest.artifacts.reportSynthesis ? "ai-enhanced" : "fallback",
                fallback: !run.manifest.artifacts.reportSynthesis,
            }) + "\n");
            return 0;
        }
    }
    if (uiStatus !== null) {
        if (run.manifest.status === "completed" && (run.manifest.cleanupStatus === "completed" || run.manifest.retention?.cleanedAt !== null)) {
            process.stdout.write(JSON.stringify({
                status: "completed",
                deliveryStatus: "completed",
                runId: run.manifest.runId,
                runDir: run.runDir,
                uiDispatch: run.manifest.uiDispatch,
                traceCompleteness: run.manifest.traceCompleteness,
                warnings: run.manifest.warnings,
                cleanedUp: true,
            }) + "\n");
            return 0;
        }
        if (run.manifest.status !== "awaiting-ui-dispatch" && run.manifest.status !== "incomplete") {
            throw new Error(`Cannot submit --ui: Report Run is not awaiting UI dispatch (current status: ${run.manifest.status}).`);
        }
        const htmlRef = run.manifest.artifacts.html;
        if (!htmlRef) {
            throw new Error("Cannot submit --ui: Final HTML artifact was not recorded.");
        }
        const actualTargetPath = run.manifest.delivery?.targetPath ?? path.join(run.runDir, htmlRef.file);
        let targetValid = false;
        try {
            const targetStat = await fs.stat(actualTargetPath);
            const targetContents = await fs.readFile(actualTargetPath);
            const expectedBytes = run.manifest.delivery?.bytes ?? htmlRef.bytes;
            const expectedHash = run.manifest.delivery?.sha256 ?? htmlRef.sha256;
            targetValid = targetStat.isFile()
                && targetContents.byteLength === expectedBytes
                && (0, node_crypto_1.createHash)("sha256").update(targetContents).digest("hex") === expectedHash
                && (!run.manifest.delivery || run.manifest.delivery.bundleVersion === installedBundle.bundleVersion);
        }
        catch {
            targetValid = false;
        }
        if (!targetValid) {
            await (0, report_run_1.recordDeliveryTargetFailure)(run, "Actual delivery target file is missing, modified, or has bundle version drift.");
            process.stdout.write(JSON.stringify({
                status: "incomplete",
                deliveryStatus: "incomplete",
                retryable: true,
                runId: run.manifest.runId,
                runDir: run.runDir,
                uiDispatch: run.manifest.uiDispatch,
                traceCompleteness: run.manifest.traceCompleteness,
                warnings: run.manifest.warnings,
                cleanedUp: false,
                error: "DELIVERY_TARGET_INTEGRITY_FAILED",
            }) + "\n");
            return 0;
        }
        const now = new Date().toISOString();
        await (0, report_run_1.recordRunSpan)(run.runDir, {
            event: "start",
            spanId: `ui-dispatch:${run.manifest.runId}`,
            phase: "ui-dispatch",
            operation: "open-html",
            source: "host-agent",
            attempt: 1,
            startedAt: now,
            metadata: { status: uiStatus },
        });
        await (0, report_run_1.recordRunSpan)(run.runDir, {
            event: "end",
            spanId: `ui-dispatch:${run.manifest.runId}`,
            phase: "ui-dispatch",
            operation: "open-html",
            source: "host-agent",
            attempt: 1,
            startedAt: now,
            endedAt: now,
            durationMs: null,
            status: uiStatus === "completed" || uiStatus === "queued" ? "completed" : "failed",
            metadata: { status: uiStatus, generationTimingStatus: "unavailable" },
        });
        await (0, report_run_1.setRunUiDispatch)(run, uiStatus);
        if (uiStatus === "completed" || uiStatus === "queued") {
            if (run.manifest.delivery) {
                await (0, report_run_1.recordRunDelivery)(run, {
                    ...run.manifest.delivery,
                    uiStatus,
                });
            }
            await (0, report_run_1.finalizeReportRun)(run, "completed");
            if (run.manifest.deliveryStatus !== "completed") {
                process.stdout.write(JSON.stringify({
                    status: run.manifest.status,
                    deliveryStatus: run.manifest.deliveryStatus,
                    retryable: true,
                    runId: run.manifest.runId,
                    runDir: run.runDir,
                    uiDispatch: run.manifest.uiDispatch,
                    traceCompleteness: run.manifest.traceCompleteness,
                    warnings: run.manifest.warnings,
                    cleanedUp: false,
                    error: "FINALIZATION_FAILED",
                }) + "\n");
                return 0;
            }
            const cleanedManifest = await (0, report_run_1.cleanupSensitiveRunArtifacts)(run);
            const isCleaned = cleanedManifest.cleanupStatus === "completed";
            process.stdout.write(JSON.stringify({
                status: cleanedManifest.status,
                deliveryStatus: cleanedManifest.deliveryStatus,
                runId: cleanedManifest.runId,
                runDir: run.runDir,
                uiDispatch: cleanedManifest.uiDispatch,
                traceCompleteness: cleanedManifest.traceCompleteness,
                warnings: cleanedManifest.warnings,
                cleanedUp: isCleaned,
                ...(isCleaned ? {} : { retryable: true }),
            }) + "\n");
            return 0;
        }
        else {
            await (0, report_run_1.recordIncompleteUiDispatch)(run, uiStatus);
            process.stdout.write(JSON.stringify({
                status: "incomplete",
                deliveryStatus: "incomplete",
                retryable: true,
                runId: run.manifest.runId,
                runDir: run.runDir,
                uiDispatch: run.manifest.uiDispatch,
                traceCompleteness: run.manifest.traceCompleteness,
                warnings: run.manifest.warnings,
                cleanedUp: false,
            }) + "\n");
            return 0;
        }
    }
    const claim = await (0, report_run_1.claimReportRunAdvance)(run);
    if (!claim.claimed) {
        if (claim.status === "lanes-not-ready") {
            process.stdout.write(JSON.stringify({
                status: "lanes-not-ready",
                ready: false,
                runId: run.manifest.runId,
                runDir: run.runDir,
                pendingLanes: claim.pendingLanes,
                laneStatus: run.manifest.laneStatus,
            }) + "\n");
            return 0;
        }
        if (claim.inProgress) {
            process.stdout.write(JSON.stringify({
                status: "in-progress",
                ready: false,
                runId: run.manifest.runId,
                runDir: run.runDir,
            }) + "\n");
            return 0;
        }
        process.stdout.write(JSON.stringify({
            status: claim.status,
            ready: false,
            runId: run.manifest.runId,
            runDir: run.runDir,
        }) + "\n");
        return 0;
    }
    const effectiveHtmlPath = htmlPath ?? path.join(run.runDir, "report.html");
    const effectiveLocale = locale ?? run.manifest.scope.locale;
    const result = await composeAndRenderRun(run, {
        locale: effectiveLocale,
        htmlPath: effectiveHtmlPath,
        fontPath,
        fontFamily,
    });
    process.stdout.write(JSON.stringify({
        action: "open-html",
        status: "awaiting-ui-dispatch",
        runId: run.manifest.runId,
        runDir: run.runDir,
        htmlPath: result.output,
        reportStatus: result.composition.reportSynthesis ? "ai-enhanced" : "fallback",
        fallback: result.composition.reportSynthesis === null,
    }) + "\n");
    return 0;
}
async function reportRunRunAllFinishMain(args) {
    const { runDir, rest } = extractRunDirectory(args);
    if (!runDir)
        throw new Error(`report-run run-all finish requires --run-dir <directory>.\n${usage()}`);
    let htmlPath = null;
    let locale = null;
    let fontPath = null;
    let fontFamily = null;
    for (let index = 0; index < rest.length; index += 1) {
        const flag = rest[index];
        if (flag === "--html") {
            htmlPath = requireValue(rest, index, flag);
            index += 1;
        }
        else if (flag === "--locale" || flag === "--lang") {
            locale = (0, report_1.normalizeLocale)(requireValue(rest, index, flag));
            index += 1;
        }
        else if (flag === "--font") {
            fontPath = requireValue(rest, index, flag);
            index += 1;
        }
        else if (flag === "--font-family") {
            fontFamily = requireValue(rest, index, flag);
            index += 1;
        }
        else {
            throw new Error(`Unknown report-run run-all finish argument: ${flag}.\n${usage()}`);
        }
    }
    const installedBundle = await (0, bundle_version_1.verifyInstalledSkill)();
    const run = await (0, report_run_1.openReportRun)(requireRunDirectory(runDir));
    (0, report_run_1.assertRunBundleVersion)(run, installedBundle.bundleVersion);
    const contract = await (0, report_run_1.resolveRunContractMetadata)();
    assertRunContract(run, installedBundle, contract);
    const eligibleLanes = Object.keys(run.manifest.laneStatus);
    const pendingLanes = eligibleLanes.filter((lane) => !(0, report_run_1.isLaneTerminal)(run.manifest.laneStatus[lane]));
    if (pendingLanes.length > 0) {
        process.stdout.write(JSON.stringify({
            status: "lanes-not-ready",
            ready: false,
            runId: run.manifest.runId,
            runDir: run.runDir,
            pendingLanes,
            laneStatus: run.manifest.laneStatus,
        }) + "\n");
        return 0;
    }
    const effectiveHtmlPath = htmlPath ?? path.join(run.runDir, "report.html");
    const effectiveLocale = locale ?? run.manifest.scope.locale;
    const result = await composeAndRenderRun(run, {
        locale: effectiveLocale,
        htmlPath: effectiveHtmlPath,
        fontPath,
        fontFamily,
    });
    process.stdout.write(JSON.stringify({
        status: "awaiting-ui-dispatch",
        runId: run.manifest.runId,
        runDir: run.runDir,
        htmlPath: result.output,
        reportStatus: result.composition.reportSynthesis ? "ai-enhanced" : "fallback",
        fallback: result.composition.reportSynthesis === null,
    }) + "\n");
    return 0;
}
async function reportRunPreflightMain(args) {
    let skillRoot;
    for (let index = 0; index < args.length; index += 1) {
        if (args[index] === "--skill-root") {
            skillRoot = requireValue(args, index, "--skill-root");
            index += 1;
        }
        else {
            throw new Error(`Unknown report-run preflight argument: ${args[index]}.\n${usage()}`);
        }
    }
    const bundle = await (0, bundle_version_1.verifySkillPackage)(skillRoot);
    process.stdout.write(JSON.stringify({
        status: "passed",
        productVersion: bundle.productVersion,
        bundleVersion: bundle.bundleVersion,
        auditSchemaVersion: bundle.auditSchemaVersion,
    }) + "\n");
    return 0;
}
async function reportRunRunAllMain(args) {
    const command = args[0];
    if (command === "start")
        return reportRunRunAllStartMain(args.slice(1));
    if (command === "finish")
        return reportRunRunAllFinishMain(args.slice(1));
    throw new Error(`Use report-run run-all start or finish.\n${usage()}`);
}
async function reportRunMain(args) {
    const command = args[0];
    if (command === "preflight")
        return reportRunPreflightMain(args.slice(1));
    if (command === "advance")
        return reportRunAdvanceMain(args.slice(1));
    if (command === "run-all")
        return reportRunRunAllMain(args.slice(1));
    if (command === "prepare")
        return reportRunPrepareMain(args.slice(1));
    if (command === "evidence")
        return reportRunEvidenceMain(args.slice(1));
    if (command === "ai-start")
        return reportRunAiStartMain(args.slice(1));
    if (command === "ai-accept")
        return reportRunAiAcceptMain(args.slice(1));
    if (command === "ai-fallback")
        return reportRunAiFallbackMain(args.slice(1));
    if (command === "compose")
        return reportRunComposeMain(args.slice(1));
    if (command === "event")
        return reportRunEventMain(args.slice(1));
    if (command === "status")
        return reportRunStatusMain(args.slice(1));
    if (command === "finalize")
        return reportRunFinalizeMain(args.slice(1));
    if (command === "cleanup")
        return reportRunCleanupMain(args.slice(1));
    throw new Error(`Use report-run preflight, advance, run-all, prepare, evidence, ai-start, ai-accept, ai-fallback, compose, event, status, finalize, or cleanup.\n${usage()}`);
}
async function composeReportMain(args) {
    const options = parseComposeArgs(args);
    const input = await readStdin();
    if (!input.trim())
        throw new Error("compose-report requires one JSON composition envelope on stdin.");
    const parsed = JSON.parse(input);
    if (!isRecord(parsed) || !isRecord(parsed.audit)) {
        throw new Error("compose-report requires an envelope with a structured AuditResult under audit.");
    }
    const audit = parsed.audit;
    const expectedFingerprint = (0, key_session_analysis_1.auditFingerprint)(audit);
    const envelopeFingerprintMatches = parsed.auditFingerprint === expectedFingerprint;
    const synthesisValidation = envelopeFingerprintMatches
        ? (0, key_session_analysis_1.validateReportSynthesis)(audit, parsed.reportSynthesis ?? null)
        : { valid: false, errors: ["The supplied Audit fingerprint does not match the current Audit."], synthesis: null };
    const validatedSynthesis = synthesisValidation.valid ? synthesisValidation.synthesis : null;
    const analyses = (Array.isArray(parsed.keySessionAnalyses) ? parsed.keySessionAnalyses : []);
    const projectName = typeof parsed.projectName === "string" && parsed.projectName.trim() ? parsed.projectName.trim() : undefined;
    const composition = { ...(0, key_session_analysis_1.reportComposition)(audit, analyses, validatedSynthesis), ...(projectName ? { projectName } : {}) };
    const firstUserMessages = (Array.isArray(parsed.firstUserMessages) ? parsed.firstUserMessages : []);
    const output = await writeLocalFile(options.htmlPath, await (0, report_1.subsetReportFonts)((0, report_1.renderHtml)(audit, options.locale, composition, firstUserMessages, reportFontConfig(options.fontPath, options.fontFamily))));
    process.stdout.write("Output: final HTML report written to " + output + ".\n");
    return 0;
}
function parseReportJson(value) {
    if (!isRecord(value) || value.version !== 1 || !isRecord(value.audit) || !isRecord(value.ai) || !isRecord(value.render)) {
        throw new Error("render-report requires a version 1 report.json.");
    }
    const { audit, ai, render } = value;
    const reportSynthesis = ai.reportSynthesis;
    const keySessionAnalyses = ai.keySessionAnalyses;
    const skillInsights = ai.skillInsights;
    const font = render.font;
    const validFallback = (fallback) => fallback === null || typeof fallback === "string";
    if (!isRecord(audit.scope) || !isRecord(audit.coverage) || !isRecord(audit.summary) || !isRecord(audit.rankings) || !isRecord(audit.report)
        || !Array.isArray(audit.turns) || !Array.isArray(audit.checks)
        || !isRecord(reportSynthesis) || !(reportSynthesis.result === null || isRecord(reportSynthesis.result)) || !validFallback(reportSynthesis.fallbackReason)
        || !isRecord(keySessionAnalyses) || !Array.isArray(keySessionAnalyses.result) || !keySessionAnalyses.result.every(isRecord) || !validFallback(keySessionAnalyses.fallbackReason)
        || !isRecord(skillInsights) || !Array.isArray(skillInsights.result) || !skillInsights.result.every(isRecord) || !validFallback(skillInsights.fallbackReason)
        || (render.locale !== "zh-CN" && render.locale !== "en-US")
        || !(render.projectName === null || typeof render.projectName === "string")
        || !Array.isArray(render.firstUserMessages) || !render.firstUserMessages.every((record) => isRecord(record)
        && typeof record.sessionId === "string" && typeof record.turnId === "string"
        && (record.content === null || typeof record.content === "string")
        && (record.unavailableReason === null || typeof record.unavailableReason === "string"))) {
        throw new Error("render-report received a malformed report.json.");
    }
    if (!isRecord(font) || (font.source !== "bundled" && !(font.source === "custom" && typeof font.filePath === "string" && (font.family === null || typeof font.family === "string")))) {
        throw new Error("render-report received a malformed report.json font setting.");
    }
    return value;
}
async function renderReportMain(args) {
    let jsonPath = null;
    let htmlPath = null;
    let runDir = null;
    for (let index = 0; index < args.length; index += 1) {
        const flag = args[index];
        if (flag === "--json") {
            if (jsonPath)
                throw new Error("render-report accepts --json only once.");
            jsonPath = requireValue(args, index, flag);
            index += 1;
        }
        else if (flag === "--html") {
            if (htmlPath)
                throw new Error("render-report accepts --html only once.");
            htmlPath = requireValue(args, index, flag);
            index += 1;
        }
        else if (flag === "--run-dir") {
            if (runDir)
                throw new Error("render-report accepts --run-dir only once.");
            runDir = requireValue(args, index, flag);
            index += 1;
        }
        else {
            throw new Error(`Unknown render-report argument: ${flag}.\n${usage()}`);
        }
    }
    if (!jsonPath || !htmlPath)
        throw new Error(`render-report requires --json <report.json> and --html <final-path>.\n${usage()}`);
    const run = runDir ? await (0, report_run_1.openReportRun)(path.resolve(runDir)) : null;
    try {
        let value;
        if (run) {
            const installedBundle = await (0, bundle_version_1.verifyInstalledSkill)();
            (0, report_run_1.assertRunBundleVersion)(run, installedBundle.bundleVersion);
            const reportJsonArtifact = run.manifest.artifacts.reportJson;
            if (!reportJsonArtifact || path.resolve(jsonPath) !== path.resolve(run.runDir, reportJsonArtifact.file)) {
                throw new Error("REPORT_JSON_RUN_MISMATCH: render-report must consume this Report Run's registered report.json.");
            }
            value = await (0, report_run_1.readRunArtifact)(run.runDir, "reportJson");
        }
        else {
            value = JSON.parse(await fs.readFile(jsonPath, "utf8"));
        }
        const report = parseReportJson(value);
        if (run && (!run.manifest.auditFingerprint || (0, key_session_analysis_1.auditFingerprint)(report.audit) !== run.manifest.auditFingerprint)) {
            throw new Error("REPORT_JSON_RUN_FINGERPRINT_MISMATCH: report.json does not match this Report Run.");
        }
        const rendered = run
            ? await (0, report_run_1.withRunSpan)(run, { phase: "render", operation: "render-report-json", source: "runner" }, async () => (0, report_1.renderReportJson)(report))
            : (0, report_1.renderReportJson)(report);
        const html = run
            ? await (0, report_run_1.withRunSpan)(run, { phase: "font-subset", operation: "subset-report-fonts", source: "runner" }, async () => (0, report_1.subsetReportFonts)(rendered))
            : await (0, report_1.subsetReportFonts)(rendered);
        const output = run
            ? await (0, report_run_1.withRunSpan)(run, { phase: "html-write", operation: "write-final-html", source: "filesystem" }, async () => {
                await (0, report_run_1.writeRunTextArtifact)(run, "html", html);
                return writeAtomicLocal(htmlPath, html);
            })
            : await writeAtomicLocal(htmlPath, html);
        if (run) {
            outputRunSummary(run, {
                reportStatus: report.ai.reportSynthesis.result ? "ai-enhanced" : "fallback",
                htmlPath: output,
                next: ["record codex-open", "finalize"],
            });
        }
        else {
            process.stdout.write("Output: final HTML report written to " + output + ".\n");
        }
        return 0;
    }
    catch (error) {
        if (run)
            await (0, report_run_1.setReportRunStatus)(run, "failed").catch(() => undefined);
        throw error;
    }
}
async function main(args = process.argv.slice(2)) {
    try {
        if (args[0] === "report-run")
            return await reportRunMain(args.slice(1));
        if (args[0] === "render-report")
            return await renderReportMain(args.slice(1));
        if (args[0] === "compose-report")
            return await composeReportMain(args.slice(1));
        const options = parseArgs(args);
        await (0, bundle_version_1.verifyInstalledSkill)();
        let result;
        let localFirstUserMessages = [];
        if (options.view === "week") {
            const currentTo = new Date();
            const currentFrom = new Date(currentTo.getTime() - 7 * 24 * 60 * 60 * 1000);
            const previousFrom = new Date(currentFrom.getTime() - 7 * 24 * 60 * 60 * 1000);
            const sourceScope = { cwd: options.cwd, allProjects: options.allProjects, since: previousFrom };
            const sourceRead = await readHarness(options.harness, sourceScope);
            const pricing = await (0, rates_1.resolveApiPricing)(sourceRead.modelCalls, options.harness, options.pricing);
            const currentScope = { cwd: options.cwd, allProjects: options.allProjects, since: currentFrom };
            const previousScope = { cwd: options.cwd, allProjects: options.allProjects, since: previousFrom };
            const current = (0, analysis_1.analyseAudit)(currentScope, sliceRead(sourceRead, currentFrom, currentTo), options.harness, pricing);
            const previous = (0, analysis_1.analyseAudit)(previousScope, sliceRead(sourceRead, previousFrom, currentFrom), options.harness, pricing);
            result = { ...current, view: "week", weekComparison: makeWeekComparison(current, previous, currentFrom, currentTo, previousFrom) };
        }
        else {
            const since = options.view === "share" && !options.sinceExplicit ? parseDuration("30d") : options.since;
            const scope = { cwd: options.cwd, allProjects: options.allProjects, since };
            const read = await readHarness(options.harness, scope);
            const pricing = await (0, rates_1.resolveApiPricing)(read.modelCalls, options.harness, options.pricing);
            result = { ...(0, analysis_1.analyseAudit)(scope, read, options.harness, pricing), view: options.view };
            const topSessionIds = new Set(result.rankings.sessions.slice(0, 3).map((session) => session.key));
            localFirstUserMessages = (read.firstUserMessages ?? []).filter((record) => topSessionIds.has(record.sessionId));
        }
        const outputKinds = [];
        const shouldWriteHtml = options.htmlPath !== null;
        if (shouldWriteHtml) {
            const target = options.htmlPath;
            const projectName = options.cwd ? (0, report_1.resolveReportProjectName)(options.cwd) : null;
            const htmlResult = projectName ? { ...result, projectName } : result;
            await writeLocalFile(target, await (0, report_1.subsetReportFonts)((0, report_1.renderHtml)(htmlResult, options.locale, undefined, localFirstUserMessages, reportFontConfig(options.fontPath, options.fontFamily))));
            outputKinds.push("local HTML report");
        }
        if (options.sharePath !== null || options.view === "share") {
            const target = options.sharePath ?? defaultOutputPath(options.harness, "share", ".md");
            await writeLocalFile(target, (0, report_1.renderShare)(result, options.locale));
            outputKinds.push("local share Markdown");
        }
        if (options.format === "json") {
            process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        }
        else if (result.weekComparison) {
            process.stdout.write((0, report_1.renderWeekText)(result.weekComparison, options.locale));
        }
        else {
            process.stdout.write((0, report_1.renderText)(result, options.locale, options.view));
        }
        if (options.format === "text" && outputKinds.length > 0) {
            process.stdout.write(outputKinds.map((outputKind) => "Output: " + outputKind + " written.").join("\n") + "\n");
        }
        return 0;
    }
    catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : "where-tokens-went failed."}\n`);
        return 2;
    }
}
if (require.main === module) {
    void main().then((code) => {
        process.exitCode = code;
    });
}
