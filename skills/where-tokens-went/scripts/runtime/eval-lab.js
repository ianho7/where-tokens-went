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
exports.readEvalCase = readEvalCase;
exports.checkEvalInput = checkEvalInput;
exports.gradeLaneOutput = gradeLaneOutput;
exports.runEvalTrial = runEvalTrial;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const key_session_analysis_1 = require("./key-session-analysis");
const skill_insights_1 = require("./skill-insights");
const codex_provenance_1 = require("./codex-provenance");
const eval_contract_1 = require("./eval-contract");
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function outputHash(raw) {
    return (0, node_crypto_1.createHash)("sha256").update(raw, "utf8").digest("hex");
}
async function readJson(filePath) {
    return JSON.parse(await (0, promises_1.readFile)(filePath, "utf8"));
}
async function readEvalCase(casePath) {
    const value = await readJson(casePath);
    if (!(0, eval_contract_1.isEvalCase)(value))
        throw new Error("Eval Case does not satisfy the executable contract.");
    return value;
}
async function checkEvalInput(evalCase, inputPath) {
    const raw = await (0, promises_1.readFile)(inputPath, "utf8");
    const inputHash = (0, eval_contract_1.sha256Text)(raw);
    if (inputHash.toLowerCase() !== evalCase.inputHash.toLowerCase())
        throw new Error(`Eval Case input hash mismatch for ${evalCase.id}.`);
    return { input: JSON.parse(raw), inputHash };
}
function error(code, message, fieldPath = null) {
    return { code, fieldPath, message };
}
function gradeLaneOutput(evalCase, input, rawOutput) {
    const errors = [];
    let snapshotId;
    let skillInsightsAccepted = false;
    if (!isRecord(input))
        errors.push(error("EVAL_INPUT_MALFORMED", "Frozen lane input must be an object."));
    if (evalCase.lane === "skill-insights") {
        const snapshot = input;
        if (!snapshot || typeof snapshot.snapshotId !== "string")
            errors.push(error("EVAL_SNAPSHOT_MISSING", "Skill Insights requires an immutable snapshotId.", "snapshotId"));
        else {
            snapshotId = snapshot.snapshotId;
            const result = (0, skill_insights_1.validateSkillInsights)(rawOutput, snapshot);
            // Card-level errors describe filtered cards. A non-empty valid result
            // matches the Report Run path; these diagnostics do not block other cards.
            for (const message of result.errors)
                errors.push(error(message.includes("snapshotId") ? "EVAL_SNAPSHOT_MISMATCH" : "SKILL_INSIGHTS_INVALID", message));
            skillInsightsAccepted = result.valid && result.insights.length > 0;
        }
    }
    else if (!isRecord(input) || !isRecord(input.audit)) {
        errors.push(error("EVAL_INPUT_UNSUPPORTED", "This lane requires a frozen input object containing AuditResult under audit."));
    }
    else if (evalCase.lane === "report-synthesis") {
        const result = (0, key_session_analysis_1.validateReportSynthesis)(input.audit, rawOutput);
        for (const message of result.errors)
            errors.push(error("REPORT_SYNTHESIS_INVALID", message));
    }
    else {
        const packets = Array.isArray(input.evidence) ? input.evidence : [];
        const candidates = Array.isArray(rawOutput) ? rawOutput : [];
        if (candidates.length === 0)
            errors.push(error("KEY_SESSION_INVALID", "Expected at least one Key Session Analysis."));
        for (const [index, candidate] of candidates.entries()) {
            const result = (0, key_session_analysis_1.validateKeySessionAnalysis)(input.audit, candidate, packets.filter((packet) => packet.sessionId === candidate.sessionId));
            for (const message of result.errors)
                errors.push(error("KEY_SESSION_INVALID", message, `[${index}]`));
        }
    }
    return {
        status: evalCase.lane === "skill-insights"
            ? (skillInsightsAccepted ? "passed" : "blocked")
            : (errors.length === 0 ? "passed" : "blocked"),
        lane: evalCase.lane,
        caseId: evalCase.id,
        errors,
        outputHash: null,
        inputHash: evalCase.inputHash,
        ...(snapshotId ? { snapshotId } : {}),
    };
}
async function runEvalTrial(options) {
    const resolvedArtifactDir = path.resolve(options.artifactDir);
    const repoRoot = path.resolve(process.cwd());
    const relativeScratchDir = path.relative(path.resolve(repoRoot, ".scratch"), resolvedArtifactDir);
    const relativeTempDir = path.relative(path.resolve(os.tmpdir()), resolvedArtifactDir);
    const underScratch = relativeScratchDir === "" || (!relativeScratchDir.startsWith("..") && !path.isAbsolute(relativeScratchDir));
    const underTemp = relativeTempDir === "" || (!relativeTempDir.startsWith("..") && !path.isAbsolute(relativeTempDir));
    if (!underScratch && !underTemp)
        throw new Error("EVAL_ARTIFACT_DIR_NOT_LOCAL");
    const evalCase = await readEvalCase(options.casePath);
    const inputPath = options.inputPath ?? path.resolve(evalCase.inputArtifact);
    const { input, inputHash } = await checkEvalInput(evalCase, inputPath);
    let parsedOutput;
    let parseError = null;
    try {
        parsedOutput = JSON.parse(options.rawOutput);
    }
    catch {
        parsedOutput = null;
        parseError = "MODEL_OUTPUT_INVALID_JSON";
    }
    const grade = parseError
        ? { ...gradeLaneOutput(evalCase, input, null), status: "blocked", errors: [error(parseError, "Model output was not valid JSON.")] }
        : gradeLaneOutput(evalCase, input, parsedOutput);
    if (options.promotionCritical && evalCase.lane === "skill-insights" && isRecord(parsedOutput) && Array.isArray(parsedOutput.insights) && parsedOutput.insights.length === 0) {
        grade.status = "blocked";
        grade.errors.push(error("SKILL_INSIGHTS_EMPTY", "Promotion-critical Skill Insights output must contain non-empty capability content."));
    }
    grade.outputHash = outputHash(options.rawOutput);
    let generationRecord = null;
    if (options.promotionCritical || options.generationRecordPath) {
        if (!options.generationRecordPath)
            throw new Error("EVAL_GENERATION_PROVENANCE_REQUIRED");
        const generationPath = path.resolve(options.generationRecordPath);
        const generationRaw = await (0, promises_1.readFile)(generationPath, "utf8");
        let parsedGeneration;
        try {
            parsedGeneration = JSON.parse(generationRaw);
        }
        catch {
            throw new Error("EVAL_GENERATION_RECORD_UNPARSEABLE");
        }
        if (!(0, eval_contract_1.isGenerationRecord)(parsedGeneration))
            throw new Error("EVAL_GENERATION_RECORD_INVALID");
        const indexRecord = parsedGeneration;
        if (indexRecord.caseId !== evalCase.id
            || indexRecord.lane !== evalCase.lane
            || indexRecord.role !== options.role
            || indexRecord.inputHash !== inputHash
            || indexRecord.promptHash !== options.promptHash
            || indexRecord.modelComparisonKey !== options.modelConfig.comparisonKey) {
            throw new Error("EVAL_GENERATION_RECORD_CONTEXT_MISMATCH");
        }
        const provenance = await (0, codex_provenance_1.resolveCodexProvenance)({
            rolloutPath: indexRecord.codexProvenance.rolloutPath,
            sessionId: indexRecord.codexProvenance.sessionId,
            threadId: indexRecord.codexProvenance.threadId,
            turnId: indexRecord.codexProvenance.turnId,
            responseItemId: indexRecord.codexProvenance.responseItemId,
            rawOutput: options.rawOutput,
            tokenMetric: options.tokenMetric ?? indexRecord.codexProvenance.tokenMetric,
        }).catch((error) => {
            if (error instanceof Error && error.message.startsWith("CODEX_PROVENANCE_"))
                throw error;
            throw new Error("EVAL_GENERATION_SOURCE_UNRESOLVABLE");
        });
        if (provenance.outputHash !== grade.outputHash)
            throw new Error("EVAL_GENERATION_RECORD_BINDING_MISMATCH");
        generationRecord = {
            ...indexRecord,
            executionId: `codex:${provenance.sessionId}:${provenance.threadId}:${provenance.turnId}:${provenance.responseItemId}`,
            caseId: evalCase.id,
            lane: evalCase.lane,
            role: options.role,
            inputHash,
            promptHash: options.promptHash,
            outputHash: grade.outputHash,
            modelComparisonKey: options.modelConfig.comparisonKey,
            producerContext: { role: "generator", contextId: provenance.threadId, host: "codex" },
            observed: { startedAt: provenance.startedAt, endedAt: provenance.endedAt, usage: provenance.usage },
            codexProvenance: provenance,
            sourceReference: provenance.rolloutPath,
            sourceReferenceHash: provenance.rolloutHash,
        };
        if (grade.status !== "passed")
            throw new Error("EVAL_GENERATION_CONTRACT_BLOCKED");
    }
    const experimentId = options.experimentId ?? "standalone-eval";
    const attempt = options.attempt ?? 1;
    if (!Number.isInteger(attempt) || attempt < 1)
        throw new Error("EVAL_TRIAL_ATTEMPT_INVALID");
    const trialId = options.trialId ?? (0, node_crypto_1.randomUUID)();
    const trialDir = path.join(resolvedArtifactDir, "experiments", experimentId, evalCase.id, options.role, `attempt-${attempt}-${trialId}`);
    await (0, promises_1.mkdir)(trialDir, { recursive: true });
    const rawArtifact = path.join(trialDir, "output.raw.json");
    const validationArtifact = path.join(trialDir, "validation.json");
    const trialArtifact = path.join(trialDir, "trial.json");
    const writeImmutable = async (filePath, contents) => {
        await (0, promises_1.writeFile)(filePath, contents, { encoding: "utf8", flag: "wx" });
    };
    await writeImmutable(rawArtifact, options.rawOutput);
    await writeImmutable(validationArtifact, JSON.stringify({ version: eval_contract_1.EVAL_CONTRACT_VERSION, ...grade, outputHash: grade.outputHash }, null, 2) + "\n");
    const trial = {
        version: eval_contract_1.EVAL_CONTRACT_VERSION,
        id: trialId,
        caseId: evalCase.id,
        lane: evalCase.lane,
        role: options.role,
        promptHash: options.promptHash,
        bundleVersion: options.bundleVersion,
        inputHash,
        modelConfig: options.modelConfig,
        outputHash: grade.outputHash,
        outputArtifact: rawArtifact,
        validationArtifact,
        contractStatus: grade.status,
        quality: Object.fromEntries((evalCase.lane === "skill-insights"
            ? ["snapshot_binding", "content_contrast", "decision_delta", "uncertainty"]
            : evalCase.lane === "key-session-analysis"
                ? ["scope_binding", "mechanism", "actionability", "unknown_calibration"]
                : ["evidence_grounding", "aha_relevance", "non_duplication", "uncertainty"]).map((key) => [key, "unknown"])),
        durationMs: generationRecord ? Math.max(0, Date.parse(generationRecord.observed.endedAt) - Date.parse(generationRecord.observed.startedAt)) : options.durationMs ?? null,
        tokenCount: generationRecord?.codexProvenance.tokenValue ?? (options.promotionCritical ? null : options.tokenCount ?? null),
        toolCallCount: options.toolCallCount ?? null,
        transcriptRef: generationRecord?.sourceReference ?? (options.promotionCritical ? null : options.transcriptRef ?? null),
        privacy: options.privacy ?? evalCase.privacy,
        createdAt: new Date().toISOString(),
        experimentId,
        attempt,
        generationRecord,
    };
    await writeImmutable(trialArtifact, JSON.stringify(trial, null, 2) + "\n");
    return trial;
}
