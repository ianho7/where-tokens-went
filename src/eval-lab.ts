import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { validateKeySessionAnalysis, validateReportSynthesis } from "./key-session-analysis";
import { validateSkillInsights } from "./skill-insights";
import type { AuditResult, ContentEvidencePacket, KeySessionAnalysis, ReportSynthesis, SkillSnapshotArtifact } from "./types";
import { resolveCodexProvenance } from "./codex-provenance";
import {
  EVAL_CONTRACT_VERSION,
  type ContractGrade,
  type EvalCase,
  type EvalLane,
  type EvalModelConfig,
  type EvalPrivacy,
  type EvalTrial,
  isGenerationRecord,
  isEvalCase,
  sha256Text,
} from "./eval-contract";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function outputHash(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function readEvalCase(casePath: string): Promise<EvalCase> {
  const value = await readJson(casePath);
  if (!isEvalCase(value)) throw new Error("Eval Case does not satisfy the executable contract.");
  return value;
}

export async function checkEvalInput(evalCase: EvalCase, inputPath: string): Promise<{ input: unknown; inputHash: string }> {
  const raw = await readFile(inputPath, "utf8");
  const inputHash = sha256Text(raw);
  if (inputHash.toLowerCase() !== evalCase.inputHash.toLowerCase()) throw new Error(`Eval Case input hash mismatch for ${evalCase.id}.`);
  return { input: JSON.parse(raw), inputHash };
}

function error(code: string, message: string, fieldPath: string | null = null): { code: string; fieldPath: string | null; message: string } {
  return { code, fieldPath, message };
}

export function gradeLaneOutput(
  evalCase: EvalCase,
  input: unknown,
  rawOutput: unknown,
): ContractGrade {
  const errors: Array<{ code: string; fieldPath: string | null; message: string }> = [];
  let snapshotId: string | undefined;
  let skillInsightsAccepted = false;
  if (!isRecord(input)) errors.push(error("EVAL_INPUT_MALFORMED", "Frozen lane input must be an object."));
  if (evalCase.lane === "skill-insights") {
    const snapshot = input as SkillSnapshotArtifact;
    if (!snapshot || typeof snapshot.snapshotId !== "string") errors.push(error("EVAL_SNAPSHOT_MISSING", "Skill Insights requires an immutable snapshotId.", "snapshotId"));
    else {
      snapshotId = snapshot.snapshotId;
      const result = validateSkillInsights(rawOutput, snapshot);
      // Card-level errors describe filtered cards. A non-empty valid result
      // matches the Report Run path; these diagnostics do not block other cards.
      for (const message of result.errors) errors.push(error(message.includes("snapshotId") ? "EVAL_SNAPSHOT_MISMATCH" : "SKILL_INSIGHTS_INVALID", message));
      skillInsightsAccepted = result.valid && result.insights.length > 0;
    }
  } else if (!isRecord(input) || !isRecord(input.audit)) {
    errors.push(error("EVAL_INPUT_UNSUPPORTED", "This lane requires a frozen input object containing AuditResult under audit."));
  } else if (evalCase.lane === "report-synthesis") {
    const result = validateReportSynthesis(input.audit as unknown as AuditResult, rawOutput as ReportSynthesis);
    for (const message of result.errors) errors.push(error("REPORT_SYNTHESIS_INVALID", message));
  } else {
    const packets = Array.isArray(input.evidence) ? input.evidence as ContentEvidencePacket[] : [];
    const candidates = Array.isArray(rawOutput) ? rawOutput as KeySessionAnalysis[] : [];
    if (candidates.length === 0) errors.push(error("KEY_SESSION_INVALID", "Expected at least one Key Session Analysis."));
    for (const [index, candidate] of candidates.entries()) {
      const result = validateKeySessionAnalysis(input.audit as unknown as AuditResult, candidate, packets.filter((packet) => packet.sessionId === candidate.sessionId));
      for (const message of result.errors) errors.push(error("KEY_SESSION_INVALID", message, `[${index}]`));
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

export interface EvalTrialOptions {
  casePath: string;
  inputPath?: string;
  rawOutput: string;
  role: "baseline" | "candidate";
  promptHash: string;
  bundleVersion: string;
  modelConfig: EvalModelConfig;
  artifactDir: string;
  durationMs?: number | null;
  tokenCount?: number | null;
  toolCallCount?: number | null;
  transcriptRef?: string | null;
  privacy?: EvalPrivacy;
  experimentId?: string;
  attempt?: number;
  trialId?: string;
  generationRecordPath?: string;
  promotionCritical?: boolean;
  tokenMetric?: "output_tokens" | "total_tokens";
}

export async function runEvalTrial(options: EvalTrialOptions): Promise<EvalTrial> {
  const resolvedArtifactDir = path.resolve(options.artifactDir);
  const repoRoot = path.resolve(process.cwd());
  const relativeScratchDir = path.relative(path.resolve(repoRoot, ".scratch"), resolvedArtifactDir);
  const relativeTempDir = path.relative(path.resolve(os.tmpdir()), resolvedArtifactDir);
  const underScratch = relativeScratchDir === "" || (!relativeScratchDir.startsWith("..") && !path.isAbsolute(relativeScratchDir));
  const underTemp = relativeTempDir === "" || (!relativeTempDir.startsWith("..") && !path.isAbsolute(relativeTempDir));
  if (!underScratch && !underTemp) throw new Error("EVAL_ARTIFACT_DIR_NOT_LOCAL");
  const evalCase = await readEvalCase(options.casePath);
  const inputPath = options.inputPath ?? path.resolve(evalCase.inputArtifact);
  const { input, inputHash } = await checkEvalInput(evalCase, inputPath);
  let parsedOutput: unknown;
  let parseError: string | null = null;
  try {
    parsedOutput = JSON.parse(options.rawOutput);
  } catch {
    parsedOutput = null;
    parseError = "MODEL_OUTPUT_INVALID_JSON";
  }
  const grade = parseError
    ? { ...gradeLaneOutput(evalCase, input, null), status: "blocked" as const, errors: [error(parseError, "Model output was not valid JSON.")] }
    : gradeLaneOutput(evalCase, input, parsedOutput);
  if (options.promotionCritical && evalCase.lane === "skill-insights" && isRecord(parsedOutput) && Array.isArray(parsedOutput.insights) && parsedOutput.insights.length === 0) {
    grade.status = "blocked";
    grade.errors.push(error("SKILL_INSIGHTS_EMPTY", "Promotion-critical Skill Insights output must contain non-empty capability content."));
  }
  grade.outputHash = outputHash(options.rawOutput);
  let generationRecord: import("./eval-contract").GenerationRecord | null = null;
  if (options.promotionCritical || options.generationRecordPath) {
    if (!options.generationRecordPath) throw new Error("EVAL_GENERATION_PROVENANCE_REQUIRED");
    const generationPath = path.resolve(options.generationRecordPath);
    const generationRaw = await readFile(generationPath, "utf8");
    let parsedGeneration: unknown;
    try {
      parsedGeneration = JSON.parse(generationRaw);
    } catch {
      throw new Error("EVAL_GENERATION_RECORD_UNPARSEABLE");
    }
    if (!isGenerationRecord(parsedGeneration)) throw new Error("EVAL_GENERATION_RECORD_INVALID");
    const indexRecord = parsedGeneration;
    if (indexRecord.caseId !== evalCase.id
      || indexRecord.lane !== evalCase.lane
      || indexRecord.role !== options.role
      || indexRecord.inputHash !== inputHash
      || indexRecord.promptHash !== options.promptHash
      || indexRecord.modelComparisonKey !== options.modelConfig.comparisonKey) {
      throw new Error("EVAL_GENERATION_RECORD_CONTEXT_MISMATCH");
    }
    const provenance = await resolveCodexProvenance({
      rolloutPath: indexRecord.codexProvenance.rolloutPath,
      sessionId: indexRecord.codexProvenance.sessionId,
      threadId: indexRecord.codexProvenance.threadId,
      turnId: indexRecord.codexProvenance.turnId,
      responseItemId: indexRecord.codexProvenance.responseItemId,
      rawOutput: options.rawOutput,
      tokenMetric: options.tokenMetric ?? indexRecord.codexProvenance.tokenMetric,
    }).catch((error) => {
      if (error instanceof Error && error.message.startsWith("CODEX_PROVENANCE_")) throw error;
      throw new Error("EVAL_GENERATION_SOURCE_UNRESOLVABLE");
    });
    if (provenance.outputHash !== grade.outputHash) throw new Error("EVAL_GENERATION_RECORD_BINDING_MISMATCH");
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
    if (grade.status !== "passed") throw new Error("EVAL_GENERATION_CONTRACT_BLOCKED");
  }
  const experimentId = options.experimentId ?? "standalone-eval";
  const attempt = options.attempt ?? 1;
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error("EVAL_TRIAL_ATTEMPT_INVALID");
  const trialId = options.trialId ?? randomUUID();
  const trialDir = path.join(resolvedArtifactDir, "experiments", experimentId, evalCase.id, options.role, `attempt-${attempt}-${trialId}`);
  await mkdir(trialDir, { recursive: true });
  const rawArtifact = path.join(trialDir, "output.raw.json");
  const validationArtifact = path.join(trialDir, "validation.json");
  const trialArtifact = path.join(trialDir, "trial.json");
  const writeImmutable = async (filePath: string, contents: string): Promise<void> => {
    await writeFile(filePath, contents, { encoding: "utf8", flag: "wx" });
  };
  await writeImmutable(rawArtifact, options.rawOutput);
  await writeImmutable(validationArtifact, JSON.stringify({ version: EVAL_CONTRACT_VERSION, ...grade, outputHash: grade.outputHash }, null, 2) + "\n");
  const trial: EvalTrial = {
    version: EVAL_CONTRACT_VERSION,
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
