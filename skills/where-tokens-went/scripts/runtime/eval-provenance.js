"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGenerationIndex = createGenerationIndex;
exports.createRoleIndex = createRoleIndex;
const codex_provenance_1 = require("./codex-provenance");
function executionId(sessionId, threadId, turnId, responseItemId) {
    return `codex:${sessionId}:${threadId}:${turnId}:${responseItemId}`;
}
async function createGenerationIndex(input) {
    const provenance = await (0, codex_provenance_1.resolveCodexProvenance)({ ...input.provenance, rawOutput: input.rawOutput });
    return {
        version: 1,
        kind: "host-agent-generation",
        executionId: executionId(provenance.sessionId, provenance.threadId, provenance.turnId, provenance.responseItemId),
        caseId: input.caseId,
        lane: input.lane,
        role: input.role,
        inputHash: input.inputHash,
        promptHash: input.promptHash,
        outputHash: provenance.outputHash,
        modelComparisonKey: input.modelComparisonKey,
        producerContext: { role: "generator", contextId: provenance.threadId, host: "codex" },
        observed: { startedAt: provenance.startedAt, endedAt: provenance.endedAt, usage: provenance.usage },
        codexProvenance: provenance,
        sourceReference: provenance.rolloutPath,
        sourceReferenceHash: provenance.rolloutHash,
    };
}
async function createRoleIndex(input) {
    const provenance = await (0, codex_provenance_1.resolveCodexProvenance)({ ...input.provenance, rawOutput: input.rawOutput });
    const kind = input.role === "quality-grader"
        ? "host-agent-quality-grade"
        : input.role === "optimizer"
            ? "host-agent-optimizer"
            : "host-agent-reviewer";
    return {
        version: 1,
        kind,
        executionId: executionId(provenance.sessionId, provenance.threadId, provenance.turnId, provenance.responseItemId),
        role: input.role,
        contextId: provenance.threadId,
        host: "codex",
        outputHash: provenance.outputHash,
        codexProvenance: provenance,
        sourceReference: provenance.rolloutPath,
        sourceReferenceHash: provenance.rolloutHash,
    };
}
