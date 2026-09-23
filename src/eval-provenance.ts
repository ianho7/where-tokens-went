import { resolveCodexProvenance, type CodexResponseLocator } from "./codex-provenance";
import type { EvalLane, GenerationRecord, RoleExecutionRecord } from "./eval-contract";

export interface GenerationIndexInput {
  caseId: string;
  lane: EvalLane;
  role: "baseline" | "candidate";
  inputHash: string;
  promptHash: string;
  modelComparisonKey: string;
  rawOutput: string;
  provenance: CodexResponseLocator;
}

export interface RoleIndexInput {
  role: RoleExecutionRecord["role"];
  rawOutput: string;
  provenance: CodexResponseLocator;
}

function executionId(sessionId: string, threadId: string, turnId: string, responseItemId: string): string {
  return `codex:${sessionId}:${threadId}:${turnId}:${responseItemId}`;
}

export async function createGenerationIndex(input: GenerationIndexInput): Promise<GenerationRecord> {
  const provenance = await resolveCodexProvenance({ ...input.provenance, rawOutput: input.rawOutput });
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

export async function createRoleIndex(input: RoleIndexInput): Promise<RoleExecutionRecord> {
  const provenance = await resolveCodexProvenance({ ...input.provenance, rawOutput: input.rawOutput });
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
