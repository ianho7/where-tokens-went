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
exports.registerRunArtifact = registerRunArtifact;
exports.readRunManifest = readRunManifest;
exports.readRunArtifact = readRunArtifact;
exports.recordRunSpan = recordRunSpan;
exports.recordRunSpanInProcess = recordRunSpanInProcess;
exports.recordCompletedRunSpan = recordCompletedRunSpan;
exports.captureSourceInventory = captureSourceInventory;
exports.resolveRunContractMetadata = resolveRunContractMetadata;
const promises_1 = require("node:fs/promises");
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
const node_perf_hooks_1 = require("node:perf_hooks");
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
    "report-synthesis",
    "key-session-analysis",
    "validation",
    "compose",
    "render",
    "font-subset",
    "html-write",
    "codex-open",
];
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
    catch {
        await (0, promises_1.writeFile)(filePath, contents, "utf8");
        await (0, promises_1.unlink)(temporary).catch(() => undefined);
    }
}
async function persistManifest(run) {
    run.manifest.updatedAt = nowIso();
    await writeAtomic(run.manifestFile, JSON.stringify(run.manifest, null, 2) + "\n");
}
async function persistManifestBestEffort(run) {
    try {
        await persistManifest(run);
    }
    catch {
        // The trace error is already retained in memory; the core operation must not recurse.
    }
}
async function appendTrace(run, event) {
    try {
        await (0, promises_1.appendFile)(run.traceFile, JSON.stringify(event) + "\n", "utf8");
    }
    catch (error) {
        run.manifest.traceCompleteness = "incomplete";
        run.manifest.traceErrorCode = run.manifest.traceErrorCode ?? errorCode(error);
        if (!run.manifest.warnings.includes("Timing Trace could not be persisted completely.")) {
            run.manifest.warnings.push("Timing Trace could not be persisted completely.");
        }
        await persistManifestBestEffort(run);
    }
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
    };
}
async function createReportRun(scope, requestedDirectory) {
    const runDir = requestedDirectory
        ? path.resolve(requestedDirectory)
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
    const manifest = initialManifest(scope, (0, node_crypto_1.randomUUID)());
    const run = {
        runId: manifest.runId,
        runDir,
        manifestFile,
        traceFile,
        manifest,
        startedMono: node_perf_hooks_1.performance.now(),
        startedWall: Date.now(),
    };
    await persistManifest(run);
    await appendTrace(run, {
        event: "run-start",
        runId: run.manifest.runId,
        startedAt: run.manifest.createdAt,
        source: "runner",
    });
    return run;
}
async function openReportRun(runDir) {
    const resolved = path.resolve(runDir);
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
    run.manifest.status = status;
    await persistManifest(run);
}
async function setRunEligibleStages(run, stages) {
    run.manifest.eligibleStages = [...new Set(stages)];
    await persistManifest(run);
}
async function setRunPromptHashes(run, promptHashes, runtimeHash) {
    run.manifest.promptHashes = promptHashes;
    run.manifest.runtimeHash = runtimeHash;
    await persistManifest(run);
}
async function setRunSourceInventory(run, before, after) {
    const mutated = before !== null && after !== null
        ? before.fileCount !== after.fileCount || before.totalBytes !== after.totalBytes || before.signature !== after.signature
        : null;
    run.manifest.sourceInventory = { before, after, mutated };
    if (mutated === true) {
        run.manifest.traceCompleteness = "incomplete";
        run.manifest.warnings.push("History source files changed while the Audit was being read.");
    }
    await persistManifest(run);
}
async function setRunAuditFingerprint(run, fingerprint) {
    run.manifest.auditFingerprint = fingerprint;
    await persistManifest(run);
}
async function setRunTopSessions(run, sessions, sessionRecords) {
    const filePathById = new Map(sessionRecords?.map((s) => [s.sessionId, s.filePath]) ?? []);
    run.manifest.topSessions = sessions.slice(0, 3).map((session, index) => ({
        sessionId: session.key,
        rank: index + 1,
        tokens: typeof session.value.value === "number" ? session.value.value : null,
        filePath: filePathById.get(session.key) ?? null,
    }));
    await persistManifest(run);
}
function stageAttempt(run, phase, explicitAttempt) {
    return explicitAttempt ?? ((run.manifest.stageStatus[phase]?.attempt ?? 0) + 1);
}
async function finishSpan(run, span, status, failure) {
    const endedAt = nowIso();
    const durationMs = Math.max(0, node_perf_hooks_1.performance.now() - span.startedMono);
    const stage = {
        status,
        attempt: span.attempt,
        spanId: span.spanId,
        durationMs: Math.round(durationMs * 100) / 100,
        ...(failure ? { errorCode: errorCode(failure) } : {}),
    };
    run.manifest.stageStatus[span.phase] = stage;
    await appendTrace(run, {
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
        durationMs: stage.durationMs,
        status,
        ...(failure ? { errorCode: errorCode(failure) } : {}),
    });
    await persistManifest(run);
}
async function withRunSpan(run, options, operation) {
    const span = {
        spanId: (0, node_crypto_1.randomUUID)(),
        phase: options.phase,
        operation: options.operation,
        source: options.source,
        attempt: stageAttempt(run, options.phase, options.attempt),
        parentSpanId: options.parentSpanId ?? null,
        startedAt: nowIso(),
        startedMono: node_perf_hooks_1.performance.now(),
    };
    run.manifest.eligibleStages = [...new Set([...run.manifest.eligibleStages, span.phase])];
    run.manifest.stageStatus[span.phase] = {
        status: "started",
        attempt: span.attempt,
        spanId: span.spanId,
        durationMs: null,
    };
    const metadata = safeMetadata(options.metadata);
    await appendTrace(run, {
        event: "start",
        runId: run.manifest.runId,
        spanId: span.spanId,
        parentSpanId: span.parentSpanId,
        phase: span.phase,
        operation: span.operation,
        source: span.source,
        attempt: span.attempt,
        startedAt: span.startedAt,
        ...(metadata ? { metadata } : {}),
    });
    await persistManifest(run);
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
    run.manifest.totalDurationMs = Math.max(0, Math.round((Date.now() - run.startedWall) * 100) / 100);
    const incompleteStage = run.manifest.eligibleStages.some((phase) => {
        const current = run.manifest.stageStatus[phase];
        return !current || current.status === "started" || current.status === "interrupted";
    });
    const failedStage = run.manifest.eligibleStages.some((phase) => {
        const current = run.manifest.stageStatus[phase];
        return current?.status === "failed" && phase !== "price-request";
    });
    run.manifest.status = status === "completed"
        ? failedStage
            ? "failed"
            : incompleteStage
                ? "incomplete"
                : "completed"
        : status;
    if (incompleteStage || run.manifest.traceErrorCode)
        run.manifest.traceCompleteness = "incomplete";
    await appendTrace(run, {
        event: "run-end",
        runId: run.manifest.runId,
        endedAt: nowIso(),
        durationMs: run.manifest.totalDurationMs,
        status: run.manifest.status,
    });
    try {
        const traceContents = await (0, promises_1.readFile)(run.traceFile);
        run.manifest.artifacts.trace = {
            file: "trace.jsonl",
            bytes: traceContents.byteLength,
            sha256: hashBytes(traceContents),
        };
    }
    catch (error) {
        run.manifest.traceCompleteness = "incomplete";
        run.manifest.traceErrorCode = run.manifest.traceErrorCode ?? errorCode(error);
        run.manifest.warnings = [...new Set([...run.manifest.warnings, "Timing Trace could not be finalized."])];
    }
    await persistManifest(run);
}
async function writeRunArtifact(run, name, value) {
    const file = artifactFiles[name];
    const filePath = path.join(run.runDir, file);
    const serialized = JSON.stringify(value);
    if (serialized === undefined)
        throw new Error("Report Run artifact is not JSON serializable.");
    await writeAtomic(filePath, serialized + "\n");
    const bytes = Buffer.byteLength(serialized + "\n", "utf8");
    const ref = { file, bytes, sha256: hashBytes(Buffer.from(serialized + "\n", "utf8")) };
    run.manifest.artifacts[name] = ref;
    await persistManifest(run);
    return ref;
}
async function writeRunTextArtifact(run, name, contents) {
    const file = artifactFiles[name];
    const filePath = path.join(run.runDir, file);
    await writeAtomic(filePath, contents);
    const bytes = Buffer.byteLength(contents, "utf8");
    const ref = { file, bytes, sha256: hashBytes(Buffer.from(contents, "utf8")) };
    run.manifest.artifacts[name] = ref;
    await persistManifest(run);
    return ref;
}
async function registerRunArtifact(run, name, filePath) {
    const contents = await (0, promises_1.readFile)(filePath);
    const relative = path.relative(run.runDir, path.resolve(filePath));
    const ref = {
        file: relative && !relative.startsWith("..") ? relative : "external:" + path.basename(filePath),
        bytes: contents.byteLength,
        sha256: hashBytes(contents),
    };
    run.manifest.artifacts[name] = ref;
    await persistManifest(run);
    return ref;
}
async function readRunManifest(runDir) {
    const value = JSON.parse(await (0, promises_1.readFile)(path.join(path.resolve(runDir), "manifest.json"), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Report Run manifest is malformed.");
    return value;
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
    const manifest = await readRunManifest(resolved);
    const traceFile = path.join(resolved, "trace.jsonl");
    const phase = safeSpanLabel(event.phase, "unknown-phase");
    const operation = safeSpanLabel(event.operation, "unknown-operation");
    const spanId = safeSpanLabel(event.spanId, "unknown-span");
    const parentSpanId = event.parentSpanId ? safeSpanLabel(event.parentSpanId, "unknown-parent") : null;
    const current = manifest.stageStatus[phase];
    manifest.eligibleStages = [...new Set([...manifest.eligibleStages, phase])];
    const attempt = event.attempt ?? (event.event === "end" && current?.spanId === spanId ? current.attempt : (current?.attempt ?? 0) + 1);
    const missingStart = event.event === "end" && (current?.spanId !== spanId || current.status !== "started");
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
    try {
        await (0, promises_1.appendFile)(traceFile, JSON.stringify(line) + "\n", "utf8");
    }
    catch (error) {
        manifest.traceCompleteness = "incomplete";
        manifest.traceErrorCode = manifest.traceErrorCode ?? errorCode(error);
        manifest.warnings = [...new Set([...manifest.warnings, "Timing Trace could not be persisted completely."])];
    }
    manifest.updatedAt = nowIso();
    await writeAtomic(path.join(resolved, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    return manifest;
}
async function recordRunSpanInProcess(run, event) {
    const phase = safeSpanLabel(event.phase, "unknown-phase");
    const operation = safeSpanLabel(event.operation, "unknown-operation");
    const spanId = safeSpanLabel(event.spanId, "unknown-span");
    const parentSpanId = event.parentSpanId ? safeSpanLabel(event.parentSpanId, "unknown-parent") : null;
    const current = run.manifest.stageStatus[phase];
    const attempt = event.attempt ?? (event.event === "end" && current?.spanId === spanId ? current.attempt : (current?.attempt ?? 0) + 1);
    const missingStart = event.event === "end" && (current?.spanId !== spanId || current.status !== "started");
    if (missingStart) {
        run.manifest.traceCompleteness = "incomplete";
        run.manifest.warnings = [...new Set([...run.manifest.warnings, "A timing span ended without a persisted start event."])];
    }
    run.manifest.eligibleStages = [...new Set([...run.manifest.eligibleStages, phase])];
    if (event.event === "start") {
        run.manifest.stageStatus[phase] = { status: "started", attempt, spanId, durationMs: null };
    }
    else {
        const durationMs = typeof event.durationMs === "number"
            ? Math.max(0, event.durationMs)
            : event.endedAt
                ? Math.max(0, Date.parse(event.endedAt) - Date.parse(event.startedAt))
                : null;
        run.manifest.stageStatus[phase] = {
            status: event.status ?? "unavailable",
            attempt,
            spanId,
            durationMs,
            ...(event.errorCode ? { errorCode: errorCode({ code: event.errorCode }) } : {}),
        };
    }
    const { metadata: _metadata, errorCode: _errorCode, ...eventWithoutUnsafeFields } = event;
    await appendTrace(run, {
        ...eventWithoutUnsafeFields,
        spanId,
        phase,
        operation,
        parentSpanId,
        runId: run.manifest.runId,
        attempt,
        ...(event.errorCode ? { errorCode: errorCode({ code: event.errorCode }) } : {}),
        ...(event.metadata && safeMetadata(event.metadata) ? { metadata: safeMetadata(event.metadata) } : {}),
    });
    await persistManifest(run);
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
async function captureSourceInventory(harness) {
    const root = harness === "codex"
        ? path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sessions")
        : path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");
    const files = await historyFiles(root, harness);
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
        return { promptHashes: { reportSynthesis: null, keySessionAnalysis: null }, runtimeHash: null };
    }
    const runtimeHashes = [];
    for (const file of runtimeFiles) {
        const hash = await hashFile(file);
        if (!hash)
            return { promptHashes: { reportSynthesis: null, keySessionAnalysis: null }, runtimeHash: null };
        runtimeHashes.push(hash);
    }
    return {
        promptHashes: {
            reportSynthesis: await findPrompt("report-synthesis.md"),
            keySessionAnalysis: await findPrompt("key-session-analysis.md"),
        },
        runtimeHash: hashBytes(Buffer.from(runtimeHashes.join("|"), "utf8")),
    };
}
