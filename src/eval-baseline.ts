import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { isAcceptedBaseline, type AcceptedBaseline } from "./eval-contract";

export interface BaselineBootstrapReview {
  version: 1;
  kind: "accepted-baseline-bootstrap-review";
  conclusion: "accepted";
  reviewedTrialIds: string[];
  blindMapHash: string;
  gradesHash: string;
  varianceHash: string;
  reviewEvidenceHash: string;
  reviewerRecordHash: string;
  qualityGraderRecordHash: string;
}

export interface BaselineBootstrapOptions {
  outputPath: string;
  previousBaselinePath: string;
  previousBaselineHash: string;
  invalidationReason: string;
  review: BaselineBootstrapReview;
  currentPromptHashes: AcceptedBaseline["promptHashes"];
  candidatePromptPath?: string;
  candidatePromptHash?: string;
  baseline: AcceptedBaseline;
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

export function isBaselineBootstrapReview(review: unknown): review is BaselineBootstrapReview {
  if (!review || typeof review !== "object" || Array.isArray(review)) return false;
  const candidate = review as Partial<BaselineBootstrapReview>;
  return candidate.version === 1
    && candidate.kind === "accepted-baseline-bootstrap-review"
    && candidate.conclusion === "accepted"
    && Array.isArray(candidate.reviewedTrialIds)
    && candidate.reviewedTrialIds.length > 0
    && candidate.reviewedTrialIds.every((id) => typeof id === "string" && id.length > 0)
    && [candidate.blindMapHash, candidate.gradesHash, candidate.varianceHash, candidate.reviewEvidenceHash, candidate.reviewerRecordHash, candidate.qualityGraderRecordHash].every(isHash);
}

async function replaceJsonAtomically(filePath: string, contents: string): Promise<void> {
  const target = path.resolve(filePath);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, "utf8");
  try {
    try {
      await rename(temporary, target);
      return;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "EEXIST")) throw error;
    }
    const backup = `${target}.${process.pid}.${randomUUID()}.previous`;
    await rename(target, backup);
    try {
      await rename(temporary, target);
      await unlink(backup).catch(() => undefined);
    } catch (error) {
      await rename(backup, target).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    const wrapped = new Error(`Baseline atomic replacement failed for ${path.basename(target)}.`) as Error & { code: string; cause?: unknown };
    wrapped.code = "EVAL_BASELINE_ATOMIC_REPLACE_FAILED";
    wrapped.cause = error;
    throw wrapped;
  }
}

export async function bootstrapAcceptedBaseline(options: BaselineBootstrapOptions): Promise<AcceptedBaseline> {
  const previousPath = path.resolve(options.previousBaselinePath);
  const outputPath = path.resolve(options.outputPath);
  const previousBytes = await readFile(previousPath).catch(() => { throw new Error("EVAL_BASELINE_PREVIOUS_UNREADABLE"); });
  const previousHash = sha256(previousBytes);
  if (!isHash(options.previousBaselineHash) || previousHash !== options.previousBaselineHash) throw new Error("EVAL_BASELINE_PREVIOUS_HASH_MISMATCH");
  if (!options.invalidationReason.trim()) throw new Error("EVAL_BASELINE_INVALIDATION_REASON_REQUIRED");
  if (!isBaselineBootstrapReview(options.review)) throw new Error("EVAL_BASELINE_BOOTSTRAP_REVIEW_INVALID");
  const trialIds = options.baseline.trials.map((trial) => trial.id);
  if (new Set(trialIds).size !== trialIds.length || JSON.stringify([...trialIds].sort()) !== JSON.stringify([...options.review.reviewedTrialIds].sort())) throw new Error("EVAL_BASELINE_BOOTSTRAP_REVIEW_TRIAL_SET_MISMATCH");
  if (JSON.stringify(options.baseline.promptHashes) !== JSON.stringify(options.currentPromptHashes)) throw new Error("EVAL_BASELINE_BOOTSTRAP_PROMPT_CHANGED");
  if (!isAcceptedBaseline(options.baseline)) throw new Error("EVAL_BASELINE_BOOTSTRAP_BASELINE_INVALID");
  if (options.candidatePromptPath !== undefined || options.candidatePromptHash !== undefined) {
    if (!options.candidatePromptPath || !isHash(options.candidatePromptHash)) throw new Error("EVAL_BASELINE_BOOTSTRAP_CANDIDATE_BINDING_INVALID");
    const candidateHash = sha256(await readFile(path.resolve(options.candidatePromptPath)));
    if (candidateHash !== options.candidatePromptHash) throw new Error("EVAL_BASELINE_BOOTSTRAP_CANDIDATE_MUTATED");
  }
  // The accepted baseline may omit raw output bytes from tracked projections,
  // but it must retain the resolvable Host Agent locator. A hash of a removed
  // generation record is not provenance and cannot be revalidated at review.
  const acceptedTrials = options.baseline.trials.map((trial) => ({
    ...trial,
    provenanceEvidenceHash: trial.generationRecord ? sha256(JSON.stringify(trial.generationRecord)) : undefined,
    privacy: "redacted" as const,
  }));
  const accepted: AcceptedBaseline = {
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
