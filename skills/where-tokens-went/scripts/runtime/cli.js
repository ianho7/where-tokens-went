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
const report_1 = require("./report");
const skill_insights_1 = require("./skill-insights");
function usage() {
    return [
        "Usage: where-tokens-went inspect --harness <claude|codex> --cwd <absolute-path> [--since 7d] [--format json|text] [--locale zh-CN|en-US] [--font <font-file>] [--font-family <name>] [--pricing litellm] [--view full|usage|window|report|tools|week|share]",
        "       where-tokens-went inspect --harness <claude|codex> --all-projects [--since 7d] [--format json|text] [--locale zh-CN|en-US] [--font <font-file>] [--font-family <name>] [--pricing litellm] [--view full|usage|window|report|tools|week|share]",
        "       where-tokens-went compose-report --locale zh-CN|en-US --font <font-file> [--font-family <name>] --html <final-path> < composition JSON envelope",
        "       where-tokens-went report-run prepare --harness <claude|codex> (--cwd <absolute-path>|--all-projects) [--since 7d] [--locale zh-CN|en-US] [--pricing litellm] [--run-dir <directory>]",
        "       where-tokens-went report-run evidence --run-dir <directory> < evidence selection JSON",
        "       where-tokens-went report-run compose --run-dir <directory> --html <final-path> [--font <font-file>] [--font-family <name>] < AI output JSON",
        "       where-tokens-went report-run event|status|finalize --run-dir <directory> ...",
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
            if (value !== "codex" && value !== "claude")
                throw new Error(`Unsupported Harness ${value}; supported Harnesses are claude and codex.\n${usage()}`);
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
    return path.resolve(runDir);
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
        warnings: run.manifest.warnings,
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
    catch {
        await fs.writeFile(absolute, contents, "utf8");
        await fs.unlink(temporary).catch(() => undefined);
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
async function reportRunPrepareMain(args) {
    const { runDir, rest } = extractRunDirectory(args);
    const frozenNow = Date.now();
    const options = parseArgs(["inspect", ...rest], frozenNow);
    if (options.view !== "full")
        throw new Error("report-run prepare only supports the full report workflow.");
    if (options.htmlPath || options.sharePath)
        throw new Error("report-run prepare does not write HTML or share output.");
    const installedBundle = await (0, bundle_version_1.verifyInstalledSkill)();
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
        const contract = await (0, report_run_1.withRunSpan)(run, { phase: "prompt-read", operation: "resolve-report-contract", source: "filesystem" }, async () => {
            const metadata = await (0, report_run_1.resolveRunContractMetadata)();
            if (!metadata.promptHashes.reportSynthesis || !metadata.promptHashes.keySessionAnalysis || !metadata.promptHashes.skillInsights)
                throw new Error("Authoritative Report Prompts are unavailable for this run.");
            if (!metadata.bundleVersion || metadata.bundleVersion.bundleVersion !== installedBundle.bundleVersion)
                throw new Error("The packaged bundle changed before Report Run preparation completed. Run npm run install-local.");
            return metadata;
        });
        await (0, report_run_1.setRunPromptHashes)(run, contract.promptHashes, contract.runtimeHash);
        const before = await (0, report_run_1.withRunSpan)(run, { phase: "source-inventory", operation: "inventory-history-before", source: "filesystem" }, () => (0, report_run_1.captureSourceInventory)(scope.harness));
        const read = await (0, report_run_1.withRunSpan)(run, { phase: "history-read", operation: "read-historical-records", source: "filesystem" }, () => readHarness(scope.harness, scope));
        const pricing = await (0, report_run_1.withRunSpan)(run, { phase: "price-resolution", operation: "resolve-api-pricing", source: "runner" }, () => (0, rates_1.resolveApiPricing)(read.modelCalls, scope.harness, options.pricing, undefined, undefined, (event) => recordPricingTiming(run, event)));
        const audit = await (0, report_run_1.withRunSpan)(run, { phase: "deterministic-analysis", operation: "analyse-audit", source: "runner" }, async () => (0, analysis_1.analyseAudit)(scope, read, scope.harness, pricing));
        const after = await (0, report_run_1.withRunSpan)(run, { phase: "source-inventory", operation: "inventory-history-after", source: "filesystem", attempt: 2 }, () => (0, report_run_1.captureSourceInventory)(scope.harness));
        await (0, report_run_1.setRunSourceInventory)(run, before, after);
        if (run.manifest.sourceInventory?.mutated === true && !audit.coverage.warnings.includes("History source files changed while the Audit was being read.")) {
            audit.coverage.warnings.push("History source files changed while the Audit was being read.");
        }
        await (0, report_run_1.writeRunArtifact)(run, "audit", audit);
        await (0, report_run_1.writeRunArtifact)(run, "firstUserMessages", read.firstUserMessages ?? []);
        await (0, report_run_1.setRunTopSessions)(run, audit.rankings.sessions, read.sessions);
        await (0, report_run_1.setRunAuditFingerprint)(run, (0, key_session_analysis_1.auditFingerprint)(audit));
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
        outputRunSummary(run, { next: ["evidence", "report-synthesis", "key-session-analysis", "skill-insights", "compose", "finalize"] });
        return 0;
    }
    catch (error) {
        if (run)
            await markPreparedRunFailed(run);
        throw error;
    }
}
async function reportRunEvidenceMain(args) {
    const { runDir, rest } = extractRunDirectory(args);
    if (rest.length > 0)
        throw new Error(`Unknown report-run evidence argument: ${rest[0]}.\n${usage()}`);
    const installedBundle = await (0, bundle_version_1.verifyInstalledSkill)();
    const run = await (0, report_run_1.openReportRun)(requireRunDirectory(runDir));
    (0, report_run_1.assertRunBundleVersion)(run, installedBundle.bundleVersion);
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
            .filter((s) => typeof s.filePath === 'string' && s.filePath.length > 0)
            .map((s) => ({ sessionId: s.sessionId, filePath: s.filePath })),
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
    return { ...parseComposeArgs(extracted.rest), runDir: requireRunDirectory(extracted.runDir) };
}
function validExternalSource(value) {
    return value === "runner" || value === "skill" || value === "host-agent" || value === "network" || value === "filesystem" || value === "ui";
}
function validTerminalStatus(value) {
    return value === "completed" || value === "failed" || value === "fallback" || value === "queued" || value === "reused" || value === "skipped" || value === "unavailable" || value === "interrupted";
}
async function reportRunComposeMain(args) {
    const options = parseRunComposeArgs(args);
    const installedBundle = await (0, bundle_version_1.verifyInstalledSkill)();
    const run = await (0, report_run_1.openReportRun)(options.runDir);
    (0, report_run_1.assertRunBundleVersion)(run, installedBundle.bundleVersion);
    if (options.locale !== run.manifest.scope.locale)
        throw new Error("Report Run locale does not match the compose request.");
    const audit = await readCanonicalAudit(run);
    const runFingerprint = run.manifest.auditFingerprint;
    if (!runFingerprint)
        throw new Error("Report Run Audit fingerprint is unavailable.");
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
            const input = await readStdin();
            if (!input.trim())
                throw new Error("report-run compose requires one AI output JSON envelope on stdin.");
            const parsed = JSON.parse(input);
            if (!isRecord(parsed))
                throw new Error("report-run compose requires a JSON object.");
            if (parsed.runId !== run.manifest.runId || parsed.auditFingerprint !== run.manifest.auditFingerprint)
                throw new Error("AI output runId or Audit fingerprint does not match the Report Run.");
            if ("audit" in parsed)
                throw new Error("AI output must not carry a second AuditResult; use the canonical Report Run artifact.");
            if (!isRecord(parsed.promptHashes) || parsed.promptHashes.reportSynthesis !== currentContract.promptHashes.reportSynthesis || parsed.promptHashes.keySessionAnalysis !== currentContract.promptHashes.keySessionAnalysis || parsed.promptHashes.skillInsights !== currentContract.promptHashes.skillInsights || parsed.runtimeHash !== currentContract.runtimeHash)
                throw new Error("AI output Prompt or runtime contract does not match the current Report Run.");
            if (run.manifest.promptHashes.reportSynthesis !== currentContract.promptHashes.reportSynthesis || run.manifest.promptHashes.keySessionAnalysis !== currentContract.promptHashes.keySessionAnalysis || run.manifest.promptHashes.skillInsights !== currentContract.promptHashes.skillInsights || run.manifest.runtimeHash !== currentContract.runtimeHash)
                throw new Error("Report Prompt or runtime contract changed during execution; the Run cannot continue. Run npm run install-local.");
            if (parsed.reportSynthesis === undefined) {
                const fileCandidate = path.join(run.runDir, "report-synthesis.json");
                try {
                    synthesisCandidate = JSON.parse(await fs.readFile(fileCandidate, "utf8"));
                }
                catch {
                    synthesisCandidate = null;
                }
            }
            else {
                synthesisCandidate = parsed.reportSynthesis === null ? null : parsed.reportSynthesis;
            }
            if (parsed.keySessionAnalyses === undefined) {
                const fileCandidate = path.join(run.runDir, "key-session-analyses.json");
                try {
                    const loaded = JSON.parse(await fs.readFile(fileCandidate, "utf8"));
                    analyses = (Array.isArray(loaded) ? loaded : []).slice(0, 3);
                }
                catch {
                    analyses = [];
                }
            }
            else {
                const suppliedAnalyses = Array.isArray(parsed.keySessionAnalyses) ? parsed.keySessionAnalyses : [];
                analyses = suppliedAnalyses.slice(0, 3);
            }
            if (analyses.length > 3)
                run.manifest.warnings.push("More than three Key Session Analyses were supplied; only the Token-ranked Top 3 are eligible.");
            if (analyses.length > 0 && packets === undefined)
                throw new Error("Key Session Analysis requires the run-scoped Evidence artifact.");
            let rawSkillInsights = undefined;
            if (parsed.skillInsights === undefined) {
                const fileCandidate = path.join(run.runDir, "skill-insights.json");
                try {
                    rawSkillInsights = JSON.parse(await fs.readFile(fileCandidate, "utf8"));
                }
                catch {
                    rawSkillInsights = null;
                }
            }
            else {
                rawSkillInsights = parsed.skillInsights;
            }
            if (rawSkillInsights !== undefined && rawSkillInsights !== null) {
                skillInsightsStatus = "fallback";
            }
            if (run.manifest.artifacts.skillSnapshot) {
                try {
                    const snapshot = await (0, report_run_1.readRunArtifact)(run.runDir, "skillSnapshot");
                    if (snapshot) {
                        skillInsightsSnapshotId = snapshot.snapshotId;
                        if (rawSkillInsights) {
                            const validation = (0, skill_insights_1.validateSkillInsights)(rawSkillInsights, snapshot);
                            skillInsightsRejectionReasons = validation.rejectionReasons;
                            if (validation.valid) {
                                validatedSkillInsights = validation.insights;
                                skillInsightsValid = true;
                                skillInsightsStatus = "completed";
                            }
                            if (validation.errors.length > 0) {
                                run.manifest.warnings.push(`Skill Insights validation: ${validation.errors.join("; ")}`);
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
                run.manifest.warnings.push("Report Synthesis was unavailable or failed validation; deterministic fallback is used.");
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
                run.manifest.warnings.push(`${invalidKeyCount} Key Session Analysis entr${invalidKeyCount === 1 ? "y" : "ies"} failed validation and will be omitted.${errorDetails.length > 0 ? " Reasons: " + errorDetails.join("; ") : ""}`);
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
        const fontConfig = reportFontConfig(options.fontPath, options.fontFamily);
        const rendered = await (0, report_run_1.withRunSpan)(run, { phase: "render", operation: "render-html", source: "runner" }, async () => (0, report_1.renderHtml)(audit, options.locale, renderComposition, firstUserMessages, fontConfig));
        const subsetted = await (0, report_run_1.withRunSpan)(run, { phase: "font-subset", operation: "subset-report-fonts", source: "runner" }, async () => (0, report_1.subsetReportFonts)(rendered));
        const output = await (0, report_run_1.withRunSpan)(run, { phase: "html-write", operation: "write-final-html", source: "filesystem" }, async () => {
            await (0, report_run_1.writeRunTextArtifact)(run, "html", subsetted);
            return writeAtomicLocal(options.htmlPath, subsetted);
        });
        outputRunSummary(run, {
            reportStatus: composition.reportSynthesis ? "ai-enhanced" : "fallback",
            fallback: composition.reportSynthesis === null,
            htmlPath: output,
            next: ["record codex-open", "finalize"],
        });
        return 0;
    }
    catch (error) {
        await (0, report_run_1.setReportRunStatus)(run, "failed").catch(() => undefined);
        throw error;
    }
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
async function reportRunMain(args) {
    const command = args[0];
    if (command === "prepare")
        return reportRunPrepareMain(args.slice(1));
    if (command === "evidence")
        return reportRunEvidenceMain(args.slice(1));
    if (command === "compose")
        return reportRunComposeMain(args.slice(1));
    if (command === "event")
        return reportRunEventMain(args.slice(1));
    if (command === "status")
        return reportRunStatusMain(args.slice(1));
    if (command === "finalize")
        return reportRunFinalizeMain(args.slice(1));
    throw new Error(`Use report-run prepare, evidence, compose, event, status, or finalize.\n${usage()}`);
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
async function main(args = process.argv.slice(2)) {
    try {
        if (args[0] === "report-run")
            return await reportRunMain(args.slice(1));
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
