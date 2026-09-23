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
exports.DEFAULT_RUN_STAGES = void 0;
exports.assertLocalSensitiveRunDirectory = assertLocalSensitiveRunDirectory;
exports.createReportRun = createReportRun;
exports.openReportRun = openReportRun;
exports.setReportRunStatus = setReportRunStatus;
exports.setRunEligibleStages = setRunEligibleStages;
exports.setRunPromptHashes = setRunPromptHashes;
exports.setRunSourceInventory = setRunSourceInventory;
exports.setRunAuditFingerprint = setRunAuditFingerprint;
exports.setRunTopSessions = setRunTopSessions;
exports.withRunSpan = withRunSpan;
exports.finishRunSpan = finishRunSpan;
exports.finalizeReportRun = finalizeReportRun;
exports.writeRunArtifact = writeRunArtifact;
exports.writeRunTextArtifact = writeRunTextArtifact;
exports.writeRunLaneArtifact = writeRunLaneArtifact;
exports.writeRunLaneRawArtifact = writeRunLaneRawArtifact;
exports.readRunLaneArtifact = readRunLaneArtifact;
exports.startReportLane = startReportLane;
exports.finishReportLane = finishReportLane;
exports.setRunUiDispatch = setRunUiDispatch;
exports.appendRunWarnings = appendRunWarnings;
exports.cleanupSensitiveRunArtifacts = cleanupSensitiveRunArtifacts;
exports.registerRunArtifact = registerRunArtifact;
exports.readRunManifest = readRunManifest;
exports.readRunArtifact = readRunArtifact;
exports.recordRunSpan = recordRunSpan;
exports.recordRunSpanInProcess = recordRunSpanInProcess;
exports.recordCompletedRunSpan = recordCompletedRunSpan;
exports.captureSourceInventory = captureSourceInventory;
exports.resolveRunContractMetadata = resolveRunContractMetadata;
exports.assertRunBundleVersion = assertRunBundleVersion;
const promises_1 = require("node:fs/promises");
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
const node_perf_hooks_1 = require("node:perf_hooks");
const bundle_version_1 = require("./bundle-version");
function isWithin(root, target) {
    const relative = path.relative(path.resolve(root), path.resolve(target));
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
function assertLocalSensitiveRunDirectory(runDir) {
    const resolved = path.resolve(runDir);
    const repositoryScratch = path.resolve(process.cwd(), ".scratch");
    const systemTemp = os.tmpdir();
    if (!isWithin(repositoryScratch, resolved) && !isWithin(systemTemp, resolved)) {
        throw new Error("REPORT_RUN_DIR_NOT_LOCAL_SENSITIVE");
    }
    return resolved;
}
exports.DEFAULT_RUN_STAGES = [
    "scope-freeze",
    "skill-read",
    "prompt-read",
    "source-inventory",
    "history-read",
    "price-resolution",
    "deterministic-analysis",
    "content-selection",
    "content-read",
    "skill-candidate-select",
    "skill-snapshot",
    "skill-insights",
    "report-synthesis",
    "key-session-analysis",
    "validation",
    "compose",
    "render",
    "font-subset",
    "html-write",
    "codex-open",
];
const REPORT_LANE_PHASES = new Set([
    "report-synthesis",
    "key-session-analysis",
    "skill-insights",
]);
const artifactFiles = {
    audit: "audit.json",
    evidence: "evidence.json",
    firstUserMessages: "first-user-messages.json",
    skillSnapshot: "skill-snapshot.json",
    skillInsights: "skill-insights.json",
    reportSynthesis: "report-synthesis.json",
    keySessionAnalyses: "key-session-analyses.json",
    composition: "composition.json",
    html: "report.html",
    trace: "trace.jsonl",
};
const forbiddenMetadataKey = /prompt|response|content|command|credential|secret|password|authorization|path/i;
const RUN_LOCK_TIMEOUT_MS = 5_000;
const RUN_LOCK_POLL_MS = 10;
function runLockPath(runDir) {
    return path.join(runDir, ".run.lock");
}
function lockError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}
async function sleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}
async function withRunLock(runDir, operation) {
    const lockFile = runLockPath(runDir);
    const owner = JSON.stringify({ pid: process.pid, token: (0, node_crypto_1.randomUUID)(), acquiredAt: nowIso() }) + "\n";
    const deadline = Date.now() + RUN_LOCK_TIMEOUT_MS;
    let handle = null;
    while (handle === null) {
        try {
            handle = await (0, promises_1.open)(lockFile, "wx");
            await handle.writeFile(owner, "utf8");
        }
        catch (error) {
            await handle?.close().catch(() => undefined);
            handle = null;
            if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST"))
                throw error;
            if (Date.now() >= deadline)
                throw lockError("RUN_LOCK_TIMEOUT", `Report Run lock wait timed out after ${RUN_LOCK_TIMEOUT_MS}ms; the lock was not removed.`);
            await sleep(RUN_LOCK_POLL_MS);
        }
    }
    try {
        return await operation();
    }
    finally {
        await handle.close().catch(() => undefined);
        try {
            const current = await (0, promises_1.readFile)(lockFile, "utf8");
            if (current === owner)
                await (0, promises_1.unlink)(lockFile);
        }
        catch {
            // An uncertain owner is never removed by a competing process.
        }
    }
}
function nowIso() {
    return new Date().toISOString();
}
function errorCode(error) {
    const candidate = error && typeof error === "object" && "code" in error ? error.code : null;
    return typeof candidate === "string" && /^[A-Z][A-Z0-9_]{0,31}$/.test(candidate) ? candidate : "operation_failed";
}
function safeSpanLabel(value, fallback) {
    return /^[A-Za-z0-9_.:-]{1,128}$/.test(value) ? value : fallback;
}
function safeMetadata(metadata) {
    if (!metadata)
        return undefined;
    const result = {};
    for (const [key, value] of Object.entries(metadata)) {
        if (forbiddenMetadataKey.test(key))
            continue;
        if (typeof value === "string")
            result[key] = value.slice(0, 160);
        else if (typeof value === "number" || typeof value === "boolean" || value === null)
            result[key] = value;
    }
    return Object.keys(result).length > 0 ? result : undefined;
}
function hashBytes(value) {
    return (0, node_crypto_1.createHash)("sha256").update(value).digest("hex");
}
async function hashFile(filePath) {
    try {
        return hashBytes(await (0, promises_1.readFile)(filePath));
    }
    catch {
        return null;
    }
}
async function writeAtomic(filePath, contents) {
    const temporary = filePath + ".tmp-" + process.pid + "-" + (0, node_crypto_1.randomUUID)();
    await (0, promises_1.writeFile)(temporary, contents, "utf8");
    try {
        await (0, promises_1.rename)(temporary, filePath);
    }
    catch (error) {
        await (0, promises_1.unlink)(temporary).catch(() => undefined);
        const atomicError = new Error(`Atomic replacement failed for ${path.basename(filePath)}.`);
        atomicError.code = "RUN_ATOMIC_REPLACE_FAILED";
        atomicError.cause = error;
        throw atomicError;
    }
}
async function appendTraceLocked(run, manifest, event) {
    try {
        await (0, promises_1.appendFile)(run.traceFile, JSON.stringify(event) + "\n", "utf8");
    }
    catch (error) {
        manifest.traceCompleteness = "incomplete";
        manifest.traceErrorCode = manifest.traceErrorCode ?? errorCode(error);
        if (!manifest.warnings.includes("Timing Trace could not be persisted completely.")) {
            manifest.warnings.push("Timing Trace could not be persisted completely.");
        }
    }
}
async function mutateRun(run, mutation, traceEvents = []) {
    return withRunLock(run.runDir, async () => {
        const manifest = await readRunManifest(run.runDir);
        const result = await mutation(manifest);
        const events = typeof traceEvents === "function" ? traceEvents(manifest) : traceEvents;
        for (const event of events)
            await appendTraceLocked(run, manifest, event);
        manifest.updatedAt = nowIso();
        await writeAtomic(run.manifestFile, JSON.stringify(manifest, null, 2) + "\n");
        run.manifest = manifest;
        return result;
    });
}
function initialManifest(scope, runId) {
    const createdAt = nowIso();
    return {
        version: 1,
        runId,
        status: "started",
        createdAt,
        updatedAt: createdAt,
        scope: {
            harness: scope.harness,
            cwd: scope.allProjects ? null : scope.cwd,
            allProjects: scope.allProjects,
            since: scope.since.toISOString(),
            until: scope.until.toISOString(),
            locale: scope.locale,
        },
        bundleVersion: scope.bundleVersion ?? null,
        auditFingerprint: null,
        topSessions: [],
        artifacts: {},
        stageStatus: {},
        eligibleStages: [...exports.DEFAULT_RUN_STAGES],
        traceCompleteness: "complete",
        traceErrorCode: null,
        totalDurationMs: null,
        promptHashes: { reportSynthesis: null, keySessionAnalysis: null, skillInsights: null },
        runtimeHash: null,
        warnings: [],
        laneStatus: {
            "report-synthesis": { status: "pending", attempts: 0, totalDurationMs: null, lastDurationMs: null, reasonCode: null, inputArtifact: null, acceptedArtifact: null, spanStartedAt: null },
            "key-session-analysis": { status: "pending", attempts: 0, totalDurationMs: null, lastDurationMs: null, reasonCode: null, inputArtifact: null, acceptedArtifact: null, spanStartedAt: null },
            "skill-insights": { status: "pending", attempts: 0, totalDurationMs: null, lastDurationMs: null, reasonCode: null, inputArtifact: null, acceptedArtifact: null, spanStartedAt: null },
        },
        deliveryStatus: "started",
        degraded: false,
        uiDispatch: "unavailable",
        laneArtifacts: {},
        retention: { workspace: "local-sensitive", policy: "explicit-cleanup", cleanedAt: null },
    };
}
async function createReportRun(scope, requestedDirectory) {
    const runDir = requestedDirectory
        ? assertLocalSensitiveRunDirectory(requestedDirectory)
        : await (async () => {
            const root = path.join(os.tmpdir(), "where-tokens-went-runs");
            const directory = path.join(root, (0, node_crypto_1.randomUUID)());
            await (0, promises_1.mkdir)(directory, { recursive: true });
            return directory;
        })();
    await (0, promises_1.mkdir)(runDir, { recursive: true });
    const manifestFile = path.join(runDir, "manifest.json");
    const traceFile = path.join(runDir, "trace.jsonl");
    try {
        await (0, promises_1.stat)(manifestFile);
        throw new Error("Report Run directory already contains a manifest.");
    }
    catch (error) {
        if (error instanceof Error && error.message === "Report Run directory already contains a manifest.")
            throw error;
        if (error && typeof error === "object" && "code" in error && error.code !== "ENOENT")
            throw error;
    }
    await (0, promises_1.writeFile)(traceFile, "", { encoding: "utf8", flag: "wx" }).catch((error) => {
        if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
            throw new Error("Report Run directory already contains a trace.");
        }
        throw error;
    });
    const bundleVersion = scope.bundleVersion ?? (await (0, bundle_version_1.readCurrentBundleVersion)())?.bundleVersion ?? null;
    const manifest = initialManifest({ ...scope, bundleVersion: bundleVersion ?? undefined }, (0, node_crypto_1.randomUUID)());
    const run = {
        runId: manifest.runId,
        runDir,
        manifestFile,
        traceFile,
        manifest,
        startedMono: node_perf_hooks_1.performance.now(),
        startedWall: Date.now(),
    };
    await writeAtomic(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
    await (0, promises_1.appendFile)(traceFile, JSON.stringify({
        event: "run-start",
        runId: run.manifest.runId,
        startedAt: run.manifest.createdAt,
        source: "runner",
    }) + "\n", "utf8");
    return run;
}
async function openReportRun(runDir) {
    const resolved = assertLocalSensitiveRunDirectory(runDir);
    const manifestFile = path.join(resolved, "manifest.json");
    const traceFile = path.join(resolved, "trace.jsonl");
    const manifest = await readRunManifest(resolved);
    try {
        await (0, promises_1.stat)(traceFile);
    }
    catch {
        throw new Error("Report Run timing trace is unavailable.");
    }
    const startedWall = Date.parse(manifest.createdAt);
    if (Number.isNaN(startedWall))
        throw new Error("Report Run manifest has an invalid creation time.");
    return {
        runId: manifest.runId,
        runDir: resolved,
        manifestFile,
        traceFile,
        manifest,
        startedMono: node_perf_hooks_1.performance.now(),
        startedWall,
    };
}
async function setReportRunStatus(run, status) {
    await mutateRun(run, (manifest) => {
        manifest.status = status;
        manifest.deliveryStatus = status;
    });
}
async function setRunEligibleStages(run, stages) {
    await mutateRun(run, (manifest) => {
        manifest.eligibleStages = [...new Set(stages)];
    });
}
async function setRunPromptHashes(run, promptHashes, runtimeHash) {
    await mutateRun(run, (manifest) => {
        manifest.promptHashes = promptHashes;
        manifest.runtimeHash = runtimeHash;
    });
}
async function setRunSourceInventory(run, before, after) {
    await mutateRun(run, (manifest) => {
        const mutated = before !== null && after !== null
            ? before.fileCount !== after.fileCount || before.totalBytes !== after.totalBytes || before.signature !== after.signature
            : null;
        manifest.sourceInventory = { before, after, mutated };
        if (mutated === true) {
            manifest.traceCompleteness = "incomplete";
            manifest.warnings = [...new Set([...manifest.warnings, "History source files changed while the Audit was being read."])];
        }
    });
}
async function setRunAuditFingerprint(run, fingerprint) {
    await mutateRun(run, (manifest) => {
        manifest.auditFingerprint = fingerprint;
    });
}
async function setRunTopSessions(run, sessions, sessionRecords) {
    await mutateRun(run, (manifest) => {
        const sourceRoot = run.manifest.scope.harness === "codex"
            ? path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sessions")
            : path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");
        const filesBySession = new Map((sessionRecords ?? []).map((record) => [record.sessionId, record.filePath ?? null]));
        manifest.topSessions = sessions.slice(0, 3).map((session, index) => ({
            sessionId: session.key,
            rank: index + 1,
            tokens: typeof session.value.value === "number" ? session.value.value : null,
            // Keep only a Harness-root-relative identity. Content Evidence resolves
            // it against the frozen Harness root without exposing home directories.
            filePath: (() => {
                const file = filesBySession.get(session.key);
                if (!file)
                    return null;
                const relative = path.relative(sourceRoot, file).replaceAll("\\", "/");
                return relative && !relative.startsWith("../") && relative !== ".." && !path.isAbsolute(relative) ? relative : null;
            })(),
        }));
    });
}
function stageAttempt(run, phase, explicitAttempt) {
    return explicitAttempt ?? ((run.manifest.stageStatus[phase]?.attempt ?? 0) + 1);
}
async function finishSpan(run, span, status, failure) {
    const endedAt = nowIso();
    const durationMs = Math.max(0, node_perf_hooks_1.performance.now() - span.startedMono);
    const duration = Math.round(durationMs * 100) / 100;
    await mutateRun(run, (manifest) => {
        manifest.stageStatus[span.phase] = {
            status,
            attempt: span.attempt,
            spanId: span.spanId,
            durationMs: duration,
            ...(failure ? { errorCode: errorCode(failure) } : {}),
        };
    }, [{
            event: "end",
            runId: run.manifest.runId,
            spanId: span.spanId,
            parentSpanId: span.parentSpanId,
            phase: span.phase,
            operation: span.operation,
            source: span.source,
            attempt: span.attempt,
            startedAt: span.startedAt,
            endedAt,
            durationMs: duration,
            status,
            ...(failure ? { errorCode: errorCode(failure) } : {}),
        }]);
}
async function withRunSpan(run, options, operation) {
    const span = {
        spanId: (0, node_crypto_1.randomUUID)(),
        phase: options.phase,
        operation: options.operation,
        source: options.source,
        attempt: options.attempt ?? 0,
        parentSpanId: options.parentSpanId ?? null,
        startedAt: nowIso(),
        startedMono: node_perf_hooks_1.performance.now(),
    };
    const metadata = safeMetadata(options.metadata);
    let committedAttempt = options.attempt ?? 0;
    span.attempt = await mutateRun(run, (manifest) => {
        committedAttempt = options.attempt ?? ((manifest.stageStatus[span.phase]?.attempt ?? 0) + 1);
        manifest.eligibleStages = [...new Set([...manifest.eligibleStages, span.phase])];
        manifest.stageStatus[span.phase] = {
            status: "started",
            attempt: committedAttempt,
            spanId: span.spanId,
            durationMs: null,
        };
        return committedAttempt;
    }, (manifest) => [{
            event: "start",
            runId: manifest.runId,
            spanId: span.spanId,
            parentSpanId: span.parentSpanId,
            phase: span.phase,
            operation: span.operation,
            source: span.source,
            attempt: committedAttempt,
            startedAt: span.startedAt,
            ...(metadata ? { metadata } : {}),
        }]);
    try {
        const result = await operation();
        await finishSpan(run, span, "completed");
        return result;
    }
    catch (error) {
        await finishSpan(run, span, "failed", error);
        throw error;
    }
}
async function finishRunSpan(run, span, status, failure) {
    await finishSpan(run, { ...span, parentSpanId: span.parentSpanId ?? null }, status, failure);
}
async function finalizeReportRun(run, status) {
    await withRunLock(run.runDir, async () => {
        const manifest = await readRunManifest(run.runDir);
        manifest.totalDurationMs = Math.max(0, Math.round((Date.now() - run.startedWall) * 100) / 100);
        const incompleteStage = manifest.eligibleStages.some((phase) => {
            const current = manifest.stageStatus[phase];
            return !current || current.status === "started" || current.status === "interrupted";
        });
        const failedStage = manifest.eligibleStages.some((phase) => {
            const current = manifest.stageStatus[phase];
            return current?.status === "failed" && phase !== "price-request" && !REPORT_LANE_PHASES.has(phase);
        });
        const hasLaneWork = Object.values(manifest.laneStatus).some((lane) => lane.status !== "pending" || lane.attempts > 0 || lane.inputArtifact !== null);
        const eligibleLanes = Object.keys(manifest.laneStatus).filter((lane) => manifest.eligibleStages.includes(lane));
        const lanesTerminal = eligibleLanes.every((lane) => {
            const current = manifest.laneStatus[lane];
            return current.status === "accepted" || current.status === "fallback" || current.status === "unavailable";
        });
        let htmlIntegrity = false;
        const html = manifest.artifacts.html;
        if (html) {
            try {
                const contents = await (0, promises_1.readFile)(path.join(run.runDir, html.file));
                htmlIntegrity = contents.byteLength === html.bytes && hashBytes(contents) === html.sha256;
            }
            catch {
                htmlIntegrity = false;
            }
        }
        const uiReady = manifest.uiDispatch === "completed" || manifest.uiDispatch === "queued";
        const traceReady = manifest.traceCompleteness === "complete" && !manifest.traceErrorCode;
        manifest.status = status === "completed"
            ? failedStage
                ? "failed"
                : incompleteStage || !lanesTerminal || !htmlIntegrity || !uiReady || !traceReady
                    ? "incomplete"
                    : "completed"
            : status;
        manifest.deliveryStatus = manifest.status;
        if (!htmlIntegrity)
            manifest.warnings = [...new Set([...manifest.warnings, "Final HTML artifact integrity verification failed."])];
        if (!uiReady)
            manifest.warnings = [...new Set([...manifest.warnings, "Final HTML UI dispatch was not observed as completed or queued."])];
        if (!lanesTerminal)
            manifest.warnings = [...new Set([...manifest.warnings, "One or more eligible AI lanes were not accepted or explicitly degraded."])];
        if (incompleteStage || manifest.traceErrorCode)
            manifest.traceCompleteness = "incomplete";
        await appendTraceLocked(run, manifest, {
            event: "run-end",
            runId: manifest.runId,
            endedAt: nowIso(),
            durationMs: manifest.totalDurationMs,
            status: manifest.status,
        });
        try {
            const traceContents = await (0, promises_1.readFile)(run.traceFile);
            manifest.artifacts.trace = {
                file: "trace.jsonl",
                bytes: traceContents.byteLength,
                sha256: hashBytes(traceContents),
            };
        }
        catch (error) {
            manifest.traceCompleteness = "incomplete";
            manifest.traceErrorCode = manifest.traceErrorCode ?? errorCode(error);
            manifest.warnings = [...new Set([...manifest.warnings, "Timing Trace could not be finalized."])];
        }
        if (status === "completed" && (manifest.traceCompleteness !== "complete" || manifest.traceErrorCode !== null)) {
            manifest.status = "incomplete";
            manifest.deliveryStatus = "incomplete";
        }
        manifest.updatedAt = nowIso();
        await writeAtomic(run.manifestFile, JSON.stringify(manifest, null, 2) + "\n");
        run.manifest = manifest;
    });
}
async function writeRunArtifact(run, name, value) {
    const file = artifactFiles[name];
    const filePath = path.join(run.runDir, file);
    const serialized = JSON.stringify(value);
    if (serialized === undefined)
        throw new Error("Report Run artifact is not JSON serializable.");
    const bytes = Buffer.byteLength(serialized + "\n", "utf8");
    const ref = { file, bytes, sha256: hashBytes(Buffer.from(serialized + "\n", "utf8")) };
    return mutateRun(run, async (manifest) => {
        const previous = manifest.artifacts[name];
        if (previous && (previous.bytes !== ref.bytes || previous.sha256 !== ref.sha256))
            throw lockError("RUN_ARTIFACT_IMMUTABLE", `Report Run artifact ${name} is already registered with different content.`);
        if (!previous)
            await writeAtomic(filePath, serialized + "\n");
        manifest.artifacts[name] = previous ?? ref;
        return previous ?? ref;
    });
}
async function writeRunTextArtifact(run, name, contents) {
    const file = artifactFiles[name];
    const filePath = path.join(run.runDir, file);
    const bytes = Buffer.byteLength(contents, "utf8");
    const ref = { file, bytes, sha256: hashBytes(Buffer.from(contents, "utf8")) };
    return mutateRun(run, async (manifest) => {
        const previous = manifest.artifacts[name];
        if (previous && (previous.bytes !== ref.bytes || previous.sha256 !== ref.sha256))
            throw lockError("RUN_ARTIFACT_IMMUTABLE", `Report Run artifact ${name} is already registered with different content.`);
        if (!previous)
            await writeAtomic(filePath, contents);
        manifest.artifacts[name] = previous ?? ref;
        return previous ?? ref;
    });
}
function laneArtifactKey(lane, file) {
    return `${lane}/${path.basename(file)}`;
}
function laneArtifactFile(lane, kind, attempt) {
    if (kind === "input")
        return `lanes/${lane}/input.json`;
    if (kind === "prompt")
        return `lanes/${lane}/prompt.json`;
    if (kind === "accepted")
        return `lanes/${lane}/accepted.json`;
    if (kind === "fallback")
        return `lanes/${lane}/fallback.json`;
    if (!attempt || !Number.isInteger(attempt) || attempt < 1)
        throw new Error("Lane artifact attempts must be positive integers.");
    return `lanes/${lane}/attempt-${attempt}.${kind}.json`;
}
async function writeRunLaneArtifact(run, lane, kind, value, attempt) {
    const serialized = JSON.stringify(value);
    if (serialized === undefined)
        throw new Error("Lane artifact is not JSON serializable.");
    const file = laneArtifactFile(lane, kind, attempt);
    const filePath = path.join(run.runDir, file);
    const contents = serialized + "\n";
    const ref = { file, bytes: Buffer.byteLength(contents, "utf8"), sha256: hashBytes(Buffer.from(contents, "utf8")) };
    return mutateRun(run, async (manifest) => {
        const key = laneArtifactKey(lane, file);
        const previous = manifest.laneArtifacts[key];
        if (previous && (previous.bytes !== ref.bytes || previous.sha256 !== ref.sha256))
            throw lockError("RUN_ARTIFACT_IMMUTABLE", `Lane artifact ${key} is already registered with different content.`);
        if (!previous) {
            await (0, promises_1.mkdir)(path.dirname(filePath), { recursive: true });
            await writeAtomic(filePath, contents);
        }
        manifest.laneArtifacts[key] = previous ?? ref;
        return previous ?? ref;
    });
}
async function writeRunLaneRawArtifact(run, lane, rawText, attempt) {
    const file = laneArtifactFile(lane, "raw", attempt);
    const filePath = path.join(run.runDir, file);
    const ref = { file, bytes: Buffer.byteLength(rawText, "utf8"), sha256: hashBytes(Buffer.from(rawText, "utf8")) };
    return mutateRun(run, async (manifest) => {
        const key = laneArtifactKey(lane, file);
        const previous = manifest.laneArtifacts[key];
        if (previous && (previous.bytes !== ref.bytes || previous.sha256 !== ref.sha256))
            throw lockError("RUN_ARTIFACT_IMMUTABLE", `Lane artifact ${key} is already registered with different content.`);
        if (!previous) {
            await (0, promises_1.mkdir)(path.dirname(filePath), { recursive: true });
            await writeAtomic(filePath, rawText);
        }
        manifest.laneArtifacts[key] = previous ?? ref;
        return previous ?? ref;
    });
}
async function readRunLaneArtifact(runDir, lane, kind, attempt) {
    const resolved = path.resolve(runDir);
    const manifest = await readRunManifest(resolved);
    const file = laneArtifactFile(lane, kind, attempt);
    const ref = manifest.laneArtifacts[laneArtifactKey(lane, file)];
    if (!ref)
        throw new Error(`Report Run lane artifact is unavailable: ${lane}/${kind}${attempt ? `/${attempt}` : ""}`);
    const contents = await (0, promises_1.readFile)(path.join(resolved, file));
    if (contents.byteLength !== ref.bytes || hashBytes(contents) !== ref.sha256)
        throw new Error(`Report Run lane artifact integrity check failed: ${lane}/${kind}${attempt ? `/${attempt}` : ""}`);
    return JSON.parse(contents.toString("utf8"));
}
async function startReportLane(run, lane, inputArtifact) {
    const spanId = (0, node_crypto_1.randomUUID)();
    const startedAt = nowIso();
    let attempt = 0;
    await mutateRun(run, (manifest) => {
        const current = manifest.laneStatus[lane];
        if (current.status === "running")
            throw lockError("RUN_LANE_ALREADY_RUNNING", `Lane ${lane} already has a running attempt.`);
        if (current.status === "accepted" || current.status === "fallback" || current.status === "unavailable")
            throw lockError("RUN_LANE_TERMINAL", `Lane ${lane} already has terminal status ${current.status}.`);
        attempt = current.attempts + 1;
        manifest.laneStatus[lane] = { ...current, status: "running", attempts: attempt, inputArtifact, reasonCode: null, spanStartedAt: startedAt };
        manifest.eligibleStages = [...new Set([...manifest.eligibleStages, lane])];
        manifest.stageStatus[lane] = { status: "started", attempt, spanId, durationMs: null };
    }, (manifest) => [{
            event: "start",
            runId: manifest.runId,
            spanId,
            phase: lane,
            operation: "ai-start",
            source: "runner",
            attempt,
            startedAt,
        }]);
    return { attempt, spanId, startedAt };
}
async function finishReportLane(run, lane, attempt, spanId, startedAt, status, durationMs, reasonCode, acceptedArtifact, source = "runner", metadata) {
    await mutateRun(run, (manifest) => {
        const current = manifest.laneStatus[lane];
        manifest.laneStatus[lane] = {
            ...current,
            status,
            totalDurationMs: (current.totalDurationMs ?? 0) + (durationMs ?? 0),
            lastDurationMs: durationMs,
            reasonCode,
            acceptedArtifact,
            spanStartedAt: current.spanStartedAt,
        };
        manifest.stageStatus[lane] = { status: status === "accepted" ? "completed" : status === "failed" ? "failed" : status, attempt, spanId, durationMs: durationMs ?? null, ...(reasonCode ? { errorCode: reasonCode } : {}) };
        manifest.degraded = Object.values(manifest.laneStatus).some((entry) => entry.status === "fallback" || entry.status === "failed" || entry.status === "unavailable");
    }, (manifest) => [{
            event: "end",
            runId: manifest.runId,
            spanId,
            phase: lane,
            operation: "ai-accept",
            source,
            attempt,
            startedAt,
            endedAt: nowIso(),
            durationMs,
            status: status === "accepted" ? "completed" : status,
            ...(reasonCode ? { errorCode: reasonCode } : {}),
            ...(metadata ? { metadata } : {}),
        }]);
}
async function setRunUiDispatch(run, status) {
    await mutateRun(run, (manifest) => {
        manifest.uiDispatch = status;
        if (status === "failed")
            manifest.deliveryStatus = "failed";
    });
}
async function appendRunWarnings(run, warnings) {
    // Do not call openReportRun for the string form: it reads manifest.json
    // before acquiring the Run lock, so a concurrent Windows fallback write can
    // expose a partial JSON document to the reader. mutateRun reloads the
    // manifest while holding the lock, which is the only read path this
    // mutation needs.
    const resolved = typeof run === "string"
        ? {
            runId: "unresolved",
            runDir: path.resolve(run),
            manifestFile: path.join(path.resolve(run), "manifest.json"),
            traceFile: path.join(path.resolve(run), "trace.jsonl"),
            manifest: {},
            startedMono: node_perf_hooks_1.performance.now(),
            startedWall: Date.now(),
        }
        : run;
    const additions = warnings.filter((warning) => typeof warning === "string" && warning.length > 0);
    return mutateRun(resolved, (manifest) => {
        if (additions.length > 0)
            manifest.warnings = [...new Set([...manifest.warnings, ...additions])];
        return manifest;
    });
}
const SENSITIVE_RUN_ARTIFACTS = [
    "evidence",
    "firstUserMessages",
    "skillSnapshot",
    "skillInsights",
    "reportSynthesis",
    "keySessionAnalyses",
    "composition",
];
async function cleanupSensitiveRunArtifacts(run) {
    return withRunLock(run.runDir, async () => {
        const manifest = await readRunManifest(run.runDir);
        for (const name of SENSITIVE_RUN_ARTIFACTS) {
            const file = manifest.artifacts[name]?.file ?? artifactFiles[name];
            await (0, promises_1.rm)(path.join(run.runDir, file), { force: true }).catch(() => undefined);
            delete manifest.artifacts[name];
        }
        await (0, promises_1.rm)(path.join(run.runDir, "lanes"), { recursive: true, force: true }).catch(() => undefined);
        manifest.laneArtifacts = {};
        manifest.retention = { workspace: "local-sensitive", policy: "explicit-cleanup", cleanedAt: nowIso() };
        manifest.updatedAt = nowIso();
        await writeAtomic(run.manifestFile, JSON.stringify(manifest, null, 2) + "\n");
        run.manifest = manifest;
        return manifest;
    });
}
async function registerRunArtifact(run, name, filePath) {
    const contents = await (0, promises_1.readFile)(filePath);
    const relative = path.relative(run.runDir, path.resolve(filePath));
    const ref = {
        file: relative && !relative.startsWith("..") ? relative : "external:" + path.basename(filePath),
        bytes: contents.byteLength,
        sha256: hashBytes(contents),
    };
    return mutateRun(run, (manifest) => {
        const previous = manifest.artifacts[name];
        if (previous && (previous.bytes !== ref.bytes || previous.sha256 !== ref.sha256))
            throw lockError("RUN_ARTIFACT_IMMUTABLE", `Report Run artifact ${name} is already registered with different content.`);
        manifest.artifacts[name] = previous ?? ref;
        return previous ?? ref;
    });
}
async function readRunManifest(runDir) {
    const value = JSON.parse(await (0, promises_1.readFile)(path.join(path.resolve(runDir), "manifest.json"), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Report Run manifest is malformed.");
    const manifest = value;
    manifest.laneStatus ??= {
        "report-synthesis": { status: "pending", attempts: 0, totalDurationMs: null, lastDurationMs: null, reasonCode: null, inputArtifact: null, acceptedArtifact: null, spanStartedAt: null },
        "key-session-analysis": { status: "pending", attempts: 0, totalDurationMs: null, lastDurationMs: null, reasonCode: null, inputArtifact: null, acceptedArtifact: null, spanStartedAt: null },
        "skill-insights": { status: "pending", attempts: 0, totalDurationMs: null, lastDurationMs: null, reasonCode: null, inputArtifact: null, acceptedArtifact: null, spanStartedAt: null },
    };
    for (const lane of ["report-synthesis", "key-session-analysis", "skill-insights"])
        manifest.laneStatus[lane].spanStartedAt ??= null;
    manifest.deliveryStatus ??= manifest.status;
    manifest.degraded ??= false;
    manifest.uiDispatch ??= "unavailable";
    manifest.laneArtifacts ??= {};
    manifest.retention ??= { workspace: "local-sensitive", policy: "explicit-cleanup", cleanedAt: null };
    return manifest;
}
async function readRunArtifact(runDir, name) {
    const manifest = await readRunManifest(runDir);
    const ref = manifest.artifacts[name];
    if (!ref)
        throw new Error("Report Run artifact is unavailable: " + name);
    const filePath = path.join(path.resolve(runDir), artifactFiles[name]);
    const contents = await (0, promises_1.readFile)(filePath);
    if (contents.byteLength !== ref.bytes || hashBytes(contents) !== ref.sha256)
        throw new Error("Report Run artifact integrity check failed: " + name);
    return name === "trace" ? contents.toString("utf8") : JSON.parse(contents.toString("utf8"));
}
async function recordRunSpan(runDir, event) {
    const resolved = path.resolve(runDir);
    const phase = safeSpanLabel(event.phase, "unknown-phase");
    const operation = safeSpanLabel(event.operation, "unknown-operation");
    const spanId = safeSpanLabel(event.spanId, "unknown-span");
    const parentSpanId = event.parentSpanId ? safeSpanLabel(event.parentSpanId, "unknown-parent") : null;
    return withRunLock(resolved, async () => {
        const manifest = await readRunManifest(resolved);
        const current = manifest.stageStatus[phase];
        manifest.eligibleStages = [...new Set([...manifest.eligibleStages, phase])];
        const attempt = event.attempt ?? (event.event === "end" && current?.spanId === spanId ? current.attempt : (current?.attempt ?? 0) + 1);
        let persistedSpanState = "missing";
        if (event.event === "end") {
            try {
                const trace = await (0, promises_1.readFile)(path.join(resolved, "trace.jsonl"), "utf8");
                for (const line of trace.split(/\r?\n/)) {
                    if (!line.trim())
                        continue;
                    try {
                        const traceEvent = JSON.parse(line);
                        if (traceEvent.spanId === spanId)
                            persistedSpanState = traceEvent.event === "start" ? "started" : "ended";
                    }
                    catch {
                        // Ignore malformed historical lines; trace persistence remains authoritative below.
                    }
                }
            }
            catch {
                persistedSpanState = "missing";
            }
        }
        const missingStart = event.event === "end" && persistedSpanState !== "started";
        if (missingStart) {
            manifest.traceCompleteness = "incomplete";
            manifest.warnings = [...new Set([...manifest.warnings, "A timing span ended without a persisted start event."])];
        }
        if (event.event === "start") {
            manifest.stageStatus[phase] = { status: "started", attempt, spanId, durationMs: null };
        }
        else {
            const durationMs = typeof event.durationMs === "number"
                ? Math.max(0, event.durationMs)
                : event.endedAt
                    ? Math.max(0, Date.parse(event.endedAt) - Date.parse(event.startedAt))
                    : null;
            manifest.stageStatus[phase] = {
                status: event.status ?? "unavailable",
                attempt,
                spanId,
                durationMs,
                ...(event.errorCode ? { errorCode: errorCode({ code: event.errorCode }) } : {}),
            };
            if (phase === "codex-open")
                manifest.uiDispatch = event.status === "completed" || event.status === "queued" ? event.status : event.status === "failed" ? "failed" : "unavailable";
        }
        const { metadata: _metadata, errorCode: _errorCode, ...eventWithoutUnsafeFields } = event;
        const line = {
            ...eventWithoutUnsafeFields,
            spanId,
            phase,
            operation,
            parentSpanId,
            runId: manifest.runId,
            attempt,
            ...(event.errorCode ? { errorCode: errorCode({ code: event.errorCode }) } : {}),
            ...(event.metadata && safeMetadata(event.metadata) ? { metadata: safeMetadata(event.metadata) } : {}),
        };
        await appendTraceLocked({ runId: manifest.runId, runDir: resolved, manifestFile: path.join(resolved, "manifest.json"), traceFile: path.join(resolved, "trace.jsonl"), manifest, startedMono: 0, startedWall: Date.parse(manifest.createdAt) }, manifest, line);
        manifest.updatedAt = nowIso();
        await writeAtomic(path.join(resolved, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
        return manifest;
    });
}
async function recordRunSpanInProcess(run, event) {
    const manifest = await recordRunSpan(run.runDir, event);
    run.manifest = manifest;
}
async function recordCompletedRunSpan(run, event) {
    const spanId = (0, node_crypto_1.randomUUID)();
    const attempt = event.attempt ?? ((run.manifest.stageStatus[event.phase]?.attempt ?? 0) + 1);
    await recordRunSpanInProcess(run, { ...event, event: "start", spanId, attempt });
    await recordRunSpanInProcess(run, { ...event, event: "end", spanId, attempt, status: event.status ?? "completed" });
}
async function historyFiles(root, harness) {
    const result = [];
    async function visit(current) {
        let entries;
        try {
            entries = await (0, promises_1.readdir)(current, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory())
                await visit(full);
            else if (entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl") && (harness === "claude" || entry.name.startsWith("rollout-")))
                result.push(full);
        }
    }
    await visit(root);
    return result.sort();
}
async function captureSourceInventory(harness, scopedFiles) {
    const root = harness === "codex"
        ? path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sessions")
        : path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");
    const files = scopedFiles ? [...new Set(scopedFiles)] : await historyFiles(root, harness);
    const entries = [];
    let totalBytes = 0;
    for (const file of files) {
        try {
            const info = await (0, promises_1.stat)(file);
            totalBytes += info.size;
            const relative = path.relative(root, file).replaceAll("\\", "/").toLowerCase();
            entries.push(relative + "|" + info.size + "|" + info.mtimeMs);
        }
        catch {
            entries.push("unstatable|" + path.basename(file));
        }
    }
    return {
        fileCount: files.length,
        totalBytes,
        signature: hashBytes(Buffer.from(entries.join("\n"), "utf8")),
    };
}
async function resolveRunContractMetadata() {
    const referenceRoots = [
        path.resolve(__dirname, "../../prompts"),
        path.resolve(__dirname, "../../references"),
        path.resolve(__dirname, "../references"),
    ];
    async function findPrompt(name) {
        for (const root of referenceRoots) {
            const candidate = path.join(root, name);
            const hash = await hashFile(candidate);
            if (hash)
                return hash;
        }
        return null;
    }
    let runtimeFiles;
    try {
        runtimeFiles = (await (0, promises_1.readdir)(__dirname, { withFileTypes: true }))
            .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
            .map((entry) => path.join(__dirname, entry.name))
            .sort();
    }
    catch {
        return { promptHashes: { reportSynthesis: null, keySessionAnalysis: null, skillInsights: null }, runtimeHash: null, bundleVersion: await (0, bundle_version_1.readCurrentBundleVersion)() };
    }
    const runtimeHashes = [];
    for (const file of runtimeFiles) {
        const hash = await hashFile(file);
        if (!hash)
            return { promptHashes: { reportSynthesis: null, keySessionAnalysis: null, skillInsights: null }, runtimeHash: null, bundleVersion: await (0, bundle_version_1.readCurrentBundleVersion)() };
        runtimeHashes.push(hash);
    }
    return {
        promptHashes: {
            reportSynthesis: await findPrompt("report-synthesis.md"),
            keySessionAnalysis: await findPrompt("key-session-analysis.md"),
            skillInsights: await findPrompt("skill-insights.md"),
        },
        runtimeHash: hashBytes(Buffer.from(runtimeHashes.join("|"), "utf8")),
        bundleVersion: await (0, bundle_version_1.readCurrentBundleVersion)(),
    };
}
function assertRunBundleVersion(run, current) {
    if (!run.manifest.bundleVersion)
        return;
    if (run.manifest.bundleVersion !== current) {
        throw new Error(`Report Run bundle version changed during execution; the Run cannot continue. ${"Run npm run install-local."}`);
    }
}
