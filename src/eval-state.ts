import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isEvalTrial, isGenerationRecord, isRoleExecutionRecord } from "./eval-contract";
import { resolveCodexProvenance } from "./codex-provenance";

export const EVAL_PHASES = [
  "freeze",
  "generator",
  "contract-grade",
  "blind-quality-grade",
  "optimize",
  "regression",
  "held-out",
  "review",
  "promote",
] as const;

export type EvalPhase = (typeof EVAL_PHASES)[number];

export interface EvalState {
  version: 1;
  experimentId: string;
  completed: EvalPhase[];
  nextLegalAction: EvalPhase | null;
  history: Array<{ phase: EvalPhase; completedAt: string; evidence: string[]; evidenceHashes?: Array<{ path: string; sha256: string }> }>;
}

const STATE_LOCK_TIMEOUT_MS = 5_000;
const STATE_LOCK_POLL_MS = 10;

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function withStateLock<T>(statePath: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = statePath + ".lock";
  const owner = JSON.stringify({ pid: process.pid, token: randomUUID() }) + "\n";
  const deadline = Date.now() + STATE_LOCK_TIMEOUT_MS;
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  while (!handle) {
    try {
      handle = await fs.open(lockPath, "wx");
      await handle.writeFile(owner, "utf8");
    } catch (error) {
      await handle?.close().catch(() => undefined);
      handle = null;
      if (!(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "EEXIST")) throw error;
      if (Date.now() >= deadline) {
        const timeout = new Error(`Eval state lock wait timed out after ${STATE_LOCK_TIMEOUT_MS}ms.`) as Error & { code: string };
        timeout.code = "EVAL_STATE_LOCK_TIMEOUT";
        throw timeout;
      }
      await sleep(STATE_LOCK_POLL_MS);
    }
  }
  try {
    return await operation();
  } finally {
    await handle.close().catch(() => undefined);
    try {
      if (await fs.readFile(lockPath, "utf8") === owner) await fs.unlink(lockPath);
    } catch {
      // Never remove an uncertain owner lock.
    }
  }
}

function isPhase(value: unknown): value is EvalPhase {
  return typeof value === "string" && (EVAL_PHASES as readonly string[]).includes(value);
}

function isState(value: unknown): value is EvalState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || typeof candidate.experimentId !== "string"
    || !Array.isArray(candidate.completed) || !candidate.completed.every(isPhase)
    || (candidate.nextLegalAction !== null && !isPhase(candidate.nextLegalAction))
    || !Array.isArray(candidate.history)) return false;
  return candidate.history.every((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const record = entry as Record<string, unknown>;
    const evidenceHashes = record.evidenceHashes;
    return isPhase(record.phase) && typeof record.completedAt === "string"
      && Array.isArray(record.evidence) && record.evidence.every((item: unknown) => typeof item === "string")
      && (evidenceHashes === undefined || (Array.isArray(evidenceHashes) && evidenceHashes.every((item: unknown) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return false;
        const hash = item as Record<string, unknown>;
        return typeof hash.path === "string" && typeof hash.sha256 === "string" && /^[a-f0-9]{64}$/i.test(hash.sha256);
      })));
  });
}

async function readState(statePath: string, experimentId: string): Promise<EvalState> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(statePath, "utf8"));
    if (!isState(parsed) || parsed.experimentId !== experimentId) throw new Error("EVAL_STATE_INVALID");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, experimentId, completed: [], nextLegalAction: "freeze", history: [] };
    }
    if (error instanceof Error && error.message === "EVAL_STATE_INVALID") throw error;
    throw new Error("EVAL_STATE_UNPARSEABLE");
  }
}

async function writeState(statePath: string, state: EvalState): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const temporary = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(state, null, 2) + "\n", "utf8");
  await fs.rename(temporary, statePath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function phaseEvidenceIsGradeable(action: EvalPhase, evidence: string[]): Promise<boolean> {
  if (action === "freeze") return evidence.length === 0;
  if (evidence.length === 0) return false;
  const values: unknown[] = [];
  for (const item of evidence) {
    try { values.push(JSON.parse(await fs.readFile(path.resolve(item), "utf8"))); } catch { return false; }
  }
  const flattened = values.flatMap((value) => Array.isArray(value) ? value : [value]);
  const generationIsReal = async (value: unknown): Promise<boolean> => {
    const record = isGenerationRecord(value)
      ? value
      : isRecord(value) && isGenerationRecord(value.generationRecord)
        ? value.generationRecord
        : null;
    if (!record) return false;
    const observed = await resolveCodexProvenance({
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
  const roleIsReal = async (value: unknown, role: "quality-grader" | "optimizer" | "reviewer"): Promise<boolean> => {
    if (!isRoleExecutionRecord(value, role)) return false;
    const observed = await resolveCodexProvenance({
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
      if (values.length === 0) return false;
      for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (!isRecord(value) || value.status !== "passed" || typeof value.caseId !== "string" || typeof value.inputHash !== "string" || typeof value.outputHash !== "string") return false;
        try {
          const trial = JSON.parse(await fs.readFile(path.join(path.dirname(path.resolve(evidence[index])), "trial.json"), "utf8")) as unknown;
          if (!isEvalTrial(trial) || trial.caseId !== value.caseId || trial.inputHash !== value.inputHash || trial.outputHash !== value.outputHash || !await generationIsReal(trial)) return false;
        } catch {
          // A validation record without its real trial is not state evidence.
          return false;
        }
      }
      return true;
    case "blind-quality-grade":
      return flattened.length > 0 && (await Promise.all(flattened.map((value) => roleIsReal(value, "quality-grader")))).every(Boolean);
    case "optimize":
      return flattened.length > 0 && (await Promise.all(flattened.map(async (value) => {
        if (await roleIsReal(value, "optimizer")) return true;
        return isRecord(value) && await roleIsReal(value.optimizerRecord, "optimizer");
      }))).every(Boolean);
    case "regression":
    case "held-out":
      {
        const trials = flattened.flatMap((value) => isEvalTrial(value) ? [value] : isRecord(value) && Array.isArray(value.trials) ? value.trials.filter(isEvalTrial) : []);
        return trials.length >= 3 && (await Promise.all(trials.map(generationIsReal))).every(Boolean);
      }
    case "review":
      {
        const reviewArtifact = values.map((value) => isRecord(value) && isRecord(value.review) && typeof value.review.reviewArtifactHash === "string" && isRecord(value.reviewerRecord) ? value : null).find((value) => value !== null);
        if (!reviewArtifact) return false;
        const reviewerRecord = reviewArtifact.reviewerRecord as Record<string, unknown>;
        if (typeof reviewerRecord.recordPath !== "string" || typeof reviewerRecord.hash !== "string") return false;
        let reviewerIsReal = false;
        try {
          const recordRaw = await fs.readFile(path.resolve(reviewerRecord.recordPath), "utf8");
          const record = JSON.parse(recordRaw) as unknown;
          reviewerIsReal = await roleIsReal(record, "reviewer") && reviewerRecord.hash === createHash("sha256").update(recordRaw).digest("hex");
        } catch {
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

export async function advanceEvalState(statePath: string, experimentId: string, action: EvalPhase, evidence: string[] = []): Promise<{ state: EvalState; reused: boolean }> {
  const resolved = path.resolve(statePath);
  return withStateLock(resolved, async () => {
    const current = await readState(resolved, experimentId);
    if (current.completed.includes(action)) return { state: current, reused: true };
    if (current.nextLegalAction !== action) throw new Error(`EVAL_STATE_ILLEGAL_ACTION:${action}:expected:${current.nextLegalAction ?? "complete"}`);
    if (!await phaseEvidenceIsGradeable(action, evidence)) throw new Error(`EVAL_STATE_EVIDENCE_NOT_PHASE_GRADEABLE:${action}`);
    const evidenceHashes: Array<{ path: string; sha256: string }> = [];
    for (const item of evidence) {
      const absolute = path.resolve(item);
      try {
        const bytes = await fs.readFile(absolute);
        evidenceHashes.push({ path: absolute, sha256: createHash("sha256").update(bytes).digest("hex") });
      } catch {
        throw new Error(`EVAL_STATE_EVIDENCE_UNRESOLVABLE:${item}`);
      }
    }
    const nextIndex = EVAL_PHASES.indexOf(action) + 1;
    const next = nextIndex < EVAL_PHASES.length ? EVAL_PHASES[nextIndex] : null;
    const state: EvalState = {
      ...current,
      completed: [...current.completed, action],
      nextLegalAction: next,
      history: [...current.history, { phase: action, completedAt: new Date().toISOString(), evidence: [...evidence], evidenceHashes }],
    };
    await writeState(resolved, state);
    return { state, reused: false };
  });
}

export async function readEvalState(statePath: string, experimentId: string): Promise<EvalState> {
  return readState(path.resolve(statePath), experimentId);
}
