import { appendFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Harness, ReportLocale, SessionRecord } from "./types";

export type ReportRunStatus =
  | "started"
  | "prepared"
  | "evidence-ready"
  | "awaiting-ai"
  | "composing"
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

export type RunArtifactName =
  | "audit"
  | "evidence"
  | "firstUserMessages"
  | "skillSnapshot"
  | "skillInsights"
  | "reportSynthesis"
  | "keySessionAnalyses"
  | "composition"
  | "html"
  | "trace";

export interface ReportRunScope {
  harness: Harness;
  cwd: string | null;
  allProjects: boolean;
  since: Date;
  until: Date;
  locale: ReportLocale;
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
  warnings: string[];
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
  durationMs?: number;
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

const artifactFiles: Record<RunArtifactName, string> = {
  audit: "audit.json",
  evidence: "evidence.json",
  firstUserMessages: "first-user-messages.json",
  skillSnapshot: "skill-snapshot.json",
  skillInsights: "skill-insights.json",
  reportSynthesis: "report-synthesis.json",
  keySessionAnalyses: "key-session-analyses.json",
  composition: "composition.json",
  html: "report.html",
  trace: "trace.jsonl",
};

const forbiddenMetadataKey = /prompt|response|content|command|credential|secret|password|authorization|path/i;

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
  } catch {
    await writeFile(filePath, contents, "utf8");
    await unlink(temporary).catch(() => undefined);
  }
}

async function persistManifest(run: ReportRun): Promise<void> {
  run.manifest.updatedAt = nowIso();
  await writeAtomic(run.manifestFile, JSON.stringify(run.manifest, null, 2) + "\n");
}

async function persistManifestBestEffort(run: ReportRun): Promise<void> {
  try {
    await persistManifest(run);
  } catch {
    // The trace error is already retained in memory; the core operation must not recurse.
  }
}

async function appendTrace(run: ReportRun, event: Record<string, unknown>): Promise<void> {
  try {
    await appendFile(run.traceFile, JSON.stringify(event) + "\n", "utf8");
  } catch (error) {
    run.manifest.traceCompleteness = "incomplete";
    run.manifest.traceErrorCode = run.manifest.traceErrorCode ?? errorCode(error);
    if (!run.manifest.warnings.includes("Timing Trace could not be persisted completely.")) {
      run.manifest.warnings.push("Timing Trace could not be persisted completely.");
    }
    await persistManifestBestEffort(run);
  }
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
    warnings: [],
  };
}

export async function createReportRun(scope: ReportRunScope, requestedDirectory?: string): Promise<ReportRun> {
  const runDir = requestedDirectory
    ? path.resolve(requestedDirectory)
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
  const manifest = initialManifest(scope, randomUUID());
  const run: ReportRun = {
    runId: manifest.runId,
    runDir,
    manifestFile,
    traceFile,
    manifest,
    startedMono: performance.now(),
    startedWall: Date.now(),
  };
  await persistManifest(run);
  await appendTrace(run, {
    event: "run-start",
    runId: run.manifest.runId,
    startedAt: run.manifest.createdAt,
    source: "runner",
  });
  return run;
}

export async function openReportRun(runDir: string): Promise<ReportRun> {
  const resolved = path.resolve(runDir);
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
  run.manifest.status = status;
  await persistManifest(run);
}

export async function setRunEligibleStages(run: ReportRun, stages: readonly string[]): Promise<void> {
  run.manifest.eligibleStages = [...new Set(stages)];
  await persistManifest(run);
}

export async function setRunPromptHashes(run: ReportRun, promptHashes: ReportRunManifest["promptHashes"], runtimeHash: string | null): Promise<void> {
  run.manifest.promptHashes = promptHashes;
  run.manifest.runtimeHash = runtimeHash;
  await persistManifest(run);
}

export async function setRunSourceInventory(
  run: ReportRun,
  before: SourceInventory | null,
  after: SourceInventory | null,
): Promise<void> {
  const mutated = before !== null && after !== null
    ? before.fileCount !== after.fileCount || before.totalBytes !== after.totalBytes || before.signature !== after.signature
    : null;
  run.manifest.sourceInventory = { before, after, mutated };
  if (mutated === true) {
    run.manifest.traceCompleteness = "incomplete";
    run.manifest.warnings.push("History source files changed while the Audit was being read.");
  }
  await persistManifest(run);
}

export async function setRunAuditFingerprint(run: ReportRun, fingerprint: string): Promise<void> {
  run.manifest.auditFingerprint = fingerprint;
  await persistManifest(run);
}

export async function setRunTopSessions(
  run: ReportRun,
  sessions: ReadonlyArray<{ key: string; value: { value: number | string | null } }>,
  sessionRecords?: ReadonlyArray<SessionRecord>,
): Promise<void> {
  const filePathById = new Map(sessionRecords?.map((s) => [s.sessionId, s.filePath]) ?? []);
  run.manifest.topSessions = sessions.slice(0, 3).map((session, index) => ({
    sessionId: session.key,
    rank: index + 1,
    tokens: typeof session.value.value === "number" ? session.value.value : null,
    filePath: filePathById.get(session.key) ?? null,
  }));
  await persistManifest(run);
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
  const stage: RunStageStatus = {
    status,
    attempt: span.attempt,
    spanId: span.spanId,
    durationMs: Math.round(durationMs * 100) / 100,
    ...(failure ? { errorCode: errorCode(failure) } : {}),
  };
  run.manifest.stageStatus[span.phase] = stage;
  await appendTrace(run, {
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
    durationMs: stage.durationMs,
    status,
    ...(failure ? { errorCode: errorCode(failure) } : {}),
  });
  await persistManifest(run);
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
    attempt: stageAttempt(run, options.phase, options.attempt),
    parentSpanId: options.parentSpanId ?? null,
    startedAt: nowIso(),
    startedMono: performance.now(),
  };
  run.manifest.eligibleStages = [...new Set([...run.manifest.eligibleStages, span.phase])];
  run.manifest.stageStatus[span.phase] = {
    status: "started",
    attempt: span.attempt,
    spanId: span.spanId,
    durationMs: null,
  };
  const metadata = safeMetadata(options.metadata);
  await appendTrace(run, {
    event: "start",
    runId: run.manifest.runId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    phase: span.phase,
    operation: span.operation,
    source: span.source,
    attempt: span.attempt,
    startedAt: span.startedAt,
    ...(metadata ? { metadata } : {}),
  });
  await persistManifest(run);
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
  run.manifest.totalDurationMs = Math.max(0, Math.round((Date.now() - run.startedWall) * 100) / 100);
  const incompleteStage = run.manifest.eligibleStages.some((phase) => {
    const current = run.manifest.stageStatus[phase];
    return !current || current.status === "started" || current.status === "interrupted";
  });
  const failedStage = run.manifest.eligibleStages.some((phase) => {
    const current = run.manifest.stageStatus[phase];
    return current?.status === "failed" && phase !== "price-request";
  });
  run.manifest.status = status === "completed"
    ? failedStage
      ? "failed"
      : incompleteStage
        ? "incomplete"
        : "completed"
    : status;
  if (incompleteStage || run.manifest.traceErrorCode) run.manifest.traceCompleteness = "incomplete";
  await appendTrace(run, {
    event: "run-end",
    runId: run.manifest.runId,
    endedAt: nowIso(),
    durationMs: run.manifest.totalDurationMs,
    status: run.manifest.status,
  });
  try {
    const traceContents = await readFile(run.traceFile);
    run.manifest.artifacts.trace = {
      file: "trace.jsonl",
      bytes: traceContents.byteLength,
      sha256: hashBytes(traceContents),
    };
  } catch (error) {
    run.manifest.traceCompleteness = "incomplete";
    run.manifest.traceErrorCode = run.manifest.traceErrorCode ?? errorCode(error);
    run.manifest.warnings = [...new Set([...run.manifest.warnings, "Timing Trace could not be finalized."])];
  }
  await persistManifest(run);
}

export async function writeRunArtifact(run: ReportRun, name: RunArtifactName, value: unknown): Promise<ArtifactRef> {
  const file = artifactFiles[name];
  const filePath = path.join(run.runDir, file);
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Report Run artifact is not JSON serializable.");
  await writeAtomic(filePath, serialized + "\n");
  const bytes = Buffer.byteLength(serialized + "\n", "utf8");
  const ref: ArtifactRef = { file, bytes, sha256: hashBytes(Buffer.from(serialized + "\n", "utf8")) };
  run.manifest.artifacts[name] = ref;
  await persistManifest(run);
  return ref;
}

export async function writeRunTextArtifact(run: ReportRun, name: RunArtifactName, contents: string): Promise<ArtifactRef> {
  const file = artifactFiles[name];
  const filePath = path.join(run.runDir, file);
  await writeAtomic(filePath, contents);
  const bytes = Buffer.byteLength(contents, "utf8");
  const ref: ArtifactRef = { file, bytes, sha256: hashBytes(Buffer.from(contents, "utf8")) };
  run.manifest.artifacts[name] = ref;
  await persistManifest(run);
  return ref;
}

export async function registerRunArtifact(run: ReportRun, name: RunArtifactName, filePath: string): Promise<ArtifactRef> {
  const contents = await readFile(filePath);
  const relative = path.relative(run.runDir, path.resolve(filePath));
  const ref: ArtifactRef = {
    file: relative && !relative.startsWith("..") ? relative : "external:" + path.basename(filePath),
    bytes: contents.byteLength,
    sha256: hashBytes(contents),
  };
  run.manifest.artifacts[name] = ref;
  await persistManifest(run);
  return ref;
}

export async function readRunManifest(runDir: string): Promise<ReportRunManifest> {
  const value: unknown = JSON.parse(await readFile(path.join(path.resolve(runDir), "manifest.json"), "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Report Run manifest is malformed.");
  return value as ReportRunManifest;
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
  const manifest = await readRunManifest(resolved);
  const traceFile = path.join(resolved, "trace.jsonl");
  const phase = safeSpanLabel(event.phase, "unknown-phase");
  const operation = safeSpanLabel(event.operation, "unknown-operation");
  const spanId = safeSpanLabel(event.spanId, "unknown-span");
  const parentSpanId = event.parentSpanId ? safeSpanLabel(event.parentSpanId, "unknown-parent") : null;
  const current = manifest.stageStatus[phase];
  manifest.eligibleStages = [...new Set([...manifest.eligibleStages, phase])];
  const attempt = event.attempt ?? (event.event === "end" && current?.spanId === spanId ? current.attempt : (current?.attempt ?? 0) + 1);
  const missingStart = event.event === "end" && (current?.spanId !== spanId || current.status !== "started");
  if (missingStart) {
    manifest.traceCompleteness = "incomplete";
    manifest.warnings = [...new Set([...manifest.warnings, "A timing span ended without a persisted start event."])];
  }
  if (event.event === "start") {
    manifest.stageStatus[phase] = { status: "started", attempt, spanId, durationMs: null };
  } else {
    const durationMs = typeof event.durationMs === "number"
      ? Math.max(0, event.durationMs)
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
  try {
    await appendFile(traceFile, JSON.stringify(line) + "\n", "utf8");
  } catch (error) {
    manifest.traceCompleteness = "incomplete";
    manifest.traceErrorCode = manifest.traceErrorCode ?? errorCode(error);
    manifest.warnings = [...new Set([...manifest.warnings, "Timing Trace could not be persisted completely."])];
  }
  manifest.updatedAt = nowIso();
  await writeAtomic(path.join(resolved, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

export async function recordRunSpanInProcess(run: ReportRun, event: ExternalSpanEvent): Promise<void> {
  const phase = safeSpanLabel(event.phase, "unknown-phase");
  const operation = safeSpanLabel(event.operation, "unknown-operation");
  const spanId = safeSpanLabel(event.spanId, "unknown-span");
  const parentSpanId = event.parentSpanId ? safeSpanLabel(event.parentSpanId, "unknown-parent") : null;
  const current = run.manifest.stageStatus[phase];
  const attempt = event.attempt ?? (event.event === "end" && current?.spanId === spanId ? current.attempt : (current?.attempt ?? 0) + 1);
  const missingStart = event.event === "end" && (current?.spanId !== spanId || current.status !== "started");
  if (missingStart) {
    run.manifest.traceCompleteness = "incomplete";
    run.manifest.warnings = [...new Set([...run.manifest.warnings, "A timing span ended without a persisted start event."])];
  }
  run.manifest.eligibleStages = [...new Set([...run.manifest.eligibleStages, phase])];
  if (event.event === "start") {
    run.manifest.stageStatus[phase] = { status: "started", attempt, spanId, durationMs: null };
  } else {
    const durationMs = typeof event.durationMs === "number"
      ? Math.max(0, event.durationMs)
      : event.endedAt
        ? Math.max(0, Date.parse(event.endedAt) - Date.parse(event.startedAt))
        : null;
    run.manifest.stageStatus[phase] = {
      status: event.status ?? "unavailable",
      attempt,
      spanId,
      durationMs,
      ...(event.errorCode ? { errorCode: errorCode({ code: event.errorCode }) } : {}),
    };
  }
  const { metadata: _metadata, errorCode: _errorCode, ...eventWithoutUnsafeFields } = event;
  await appendTrace(run, {
    ...eventWithoutUnsafeFields,
    spanId,
    phase,
    operation,
    parentSpanId,
    runId: run.manifest.runId,
    attempt,
    ...(event.errorCode ? { errorCode: errorCode({ code: event.errorCode }) } : {}),
    ...(event.metadata && safeMetadata(event.metadata) ? { metadata: safeMetadata(event.metadata) } : {}),
  });
  await persistManifest(run);
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

export async function captureSourceInventory(harness: Harness): Promise<SourceInventory> {
  const root = harness === "codex"
    ? path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sessions")
    : path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");
  const files = await historyFiles(root, harness);
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
    return { promptHashes: { reportSynthesis: null, keySessionAnalysis: null, skillInsights: null }, runtimeHash: null };
  }
  const runtimeHashes: string[] = [];
  for (const file of runtimeFiles) {
    const hash = await hashFile(file);
    if (!hash) return { promptHashes: { reportSynthesis: null, keySessionAnalysis: null, skillInsights: null }, runtimeHash: null };
    runtimeHashes.push(hash);
  }
  return {
    promptHashes: {
      reportSynthesis: await findPrompt("report-synthesis.md"),
      keySessionAnalysis: await findPrompt("key-session-analysis.md"),
      skillInsights: await findPrompt("skill-insights.md"),
    },
    runtimeHash: hashBytes(Buffer.from(runtimeHashes.join("|"), "utf8")),
  };
}
