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
exports.EVAL_PHASES = void 0;
exports.advanceEvalState = advanceEvalState;
exports.readEvalState = readEvalState;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
const eval_contract_1 = require("./eval-contract");
const codex_provenance_1 = require("./codex-provenance");
exports.EVAL_PHASES = [
    "freeze",
    "generator",
    "contract-grade",
    "blind-quality-grade",
    "optimize",
    "regression",
    "held-out",
    "review",
    "promote",
];
const STATE_LOCK_TIMEOUT_MS = 5_000;
const STATE_LOCK_POLL_MS = 10;
async function sleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}
async function withStateLock(statePath, operation) {
    const lockPath = statePath + ".lock";
    const owner = JSON.stringify({ pid: process.pid, token: (0, node_crypto_1.randomUUID)() }) + "\n";
    const deadline = Date.now() + STATE_LOCK_TIMEOUT_MS;
    let handle = null;
    while (!handle) {
        try {
            handle = await fs.open(lockPath, "wx");
            await handle.writeFile(owner, "utf8");
        }
        catch (error) {
            await handle?.close().catch(() => undefined);
            handle = null;
            if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST"))
                throw error;
            if (Date.now() >= deadline) {
                const timeout = new Error(`Eval state lock wait timed out after ${STATE_LOCK_TIMEOUT_MS}ms.`);
                timeout.code = "EVAL_STATE_LOCK_TIMEOUT";
                throw timeout;
            }
            await sleep(STATE_LOCK_POLL_MS);
        }
    }
    try {
        return await operation();
    }
    finally {
        await handle.close().catch(() => undefined);
        try {
            if (await fs.readFile(lockPath, "utf8") === owner)
                await fs.unlink(lockPath);
        }
        catch {
            // Never remove an uncertain owner lock.
        }
    }
}
function isPhase(value) {
    return typeof value === "string" && exports.EVAL_PHASES.includes(value);
}
function isState(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    const candidate = value;
    if (candidate.version !== 1 || typeof candidate.experimentId !== "string"
        || !Array.isArray(candidate.completed) || !candidate.completed.every(isPhase)
        || (candidate.nextLegalAction !== null && !isPhase(candidate.nextLegalAction))
        || !Array.isArray(candidate.history))
        return false;
    return candidate.history.every((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry))
            return false;
        const record = entry;
        const evidenceHashes = record.evidenceHashes;
        return isPhase(record.phase) && typeof record.completedAt === "string"
            && Array.isArray(record.evidence) && record.evidence.every((item) => typeof item === "string")
            && (evidenceHashes === undefined || (Array.isArray(evidenceHashes) && evidenceHashes.every((item) => {
                if (!item || typeof item !== "object" || Array.isArray(item))
                    return false;
                const hash = item;
                return typeof hash.path === "string" && typeof hash.sha256 === "string" && /^[a-f0-9]{64}$/i.test(hash.sha256);
            })));
    });
}
async function readState(statePath, experimentId) {
    try {
        const parsed = JSON.parse(await fs.readFile(statePath, "utf8"));
        if (!isState(parsed) || parsed.experimentId !== experimentId)
            throw new Error("EVAL_STATE_INVALID");
        return parsed;
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return { version: 1, experimentId, completed: [], nextLegalAction: "freeze", history: [] };
        }
        if (error instanceof Error && error.message === "EVAL_STATE_INVALID")
            throw error;
        throw new Error("EVAL_STATE_UNPARSEABLE");
    }
}
async function writeState(statePath, state) {
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    const temporary = `${statePath}.${process.pid}.${(0, node_crypto_1.randomUUID)()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(state, null, 2) + "\n", "utf8");
    await fs.rename(temporary, statePath);
}
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
async function phaseEvidenceIsGradeable(action, evidence) {
    if (action === "freeze")
        return evidence.length === 0;
    if (evidence.length === 0)
        return false;
    const values = [];
    for (const item of evidence) {
        try {
            values.push(JSON.parse(await fs.readFile(path.resolve(item), "utf8")));
        }
        catch {
            return false;
        }
    }
    const flattened = values.flatMap((value) => Array.isArray(value) ? value : [value]);
    const generationIsReal = async (value) => {
        const record = (0, eval_contract_1.isGenerationRecord)(value)
            ? value
            : isRecord(value) && (0, eval_contract_1.isGenerationRecord)(value.generationRecord)
                ? value.generationRecord
                : null;
        if (!record)
            return false;
        const observed = await (0, codex_provenance_1.resolveCodexProvenance)({
            rolloutPath: record.codexProvenance.rolloutPath,
            sessionId: record.codexProvenance.sessionId,
            threadId: record.codexProvenance.threadId,
            turnId: record.codexProvenance.turnId,
            responseItemId: record.codexProvenance.responseItemId,
            rawOutput: null,
            tokenMetric: record.codexProvenance.tokenMetric,
        }).catch(() => null);
        return Boolean(observed
            && observed.rolloutHash === record.sourceReferenceHash
            && observed.outputHash === record.outputHash
            && observed.outputHash === record.codexProvenance.outputHash);
    };
    const roleIsReal = async (value, role) => {
        if (!(0, eval_contract_1.isRoleExecutionRecord)(value, role))
            return false;
        const observed = await (0, codex_provenance_1.resolveCodexProvenance)({
            rolloutPath: value.codexProvenance.rolloutPath,
            sessionId: value.codexProvenance.sessionId,
            threadId: value.codexProvenance.threadId,
            turnId: value.codexProvenance.turnId,
            responseItemId: value.codexProvenance.responseItemId,
            rawOutput: null,
            tokenMetric: value.codexProvenance.tokenMetric,
        }).catch(() => null);
        return Boolean(observed && observed.rolloutHash === value.sourceReferenceHash && observed.outputHash === value.outputHash);
    };
    switch (action) {
        case "generator":
            return flattened.length > 0 && (await Promise.all(flattened.map(generationIsReal))).every(Boolean);
        case "contract-grade":
            if (values.length === 0)
                return false;
            for (let index = 0; index < values.length; index += 1) {
                const value = values[index];
                if (!isRecord(value) || value.status !== "passed" || typeof value.caseId !== "string" || typeof value.inputHash !== "string" || typeof value.outputHash !== "string")
                    return false;
                try {
                    const trial = JSON.parse(await fs.readFile(path.join(path.dirname(path.resolve(evidence[index])), "trial.json"), "utf8"));
                    if (!(0, eval_contract_1.isEvalTrial)(trial) || trial.caseId !== value.caseId || trial.inputHash !== value.inputHash || trial.outputHash !== value.outputHash || !await generationIsReal(trial))
                        return false;
                }
                catch {
                    // A validation record without its real trial is not state evidence.
                    return false;
                }
            }
            return true;
        case "blind-quality-grade":
            return flattened.length > 0 && (await Promise.all(flattened.map((value) => roleIsReal(value, "quality-grader")))).every(Boolean);
        case "optimize":
            return flattened.length > 0 && (await Promise.all(flattened.map(async (value) => {
                if (await roleIsReal(value, "optimizer"))
                    return true;
                return isRecord(value) && await roleIsReal(value.optimizerRecord, "optimizer");
            }))).every(Boolean);
        case "regression":
        case "held-out":
            {
                const trials = flattened.flatMap((value) => (0, eval_contract_1.isEvalTrial)(value) ? [value] : isRecord(value) && Array.isArray(value.trials) ? value.trials.filter(eval_contract_1.isEvalTrial) : []);
                return trials.length >= 3 && (await Promise.all(trials.map(generationIsReal))).every(Boolean);
            }
        case "review":
            {
                const reviewArtifact = values.map((value) => isRecord(value) && isRecord(value.review) && typeof value.review.reviewArtifactHash === "string" && isRecord(value.reviewerRecord) ? value : null).find((value) => value !== null);
                if (!reviewArtifact)
                    return false;
                const reviewerRecord = reviewArtifact.reviewerRecord;
                if (typeof reviewerRecord.recordPath !== "string" || typeof reviewerRecord.hash !== "string")
                    return false;
                let reviewerIsReal = false;
                try {
                    const recordRaw = await fs.readFile(path.resolve(reviewerRecord.recordPath), "utf8");
                    const record = JSON.parse(recordRaw);
                    reviewerIsReal = await roleIsReal(record, "reviewer") && reviewerRecord.hash === (0, node_crypto_1.createHash)("sha256").update(recordRaw).digest("hex");
                }
                catch {
                    reviewerIsReal = false;
                }
                const hasGrader = (await Promise.all(flattened.map((value) => roleIsReal(value, "quality-grader")))).some(Boolean);
                const hasOptimizer = (await Promise.all(flattened.map((value) => roleIsReal(value, "optimizer")))).some(Boolean);
                const hasBlindArtifact = values.some((value) => Array.isArray(value) && value.length > 0);
                return reviewerIsReal && hasGrader && hasOptimizer && hasBlindArtifact;
            }
        case "promote":
            return flattened.some((value) => isRecord(value) && value.status === "awaiting-final-acceptance" && typeof value.promotedAt === "string" && typeof value.candidatePromptHash === "string" && typeof value.bundleVersion === "string")
                && flattened.some((value) => isRecord(value) && isRecord(value.review) && value.review.conclusion === "eligible" && value.review.approved === true);
        default:
            return false;
    }
}
async function advanceEvalState(statePath, experimentId, action, evidence = []) {
    const resolved = path.resolve(statePath);
    return withStateLock(resolved, async () => {
        const current = await readState(resolved, experimentId);
        if (current.completed.includes(action))
            return { state: current, reused: true };
        if (current.nextLegalAction !== action)
            throw new Error(`EVAL_STATE_ILLEGAL_ACTION:${action}:expected:${current.nextLegalAction ?? "complete"}`);
        if (!await phaseEvidenceIsGradeable(action, evidence))
            throw new Error(`EVAL_STATE_EVIDENCE_NOT_PHASE_GRADEABLE:${action}`);
        const evidenceHashes = [];
        for (const item of evidence) {
            const absolute = path.resolve(item);
            try {
                const bytes = await fs.readFile(absolute);
                evidenceHashes.push({ path: absolute, sha256: (0, node_crypto_1.createHash)("sha256").update(bytes).digest("hex") });
            }
            catch {
                throw new Error(`EVAL_STATE_EVIDENCE_UNRESOLVABLE:${item}`);
            }
        }
        const nextIndex = exports.EVAL_PHASES.indexOf(action) + 1;
        const next = nextIndex < exports.EVAL_PHASES.length ? exports.EVAL_PHASES[nextIndex] : null;
        const state = {
            ...current,
            completed: [...current.completed, action],
            nextLegalAction: next,
            history: [...current.history, { phase: action, completedAt: new Date().toISOString(), evidence: [...evidence], evidenceHashes }],
        };
        await writeState(resolved, state);
        return { state, reused: false };
    });
}
async function readEvalState(statePath, experimentId) {
    return readState(path.resolve(statePath), experimentId);
}
