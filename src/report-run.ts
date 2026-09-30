import { appendFile, mkdir, open, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type {
  AuditResult,
  AuditSnapshot,
  AutomatedCheck,
  ContentEvidencePacket,
  ContributionEntry,
  Coverage,
  EvidenceValue,
  Harness,
  KeySessionTokenAccounting,
  ReportLocale,
  SessionRecord,
  SkillSnapshotArtifact,
  TurnAnalysisEntry,
} from "./types";
import { readCurrentBundleVersion, type BundleVersion } from "./bundle-version";
import { verifyCodexFailureProvenance } from "./codex-provenance";

export type ReportRunStatus =
  | "started"
  | "prepared"
  | "evidence-ready"
  | "awaiting-ai"
  | "composing"
  | "awaiting-ui-dispatch"
  | "completed"
  | "failed"
  | "incomplete";

export type TimingStatus =
  | "started"
  | "completed"
  | "failed"
  | "fallback"
  | "queued"
  | "reused"
  | "skipped"
  | "unavailable"
  | "interrupted";

export type TimingSource = "runner" | "skill" | "host-agent" | "network" | "filesystem" | "ui";

export type ReportLane = "report-synthesis" | "key-session-analysis" | "skill-insights";
export const REPORT_LANES: readonly ReportLane[] = [
  "report-synthesis",
  "key-session-analysis",
  "skill-insights",
] as const;

export type ReportRunExecutionMode = "concurrent" | "sequential-fallback" | "unknown";
export const SEQUENTIAL_FALLBACK_REASON_CODES = [
  "NATIVE_CONCURRENCY_UNAVAILABLE",
  "INSUFFICIENT_CONCURRENCY_SLOTS",
] as const;

export function isLaneTerminal(lane: RunLaneStatus): boolean {
  if (lane.status === "accepted" || lane.status === "unavailable") return true;
  if (lane.status === "fallback" && lane.attempts >= 2) return true;
  return false;
}

export type AdvanceClaimResult =
  | { claimed: true }
  | { claimed: false; status: "lanes-not-ready"; pendingLanes: ReportLane[] }
  | { claimed: false; status: ReportRunStatus; ready: false };

export async function claimReportRunAdvance(run: ReportRun): Promise<AdvanceClaimResult> {
  return withRunLock(run.runDir, async () => {
    const manifest = await readRunManifest(run.runDir);
    run.manifest = manifest;
    const eligibleLanes = Object.keys(manifest.laneStatus) as ReportLane[];
    const pendingLanes = eligibleLanes.filter((lane) => !isLaneTerminal(manifest.laneStatus[lane]));
    if (pendingLanes.length > 0) {
      return { claimed: false, status: "lanes-not-ready", pendingLanes };
    }
    if (
      manifest.status === "composing" ||
      manifest.status === "awaiting-ui-dispatch" ||
      manifest.status === "completed" ||
      manifest.status === "failed"
    ) {
      return { claimed: false, status: manifest.status, ready: false };
    }
    manifest.status = "composing";
    manifest.deliveryStatus = "composing";
    manifest.updatedAt = nowIso();
    await writeAtomic(run.manifestFile, JSON.stringify(manifest, null, 2) + "\n");
    run.manifest = manifest;
    return { claimed: true };
  });
}

export interface RunLaneStatus {
  status: "pending" | "running" | "accepted" | "fallback" | "failed" | "unavailable";
  attempts: number;
  totalDurationMs: number | null;
  lastDurationMs: number | null;
  reasonCode: string | null;
  inputArtifact: string | null;
  acceptedArtifact: string | null;
  spanStartedAt: string | null;
}

export type RunArtifactName =
  | "audit"
  | "evidence"
  | "firstUserMessages"
  | "skillSnapshot"
  | "skillInsights"
  | "reportSynthesis"
  | "keySessionAnalyses"
  | "composition"
  | "reportJson"
  | "html"
  | "trace";

export interface ReportRunScope {
  harness: Harness;
  cwd: string | null;
  allProjects: boolean;
  since: Date;
  until: Date;
  locale: ReportLocale;
  bundleVersion?: string;
}

export interface ArtifactRef {
  file: string;
  bytes: number;
  sha256: string;
}

export interface RunStageStatus {
  status: TimingStatus;
  attempt: number;
  spanId: string | null;
  durationMs: number | null;
  errorCode?: string;
}

export interface SourceInventory {
  fileCount: number;
  totalBytes: number;
  signature: string;
}

export interface ReportRunManifest {
  version: 1;
  runId: string;
  status: ReportRunStatus;
  createdAt: string;
  updatedAt: string;
  scope: {
    harness: Harness;
    cwd: string | null;
    allProjects: boolean;
    since: string;
    until: string;
    locale: ReportLocale;
  };
  bundleVersion: string | null;
  auditFingerprint: string | null;
  topSessions: Array<{ sessionId: string; rank: number; tokens: number | null; filePath?: string | null }>;
  artifacts: Partial<Record<RunArtifactName, ArtifactRef>>;
  stageStatus: Record<string, RunStageStatus>;
  eligibleStages: string[];
  traceCompleteness: "complete" | "incomplete";
  traceErrorCode: string | null;
  totalDurationMs: number | null;
  sourceInventory?: {
    before: SourceInventory | null;
    after: SourceInventory | null;
    mutated: boolean | null;
  };
  promptHashes: {
    reportSynthesis: string | null;
    keySessionAnalysis: string | null;
    skillInsights?: string | null;
  };
  runtimeHash: string | null;
  executionMode: ReportRunExecutionMode | null;
  executionModeReasonCode: string | null;
  warnings: string[];
  laneStatus: Record<ReportLane, RunLaneStatus>;
  deliveryStatus: ReportRunStatus;
  degraded: boolean;
  uiDispatch: "completed" | "queued" | "failed" | "unavailable";
  laneArtifacts: Record<string, ArtifactRef>;
  projections?: Partial<Record<ReportLane, ArtifactRef>>;
  retention?: {
    workspace: "local-sensitive";
    policy: "explicit-cleanup";
    cleanedAt: string | null;
  };
}

export interface ReportRun {
  runId: string;
  runDir: string;
  manifestFile: string;
  traceFile: string;
  manifest: ReportRunManifest;
  startedMono: number;
  startedWall: number;
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function assertLocalSensitiveRunDirectory(runDir: string): string {
  const resolved = path.resolve(runDir);
  const repositoryScratch = path.resolve(process.cwd(), ".scratch");
  const systemTemp = os.tmpdir();
  if (!isWithin(repositoryScratch, resolved) && !isWithin(systemTemp, resolved)) {
    throw new Error("REPORT_RUN_DIR_NOT_LOCAL_SENSITIVE");
  }
  return resolved;
}

export interface RunSpanOptions {
  phase: string;
  operation: string;
  source: TimingSource;
  parentSpanId?: string | null;
  attempt?: number;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ExternalSpanEvent {
  event: "start" | "end";
  spanId: string;
  phase: string;
  operation: string;
  source: TimingSource;
  attempt?: number;
  parentSpanId?: string | null;
  startedAt: string;
  endedAt?: string;
  durationMs?: number | null;
  status?: Exclude<TimingStatus, "started">;
  errorCode?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export const DEFAULT_RUN_STAGES = [
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
  "skill-insights",
  "report-synthesis",
  "key-session-analysis",
  "validation",
  "compose",
  "render",
  "font-subset",
  "html-write",
  "codex-open",
] as const;

const REPORT_LANE_PHASES = new Set<ReportLane>([
  "report-synthesis",
  "key-session-analysis",
  "skill-insights",
]);

const artifactFiles: Record<RunArtifactName, string> = {
  audit: "audit.json",
  evidence: "evidence.json",
  firstUserMessages: "first-user-messages.json",
  skillSnapshot: "skill-snapshot.json",
  skillInsights: "skill-insights.json",
  reportSynthesis: "report-synthesis.json",
  keySessionAnalyses: "key-session-analyses.json",
  composition: "composition.json",
  reportJson: "report.json",
  html: "report.html",
  trace: "trace.jsonl",
};

const forbiddenMetadataKey = /prompt|response|content|command|credential|secret|password|authorization|path/i;
const RUN_LOCK_TIMEOUT_MS = 5_000;
const RUN_LOCK_POLL_MS = 10;

type RunMutation<T> = (manifest: ReportRunManifest) => Promise<T> | T;
type RunTraceEvents = readonly Record<string, unknown>[] | ((manifest: ReportRunManifest) => readonly Record<string, unknown>[]);

function runLockPath(runDir: string): string {
  return path.join(runDir, ".run.lock");
}

function lockError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function withRunLock<T>(runDir: string, operation: () => Promise<T>): Promise<T> {
  const lockFile = runLockPath(runDir);
  const owner = JSON.stringify({ pid: process.pid, token: randomUUID(), acquiredAt: nowIso() }) + "\n";
  const deadline = Date.now() + RUN_LOCK_TIMEOUT_MS;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  while (handle === null) {
    try {
      handle = await open(lockFile, "wx");
      await handle.writeFile(owner, "utf8");
    } catch (error) {
      await handle?.close().catch(() => undefined);
      handle = null;
      if (!(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "EEXIST")) throw error;
      if (Date.now() >= deadline) throw lockError("RUN_LOCK_TIMEOUT", `Report Run lock wait timed out after ${RUN_LOCK_TIMEOUT_MS}ms; the lock was not removed.`);
      await sleep(RUN_LOCK_POLL_MS);
    }
  }
  try {
    return await operation();
  } finally {
    await handle.close().catch(() => undefined);
    try {
      const current = await readFile(lockFile, "utf8");
      if (current === owner) await unlink(lockFile);
    } catch {
      // An uncertain owner is never removed by a competing process.
    }
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function errorCode(error: unknown): string {
  const candidate = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : null;
  return typeof candidate === "string" && /^[A-Z][A-Z0-9_]{0,31}$/.test(candidate) ? candidate : "operation_failed";
}

function safeSpanLabel(value: string, fallback: string): string {
  return /^[A-Za-z0-9_.:-]{1,128}$/.test(value) ? value : fallback;
}

function safeMetadata(metadata: Record<string, string | number | boolean | null> | undefined): Record<string, string | number | boolean | null> | undefined {
  if (!metadata) return undefined;
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (forbiddenMetadataKey.test(key)) continue;
    if (typeof value === "string") result[key] = value.slice(0, 160);
    else if (typeof value === "number" || typeof value === "boolean" || value === null) result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function hashBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function hashFile(filePath: string): Promise<string | null> {
  try {
    return hashBytes(await readFile(filePath));
  } catch {
    return null;
  }
}

async function writeAtomic(filePath: string, contents: string): Promise<void> {
  const temporary = filePath + ".tmp-" + process.pid + "-" + randomUUID();
  await writeFile(temporary, contents, "utf8");
  try {
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    const atomicError = new Error(`Atomic replacement failed for ${path.basename(filePath)}.`) as Error & { code: string; cause?: unknown };
    atomicError.code = "RUN_ATOMIC_REPLACE_FAILED";
    atomicError.cause = error;
    throw atomicError;
  }
}

async function appendTraceLocked(run: ReportRun, manifest: ReportRunManifest, event: Record<string, unknown>): Promise<void> {
  try {
    await appendFile(run.traceFile, JSON.stringify(event) + "\n", "utf8");
  } catch (error) {
    manifest.traceCompleteness = "incomplete";
    manifest.traceErrorCode = manifest.traceErrorCode ?? errorCode(error);
    if (!manifest.warnings.includes("Timing Trace could not be persisted completely.")) {
      manifest.warnings.push("Timing Trace could not be persisted completely.");
    }
  }
}

async function mutateRun<T>(run: ReportRun, mutation: RunMutation<T>, traceEvents: RunTraceEvents = []): Promise<T> {
  return withRunLock(run.runDir, async () => {
    const manifest = await readRunManifest(run.runDir);
    const result = await mutation(manifest);
    const events = typeof traceEvents === "function" ? traceEvents(manifest) : traceEvents;
    for (const event of events) await appendTraceLocked(run, manifest, event);
    manifest.updatedAt = nowIso();
    await writeAtomic(run.manifestFile, JSON.stringify(manifest, null, 2) + "\n");
    run.manifest = manifest;
    return result;
  });
}

function initialManifest(scope: ReportRunScope, runId: string): ReportRunManifest {
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
    bundleVersion: scope.bundleVersion ?? null,
    auditFingerprint: null,
    topSessions: [],
    artifacts: {},
    stageStatus: {},
    eligibleStages: [...DEFAULT_RUN_STAGES],
    traceCompleteness: "complete",
    traceErrorCode: null,
    totalDurationMs: null,
    promptHashes: { reportSynthesis: null, keySessionAnalysis: null, skillInsights: null },
    runtimeHash: null,
    executionMode: null,
    executionModeReasonCode: null,
    warnings: [],
    laneStatus: {
      "report-synthesis": { status: "pending", attempts: 0, totalDurationMs: null, lastDurationMs: null, reasonCode: null, inputArtifact: null, acceptedArtifact: null, spanStartedAt: null },
      "key-session-analysis": { status: "pending", attempts: 0, totalDurationMs: null, lastDurationMs: null, reasonCode: null, inputArtifact: null, acceptedArtifact: null, spanStartedAt: null },
      "skill-insights": { status: "pending", attempts: 0, totalDurationMs: null, lastDurationMs: null, reasonCode: null, inputArtifact: null, acceptedArtifact: null, spanStartedAt: null },
    },
    deliveryStatus: "started",
    degraded: false,
    uiDispatch: "unavailable",
    laneArtifacts: {},
    projections: {},
    retention: { workspace: "local-sensitive", policy: "explicit-cleanup", cleanedAt: null },
  };
}

export async function createReportRun(scope: ReportRunScope, requestedDirectory?: string): Promise<ReportRun> {
  const runDir = requestedDirectory
    ? assertLocalSensitiveRunDirectory(requestedDirectory)
    : await (async () => {
      const root = path.join(os.tmpdir(), "where-tokens-went-runs");
      const directory = path.join(root, randomUUID());
      await mkdir(directory, { recursive: true });
      return directory;
    })();
  await mkdir(runDir, { recursive: true });
  const manifestFile = path.join(runDir, "manifest.json");
  const traceFile = path.join(runDir, "trace.jsonl");
  try {
    await stat(manifestFile);
    throw new Error("Report Run directory already contains a manifest.");
  } catch (error) {
    if (error instanceof Error && error.message === "Report Run directory already contains a manifest.") throw error;
    if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code !== "ENOENT") throw error;
  }
  await writeFile(traceFile, "", { encoding: "utf8", flag: "wx" }).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "EEXIST") {
      throw new Error("Report Run directory already contains a trace.");
    }
    throw error;
  });
  const bundleVersion = scope.bundleVersion ?? (await readCurrentBundleVersion())?.bundleVersion ?? null;
  const manifest = initialManifest({ ...scope, bundleVersion: bundleVersion ?? undefined }, randomUUID());
  const run: ReportRun = {
    runId: manifest.runId,
    runDir,
    manifestFile,
    traceFile,
    manifest,
    startedMono: performance.now(),
    startedWall: Date.now(),
  };
  await writeAtomic(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
  await appendFile(traceFile, JSON.stringify({
    event: "run-start",
    runId: run.manifest.runId,
    startedAt: run.manifest.createdAt,
    source: "runner",
  }) + "\n", "utf8");
  return run;
}

export async function openReportRun(runDir: string): Promise<ReportRun> {
  const resolved = assertLocalSensitiveRunDirectory(runDir);
  const manifestFile = path.join(resolved, "manifest.json");
  const traceFile = path.join(resolved, "trace.jsonl");
  const manifest = await readRunManifest(resolved);
  try {
    await stat(traceFile);
  } catch {
    throw new Error("Report Run timing trace is unavailable.");
  }
  const startedWall = Date.parse(manifest.createdAt);
  if (Number.isNaN(startedWall)) throw new Error("Report Run manifest has an invalid creation time.");
  return {
    runId: manifest.runId,
    runDir: resolved,
    manifestFile,
    traceFile,
    manifest,
    startedMono: performance.now(),
    startedWall,
  };
}

export async function setReportRunStatus(run: ReportRun, status: ReportRunStatus): Promise<void> {
  await mutateRun(run, (manifest) => {
    manifest.status = status;
    manifest.deliveryStatus = status;
  });
}

export async function setRunNoHistoryInScope(run: ReportRun): Promise<void> {
  await mutateRun(run, (manifest) => {
    for (const lane of REPORT_LANES) {
      manifest.laneStatus[lane] = {
        status: "unavailable",
        attempts: 0,
        totalDurationMs: 0,
        lastDurationMs: 0,
        reasonCode: "NO_HISTORY_IN_SCOPE",
        inputArtifact: null,
        acceptedArtifact: null,
        spanStartedAt: null,
      };
      manifest.stageStatus[lane] = {
        status: "unavailable",
        attempt: 0,
        spanId: null,
        durationMs: 0,
      };
    }
    const noHistorySkippedStages = [
      "content-selection",
      "content-read",
      "skill-candidate-select",
      "skill-snapshot",
      "validation",
    ];
    for (const stage of noHistorySkippedStages) {
      manifest.stageStatus[stage] = {
        status: "skipped",
        attempt: 0,
        spanId: null,
        durationMs: 0,
      };
    }
    manifest.degraded = true;
    if (!manifest.warnings.includes("NO_HISTORY_IN_SCOPE")) {
      manifest.warnings.push("NO_HISTORY_IN_SCOPE");
    }
  });
}

export async function setRunEligibleStages(run: ReportRun, stages: readonly string[]): Promise<void> {
  await mutateRun(run, (manifest) => {
    manifest.eligibleStages = [...new Set(stages)];
  });
}

export async function setRunPromptHashes(run: ReportRun, promptHashes: ReportRunManifest["promptHashes"], runtimeHash: string | null): Promise<void> {
  await mutateRun(run, (manifest) => {
    manifest.promptHashes = promptHashes;
    manifest.runtimeHash = runtimeHash;
  });
}

export async function setRunSourceInventory(
  run: ReportRun,
  before: SourceInventory | null,
  after: SourceInventory | null,
): Promise<void> {
  await mutateRun(run, (manifest) => {
    const mutated = before !== null && after !== null
      ? before.fileCount !== after.fileCount || before.totalBytes !== after.totalBytes || before.signature !== after.signature
      : null;
    manifest.sourceInventory = { before, after, mutated };
    if (mutated === true) {
      manifest.traceCompleteness = "incomplete";
      manifest.warnings = [...new Set([...manifest.warnings, "History source files changed while the Audit was being read."])];
    }
  });
}

export async function setRunAuditFingerprint(run: ReportRun, fingerprint: string): Promise<void> {
  await mutateRun(run, (manifest) => {
    manifest.auditFingerprint = fingerprint;
  });
}

export async function setRunTopSessions(
  run: ReportRun,
  sessions: ReadonlyArray<{ key: string; value: { value: number | string | null } }>,
  sessionRecords?: ReadonlyArray<SessionRecord>,
): Promise<void> {
  await mutateRun(run, (manifest) => {
    const sourceRoot = run.manifest.scope.harness === "codex"
      ? path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sessions")
      : path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");
    const filesBySession = new Map((sessionRecords ?? []).map((record) => [record.sessionId, record.filePath ?? null]));
    manifest.topSessions = sessions.slice(0, 3).map((session, index) => ({
      sessionId: session.key,
      rank: index + 1,
      tokens: typeof session.value.value === "number" ? session.value.value : null,
      // Keep only a Harness-root-relative identity. Content Evidence resolves
      // it against the frozen Harness root without exposing home directories.
      filePath: (() => {
        const file = filesBySession.get(session.key);
        if (!file) return null;
        const relative = path.relative(sourceRoot, file).replaceAll("\\", "/");
        return relative && !relative.startsWith("../") && relative !== ".." && !path.isAbsolute(relative) ? relative : null;
      })(),
    }));
  });
}

function stageAttempt(run: ReportRun, phase: string, explicitAttempt?: number): number {
  return explicitAttempt ?? ((run.manifest.stageStatus[phase]?.attempt ?? 0) + 1);
}

async function finishSpan(
  run: ReportRun,
  span: {
    spanId: string;
    phase: string;
    operation: string;
    source: TimingSource;
    attempt: number;
    parentSpanId: string | null;
    startedAt: string;
    startedMono: number;
  },
  status: Exclude<TimingStatus, "started">,
  failure?: unknown,
): Promise<void> {
  const endedAt = nowIso();
  const durationMs = Math.max(0, performance.now() - span.startedMono);
  const duration = Math.round(durationMs * 100) / 100;
  await mutateRun(run, (manifest) => {
    manifest.stageStatus[span.phase] = {
      status,
      attempt: span.attempt,
      spanId: span.spanId,
      durationMs: duration,
      ...(failure ? { errorCode: errorCode(failure) } : {}),
    };
  }, [{
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
    durationMs: duration,
    status,
    ...(failure ? { errorCode: errorCode(failure) } : {}),
  }]);
}

export async function withRunSpan<T>(
  run: ReportRun,
  options: RunSpanOptions,
  operation: () => Promise<T>,
): Promise<T> {
  const span = {
    spanId: randomUUID(),
    phase: options.phase,
    operation: options.operation,
    source: options.source,
    attempt: options.attempt ?? 0,
    parentSpanId: options.parentSpanId ?? null,
    startedAt: nowIso(),
    startedMono: performance.now(),
  };
  const metadata = safeMetadata(options.metadata);
  let committedAttempt = options.attempt ?? 0;
  span.attempt = await mutateRun(run, (manifest) => {
    committedAttempt = options.attempt ?? ((manifest.stageStatus[span.phase]?.attempt ?? 0) + 1);
    manifest.eligibleStages = [...new Set([...manifest.eligibleStages, span.phase])];
    manifest.stageStatus[span.phase] = {
      status: "started",
      attempt: committedAttempt,
      spanId: span.spanId,
      durationMs: null,
    };
    return committedAttempt;
  }, (manifest) => [{
    event: "start",
    runId: manifest.runId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    phase: span.phase,
    operation: span.operation,
    source: span.source,
    attempt: committedAttempt,
    startedAt: span.startedAt,
    ...(metadata ? { metadata } : {}),
  }]);
  try {
    const result = await operation();
    await finishSpan(run, span, "completed");
    return result;
  } catch (error) {
    await finishSpan(run, span, "failed", error);
    throw error;
  }
}

export async function finishRunSpan(
  run: ReportRun,
  span: RunSpanOptions & { spanId: string; startedAt: string; startedMono: number; attempt: number },
  status: Exclude<TimingStatus, "started">,
  failure?: unknown,
): Promise<void> {
  await finishSpan(run, { ...span, parentSpanId: span.parentSpanId ?? null }, status, failure);
}

export async function finalizeReportRun(run: ReportRun, status: ReportRunStatus): Promise<void> {
  await withRunLock(run.runDir, async () => {
    const manifest = await readRunManifest(run.runDir);
    manifest.totalDurationMs = Math.max(0, Math.round((Date.now() - run.startedWall) * 100) / 100);
    const uiReady = manifest.uiDispatch === "completed" || manifest.uiDispatch === "queued";
    const incompleteStage = manifest.eligibleStages.some((phase) => {
      if (phase === "codex-open") return !uiReady;
      if (REPORT_LANE_PHASES.has(phase as ReportLane)) {
        const lane = manifest.laneStatus[phase as ReportLane];
        return !lane || !isLaneTerminal(lane);
      }
      const current = manifest.stageStatus[phase];
      return !current || current.status === "started" || current.status === "interrupted";
    });
    const failedStage = manifest.eligibleStages.some((phase) => {
      const current = manifest.stageStatus[phase];
      return current?.status === "failed" && phase !== "price-request" && !REPORT_LANE_PHASES.has(phase as ReportLane);
    });
    const hasLaneWork = Object.values(manifest.laneStatus).some((lane) => lane.status !== "pending" || lane.attempts > 0 || lane.inputArtifact !== null);
    const eligibleLanes = Object.keys(manifest.laneStatus).filter((lane) => manifest.eligibleStages.includes(lane));
    const lanesTerminal = eligibleLanes.every((lane) => {
      const current = manifest.laneStatus[lane as ReportLane];
      return isLaneTerminal(current);
    });
    let htmlIntegrity = false;
    const html = manifest.artifacts.html;
    if (html) {
      try {
        const contents = await readFile(path.join(run.runDir, html.file));
        htmlIntegrity = contents.byteLength === html.bytes && hashBytes(contents) === html.sha256;
      } catch {
        htmlIntegrity = false;
      }
    }
    const traceReady = manifest.traceCompleteness === "complete" && !manifest.traceErrorCode;
    manifest.executionMode ??= "unknown";
    manifest.status = status === "completed"
      ? failedStage
        ? "failed"
        : incompleteStage || !lanesTerminal || !htmlIntegrity || !uiReady
          ? "incomplete"
          : "completed"
      : status;
    manifest.deliveryStatus = manifest.status;
    if (!htmlIntegrity) manifest.warnings = [...new Set([...manifest.warnings, "Final HTML artifact integrity verification failed."])];
    if (!uiReady) manifest.warnings = [...new Set([...manifest.warnings, "Final HTML UI dispatch was not observed as completed or queued."])];
    if (!lanesTerminal) manifest.warnings = [...new Set([...manifest.warnings, "One or more eligible AI lanes were not accepted or explicitly degraded."])];
    if (incompleteStage || manifest.traceErrorCode) manifest.traceCompleteness = "incomplete";
    if (!traceReady) {
      manifest.warnings = [...new Set([...manifest.warnings, `Performance trace is incomplete (${manifest.traceErrorCode ?? "MISSING_SPANS"}).`])];
    }
    await appendTraceLocked(run, manifest, {
      event: "run-end",
      runId: manifest.runId,
      endedAt: nowIso(),
      durationMs: manifest.totalDurationMs,
      status: manifest.status,
    });
    try {
      const traceContents = await readFile(run.traceFile);
      manifest.artifacts.trace = {
        file: "trace.jsonl",
        bytes: traceContents.byteLength,
        sha256: hashBytes(traceContents),
      };
    } catch (error) {
      manifest.traceCompleteness = "incomplete";
      manifest.traceErrorCode = manifest.traceErrorCode ?? errorCode(error);
      manifest.warnings = [...new Set([...manifest.warnings, "Timing Trace could not be finalized."])];
    }
    if (status === "completed" && !manifest.artifacts.trace) {
      manifest.status = "incomplete";
      manifest.deliveryStatus = "incomplete";
    }
    manifest.updatedAt = nowIso();
    await writeAtomic(run.manifestFile, JSON.stringify(manifest, null, 2) + "\n");
    run.manifest = manifest;
  });
}

export async function writeRunArtifact(run: ReportRun, name: RunArtifactName, value: unknown): Promise<ArtifactRef> {
  const file = artifactFiles[name];
  const filePath = path.join(run.runDir, file);
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Report Run artifact is not JSON serializable.");
  const bytes = Buffer.byteLength(serialized + "\n", "utf8");
  const ref: ArtifactRef = { file, bytes, sha256: hashBytes(Buffer.from(serialized + "\n", "utf8")) };
  return mutateRun(run, async (manifest) => {
    const previous = manifest.artifacts[name];
    if (previous && (previous.bytes !== ref.bytes || previous.sha256 !== ref.sha256)) throw lockError("RUN_ARTIFACT_IMMUTABLE", `Report Run artifact ${name} is already registered with different content.`);
    if (!previous) await writeAtomic(filePath, serialized + "\n");
    manifest.artifacts[name] = previous ?? ref;
    return previous ?? ref;
  });
}

export async function writeRunTextArtifact(run: ReportRun, name: RunArtifactName, contents: string): Promise<ArtifactRef> {
  const file = artifactFiles[name];
  const filePath = path.join(run.runDir, file);
  const bytes = Buffer.byteLength(contents, "utf8");
  const ref: ArtifactRef = { file, bytes, sha256: hashBytes(Buffer.from(contents, "utf8")) };
  return mutateRun(run, async (manifest) => {
    const previous = manifest.artifacts[name];
    if (previous && (previous.bytes !== ref.bytes || previous.sha256 !== ref.sha256)) throw lockError("RUN_ARTIFACT_IMMUTABLE", `Report Run artifact ${name} is already registered with different content.`);
    if (!previous) await writeAtomic(filePath, contents);
    manifest.artifacts[name] = previous ?? ref;
    return previous ?? ref;
  });
}

function laneArtifactKey(lane: ReportLane, file: string): string {
  return `${lane}/${path.basename(file)}`;
}

export const ALLOWED_GENERATION_FAILURE_REASONS = [
  "HOST_GENERATION_FAILED",
  "HOST_GENERATION_INTERRUPTED",
] as const;

export type GenerationFailureReason = typeof ALLOWED_GENERATION_FAILURE_REASONS[number];

export function isAllowedGenerationFailureReason(reason: string): reason is GenerationFailureReason {
  return (ALLOWED_GENERATION_FAILURE_REASONS as readonly string[]).includes(reason);
}

export interface HostFailureProvenance {
  harness: "codex";
  status: "failed" | "interrupted";
  rolloutPath: string;
  sessionId: string;
  turnId: string;
  threadId?: string;
  error?: string;
}

export interface HostFailureReceipt {
  kind: "host-agent-failure";
  source: "codex-host-agent";
  runId: string;
  lane: ReportLane;
  attempt: number;
  spanId: string;
  reasonCode: GenerationFailureReason;
  provenance: HostFailureProvenance;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function validateHostFailureReceipt(
  run: ReportRun,
  lane: ReportLane,
  currentLane: ReportRunManifest["laneStatus"][ReportLane],
  receipt: unknown,
  expectedReasonCode: string,
  activeSpanId: string,
  attempt: number,
): Promise<{ valid: true; receipt: HostFailureReceipt } | { valid: false; errors: string[] }> {
  if (!isRecord(receipt)) return { valid: false, errors: ["receipt is not a JSON object"] };
  const record = receipt;
  const errors: string[] = [];

  if (record.kind !== "host-agent-failure") {
    errors.push(`invalid kind '${String(record.kind)}' (expected 'host-agent-failure')`);
  }

  if (record.source !== "codex-host-agent") {
    errors.push(`unauthorized observation source '${String(record.source)}' (expected 'codex-host-agent')`);
  }

  if (record.runId !== run.manifest.runId) {
    errors.push(`runId mismatch (expected ${run.manifest.runId}, got ${String(record.runId)})`);
  }

  if (record.lane !== lane) {
    errors.push(`lane mismatch (expected ${lane}, got ${String(record.lane)})`);
  }

  if (typeof record.attempt !== "number" || record.attempt !== attempt) {
    errors.push(`attempt mismatch or missing (expected ${attempt}, got ${String(record.attempt)})`);
  }

  if (typeof record.spanId !== "string" || record.spanId !== activeSpanId) {
    errors.push(`spanId mismatch or missing (expected ${activeSpanId}, got ${String(record.spanId)})`);
  }

  if (typeof record.reasonCode !== "string" || record.reasonCode !== expectedReasonCode) {
    errors.push(`reasonCode mismatch or missing (expected ${expectedReasonCode}, got ${String(record.reasonCode)})`);
  }

  if (!isRecord(record.provenance)) {
    errors.push("provenance is missing or not an object");
  } else {
    const prov = record.provenance;
    if (prov.status !== "failed" && prov.status !== "interrupted") {
      errors.push(`provenance status '${String(prov.status)}' is not an explicit failure or interruption`);
    } else {
      if (expectedReasonCode === "HOST_GENERATION_FAILED" && prov.status !== "failed") {
        errors.push("provenance status must be 'failed' for HOST_GENERATION_FAILED");
      }
      if (expectedReasonCode === "HOST_GENERATION_INTERRUPTED" && prov.status !== "interrupted") {
        errors.push("provenance status must be 'interrupted' for HOST_GENERATION_INTERRUPTED");
      }
    }

    if (typeof prov.rolloutPath !== "string" || typeof prov.sessionId !== "string" || typeof prov.turnId !== "string") {
      errors.push("provenance missing required rolloutPath, sessionId, or turnId");
    } else {
      try {
        await verifyCodexFailureProvenance({
          rolloutPath: prov.rolloutPath,
          sessionId: prov.sessionId,
          turnId: prov.turnId,
          expectedStatus: prov.status as "failed" | "interrupted",
        });
      } catch (error) {
        errors.push(`Harness persistence verification failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return errors.length === 0
    ? { valid: true, receipt: record as unknown as HostFailureReceipt }
    : { valid: false, errors };
}

function laneArtifactFile(lane: ReportLane, kind: "input" | "prompt" | "raw" | "validation" | "accepted" | "fallback", attempt?: number): string {
  if (kind === "input") return `lanes/${lane}/input.json`;
  if (kind === "prompt") return `lanes/${lane}/prompt.json`;
  if (kind === "accepted") return `lanes/${lane}/accepted.json`;
  if (kind === "fallback") return `lanes/${lane}/fallback.json`;
  if (!attempt || !Number.isInteger(attempt) || attempt < 1) throw new Error("Lane artifact attempts must be positive integers.");
  return `lanes/${lane}/attempt-${attempt}.${kind}.json`;
}

export async function writeRunLaneArtifact(
  run: ReportRun,
  lane: ReportLane,
  kind: "input" | "prompt" | "raw" | "validation" | "accepted" | "fallback",
  value: unknown,
  attempt?: number,
): Promise<ArtifactRef> {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Lane artifact is not JSON serializable.");
  const file = laneArtifactFile(lane, kind, attempt);
  const filePath = path.join(run.runDir, file);
  const contents = serialized + "\n";
  const ref: ArtifactRef = { file, bytes: Buffer.byteLength(contents, "utf8"), sha256: hashBytes(Buffer.from(contents, "utf8")) };
  return mutateRun(run, async (manifest) => {
    const key = laneArtifactKey(lane, file);
    const previous = manifest.laneArtifacts[key];
    if (kind !== "fallback" && previous && (previous.bytes !== ref.bytes || previous.sha256 !== ref.sha256)) {
      throw lockError("RUN_ARTIFACT_IMMUTABLE", `Lane artifact ${key} is already registered with different content.`);
    }
    if (!previous || kind === "fallback") {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeAtomic(filePath, contents);
    }
    manifest.laneArtifacts[key] = ref;
    return ref;
  });
}

export async function writeRunLaneRawArtifact(
  run: ReportRun,
  lane: ReportLane,
  rawText: string,
  attempt: number,
): Promise<ArtifactRef> {
  const file = laneArtifactFile(lane, "raw", attempt);
  const filePath = path.join(run.runDir, file);
  const ref: ArtifactRef = { file, bytes: Buffer.byteLength(rawText, "utf8"), sha256: hashBytes(Buffer.from(rawText, "utf8")) };
  return mutateRun(run, async (manifest) => {
    const key = laneArtifactKey(lane, file);
    const previous = manifest.laneArtifacts[key];
    if (previous && (previous.bytes !== ref.bytes || previous.sha256 !== ref.sha256)) throw lockError("RUN_ARTIFACT_IMMUTABLE", `Lane artifact ${key} is already registered with different content.`);
    if (!previous) {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeAtomic(filePath, rawText);
    }
    manifest.laneArtifacts[key] = previous ?? ref;
    return previous ?? ref;
  });
}

export async function readRunLaneArtifact(runDir: string, lane: ReportLane, kind: "input" | "prompt" | "raw" | "validation" | "accepted" | "fallback", attempt?: number): Promise<unknown> {
  const resolved = path.resolve(runDir);
  const manifest = await readRunManifest(resolved);
  const file = laneArtifactFile(lane, kind, attempt);
  const ref = manifest.laneArtifacts[laneArtifactKey(lane, file)];
  if (!ref) throw new Error(`Report Run lane artifact is unavailable: ${lane}/${kind}${attempt ? `/${attempt}` : ""}`);
  const contents = await readFile(path.join(resolved, file));
  if (contents.byteLength !== ref.bytes || hashBytes(contents) !== ref.sha256) throw new Error(`Report Run lane artifact integrity check failed: ${lane}/${kind}${attempt ? `/${attempt}` : ""}`);
  return JSON.parse(contents.toString("utf8"));
}

export interface LaneProjectionContext {
  runId: string;
  lane: ReportLane;
  scope: AuditSnapshot["scope"];
  locale: ReportLocale;
  auditFingerprint: string;
  bundleVersion: string;
  promptHash: string;
}

export interface BaseLaneProjection {
  version: 1;
  runId: string;
  lane: ReportLane;
  scope: AuditSnapshot["scope"];
  locale: ReportLocale;
  auditFingerprint: string;
  bundleVersion: string;
  promptHash: string;
  projectionSchemaVersion: 1;
  projectionHash: string;
}

export interface ReportSynthesisProjection extends BaseLaneProjection {
  lane: "report-synthesis";
  audit: {
    scope: AuditSnapshot["scope"];
    coverage: Coverage;
    summary: Record<string, EvidenceValue>;
    rankings: AuditSnapshot["rankings"];
    turns: TurnAnalysisEntry[];
    checks: AutomatedCheck[];
    keySessionTokenAccounting?: KeySessionTokenAccounting[];
    report: {
      totalToolAmplifiedTokens?: EvidenceValue;
      apiEquivalentCost?: AuditSnapshot["report"]["apiEquivalentCost"];
      cacheEconomics?: AuditSnapshot["report"]["cacheEconomics"];
      firstRequestBurden?: AuditSnapshot["report"]["firstRequestBurden"];
      tools: AuditSnapshot["report"]["tools"];
      skills: AuditSnapshot["report"]["skills"];
    };
  };
  omittedFields: string[];
}

export interface KeySessionAnalysisProjection extends BaseLaneProjection {
  lane: "key-session-analysis";
  audit: {
    scope: AuditSnapshot["scope"];
    coverage: Coverage;
    summary: Record<string, EvidenceValue>;
    rankings: {
      sessions: ContributionEntry[];
    };
    turns: TurnAnalysisEntry[];
    keySessionTokenAccounting?: KeySessionTokenAccounting[];
  };
  sessions: ContributionEntry[];
  turns: TurnAnalysisEntry[];
  keySessionTokenAccounting: KeySessionTokenAccounting[];
  contentEvidencePackets: ContentEvidencePacket[];
  omittedFields: string[];
}

export interface SkillInsightsProjection extends BaseLaneProjection {
  lane: "skill-insights";
  snapshotId: string;
  snapshot: SkillSnapshotArtifact;
  omittedFields: string[];
}

export type LaneProjection =
  | ReportSynthesisProjection
  | KeySessionAnalysisProjection
  | SkillInsightsProjection;

function stableSort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSort);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableSort(nested)])
    );
  }
  return value;
}

export function computeProjectionHash(payload: Record<string, unknown>): string {
  const { projectionHash: _omitted, ...body } = payload;
  const canonicalJson = JSON.stringify(stableSort(body));
  return createHash("sha256").update(canonicalJson).digest("hex");
}

export function projectReportSynthesisInput(
  context: LaneProjectionContext,
  audit: AuditResult,
): ReportSynthesisProjection {
  if (!audit || typeof audit !== "object") {
    throw new Error("PROJECTION_MISSING_REQUIRED_FIELD: report-synthesis requires an audit object.");
  }
  if (!audit.summary || !audit.rankings || !Array.isArray(audit.checks)) {
    throw new Error("PROJECTION_MISSING_REQUIRED_FIELD: report-synthesis requires audit summary, rankings, and checks.");
  }
  const projectedAudit = {
    scope: audit.scope ?? context.scope,
    coverage: audit.coverage,
    summary: audit.summary,
    rankings: audit.rankings,
    turns: audit.turns ?? [],
    checks: audit.checks,
    ...(audit.keySessionTokenAccounting ? { keySessionTokenAccounting: audit.keySessionTokenAccounting } : {}),
    report: {
      totalToolAmplifiedTokens: audit.report?.totalToolAmplifiedTokens,
      apiEquivalentCost: audit.report?.apiEquivalentCost,
      cacheEconomics: audit.report?.cacheEconomics,
      firstRequestBurden: audit.report?.firstRequestBurden,
      tools: audit.report?.tools ?? [],
      skills: audit.report?.skills ?? [],
    },
  };
  const body = {
    version: 1 as const,
    runId: context.runId,
    lane: "report-synthesis" as const,
    scope: audit.scope ?? context.scope,
    locale: context.locale,
    auditFingerprint: context.auditFingerprint,
    bundleVersion: context.bundleVersion,
    promptHash: context.promptHash,
    projectionSchemaVersion: 1 as const,
    audit: projectedAudit,
    omittedFields: [
      "view",
      "weekComparison",
      "turnCandidates",
      "report.dailyUsage",
      "report.hourlyActivity",
      "report.rollingWindow",
      "report.hourlySupported",
    ],
  };
  const projectionHash = computeProjectionHash(body);
  return { ...body, projectionHash };
}

export function projectKeySessionAnalysisInput(
  context: LaneProjectionContext,
  audit: AuditResult,
  evidence: { packets: ContentEvidencePacket[] } | null,
): KeySessionAnalysisProjection {
  if (!audit || typeof audit !== "object") {
    throw new Error("PROJECTION_MISSING_REQUIRED_FIELD: key-session-analysis requires an audit object.");
  }
  if (!audit.rankings?.sessions || !Array.isArray(audit.rankings.sessions)) {
    throw new Error("PROJECTION_MISSING_REQUIRED_FIELD: key-session-analysis requires audit.rankings.sessions.");
  }
  if (!evidence || !Array.isArray(evidence.packets)) {
    throw new Error("PROJECTION_MISSING_REQUIRED_FIELD: key-session-analysis requires canonical evidence packets.");
  }
  const topSessions = audit.rankings.sessions.slice(0, 3);
  const topSessionIds = new Set(topSessions.map((session) => session.key));

  const topTurns = (audit.turns ?? []).filter((turn) => topSessionIds.has(turn.sessionId));
  const topAccounting = (audit.keySessionTokenAccounting ?? []).filter((entry) => topSessionIds.has(entry.sessionId));
  const scopedPackets = evidence.packets.filter((packet) =>
    topSessionIds.has(packet.sessionId) &&
    packet.scope.harness === audit.scope.harness &&
    packet.scope.allProjects === audit.scope.allProjects &&
    packet.scope.since === audit.scope.since
  );

  const projectedAudit = {
    scope: audit.scope ?? context.scope,
    coverage: audit.coverage,
    summary: audit.summary,
    rankings: {
      sessions: topSessions,
    },
    turns: topTurns,
    ...(topAccounting.length > 0 ? { keySessionTokenAccounting: topAccounting } : {}),
  };

  const body = {
    version: 1 as const,
    runId: context.runId,
    lane: "key-session-analysis" as const,
    scope: audit.scope ?? context.scope,
    locale: context.locale,
    auditFingerprint: context.auditFingerprint,
    bundleVersion: context.bundleVersion,
    promptHash: context.promptHash,
    projectionSchemaVersion: 1 as const,
    audit: projectedAudit,
    sessions: topSessions,
    turns: topTurns,
    keySessionTokenAccounting: topAccounting,
    contentEvidencePackets: scopedPackets,
    omittedFields: [
      "rankings.projects",
      "rankings.models",
      "rankings.timeBuckets",
      "sessionsOutsideTop3",
      "turnsOutsideTop3",
      "checks",
      "report",
      "turnCandidates",
      "view",
      "weekComparison",
    ],
  };
  const projectionHash = computeProjectionHash(body);
  return { ...body, projectionHash };
}

export function projectSkillInsightsInput(
  context: LaneProjectionContext,
  snapshot: SkillSnapshotArtifact | null,
): SkillInsightsProjection {
  if (!snapshot || typeof snapshot !== "object" || !snapshot.snapshotId || !snapshot.globalUsage || !Array.isArray(snapshot.selectedSkills)) {
    throw new Error("PROJECTION_MISSING_REQUIRED_FIELD: skill-insights requires snapshot with snapshotId, globalUsage, and selectedSkills.");
  }
  const body = {
    version: 1 as const,
    runId: context.runId,
    lane: "skill-insights" as const,
    scope: context.scope,
    locale: context.locale,
    auditFingerprint: context.auditFingerprint,
    bundleVersion: context.bundleVersion,
    promptHash: context.promptHash,
    projectionSchemaVersion: 1 as const,
    snapshotId: snapshot.snapshotId,
    snapshot,
    omittedFields: [
      "audit",
      "evidence",
      "turns",
      "sessions",
      "rankings",
      "checks",
      "report",
    ],
  };
  const projectionHash = computeProjectionHash(body);
  return { ...body, projectionHash };
}

export function buildLaneProjection(
  lane: ReportLane,
  context: LaneProjectionContext,
  inputs: {
    audit: AuditResult;
    evidence?: { packets: ContentEvidencePacket[] } | null;
    snapshot?: SkillSnapshotArtifact | null;
  },
): LaneProjection {
  if (lane === "report-synthesis") {
    return projectReportSynthesisInput(context, inputs.audit);
  }
  if (lane === "key-session-analysis") {
    return projectKeySessionAnalysisInput(context, inputs.audit, inputs.evidence ?? null);
  }
  if (lane === "skill-insights") {
    return projectSkillInsightsInput(context, inputs.snapshot ?? null);
  }
  throw new Error(`Unknown lane: ${lane}`);
}

export function validateLaneProjection(
  run: ReportRun,
  lane: ReportLane,
  candidate: unknown,
  expectedPromptHash?: string | null,
): { valid: true } {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("LANE_PROJECTION_INVALID: Lane input projection must be an object.");
  }
  const projection = candidate as Record<string, unknown>;
  if (projection.runId !== run.manifest.runId) {
    throw new Error(`LANE_PROJECTION_IDENTITY_TAMPERED: Projection runId '${projection.runId}' does not match Run '${run.manifest.runId}'.`);
  }
  if (projection.lane !== lane) {
    throw new Error(`LANE_PROJECTION_IDENTITY_TAMPERED: Projection lane '${projection.lane}' does not match expected '${lane}'.`);
  }
  if (projection.auditFingerprint !== run.manifest.auditFingerprint) {
    throw new Error(`LANE_PROJECTION_IDENTITY_TAMPERED: Projection auditFingerprint does not match Run.`);
  }
  if (projection.bundleVersion !== run.manifest.bundleVersion) {
    throw new Error(`LANE_PROJECTION_IDENTITY_TAMPERED: Projection bundleVersion does not match Run.`);
  }
  const promptHash = expectedPromptHash ?? run.manifest.promptHashes[lane === "report-synthesis" ? "reportSynthesis" : lane === "key-session-analysis" ? "keySessionAnalysis" : "skillInsights"];
  if (promptHash && projection.promptHash !== promptHash) {
    throw new Error(`LANE_PROJECTION_IDENTITY_TAMPERED: Projection promptHash does not match Run.`);
  }
  if (projection.projectionSchemaVersion !== 1) {
    throw new Error(`LANE_PROJECTION_INVALID: Unsupported projectionSchemaVersion '${projection.projectionSchemaVersion}'.`);
  }
  if (typeof projection.projectionHash !== "string" || !/^[0-9a-f]{64}$/i.test(projection.projectionHash)) {
    throw new Error("LANE_PROJECTION_INVALID: Projection projectionHash must be a valid sha256 hex string.");
  }
  const expectedHash = computeProjectionHash(projection);
  if (projection.projectionHash !== expectedHash) {
    throw new Error("LANE_PROJECTION_IDENTITY_TAMPERED: Projection content hash verification failed.");
  }
  return { valid: true };
}

export async function recordRunProjection(run: ReportRun, lane: ReportLane, ref: ArtifactRef): Promise<void> {
  await mutateRun(run, (manifest) => {
    if (!manifest.projections) manifest.projections = {};
    manifest.projections[lane] = ref;
  });
}

export async function startReportLane(run: ReportRun, lane: ReportLane, inputArtifact: string): Promise<{ attempt: number; spanId: string; startedAt: string }> {
  const spanId = randomUUID();
  const startedAt = nowIso();
  let attempt = 0;
  await mutateRun(run, (manifest) => {
    const current = manifest.laneStatus[lane];
    if (current.status === "running") throw lockError("RUN_LANE_ALREADY_RUNNING", `Lane ${lane} already has a running attempt.`);
    if (current.status === "accepted" || current.status === "unavailable") throw lockError("RUN_LANE_TERMINAL", `Lane ${lane} already has terminal status ${current.status}.`);
    if (current.status === "fallback" && current.attempts >= 2) throw lockError("RUN_LANE_TERMINAL", `Lane ${lane} already has terminal status ${current.status}.`);
    if (current.attempts >= 2) throw lockError("RUN_LANE_MAX_ATTEMPTS_EXCEEDED", `Lane ${lane} has reached the maximum of 2 attempts.`);
    attempt = current.attempts + 1;
    manifest.laneStatus[lane] = { ...current, status: "running", attempts: attempt, inputArtifact, reasonCode: null, spanStartedAt: startedAt };
    manifest.eligibleStages = [...new Set([...manifest.eligibleStages, lane])];
    manifest.stageStatus[lane] = { status: "started", attempt, spanId, durationMs: null };
  }, (manifest) => [{
    event: "start",
    runId: manifest.runId,
    spanId,
    phase: lane,
    operation: "ai-start",
    source: "runner",
    attempt,
    startedAt,
  }]);
  return { attempt, spanId, startedAt };
}

export async function finishReportLane(
  run: ReportRun,
  lane: ReportLane,
  attempt: number,
  spanId: string,
  startedAt: string,
  status: "accepted" | "fallback" | "failed" | "unavailable",
  durationMs: number | null,
  reasonCode: string | null,
  acceptedArtifact: string | null,
  source: TimingSource = "runner",
  metadata?: Record<string, string | number | boolean | null>,
): Promise<void> {
  await mutateRun(run, (manifest) => {
    const current = manifest.laneStatus[lane];
    const totalDurationMs = durationMs === null || (attempt > 1 && current.totalDurationMs === null)
      ? null
      : (current.totalDurationMs ?? 0) + durationMs;
    manifest.laneStatus[lane] = {
      ...current,
      status,
      totalDurationMs,
      lastDurationMs: durationMs,
      reasonCode,
      acceptedArtifact,
      spanStartedAt: current.spanStartedAt,
    };
    manifest.stageStatus[lane] = { status: status === "accepted" ? "completed" : status === "failed" ? "failed" : status, attempt, spanId, durationMs: durationMs ?? null, ...(reasonCode ? { errorCode: reasonCode } : {}) };
    manifest.degraded = Object.values(manifest.laneStatus).some((entry) => entry.status === "fallback" || entry.status === "failed" || entry.status === "unavailable");
  }, (manifest) => [{
    event: "end",
    runId: manifest.runId,
    spanId,
    phase: lane,
    operation: status === "fallback" || status === "unavailable" ? "ai-fallback" : "ai-accept",
    source,
    attempt,
    startedAt,
    endedAt: nowIso(),
    durationMs,
    status: status === "accepted" ? "completed" : status,
    ...(reasonCode ? { errorCode: reasonCode } : {}),
    ...(metadata ? { metadata } : { metadata: { generationTimingStatus: durationMs === null ? "unavailable" : "observed" } }),
  }]);
}

export async function setRunUiDispatch(run: ReportRun, status: ReportRunManifest["uiDispatch"]): Promise<void> {
  await mutateRun(run, (manifest) => {
    manifest.uiDispatch = status;
    manifest.stageStatus["codex-open"] = {
      status: status === "completed" || status === "queued" ? "completed" : "failed",
      attempt: 1,
      spanId: randomUUID(),
      durationMs: null,
    };
    if (status === "failed") manifest.deliveryStatus = "failed";
  });
}

export async function recordIncompleteUiDispatch(
  run: ReportRun,
  uiStatus: "failed" | "unavailable",
): Promise<void> {
  await mutateRun(run, (manifest) => {
    manifest.status = "incomplete";
    manifest.deliveryStatus = "incomplete";
    manifest.warnings = [...new Set([...manifest.warnings, `Final HTML UI dispatch outcome was ${uiStatus}.`])];
  });
}

export async function appendRunWarnings(run: ReportRun | string, warnings: readonly string[]): Promise<ReportRunManifest> {
  // Do not call openReportRun for the string form: it reads manifest.json
  // before acquiring the Run lock, so a concurrent Windows fallback write can
  // expose a partial JSON document to the reader. mutateRun reloads the
  // manifest while holding the lock, which is the only read path this
  // mutation needs.
  const resolved = typeof run === "string"
    ? {
        runId: "unresolved",
        runDir: path.resolve(run),
        manifestFile: path.join(path.resolve(run), "manifest.json"),
        traceFile: path.join(path.resolve(run), "trace.jsonl"),
        manifest: {} as ReportRunManifest,
        startedMono: performance.now(),
        startedWall: Date.now(),
      }
    : run;
  const additions = warnings.filter((warning) => typeof warning === "string" && warning.length > 0);
  return mutateRun(resolved, (manifest) => {
    if (additions.length > 0) manifest.warnings = [...new Set([...manifest.warnings, ...additions])];
    return manifest;
  });
}

const SENSITIVE_RUN_ARTIFACTS: readonly RunArtifactName[] = [
  "evidence",
  "firstUserMessages",
  "skillSnapshot",
  "skillInsights",
  "reportSynthesis",
  "keySessionAnalyses",
  "composition",
  "reportJson",
];

export async function cleanupSensitiveRunArtifacts(run: ReportRun): Promise<ReportRunManifest> {
  return withRunLock(run.runDir, async () => {
    const manifest = await readRunManifest(run.runDir);
    for (const name of SENSITIVE_RUN_ARTIFACTS) {
      const file = manifest.artifacts[name]?.file ?? artifactFiles[name];
      await rm(path.join(run.runDir, file), { force: true }).catch(() => undefined);
      delete manifest.artifacts[name];
    }
    await rm(path.join(run.runDir, "lanes"), { recursive: true, force: true }).catch(() => undefined);
    manifest.laneArtifacts = {};
    manifest.retention = { workspace: "local-sensitive", policy: "explicit-cleanup", cleanedAt: nowIso() };
    manifest.updatedAt = nowIso();
    await writeAtomic(run.manifestFile, JSON.stringify(manifest, null, 2) + "\n");
    run.manifest = manifest;
    return manifest;
  });
}

export async function registerRunArtifact(run: ReportRun, name: RunArtifactName, filePath: string): Promise<ArtifactRef> {
  const contents = await readFile(filePath);
  const relative = path.relative(run.runDir, path.resolve(filePath));
  const ref: ArtifactRef = {
    file: relative && !relative.startsWith("..") ? relative : "external:" + path.basename(filePath),
    bytes: contents.byteLength,
    sha256: hashBytes(contents),
  };
  return mutateRun(run, (manifest) => {
    const previous = manifest.artifacts[name];
    if (previous && (previous.bytes !== ref.bytes || previous.sha256 !== ref.sha256)) throw lockError("RUN_ARTIFACT_IMMUTABLE", `Report Run artifact ${name} is already registered with different content.`);
    manifest.artifacts[name] = previous ?? ref;
    return previous ?? ref;
  });
}

export async function readRunManifest(runDir: string): Promise<ReportRunManifest> {
  const value: unknown = JSON.parse(await readFile(path.join(path.resolve(runDir), "manifest.json"), "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Report Run manifest is malformed.");
  const manifest = value as ReportRunManifest;
  manifest.laneStatus ??= {
    "report-synthesis": { status: "pending", attempts: 0, totalDurationMs: null, lastDurationMs: null, reasonCode: null, inputArtifact: null, acceptedArtifact: null, spanStartedAt: null },
    "key-session-analysis": { status: "pending", attempts: 0, totalDurationMs: null, lastDurationMs: null, reasonCode: null, inputArtifact: null, acceptedArtifact: null, spanStartedAt: null },
    "skill-insights": { status: "pending", attempts: 0, totalDurationMs: null, lastDurationMs: null, reasonCode: null, inputArtifact: null, acceptedArtifact: null, spanStartedAt: null },
  };
  for (const lane of ["report-synthesis", "key-session-analysis", "skill-insights"] as const) manifest.laneStatus[lane].spanStartedAt ??= null;
  manifest.deliveryStatus ??= manifest.status;
  manifest.degraded ??= false;
  manifest.executionMode ??= null;
  manifest.executionModeReasonCode ??= null;
  manifest.uiDispatch ??= "unavailable";
  manifest.laneArtifacts ??= {};
  manifest.retention ??= { workspace: "local-sensitive", policy: "explicit-cleanup", cleanedAt: null };
  return manifest;
}

export async function readRunArtifact(runDir: string, name: RunArtifactName): Promise<unknown> {
  const manifest = await readRunManifest(runDir);
  const ref = manifest.artifacts[name];
  if (!ref) throw new Error("Report Run artifact is unavailable: " + name);
  const filePath = path.join(path.resolve(runDir), artifactFiles[name]);
  const contents = await readFile(filePath);
  if (contents.byteLength !== ref.bytes || hashBytes(contents) !== ref.sha256) throw new Error("Report Run artifact integrity check failed: " + name);
  return name === "trace" ? contents.toString("utf8") : JSON.parse(contents.toString("utf8"));
}

export async function recordRunSpan(runDir: string, event: ExternalSpanEvent): Promise<ReportRunManifest> {
  const resolved = path.resolve(runDir);
  const phase = safeSpanLabel(event.phase, "unknown-phase");
  const operation = safeSpanLabel(event.operation, "unknown-operation");
  const spanId = safeSpanLabel(event.spanId, "unknown-span");
  const parentSpanId = event.parentSpanId ? safeSpanLabel(event.parentSpanId, "unknown-parent") : null;
  return withRunLock(resolved, async () => {
    const manifest = await readRunManifest(resolved);
    if (phase === "lane-workers" && event.event === "start") {
      const executionMode = event.metadata?.executionMode;
      const reasonCode = event.metadata?.reasonCode;
      if (executionMode !== "concurrent" && executionMode !== "sequential-fallback" && executionMode !== "unknown") {
        throw new Error("REPORT_EXECUTION_MODE_REQUIRED: lane-workers start must declare concurrent, sequential-fallback, or unknown.");
      }
      if (executionMode === "sequential-fallback" && (typeof reasonCode !== "string" || !(SEQUENTIAL_FALLBACK_REASON_CODES as readonly string[]).includes(reasonCode))) {
        throw new Error(`REPORT_EXECUTION_MODE_REASON_REQUIRED: sequential-fallback reasonCode must be one of ${SEQUENTIAL_FALLBACK_REASON_CODES.join(", ")}.`);
      }
      if ((executionMode === "concurrent" || executionMode === "unknown") && reasonCode !== null && reasonCode !== undefined) {
        throw new Error("REPORT_EXECUTION_MODE_REASON_INVALID: concurrent or unknown execution cannot carry a fallback reasonCode.");
      }
      if (manifest.executionMode !== null && manifest.executionMode !== "unknown" && manifest.executionMode !== executionMode) {
        throw lockError("RUN_EXECUTION_MODE_IMMUTABLE", "Report Run execution mode cannot change after worker dispatch begins.");
      }
      manifest.executionMode = executionMode;
      manifest.executionModeReasonCode = executionMode === "sequential-fallback" ? reasonCode as string : null;
    }
    const current = manifest.stageStatus[phase];
    manifest.eligibleStages = [...new Set([...manifest.eligibleStages, phase])];
    const attempt = event.attempt ?? (event.event === "end" && current?.spanId === spanId ? current.attempt : (current?.attempt ?? 0) + 1);
    let persistedSpanState: "missing" | "started" | "ended" = "missing";
    if (event.event === "end") {
      try {
        const trace = await readFile(path.join(resolved, "trace.jsonl"), "utf8");
        for (const line of trace.split(/\r?\n/)) {
          if (!line.trim()) continue;
          try {
            const traceEvent = JSON.parse(line) as { event?: string; spanId?: string };
            if (traceEvent.spanId === spanId) persistedSpanState = traceEvent.event === "start" ? "started" : "ended";
          } catch {
            // Ignore malformed historical lines; trace persistence remains authoritative below.
          }
        }
      } catch {
        persistedSpanState = "missing";
      }
    }
    const missingStart = event.event === "end" && persistedSpanState !== "started";
    if (missingStart) {
      manifest.traceCompleteness = "incomplete";
      manifest.warnings = [...new Set([...manifest.warnings, "A timing span ended without a persisted start event."])];
    }
    if (event.event === "start") {
      manifest.stageStatus[phase] = { status: "started", attempt, spanId, durationMs: null };
    } else {
      const durationMs = typeof event.durationMs === "number"
        ? Math.max(0, event.durationMs)
        : event.durationMs === null
          ? null
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
      if (phase === "codex-open") manifest.uiDispatch = event.status === "completed" || event.status === "queued" ? event.status : event.status === "failed" ? "failed" : "unavailable";
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
    await appendTraceLocked({ runId: manifest.runId, runDir: resolved, manifestFile: path.join(resolved, "manifest.json"), traceFile: path.join(resolved, "trace.jsonl"), manifest, startedMono: 0, startedWall: Date.parse(manifest.createdAt) } as ReportRun, manifest, line);
    manifest.updatedAt = nowIso();
    await writeAtomic(path.join(resolved, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    return manifest;
  });
}

export async function recordRunSpanInProcess(run: ReportRun, event: ExternalSpanEvent): Promise<void> {
  const manifest = await recordRunSpan(run.runDir, event);
  run.manifest = manifest;
}

export async function recordCompletedRunSpan(
  run: ReportRun,
  event: Omit<ExternalSpanEvent, "event" | "spanId"> & { attempt?: number },
): Promise<void> {
  const spanId = randomUUID();
  const attempt = event.attempt ?? ((run.manifest.stageStatus[event.phase]?.attempt ?? 0) + 1);
  await recordRunSpanInProcess(run, { ...event, event: "start", spanId, attempt });
  await recordRunSpanInProcess(run, { ...event, event: "end", spanId, attempt, status: event.status ?? "completed" });
}

async function historyFiles(root: string, harness: Harness): Promise<string[]> {
  const result: string[] = [];
  async function visit(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl") && (harness === "claude" || entry.name.startsWith("rollout-"))) result.push(full);
    }
  }
  await visit(root);
  return result.sort();
}

export async function captureSourceInventory(harness: Harness, scopedFiles?: readonly string[]): Promise<SourceInventory> {
  const root = harness === "codex"
    ? path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sessions")
    : path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");
  const files = scopedFiles ? [...new Set(scopedFiles)] : await historyFiles(root, harness);
  const entries: string[] = [];
  let totalBytes = 0;
  for (const file of files) {
    try {
      const info = await stat(file);
      totalBytes += info.size;
      const relative = path.relative(root, file).replaceAll("\\", "/").toLowerCase();
      entries.push(relative + "|" + info.size + "|" + info.mtimeMs);
    } catch {
      entries.push("unstatable|" + path.basename(file));
    }
  }
  return {
    fileCount: files.length,
    totalBytes,
    signature: hashBytes(Buffer.from(entries.join("\n"), "utf8")),
  };
}

export async function resolveRunContractMetadata(): Promise<{
  promptHashes: ReportRunManifest["promptHashes"];
  runtimeHash: string | null;
  bundleVersion: BundleVersion | null;
}> {
  const referenceRoots = [
    path.resolve(__dirname, "../../prompts"),
    path.resolve(__dirname, "../../references"),
    path.resolve(__dirname, "../references"),
  ];
  async function findPrompt(name: string): Promise<string | null> {
    for (const root of referenceRoots) {
      const candidate = path.join(root, name);
      const hash = await hashFile(candidate);
      if (hash) return hash;
    }
    return null;
  }
  let runtimeFiles: string[];
  try {
    runtimeFiles = (await readdir(__dirname, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
      .map((entry) => path.join(__dirname, entry.name))
      .sort();
  } catch {
    return { promptHashes: { reportSynthesis: null, keySessionAnalysis: null, skillInsights: null }, runtimeHash: null, bundleVersion: await readCurrentBundleVersion() };
  }
  const runtimeHashes: string[] = [];
  for (const file of runtimeFiles) {
    const hash = await hashFile(file);
    if (!hash) return { promptHashes: { reportSynthesis: null, keySessionAnalysis: null, skillInsights: null }, runtimeHash: null, bundleVersion: await readCurrentBundleVersion() };
    runtimeHashes.push(hash);
  }
  return {
    promptHashes: {
      reportSynthesis: await findPrompt("report-synthesis.md"),
      keySessionAnalysis: await findPrompt("key-session-analysis.md"),
      skillInsights: await findPrompt("skill-insights.md"),
    },
    runtimeHash: hashBytes(Buffer.from(runtimeHashes.join("|"), "utf8")),
    bundleVersion: await readCurrentBundleVersion(),
  };
}

export function assertRunBundleVersion(run: ReportRun, current: string): void {
  if (!run.manifest.bundleVersion) return;
  if (run.manifest.bundleVersion !== current) {
    throw new Error(`Report Run bundle version changed during execution; the Run cannot continue. ${"Run npm run install-local."}`);
  }
}
