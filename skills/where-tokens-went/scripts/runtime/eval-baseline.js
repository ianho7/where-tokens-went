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
exports.isBaselineBootstrapReview = isBaselineBootstrapReview;
exports.bootstrapAcceptedBaseline = bootstrapAcceptedBaseline;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const path = __importStar(require("node:path"));
const eval_contract_1 = require("./eval-contract");
function sha256(value) {
    return (0, node_crypto_1.createHash)("sha256").update(value).digest("hex");
}
function isHash(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}
function isBaselineBootstrapReview(review) {
    if (!review || typeof review !== "object" || Array.isArray(review))
        return false;
    const candidate = review;
    return candidate.version === 1
        && candidate.kind === "accepted-baseline-bootstrap-review"
        && candidate.conclusion === "accepted"
        && Array.isArray(candidate.reviewedTrialIds)
        && candidate.reviewedTrialIds.length > 0
        && candidate.reviewedTrialIds.every((id) => typeof id === "string" && id.length > 0)
        && [candidate.blindMapHash, candidate.gradesHash, candidate.varianceHash, candidate.reviewEvidenceHash, candidate.reviewerRecordHash, candidate.qualityGraderRecordHash].every(isHash);
}
async function replaceJsonAtomically(filePath, contents) {
    const target = path.resolve(filePath);
    const temporary = `${target}.${process.pid}.${(0, node_crypto_1.randomUUID)()}.tmp`;
    await (0, promises_1.writeFile)(temporary, contents, "utf8");
    try {
        try {
            await (0, promises_1.rename)(temporary, target);
            return;
        }
        catch (error) {
            if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST"))
                throw error;
        }
        const backup = `${target}.${process.pid}.${(0, node_crypto_1.randomUUID)()}.previous`;
        await (0, promises_1.rename)(target, backup);
        try {
            await (0, promises_1.rename)(temporary, target);
            await (0, promises_1.unlink)(backup).catch(() => undefined);
        }
        catch (error) {
            await (0, promises_1.rename)(backup, target).catch(() => undefined);
            throw error;
        }
    }
    catch (error) {
        await (0, promises_1.unlink)(temporary).catch(() => undefined);
        const wrapped = new Error(`Baseline atomic replacement failed for ${path.basename(target)}.`);
        wrapped.code = "EVAL_BASELINE_ATOMIC_REPLACE_FAILED";
        wrapped.cause = error;
        throw wrapped;
    }
}
async function bootstrapAcceptedBaseline(options) {
    const previousPath = path.resolve(options.previousBaselinePath);
    const outputPath = path.resolve(options.outputPath);
    const previousBytes = await (0, promises_1.readFile)(previousPath).catch(() => { throw new Error("EVAL_BASELINE_PREVIOUS_UNREADABLE"); });
    const previousHash = sha256(previousBytes);
    if (!isHash(options.previousBaselineHash) || previousHash !== options.previousBaselineHash)
        throw new Error("EVAL_BASELINE_PREVIOUS_HASH_MISMATCH");
    if (!options.invalidationReason.trim())
        throw new Error("EVAL_BASELINE_INVALIDATION_REASON_REQUIRED");
    if (!isBaselineBootstrapReview(options.review))
        throw new Error("EVAL_BASELINE_BOOTSTRAP_REVIEW_INVALID");
    const trialIds = options.baseline.trials.map((trial) => trial.id);
    if (new Set(trialIds).size !== trialIds.length || JSON.stringify([...trialIds].sort()) !== JSON.stringify([...options.review.reviewedTrialIds].sort()))
        throw new Error("EVAL_BASELINE_BOOTSTRAP_REVIEW_TRIAL_SET_MISMATCH");
    if (JSON.stringify(options.baseline.promptHashes) !== JSON.stringify(options.currentPromptHashes))
        throw new Error("EVAL_BASELINE_BOOTSTRAP_PROMPT_CHANGED");
    if (!(0, eval_contract_1.isAcceptedBaseline)(options.baseline))
        throw new Error("EVAL_BASELINE_BOOTSTRAP_BASELINE_INVALID");
    if (options.candidatePromptPath !== undefined || options.candidatePromptHash !== undefined) {
        if (!options.candidatePromptPath || !isHash(options.candidatePromptHash))
            throw new Error("EVAL_BASELINE_BOOTSTRAP_CANDIDATE_BINDING_INVALID");
        const candidateHash = sha256(await (0, promises_1.readFile)(path.resolve(options.candidatePromptPath)));
        if (candidateHash !== options.candidatePromptHash)
            throw new Error("EVAL_BASELINE_BOOTSTRAP_CANDIDATE_MUTATED");
    }
    // The accepted baseline may omit raw output bytes from tracked projections,
    // but it must retain the resolvable Host Agent locator. A hash of a removed
    // generation record is not provenance and cannot be revalidated at review.
    const acceptedTrials = options.baseline.trials.map((trial) => ({
        ...trial,
        provenanceEvidenceHash: trial.generationRecord ? sha256(JSON.stringify(trial.generationRecord)) : undefined,
        privacy: "redacted",
    }));
    const accepted = {
        ...options.baseline,
        trials: acceptedTrials,
        bootstrap: {
            previousBaselinePath: path.relative(process.cwd(), previousPath).replaceAll(path.sep, "/") || path.basename(previousPath),
            previousBaselineHash: previousHash,
            invalidationReason: options.invalidationReason,
            invalidatedAt: new Date().toISOString(),
            reviewHashes: {
                blindMapHash: options.review.blindMapHash,
                gradesHash: options.review.gradesHash,
                varianceHash: options.review.varianceHash,
                reviewEvidenceHash: options.review.reviewEvidenceHash,
                reviewerRecordHash: options.review.reviewerRecordHash,
                qualityGraderRecordHash: options.review.qualityGraderRecordHash,
            },
        },
    };
    await replaceJsonAtomically(outputPath, JSON.stringify(accepted, null, 2) + "\n");
    return accepted;
}
