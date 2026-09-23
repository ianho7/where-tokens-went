"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROMOTION_MINIMUM_IMPROVEMENT_DELTA = exports.PROMOTION_MINIMUM_TRIALS = exports.EVAL_CONTRACT_VERSION = void 0;
exports.isEvalCase = isEvalCase;
exports.isEvalRubric = isEvalRubric;
exports.isEvalModelConfig = isEvalModelConfig;
exports.isEvalExperiment = isEvalExperiment;
exports.isGenerationRecord = isGenerationRecord;
exports.isRoleExecutionRecord = isRoleExecutionRecord;
exports.isEvalTrial = isEvalTrial;
exports.isAcceptedBaseline = isAcceptedBaseline;
exports.sha256Json = sha256Json;
exports.sha256Text = sha256Text;
exports.evaluateBudget = evaluateBudget;
exports.summarizeScores = summarizeScores;
exports.reviewExperiment = reviewExperiment;
exports.reviewArtifactBindingHash = reviewArtifactBindingHash;
exports.makeOptimizerProposal = makeOptimizerProposal;
const node_crypto_1 = require("node:crypto");
exports.EVAL_CONTRACT_VERSION = 1;
exports.PROMOTION_MINIMUM_TRIALS = 3;
exports.PROMOTION_MINIMUM_IMPROVEMENT_DELTA = 0.05;
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isHash(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}
function isCodexProvenance(value) {
    if (!isRecord(value) || value.harness !== "codex" || typeof value.rolloutPath !== "string" || value.rolloutPath.length === 0 || !isHash(value.rolloutHash)
        || typeof value.sessionId !== "string" || typeof value.threadId !== "string" || typeof value.turnId !== "string" || typeof value.responseItemId !== "string"
        || !Number.isInteger(value.responseItemOrdinal) || !Number.isInteger(value.tokenUsageRecordOrdinal) || !Number.isInteger(value.tokenEventOrdinal)
        || typeof value.responseId !== "string" || typeof value.startedAt !== "string" || typeof value.endedAt !== "string"
        || (value.tokenMetric !== "output_tokens" && value.tokenMetric !== "total_tokens") || (value.tokenValue !== null && typeof value.tokenValue !== "number") || !isHash(value.outputHash))
        return false;
    if (value.usage !== null) {
        if (!isRecord(value.usage))
            return false;
        const usage = value.usage;
        if (!["inputTokens", "outputTokens", "totalTokens"].every((key) => usage[key] === null || typeof usage[key] === "number"))
            return false;
    }
    return Date.parse(value.startedAt) <= Date.parse(value.endedAt);
}
function isLane(value) {
    return value === "report-synthesis" || value === "key-session-analysis" || value === "skill-insights";
}
function isVersion(value) {
    return value === exports.EVAL_CONTRACT_VERSION;
}
function isEvalCase(value) {
    if (!isRecord(value) || !isVersion(value.version) || typeof value.id !== "string" || !isLane(value.lane))
        return false;
    if (value.class !== "capability" && value.class !== "regression")
        return false;
    if (value.split !== "smoke" && value.split !== "regression" && value.split !== "held-out")
        return false;
    if (typeof value.inputArtifact !== "string" || !isHash(value.inputHash) || (value.scenarioContentHash !== undefined && !isHash(value.scenarioContentHash)) || typeof value.expectedOutcome !== "string")
        return false;
    if (!Array.isArray(value.deterministicExpectations) || !value.deterministicExpectations.every((item) => typeof item === "string" && item.length > 0))
        return false;
    if (typeof value.rubricId !== "string" || (value.goodReference !== undefined && typeof value.goodReference !== "string") || (value.badReference !== undefined && typeof value.badReference !== "string"))
        return false;
    return (value.privacy === "redacted" || value.privacy === "local-only") && (value.originFailure === undefined || typeof value.originFailure === "string");
}
function isEvalRubric(value) {
    if (!isRecord(value) || !isVersion(value.version) || typeof value.id !== "string" || !isLane(value.lane) || !Array.isArray(value.dimensions) || value.dimensions.length === 0)
        return false;
    const ids = new Set();
    return value.dimensions.every((dimension) => {
        if (!isRecord(dimension) || typeof dimension.id !== "string" || dimension.id.length === 0 || ids.has(dimension.id) || typeof dimension.description !== "string" || dimension.description.length === 0 || (dimension.blocking !== undefined && typeof dimension.blocking !== "boolean") || (dimension.minimumScore !== undefined && (typeof dimension.minimumScore !== "number" || dimension.minimumScore < 0 || dimension.minimumScore > 1)))
            return false;
        ids.add(dimension.id);
        return true;
    });
}
function isEvalModelConfig(value) {
    return isRecord(value) && typeof value.provider === "string" && typeof value.model === "string" && (value.temperature === null || typeof value.temperature === "number") && typeof value.comparisonKey === "string";
}
function isEvalExperiment(value) {
    return isRecord(value)
        && isVersion(value.version)
        && typeof value.id === "string"
        && isLane(value.lane)
        && isHash(value.baselinePromptHash)
        && isHash(value.candidatePromptHash)
        && typeof value.targetFailure === "string"
        && typeof value.hypothesis === "string"
        && typeof value.singleChange === "string"
        && typeof value.targetDimension === "string"
        && value.targetDimension.length > 0
        && Array.isArray(value.mustNotRegress)
        && value.mustNotRegress.every((item) => typeof item === "string")
        && typeof value.maxRevisions === "number"
        && Number.isInteger(value.maxRevisions)
        && (value.tokenBudget === null || typeof value.tokenBudget === "number")
        && (value.timeBudgetMs === null || typeof value.timeBudgetMs === "number")
        && (value.budgetEvidencePolicy === "required" || value.budgetEvidencePolicy === "advisory")
        && (value.tokenMetric === "output_tokens" || value.tokenMetric === "total_tokens")
        && Array.isArray(value.caseIds)
        && value.caseIds.every((item) => typeof item === "string")
        && isEvalModelConfig(value.modelConfig)
        && typeof value.status === "string"
        && typeof value.createdAt === "string";
}
function isGenerationRecord(value) {
    if (!isRecord(value) || !isVersion(value.version) || value.kind !== "host-agent-generation")
        return false;
    if (typeof value.executionId !== "string" || value.executionId.length === 0 || typeof value.caseId !== "string" || !isLane(value.lane) || (value.role !== "baseline" && value.role !== "candidate"))
        return false;
    if (!isHash(value.inputHash) || !isHash(value.promptHash) || !isHash(value.outputHash) || typeof value.modelComparisonKey !== "string" || value.modelComparisonKey.length === 0)
        return false;
    if (!isRecord(value.producerContext) || value.producerContext.role !== "generator" || typeof value.producerContext.contextId !== "string" || value.producerContext.contextId.length === 0 || typeof value.producerContext.host !== "string" || value.producerContext.host.length === 0)
        return false;
    if (!isRecord(value.observed) || typeof value.observed.startedAt !== "string" || typeof value.observed.endedAt !== "string")
        return false;
    const usage = value.observed.usage;
    if (usage !== null && (!isRecord(usage) || !["inputTokens", "outputTokens", "totalTokens"].every((key) => usage[key] === null || typeof usage[key] === "number")))
        return false;
    return isCodexProvenance(value.codexProvenance) && value.codexProvenance.outputHash === value.outputHash && typeof value.sourceReference === "string" && value.sourceReference.length > 0 && isHash(value.sourceReferenceHash);
}
function isRoleExecutionRecord(value, role) {
    if (!isRecord(value) || !isVersion(value.version) || (value.kind !== "host-agent-quality-grade" && value.kind !== "host-agent-optimizer" && value.kind !== "host-agent-reviewer") || (value.role !== "quality-grader" && value.role !== "optimizer" && value.role !== "reviewer"))
        return false;
    if (role && value.role !== role)
        return false;
    return typeof value.executionId === "string" && value.executionId.length > 0 && typeof value.contextId === "string" && value.contextId.length > 0 && typeof value.host === "string" && value.host.length > 0 && isHash(value.outputHash) && isCodexProvenance(value.codexProvenance) && value.codexProvenance.outputHash === value.outputHash && typeof value.sourceReference === "string" && value.sourceReference.length > 0 && isHash(value.sourceReferenceHash);
}
function isEvalTrial(value) {
    return isRecord(value) && isVersion(value.version) && typeof value.id === "string" && typeof value.caseId === "string" && isLane(value.lane) && (value.role === "baseline" || value.role === "candidate") && isHash(value.promptHash) && typeof value.bundleVersion === "string" && isHash(value.inputHash) && isEvalModelConfig(value.modelConfig) && (value.outputHash === null || isHash(value.outputHash)) && (value.outputArtifact === null || typeof value.outputArtifact === "string") && typeof value.validationArtifact === "string" && (value.contractStatus === "passed" || value.contractStatus === "blocked" || value.contractStatus === "unknown") && isRecord(value.quality) && (value.durationMs === null || typeof value.durationMs === "number") && (value.tokenCount === null || typeof value.tokenCount === "number") && (value.toolCallCount === null || typeof value.toolCallCount === "number") && (value.transcriptRef === null || typeof value.transcriptRef === "string") && (value.provenanceEvidenceHash === undefined || isHash(value.provenanceEvidenceHash)) && (value.privacy === "redacted" || value.privacy === "local-only") && typeof value.createdAt === "string" && (value.experimentId === undefined || typeof value.experimentId === "string") && (value.attempt === undefined || (typeof value.attempt === "number" && Number.isInteger(value.attempt) && value.attempt >= 1)) && (value.generationRecord === null || isGenerationRecord(value.generationRecord));
}
function isAcceptedBaseline(value) {
    if (!isRecord(value) || !isVersion(value.version) || typeof value.id !== "string" || typeof value.acceptedAt !== "string" || typeof value.productVersion !== "string" || typeof value.bundleVersion !== "string" || typeof value.auditSchemaVersion !== "number" || !isHash(value.runtimeHash) || !isEvalModelConfig(value.modelConfig) || !Array.isArray(value.caseIds) || !Array.isArray(value.trials) || !isRecord(value.knownVariance) || (value.budgetEvidencePolicy !== "required" && value.budgetEvidencePolicy !== "advisory") || (value.tokenMetric !== "output_tokens" && value.tokenMetric !== "total_tokens") || !Array.isArray(value.budgetLimitations) || !value.budgetLimitations.every((item) => typeof item === "string") || value.privacy !== "redacted")
        return false;
    const promptHashes = value.promptHashes;
    const caseIds = value.caseIds;
    const baselineModelConfig = value.modelConfig;
    if (!isRecord(promptHashes) || !isHash(promptHashes["report-synthesis"]) || !isHash(promptHashes["key-session-analysis"]) || !isHash(promptHashes["skill-insights"]) || !caseIds.every((id) => typeof id === "string" && id.length > 0) || caseIds.length === 0)
        return false;
    const bootstrap = value.bootstrap;
    if (bootstrap !== undefined) {
        if (!isRecord(bootstrap) || typeof bootstrap.previousBaselinePath !== "string" || !isHash(bootstrap.previousBaselineHash) || typeof bootstrap.invalidationReason !== "string" || bootstrap.invalidationReason.length === 0 || typeof bootstrap.invalidatedAt !== "string" || !isRecord(bootstrap.reviewHashes))
            return false;
        const reviewHashes = bootstrap.reviewHashes;
        if (!isRecord(reviewHashes) || !["blindMapHash", "gradesHash", "varianceHash", "reviewEvidenceHash", "reviewerRecordHash", "qualityGraderRecordHash"].every((key) => isHash(reviewHashes[key])))
            return false;
    }
    const seen = new Set();
    return value.trials.length > 0 && value.trials.every((trial) => {
        if (!isEvalTrial(trial) || !hasAcceptedTrialEvidence(trial))
            return false;
        if (seen.has(trial.id) || !caseIds.includes(trial.caseId))
            return false;
        seen.add(trial.id);
        return trial.bundleVersion === value.bundleVersion
            && trial.promptHash === promptHashes[trial.lane]
            && trial.modelConfig.comparisonKey === baselineModelConfig.comparisonKey
            && trial.generationRecord?.codexProvenance.tokenMetric === value.tokenMetric;
    });
}
function sha256Json(value) {
    return (0, node_crypto_1.createHash)("sha256").update(JSON.stringify(value)).digest("hex");
}
function sha256Text(value) {
    return (0, node_crypto_1.createHash)("sha256").update(value, "utf8").digest("hex");
}
function evaluateBudget(input) {
    const unavailableCode = input.kind === "token" ? "PROMOTION_TOKEN_USAGE_UNAVAILABLE" : "PROMOTION_TIME_USAGE_UNAVAILABLE";
    const exceededCode = input.kind === "token" ? "PROMOTION_TOKEN_BUDGET_EXCEEDED" : "PROMOTION_TIME_BUDGET_EXCEEDED";
    const missingCode = input.kind === "token" ? "PROMOTION_TOKEN_BUDGET_MISSING" : "PROMOTION_TIME_BUDGET_MISSING";
    if (input.limit === null)
        return { ...input, observation: "unavailable", outcome: "inconclusive", errorCode: missingCode };
    if (input.value === null || !Number.isFinite(input.value)) {
        return { ...input, observation: "unavailable", outcome: input.policy === "required" ? "inconclusive" : "advisory", errorCode: unavailableCode };
    }
    if (input.value > input.limit)
        return { ...input, observation: "exceeded", outcome: "rejected", errorCode: exceededCode };
    return { ...input, observation: "within", outcome: "within", errorCode: null };
}
function aggregateBudget(values, kind, limit, policy) {
    const evaluations = values.map((value) => evaluateBudget({ kind, value, limit, policy }));
    if (evaluations.some((item) => item.observation === "exceeded"))
        return evaluations.find((item) => item.observation === "exceeded");
    if (evaluations.some((item) => item.observation === "unavailable"))
        return evaluations.find((item) => item.observation === "unavailable");
    return evaluations[0] ?? evaluateBudget({ kind, value: null, limit, policy });
}
function summarizeScores(trials) {
    const passed = trials.filter((trial) => trial.contractStatus === "passed").length;
    const dimensionIds = new Set();
    for (const trial of trials)
        for (const id of Object.keys(trial.quality))
            dimensionIds.add(id);
    const dimensions = {};
    for (const id of dimensionIds) {
        const values = trials.map((trial) => trial.quality[id]).filter((value) => typeof value === "number");
        const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
        const variance = mean === null ? null : values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
        dimensions[id] = { mean, stddev: variance === null ? null : Math.sqrt(variance), unknownCount: trials.length - values.length };
    }
    const numeric = (key) => trials.map((trial) => trial[key]).filter((value) => typeof value === "number");
    const summarize = (values) => {
        if (values.length === 0)
            return { mean: null, stddev: null };
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        return { mean, stddev: Math.sqrt(values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length) };
    };
    return {
        passRate: trials.length ? passed / trials.length : null,
        dimensions,
        durationMs: summarize(numeric("durationMs")),
        tokenCount: summarize(numeric("tokenCount")),
        failures: trials.filter((trial) => trial.contractStatus === "blocked").map((trial) => trial.validationArtifact),
    };
}
const REQUIRED_DIMENSIONS = {
    "report-synthesis": ["evidence_grounding", "aha_relevance", "non_duplication", "uncertainty"],
    "key-session-analysis": ["scope_binding", "mechanism", "actionability", "unknown_calibration"],
    "skill-insights": ["snapshot_binding", "content_contrast", "decision_delta", "uncertainty"],
};
function hasRealTrialEvidence(trial) {
    return Boolean(isHash(trial.outputHash)
        && typeof trial.outputArtifact === "string" && trial.outputArtifact.length > 0
        && typeof trial.validationArtifact === "string" && trial.validationArtifact.length > 0
        && trial.generationRecord !== null
        && trial.generationRecord.caseId === trial.caseId
        && trial.generationRecord.lane === trial.lane
        && trial.generationRecord.role === trial.role
        && trial.generationRecord.inputHash === trial.inputHash
        && trial.generationRecord.promptHash === trial.promptHash
        && trial.generationRecord.outputHash === trial.outputHash
        && trial.generationRecord.modelComparisonKey === trial.modelConfig.comparisonKey
        && Date.parse(trial.generationRecord.observed.startedAt) <= Date.parse(trial.generationRecord.observed.endedAt)
        && typeof trial.experimentId === "string" && trial.experimentId.length > 0
        && Number.isInteger(trial.attempt) && trial.attempt >= 1
        && trial.contractStatus === "passed");
}
function hasAcceptedTrialEvidence(trial) {
    return Boolean(hasRealTrialEvidence(trial)
        && Object.values(trial.quality).length > 0
        && Object.values(trial.quality).every((score) => typeof score === "number" && score >= 0 && score <= 1));
}
function trialShapeErrors(trials, role, experiment) {
    const errors = [];
    for (const trial of trials) {
        if (trial.role !== role)
            errors.push("PROMOTION_TRIAL_ROLE_MISMATCH");
        if (!isHash(trial.promptHash))
            errors.push("PROMOTION_PROMPT_HASH_INVALID");
        if (role === "baseline" && trial.promptHash !== experiment.baselinePromptHash)
            errors.push("PROMOTION_BASELINE_PROMPT_HASH_MISMATCH");
        if (role === "candidate" && trial.promptHash !== experiment.candidatePromptHash)
            errors.push("PROMOTION_CANDIDATE_PROMPT_HASH_MISMATCH");
        if (isGenerationRecord(trial.generationRecord) && trial.generationRecord.codexProvenance.tokenMetric !== experiment.tokenMetric)
            errors.push("PROMOTION_TOKEN_METRIC_MISMATCH");
        if (!hasRealTrialEvidence(trial))
            errors.push("PROMOTION_TRIAL_EVIDENCE_MISSING");
    }
    return errors;
}
function dimensionErrors(trials, rubric, prefix) {
    const errors = [];
    const required = new Map(rubric.dimensions.map((dimension) => [dimension.id, dimension]));
    for (const trial of trials) {
        for (const dimension of rubric.dimensions) {
            const score = trial.quality[dimension.id];
            if (score === undefined)
                errors.push(`${prefix}_RUBRIC_DIMENSION_MISSING:${dimension.id}`);
            else if (score === "unknown")
                errors.push(`${prefix}_RUBRIC_DIMENSION_UNKNOWN:${dimension.id}`);
            else if (typeof score !== "number" || score < (dimension.minimumScore ?? 0) || score > 1)
                errors.push(`${prefix}_RUBRIC_DIMENSION_BELOW_MINIMUM:${dimension.id}`);
            const evidence = trial.qualityEvidence?.[dimension.id];
            if (!Array.isArray(evidence) || evidence.length === 0)
                errors.push(`${prefix}_RUBRIC_EVIDENCE_MISSING:${dimension.id}`);
        }
        for (const id of Object.keys(trial.quality))
            if (!required.has(id))
                errors.push(`${prefix}_RUBRIC_DIMENSION_UNDECLARED:${id}`);
    }
    return errors;
}
function mustNotRegressErrors(experiment, baselineSummary, candidateSummary) {
    const errors = [];
    for (const dimensionId of experiment.mustNotRegress) {
        const baseline = baselineSummary.dimensions[dimensionId];
        const candidate = candidateSummary.dimensions[dimensionId];
        if (!baseline || baseline.mean === null) {
            errors.push(`PROMOTION_MUST_NOT_REGRESS_BASELINE_MISSING:${dimensionId}`);
        }
        else if (!candidate || candidate.mean === null || candidate.unknownCount > 0) {
            errors.push(`PROMOTION_MUST_NOT_REGRESS_CANDIDATE_MISSING:${dimensionId}`);
        }
        else if (candidate.mean < baseline.mean) {
            errors.push(`PROMOTION_MUST_NOT_REGRESS:${dimensionId}`);
        }
    }
    return errors;
}
function unique(values) {
    return [...new Set(values)];
}
function coverageErrors(experiment, cases, baseline, candidate, minimumTrials) {
    const errors = [];
    const caseMap = new Map(cases.map((item) => [item.id, item]));
    const expectedIds = unique(experiment.caseIds);
    if (expectedIds.length !== experiment.caseIds.length)
        errors.push("PROMOTION_DUPLICATE_CASE_ID");
    for (const caseId of expectedIds) {
        const evalCase = caseMap.get(caseId);
        if (!evalCase) {
            errors.push(`PROMOTION_CASE_MISSING:${caseId}`);
            continue;
        }
        if (evalCase.lane !== experiment.lane)
            errors.push(`PROMOTION_CASE_LANE_MISMATCH:${caseId}`);
        const base = baseline.filter((trial) => trial.caseId === caseId);
        const cand = candidate.filter((trial) => trial.caseId === caseId);
        if (base.length < minimumTrials)
            errors.push(`PROMOTION_BASELINE_TRIALS_MISSING:${caseId}`);
        if (cand.length < minimumTrials)
            errors.push(`PROMOTION_CANDIDATE_TRIALS_MISSING:${caseId}`);
        for (const trial of [...base, ...cand]) {
            if (trial.inputHash !== evalCase.inputHash)
                errors.push(`PROMOTION_INPUT_HASH_MISMATCH:${caseId}`);
        }
        if (evalCase.split === "held-out" && cand.length < minimumTrials)
            errors.push(`PROMOTION_HELD_OUT_TRIAL_MISSING:${caseId}`);
    }
    for (const trial of [...baseline, ...candidate])
        if (!expectedIds.includes(trial.caseId))
            errors.push(`PROMOTION_UNDECLARED_CASE:${trial.caseId}`);
    const developmentInputs = new Set(cases.filter((item) => item.split !== "held-out").map((item) => item.inputHash));
    for (const item of cases.filter((item) => item.split === "held-out")) {
        if (developmentInputs.has(item.inputHash))
            errors.push(`PROMOTION_HELD_OUT_INPUT_NOT_DISTINCT:${item.id}`);
    }
    return errors;
}
function generationUniquenessErrors(trials, prefix) {
    const errors = [];
    const executions = new Set();
    const sources = new Set();
    for (const trial of trials) {
        const record = trial.generationRecord;
        if (!record)
            continue;
        if (executions.has(record.executionId))
            errors.push(`${prefix}_GENERATION_RECORD_DUPLICATE:${record.executionId}`);
        executions.add(record.executionId);
        if (sources.has(record.sourceReference))
            errors.push(`${prefix}_GENERATION_SOURCE_DUPLICATE:${record.sourceReference}`);
        sources.add(record.sourceReference);
    }
    return errors;
}
function baselineErrors(experiment, accepted, baseline) {
    const errors = [];
    const acceptedHash = accepted.promptHashes[experiment.lane];
    if (!isHash(acceptedHash) || acceptedHash !== experiment.baselinePromptHash)
        errors.push("PROMOTION_ACCEPTED_BASELINE_HASH_MISMATCH");
    if (experiment.baselinePromptHash === "0".repeat(64))
        errors.push("PROMOTION_BASELINE_HASH_ZERO");
    if (experiment.candidatePromptHash === experiment.baselinePromptHash)
        errors.push("PROMOTION_PROMPT_HASH_UNCHANGED");
    if (!isHash(experiment.candidatePromptHash))
        errors.push("PROMOTION_CANDIDATE_HASH_INVALID");
    const acceptedByCase = new Map();
    for (const trial of accepted.trials.filter((item) => item.lane === experiment.lane)) {
        const entries = acceptedByCase.get(trial.caseId) ?? [];
        entries.push(trial);
        acceptedByCase.set(trial.caseId, entries);
    }
    for (const trial of baseline) {
        const acceptedTrials = acceptedByCase.get(trial.caseId) ?? [];
        const accepted = acceptedTrials.some((acceptedTrial) => acceptedTrial.outputHash === trial.outputHash
            && acceptedTrial.inputHash === trial.inputHash
            && acceptedTrial.promptHash === trial.promptHash);
        if (!accepted) {
            errors.push(`PROMOTION_BASELINE_NOT_ACCEPTED:${trial.caseId}`);
        }
    }
    return errors;
}
function comparabilityErrors(experiment, baseline, candidate) {
    const errors = [];
    const sameConfig = (trial) => JSON.stringify(trial.modelConfig) === JSON.stringify(experiment.modelConfig);
    if (baseline.some((trial) => !sameConfig(trial)))
        errors.push("PROMOTION_BASELINE_MODEL_CONFIG_MISMATCH");
    if (candidate.some((trial) => !sameConfig(trial)))
        errors.push("PROMOTION_CANDIDATE_MODEL_CONFIG_MISMATCH");
    const baseKeys = new Set(baseline.map((trial) => trial.modelConfig.comparisonKey));
    const candidateKeys = new Set(candidate.map((trial) => trial.modelConfig.comparisonKey));
    if (baseKeys.size !== 1 || !baseKeys.has(experiment.modelConfig.comparisonKey))
        errors.push("PROMOTION_BASELINE_MODEL_NOT_COMPARABLE");
    if (candidateKeys.size !== 1 || !candidateKeys.has(experiment.modelConfig.comparisonKey))
        errors.push("PROMOTION_CANDIDATE_MODEL_NOT_COMPARABLE");
    if (baseKeys.size === 1 && candidateKeys.size === 1 && [...baseKeys][0] !== [...candidateKeys][0])
        errors.push("PROMOTION_MODEL_COMPARISON_KEY_MISMATCH");
    return errors;
}
function outputDifferenceErrors(baseline, candidate) {
    const errors = [];
    const baseByCase = new Map();
    const candidateByCase = new Map();
    for (const trial of baseline)
        if (trial.outputHash)
            (baseByCase.get(trial.caseId) ?? baseByCase.set(trial.caseId, new Set()).get(trial.caseId)).add(trial.outputHash);
    for (const trial of candidate)
        if (trial.outputHash)
            (candidateByCase.get(trial.caseId) ?? candidateByCase.set(trial.caseId, new Set()).get(trial.caseId)).add(trial.outputHash);
    const changed = [...baseByCase.keys()].some((caseId) => {
        const left = [...(baseByCase.get(caseId) ?? [])].sort();
        const right = [...(candidateByCase.get(caseId) ?? [])].sort();
        return JSON.stringify(left) !== JSON.stringify(right);
    });
    if (!changed)
        errors.push("PROMOTION_NO_OUTPUT_DIFFERENCE");
    return errors;
}
function reviewExperiment(experiment, baseline, candidate, artifactPath, reviewer = null, heldOutAvailable = candidate.length > 0, gate) {
    const minimumTrials = exports.PROMOTION_MINIMUM_TRIALS;
    const blockingFailures = candidate.filter((trial) => trial.contractStatus !== "passed").map((trial) => trial.validationArtifact);
    const baselineSummary = summarizeScores(baseline);
    const candidateSummary = summarizeScores(candidate);
    const baselineMean = baselineSummary.dimensions[experiment.targetDimension]?.mean ?? null;
    const candidateMean = candidateSummary.dimensions[experiment.targetDimension]?.mean ?? null;
    const minimumImprovementDelta = exports.PROMOTION_MINIMUM_IMPROVEMENT_DELTA;
    const candidateImproved = baselineMean !== null && candidateMean !== null && candidateMean - baselineMean >= minimumImprovementDelta;
    const regressionPassed = blockingFailures.length === 0 && candidateSummary.passRate !== null && candidateSummary.passRate === 1 && (baselineSummary.passRate === null || candidateSummary.passRate >= baselineSummary.passRate);
    const heldOutPassed = gate
        ? gate.cases.some((item) => item.id && item.split === "held-out" && candidate.some((trial) => trial.caseId === item.id && trial.contractStatus === "passed"))
        : heldOutAvailable && candidate.length > 0;
    const varianceResolved = Object.values(candidateSummary.dimensions).length > 0 && Object.values(candidateSummary.dimensions).every((dimension) => dimension.stddev !== null && dimension.stddev <= 0.25 && dimension.unknownCount === 0);
    const tokenBudget = aggregateBudget(candidate.map((trial) => trial.tokenCount), "token", experiment.tokenBudget, experiment.budgetEvidencePolicy);
    const timeBudget = aggregateBudget(candidate.map((trial) => trial.durationMs), "time", experiment.timeBudgetMs, experiment.budgetEvidencePolicy);
    const budgetPassed = tokenBudget.outcome !== "rejected" && tokenBudget.outcome !== "inconclusive";
    const timeBudgetPassed = timeBudget.outcome !== "rejected" && timeBudget.outcome !== "inconclusive";
    const gateErrors = gate
        ? [
            ...baselineErrors(experiment, gate.acceptedBaseline, baseline),
            ...coverageErrors(experiment, gate.cases, baseline, candidate, minimumTrials),
            ...comparabilityErrors(experiment, baseline, candidate),
            ...outputDifferenceErrors(baseline, candidate),
            ...mustNotRegressErrors(experiment, baselineSummary, candidateSummary),
            ...(tokenBudget.errorCode && (tokenBudget.observation === "exceeded" || tokenBudget.policy === "required" || tokenBudget.errorCode.endsWith("_BUDGET_MISSING")) ? [tokenBudget.errorCode] : []),
            ...(timeBudget.errorCode && (timeBudget.observation === "exceeded" || timeBudget.policy === "required" || timeBudget.errorCode.endsWith("_BUDGET_MISSING")) ? [timeBudget.errorCode] : []),
            ...trialShapeErrors(baseline, "baseline", experiment),
            ...trialShapeErrors(candidate, "candidate", experiment),
            ...generationUniquenessErrors(baseline, "PROMOTION_BASELINE"),
            ...generationUniquenessErrors(candidate, "PROMOTION_CANDIDATE"),
            ...generationUniquenessErrors([...baseline, ...candidate], "PROMOTION_COMBINED"),
            ...gate.cases.filter((item) => item.id && item.lane === experiment.lane).flatMap((item) => {
                const rubric = gate.rubrics.find((value) => value.id === item.rubricId);
                if (!rubric)
                    return [`PROMOTION_RUBRIC_MISSING:${item.rubricId}`];
                const expected = REQUIRED_DIMENSIONS[experiment.lane];
                const dimensionIds = new Set(rubric.dimensions.map((dimension) => dimension.id));
                return [
                    ...expected.filter((id) => !dimensionIds.has(id)).map((id) => `PROMOTION_RUBRIC_DIMENSION_MISSING:${id}`),
                    ...dimensionErrors(baseline.filter((trial) => trial.caseId === item.id), rubric, "PROMOTION_BASELINE"),
                    ...dimensionErrors(candidate.filter((trial) => trial.caseId === item.id), rubric, "PROMOTION_CANDIDATE"),
                ];
            }),
            ...(reviewer ? [] : ["PROMOTION_REVIEWER_MISSING"]),
            ...(gate.reviewEvidenceHash && isHash(gate.reviewEvidenceHash) ? [] : ["PROMOTION_REVIEW_EVIDENCE_MISSING"]),
            ...(gate.qualityGraderRecordHash && isHash(gate.qualityGraderRecordHash) ? [] : ["PROMOTION_QUALITY_GRADER_RECORD_MISSING"]),
            ...(gate.optimizerRecordHash && isHash(gate.optimizerRecordHash) ? [] : ["PROMOTION_OPTIMIZER_RECORD_MISSING"]),
        ]
        : [
            ...trialShapeErrors(baseline, "baseline", experiment),
            ...trialShapeErrors(candidate, "candidate", experiment),
            ...generationUniquenessErrors(baseline, "PROMOTION_BASELINE"),
            ...generationUniquenessErrors(candidate, "PROMOTION_CANDIDATE"),
            ...generationUniquenessErrors([...baseline, ...candidate], "PROMOTION_COMBINED"),
            ...REQUIRED_DIMENSIONS[experiment.lane].flatMap((id) => baseline.some((trial) => trial.quality[id] === undefined) || candidate.some((trial) => trial.quality[id] === undefined) ? [`PROMOTION_RUBRIC_DIMENSION_MISSING:${id}`] : []),
            ...outputDifferenceErrors(baseline, candidate),
        ];
    const allErrors = unique(gateErrors);
    const approved = allErrors.length === 0 && regressionPassed && heldOutPassed && varianceResolved && budgetPassed && timeBudgetPassed && candidateImproved && reviewer !== null;
    const requiredUnavailable = (tokenBudget.observation === "unavailable" || timeBudget.observation === "unavailable") && experiment.budgetEvidencePolicy === "required";
    const conclusion = approved
        ? "eligible"
        : requiredUnavailable
            ? "inconclusive"
            : gate === undefined && reviewer === null
                ? "inconclusive"
                : allErrors.some((item) => item.startsWith("PROMOTION_") && !item.includes("VARIANCE")) || blockingFailures.length > 0 || !regressionPassed || !budgetPassed || !timeBudgetPassed
                    ? "rejected"
                    : "inconclusive";
    return {
        version: exports.EVAL_CONTRACT_VERSION,
        experimentId: experiment.id,
        candidatePromptHash: experiment.candidatePromptHash,
        regressionPassed,
        heldOutPassed,
        varianceResolved,
        budgetPassed,
        timeBudgetPassed,
        blockingFailures,
        candidateImproved,
        reviewer,
        approved,
        conclusion,
        artifactPath,
        gateErrors: allErrors,
        reviewEvidenceHash: gate?.reviewEvidenceHash ?? null,
        reviewArtifactHash: null,
        reviewerApprovalHash: null,
        qualityGraderRecordHash: gate?.qualityGraderRecordHash ?? null,
        optimizerRecordHash: gate?.optimizerRecordHash ?? null,
        tokenBudgetObservation: tokenBudget.observation,
        timeBudgetObservation: timeBudget.observation,
        budgetLimitations: [tokenBudget, timeBudget].filter((item) => item.observation === "unavailable" && item.errorCode).map((item) => item.errorCode),
        createdAt: new Date().toISOString(),
    };
}
function reviewArtifactBindingHash(artifact) {
    const review = isRecord(artifact.review) ? { ...artifact.review, reviewArtifactHash: null, reviewerApprovalHash: null } : null;
    return sha256Json({ ...artifact, review });
}
function makeOptimizerProposal(revision, hypothesis, failedDimensions, evidence) {
    if (!Number.isInteger(revision) || revision < 1 || revision > 3)
        throw new Error("Optimizer revisions are bounded to one through three.");
    const dimensions = [...new Set(failedDimensions)].slice(0, 8);
    return {
        revision,
        hypothesis,
        singleChange: `Change only the Prompt behavior that addresses: ${dimensions.join(", ") || "the observed failed dimension"}.`,
        failedDimensions: dimensions,
        evidence: evidence.slice(0, 8),
        createdAt: new Date().toISOString(),
    };
}
