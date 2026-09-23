#!/usr/bin/env node

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { verifyInstalledSkill } from "./bundle-version";
import { analyseAudit } from "./analysis";
import { readClaude } from "./claude-reader";
import { readCodex } from "./codex-reader";
import { readContentEvidence, type ContentEvidenceRequest } from "./content-evidence";
import { auditFingerprint, reportComposition, validateKeySessionAnalysis, validateReportSynthesis } from "./key-session-analysis";
import { resolveApiPricing, type PricingMode, type PricingRequestTimingEvent } from "./rates";
import {
  captureSourceInventory,
  cleanupSensitiveRunArtifacts,
  createReportRun,
  assertRunBundleVersion,
  appendRunWarnings,
  finalizeReportRun,
  openReportRun,
  recordCompletedRunSpan,
  recordRunSpan,
  readRunArtifact,
  readRunLaneArtifact,
  resolveRunContractMetadata,
  startReportLane,
  finishReportLane,
  setRunUiDispatch,
  setReportRunStatus,
  setRunAuditFingerprint,
  setRunPromptHashes,
  setRunSourceInventory,
  setRunTopSessions,
  assertLocalSensitiveRunDirectory,
  writeRunArtifact,
  writeRunLaneArtifact,
  writeRunLaneRawArtifact,
  writeRunTextArtifact,
  withRunSpan,
  type ExternalSpanEvent,
  type ReportRun,
  type ReportRunManifest,
  type ReportRunScope,
  type ReportLane,
} from "./report-run";
import { normalizeLocale, renderHtml, renderShare, renderText, renderWeekText, resolveReportProjectName, subsetReportFonts, type ReportFontConfig } from "./report";
import { selectSkillCandidates, loadSkillSnapshot, validateSkillInsights } from "./skill-insights";
import { checkEvalInput, readEvalCase, runEvalTrial } from "./eval-lab";
import { readCodexResponseOutput, resolveCodexProvenance } from "./codex-provenance";
import { createGenerationIndex, createRoleIndex } from "./eval-provenance";
import { bootstrapAcceptedBaseline, isBaselineBootstrapReview } from "./eval-baseline";
import { advanceEvalState, readEvalState, type EvalPhase } from "./eval-state";
import {
  isAcceptedBaseline,
  isEvalCase,
  isEvalExperiment,
  isEvalRubric,
  isEvalTrial,
  isGenerationRecord,
  isRoleExecutionRecord,
  makeOptimizerProposal,
  PROMOTION_MINIMUM_IMPROVEMENT_DELTA,
  PROMOTION_MINIMUM_TRIALS,
  reviewArtifactBindingHash,
  reviewExperiment,
  sha256Json,
  summarizeScores,
  type EvalCase,
  type EvalExperiment,
  type EvalRubric,
  type EvalTrial,
  type AcceptedBaseline,
  type RoleExecutionRecord,
} from "./eval-contract";
import type { AuditResult, AuditSnapshot, AuditView, ContentEvidencePacket, ContentEvidenceSelection, EvidenceValue, FirstUserMessageRecord, Harness, KeySessionAnalysis, ReadResult, ReadScope, ReportLocale, ReportSynthesis, WeekComparison, WeekStructureChange, SkillSnapshotArtifact, ValidatedSkillInsight } from "./types";

interface CliOptions {
  harness: Harness;
  cwd: string | null;
  allProjects: boolean;
  since: Date;
  sinceExplicit: boolean;
  format: "json" | "text";
  locale: ReportLocale;
  view: AuditView;
  htmlPath: string | null;
  sharePath: string | null;
  fontPath: string | null;
  fontFamily: string | null;
  pricing: PricingMode;
}

function usage(): string {
  return [
    "Usage: where-tokens-went inspect --harness <claude|codex> --cwd <absolute-path> [--since 7d] [--format json|text] [--locale zh-CN|en-US] [--font <font-file>] [--font-family <name>] [--pricing litellm] [--view full|usage|window|report|tools|week|share]",
    "       where-tokens-went inspect --harness <claude|codex> --all-projects [--since 7d] [--format json|text] [--locale zh-CN|en-US] [--font <font-file>] [--font-family <name>] [--pricing litellm] [--view full|usage|window|report|tools|week|share]",
    "       where-tokens-went compose-report --locale zh-CN|en-US --font <font-file> [--font-family <name>] --html <final-path> < composition JSON envelope",
    "       where-tokens-went report-run prepare --harness <claude|codex> (--cwd <absolute-path>|--all-projects) [--since 7d] [--locale zh-CN|en-US] [--pricing litellm] [--run-dir <directory>]",
    "       where-tokens-went report-run evidence --run-dir <directory> < evidence selection JSON",
    "       where-tokens-went report-run evidence --run-dir <directory> --auto",
    "       where-tokens-went report-run ai-start|ai-accept|ai-fallback --run-dir <directory> --lane <lane> ...",
    "       where-tokens-went report-run compose --run-dir <directory> --locale zh-CN|en-US --html <final-path>",
    "       where-tokens-went report-run event|status|finalize|cleanup --run-dir <directory> ...",
    "       where-tokens-went eval contract|trial|review|baseline|baseline-bootstrap|generation-index|role-index|codex-output|optimize|promote|finalize-promotion|state ...",
  ].join("\n");
}

function parseDuration(value: string, now = Date.now()): Date {
  const match = /^(\d+)([hdwm])$/i.exec(value.trim());
  if (!match) throw new Error(`Invalid --since duration: ${value}. Use values such as 7d, 24h, or 2w.`);
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const milliseconds = unit === "h"
    ? amount * 60 * 60 * 1000
    : unit === "d"
      ? amount * 24 * 60 * 60 * 1000
      : unit === "w"
        ? amount * 7 * 24 * 60 * 60 * 1000
        : amount * 30 * 24 * 60 * 60 * 1000;
  return new Date(now - milliseconds);
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.\n${usage()}`);
  return value;
}

export function parseArgs(args: string[], now = Date.now()): CliOptions {
  if (args[0] !== "inspect") throw new Error(`Use inspect or compose-report.\n${usage()}`);
  let harness: Harness | null = null;
  let cwd: string | null = null;
  let allProjects = false;
  let since = parseDuration("7d", now);
  let sinceExplicit = false;
  let format: "json" | "text" = "json";
  let locale: ReportLocale = "en-US";
  let view: AuditView = "full";
  let htmlPath: string | null = null;
  let sharePath: string | null = null;
  let fontPath: string | null = null;
  let fontFamily: string | null = null;
  let pricing: PricingMode = "litellm";

  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--harness") {
      const value = requireValue(args, index, flag);
      index += 1;
      if (value !== "codex" && value !== "claude") throw new Error(`Unsupported Harness ${value}; supported Harnesses are claude and codex.\n${usage()}`);
      harness = value as Harness;
    } else if (flag === "--cwd") {
      cwd = requireValue(args, index, flag);
      index += 1;
      if (!path.isAbsolute(cwd)) throw new Error("--cwd must be an absolute path.");
    } else if (flag === "--all-projects") {
      allProjects = true;
    } else if (flag === "--since") {
      since = parseDuration(requireValue(args, index, flag), now);
      sinceExplicit = true;
      index += 1;
    } else if (flag === "--format") {
      const value = requireValue(args, index, flag);
      index += 1;
      if (value !== "json" && value !== "text") throw new Error("--format must be json or text.");
      format = value;
    } else if (flag === "--locale" || flag === "--lang") {
      locale = normalizeLocale(requireValue(args, index, flag));
      index += 1;
    } else if (flag === "--pricing") {
      const value = requireValue(args, index, flag);
      index += 1;
      if (value !== "litellm") throw new Error("--pricing must be litellm.");
      pricing = value;
    } else if (flag === "--view") {
      const value = requireValue(args, index, flag);
      index += 1;
      if (!["full", "usage", "window", "report", "tools", "week", "share", "question"].includes(value)) {
        throw new Error("--view must be full, usage, window, report, tools, week, share, or question.\n" + usage());
      }
      view = value as AuditView;
    } else if (flag === "--html") {
      htmlPath = requireValue(args, index, flag);
      index += 1;
    } else if (flag === "--share") {
      sharePath = requireValue(args, index, flag);
      index += 1;
    } else if (flag === "--font") {
      fontPath = requireValue(args, index, flag);
      index += 1;
    } else if (flag === "--font-family") {
      fontFamily = requireValue(args, index, flag);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${flag}.\n${usage()}`);
    }
  }

  if (!harness) throw new Error(`--harness is required.\n${usage()}`);
  if (cwd && allProjects) throw new Error("--cwd and --all-projects are mutually exclusive.");
  if (!cwd && !allProjects) throw new Error("Provide --cwd or --all-projects.");
  if (fontFamily && !fontPath) throw new Error("--font-family requires --font <font-file>.");
  return { harness, cwd, allProjects, since, sinceExplicit, format, locale, view, htmlPath, sharePath, fontPath, fontFamily, pricing };
}

async function readHarness(harness: Harness, scope: ReadScope): Promise<ReadResult> {
  return harness === "codex"
    ? readCodex(scope)
    : readClaude(scope);
}

function differenceEvidence(left: { value: number | string | null }, right: { value: number | string | null }, label: string) {
  if (typeof left.value !== "number" || typeof right.value !== "number") {
    return { value: null, provenance: "unavailable" as const, method: label + " requires complete numeric values in both periods" };
  }
  return { value: left.value - right.value, provenance: "derived" as const, method: "current period minus previous period for " + label };
}

function snapshotOf(result: AuditResult): AuditSnapshot {
  const { view: _view, weekComparison: _comparison, ...snapshot } = result;
  return snapshot;
}

function inRange(timestamp: string | null, from: Date, to: Date): boolean {
  if (!timestamp) return false;
  const value = Date.parse(timestamp);
  return !Number.isNaN(value) && value >= from.getTime() && value < to.getTime();
}

function sliceRead(read: ReadResult, from: Date, to: Date): ReadResult {
  const modelCalls = read.modelCalls.filter((call) => inRange(call.timestamp, from, to));
  const toolCalls = read.toolCalls.filter((call) => inRange(call.timestamp, from, to));
  const lifecycle = read.lifecycle.filter((event) => inRange(event.timestamp, from, to));
  const skillEvidence = read.skillEvidence?.filter((record) => inRange(record.timestamp, from, to));
  const sessionCosts = read.sessionCosts?.filter((record) => inRange(record.timestamp, from, to));
  const sessionIds = new Set([
    ...modelCalls.map((call) => call.sessionId),
    ...toolCalls.map((call) => call.sessionId),
    ...lifecycle.map((event) => event.sessionId),
    ...(skillEvidence ?? []).map((record) => record.sessionId),
    ...(sessionCosts ?? []).map((record) => record.sessionId),
  ]);
  return {
    ...read,
    sessions: read.sessions.filter((session) => sessionIds.has(session.sessionId)),
    modelCalls,
    toolCalls,
    lifecycle,
    ...(read.skillEvidence ? { skillEvidence } : {}),
    ...(read.sessionCosts ? { sessionCosts } : {}),
  };
}

function missingWeekEvidence(label: string): EvidenceValue {
  return { value: null, provenance: "unavailable", method: label + " was absent from one comparison period" };
}

function structureChanges(
  currentEntries: Array<{ key: string; value: EvidenceValue }>,
  previousEntries: Array<{ key: string; value: EvidenceValue }>,
  label: string,
): WeekStructureChange[] {
  const current = new Map(currentEntries.map((entry) => [entry.key, entry.value]));
  const previous = new Map(previousEntries.map((entry) => [entry.key, entry.value]));
  return [...new Set([...current.keys(), ...previous.keys()])]
    .sort()
    .map((key) => {
      const currentValue = current.get(key) ?? missingWeekEvidence(label + " current value for " + key);
      const previousValue = previous.get(key) ?? missingWeekEvidence(label + " previous value for " + key);
      return { key, current: currentValue, previous: previousValue, change: differenceEvidence(currentValue, previousValue, label + " " + key) };
    });
}

function makeWeekComparison(current: AuditResult, previous: AuditResult, currentFrom: Date, currentTo: Date, previousFrom: Date): WeekComparison {
  return {
    currentFrom: currentFrom.toISOString(),
    currentTo: currentTo.toISOString(),
    previousFrom: previousFrom.toISOString(),
    previousTo: currentFrom.toISOString(),
    current: snapshotOf(current),
    previous: snapshotOf(previous),
    changes: {
      totalTokens: differenceEvidence(current.summary.totalTokens, previous.summary.totalTokens, "total tokens"),
      modelCallCount: differenceEvidence(current.summary.modelCallCount, previous.summary.modelCallCount, "model call count"),
      toolAmplifiedTokens: differenceEvidence(current.report.totalToolAmplifiedTokens, previous.report.totalToolAmplifiedTokens, "tool amplification"),
    },
    modelChanges: structureChanges(current.rankings.models, previous.rankings.models, "model tokens"),
    toolChanges: structureChanges(
      current.report.tools.map((entry) => ({ key: entry.key, value: entry.amplifiedTokens })),
      previous.report.tools.map((entry) => ({ key: entry.key, value: entry.amplifiedTokens })),
      "tool amplification",
    ),
  };
}

function defaultOutputPath(harness: Harness, kind: "report" | "share", extension: string): string {
  return path.join(os.tmpdir(), "where-tokens-went-" + harness + "-" + kind + "-" + Date.now() + extension);
}

async function writeLocalFile(filePath: string, contents: string): Promise<string> {
  const absolute = path.resolve(filePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, contents, "utf8");
  return absolute;
}

interface ComposeReportOptions {
  locale: ReportLocale;
  htmlPath: string;
  fontPath: string | null;
  fontFamily: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseComposeArgs(args: string[]): ComposeReportOptions {
  let locale: ReportLocale = "en-US";
  let htmlPath: string | null = null;
  let fontPath: string | null = null;
  let fontFamily: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--locale" || flag === "--lang") {
      locale = normalizeLocale(requireValue(args, index, flag));
      index += 1;
    } else if (flag === "--html") {
      htmlPath = requireValue(args, index, flag);
      index += 1;
    } else if (flag === "--font") {
      fontPath = requireValue(args, index, flag);
      index += 1;
    } else if (flag === "--font-family") {
      fontFamily = requireValue(args, index, flag);
      index += 1;
    } else {
      throw new Error(`Unknown compose-report argument: ${flag}.\n${usage()}`);
    }
  }
  if (!htmlPath) throw new Error(`compose-report requires --html.\n${usage()}`);
  if (fontFamily && !fontPath) throw new Error("--font-family requires --font <font-file>.");
  return { locale, htmlPath, fontPath, fontFamily };
}

function reportFontConfig(fontPath: string | null, fontFamily: string | null): ReportFontConfig | undefined {
  return fontPath ? { filePath: fontPath, ...(fontFamily ? { family: fontFamily } : {}) } : undefined;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

interface EvidenceInput {
  selections: ContentEvidenceSelection[];
  maxItemsPerSession?: number;
  maxCharsPerItem?: number;
}

interface RunEvidenceArtifact {
  version: 1;
  runId: string;
  auditFingerprint: string;
  scope: ReportRunManifest["scope"];
  selections: ContentEvidenceSelection[];
  maxItemsPerSession: number;
  maxCharsPerItem: number;
  packets: ContentEvidencePacket[];
}

interface RunAiArtifact<T> {
  version: 1;
  runId: string;
  auditFingerprint: string;
  promptHashes: ReportRunManifest["promptHashes"];
  runtimeHash: string;
  attempt: number | null;
  status: "completed" | "fallback" | "skipped";
  value: T;
  snapshotId?: string | null;
  valid?: boolean;
  validCount?: number;
  invalidCount?: number;
  rejectionReasons?: string[];
}

function extractRunDirectory(args: string[]): { runDir: string | null; rest: string[] } {
  let runDir: string | null = null;
  const rest: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--run-dir") {
      if (runDir !== null) throw new Error("--run-dir may only be provided once.");
      runDir = requireValue(args, index, "--run-dir");
      index += 1;
    } else {
      rest.push(args[index]);
    }
  }
  return { runDir, rest };
}

function requireRunDirectory(runDir: string | null): string {
  if (!runDir) throw new Error(`--run-dir is required.\n${usage()}`);
  return assertLocalSensitiveRunDirectory(runDir);
}

function parseLane(value: string): ReportLane {
  if (value === "report-synthesis" || value === "key-session-analysis" || value === "skill-insights") return value;
  throw new Error("--lane must be report-synthesis, key-session-analysis, or skill-insights.");
}

function lanePromptHash(manifest: ReportRunManifest, lane: ReportLane): string {
  const hash = lane === "report-synthesis"
    ? manifest.promptHashes.reportSynthesis
    : lane === "key-session-analysis"
      ? manifest.promptHashes.keySessionAnalysis
      : manifest.promptHashes.skillInsights;
  if (!hash) throw new Error(`Report Run Prompt hash is unavailable for ${lane}.`);
  return hash;
}

function parseLaneCommandArgs(args: string[]): { runDir: string; lane: ReportLane } {
  const extracted = extractRunDirectory(args);
  let lane: ReportLane | null = null;
  for (let index = 0; index < extracted.rest.length; index += 1) {
    const flag = extracted.rest[index];
    if (flag !== "--lane") throw new Error(`Unknown lane command argument: ${flag}.`);
    lane = parseLane(requireValue(extracted.rest, index, "--lane"));
    index += 1;
  }
  if (!lane) throw new Error("--lane is required.");
  return { runDir: requireRunDirectory(extracted.runDir), lane };
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const SCENARIO_METADATA_KEYS = new Set(["id", "caseId", "split", "inputArtifact", "inputHash", "expectedOutcome", "originFailure", "snapshotId", "auditFingerprint", "createdAt"]);

function canonicalScenario(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalScenario);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value)
    .filter((key) => !SCENARIO_METADATA_KEYS.has(key))
    .sort()
    .map((key) => [key, canonicalScenario(value[key])]));
}

function scenarioContentHash(raw: string): string {
  return sha256Text(JSON.stringify(canonicalScenario(JSON.parse(raw))));
}

function runSummary(run: ReportRun): Record<string, unknown> {
  return {
    runId: run.manifest.runId,
    runDir: run.runDir,
    manifestPath: run.manifestFile,
    tracePath: run.traceFile,
    status: run.manifest.status,
    scope: run.manifest.scope,
    auditFingerprint: run.manifest.auditFingerprint,
    bundleVersion: run.manifest.bundleVersion,
    topSessions: run.manifest.topSessions,
    artifacts: run.manifest.artifacts,
    stageStatus: run.manifest.stageStatus,
    traceCompleteness: run.manifest.traceCompleteness,
    traceErrorCode: run.manifest.traceErrorCode,
    totalDurationMs: run.manifest.totalDurationMs,
    promptHashes: run.manifest.promptHashes,
    runtimeHash: run.manifest.runtimeHash,
    warnings: run.manifest.warnings,
    laneStatus: run.manifest.laneStatus,
    deliveryStatus: run.manifest.deliveryStatus,
    degraded: run.manifest.degraded,
    uiDispatch: run.manifest.uiDispatch,
    laneArtifacts: run.manifest.laneArtifacts,
  };
}

function outputRunSummary(run: ReportRun, extra: Record<string, unknown> = {}): void {
  process.stdout.write(JSON.stringify({ ...runSummary(run), ...extra }) + "\n");
}

function scopeFromManifest(manifest: ReportRunManifest): ReadScope {
  const since = new Date(manifest.scope.since);
  const until = new Date(manifest.scope.until);
  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) throw new Error("Report Run manifest has an invalid frozen time range.");
  return {
    cwd: manifest.scope.cwd,
    allProjects: manifest.scope.allProjects,
    since,
    until,
  };
}

async function readCanonicalAudit(run: ReportRun): Promise<AuditResult> {
  const value = await readRunArtifact(run.runDir, "audit");
  if (!isRecord(value)) throw new Error("Report Run Audit artifact is malformed.");
  const audit = value as unknown as AuditResult;
  if (!isRecord(audit.scope) || !isRecord(audit.coverage) || !isRecord(audit.rankings)) throw new Error("Report Run Audit artifact is malformed.");
  if (audit.scope.harness !== run.manifest.scope.harness || audit.scope.allProjects !== run.manifest.scope.allProjects) {
    throw new Error("Report Run Audit Scope does not match the manifest.");
  }
  if (audit.scope.since !== run.manifest.scope.since || audit.scope.until !== run.manifest.scope.until) {
    throw new Error("Report Run Audit time range does not match the manifest.");
  }
  const fingerprint = auditFingerprint(audit);
  if (run.manifest.auditFingerprint !== fingerprint) throw new Error("Report Run Audit fingerprint does not match the manifest.");
  return audit;
}

function positiveLimit(value: unknown, flag: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 100_000) throw new Error(`${flag} must be an integer between 1 and 100000.`);
  return value;
}

function parseEvidenceInput(input: string): EvidenceInput {
  if (!input.trim()) throw new Error("report-run evidence requires one JSON selection object on stdin.");
  const parsed: unknown = JSON.parse(input);
  const source = Array.isArray(parsed) ? { selections: parsed } : parsed;
  if (!isRecord(source) || !Array.isArray(source.selections)) throw new Error("report-run evidence requires a selections array.");
  const selections = source.selections as unknown[];
  if (!selections.every((selection) => isRecord(selection) && typeof selection.sessionId === "string" && Array.isArray(selection.turnIds) && selection.turnIds.every((turnId) => typeof turnId === "string") && typeof selection.selectionReason === "string" && typeof selection.unreadScope === "string")) {
    throw new Error("Each evidence selection requires sessionId, turnIds, selectionReason, and unreadScope.");
  }
  return {
    selections: selections as ContentEvidenceSelection[],
    maxItemsPerSession: source.maxItemsPerSession === undefined ? undefined : positiveLimit(source.maxItemsPerSession, "maxItemsPerSession", 24),
    maxCharsPerItem: source.maxCharsPerItem === undefined ? undefined : positiveLimit(source.maxCharsPerItem, "maxCharsPerItem", 1200),
  };
}

function evidenceArtifactMatches(value: unknown, run: ReportRun, input: EvidenceInput): value is RunEvidenceArtifact {
  if (!isRecord(value) || value.version !== 1 || value.runId !== run.manifest.runId || value.auditFingerprint !== run.manifest.auditFingerprint || JSON.stringify(value.scope) !== JSON.stringify(run.manifest.scope) || !Array.isArray(value.packets) || !Array.isArray(value.selections)) return false;
  const maxItems = input.maxItemsPerSession ?? 24;
  const maxChars = input.maxCharsPerItem ?? 1200;
  return value.maxItemsPerSession === maxItems && value.maxCharsPerItem === maxChars && JSON.stringify(value.selections) === JSON.stringify(input.selections);
}

function packetSummary(packets: ContentEvidencePacket[]): Array<Record<string, unknown>> {
  return packets.map((packet) => ({
    sessionId: packet.sessionId,
    turnCount: packet.turnIds.length,
    itemCount: packet.items.length,
    truncatedItemCount: packet.items.filter((item) => item.truncated).length,
    unreadScope: packet.unreadScope,
    warningCount: packet.warnings.length,
  }));
}

async function writeAtomicLocal(filePath: string, contents: string): Promise<string> {
  const absolute = path.resolve(filePath);
  const temporary = absolute + ".tmp-" + process.pid + "-" + randomUUID();
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(temporary, contents, "utf8");
  try {
    await fs.rename(temporary, absolute);
  } catch (error) {
    await fs.unlink(temporary).catch(() => undefined);
    const atomicError = new Error(`Atomic replacement failed for ${path.basename(absolute)}.`) as Error & { code: string; cause?: unknown };
    atomicError.code = "RUN_ATOMIC_REPLACE_FAILED";
    atomicError.cause = error;
    throw atomicError;
  }
  return absolute;
}

async function markPreparedRunFailed(run: ReportRun): Promise<void> {
  try {
    await finalizeReportRun(run, "failed");
  } catch {
    await setReportRunStatus(run, "failed").catch(() => undefined);
  }
}

async function recordPricingTiming(run: ReportRun, event: PricingRequestTimingEvent): Promise<void> {
  await recordCompletedRunSpan(run, {
    phase: "price-request",
    operation: "litellm-" + event.kind,
    source: "network",
    startedAt: event.startedAt,
    endedAt: event.endedAt,
    durationMs: event.durationMs,
    status: event.outcome === "success" ? "completed" : "failed",
    metadata: {
      provider: event.provider,
      model: event.model,
      requestKind: event.kind,
      httpStatus: event.status,
      responseBytes: event.responseBytes,
      outcome: event.outcome,
    },
  });
}

async function reportRunPrepareMain(args: string[]): Promise<number> {
  const { runDir, rest } = extractRunDirectory(args);
  const frozenNow = Date.now();
  const options = parseArgs(["inspect", ...rest], frozenNow);
  if (options.view !== "full") throw new Error("report-run prepare only supports the full report workflow.");
  if (options.htmlPath || options.sharePath) throw new Error("report-run prepare does not write HTML or share output.");
  const installedBundle = await verifyInstalledSkill();
  const scope: ReportRunScope = {
    harness: options.harness,
    cwd: options.cwd,
    allProjects: options.allProjects,
    since: options.since,
    until: new Date(frozenNow),
    locale: options.locale,
    bundleVersion: installedBundle.bundleVersion,
  };
  let run: ReportRun | null = null;
  try {
    run = await createReportRun(scope, runDir ?? undefined);
    await withRunSpan(run, { phase: "scope-freeze", operation: "freeze-report-scope", source: "runner" }, async () => undefined);
    await withRunSpan(run, { phase: "skill-read", operation: "verify-installed-skill", source: "filesystem" }, async () => undefined);
    const contract = await withRunSpan(run, { phase: "prompt-read", operation: "resolve-report-contract", source: "filesystem" }, async () => {
      const metadata = await resolveRunContractMetadata();
      if (!metadata.promptHashes.reportSynthesis || !metadata.promptHashes.keySessionAnalysis || !metadata.promptHashes.skillInsights) throw new Error("Authoritative Report Prompts are unavailable for this run.");
      if (!metadata.bundleVersion || metadata.bundleVersion.bundleVersion !== installedBundle.bundleVersion) throw new Error("The packaged bundle changed before Report Run preparation completed. Run npm run install-local.");
      return metadata;
    });
    await setRunPromptHashes(run, contract.promptHashes, contract.runtimeHash);
    const read = await withRunSpan(run, { phase: "history-read", operation: "read-historical-records", source: "filesystem" }, () => readHarness(scope.harness, scope));
    const before = await withRunSpan(run, { phase: "source-inventory", operation: "inventory-scoped-files-before", source: "filesystem" }, () => captureSourceInventory(scope.harness, read.sourceFiles));
    const pricing = await withRunSpan(run, { phase: "price-resolution", operation: "resolve-api-pricing", source: "runner" }, () => resolveApiPricing(read.modelCalls, scope.harness, options.pricing, undefined, undefined, (event) => recordPricingTiming(run!, event)));
    const audit = await withRunSpan(run, { phase: "deterministic-analysis", operation: "analyse-audit", source: "runner" }, async () => analyseAudit(scope, read, scope.harness, pricing));
    const after = await withRunSpan(run, { phase: "source-inventory", operation: "inventory-scoped-files-after", source: "filesystem", attempt: 2 }, () => captureSourceInventory(scope.harness, read.sourceFiles));
    await setRunSourceInventory(run, before, after);
    if (run.manifest.sourceInventory?.mutated === true && !audit.coverage.warnings.includes("History source files changed while the Audit was being read.")) {
      audit.coverage.warnings.push("History source files changed while the Audit was being read.");
    }
    await writeRunArtifact(run, "audit", audit);
    await writeRunArtifact(run, "firstUserMessages", read.firstUserMessages ?? []);
    await setRunTopSessions(run, audit.rankings.sessions, read.sessions);
    await setRunAuditFingerprint(run, auditFingerprint(audit));
    const totalTasks = typeof audit.summary.sessionCount?.value === "number" ? audit.summary.sessionCount.value : 0;
    const candidatesResult = await withRunSpan(run, { phase: "skill-candidate-select", operation: "select-skill-candidates", source: "runner" }, async () => {
      return selectSkillCandidates(audit.report.skills ?? [], totalTasks);
    });
    const snapshot = await withRunSpan(run, { phase: "skill-snapshot", operation: "load-skill-snapshot", source: "filesystem" }, async () => {
      return loadSkillSnapshot(scope.harness, scope.cwd, candidatesResult.candidates, auditFingerprint(audit), candidatesResult.global);
    });
    const finalBundle = await verifyInstalledSkill();
    assertRunBundleVersion(run, finalBundle.bundleVersion);
    await writeRunArtifact(run, "skillSnapshot", snapshot);
    await setReportRunStatus(run, "prepared");
    outputRunSummary(run, { next: ["evidence", "report-synthesis", "key-session-analysis", "skill-insights", "compose", "finalize"] });
    return 0;
  } catch (error) {
    if (run) await markPreparedRunFailed(run);
    throw error;
  }
}

async function reportRunEvidenceMain(args: string[]): Promise<number> {
  const { runDir, rest } = extractRunDirectory(args);
  const auto = rest.length === 1 && rest[0] === "--auto";
  if (rest.length > 0 && !auto) throw new Error(`Unknown report-run evidence argument: ${rest[0]}.\n${usage()}`);
  const installedBundle = await verifyInstalledSkill();
  const run = await openReportRun(requireRunDirectory(runDir));
  assertRunBundleVersion(run, installedBundle.bundleVersion);
  const audit = await readCanonicalAudit(run);
  const input: EvidenceInput = auto
    ? await withRunSpan(run, { phase: "content-selection", operation: "auto-evidence-selection", source: "runner" }, async () => ({
      selections: run.manifest.topSessions.slice(0, 3).map((session) => ({
        sessionId: session.sessionId,
        turnIds: audit.turns.filter((turn) => turn.sessionId === session.sessionId).slice(0, 8).map((turn) => turn.turnId),
        selectionReason: "Audit Top 3 Token-ranked Session auto selection",
        unreadScope: "remaining Turns in the same selected Session and Audit Scope",
      })),
    }))
    : await withRunSpan(run, { phase: "content-selection", operation: "parse-evidence-selection", source: "runner" }, async () => parseEvidenceInput(await readStdin()));
  const maxItemsPerSession = input.maxItemsPerSession ?? 24;
  const maxCharsPerItem = input.maxCharsPerItem ?? 1200;
  const existing = run.manifest.artifacts.evidence ? await readRunArtifact(run.runDir, "evidence") : null;
  if (existing !== null) {
    if (!evidenceArtifactMatches(existing, run, input)) throw new Error("Report Run already contains Evidence for a different selection or limit; start a new run for a different request.");
    const cached = existing as RunEvidenceArtifact;
    await recordCompletedRunSpan(run, {
      phase: "content-read",
      operation: "reuse-content-evidence",
      source: "filesystem",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: 0,
      status: "reused",
      metadata: { itemCount: cached.packets.reduce((sum, packet) => sum + packet.items.length, 0) },
    });
    await setReportRunStatus(run, "evidence-ready");
    outputRunSummary(run, { evidence: packetSummary(cached.packets), reused: true });
    return 0;
  }
  const scope = scopeFromManifest(run.manifest) as ContentEvidenceRequest["scope"];
  const evidenceRequest: ContentEvidenceRequest = {
    scope: { ...scope, harness: run.manifest.scope.harness },
    audit,
    selections: input.selections,
    maxItemsPerSession,
    maxCharsPerItem,
    sessionFiles: (run.manifest.topSessions ?? [])
      .filter((s) => typeof s.filePath === 'string' && s.filePath.length > 0)
      .map((s) => ({ sessionId: s.sessionId, filePath: s.filePath! })),
  };
  const packets = await withRunSpan(run, { phase: "content-read", operation: "read-content-evidence", source: "filesystem" }, async () => {
    const value = await readContentEvidence(evidenceRequest);
    const artifact: RunEvidenceArtifact = {
      version: 1,
      runId: run.manifest.runId,
      auditFingerprint: run.manifest.auditFingerprint!,
      scope: run.manifest.scope,
      selections: input.selections,
      maxItemsPerSession,
      maxCharsPerItem,
      packets: value,
    };
    await writeRunArtifact(run, "evidence", artifact);
    return value;
  });
  await setReportRunStatus(run, "evidence-ready");
  outputRunSummary(run, { evidence: packetSummary(packets), reused: false });
  return 0;
}

interface RunComposeOptions extends ComposeReportOptions {
  runDir: string;
}

function parseRunComposeArgs(args: string[]): RunComposeOptions {
  const extracted = extractRunDirectory(args);
  return { ...parseComposeArgs(extracted.rest), runDir: requireRunDirectory(extracted.runDir) };
}

function assertRunContract(run: ReportRun, installedBundle: Awaited<ReturnType<typeof verifyInstalledSkill>>, contract: Awaited<ReturnType<typeof resolveRunContractMetadata>>): void {
  assertRunBundleVersion(run, installedBundle.bundleVersion);
  if (!contract.runtimeHash || !contract.promptHashes.reportSynthesis || !contract.promptHashes.keySessionAnalysis || !contract.promptHashes.skillInsights) throw new Error("Authoritative Report Prompts or runtime contract is unavailable.");
  if (!contract.bundleVersion || contract.bundleVersion.bundleVersion !== run.manifest.bundleVersion) throw new Error("Report Run bundle version changed during execution. Run npm run install-local.");
  if (run.manifest.runtimeHash !== contract.runtimeHash || run.manifest.promptHashes.reportSynthesis !== contract.promptHashes.reportSynthesis || run.manifest.promptHashes.keySessionAnalysis !== contract.promptHashes.keySessionAnalysis || run.manifest.promptHashes.skillInsights !== contract.promptHashes.skillInsights) throw new Error("Report Prompt or runtime contract changed during execution; the Run cannot continue. Run npm run install-local.");
}

async function reportRunAiStartMain(args: string[]): Promise<number> {
  const { runDir, lane } = parseLaneCommandArgs(args);
  const installedBundle = await verifyInstalledSkill();
  const run = await openReportRun(runDir);
  const contract = await resolveRunContractMetadata();
  assertRunContract(run, installedBundle, contract);
  const audit = await readCanonicalAudit(run);
  let input: Record<string, unknown>;
  let snapshotId: string | undefined;
  if (lane === "report-synthesis") {
    input = { version: 1, runId: run.manifest.runId, lane, locale: run.manifest.scope.locale, auditFingerprint: run.manifest.auditFingerprint, audit };
  } else if (lane === "key-session-analysis") {
    const evidence = run.manifest.artifacts.evidence ? await readRunArtifact(run.runDir, "evidence") : null;
    if (!evidence) throw new Error("Key Session Analysis requires report-run evidence --auto before ai-start.");
    input = { version: 1, runId: run.manifest.runId, lane, locale: run.manifest.scope.locale, auditFingerprint: run.manifest.auditFingerprint, audit, evidence };
  } else {
    if (!run.manifest.artifacts.skillSnapshot) throw new Error("Skill Insights requires a frozen Skill Snapshot.");
    const snapshot = await readRunArtifact(run.runDir, "skillSnapshot") as SkillSnapshotArtifact;
    snapshotId = snapshot.snapshotId;
    input = { version: 1, runId: run.manifest.runId, lane, locale: run.manifest.scope.locale, auditFingerprint: run.manifest.auditFingerprint, snapshot };
  }
  const inputRef = await writeRunLaneArtifact(run, lane, "input", input);
  const promptRef = await writeRunLaneArtifact(run, lane, "prompt", { version: 1, lane, promptHash: lanePromptHash(run.manifest, lane), bundleVersion: run.manifest.bundleVersion });
  const started = await startReportLane(run, lane, inputRef.file);
  process.stdout.write(JSON.stringify({
    runId: run.manifest.runId,
    lane,
    attempt: started.attempt,
    spanId: started.spanId,
    locale: run.manifest.scope.locale,
    auditFingerprint: run.manifest.auditFingerprint,
    bundleVersion: run.manifest.bundleVersion,
    promptHash: lanePromptHash(run.manifest, lane),
    runtimeHash: run.manifest.runtimeHash,
    inputArtifact: inputRef.file,
    promptArtifact: promptRef.file,
    ...(snapshotId ? { snapshotId } : {}),
  }) + "\n");
  return 0;
}

function parseAiAcceptArgs(args: string[]): { runDir: string; lane: ReportLane; attempt: number | null; spanId: string | null } {
  const extracted = extractRunDirectory(args);
  let lane: ReportLane | null = null;
  let attempt: number | null = null;
  let spanId: string | null = null;
  for (let index = 0; index < extracted.rest.length; index += 1) {
    const flag = extracted.rest[index];
    if (flag === "--lane") lane = parseLane(requireValue(extracted.rest, index, flag));
    else if (flag === "--attempt") {
      const value = Number(requireValue(extracted.rest, index, flag));
      if (!Number.isInteger(value) || value < 1) throw new Error("--attempt must be a positive integer.");
      attempt = value;
    } else if (flag === "--span-id") spanId = requireValue(extracted.rest, index, flag);
    else throw new Error(`Unknown ai-accept argument: ${flag}.`);
    index += 1;
  }
  if (!lane) throw new Error("--lane is required.");
  return { runDir: requireRunDirectory(extracted.runDir), lane, attempt, spanId };
}

async function readHostResponseTiming(
  run: ReportRun,
  lane: ReportLane,
  currentLane: ReportRunManifest["laneStatus"][ReportLane],
  outputHash: string,
): Promise<{ durationMs: number; metadata: Record<string, string | number | boolean | null> } | null> {
  const file = path.join(run.runDir, `lanes/${lane}/host-response.json`);
  let contents: string;
  try {
    contents = await fs.readFile(file, "utf8");
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error("HOST_RESPONSE_INVALID:json");
  }
  const value = isRecord(parsed) ? parsed : null;
  const provenance = value && isRecord(value.provenance) ? value.provenance : null;
  const expectedPromptHash = lanePromptHash(run.manifest, lane);
  const errors: string[] = [];
  if (!value || value.kind !== "host-agent-response" || value.source !== "codex-host-agent") errors.push("kind/source");
  if (!value || value.runId !== run.manifest.runId || value.lane !== lane || value.auditFingerprint !== run.manifest.auditFingerprint) errors.push("run binding");
  if (!value || value.bundleVersion !== run.manifest.bundleVersion || value.promptHash !== expectedPromptHash || value.inputArtifact !== currentLane.inputArtifact || value.promptArtifact !== `lanes/${lane}/prompt.json`) errors.push("contract binding");
  if (!value || value.outputHash !== outputHash) errors.push("output hash");
  if (!provenance || provenance.status !== "completed" || typeof provenance.threadId !== "string" || typeof provenance.turnId !== "string" || typeof provenance.responseItemId !== "string" || typeof provenance.durationMs !== "number" || !Number.isFinite(provenance.durationMs) || provenance.durationMs < 0) errors.push("provenance");
  if (errors.length > 0) throw new Error(`HOST_RESPONSE_INVALID:${errors.join(",")}`);
  return {
    durationMs: provenance!.durationMs as number,
    metadata: {
      timingScope: "host-agent-wall",
      hostResponseFile: `lanes/${lane}/host-response.json`,
      hostResponseSha256: sha256Text(contents),
      hostThreadId: provenance!.threadId as string,
      hostTurnId: provenance!.turnId as string,
      hostResponseItemId: provenance!.responseItemId as string,
    },
  };
}

async function reportRunAiAcceptMain(args: string[]): Promise<number> {
  const options = parseAiAcceptArgs(args);
  const installedBundle = await verifyInstalledSkill();
  const run = await openReportRun(options.runDir);
  const contract = await resolveRunContractMetadata();
  assertRunContract(run, installedBundle, contract);
  const currentLane = run.manifest.laneStatus[options.lane];
  if (!currentLane || currentLane.status !== "running") throw new Error(`Lane ${options.lane} is not running; start it with report-run ai-start.`);
  const attempt = options.attempt ?? currentLane.attempts;
  if (attempt !== currentLane.attempts) throw new Error(`Lane ${options.lane} attempt does not match the current Run attempt.`);
  const spanId = options.spanId ?? run.manifest.stageStatus[options.lane]?.spanId;
  if (!spanId) throw new Error(`Lane ${options.lane} span is unavailable.`);
  const activeSpanId = run.manifest.stageStatus[options.lane]?.spanId;
  if (!activeSpanId || spanId !== activeSpanId) throw new Error("RUN_LANE_SPAN_MISMATCH");
  const input = await readRunLaneArtifact(run.runDir, options.lane, "input") as Record<string, unknown>;
  if (input.runId !== run.manifest.runId || input.auditFingerprint !== run.manifest.auditFingerprint) throw new Error("Lane input artifact is not bound to this Report Run.");
  const rawText = await readStdin();
  const outputHash = sha256Text(rawText);
  let raw: unknown;
  let parseError: string | null = null;
  try {
    raw = JSON.parse(rawText);
  } catch {
    parseError = "MODEL_OUTPUT_INVALID_JSON";
    raw = { invalidJson: true };
  }
  const rawRef = await writeRunLaneRawArtifact(run, options.lane, rawText, attempt);
  if (rawRef.sha256 !== outputHash) throw new Error("RUN_LANE_RAW_HASH_MISMATCH");
  const hostTiming = await readHostResponseTiming(run, options.lane, currentLane, outputHash);
  let errors: Array<{ code: string; fieldPath: string | null; message: string }> = parseError ? [{ code: parseError, fieldPath: null, message: "Model output was not valid JSON." }] : [];
  let validationRejectionReasons: string[] = [];
  let unsupportedClaimsDropped = 0;
  let accepted: unknown = null;
  let validationAccepted = false;
  if (!parseError) {
    const audit = await readCanonicalAudit(run);
    if (options.lane === "report-synthesis") {
      const result = validateReportSynthesis(audit, raw);
      if (result.valid) {
        accepted = result.synthesis;
        validationAccepted = true;
      }
      else errors = result.errors.map((message) => ({ code: "REPORT_SYNTHESIS_INVALID", fieldPath: null, message }));
    } else if (options.lane === "key-session-analysis") {
      const packets = run.manifest.artifacts.evidence ? (await readRunArtifact(run.runDir, "evidence") as RunEvidenceArtifact).packets : [];
      const candidates = Array.isArray(raw) ? raw.slice(0, 3) : [];
      const validated: KeySessionAnalysis[] = [];
      for (const [index, candidate] of candidates.entries()) {
        if (!isRecord(candidate) || typeof candidate.sessionId !== "string") {
          errors.push({ code: "KEY_SESSION_INVALID", fieldPath: `[${index}]`, message: "Key Session Analysis entry is malformed." });
          continue;
        }
        const result = validateKeySessionAnalysis(audit, candidate as unknown as KeySessionAnalysis, packets.filter((packet) => packet.sessionId === candidate.sessionId));
        if (result.valid) validated.push(result.analysis ?? candidate as unknown as KeySessionAnalysis);
        else errors.push(...result.errors.map((message) => ({ code: "KEY_SESSION_INVALID", fieldPath: `[${index}]`, message })));
      }
      if (candidates.length === 0) errors.push({ code: "KEY_SESSION_INVALID", fieldPath: null, message: "Expected a non-empty Key Session Analysis array." });
      if (errors.length === 0) {
        accepted = validated;
        validationAccepted = true;
      }
    } else {
      const snapshot = await readRunArtifact(run.runDir, "skillSnapshot") as SkillSnapshotArtifact;
      const result = validateSkillInsights(raw, snapshot);
      validationRejectionReasons = result.rejectionReasons;
      unsupportedClaimsDropped = result.unsupportedClaimsDropped;
      errors = result.errors.map((message) => ({ code: "SKILL_INSIGHTS_INVALID", fieldPath: null, message }));
      if (result.valid && result.insights.length > 0) {
        accepted = result.insights;
        validationAccepted = true;
      }
    }
  }
  const validationStatus = validationAccepted ? "accepted" : "rejected";
  await writeRunLaneArtifact(run, options.lane, "validation", {
    version: 1, runId: run.manifest.runId, lane: options.lane, attempt, status: validationStatus,
    outputHash,
    errors,
    rejectionReasons: [...new Set([...errors.map((error) => error.code), ...validationRejectionReasons])],
    ...(unsupportedClaimsDropped > 0 ? { unsupportedClaimsDropped } : {}),
    ...(hostTiming ? { generation: hostTiming.metadata } : {}),
  }, attempt);
  let acceptedRef: { file: string } | null = null;
  if (validationAccepted) {
    const snapshotId = options.lane === "skill-insights"
      ? (await readRunArtifact(run.runDir, "skillSnapshot") as SkillSnapshotArtifact).snapshotId
      : undefined;
    acceptedRef = await writeRunLaneArtifact(run, options.lane, "accepted", {
      version: 1,
      runId: run.manifest.runId,
      lane: options.lane,
      attempt,
      outputHash,
      ...(snapshotId ? { snapshotId } : {}),
      value: accepted,
    });
  }
  const durationMs = hostTiming?.durationMs ?? (currentLane.spanStartedAt ? Math.max(0, Date.now() - Date.parse(currentLane.spanStartedAt)) : null);
  await finishReportLane(run, options.lane, attempt, spanId, currentLane.spanStartedAt ?? new Date().toISOString(), validationAccepted ? "accepted" : "failed", durationMs, validationAccepted ? null : errors[0]?.code ?? "AI_VALIDATION_FAILED", acceptedRef?.file ?? null, hostTiming ? "host-agent" : "runner", hostTiming?.metadata);
  process.stdout.write(JSON.stringify({ runId: run.manifest.runId, lane: options.lane, attempt, status: validationStatus, outputHash, rawArtifact: rawRef.file, validationArtifact: `lanes/${options.lane}/attempt-${attempt}.validation.json`, acceptedArtifact: acceptedRef?.file ?? null, errors }) + "\n");
  return validationAccepted ? 0 : 2;
}

function parseAiFallbackArgs(args: string[]): { runDir: string; lane: ReportLane; status: "fallback" | "unavailable"; reasonCode: string } {
  const extracted = extractRunDirectory(args);
  let lane: ReportLane | null = null;
  let status: "fallback" | "unavailable" = "fallback";
  let reasonCode = "AI_UNAVAILABLE";
  for (let index = 0; index < extracted.rest.length; index += 1) {
    const flag = extracted.rest[index];
    if (flag === "--lane") lane = parseLane(requireValue(extracted.rest, index, flag));
    else if (flag === "--status") {
      const value = requireValue(extracted.rest, index, flag);
      if (value !== "fallback" && value !== "unavailable") throw new Error("--status must be fallback or unavailable.");
      status = value;
    } else if (flag === "--reason-code") {
      reasonCode = requireValue(extracted.rest, index, flag);
      if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(reasonCode)) throw new Error("--reason-code must be a short safe label.");
    } else throw new Error(`Unknown ai-fallback argument: ${flag}.`);
    index += 1;
  }
  if (!lane) throw new Error("--lane is required.");
  return { runDir: requireRunDirectory(extracted.runDir), lane, status, reasonCode };
}

async function reportRunAiFallbackMain(args: string[]): Promise<number> {
  const options = parseAiFallbackArgs(args);
  const installedBundle = await verifyInstalledSkill();
  const run = await openReportRun(options.runDir);
  const contract = await resolveRunContractMetadata();
  assertRunContract(run, installedBundle, contract);
  const currentLane = run.manifest.laneStatus[options.lane];
  if (!currentLane || currentLane.status !== "running") throw new Error(`Lane ${options.lane} is not running; start it with report-run ai-start.`);
  const attempt = currentLane.attempts;
  const spanId = run.manifest.stageStatus[options.lane]?.spanId;
  if (!spanId) throw new Error(`Lane ${options.lane} span is unavailable.`);
  const fallbackRef = await writeRunLaneArtifact(run, options.lane, "fallback", {
    version: 1,
    runId: run.manifest.runId,
    lane: options.lane,
    attempt,
    status: options.status,
    reasonCode: options.reasonCode,
  }, attempt);
  const durationMs = currentLane.spanStartedAt ? Math.max(0, Date.now() - Date.parse(currentLane.spanStartedAt)) : null;
  await finishReportLane(run, options.lane, attempt, spanId, currentLane.spanStartedAt ?? new Date().toISOString(), options.status, durationMs, options.reasonCode, null);
  process.stdout.write(JSON.stringify({ runId: run.manifest.runId, lane: options.lane, attempt, status: options.status, reasonCode: options.reasonCode, fallbackArtifact: fallbackRef.file }) + "\n");
  return 0;
}

function validExternalSource(value: unknown): value is ExternalSpanEvent["source"] {
  return value === "runner" || value === "skill" || value === "host-agent" || value === "network" || value === "filesystem" || value === "ui";
}

function validTerminalStatus(value: unknown): value is Exclude<ExternalSpanEvent["status"], undefined> {
  return value === "completed" || value === "failed" || value === "fallback" || value === "queued" || value === "reused" || value === "skipped" || value === "unavailable" || value === "interrupted";
}

async function reportRunComposeMain(args: string[]): Promise<number> {
  const options = parseRunComposeArgs(args);
  const installedBundle = await verifyInstalledSkill();
  const run = await openReportRun(options.runDir);
  assertRunBundleVersion(run, installedBundle.bundleVersion);
  if (options.locale !== run.manifest.scope.locale) throw new Error("Report Run locale does not match the compose request.");
  const audit = await readCanonicalAudit(run);
  const runFingerprint = run.manifest.auditFingerprint;
  if (!runFingerprint) throw new Error("Report Run Audit fingerprint is unavailable.");
  const composeStdin = await readStdin();
  if (composeStdin.trim()) throw new Error("REPORT_COMPOSE_STDIN_FORBIDDEN: normal report-run compose reads only registered Run lane artifacts.");
  await setReportRunStatus(run, "composing");
  let synthesisCandidate: ReportSynthesis | null = null;
  let analyses: KeySessionAnalysis[] = [];
  let validatedSynthesis: ReportSynthesis | null = null;
  let packets: ContentEvidencePacket[] | undefined;
  let validatedSkillInsights: ValidatedSkillInsight[] = [];
  let skillInsightsSnapshotId: string | null = null;
  let skillInsightsStatus: RunAiArtifact<ValidatedSkillInsight[]>["status"] = "skipped";
  let skillInsightsValid = false;
  let skillInsightsRejectionReasons: string[] = [];
  try {
      const currentContract = await withRunSpan(run, { phase: "prompt-read", operation: "verify-report-contract", source: "filesystem" }, async () => {
        const metadata = await resolveRunContractMetadata();
        if (!metadata.promptHashes.reportSynthesis || !metadata.promptHashes.keySessionAnalysis || !metadata.promptHashes.skillInsights || !metadata.runtimeHash) throw new Error("Authoritative Report Prompts or runtime contract is unavailable.");
        if (!metadata.bundleVersion || metadata.bundleVersion.bundleVersion !== run.manifest.bundleVersion) throw new Error("Report Run bundle version changed during execution. Run npm run install-local.");
        return metadata;
      });
      const currentPromptHashes = {
        reportSynthesis: currentContract.promptHashes.reportSynthesis!,
        keySessionAnalysis: currentContract.promptHashes.keySessionAnalysis!,
        skillInsights: currentContract.promptHashes.skillInsights!,
      };
      const currentRuntimeHash = currentContract.runtimeHash!;
    if (run.manifest.artifacts.evidence) {
      const value = await readRunArtifact(run.runDir, "evidence");
      if (!isRecord(value) || value.version !== 1 || value.runId !== run.manifest.runId || value.auditFingerprint !== run.manifest.auditFingerprint || JSON.stringify(value.scope) !== JSON.stringify(run.manifest.scope) || !Array.isArray(value.packets)) throw new Error("Report Run Evidence artifact is stale or malformed.");
      packets = value.packets as ContentEvidencePacket[];
    }
    await withRunSpan(run, { phase: "validation", operation: "validate-ai-output", source: "runner" }, async () => {
      const input = await readStdin();
      let normalizedInput = input;
      if (!input.trim()) {
        let acceptedSynthesis: unknown = null;
        let acceptedAnalyses: unknown[] = [];
        let acceptedSkills: unknown = null;
        try { acceptedSynthesis = (await readRunLaneArtifact(run.runDir, "report-synthesis", "accepted") as Record<string, unknown>).value ?? null; } catch { acceptedSynthesis = null; }
        try {
          const value = (await readRunLaneArtifact(run.runDir, "key-session-analysis", "accepted") as Record<string, unknown>).value;
          acceptedAnalyses = Array.isArray(value) ? value : [];
        } catch { acceptedAnalyses = []; }
        try {
          const acceptedArtifact = await readRunLaneArtifact(run.runDir, "skill-insights", "accepted") as Record<string, unknown>;
          acceptedSkills = typeof acceptedArtifact.snapshotId === "string" && Array.isArray(acceptedArtifact.value)
            ? { snapshotId: acceptedArtifact.snapshotId, insights: acceptedArtifact.value }
            : null;
        } catch { acceptedSkills = null; }
        normalizedInput = JSON.stringify({
          runId: run.manifest.runId,
          auditFingerprint: run.manifest.auditFingerprint,
          promptHashes: currentPromptHashes,
          runtimeHash: currentRuntimeHash,
          reportSynthesis: acceptedSynthesis,
          keySessionAnalyses: acceptedAnalyses,
          skillInsights: acceptedSkills,
        });
      }
      const parsed: unknown = JSON.parse(normalizedInput);
      if (!isRecord(parsed)) throw new Error("report-run compose requires a JSON object.");
      if (parsed.runId !== run.manifest.runId || parsed.auditFingerprint !== run.manifest.auditFingerprint) throw new Error("AI output runId or Audit fingerprint does not match the Report Run.");
      if ("audit" in parsed) throw new Error("AI output must not carry a second AuditResult; use the canonical Report Run artifact.");
      if (!isRecord(parsed.promptHashes) || parsed.promptHashes.reportSynthesis !== currentContract.promptHashes.reportSynthesis || parsed.promptHashes.keySessionAnalysis !== currentContract.promptHashes.keySessionAnalysis || parsed.promptHashes.skillInsights !== currentContract.promptHashes.skillInsights || parsed.runtimeHash !== currentContract.runtimeHash) throw new Error("AI output Prompt or runtime contract does not match the current Report Run.");
      if (run.manifest.promptHashes.reportSynthesis !== currentContract.promptHashes.reportSynthesis || run.manifest.promptHashes.keySessionAnalysis !== currentContract.promptHashes.keySessionAnalysis || run.manifest.promptHashes.skillInsights !== currentContract.promptHashes.skillInsights || run.manifest.runtimeHash !== currentContract.runtimeHash) throw new Error("Report Prompt or runtime contract changed during execution; the Run cannot continue. Run npm run install-local.");
      if (parsed.reportSynthesis === undefined) {
        const fileCandidate = path.join(run.runDir, "report-synthesis.json");
        try {
          synthesisCandidate = JSON.parse(await fs.readFile(fileCandidate, "utf8")) as ReportSynthesis;
        } catch {
          synthesisCandidate = null;
        }
      } else {
        synthesisCandidate = parsed.reportSynthesis === null ? null : parsed.reportSynthesis as ReportSynthesis;
      }
      if (parsed.keySessionAnalyses === undefined) {
        const fileCandidate = path.join(run.runDir, "key-session-analyses.json");
        try {
          const loaded = JSON.parse(await fs.readFile(fileCandidate, "utf8"));
          analyses = (Array.isArray(loaded) ? loaded : []).slice(0, 3) as KeySessionAnalysis[];
        } catch {
          analyses = [];
        }
      } else {
        const suppliedAnalyses = Array.isArray(parsed.keySessionAnalyses) ? parsed.keySessionAnalyses : [];
        analyses = suppliedAnalyses.slice(0, 3) as KeySessionAnalysis[];
      }
      if (analyses.length > 3) await appendRunWarnings(run, ["More than three Key Session Analyses were supplied; only the Token-ranked Top 3 are eligible."]);
      if (analyses.length > 0 && packets === undefined) throw new Error("Key Session Analysis requires the run-scoped Evidence artifact.");

      let rawSkillInsights: unknown = undefined;
      if (parsed.skillInsights === undefined) {
        const fileCandidate = path.join(run.runDir, "skill-insights.json");
        try {
          rawSkillInsights = JSON.parse(await fs.readFile(fileCandidate, "utf8"));
        } catch {
          rawSkillInsights = null;
        }
      } else {
        rawSkillInsights = parsed.skillInsights;
      }

      if (rawSkillInsights !== undefined && rawSkillInsights !== null) {
        skillInsightsStatus = "fallback";
      }
      if (run.manifest.artifacts.skillSnapshot) {
        try {
          const snapshot = await readRunArtifact(run.runDir, "skillSnapshot") as SkillSnapshotArtifact;
          if (snapshot) {
            skillInsightsSnapshotId = snapshot.snapshotId;
            if (rawSkillInsights) {
              const validation = validateSkillInsights(rawSkillInsights, snapshot);
              skillInsightsRejectionReasons = validation.rejectionReasons;
              if (validation.valid) {
                validatedSkillInsights = validation.insights;
                skillInsightsValid = true;
                skillInsightsStatus = "completed";
              }
              if (validation.errors.length > 0) {
                  await appendRunWarnings(run, [`Skill Insights validation: ${validation.errors.join("; ")}`]);
              }
            } else if (snapshot.selectedSkills.some((skill) => skill.contentState === "available" && Boolean(skill.skillMdContent))) {
              skillInsightsRejectionReasons = ["usage_content_relation_unclear"];
            }
          }
        } catch {
          // ignore error reading snapshot
        }
      }

      const synthesisValidation = validateReportSynthesis(audit, synthesisCandidate);
      validatedSynthesis = synthesisValidation.valid ? synthesisValidation.synthesis : null;
       if (!synthesisValidation.valid) await appendRunWarnings(run, ["Report Synthesis was unavailable or failed validation; deterministic fallback is used."]);
      const keyValidation = analyses.map((candidate) => {
        if (!isRecord(candidate)) return { valid: false, errors: ["Candidate analysis is not an object."] };
        try {
          return validateKeySessionAnalysis(audit, candidate as KeySessionAnalysis, packets?.filter((packet) => packet.sessionId === candidate.sessionId));
        } catch (error) {
          return { valid: false, errors: [error instanceof Error ? error.message : String(error)] };
        }
      });
      const validKeyCount = keyValidation.filter((result) => result.valid).length;
      const invalidKeys = keyValidation.filter((result) => !result.valid);
      const invalidKeyCount = invalidKeys.length;
      if (invalidKeyCount > 0) {
        const errorDetails = invalidKeys.flatMap((result) => result.errors).filter(Boolean);
        await appendRunWarnings(run, [`${invalidKeyCount} Key Session Analysis entr${invalidKeyCount === 1 ? "y" : "ies"} failed validation and will be omitted.${errorDetails.length > 0 ? " Reasons: " + errorDetails.join("; ") : ""}`]);
      }
      await writeRunArtifact(run, "reportSynthesis", {
        version: 1,
        runId: run.manifest.runId,
        auditFingerprint: runFingerprint,
        promptHashes: currentPromptHashes,
        runtimeHash: currentRuntimeHash,
        attempt: run.manifest.stageStatus["report-synthesis"]?.attempt ?? null,
        status: synthesisValidation.valid ? "completed" : "fallback",
        value: synthesisCandidate,
        valid: synthesisValidation.valid,
      } satisfies RunAiArtifact<ReportSynthesis | null>);
      await writeRunArtifact(run, "keySessionAnalyses", {
        version: 1,
        runId: run.manifest.runId,
        auditFingerprint: runFingerprint,
        promptHashes: currentPromptHashes,
        runtimeHash: currentRuntimeHash,
        attempt: run.manifest.stageStatus["key-session-analysis"]?.attempt ?? null,
        status: analyses.length === 0 ? "skipped" : invalidKeyCount > 0 ? "fallback" : "completed",
        value: analyses,
        validCount: validKeyCount,
        invalidCount: invalidKeyCount,
      } satisfies RunAiArtifact<KeySessionAnalysis[]>);
      await writeRunArtifact(run, "skillInsights", {
        version: 1,
        runId: run.manifest.runId,
        auditFingerprint: runFingerprint,
        promptHashes: currentPromptHashes,
        runtimeHash: currentRuntimeHash,
        attempt: run.manifest.stageStatus["skill-insights"]?.attempt ?? null,
        snapshotId: skillInsightsSnapshotId,
        status: skillInsightsStatus,
        value: validatedSkillInsights,
        valid: skillInsightsValid,
        rejectionReasons: skillInsightsRejectionReasons,
      } satisfies RunAiArtifact<ValidatedSkillInsight[]>);
    });
    const composition = await withRunSpan(run, { phase: "compose", operation: "compose-report", source: "runner" }, async () => reportComposition(audit, analyses, validatedSynthesis, packets, validatedSkillInsights, skillInsightsSnapshotId ?? undefined));
    await writeRunArtifact(run, "composition", {
      runId: run.manifest.runId,
      auditFingerprint: run.manifest.auditFingerprint,
      reportSynthesis: composition.reportSynthesis,
      keySessionAnalyses: composition.keySessionAnalyses,
      skillInsights: composition.skillInsights,
      skillInsightsSnapshotId: composition.skillInsightsSnapshotId,
    });
    const firstUserMessages = run.manifest.artifacts.firstUserMessages
      ? await readRunArtifact(run.runDir, "firstUserMessages") as FirstUserMessageRecord[]
      : [];
    const projectName = run.manifest.scope.cwd ? resolveReportProjectName(run.manifest.scope.cwd) ?? undefined : undefined;
    const renderComposition = projectName ? { ...composition, projectName } : composition;
    const fontConfig = reportFontConfig(options.fontPath, options.fontFamily);
    const rendered = await withRunSpan(run, { phase: "render", operation: "render-html", source: "runner" }, async () => renderHtml(audit, options.locale, renderComposition, firstUserMessages, fontConfig));
    const subsetted = await withRunSpan(run, { phase: "font-subset", operation: "subset-report-fonts", source: "runner" }, async () => subsetReportFonts(rendered));
    const output = await withRunSpan(run, { phase: "html-write", operation: "write-final-html", source: "filesystem" }, async () => {
      await writeRunTextArtifact(run, "html", subsetted);
      return writeAtomicLocal(options.htmlPath, subsetted);
    });
    outputRunSummary(run, {
      reportStatus: composition.reportSynthesis ? "ai-enhanced" : "fallback",
      fallback: composition.reportSynthesis === null,
      htmlPath: output,
      next: ["record codex-open", "finalize"],
    });
    return 0;
  } catch (error) {
    await setReportRunStatus(run, "failed").catch(() => undefined);
    throw error;
  }
}

async function reportRunEventMain(args: string[]): Promise<number> {
  const { runDir, rest } = extractRunDirectory(args);
  if (rest.length > 0) throw new Error(`Unknown report-run event argument: ${rest[0]}.\n${usage()}`);
  const installedBundle = await verifyInstalledSkill();
  const input = await readStdin();
  if (!input.trim()) throw new Error("report-run event requires one JSON event object on stdin.");
  const parsed: unknown = JSON.parse(input);
  if (!isRecord(parsed) || (parsed.event !== "start" && parsed.event !== "end") || typeof parsed.phase !== "string" || typeof parsed.operation !== "string" || !validExternalSource(parsed.source)) throw new Error("report-run event requires event, phase, operation, and a supported source.");
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(parsed.phase) || !/^[A-Za-z0-9_.:-]{1,128}$/.test(parsed.operation)) throw new Error("report-run event phase and operation must be short safe labels.");
  const spanId = typeof parsed.spanId === "string" && parsed.spanId ? parsed.spanId : randomUUID();
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(spanId)) throw new Error("report-run event spanId must be a short safe label.");
  const startedAt = typeof parsed.startedAt === "string" ? parsed.startedAt : new Date().toISOString();
  if (startedAt.length > 64 || /[\r\n]/.test(startedAt)) throw new Error("report-run event startedAt is invalid.");
  const event: ExternalSpanEvent = {
    event: parsed.event,
    spanId,
    phase: parsed.phase,
    operation: parsed.operation,
    source: parsed.source,
    startedAt,
    ...(typeof parsed.endedAt === "string" ? { endedAt: parsed.endedAt } : {}),
    ...(typeof parsed.durationMs === "number" ? { durationMs: parsed.durationMs } : {}),
    ...(typeof parsed.parentSpanId === "string" || parsed.parentSpanId === null ? { parentSpanId: parsed.parentSpanId } : {}),
    ...(typeof parsed.attempt === "number" ? { attempt: parsed.attempt } : {}),
    ...(validTerminalStatus(parsed.status) ? { status: parsed.status } : {}),
    ...(typeof parsed.errorCode === "string" ? { errorCode: parsed.errorCode } : {}),
    ...(isRecord(parsed.metadata) ? { metadata: parsed.metadata as ExternalSpanEvent["metadata"] } : {}),
  };
  if (event.event === "end" && !event.endedAt) event.endedAt = new Date().toISOString();
  if (event.endedAt && (event.endedAt.length > 64 || /[\r\n]/.test(event.endedAt))) throw new Error("report-run event endedAt is invalid.");
  const resolvedRunDir = requireRunDirectory(runDir);
  const currentRun = await openReportRun(resolvedRunDir);
  if (currentRun.manifest.bundleVersion) assertRunBundleVersion(currentRun, installedBundle.bundleVersion);
  const manifest = await recordRunSpan(resolvedRunDir, event);
  process.stdout.write(JSON.stringify({ runId: manifest.runId, runDir: resolvedRunDir, status: manifest.status, phase: event.phase, traceCompleteness: manifest.traceCompleteness }) + "\n");
  return 0;
}

async function reportRunStatusMain(args: string[]): Promise<number> {
  const { runDir, rest } = extractRunDirectory(args);
  if (rest.length > 0) throw new Error(`Unknown report-run status argument: ${rest[0]}.\n${usage()}`);
  const run = await openReportRun(requireRunDirectory(runDir));
  outputRunSummary(run);
  return 0;
}

async function reportRunFinalizeMain(args: string[]): Promise<number> {
  const { runDir, rest } = extractRunDirectory(args);
  let requested: "completed" | "failed" | "incomplete" = "completed";
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] !== "--status") throw new Error(`Unknown report-run finalize argument: ${rest[index]}.\n${usage()}`);
    const value = requireValue(rest, index, "--status");
    index += 1;
    if (value !== "completed" && value !== "failed" && value !== "incomplete") throw new Error("--status must be completed, failed, or incomplete.");
    requested = value;
  }
  const installedBundle = await verifyInstalledSkill();
  const run = await openReportRun(requireRunDirectory(runDir));
  assertRunBundleVersion(run, installedBundle.bundleVersion);
  await finalizeReportRun(run, requested);
  outputRunSummary(run);
  return requested === "completed" && run.manifest.status !== "completed" ? 2 : 0;
}

async function reportRunCleanupMain(args: string[]): Promise<number> {
  const { runDir, rest } = extractRunDirectory(args);
  if (rest.length > 0) throw new Error(`Unknown report-run cleanup argument: ${rest[0]}.\n${usage()}`);
  const run = await openReportRun(requireRunDirectory(runDir));
  if (!run.manifest.artifacts.html && run.manifest.status !== "failed" && run.manifest.status !== "incomplete") {
    throw new Error("REPORT_RUN_CLEANUP_REQUIRES_FINAL_HTML_OR_FAILED_STATUS");
  }
  const manifest = await cleanupSensitiveRunArtifacts(run);
  outputRunSummary(run, { sensitiveArtifacts: "cleaned", retention: manifest.retention });
  return 0;
}

async function reportRunMain(args: string[]): Promise<number> {
  const command = args[0];
  if (command === "prepare") return reportRunPrepareMain(args.slice(1));
  if (command === "evidence") return reportRunEvidenceMain(args.slice(1));
  if (command === "ai-start") return reportRunAiStartMain(args.slice(1));
  if (command === "ai-accept") return reportRunAiAcceptMain(args.slice(1));
  if (command === "ai-fallback") return reportRunAiFallbackMain(args.slice(1));
  if (command === "compose") return reportRunComposeMain(args.slice(1));
  if (command === "event") return reportRunEventMain(args.slice(1));
  if (command === "status") return reportRunStatusMain(args.slice(1));
  if (command === "finalize") return reportRunFinalizeMain(args.slice(1));
  if (command === "cleanup") return reportRunCleanupMain(args.slice(1));
  throw new Error(`Use report-run prepare, evidence, compose, event, status, finalize, or cleanup.\n${usage()}`);
}

async function composeReportMain(args: string[]): Promise<number> {
  const options = parseComposeArgs(args);
  const input = await readStdin();
  if (!input.trim()) throw new Error("compose-report requires one JSON composition envelope on stdin.");
  const parsed: unknown = JSON.parse(input);
  if (!isRecord(parsed) || !isRecord(parsed.audit)) {
    throw new Error("compose-report requires an envelope with a structured AuditResult under audit.");
  }

  const audit = parsed.audit as unknown as AuditResult;
  const expectedFingerprint = auditFingerprint(audit);
  const envelopeFingerprintMatches = parsed.auditFingerprint === expectedFingerprint;
  const synthesisValidation = envelopeFingerprintMatches
    ? validateReportSynthesis(audit, parsed.reportSynthesis ?? null)
    : { valid: false, errors: ["The supplied Audit fingerprint does not match the current Audit."], synthesis: null };
  const validatedSynthesis = synthesisValidation.valid ? synthesisValidation.synthesis : null;
  const analyses = (Array.isArray(parsed.keySessionAnalyses) ? parsed.keySessionAnalyses : []) as KeySessionAnalysis[];
  const projectName = typeof parsed.projectName === "string" && parsed.projectName.trim() ? parsed.projectName.trim() : undefined;
  const composition = { ...reportComposition(audit, analyses, validatedSynthesis), ...(projectName ? { projectName } : {}) };
  const firstUserMessages = (Array.isArray(parsed.firstUserMessages) ? parsed.firstUserMessages : []) as FirstUserMessageRecord[];
  const output = await writeLocalFile(options.htmlPath, await subsetReportFonts(renderHtml(audit, options.locale, composition, firstUserMessages, reportFontConfig(options.fontPath, options.fontFamily))));
  process.stdout.write("Output: final HTML report written to " + output + ".\n");
  return 0;
}

async function readEvalTrials(directory: string): Promise<EvalTrial[]> {
  const files: string[] = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile() && (entry.name === "trial.json" || entry.name.endsWith(".trial.json"))) files.push(full);
    }
  };
  for (const root of directory.split(",").map((item) => item.trim()).filter(Boolean)) await visit(path.resolve(root));
  files.sort();
  const trials: EvalTrial[] = [];
  const ids = new Set<string>();
  for (const file of files) {
    const value = JSON.parse(await fs.readFile(file, "utf8"));
    if (!isEvalTrial(value)) throw new Error(`EVAL_TRIAL_INVALID:${file}`);
    if (ids.has(value.id)) throw new Error(`EVAL_TRIAL_DUPLICATE_ID:${value.id}`);
    ids.add(value.id);
    if (value.outputArtifact) {
      const outputPath = path.resolve(directory, value.outputArtifact);
      const output = await fs.readFile(outputPath);
      if (sha256Text(output.toString("utf8")) !== value.outputHash) throw new Error(`EVAL_TRIAL_OUTPUT_TAMPERED:${value.id}`);
    }
    const validation = JSON.parse(await fs.readFile(path.resolve(directory, value.validationArtifact), "utf8")) as Record<string, unknown>;
    if (validation.outputHash !== value.outputHash || validation.inputHash !== value.inputHash || validation.caseId !== value.caseId) throw new Error(`EVAL_TRIAL_VALIDATION_TAMPERED:${value.id}`);
    if (value.generationRecord) {
      if (!isGenerationRecord(value.generationRecord)) throw new Error(`EVAL_GENERATION_RECORD_INVALID:${value.id}`);
      if (!value.outputArtifact || !value.outputHash) throw new Error(`EVAL_GENERATION_OUTPUT_MISSING:${value.id}`);
      const output = await fs.readFile(path.resolve(value.outputArtifact), "utf8");
      const provenance = await resolveCodexProvenance({
        rolloutPath: value.generationRecord.codexProvenance.rolloutPath,
        sessionId: value.generationRecord.codexProvenance.sessionId,
        threadId: value.generationRecord.codexProvenance.threadId,
        turnId: value.generationRecord.codexProvenance.turnId,
        responseItemId: value.generationRecord.codexProvenance.responseItemId,
        rawOutput: output,
        tokenMetric: value.generationRecord.codexProvenance.tokenMetric,
      }).catch(() => null);
      if (!provenance) throw new Error(`EVAL_GENERATION_SOURCE_UNRESOLVABLE:${value.id}`);
      if (provenance.outputHash !== value.outputHash
        || provenance.rolloutHash !== value.generationRecord.sourceReferenceHash
        || value.generationRecord.caseId !== value.caseId
        || value.generationRecord.lane !== value.lane
        || value.generationRecord.role !== value.role
        || value.generationRecord.outputHash !== value.outputHash
        || value.generationRecord.inputHash !== value.inputHash
        || value.generationRecord.promptHash !== value.promptHash
        || value.generationRecord.modelComparisonKey !== value.modelConfig.comparisonKey
        || provenance.tokenValue !== value.tokenCount
        || Math.max(0, Date.parse(provenance.endedAt) - Date.parse(provenance.startedAt)) !== value.durationMs) throw new Error(`EVAL_GENERATION_RECORD_BINDING_MISMATCH:${value.id}`);
    }
    trials.push(value);
  }
  return trials;
}

interface LoadedRoleExecution {
  recordPath: string;
  hash: string;
  record: RoleExecutionRecord;
  rawOutput: string;
}

async function readRoleExecutionRecord(recordPath: string | null, role: "quality-grader" | "optimizer" | "reviewer"): Promise<LoadedRoleExecution | null> {
  if (!recordPath) return null;
  const resolved = path.resolve(recordPath);
  const raw = await fs.readFile(resolved, "utf8");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("EVAL_ROLE_RECORD_UNPARSEABLE"); }
  if (!isRoleExecutionRecord(parsed, role)) throw new Error(`EVAL_ROLE_RECORD_INVALID:${role}`);
  const provenance = await resolveCodexProvenance({
    rolloutPath: parsed.codexProvenance.rolloutPath,
    sessionId: parsed.codexProvenance.sessionId,
    threadId: parsed.codexProvenance.threadId,
    turnId: parsed.codexProvenance.turnId,
    responseItemId: parsed.codexProvenance.responseItemId,
    rawOutput: null,
    tokenMetric: parsed.codexProvenance.tokenMetric,
  }).catch(() => null);
  if (!provenance || provenance.rolloutPath !== path.resolve(parsed.sourceReference) || provenance.rolloutHash !== parsed.sourceReferenceHash.toLowerCase() || provenance.outputHash !== parsed.outputHash) throw new Error(`EVAL_ROLE_SOURCE_UNRESOLVABLE:${role}`);
  const observed = await readCodexResponseOutput({
    rolloutPath: parsed.codexProvenance.rolloutPath,
    sessionId: parsed.codexProvenance.sessionId,
    threadId: parsed.codexProvenance.threadId,
    turnId: parsed.codexProvenance.turnId,
    responseItemId: parsed.codexProvenance.responseItemId,
    tokenMetric: parsed.codexProvenance.tokenMetric,
  });
  if (observed.outputHash !== parsed.outputHash) throw new Error(`EVAL_ROLE_OUTPUT_SOURCE_MISMATCH:${role}`);
  return { recordPath: resolved, hash: sha256Text(raw), record: parsed, rawOutput: observed.text };
}

async function assertRoleOutputArtifact(roleExecution: LoadedRoleExecution, artifactPath: string, role: string): Promise<void> {
  const artifact = await fs.readFile(path.resolve(artifactPath), "utf8");
  if (artifact !== roleExecution.rawOutput || sha256Text(artifact) !== roleExecution.record.outputHash) {
    throw new Error(`EVAL_${role.toUpperCase().replaceAll("-", "_")}_OUTPUT_UNBOUND`);
  }
}

function assertDistinctRoleContexts(records: LoadedRoleExecution[]): void {
  const threadIds = records.map((item) => item.record.codexProvenance.threadId);
  if (new Set(threadIds).size !== threadIds.length) throw new Error("EVAL_ROLE_CONTEXT_NOT_INDEPENDENT");
}

function assertRoleContextsDoNotOverlapGenerators(records: LoadedRoleExecution[], trials: readonly EvalTrial[]): void {
  const contexts = [
    ...records.map((item) => item.record.codexProvenance.threadId),
    ...trials.map((trial) => trial.generationRecord?.codexProvenance.threadId).filter((value): value is string => typeof value === "string"),
  ];
  if (new Set(contexts).size !== contexts.length) throw new Error("EVAL_ROLE_CONTEXT_OVERLAPS_GENERATOR");
}

async function assertBlindInputsBound(
  inputs: Array<{ blindId: string; outputArtifact: string }>,
  inputsRoot: string,
  trials: readonly EvalTrial[],
  blindIds: Map<string, string>,
): Promise<void> {
  const trialByBlindId = new Map([...blindIds.entries()].map(([trialId, blindId]) => [blindId, trials.find((trial) => trial.id === trialId)]));
  for (const input of inputs) {
    const trial = trialByBlindId.get(input.blindId);
    if (!trial?.outputHash) throw new Error("EVAL_BLIND_INPUT_INVALID");
    const output = await fs.readFile(path.resolve(inputsRoot, input.outputArtifact), "utf8");
    if (sha256Text(output) !== trial.outputHash) throw new Error(`EVAL_BLIND_INPUT_OUTPUT_MISMATCH:${trial.id}`);
  }
}

function applyBlindGrades(trials: EvalTrial[], raw: unknown, blindIds: Map<string, string>): { trials: EvalTrial[]; grades: unknown[] } {
  const entries = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.grades)
      ? raw.grades
      : [];
  for (const item of entries) {
    if (!isRecord(item)) throw new Error("EVAL_BLIND_GRADE_INVALID");
    const forbidden = ["trialId", "caseId", "role", "promptHash", "inputHash", "outputArtifact", "baseline", "candidate"];
    if (forbidden.some((key) => Object.hasOwn(item, key))) throw new Error("EVAL_BLIND_GRADE_IDENTITY_LEAK");
    if (typeof item.blindId !== "string" || !isRecord(item.dimensions)) throw new Error("EVAL_BLIND_GRADE_INVALID");
    for (const dimension of Object.values(item.dimensions)) {
      if (!isRecord(dimension) || Object.keys(dimension).some((key) => !["score", "evidence"].includes(key))
        || (dimension.score !== "unknown" && (typeof dimension.score !== "number" || dimension.score < 0 || dimension.score > 1))
        || !Array.isArray(dimension.evidence)
        || dimension.evidence.length === 0
        || dimension.evidence.some((evidence) => typeof evidence !== "string" || evidence.trim().length === 0)) throw new Error("EVAL_BLIND_GRADE_INVALID");
    }
  }
  const byBlindId = new Map(entries.filter((item): item is Record<string, unknown> => isRecord(item) && typeof item.blindId === "string").map((item) => [item.blindId as string, item]));
  const knownBlindIds = new Set(blindIds.values());
  const grades: unknown[] = [];
  const updated = trials.map((trial) => {
    const blindId = blindIds.get(trial.id);
    const grade = blindId ? byBlindId.get(blindId) : undefined;
    if (!grade || !isRecord(grade.dimensions)) return trial;
    const quality: Record<string, number | "unknown"> = {};
    const dimensionEvidence: Record<string, string[]> = {};
    for (const [id, value] of Object.entries(grade.dimensions)) {
      if (!isRecord(value)) continue;
      const score = value.score === "unknown" ? "unknown" : typeof value.score === "number" && value.score >= 0 && value.score <= 1 ? value.score : "unknown";
      quality[id] = score;
      dimensionEvidence[id] = Array.isArray(value.evidence) ? value.evidence.filter((item): item is string => typeof item === "string").slice(0, 4) : [];
    }
    grades.push({ blindId, dimensions: dimensionEvidence, scores: quality });
    return { ...trial, quality, qualityEvidence: dimensionEvidence };
  });
  if (byBlindId.size !== entries.length || entries.some((item) => !knownBlindIds.has(String(item.blindId)))) throw new Error("EVAL_BLIND_GRADE_UNKNOWN_ID");
  return { trials: updated, grades };
}

function reviewApprovalBindingHash(review: Record<string, unknown>, artifact: Record<string, unknown>, reviewerRecordHash: string): string {
  return sha256Text(JSON.stringify({
    reviewArtifactHash: review.reviewArtifactHash,
    reviewEvidenceHash: review.reviewEvidenceHash,
    reviewer: review.reviewer,
    blindMapHash: artifact.blindMapHash,
    blindInputsHash: artifact.blindInputsHash,
    qualityGraderRecordHash: review.qualityGraderRecordHash,
    optimizerRecordHash: review.optimizerRecordHash,
    reviewerRecordHash,
  }));
}

async function evalReviewMain(values: Map<string, string>): Promise<number> {
  const experimentPath = values.get("--experiment");
  const baselineDir = values.get("--baseline-dir");
  const candidateDir = values.get("--candidate-dir");
  const artifactDir = values.get("--artifact-dir");
  if (!experimentPath || !baselineDir || !candidateDir || !artifactDir) throw new Error("eval review requires --experiment, --baseline-dir, --candidate-dir, and --artifact-dir.");
  await requireEvalStatePhase(values, "review");
  const experimentValue = JSON.parse(await fs.readFile(path.resolve(experimentPath), "utf8")) as unknown;
  if (!isEvalExperiment(experimentValue)) throw new Error("EVAL_EXPERIMENT_INVALID");
  const experiment = experimentValue;
  const baselineRaw = await readEvalTrials(baselineDir);
  const candidateRaw = await readEvalTrials(candidateDir);
  const gradeFile = values.get("--grades");
  const casesDir = path.resolve(values.get("--cases-dir") ?? "evals/cases");
  const cases: EvalCase[] = [];
  for (const caseId of experiment.caseIds) cases.push(await readEvalCase(path.join(casesDir, caseId + ".json")));
  const caseContentHashes = new Map<string, string>();
  const scenarioHashes = new Map<string, string>();
  for (const evalCase of cases) {
    const content = await fs.readFile(path.resolve(evalCase.inputArtifact));
    const rawContent = content.toString("utf8");
    const contentHash = sha256Text(rawContent);
    if (contentHash !== evalCase.inputHash) throw new Error(`PROMOTION_CASE_INPUT_ARTIFACT_HASH_MISMATCH:${evalCase.id}`);
    caseContentHashes.set(evalCase.id, contentHash);
    scenarioHashes.set(evalCase.id, scenarioContentHash(rawContent));
  }
  const developmentContentHashes = new Set(cases.filter((item) => item.split !== "held-out").map((item) => caseContentHashes.get(item.id)));
  const developmentScenarioHashes = new Set(cases.filter((item) => item.split !== "held-out").map((item) => scenarioHashes.get(item.id)));
  for (const evalCase of cases.filter((item) => item.split === "held-out")) {
    if (developmentContentHashes.has(caseContentHashes.get(evalCase.id))) throw new Error(`PROMOTION_HELD_OUT_INPUT_CONTENT_NOT_DISTINCT:${evalCase.id}`);
    if (developmentScenarioHashes.has(scenarioHashes.get(evalCase.id))) throw new Error(`PROMOTION_HELD_OUT_SCENARIO_NOT_DISTINCT:${evalCase.id}`);
  }
  const rubricFiles = (await fs.readdir(path.resolve("evals", "rubrics"))).filter((file) => file.endsWith(".json"));
  const rubricById = new Map<string, EvalRubric>();
  for (const file of rubricFiles) {
    const rubric = JSON.parse(await fs.readFile(path.resolve("evals", "rubrics", file), "utf8")) as unknown;
    if (isEvalRubric(rubric)) rubricById.set(rubric.id, rubric);
  }
  const rubrics: EvalRubric[] = [];
  for (const evalCase of cases) {
    const rubric = rubricById.get(evalCase.rubricId);
    if (!rubric) throw new Error(`PROMOTION_RUBRIC_INVALID:${evalCase.rubricId}`);
    rubrics.push(rubric);
  }
  const acceptedPath = path.resolve(values.get("--accepted-baseline") ?? "evals/baselines/accepted-baseline.json");
  const acceptedBaseline = JSON.parse(await fs.readFile(acceptedPath, "utf8")) as unknown;
  if (!isAcceptedBaseline(acceptedBaseline)) throw new Error("PROMOTION_BASELINE_INVALID");
  await verifyStoredEvalTrials(acceptedBaseline.trials, "accepted-baseline");
  const currentContract = await resolveRunContractMetadata();
  if (!currentContract.bundleVersion || !currentContract.runtimeHash || acceptedBaseline.bundleVersion !== currentContract.bundleVersion.bundleVersion || acceptedBaseline.runtimeHash !== currentContract.runtimeHash) throw new Error("PROMOTION_BASELINE_RUNTIME_MISMATCH");
  const evidencePath = values.get("--review-evidence");
  const reviewEvidenceHash = evidencePath
    ? sha256Text(await fs.readFile(path.resolve(evidencePath), "utf8"))
    : null;
  const qualityGraderRecord = await readRoleExecutionRecord(values.get("--grader-record") ?? null, "quality-grader");
  if (!qualityGraderRecord) throw new Error("EVAL_QUALITY_GRADER_RECORD_REQUIRED");
  if (!gradeFile) throw new Error("EVAL_BLIND_GRADES_REQUIRED");
  await assertRoleOutputArtifact(qualityGraderRecord, gradeFile, "quality-grader");
  const optimizerRecord = await readRoleExecutionRecord(values.get("--optimizer-record") ?? null, "optimizer");
  const reviewerRecord = await readRoleExecutionRecord(values.get("--reviewer-record") ?? null, "reviewer");
  if (!reviewerRecord) throw new Error("EVAL_REVIEWER_RECORD_REQUIRED");
  if (!evidencePath) throw new Error("EVAL_REVIEW_EVIDENCE_REQUIRED");
  await assertRoleOutputArtifact(reviewerRecord, evidencePath, "reviewer");
  const optimizerArtifactPath = values.get("--optimizer-artifact");
  if (!optimizerRecord || !optimizerArtifactPath) throw new Error("EVAL_OPTIMIZER_ARTIFACT_REQUIRED");
  const optimizerArtifactResolved = path.resolve(optimizerArtifactPath);
  const optimizerArtifact = JSON.parse(await fs.readFile(optimizerArtifactResolved, "utf8")) as Record<string, unknown>;
  const optimizerArtifactRecord = isRecord(optimizerArtifact.optimizerRecord) ? optimizerArtifact.optimizerRecord : null;
  const optimizerProposalPath = typeof optimizerArtifact.optimizerProposalPath === "string" ? path.resolve(optimizerArtifact.optimizerProposalPath) : null;
  const optimizerProposalHash = typeof optimizerArtifact.optimizerProposalHash === "string" ? optimizerArtifact.optimizerProposalHash.toLowerCase() : null;
  if (!optimizerArtifactRecord || optimizerArtifactRecord.recordPath !== optimizerRecord.recordPath || optimizerArtifactRecord.hash !== optimizerRecord.hash || !optimizerProposalPath || !optimizerProposalHash || optimizerProposalHash !== sha256Text(await fs.readFile(optimizerProposalPath, "utf8"))) throw new Error("EVAL_OPTIMIZER_ARTIFACT_UNBOUND");
  await assertRoleOutputArtifact(optimizerRecord, optimizerProposalPath, "optimizer");
  assertDistinctRoleContexts([qualityGraderRecord, optimizerRecord, reviewerRecord]);
  const allTrials = [...baselineRaw, ...candidateRaw];
  assertRoleContextsDoNotOverlapGenerators([qualityGraderRecord, optimizerRecord, reviewerRecord], allTrials);
  if (!currentContract.bundleVersion) throw new Error("PROMOTION_BUNDLE_VERSION_UNAVAILABLE");
  if (allTrials.some((trial) => trial.bundleVersion !== currentContract.bundleVersion!.bundleVersion)) throw new Error("PROMOTION_TRIAL_BUNDLE_MISMATCH");
  if (allTrials.some((trial) => trial.generationRecord?.codexProvenance.tokenMetric !== experiment.tokenMetric)) throw new Error("PROMOTION_TRIAL_TOKEN_METRIC_MISMATCH");
  const reviewArtifactDir = path.resolve(artifactDir);
  await fs.mkdir(reviewArtifactDir, { recursive: true });
  const blindMapArg = values.get("--blind-map");
  if (!blindMapArg) throw new Error("EVAL_BLIND_MAP_REQUIRED");
  const blindMapPath = path.resolve(blindMapArg);
  const blindIds = new Map<string, string>();
  try {
    const persisted = JSON.parse(await fs.readFile(blindMapPath, "utf8")) as unknown;
    if (!Array.isArray(persisted)) throw new Error("invalid");
    for (const entry of persisted) {
      if (isRecord(entry) && typeof entry.trialId === "string" && typeof entry.blindId === "string") blindIds.set(entry.trialId, entry.blindId);
    }
  } catch { throw new Error("EVAL_BLIND_MAP_UNRESOLVABLE"); }
  if (allTrials.some((trial) => !blindIds.has(trial.id)) || new Set([...blindIds.values()]).size !== allTrials.length) throw new Error("EVAL_BLIND_MAP_INVALID");
  const gradesRaw = JSON.parse(await fs.readFile(path.resolve(gradeFile), "utf8"));
  const baselineGrades = applyBlindGrades(baselineRaw, gradesRaw, blindIds);
  const candidateGrades = applyBlindGrades(candidateRaw, gradesRaw, blindIds);
  const reviewPath = path.join(reviewArtifactDir, `${experiment.id}.review.json`);
  const review = reviewExperiment(experiment, baselineGrades.trials, candidateGrades.trials, reviewPath, values.get("--reviewer") ?? `reviewer:${reviewerRecord.hash}`, false, {
    acceptedBaseline,
    cases,
    rubrics,
    reviewEvidenceHash,
     qualityGraderRecordHash: qualityGraderRecord?.hash ?? null,
     optimizerRecordHash: optimizerRecord?.hash ?? null,
    minimumTrialsPerCase: PROMOTION_MINIMUM_TRIALS,
    minimumImprovementDelta: PROMOTION_MINIMUM_IMPROVEMENT_DELTA,
  });
  const failedDimensions = Object.entries(summarizeScores(candidateGrades.trials).dimensions).filter(([, value]) => value.mean === null || value.unknownCount > 0).map(([id]) => id);
  const proposal = review.conclusion === "inconclusive" && experiment.maxRevisions > 0
    ? makeOptimizerProposal(1, experiment.hypothesis, failedDimensions, candidateGrades.trials.map((trial) => trial.validationArtifact))
    : null;
  const blindInputsPath = path.resolve(values.get("--blind-inputs") ?? path.join(reviewArtifactDir, `${experiment.id}.blind-inputs.json`));
  const blindInputsRaw = JSON.parse(await fs.readFile(blindInputsPath, "utf8")) as unknown;
  if (!Array.isArray(blindInputsRaw) || blindInputsRaw.length !== allTrials.length || blindInputsRaw.some((item) => !isRecord(item) || typeof item.blindId !== "string" || typeof item.outputArtifact !== "string")) throw new Error("EVAL_BLIND_INPUT_INVALID");
  const blindInputs = blindInputsRaw as Array<{ blindId: string; outputArtifact: string }>;
  const blindInputsRoot = path.dirname(blindInputsPath);
  for (const input of blindInputs) {
    if (!blindIds.has([...blindIds.entries()].find(([, blindId]) => blindId === input.blindId)?.[0] ?? "") || !await fs.stat(path.resolve(blindInputsRoot, input.outputArtifact)).catch(() => null)) throw new Error("EVAL_BLIND_INPUT_INVALID");
  }
  await assertBlindInputsBound(blindInputs, blindInputsRoot, allTrials, blindIds);
  const artifact: Record<string, unknown> = {
    version: 1,
    experiment,
    acceptedBaseline: { path: acceptedPath, id: acceptedBaseline.id, bundleVersion: acceptedBaseline.bundleVersion },
    cases: cases.map((item) => ({ ...item, scenarioContentHash: scenarioHashes.get(item.id) })),
    rubrics,
    baseline: { trials: baselineGrades.trials, summary: summarizeScores(baselineGrades.trials) },
    candidate: { trials: candidateGrades.trials, summary: summarizeScores(candidateGrades.trials) },
    blindGrades: [...baselineGrades.grades, ...candidateGrades.grades],
    blindInputs,
    blindMapPath,
    blindMapHash: sha256Text(await fs.readFile(blindMapPath, "utf8")),
    blindInputsPath,
    blindInputsHash: sha256Text(await fs.readFile(blindInputsPath, "utf8")),
    gate: { minimumTrialsPerCase: PROMOTION_MINIMUM_TRIALS, minimumImprovementDelta: PROMOTION_MINIMUM_IMPROVEMENT_DELTA },
    reviewEvidencePath: evidencePath ? path.resolve(evidencePath) : null,
    qualityGraderRecord,
    optimizerRecord,
    optimizerArtifact: { path: optimizerArtifactResolved, sha256: sha256Text(await fs.readFile(optimizerArtifactResolved, "utf8")) },
    reviewerRecord,
    review,
    optimizerProposal: proposal,
  };
  review.reviewArtifactHash = reviewArtifactBindingHash(artifact);
  review.reviewerApprovalHash = review.reviewer && review.reviewEvidenceHash
    ? reviewApprovalBindingHash(review as unknown as Record<string, unknown>, artifact, reviewerRecord.hash)
    : null;
  await fs.writeFile(reviewPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");
  await advanceEvalState(values.get("--state")!, experiment.id, "review", [
    reviewPath,
    ...(qualityGraderRecord ? [qualityGraderRecord.recordPath] : []),
    ...(optimizerRecord ? [optimizerRecord.recordPath] : []),
    blindMapPath,
    blindInputsPath,
  ]);
  process.stdout.write(JSON.stringify({ review, reviewArtifact: reviewPath, optimizerProposal: proposal }) + "\n");
  return review.conclusion === "eligible" ? 0 : 2;
}

async function evalBlindMapMain(values: Map<string, string>): Promise<number> {
  const baselineDir = values.get("--baseline-dir");
  const candidateDir = values.get("--candidate-dir");
  const artifactDir = values.get("--artifact-dir");
  const experimentId = values.get("--experiment");
  if (!baselineDir || !candidateDir || !artifactDir || !experimentId) throw new Error("eval blind-map requires --baseline-dir, --candidate-dir, --artifact-dir, and --experiment.");
  const statePath = values.get("--state");
  if (!statePath) throw new Error("EVAL_STATE_REQUIRED:contract-grade");
  const state = await readEvalState(statePath, experimentId);
  // Blind maps are immutable evidence preparation. After the baseline-only
  // bootstrap, a fresh full map is still required for candidate review while
  // the state machine is at optimize; creating that map does not advance or
  // skip any phase.
  if (state.nextLegalAction !== "contract-grade" && state.nextLegalAction !== "blind-quality-grade" && state.nextLegalAction !== "optimize") throw new Error(`EVAL_STATE_ILLEGAL_ACTION:contract-grade:expected:${state.nextLegalAction ?? "complete"}`);
  const allTrials = [...await readEvalTrials(baselineDir), ...await readEvalTrials(candidateDir)];
  if (allTrials.length === 0 || allTrials.some((trial) => trial.contractStatus !== "passed" || !trial.outputArtifact)) throw new Error("EVAL_BLIND_MAP_REQUIRES_CONTRACT_PASSED_TRIALS");
  const outputDir = path.resolve(artifactDir);
  await fs.mkdir(outputDir, { recursive: true });
  const mapPath = path.resolve(values.get("--blind-map") ?? path.join(outputDir, `${experimentId}.blind-map.json`));
  const inputsPath = path.resolve(values.get("--blind-inputs") ?? path.join(outputDir, `${experimentId}.blind-inputs.json`));
  try {
    const existing = JSON.parse(await fs.readFile(mapPath, "utf8")) as unknown;
    if (!Array.isArray(existing)) throw new Error("invalid");
    await fs.access(inputsPath);
    process.stdout.write(JSON.stringify({ reused: true, blindMap: mapPath, blindInputs: inputsPath, blindMapHash: sha256Text(await fs.readFile(mapPath, "utf8")), blindInputsHash: sha256Text(await fs.readFile(inputsPath, "utf8")) }) + "\n");
    return 0;
  } catch { /* create immutable blind artifacts below */ }
  const blindMap = allTrials.map((trial) => ({ trialId: trial.id, blindId: randomUUID().replaceAll("-", "").slice(0, 24) }));
  const blindByTrial = new Map(blindMap.map((entry) => [entry.trialId, entry.blindId]));
  const blindDir = path.join(outputDir, "blind");
  await fs.mkdir(blindDir, { recursive: true });
  const blindInputs = [] as Array<{ blindId: string; outputArtifact: string }>;
  for (const trial of allTrials) {
    const blindId = blindByTrial.get(trial.id);
    if (!blindId || !trial.outputArtifact) throw new Error("EVAL_BLIND_INPUT_INVALID");
    const target = path.join(blindDir, `${blindId}.json`);
    await fs.copyFile(path.resolve(trial.outputArtifact), target);
    blindInputs.push({ blindId, outputArtifact: path.relative(outputDir, target) });
  }
  await fs.writeFile(mapPath, JSON.stringify(blindMap, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  await fs.writeFile(inputsPath, JSON.stringify(blindInputs, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  process.stdout.write(JSON.stringify({ reused: false, blindMap: mapPath, blindInputs: inputsPath, blindMapHash: sha256Text(await fs.readFile(mapPath, "utf8")), blindInputsHash: sha256Text(await fs.readFile(inputsPath, "utf8")) }) + "\n");
  return 0;
}

async function evalBaselineMain(values: Map<string, string>): Promise<number> {
  throw new Error("EVAL_BASELINE_BOOTSTRAP_REQUIRED");
  const baselineDir = values.get("--baseline-dir");
  const outputPath = values.get("--output");
  const gradePath = values.get("--grades");
  const blindMapPath = values.get("--blind-map");
  const experimentId = values.get("--experiment");
  if (!baselineDir || !outputPath || !gradePath || !blindMapPath || !experimentId) throw new Error("eval baseline requires --baseline-dir, --output, --grades, --blind-map, and --experiment.");
  const trials = await readEvalTrials(baselineDir!);
  const persisted = JSON.parse(await fs.readFile(path.resolve(blindMapPath!), "utf8")) as Array<Record<string, unknown>>;
  if (!Array.isArray(persisted)) throw new Error("EVAL_BLIND_MAP_UNRESOLVABLE");
  const blindIds = new Map<string, string>();
  for (const entry of persisted) {
    const trialId = entry.trialId;
    const blindId = entry.blindId;
    if (typeof trialId === "string" && typeof blindId === "string") blindIds.set(trialId as string, blindId as string);
  }
  // The immutable map covers the complete experiment (baseline and
  // candidate). Baseline construction consumes only its subset, so a
  // complete-map size must not be compared with the baseline trial count.
  if (trials.some((trial) => !blindIds.has(trial.id))) throw new Error("EVAL_BLIND_MAP_INVALID");
  const graded = applyBlindGrades(trials, JSON.parse(await fs.readFile(path.resolve(gradePath!), "utf8")), blindIds).trials;
  if (graded.some((trial) => !isEvalTrial(trial) || trial.generationRecord === null || Object.values(trial.quality).some((score) => typeof score !== "number"))) throw new Error("EVAL_BASELINE_GRADES_INCOMPLETE");
  const promptHashes = {
    "report-synthesis": sha256Text(await fs.readFile(path.resolve("prompts/report-synthesis.md"), "utf8")),
    "key-session-analysis": sha256Text(await fs.readFile(path.resolve("prompts/key-session-analysis.md"), "utf8")),
    "skill-insights": values.get("--prompt-hash") ?? sha256Text(await fs.readFile(path.resolve("prompts/skill-insights.md"), "utf8")),
  };
  const packageJson = JSON.parse(await fs.readFile(path.resolve("package.json"), "utf8")) as Record<string, unknown>;
  const baseline = {
    version: 1,
    id: `accepted-baseline-${experimentId}`,
    acceptedAt: new Date().toISOString(),
    productVersion: typeof packageJson.version === "string" ? packageJson.version : "unknown",
    bundleVersion: values.get("--bundle-version") ?? "unknown",
    auditSchemaVersion: 1,
    promptHashes,
    runtimeHash: values.get("--runtime-hash") ?? "unavailable",
    modelConfig: graded[0]?.modelConfig,
    caseIds: [...new Set(graded.map((trial) => trial.caseId))],
    trials: graded,
    knownVariance: { source: "independent Host Agent Generator trials; semantic grade variance is recorded per dimension" },
    budgetEvidencePolicy: "required",
    tokenMetric: graded[0]?.generationRecord?.codexProvenance.tokenMetric ?? "total_tokens",
    budgetLimitations: [],
    privacy: "redacted",
  };
  if (!isAcceptedBaseline(baseline)) throw new Error("EVAL_BASELINE_INVALID");
  await fs.writeFile(path.resolve(outputPath!), JSON.stringify(baseline, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  process.stdout.write(JSON.stringify({ acceptedBaseline: path.resolve(outputPath!), hash: sha256Text(JSON.stringify(baseline) + "\n"), trialCount: graded.length }) + "\n");
  return 0;
}

async function evalBaselineBootstrapMain(values: Map<string, string>): Promise<number> {
  const baselineDir = values.get("--baseline-dir");
  const outputPath = values.get("--output");
  const gradePath = values.get("--grades");
  const blindMapPath = values.get("--blind-map");
  const reviewPath = values.get("--bootstrap-review");
  const variancePath = values.get("--variance");
  const evidencePath = values.get("--review-evidence");
  const reviewerRecordPath = values.get("--reviewer-record");
  const graderRecordPath = values.get("--grader-record");
  const previousBaselinePath = values.get("--previous-baseline") ?? outputPath;
  const experimentId = values.get("--experiment");
  const invalidationReason = values.get("--invalidation-reason");
  if (!baselineDir || !outputPath || !gradePath || !blindMapPath || !reviewPath || !variancePath || !evidencePath || !reviewerRecordPath || !graderRecordPath || !previousBaselinePath || !experimentId || !invalidationReason) throw new Error("eval baseline-bootstrap requires baseline, grades, blind map, review, variance, evidence, reviewer, grader, previous baseline, experiment, and invalidation reason.");
  const trials = await readEvalTrials(baselineDir);
  const persistedMap = JSON.parse(await fs.readFile(path.resolve(blindMapPath), "utf8")) as unknown;
  if (!Array.isArray(persistedMap)) throw new Error("EVAL_BLIND_MAP_UNRESOLVABLE");
  const blindIds = new Map<string, string>();
  for (const entry of persistedMap) if (isRecord(entry) && typeof entry.trialId === "string" && typeof entry.blindId === "string") blindIds.set(entry.trialId, entry.blindId);
  if (trials.some((trial) => !blindIds.has(trial.id))) throw new Error("EVAL_BLIND_MAP_INVALID");
  const grader = await readRoleExecutionRecord(graderRecordPath, "quality-grader");
  if (!grader) throw new Error("EVAL_QUALITY_GRADER_RECORD_REQUIRED");
  await assertRoleOutputArtifact(grader, gradePath, "quality-grader");
  const graded = applyBlindGrades(trials, JSON.parse(await fs.readFile(path.resolve(gradePath), "utf8")), blindIds).trials;
  if (graded.some((trial) => trial.generationRecord === null || trial.contractStatus !== "passed" || Object.values(trial.quality).some((score) => typeof score !== "number"))) throw new Error("EVAL_BASELINE_GRADES_INCOMPLETE");
  const reviewValue = JSON.parse(await fs.readFile(path.resolve(reviewPath), "utf8")) as unknown;
  if (!isBaselineBootstrapReview(reviewValue)) throw new Error("EVAL_BASELINE_BOOTSTRAP_REVIEW_INVALID");
  const review = reviewValue;
  const reviewer = await readRoleExecutionRecord(reviewerRecordPath, "reviewer");
  if (!reviewer) throw new Error("EVAL_REVIEWER_RECORD_REQUIRED");
  await assertRoleOutputArtifact(reviewer, evidencePath, "reviewer");
  assertDistinctRoleContexts([grader, reviewer]);
  assertRoleContextsDoNotOverlapGenerators([grader, reviewer], graded);
  const hashes = {
    blindMapHash: sha256Text(await fs.readFile(path.resolve(blindMapPath), "utf8")),
    gradesHash: sha256Text(await fs.readFile(path.resolve(gradePath), "utf8")),
    varianceHash: sha256Text(await fs.readFile(path.resolve(variancePath), "utf8")),
    reviewEvidenceHash: sha256Text(await fs.readFile(path.resolve(evidencePath), "utf8")),
    reviewerRecordHash: reviewer.hash,
    qualityGraderRecordHash: grader.hash,
  };
  if (review.reviewedTrialIds.slice().sort().join("\n") !== graded.map((trial) => trial.id).sort().join("\n") || review.blindMapHash !== hashes.blindMapHash || review.gradesHash !== hashes.gradesHash || review.varianceHash !== hashes.varianceHash || review.reviewEvidenceHash !== hashes.reviewEvidenceHash || review.reviewerRecordHash !== hashes.reviewerRecordHash || review.qualityGraderRecordHash !== hashes.qualityGraderRecordHash) throw new Error("EVAL_BASELINE_BOOTSTRAP_REVIEW_UNBOUND");
  const promptHashes = {
    "report-synthesis": sha256Text(await fs.readFile(path.resolve("prompts/report-synthesis.md"), "utf8")),
    "key-session-analysis": sha256Text(await fs.readFile(path.resolve("prompts/key-session-analysis.md"), "utf8")),
    "skill-insights": sha256Text(await fs.readFile(path.resolve("prompts/skill-insights.md"), "utf8")),
  };
  const packageJson = JSON.parse(await fs.readFile(path.resolve("package.json"), "utf8")) as Record<string, unknown>;
  const variance = JSON.parse(await fs.readFile(path.resolve(variancePath), "utf8")) as unknown;
  const contract = await resolveRunContractMetadata();
  if (!contract.bundleVersion || !contract.runtimeHash || !contract.promptHashes.reportSynthesis || !contract.promptHashes.keySessionAnalysis || !contract.promptHashes.skillInsights) throw new Error("EVAL_BASELINE_RUNTIME_CONTRACT_UNAVAILABLE");
  if (graded.some((trial) => trial.bundleVersion !== contract.bundleVersion!.bundleVersion)) throw new Error("EVAL_BASELINE_TRIAL_BUNDLE_MISMATCH");
  if (graded.some((trial) => trial.generationRecord?.codexProvenance.tokenMetric !== graded[0]?.generationRecord?.codexProvenance.tokenMetric)) throw new Error("EVAL_BASELINE_TOKEN_METRIC_MISMATCH");
  const budgetLimitations = [
    ...(graded.some((trial) => trial.tokenCount === null) ? ["PROMOTION_TOKEN_USAGE_UNAVAILABLE"] : []),
    ...(graded.some((trial) => trial.durationMs === null) ? ["PROMOTION_TIME_USAGE_UNAVAILABLE"] : []),
  ];
  const baseline: AcceptedBaseline = {
    version: 1,
    id: `accepted-baseline-${experimentId}`,
    acceptedAt: new Date().toISOString(),
    productVersion: typeof packageJson.version === "string" ? packageJson.version : "unknown",
    bundleVersion: contract.bundleVersion.bundleVersion,
    auditSchemaVersion: 1,
    promptHashes: {
      "report-synthesis": contract.promptHashes.reportSynthesis,
      "key-session-analysis": contract.promptHashes.keySessionAnalysis,
      "skill-insights": contract.promptHashes.skillInsights,
    },
    runtimeHash: contract.runtimeHash,
    modelConfig: graded[0].modelConfig,
    caseIds: [...new Set(graded.map((trial) => trial.caseId))],
    trials: graded,
    knownVariance: isRecord(variance) ? Object.fromEntries(Object.entries(variance).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)])) : { source: "variance artifact hash is recorded in bootstrap review" },
    budgetEvidencePolicy: values.get("--budget-evidence-policy") === "advisory" ? "advisory" : "required",
    tokenMetric: graded[0].generationRecord!.codexProvenance.tokenMetric,
    budgetLimitations,
    privacy: "redacted",
  };
  const accepted = await bootstrapAcceptedBaseline({
    outputPath,
    previousBaselinePath,
    previousBaselineHash: sha256Text(await fs.readFile(path.resolve(previousBaselinePath), "utf8")),
    invalidationReason,
    review,
    currentPromptHashes: promptHashes,
    baseline,
  });
  process.stdout.write(JSON.stringify({ acceptedBaseline: path.resolve(outputPath), bootstrap: accepted.bootstrap, trialCount: accepted.trials.length }) + "\n");
  return 0;
}

async function evalOptimizeMain(values: Map<string, string>): Promise<number> {
  const artifactDir = values.get("--artifact-dir");
  const proposalPath = values.get("--proposal");
  if (!artifactDir || !proposalPath) throw new Error("eval optimize requires --artifact-dir and --proposal.");
  await requireEvalStatePhase(values, "optimize");
  const optimizerRecordPath = values.get("--optimizer-record");
  const optimizerRecord = await readRoleExecutionRecord(optimizerRecordPath ?? null, "optimizer");
  if (!optimizerRecord) throw new Error("EVAL_OPTIMIZER_RECORD_REQUIRED");
  const revision = Number(values.get("--revision") ?? "1");
  if (!Number.isInteger(revision) || revision < 1 || revision > 3) throw new Error("EVAL_OPTIMIZER_REVISION_OUT_OF_RANGE");
  const proposalFile = path.resolve(proposalPath);
  await assertRoleOutputArtifact(optimizerRecord, proposalFile, "optimizer");
  const proposalRaw = JSON.parse(await fs.readFile(proposalFile, "utf8")) as Record<string, unknown>;
  const executionRaw = JSON.parse(await fs.readFile(path.join(path.dirname(optimizerRecord.recordPath), "optimizer-execution.json"), "utf8")) as Record<string, unknown>;
  const nested = isRecord(proposalRaw.proposal) ? proposalRaw.proposal : null;
  const evidence = isRecord(proposalRaw.evidence) ? proposalRaw.evidence : null;
  if (proposalRaw.experimentId !== values.get("--experiment")
    || proposalRaw.revision !== revision
    || proposalRaw.implementationFilesRead !== false
    || proposalRaw.authoritativePromptModified !== false
    || !nested
    || typeof nested.change !== "string"
    || typeof nested.falsifiablePrediction !== "string"
    || !evidence
    || !Array.isArray(evidence.failedDimensions)
    || !Array.isArray(evidence.blindGradeFile ? [evidence.blindGradeFile] : [])) throw new Error("EVAL_OPTIMIZER_PROPOSAL_INVALID");
  const executionProposalPath = typeof executionRaw.proposalFile === "string" ? path.resolve(executionRaw.proposalFile) : null;
  const executionProposalHash = typeof executionRaw.proposalFileHash === "string" ? executionRaw.proposalFileHash.toLowerCase() : null;
  if (executionProposalPath !== proposalFile || !executionProposalHash || executionProposalHash !== sha256Text(await fs.readFile(proposalFile, "utf8"))) throw new Error("EVAL_OPTIMIZER_PROPOSAL_UNBOUND");
  if (executionRaw.executionId !== JSON.parse(await fs.readFile(optimizerRecord.recordPath, "utf8")).executionId
    || executionRaw.contextId !== JSON.parse(await fs.readFile(optimizerRecord.recordPath, "utf8")).contextId) throw new Error("EVAL_OPTIMIZER_EXECUTION_CONTEXT_MISMATCH");
  const proposal = makeOptimizerProposal(
    revision,
    nested.falsifiablePrediction,
    evidence.failedDimensions.filter((item): item is string => typeof item === "string"),
    Object.values(evidence).filter((item): item is string => typeof item === "string"),
  );
  proposal.singleChange = nested.change;
  const output = path.join(path.resolve(artifactDir), `optimizer-revision-${revision}.json`);
  await fs.mkdir(path.dirname(output), { recursive: true });
  const persisted = {
    ...proposal,
    optimizerRecord,
    optimizerProposalPath: proposalFile,
    optimizerProposalHash: sha256Text(await fs.readFile(proposalFile, "utf8")),
  };
  await fs.writeFile(output, JSON.stringify(persisted, null, 2) + "\n", "utf8");
  await advanceEvalState(values.get("--state")!, values.get("--experiment")!, "optimize", [output, optimizerRecord.recordPath]);
  process.stdout.write(JSON.stringify({ proposal: persisted, artifact: output, authoritativePromptModified: false }) + "\n");
  return 0;
}

async function verifyStoredEvalTrials(trials: EvalTrial[], label: string): Promise<void> {
  for (const trial of trials) {
    if (!trial.outputArtifact || !trial.outputHash) throw new Error(`PROMOTION_${label.toUpperCase()}_OUTPUT_MISSING`);
    const outputPath = path.resolve(trial.outputArtifact);
    const output = await fs.readFile(outputPath, "utf8");
    if (sha256Text(output) !== trial.outputHash) throw new Error("PROMOTION_REVIEW_TRIAL_OUTPUT_TAMPERED");
    const validation = JSON.parse(await fs.readFile(path.resolve(trial.validationArtifact), "utf8")) as Record<string, unknown>;
    if (validation.outputHash !== trial.outputHash || validation.inputHash !== trial.inputHash || validation.caseId !== trial.caseId) throw new Error("PROMOTION_REVIEW_TRIAL_VALIDATION_TAMPERED");
    const generation = trial.generationRecord;
    if (!generation) throw new Error(`PROMOTION_${label.toUpperCase()}_PROVENANCE_MISSING`);
    const provenance = await resolveCodexProvenance({
      rolloutPath: generation.codexProvenance.rolloutPath,
      sessionId: generation.codexProvenance.sessionId,
      threadId: generation.codexProvenance.threadId,
      turnId: generation.codexProvenance.turnId,
      responseItemId: generation.codexProvenance.responseItemId,
      rawOutput: output,
      tokenMetric: generation.codexProvenance.tokenMetric,
    }).catch(() => null);
    if (!provenance
      || provenance.rolloutPath !== path.resolve(generation.sourceReference)
      || provenance.rolloutHash !== generation.sourceReferenceHash.toLowerCase()
      || provenance.outputHash !== trial.outputHash
      || provenance.tokenValue !== trial.tokenCount
      || Math.max(0, Date.parse(provenance.endedAt) - Date.parse(provenance.startedAt)) !== trial.durationMs) {
      throw new Error(`PROMOTION_${label.toUpperCase()}_PROVENANCE_UNRESOLVABLE`);
    }
  }
}

async function revalidatePromotionReview(reviewArtifact: Record<string, unknown>, review: Record<string, unknown>, experiment: EvalExperiment, reviewPath: string): Promise<void> {
  const baselineRecord = isRecord(reviewArtifact.baseline) ? reviewArtifact.baseline : null;
  const candidateRecord = isRecord(reviewArtifact.candidate) ? reviewArtifact.candidate : null;
  const baseline = baselineRecord && Array.isArray(baselineRecord.trials) && baselineRecord.trials.every(isEvalTrial) ? baselineRecord.trials : null;
  const candidate = candidateRecord && Array.isArray(candidateRecord.trials) && candidateRecord.trials.every(isEvalTrial) ? candidateRecord.trials : null;
  if (!baseline || !candidate) throw new Error("PROMOTION_REVIEW_TRIALS_MISSING");
  await verifyStoredEvalTrials(baseline, "baseline");
  await verifyStoredEvalTrials(candidate, "candidate");
  const cases = Array.isArray(reviewArtifact.cases) && reviewArtifact.cases.every(isEvalCase) ? reviewArtifact.cases : null;
  const rubrics = Array.isArray(reviewArtifact.rubrics) && reviewArtifact.rubrics.every(isEvalRubric) ? reviewArtifact.rubrics : null;
  if (!cases || !rubrics) throw new Error("PROMOTION_REVIEW_CONTRACT_MISSING");
  const scenarioHashes = new Map<string, string>();
  for (const evalCase of cases) {
    const raw = await fs.readFile(path.resolve(evalCase.inputArtifact), "utf8");
    const scenarioHash = scenarioContentHash(raw);
    if (sha256Text(raw) !== evalCase.inputHash || evalCase.scenarioContentHash !== scenarioHash) throw new Error(`PROMOTION_CASE_SCENARIO_HASH_MISMATCH:${evalCase.id}`);
    scenarioHashes.set(evalCase.id, scenarioHash);
  }
  const developmentScenarioHashes = new Set(cases.filter((item) => item.split !== "held-out").map((item) => scenarioHashes.get(item.id)));
  for (const evalCase of cases.filter((item) => item.split === "held-out")) {
    if (developmentScenarioHashes.has(scenarioHashes.get(evalCase.id))) throw new Error(`PROMOTION_HELD_OUT_SCENARIO_NOT_DISTINCT:${evalCase.id}`);
  }
  const acceptedInfo = isRecord(reviewArtifact.acceptedBaseline) ? reviewArtifact.acceptedBaseline : null;
  const acceptedPath = acceptedInfo && typeof acceptedInfo.path === "string" ? acceptedInfo.path : null;
  if (!acceptedPath) throw new Error("PROMOTION_ACCEPTED_BASELINE_MISSING");
  const acceptedBaseline = JSON.parse(await fs.readFile(acceptedPath, "utf8")) as unknown;
  if (!isAcceptedBaseline(acceptedBaseline)) throw new Error("PROMOTION_BASELINE_INVALID");
  await verifyStoredEvalTrials(acceptedBaseline.trials, "accepted-baseline");
  if (acceptedInfo?.id !== acceptedBaseline.id || acceptedInfo?.bundleVersion !== acceptedBaseline.bundleVersion) throw new Error("PROMOTION_ACCEPTED_BASELINE_IDENTITY_MISMATCH");
  const currentContract = await resolveRunContractMetadata();
  if (!currentContract.bundleVersion || acceptedBaseline.bundleVersion !== currentContract.bundleVersion.bundleVersion) throw new Error("PROMOTION_BASELINE_RUNTIME_MISMATCH");
  if (baseline.some((trial) => trial.bundleVersion !== currentContract.bundleVersion!.bundleVersion) || candidate.some((trial) => trial.bundleVersion !== currentContract.bundleVersion!.bundleVersion)) throw new Error("PROMOTION_TRIAL_BUNDLE_MISMATCH");
  if (baseline.some((trial) => trial.generationRecord?.codexProvenance.tokenMetric !== experiment.tokenMetric) || candidate.some((trial) => trial.generationRecord?.codexProvenance.tokenMetric !== experiment.tokenMetric)) throw new Error("PROMOTION_TRIAL_TOKEN_METRIC_MISMATCH");
  const evidencePath = typeof reviewArtifact.reviewEvidencePath === "string" ? reviewArtifact.reviewEvidencePath : null;
  if (!evidencePath || sha256Text(await fs.readFile(evidencePath, "utf8")) !== review.reviewEvidenceHash) throw new Error("PROMOTION_REVIEW_EVIDENCE_TAMPERED");
  const graderInfo = isRecord(reviewArtifact.qualityGraderRecord) && typeof reviewArtifact.qualityGraderRecord.recordPath === "string" && typeof reviewArtifact.qualityGraderRecord.hash === "string" ? reviewArtifact.qualityGraderRecord : null;
  const optimizerInfo = isRecord(reviewArtifact.optimizerRecord) && typeof reviewArtifact.optimizerRecord.recordPath === "string" && typeof reviewArtifact.optimizerRecord.hash === "string" ? reviewArtifact.optimizerRecord : null;
  const reviewerInfo = isRecord(reviewArtifact.reviewerRecord) && typeof reviewArtifact.reviewerRecord.recordPath === "string" && typeof reviewArtifact.reviewerRecord.hash === "string" ? reviewArtifact.reviewerRecord : null;
  const graderPath = graderInfo && typeof graderInfo.recordPath === "string" ? graderInfo.recordPath : null;
  const optimizerPath = optimizerInfo && typeof optimizerInfo.recordPath === "string" ? optimizerInfo.recordPath : null;
  const reviewerPath = reviewerInfo && typeof reviewerInfo.recordPath === "string" ? reviewerInfo.recordPath : null;
  const grader = await readRoleExecutionRecord(graderPath, "quality-grader");
  const optimizer = await readRoleExecutionRecord(optimizerPath, "optimizer");
  const reviewerRecord = await readRoleExecutionRecord(reviewerPath, "reviewer");
  const reviewGraderHash = typeof review.qualityGraderRecordHash === "string" ? review.qualityGraderRecordHash : null;
  const reviewOptimizerHash = typeof review.optimizerRecordHash === "string" ? review.optimizerRecordHash : null;
  if (!grader || grader.hash !== graderInfo?.hash || grader.hash !== reviewGraderHash) throw new Error("PROMOTION_QUALITY_GRADER_RECORD_TAMPERED");
  if (!optimizer || optimizer.hash !== optimizerInfo?.hash || optimizer.hash !== reviewOptimizerHash) throw new Error("PROMOTION_OPTIMIZER_RECORD_TAMPERED");
  if (!reviewerRecord || reviewerRecord.hash !== reviewerInfo?.hash) throw new Error("PROMOTION_REVIEWER_RECORD_TAMPERED");
  assertDistinctRoleContexts([grader, optimizer, reviewerRecord]);
  assertRoleContextsDoNotOverlapGenerators([grader, optimizer, reviewerRecord], [...baseline, ...candidate]);
  const gateConfig = isRecord(reviewArtifact.gate) ? reviewArtifact.gate : {};
  if (gateConfig.minimumTrialsPerCase !== PROMOTION_MINIMUM_TRIALS || gateConfig.minimumImprovementDelta !== PROMOTION_MINIMUM_IMPROVEMENT_DELTA) throw new Error("PROMOTION_GATE_POLICY_TAMPERED");
  const minimumTrialsPerCase = PROMOTION_MINIMUM_TRIALS;
  const minimumImprovementDelta = PROMOTION_MINIMUM_IMPROVEMENT_DELTA;
  const recomputed = reviewExperiment(experiment, baseline, candidate, reviewPath, typeof review.reviewer === "string" ? review.reviewer : null, false, {
    acceptedBaseline,
    cases,
    rubrics,
    reviewEvidenceHash: typeof review.reviewEvidenceHash === "string" ? review.reviewEvidenceHash : null,
    qualityGraderRecordHash: typeof review.qualityGraderRecordHash === "string" ? review.qualityGraderRecordHash : null,
    optimizerRecordHash: typeof review.optimizerRecordHash === "string" ? review.optimizerRecordHash : null,
    minimumTrialsPerCase,
    minimumImprovementDelta,
  });
  const comparable = ["regressionPassed", "heldOutPassed", "varianceResolved", "budgetPassed", "timeBudgetPassed", "candidateImproved", "approved", "conclusion", "candidatePromptHash", "qualityGraderRecordHash", "optimizerRecordHash", "tokenBudgetObservation", "timeBudgetObservation"];
  for (const field of comparable) if (recomputed[field as keyof typeof recomputed] !== review[field]) throw new Error("PROMOTION_REVIEW_STALE");
  if (JSON.stringify([...recomputed.budgetLimitations].sort()) !== JSON.stringify(Array.isArray(review.budgetLimitations) ? review.budgetLimitations.filter((item): item is string => typeof item === "string").sort() : [])) throw new Error("PROMOTION_REVIEW_STALE");
  const expectedErrors = [...recomputed.gateErrors].sort();
  const actualErrors = Array.isArray(review.gateErrors) ? review.gateErrors.filter((item): item is string => typeof item === "string").sort() : [];
  if (JSON.stringify(expectedErrors) !== JSON.stringify(actualErrors)) throw new Error("PROMOTION_REVIEW_STALE");
  if (!Array.isArray(reviewArtifact.blindInputs) || reviewArtifact.blindInputs.some((item) => !isRecord(item) || typeof item.blindId !== "string" || typeof item.outputArtifact !== "string" || item.outputArtifact.includes("baseline") || item.outputArtifact.includes("candidate"))) throw new Error("PROMOTION_BLIND_INPUTS_NOT_OPAQUE");
  const blindMapPath = typeof reviewArtifact.blindMapPath === "string" ? reviewArtifact.blindMapPath : null;
  const blindMapHash = typeof reviewArtifact.blindMapHash === "string" ? reviewArtifact.blindMapHash : null;
  const blindInputsPath = typeof reviewArtifact.blindInputsPath === "string" ? reviewArtifact.blindInputsPath : null;
  const blindInputsHash = typeof reviewArtifact.blindInputsHash === "string" ? reviewArtifact.blindInputsHash : null;
  if (!blindMapPath || !blindMapHash || sha256Text(await fs.readFile(blindMapPath, "utf8")) !== blindMapHash || !blindInputsPath || !blindInputsHash || sha256Text(await fs.readFile(blindInputsPath, "utf8")) !== blindInputsHash) throw new Error("PROMOTION_BLIND_ARTIFACT_TAMPERED");
  const blindInputs = reviewArtifact.blindInputs as Array<{ blindId: string; outputArtifact: string }>;
  const blindMapRaw = JSON.parse(await fs.readFile(blindMapPath, "utf8")) as unknown;
  if (!Array.isArray(blindMapRaw)) throw new Error("PROMOTION_BLIND_MAP_INVALID");
  const blindIds = new Map<string, string>();
  for (const item of blindMapRaw) if (isRecord(item) && typeof item.trialId === "string" && typeof item.blindId === "string") blindIds.set(item.trialId, item.blindId);
  await assertBlindInputsBound(blindInputs, path.dirname(blindInputsPath), [...baseline, ...candidate], blindIds);
  if (review.reviewerApprovalHash !== reviewApprovalBindingHash(review, reviewArtifact, reviewerRecord.hash)) throw new Error("PROMOTION_REVIEW_APPROVAL_TAMPERED");
}

async function evalFinalizePromotionMain(values: Map<string, string>): Promise<number> {
  const promotionPath = values.get("--promotion");
  if (!promotionPath) throw new Error("eval finalize-promotion requires --promotion.");
  const resolvedPromotion = path.resolve(promotionPath);
  const promotion = JSON.parse(await fs.readFile(resolvedPromotion, "utf8")) as Record<string, unknown>;
  if (promotion.status !== "awaiting-final-acceptance") throw new Error("PROMOTION_FINAL_ACCEPTANCE_NOT_PENDING");
  const required = ["--package-artifact", "--sync-artifact", "--installed-preflight", "--run-manifest", "--html", "--ui-dispatch", "--trace"] as const;
  for (const flag of required) if (!values.get(flag)) throw new Error(`PROMOTION_FINAL_ACCEPTANCE_MISSING:${flag}`);
  const readArtifact = async (flag: string): Promise<{ path: string; sha256: string; bytes: number; value: Record<string, unknown> | null }> => {
    const artifactPath = path.resolve(values.get(flag)!);
    const bytes = await fs.readFile(artifactPath);
    let value: unknown;
    try { value = JSON.parse(bytes.toString("utf8")); } catch { value = null; }
    return { path: artifactPath, sha256: sha256Text(bytes.toString("utf8")), bytes: bytes.byteLength, value: isRecord(value) ? value : null };
  };
  const promotionBundle = typeof promotion.bundleVersion === "string" ? promotion.bundleVersion : null;
  if (!promotionBundle) throw new Error("PROMOTION_FINAL_BUNDLE_MISSING");
  const readVerificationArtifact = async (flag: string, kind: string, command: string): Promise<Awaited<ReturnType<typeof readArtifact>>> => {
    const artifact = await readArtifact(flag);
    if (!artifact.value || artifact.value.kind !== kind || artifact.value.command !== command
      || (artifact.value.status !== "passed" && artifact.value.status !== "verified" && artifact.value.status !== "completed")
      || artifact.value.bundleVersion !== promotionBundle
      || typeof artifact.value.observedAt !== "string") throw new Error(`PROMOTION_FINAL_ARTIFACT_UNBOUND:${flag}`);
    return artifact;
  };
  const packageArtifact = await readVerificationArtifact("--package-artifact", "package-skills", "npm run package-skills");
  const syncArtifact = await readVerificationArtifact("--sync-artifact", "verify-sync", "npm run verify-sync");
  const installedPreflight = await readVerificationArtifact("--installed-preflight", "installed-preflight", "npm run verify-installed-skill");
  const runManifest = await readArtifact("--run-manifest");
  const html = await readArtifact("--html");
  const trace = await readArtifact("--trace");
  if (html.bytes === 0) throw new Error("PROMOTION_FINAL_HTML_EMPTY");
  const manifest = JSON.parse(await fs.readFile(runManifest.path, "utf8")) as Record<string, unknown>;
  if (manifest.status !== "completed") throw new Error("PROMOTION_FINAL_RUN_INCOMPLETE");
  const laneStatus = isRecord(manifest.laneStatus) && isRecord(manifest.laneStatus["skill-insights"]) ? manifest.laneStatus["skill-insights"] : null;
  if (!laneStatus || laneStatus.status !== "accepted") throw new Error("PROMOTION_FINAL_SKILL_INSIGHTS_NOT_ACCEPTED");
  const manifestArtifacts = isRecord(manifest.artifacts) ? manifest.artifacts : null;
  const manifestHtml = manifestArtifacts && isRecord(manifestArtifacts.html) ? manifestArtifacts.html : null;
  if (!manifestHtml || manifestHtml.bytes !== html.bytes || manifestHtml.sha256 !== html.sha256) throw new Error("PROMOTION_FINAL_HTML_MANIFEST_MISMATCH");
  const skillArtifactInfo = manifestArtifacts && isRecord(manifestArtifacts.skillInsights) ? manifestArtifacts.skillInsights : null;
  if (!skillArtifactInfo || typeof skillArtifactInfo.file !== "string" || typeof skillArtifactInfo.sha256 !== "string") throw new Error("PROMOTION_FINAL_SKILL_INSIGHTS_ARTIFACT_MISSING");
  const skillArtifactPath = path.resolve(path.dirname(runManifest.path), skillArtifactInfo.file);
  const skillArtifactBytes = await fs.readFile(skillArtifactPath);
  if (sha256Text(skillArtifactBytes.toString("utf8")) !== skillArtifactInfo.sha256) throw new Error("PROMOTION_FINAL_SKILL_INSIGHTS_ARTIFACT_TAMPERED");
  const skillArtifact = JSON.parse(skillArtifactBytes.toString("utf8")) as Record<string, unknown>;
  if (skillArtifact.status !== "completed" || skillArtifact.valid !== true || !Array.isArray(skillArtifact.value) || skillArtifact.value.length === 0) throw new Error("PROMOTION_FINAL_SKILL_INSIGHTS_EMPTY");
  const firstContent = JSON.stringify(skillArtifact.value).match(/[A-Za-z\u4e00-\u9fff][^"\\\\]{8,}/)?.[0]?.replaceAll("\\\\n", " ").trim();
  const htmlText = await fs.readFile(path.resolve(values.get("--html")!), "utf8");
  if (!htmlText.includes("<section class=\"skill-insights\">") || !firstContent || !htmlText.includes(firstContent.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"))) throw new Error("PROMOTION_FINAL_SKILL_INSIGHTS_NOT_IN_HTML");
  if (manifest.bundleVersion !== promotionBundle) throw new Error("PROMOTION_FINAL_BUNDLE_MISMATCH");
  const manifestTrace = manifestArtifacts && isRecord(manifestArtifacts.trace) ? manifestArtifacts.trace : null;
  const expectedTracePath = path.join(path.dirname(runManifest.path), "trace.jsonl");
  if (trace.path !== expectedTracePath || manifestTrace?.file !== "trace.jsonl" || manifestTrace.bytes !== trace.bytes || manifestTrace.sha256 !== trace.sha256 || manifest.traceCompleteness !== "complete") throw new Error("PROMOTION_FINAL_TRACE_UNBOUND");
  const traceLines = (await fs.readFile(trace.path, "utf8")).split(/\r?\n/).filter(Boolean);
  const traceEvents = traceLines.map((line) => {
    try { return JSON.parse(line) as Record<string, unknown>; } catch { throw new Error("PROMOTION_FINAL_TRACE_UNPARSEABLE"); }
  });
  if (traceEvents.length < 2 || traceEvents.some((event) => event.runId !== manifest.runId) || traceEvents[0].event !== "run-start" || traceEvents.at(-1)?.event !== "run-end") throw new Error("PROMOTION_FINAL_TRACE_INCOMPLETE");
  const uiDispatch = JSON.parse(await fs.readFile(path.resolve(values.get("--ui-dispatch")!), "utf8")) as Record<string, unknown>;
  if ((uiDispatch.status !== "completed" && uiDispatch.status !== "queued") || uiDispatch.status !== manifest.uiDispatch) throw new Error("PROMOTION_FINAL_UI_DISPATCH_INCOMPLETE");
  const finalAcceptance = {
    version: 1,
    kind: "promotion-final-acceptance",
    status: "accepted",
    promotionPath: resolvedPromotion,
    bundleVersion: promotion.bundleVersion,
    artifacts: { packageArtifact, syncArtifact, installedPreflight, runManifest, html, trace },
    uiDispatch: { path: path.resolve(values.get("--ui-dispatch")!), sha256: sha256Text(JSON.stringify(uiDispatch)), status: uiDispatch.status },
    acceptedAt: new Date().toISOString(),
  };
  const finalPath = path.join(path.dirname(resolvedPromotion), `${path.basename(resolvedPromotion, ".json")}.final-acceptance.json`);
  await fs.writeFile(finalPath, JSON.stringify(finalAcceptance, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  const updated = { ...promotion, status: "accepted", finalAcceptancePath: finalPath, finalAcceptanceHash: sha256Text(JSON.stringify(finalAcceptance, null, 2) + "\n") };
  const temporary = `${resolvedPromotion}.${process.pid}.finalize.tmp`;
  await fs.writeFile(temporary, JSON.stringify(updated, null, 2) + "\n", "utf8");
  await fs.rename(temporary, resolvedPromotion);
  process.stdout.write(JSON.stringify({ accepted: true, promotion: resolvedPromotion, finalAcceptance: finalPath }) + "\n");
  return 0;
}

async function evalPromoteMain(values: Map<string, string>): Promise<number> {
  const reviewPath = values.get("--review");
  if (!reviewPath) throw new Error("eval promote requires --review.");
  await requireEvalStatePhase(values, "promote");
  const reviewArtifact = JSON.parse(await fs.readFile(path.resolve(reviewPath), "utf8")) as Record<string, unknown>;
  const review = isRecord(reviewArtifact.review) ? reviewArtifact.review : null;
  const experiment = isRecord(reviewArtifact.experiment) ? reviewArtifact.experiment : null;
  if (!review || !experiment || !isEvalExperiment(experiment) || review.conclusion !== "eligible" || review.approved !== true) throw new Error("PROMOTION_GATE_REJECTED: regression, held-out, variance, budget, improvement, or review gate is incomplete.");
  if (review.reviewArtifactHash !== reviewArtifactBindingHash(reviewArtifact)) throw new Error("PROMOTION_REVIEW_ARTIFACT_TAMPERED");
  if (typeof review.reviewEvidenceHash !== "string" || !/^[a-f0-9]{64}$/i.test(review.reviewEvidenceHash)) throw new Error("PROMOTION_REVIEW_EVIDENCE_MISSING");
  if (typeof review.reviewer !== "string" || review.reviewer.length === 0 || typeof review.reviewerApprovalHash !== "string") throw new Error("PROMOTION_REVIEW_APPROVAL_MISSING");
  await revalidatePromotionReview(reviewArtifact, review, experiment, path.resolve(reviewPath));
  const lane = experiment.lane;
  if (lane !== "report-synthesis" && lane !== "key-session-analysis" && lane !== "skill-insights") throw new Error("PROMOTION_LANE_INVALID");
  const candidatePrompt = values.get("--candidate-prompt");
  const targetPrompt = path.resolve(values.get("--target-prompt") ?? path.join("prompts", `${lane}.md`));
  const expectedTarget = path.resolve(path.join("prompts", `${lane}.md`));
  if (targetPrompt !== expectedTarget) throw new Error("PROMOTION_PATH_INVALID: only the authoritative Prompt for the selected lane may be updated.");
  if (!candidatePrompt) throw new Error("eval promote requires --candidate-prompt.");
  const candidateResolved = path.resolve(candidatePrompt);
  const candidateRoot = path.resolve("evals", "candidates");
  const candidateRelative = path.relative(candidateRoot, candidateResolved);
  if (!candidateRelative || candidateRelative.startsWith("..") || path.isAbsolute(candidateRelative)) throw new Error("PROMOTION_CANDIDATE_PATH_INVALID");
  const candidateText = await fs.readFile(candidateResolved, "utf8");
  const candidateHash = sha256Text(candidateText);
  if (candidateHash !== review.candidatePromptHash || candidateHash !== experiment.candidatePromptHash) throw new Error("PROMOTION_HASH_MISMATCH: candidate Prompt hash does not match the accepted review artifact.");
  const currentText = await fs.readFile(targetPrompt, "utf8");
  if (sha256Text(currentText) !== experiment.baselinePromptHash) throw new Error("PROMOTION_ACCEPTED_BASELINE_HASH_MISMATCH");
  if (candidateHash === sha256Text(currentText)) throw new Error("PROMOTION_PROMPT_HASH_UNCHANGED");
  const temporary = targetPrompt + ".promotion-" + process.pid;
  await fs.writeFile(temporary, candidateText, "utf8");
  await fs.rename(temporary, targetPrompt);
  const promotionPath = path.join(path.dirname(path.resolve(reviewPath)), `${experiment.id}.promotion.json`);
  const currentContract = await resolveRunContractMetadata();
  if (!currentContract.bundleVersion) throw new Error("PROMOTION_BUNDLE_VERSION_UNAVAILABLE");
  await fs.writeFile(promotionPath, JSON.stringify({ version: 1, experimentId: experiment.id, lane, previousPromptHash: sha256Text(currentText), candidatePromptHash: candidateHash, reviewPath: path.resolve(reviewPath), bundleVersion: currentContract.bundleVersion.bundleVersion, status: "awaiting-final-acceptance", promotedAt: new Date().toISOString() }, null, 2) + "\n", "utf8");
  await advanceEvalState(values.get("--state")!, values.get("--experiment")!, "promote", [path.resolve(reviewPath), promotionPath]);
  process.stdout.write(JSON.stringify({ promoted: true, lane, targetPrompt, promotionArtifact: promotionPath, finalAcceptanceRequired: true }) + "\n");
  return 0;
}

async function requireEvalStatePhase(values: Map<string, string>, phase: EvalPhase): Promise<void> {
  const statePath = values.get("--state");
  const experimentArg = values.get("--experiment") ?? values.get("--experiment-id");
  if (!statePath || !experimentArg) throw new Error(`EVAL_STATE_REQUIRED:${phase}`);
  let experimentId = experimentArg;
  if (experimentArg.endsWith(".json")) {
    const parsed = JSON.parse(await fs.readFile(path.resolve(experimentArg), "utf8")) as Record<string, unknown>;
    if (typeof parsed.id !== "string") throw new Error(`EVAL_EXPERIMENT_INVALID:${experimentArg}`);
    experimentId = parsed.id;
  }
  const state = await readEvalState(statePath, experimentId);
  if (state.nextLegalAction !== phase) throw new Error(`EVAL_STATE_ILLEGAL_ACTION:${phase}:expected:${state.nextLegalAction ?? "complete"}`);
}

async function evalStateMain(values: Map<string, string>): Promise<number> {
  const statePath = values.get("--state");
  const experimentId = values.get("--experiment");
  const action = values.get("--action");
  if (!statePath || !experimentId || !action) throw new Error("eval state requires --state, --experiment, and --action.");
  if (action === "status") {
    const state = await readEvalState(statePath, experimentId);
    process.stdout.write(JSON.stringify({ state, reused: false }) + "\n");
    return 0;
  }
  if (!["freeze", "generator", "contract-grade", "blind-quality-grade", "optimize", "regression", "held-out", "review", "promote"].includes(action)) throw new Error("EVAL_STATE_ACTION_INVALID");
  const evidence = (values.get("--evidence") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const result = await advanceEvalState(statePath, experimentId, action as EvalPhase, evidence);
  process.stdout.write(JSON.stringify(result) + "\n");
  return 0;
}

export function codexLocator(values: Map<string, string>): {
  rolloutPath: string;
  sessionId: string;
  threadId: string;
  turnId: string;
  responseItemId: string;
  tokenMetric: "output_tokens" | "total_tokens";
} {
  const rolloutPath = values.get("--rollout");
  const sessionId = values.get("--session");
  const threadId = values.get("--thread");
  const turnId = values.get("--turn");
  const responseItemId = values.get("--response-item");
  const tokenMetric = values.get("--token-metric") ?? "total_tokens";
  if (!rolloutPath || !sessionId || !threadId || !turnId || !responseItemId) throw new Error("Codex provenance requires --rollout, --session, --thread, --turn, and --response-item.");
  if (tokenMetric !== "output_tokens" && tokenMetric !== "total_tokens") throw new Error("EVAL_TOKEN_METRIC_INVALID");
  return { rolloutPath: path.resolve(rolloutPath), sessionId, threadId, turnId, responseItemId, tokenMetric };
}

async function evalCodexOutputMain(values: Map<string, string>): Promise<number> {
  const outputPath = values.get("--output");
  if (!outputPath) throw new Error("eval codex-output requires --output.");
  const locator = codexLocator(values);
  const result = await readCodexResponseOutput(locator);
  await fs.writeFile(path.resolve(outputPath), result.text, { encoding: "utf8", flag: "wx" });
  process.stdout.write(JSON.stringify({ output: path.resolve(outputPath), outputHash: result.outputHash, provenance: result.provenance }) + "\n");
  return 0;
}

async function evalGenerationIndexMain(values: Map<string, string>): Promise<number> {
  const indexPath = values.get("--index");
  const outputPath = values.get("--output-file");
  const caseId = values.get("--case-id");
  const lane = values.get("--lane");
  const role = values.get("--role");
  const inputHash = values.get("--input-hash");
  const promptHash = values.get("--prompt-hash");
  const modelComparisonKey = values.get("--comparison-key");
  if (!indexPath || !outputPath || !caseId || !lane || !role || !inputHash || !promptHash || !modelComparisonKey) throw new Error("eval generation-index requires --index, --output-file, --case-id, --lane, --role, --input-hash, --prompt-hash, and --comparison-key.");
  if (role !== "baseline" && role !== "candidate") throw new Error("EVAL_GENERATION_ROLE_INVALID");
  const rawOutput = await fs.readFile(path.resolve(outputPath), "utf8");
  const record = await createGenerationIndex({ caseId, lane: lane as EvalCase["lane"], role, inputHash, promptHash, modelComparisonKey, rawOutput, provenance: codexLocator(values) });
  await fs.writeFile(path.resolve(indexPath), JSON.stringify(record, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  process.stdout.write(JSON.stringify({ index: path.resolve(indexPath), outputHash: record.outputHash, sourceReference: record.sourceReference, sourceReferenceHash: record.sourceReferenceHash }) + "\n");
  return 0;
}

async function evalRoleIndexMain(values: Map<string, string>): Promise<number> {
  const indexPath = values.get("--index");
  const outputPath = values.get("--output-file");
  const role = values.get("--role");
  if (!indexPath || !outputPath || !role || (role !== "quality-grader" && role !== "optimizer" && role !== "reviewer")) throw new Error("eval role-index requires --index, --output-file, and a valid --role.");
  const rawOutput = await fs.readFile(path.resolve(outputPath), "utf8");
  const record = await createRoleIndex({ role, rawOutput, provenance: codexLocator(values) });
  await fs.writeFile(path.resolve(indexPath), JSON.stringify(record, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  process.stdout.write(JSON.stringify({ index: path.resolve(indexPath), role, outputHash: record.outputHash, sourceReference: record.sourceReference, sourceReferenceHash: record.sourceReferenceHash }) + "\n");
  return 0;
}

async function evalMain(args: string[]): Promise<number> {
  const command = args[0];
  const values = new Map<string, string>();
  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag.startsWith("--")) throw new Error(`Unknown eval argument: ${flag}.`);
    values.set(flag, requireValue(args, index, flag));
    index += 1;
  }
  if (command === "codex-output") return evalCodexOutputMain(values);
  if (command === "generation-index") return evalGenerationIndexMain(values);
  if (command === "role-index") return evalRoleIndexMain(values);
  if (command === "review") return evalReviewMain(values);
  if (command === "blind-map") return evalBlindMapMain(values);
  if (command === "baseline") return evalBaselineMain(values);
  if (command === "baseline-bootstrap") return evalBaselineBootstrapMain(values);
  if (command === "optimize") return evalOptimizeMain(values);
  if (command === "promote") return evalPromoteMain(values);
  if (command === "finalize-promotion") return evalFinalizePromotionMain(values);
  if (command === "state") return evalStateMain(values);
  const casePath = values.get("--case");
  if (!casePath) throw new Error("eval requires --case <path>.");
  const caseFile = path.resolve(casePath);
  const evalCase = await readEvalCase(caseFile);
  if (command === "contract") {
    const inputPath = values.get("--input") ?? path.resolve(evalCase.inputArtifact);
    const { inputHash } = await checkEvalInput(evalCase, inputPath);
    process.stdout.write(JSON.stringify({ valid: true, caseId: evalCase.id, lane: evalCase.lane, split: evalCase.split, inputHash, privacy: evalCase.privacy }) + "\n");
    return 0;
  }
  if (command !== "trial") throw new Error("Use eval contract or eval trial.");
  const promptHash = values.get("--prompt-hash");
  const requestedBundleVersion = values.get("--bundle-version");
  const artifactDir = values.get("--artifact-dir");
  const role = values.get("--role");
  if (!promptHash || !/^[a-f0-9]{64}$/i.test(promptHash)) throw new Error("eval trial requires a 64-character --prompt-hash.");
  if (!requestedBundleVersion) throw new Error("eval trial requires --bundle-version.");
  if (!artifactDir) throw new Error("eval trial requires --artifact-dir.");
  if (role !== "baseline" && role !== "candidate") throw new Error("eval trial --role must be baseline or candidate.");
  const promotionCritical = values.get("--promotion-critical") === "true" || values.get("--promotion-critical") === "1";
  if (promotionCritical) await requireEvalStatePhase(values, "generator");
  if (promotionCritical && !values.get("--generation-record")) throw new Error("EVAL_GENERATION_PROVENANCE_REQUIRED");
  const tokenMetric = values.get("--token-metric");
  if (tokenMetric !== undefined && tokenMetric !== "output_tokens" && tokenMetric !== "total_tokens") throw new Error("EVAL_TOKEN_METRIC_INVALID");
  let bundleVersion = requestedBundleVersion;
  let effectiveTokenMetric = tokenMetric;
  if (promotionCritical) {
    const experimentArg = values.get("--experiment");
    const currentContract = await resolveRunContractMetadata();
    if (!currentContract.bundleVersion) throw new Error("EVAL_BUNDLE_VERSION_UNAVAILABLE");
    bundleVersion = currentContract.bundleVersion.bundleVersion;
    if (experimentArg?.endsWith(".json")) {
      const parsedExperiment = JSON.parse(await fs.readFile(path.resolve(experimentArg), "utf8")) as unknown;
      if (!isEvalExperiment(parsedExperiment)) throw new Error("EVAL_EXPERIMENT_INVALID");
      if (tokenMetric !== undefined && tokenMetric !== parsedExperiment.tokenMetric) throw new Error("EVAL_TOKEN_METRIC_EXPERIMENT_MISMATCH");
      effectiveTokenMetric = parsedExperiment.tokenMetric;
    }
  }
  const resolvedArtifactDir = path.resolve(artifactDir);
  const repoRoot = path.resolve(process.cwd());
  const relativeArtifactDir = path.relative(repoRoot, resolvedArtifactDir);
  const relativeScratchDir = path.relative(path.resolve(repoRoot, ".scratch"), resolvedArtifactDir);
  const relativeTempDir = path.relative(path.resolve(os.tmpdir()), resolvedArtifactDir);
  const underScratch = relativeScratchDir === "" || (!relativeScratchDir.startsWith("..") && !path.isAbsolute(relativeScratchDir));
  const underTemp = relativeTempDir === "" || (!relativeTempDir.startsWith("..") && !path.isAbsolute(relativeTempDir));
  if (relativeArtifactDir === "" || (!underScratch && !underTemp)) throw new Error("EVAL_ARTIFACT_DIR_NOT_LOCAL");
  const rawOutput = await readStdin();
  const inputFile = values.get("--input");
  const modelConfig = {
    provider: values.get("--provider") ?? "host-agent",
    model: values.get("--model") ?? "unspecified",
    temperature: values.has("--temperature") ? Number(values.get("--temperature")) : null,
    comparisonKey: values.get("--comparison-key") ?? `${values.get("--provider") ?? "host-agent"}/${values.get("--model") ?? "unspecified"}`,
  };
  const trial = await runEvalTrial({
    casePath: caseFile,
    inputPath: inputFile ? path.resolve(inputFile) : undefined,
    rawOutput,
    role,
    promptHash,
    bundleVersion,
    modelConfig,
    artifactDir: resolvedArtifactDir,
    durationMs: values.has("--duration-ms") ? Number(values.get("--duration-ms")) : null,
    tokenCount: values.has("--token-count") ? Number(values.get("--token-count")) : null,
    toolCallCount: values.has("--tool-call-count") ? Number(values.get("--tool-call-count")) : null,
    transcriptRef: values.get("--transcript-ref") ?? null,
    experimentId: values.get("--experiment") ?? "standalone-eval",
    attempt: values.has("--attempt") ? Number(values.get("--attempt")) : 1,
    trialId: values.get("--trial-id"),
    generationRecordPath: values.get("--generation-record"),
    promotionCritical,
    tokenMetric: effectiveTokenMetric as "output_tokens" | "total_tokens" | undefined,
  });
  process.stdout.write(JSON.stringify({ trial, laneOnly: true, sideEffects: { historyScan: false, pricing: false, fonts: false, html: false, ui: false, install: false, package: false } }) + "\n");
  return trial.contractStatus === "passed" ? 0 : 2;
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    if (args[0] === "eval") return await evalMain(args.slice(1));
    if (args[0] === "report-run") return await reportRunMain(args.slice(1));
    if (args[0] === "compose-report") return await composeReportMain(args.slice(1));
    const options = parseArgs(args);
    await verifyInstalledSkill();
    let result: AuditResult;
    let localFirstUserMessages: NonNullable<ReadResult["firstUserMessages"]> = [];
    if (options.view === "week") {
      const currentTo = new Date();
      const currentFrom = new Date(currentTo.getTime() - 7 * 24 * 60 * 60 * 1000);
      const previousFrom = new Date(currentFrom.getTime() - 7 * 24 * 60 * 60 * 1000);
      const sourceScope: ReadScope = { cwd: options.cwd, allProjects: options.allProjects, since: previousFrom };
      const sourceRead = await readHarness(options.harness, sourceScope);
      const pricing = await resolveApiPricing(sourceRead.modelCalls, options.harness, options.pricing);
      const currentScope: ReadScope = { cwd: options.cwd, allProjects: options.allProjects, since: currentFrom };
      const previousScope: ReadScope = { cwd: options.cwd, allProjects: options.allProjects, since: previousFrom };
      const current = analyseAudit(currentScope, sliceRead(sourceRead, currentFrom, currentTo), options.harness, pricing);
      const previous = analyseAudit(previousScope, sliceRead(sourceRead, previousFrom, currentFrom), options.harness, pricing);
      result = { ...current, view: "week", weekComparison: makeWeekComparison(current, previous, currentFrom, currentTo, previousFrom) };
    } else {
      const since = options.view === "share" && !options.sinceExplicit ? parseDuration("30d") : options.since;
      const scope: ReadScope = { cwd: options.cwd, allProjects: options.allProjects, since };
      const read = await readHarness(options.harness, scope);
      const pricing = await resolveApiPricing(read.modelCalls, options.harness, options.pricing);
      result = { ...analyseAudit(scope, read, options.harness, pricing), view: options.view };
      const topSessionIds = new Set(result.rankings.sessions.slice(0, 3).map((session) => session.key));
      localFirstUserMessages = (read.firstUserMessages ?? []).filter((record) => topSessionIds.has(record.sessionId));
    }

    const outputKinds: string[] = [];
    const shouldWriteHtml = options.htmlPath !== null;
    if (shouldWriteHtml) {
      const target = options.htmlPath as string;
      const projectName = options.cwd ? resolveReportProjectName(options.cwd) : null;
      const htmlResult = projectName ? { ...result, projectName } : result;
      await writeLocalFile(target, await subsetReportFonts(renderHtml(htmlResult, options.locale, undefined, localFirstUserMessages, reportFontConfig(options.fontPath, options.fontFamily))));
      outputKinds.push("local HTML report");
    }
    if (options.sharePath !== null || options.view === "share") {
      const target = options.sharePath ?? defaultOutputPath(options.harness, "share", ".md");
      await writeLocalFile(target, renderShare(result, options.locale));
      outputKinds.push("local share Markdown");
    }

    if (options.format === "json") {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else if (result.weekComparison) {
      process.stdout.write(renderWeekText(result.weekComparison, options.locale));
    } else {
      process.stdout.write(renderText(result, options.locale, options.view));
    }
    if (options.format === "text" && outputKinds.length > 0) {
      process.stdout.write(outputKinds.map((outputKind) => "Output: " + outputKind + " written.").join("\n") + "\n");
    }
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "where-tokens-went failed."}\n`);
    return 2;
  }
}

if (require.main === module) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
