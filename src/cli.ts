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
  ALLOWED_GENERATION_FAILURE_REASONS,
  isAllowedGenerationFailureReason,
  validateHostFailureReceipt,
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
  isLaneTerminal,
  REPORT_LANES,
  buildLaneProjection,
  projectReportSynthesisInput,
  projectKeySessionAnalysisInput,
  projectSkillInsightsInput,
  recordRunProjection,
  validateLaneProjection,
  type ExternalSpanEvent,
  type LaneProjection,
  type LaneProjectionContext,
  type ReportRun,
  type ReportRunManifest,
  type ReportRunScope,
  type ReportLane,
} from "./report-run";
import { normalizeLocale, renderHtml, renderReportJson, renderShare, renderText, renderWeekText, resolveReportProjectName, subsetReportFonts, type ReportFontConfig } from "./report";
import { selectSkillCandidates, loadSkillSnapshot, validateSkillInsights } from "./skill-insights";
import type { AuditResult, AuditSnapshot, AuditView, ContentEvidencePacket, ContentEvidenceSelection, EvidenceValue, FirstUserMessageRecord, Harness, KeySessionAnalysis, ReadResult, ReadScope, ReportJson, ReportLocale, ReportSynthesis, WeekComparison, WeekStructureChange, SkillSnapshotArtifact, ValidatedSkillInsight } from "./types";

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
    "Usage: where-tokens-went inspect --harness <codex> --cwd <absolute-path> [--since 7d] [--format json|text] [--locale zh-CN|en-US] [--font <font-file>] [--font-family <name>] [--pricing litellm] [--view full|usage|window|report|tools|week|share]",
    "       where-tokens-went inspect --harness <codex> --all-projects [--since 7d] [--format json|text] [--locale zh-CN|en-US] [--font <font-file>] [--font-family <name>] [--pricing litellm] [--view full|usage|window|report|tools|week|share]",
    "       where-tokens-went compose-report --locale zh-CN|en-US --font <font-file> [--font-family <name>] --html <final-path> < composition JSON envelope",
    "       where-tokens-went render-report --json <report.json> --html <final-path> [--run-dir <directory>]",
    "       where-tokens-went report-run run-all start --harness <codex> (--cwd <absolute-path>|--all-projects) [--since 7d] [--locale zh-CN|en-US] [--pricing litellm] [--run-dir <directory>]",
    "       where-tokens-went report-run run-all finish --run-dir <directory> [--html <final-path>]",
    "       where-tokens-went report-run prepare --harness <codex> (--cwd <absolute-path>|--all-projects) [--since 7d] [--locale zh-CN|en-US] [--pricing litellm] [--run-dir <directory>]",
    "       where-tokens-went report-run evidence --run-dir <directory> < evidence selection JSON",
    "       where-tokens-went report-run evidence --run-dir <directory> --auto",
    "       where-tokens-went report-run ai-start|ai-accept|ai-fallback --run-dir <directory> --lane <lane> ...",
    "       where-tokens-went report-run compose --run-dir <directory> --locale zh-CN|en-US (--json|--html <final-path>)",
    "       where-tokens-went report-run event|status|finalize|cleanup --run-dir <directory> ...",
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
      if (value === "claude") throw new Error("Claude Code support is paused. 此调用未读取 Claude Code 或 Codex 历史记录。请在 Codex 中调用 where-tokens-went。\n" + usage());
      if (value !== "codex") throw new Error(`Unsupported Harness ${value}; the active Harness is codex.\n${usage()}`);
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
    executionMode: run.manifest.executionMode,
    executionModeReasonCode: run.manifest.executionModeReasonCode,
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

async function prepareReportRunInternal(
  args: string[],
  runDir: string | null,
  installedBundle: Awaited<ReturnType<typeof verifyInstalledSkill>>,
): Promise<ReportRun> {
  const frozenNow = Date.now();
  const options = parseArgs(["inspect", ...args], frozenNow);
  if (options.view !== "full") throw new Error("report-run prepare only supports the full report workflow.");
  if (options.htmlPath || options.sharePath) throw new Error("report-run prepare does not write HTML or share output.");
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
    return run;
  } catch (error) {
    if (run) await markPreparedRunFailed(run);
    throw error;
  }
}

async function reportRunPrepareMain(args: string[]): Promise<number> {
  const { runDir, rest } = extractRunDirectory(args);
  const installedBundle = await verifyInstalledSkill();
  const run = await prepareReportRunInternal(rest, runDir, installedBundle);
  outputRunSummary(run, { next: ["evidence", "report-synthesis", "key-session-analysis", "skill-insights", "compose", "finalize"] });
  return 0;
}

async function autoEvidenceRunInternal(run: ReportRun): Promise<ContentEvidencePacket[]> {
  const audit = await readCanonicalAudit(run);
  const input: EvidenceInput = await withRunSpan(run, { phase: "content-selection", operation: "auto-evidence-selection", source: "runner" }, async () => ({
    selections: run.manifest.topSessions.slice(0, 3).map((session) => ({
      sessionId: session.sessionId,
      turnIds: audit.turns.filter((turn) => turn.sessionId === session.sessionId).slice(0, 8).map((turn) => turn.turnId),
      selectionReason: "Audit Top 3 Token-ranked Session auto selection",
      unreadScope: "remaining Turns in the same selected Session and Audit Scope",
    })),
  }));
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
    return cached.packets;
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
  return packets;
}

async function reportRunEvidenceMain(args: string[]): Promise<number> {
  const { runDir, rest } = extractRunDirectory(args);
  const auto = rest.length === 1 && rest[0] === "--auto";
  if (rest.length > 0 && !auto) throw new Error(`Unknown report-run evidence argument: ${rest[0]}.\n${usage()}`);
  const installedBundle = await verifyInstalledSkill();
  const run = await openReportRun(requireRunDirectory(runDir));
  assertRunBundleVersion(run, installedBundle.bundleVersion);
  if (auto) {
    const existing = run.manifest.artifacts.evidence ? await readRunArtifact(run.runDir, "evidence") as RunEvidenceArtifact : null;
    const isReused = existing !== null;
    const packets = await autoEvidenceRunInternal(run);
    outputRunSummary(run, { evidence: packetSummary(packets), reused: isReused });
    return 0;
  }
  const audit = await readCanonicalAudit(run);
  const input: EvidenceInput = await withRunSpan(run, { phase: "content-selection", operation: "parse-evidence-selection", source: "runner" }, async () => parseEvidenceInput(await readStdin()));
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

interface RunComposeOptions {
  runDir: string;
  locale: ReportLocale;
  htmlPath: string | null;
  jsonOnly: boolean;
  fontPath: string | null;
  fontFamily: string | null;
}

function parseRunComposeArgs(args: string[]): RunComposeOptions {
  const extracted = extractRunDirectory(args);
  let locale: ReportLocale = "en-US";
  let htmlPath: string | null = null;
  let jsonOnly = false;
  let fontPath: string | null = null;
  let fontFamily: string | null = null;
  for (let index = 0; index < extracted.rest.length; index += 1) {
    const flag = extracted.rest[index];
    if (flag === "--locale" || flag === "--lang") {
      locale = normalizeLocale(requireValue(extracted.rest, index, flag));
      index += 1;
    } else if (flag === "--html") {
      if (htmlPath || jsonOnly) throw new Error("report-run compose accepts exactly one output: --json or --html.");
      htmlPath = requireValue(extracted.rest, index, flag);
      index += 1;
    } else if (flag === "--json") {
      if (htmlPath || jsonOnly) throw new Error("report-run compose accepts exactly one output: --json or --html.");
      jsonOnly = true;
    } else if (flag === "--font") {
      fontPath = requireValue(extracted.rest, index, flag);
      index += 1;
    } else if (flag === "--font-family") {
      fontFamily = requireValue(extracted.rest, index, flag);
      index += 1;
    } else {
      throw new Error(`Unknown report-run compose argument: ${flag}.\n${usage()}`);
    }
  }
  if (!htmlPath && !jsonOnly) throw new Error(`report-run compose requires --json or --html.\n${usage()}`);
  if (fontFamily && !fontPath) throw new Error("--font-family requires --font <font-file>.");
  return { runDir: requireRunDirectory(extracted.runDir), locale, htmlPath, jsonOnly, fontPath, fontFamily };
}

function assertRunContract(run: ReportRun, installedBundle: Awaited<ReturnType<typeof verifyInstalledSkill>>, contract: Awaited<ReturnType<typeof resolveRunContractMetadata>>): void {
  assertRunBundleVersion(run, installedBundle.bundleVersion);
  if (!contract.runtimeHash || !contract.promptHashes.reportSynthesis || !contract.promptHashes.keySessionAnalysis || !contract.promptHashes.skillInsights) throw new Error("Authoritative Report Prompts or runtime contract is unavailable.");
  if (!contract.bundleVersion || contract.bundleVersion.bundleVersion !== run.manifest.bundleVersion) throw new Error("Report Run bundle version changed during execution. Run npm run install-local.");
  if (run.manifest.runtimeHash !== contract.runtimeHash || run.manifest.promptHashes.reportSynthesis !== contract.promptHashes.reportSynthesis || run.manifest.promptHashes.keySessionAnalysis !== contract.promptHashes.keySessionAnalysis || run.manifest.promptHashes.skillInsights !== contract.promptHashes.skillInsights) throw new Error("Report Prompt or runtime contract changed during execution; the Run cannot continue. Run npm run install-local.");
}

interface LaneTicket {
  runId: string;
  lane: ReportLane;
  attempt: number;
  spanId: string;
  locale: ReportLocale;
  auditFingerprint: string | null;
  bundleVersion: string | null;
  promptHash: string | null;
  runtimeHash: string | null;
  inputArtifact: string;
  promptArtifact: string;
  snapshotId?: string;
}

function buildLaneTicket(run: ReportRun, lane: ReportLane, snapshotId?: string): LaneTicket {
  const current = run.manifest.laneStatus[lane];
  const spanId = run.manifest.stageStatus[lane]?.spanId ?? "";
  return {
    runId: run.manifest.runId,
    lane,
    attempt: current.attempts,
    spanId,
    locale: run.manifest.scope.locale,
    auditFingerprint: run.manifest.auditFingerprint,
    bundleVersion: run.manifest.bundleVersion,
    promptHash: lanePromptHash(run.manifest, lane),
    runtimeHash: run.manifest.runtimeHash,
    inputArtifact: current.inputArtifact ?? `lanes/${lane}/input.json`,
    promptArtifact: `lanes/${lane}/prompt.json`,
    ...(snapshotId ? { snapshotId } : {}),
  };
}

async function startLaneInternal(run: ReportRun, lane: ReportLane): Promise<LaneTicket> {
  const audit = await readCanonicalAudit(run);
  const promptHash = lanePromptHash(run.manifest, lane);
  const bundleVersion = run.manifest.bundleVersion;
  if (!bundleVersion) throw new Error("Bundle version is unavailable for Report Run.");
  const auditFingerprint = run.manifest.auditFingerprint;
  if (!auditFingerprint) throw new Error("Audit fingerprint is unavailable for Report Run.");

  const context: LaneProjectionContext = {
    runId: run.manifest.runId,
    lane,
    scope: run.manifest.scope,
    locale: run.manifest.scope.locale,
    auditFingerprint,
    bundleVersion,
    promptHash,
  };

  let projection: LaneProjection;
  let snapshotId: string | undefined;

  if (lane === "report-synthesis") {
    projection = projectReportSynthesisInput(context, audit);
  } else if (lane === "key-session-analysis") {
    const evidence = run.manifest.artifacts.evidence ? await readRunArtifact(run.runDir, "evidence") as { packets: ContentEvidencePacket[] } : null;
    if (!evidence) throw new Error("Key Session Analysis requires report-run evidence --auto before ai-start.");
    projection = projectKeySessionAnalysisInput(context, audit, evidence);
  } else {
    if (!run.manifest.artifacts.skillSnapshot) throw new Error("Skill Insights requires a frozen Skill Snapshot.");
    const snapshot = await readRunArtifact(run.runDir, "skillSnapshot") as SkillSnapshotArtifact;
    snapshotId = snapshot.snapshotId;
    projection = projectSkillInsightsInput(context, snapshot);
  }

  const inputRef = await writeRunLaneArtifact(run, lane, "input", projection);
  await recordRunProjection(run, lane, inputRef);
  const promptRef = await writeRunLaneArtifact(run, lane, "prompt", { version: 1, lane, promptHash, bundleVersion });
  const started = await startReportLane(run, lane, inputRef.file);
  return {
    runId: run.manifest.runId,
    lane,
    attempt: started.attempt,
    spanId: started.spanId,
    locale: run.manifest.scope.locale,
    auditFingerprint,
    bundleVersion,
    promptHash,
    runtimeHash: run.manifest.runtimeHash,
    inputArtifact: inputRef.file,
    promptArtifact: promptRef.file,
    ...(snapshotId ? { snapshotId } : {}),
  };
}

async function reportRunAiStartMain(args: string[]): Promise<number> {
  const { runDir, lane } = parseLaneCommandArgs(args);
  const installedBundle = await verifyInstalledSkill();
  const run = await openReportRun(runDir);
  const contract = await resolveRunContractMetadata();
  assertRunContract(run, installedBundle, contract);
  const ticket = await startLaneInternal(run, lane);
  process.stdout.write(JSON.stringify(ticket) + "\n");
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
): Promise<
  | { status: "observed"; durationMs: number; metadata: Record<string, string | number | boolean | null> }
  | { status: "unavailable"; reasonCode: string }
> {
  const file = path.join(run.runDir, `lanes/${lane}/host-response.json`);
  let contents: string;
  try {
    contents = await fs.readFile(file, "utf8");
  } catch {
    return { status: "unavailable", reasonCode: "HOST_TIMING_UNAVAILABLE" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return { status: "unavailable", reasonCode: "HOST_TIMING_INVALID" };
  }
  const value = isRecord(parsed) ? parsed : null;
  const provenance = value && isRecord(value.provenance) ? value.provenance : null;
  const expectedPromptHash = lanePromptHash(run.manifest, lane);
  const errors: string[] = [];
  if (!value || value.kind !== "host-agent-response" || (value.source !== "codex-host-agent" && value.source !== "host-agent")) errors.push("kind/source");
  if (!value || value.runId !== run.manifest.runId || value.lane !== lane || value.auditFingerprint !== run.manifest.auditFingerprint) errors.push("run binding");
  if (!value || value.bundleVersion !== run.manifest.bundleVersion || value.promptHash !== expectedPromptHash || value.inputArtifact !== currentLane.inputArtifact || value.promptArtifact !== `lanes/${lane}/prompt.json`) errors.push("contract binding");
  if (!value || value.outputHash !== outputHash) errors.push("output hash");
  if (value && typeof value.attempt === "number" && value.attempt !== currentLane.attempts) errors.push("attempt binding");
  const activeSpanId = run.manifest.stageStatus[lane]?.spanId;
  if (value && typeof value.spanId === "string" && activeSpanId && value.spanId !== activeSpanId) errors.push("span binding");
  if (!provenance || provenance.status !== "completed" || typeof provenance.threadId !== "string" || typeof provenance.turnId !== "string" || typeof provenance.responseItemId !== "string" || typeof provenance.durationMs !== "number" || !Number.isFinite(provenance.durationMs) || provenance.durationMs < 0) errors.push("provenance");
  if (provenance && typeof provenance.endedAt === "string" && currentLane.spanStartedAt) {
    if (Date.parse(provenance.endedAt) < Date.parse(currentLane.spanStartedAt)) errors.push("expired");
  }
  if (errors.length > 0) return { status: "unavailable", reasonCode: "HOST_TIMING_INVALID" };
  return {
    status: "observed",
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
  validateLaneProjection(run, options.lane, input, lanePromptHash(run.manifest, options.lane));
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
  const timing = hostTiming.status === "observed"
    ? { status: "observed", durationMs: hostTiming.durationMs }
    : { status: "unavailable", reasonCode: hostTiming.reasonCode };
  await writeRunLaneArtifact(run, options.lane, "validation", {
    version: 1, runId: run.manifest.runId, lane: options.lane, attempt, status: validationStatus,
    outputHash,
    errors,
    rejectionReasons: [...new Set([...errors.map((error) => error.code), ...validationRejectionReasons])],
    generationTiming: timing,
    ...(unsupportedClaimsDropped > 0 ? { unsupportedClaimsDropped } : {}),
    ...(hostTiming.status === "observed" ? { generation: hostTiming.metadata } : {}),
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
  } else {
    const reasonCode = errors[0]?.code ?? "AI_VALIDATION_FAILED";
    await writeRunLaneArtifact(run, options.lane, "fallback", {
      version: 1,
      runId: run.manifest.runId,
      lane: options.lane,
      attempt,
      status: "fallback",
      reasonCode,
      validationArtifact: `lanes/${options.lane}/attempt-${attempt}.validation.json`,
      outputHash,
    }, attempt);
  }
  const laneStatus = validationAccepted ? "accepted" : "fallback";
  const reasonCode = validationAccepted ? null : errors[0]?.code ?? "AI_VALIDATION_FAILED";
  const durationMs = hostTiming.status === "observed" ? hostTiming.durationMs : null;
  const traceMetadata: Record<string, string | number | boolean | null> = hostTiming.status === "observed"
    ? { ...hostTiming.metadata, generationTimingStatus: "observed" as const }
    : { generationTimingStatus: "unavailable" as const, generationTimingReasonCode: hostTiming.reasonCode };
  await finishReportLane(run, options.lane, attempt, spanId, currentLane.spanStartedAt ?? new Date().toISOString(), laneStatus, durationMs, reasonCode, acceptedRef?.file ?? null, hostTiming.status === "observed" ? "host-agent" : "runner", traceMetadata);
  process.stdout.write(JSON.stringify({ runId: run.manifest.runId, lane: options.lane, attempt, status: laneStatus, validationStatus, ...(reasonCode ? { reasonCode } : {}), generationTiming: timing, outputHash, rawArtifact: rawRef.file, validationArtifact: `lanes/${options.lane}/attempt-${attempt}.validation.json`, acceptedArtifact: acceptedRef?.file ?? null, errors }) + "\n");
  return 0;
}

function parseAiFallbackArgs(args: string[]): {
  runDir: string;
  lane: ReportLane;
  status: "unavailable";
  reasonCode: string | null;
  attempt?: number;
  spanId?: string;
} {
  const extracted = extractRunDirectory(args);
  let lane: ReportLane | null = null;
  let status: "unavailable" = "unavailable";
  let reasonCode: string | null = null;
  let attempt: number | undefined;
  let spanId: string | undefined;
  for (let index = 0; index < extracted.rest.length; index += 1) {
    const flag = extracted.rest[index];
    if (flag === "--lane") lane = parseLane(requireValue(extracted.rest, index, flag));
    else if (flag === "--status") {
      const value = requireValue(extracted.rest, index, flag);
      if (value !== "unavailable") throw new Error("--status must be unavailable.");
      status = "unavailable";
    } else if (flag === "--reason-code") {
      reasonCode = requireValue(extracted.rest, index, flag);
      if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(reasonCode)) throw new Error("--reason-code must be a short safe label.");
    } else if (flag === "--attempt") {
      const value = Number(requireValue(extracted.rest, index, flag));
      if (!Number.isInteger(value) || value < 1) throw new Error("--attempt must be a positive integer.");
      attempt = value;
    } else if (flag === "--span-id") {
      spanId = requireValue(extracted.rest, index, flag);
    } else throw new Error(`Unknown ai-fallback argument: ${flag}.`);
    index += 1;
  }
  if (!lane) throw new Error("--lane is required.");
  return { runDir: requireRunDirectory(extracted.runDir), lane, status, reasonCode, attempt, spanId };
}

async function reportRunAiFallbackMain(args: string[]): Promise<number> {
  const options = parseAiFallbackArgs(args);
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

  if (!options.reasonCode) {
    throw new Error("REASON_CODE_REQUIRED: ai-fallback requires an explicit --reason-code.");
  }
  if (/timing/i.test(options.reasonCode)) {
    throw new Error(`TIMING_CANNOT_AUTHORIZE_UNAVAILABLE: Timing telemetry is passive and cannot authorize lane degradation (${options.reasonCode}).`);
  }
  if (!isAllowedGenerationFailureReason(options.reasonCode)) {
    throw new Error(`ILLEGAL_REASON_CODE: '${options.reasonCode}' is not an allowed generation failure category. Allowed: ${ALLOWED_GENERATION_FAILURE_REASONS.join(", ")}`);
  }

  const receiptCandidates = [
    path.join(run.runDir, `lanes/${options.lane}/host-failure.json`),
    path.join(run.runDir, `lanes/${options.lane}/host-response.json`),
  ];
  let receiptData: unknown = null;
  let receiptFile: string | null = null;
  for (const candidate of receiptCandidates) {
    try {
      const contents = await fs.readFile(candidate, "utf8");
      receiptData = JSON.parse(contents);
      receiptFile = path.relative(run.runDir, candidate);
      break;
    } catch {
      // Continue to next candidate
    }
  }

  if (!receiptData) {
    throw new Error(`HOST_FAILURE_RECEIPT_REQUIRED: ai-fallback for lane ${options.lane} requires a bound Host failure receipt in the lane directory.`);
  }

  const validation = await validateHostFailureReceipt(run, options.lane, currentLane, receiptData, options.reasonCode, activeSpanId, attempt);
  if (!validation.valid) {
    throw new Error(`HOST_FAILURE_RECEIPT_INVALID: ${validation.errors.join(", ")}`);
  }

  const fallbackRef = await writeRunLaneArtifact(run, options.lane, "fallback", {
    version: 1,
    runId: run.manifest.runId,
    lane: options.lane,
    attempt,
    status: options.status,
    reasonCode: options.reasonCode,
    failureReceipt: receiptFile,
  }, attempt);

  await finishReportLane(
    run,
    options.lane,
    attempt,
    spanId,
    currentLane.spanStartedAt ?? new Date().toISOString(),
    "unavailable",
    null,
    options.reasonCode,
    null,
    "host-agent",
    {
      generationTimingStatus: "unavailable",
      hostObservationSource: validation.receipt.source,
      failureReceiptFile: receiptFile,
    },
  );

  process.stdout.write(JSON.stringify({ runId: run.manifest.runId, lane: options.lane, attempt, status: options.status, reasonCode: options.reasonCode, fallbackArtifact: fallbackRef.file }) + "\n");
  return 0;
}

function validExternalSource(value: unknown): value is ExternalSpanEvent["source"] {
  return value === "runner" || value === "skill" || value === "host-agent" || value === "network" || value === "filesystem" || value === "ui";
}

function validTerminalStatus(value: unknown): value is Exclude<ExternalSpanEvent["status"], undefined> {
  return value === "completed" || value === "failed" || value === "fallback" || value === "queued" || value === "reused" || value === "skipped" || value === "unavailable" || value === "interrupted";
}

async function composeAndRenderRun(
  run: ReportRun,
  options: {
    locale: ReportLocale;
    htmlPath: string | null;
    jsonOnly?: boolean;
    fontPath?: string | null;
    fontFamily?: string | null;
  },
): Promise<{
  output: string;
  composition: ReturnType<typeof reportComposition>;
  reportJson: ReportJson;
}> {
  const audit = await readCanonicalAudit(run);
  const runFingerprint = run.manifest.auditFingerprint;
  if (!runFingerprint) throw new Error("Report Run Audit fingerprint is unavailable.");
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

      synthesisCandidate = acceptedSynthesis === null ? null : acceptedSynthesis as ReportSynthesis;
      analyses = acceptedAnalyses.slice(0, 3) as KeySessionAnalysis[];
      if (analyses.length > 0 && packets === undefined) throw new Error("Key Session Analysis requires the run-scoped Evidence artifact.");

      const rawSkillInsights = acceptedSkills;
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
    const selectedSessionIds = new Set(composition.keySessionAnalyses.map((analysis) => analysis.sessionId));
    const keySessionFallbackReason = audit.rankings.sessions.slice(0, 3).some((session) => !selectedSessionIds.has(session.key))
      ? run.manifest.laneStatus["key-session-analysis"].reasonCode ?? "KEY_SESSION_ANALYSIS_UNAVAILABLE_OR_INVALID"
      : null;
    const reportJson: ReportJson = {
      version: 1,
      audit,
      ai: {
        reportSynthesis: {
          result: composition.reportSynthesis,
          fallbackReason: composition.reportSynthesis ? null : run.manifest.laneStatus["report-synthesis"].reasonCode ?? "REPORT_SYNTHESIS_UNAVAILABLE_OR_INVALID",
        },
        keySessionAnalyses: { result: composition.keySessionAnalyses, fallbackReason: keySessionFallbackReason },
        skillInsights: {
          result: composition.skillInsights ?? [],
          fallbackReason: skillInsightsValid ? null : run.manifest.laneStatus["skill-insights"].reasonCode ?? "SKILL_INSIGHTS_UNAVAILABLE_OR_INVALID",
        },
      },
      render: {
        locale: options.locale,
        projectName: projectName ?? null,
        font: options.fontPath
          ? { source: "custom", filePath: options.fontPath, family: options.fontFamily?.trim() || null }
          : { source: "bundled" },
        firstUserMessages,
      },
    };
    await writeRunArtifact(run, "reportJson", reportJson);
    if (options.jsonOnly) {
      return { output: path.join(run.runDir, "report.json"), composition, reportJson };
    }
    const htmlPath = options.htmlPath;
    if (!htmlPath) throw new Error("report-run compose requires --html when JSON-only output is not selected.");
    const fontConfig = reportFontConfig(options.fontPath ?? null, options.fontFamily ?? null);
    const rendered = await withRunSpan(run, { phase: "render", operation: "render-html", source: "runner" }, async () => renderHtml(audit, options.locale, renderComposition, firstUserMessages, fontConfig));
    const subsetted = await withRunSpan(run, { phase: "font-subset", operation: "subset-report-fonts", source: "runner" }, async () => subsetReportFonts(rendered));
    const output = await withRunSpan(run, { phase: "html-write", operation: "write-final-html", source: "filesystem" }, async () => {
      await writeRunTextArtifact(run, "html", subsetted);
      return writeAtomicLocal(htmlPath, subsetted);
    });
    return { output, composition, reportJson };
  } catch (error) {
    await setReportRunStatus(run, "failed").catch(() => undefined);
    throw error;
  }
}

async function reportRunComposeMain(args: string[]): Promise<number> {
  const options = parseRunComposeArgs(args);
  const installedBundle = await verifyInstalledSkill();
  const run = await openReportRun(options.runDir);
  assertRunBundleVersion(run, installedBundle.bundleVersion);
  if (options.locale !== run.manifest.scope.locale) throw new Error("Report Run locale does not match the compose request.");
  const composeStdin = await readStdin();
  if (composeStdin.trim()) throw new Error("REPORT_COMPOSE_STDIN_FORBIDDEN: normal report-run compose reads only registered Run lane artifacts.");
  const eligibleLanes = Object.keys(run.manifest.laneStatus).filter((lane) => run.manifest.eligibleStages.includes(lane));
  const runningLanes = eligibleLanes.filter((lane) => {
    const current = run.manifest.laneStatus[lane as ReportLane];
    return current.status === "running";
  });
  if (runningLanes.length > 0) {
    throw new Error(`REPORT_COMPOSE_LANES_INCOMPLETE: eligible AI lanes still running: ${runningLanes.join(", ")}`);
  }
  const result = await composeAndRenderRun(run, options);
  if (options.jsonOnly) {
    outputRunSummary(run, {
      reportStatus: result.composition.reportSynthesis ? "ai-enhanced" : "fallback",
      fallback: result.composition.reportSynthesis === null,
      reportJsonPath: path.join(run.runDir, "report.json"),
      next: ["render report.json"],
    });
    return 0;
  }
  outputRunSummary(run, {
    reportStatus: result.composition.reportSynthesis ? "ai-enhanced" : "fallback",
    fallback: result.composition.reportSynthesis === null,
    htmlPath: result.output,
    next: ["record codex-open", "finalize"],
  });
  return 0;
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

async function reportRunRunAllStartMain(args: string[]): Promise<number> {
  const { runDir, rest } = extractRunDirectory(args);
  const installedBundle = await verifyInstalledSkill();
  const resolvedRunDir = runDir ? assertLocalSensitiveRunDirectory(runDir) : null;
  let manifestExists = false;
  if (resolvedRunDir) {
    try {
      await fs.stat(path.join(resolvedRunDir, "manifest.json"));
      manifestExists = true;
    } catch {
      manifestExists = false;
    }
  }

  let run: ReportRun;
  if (manifestExists) {
    run = await openReportRun(resolvedRunDir!);
    assertRunBundleVersion(run, installedBundle.bundleVersion);
    const contract = await resolveRunContractMetadata();
    assertRunContract(run, installedBundle, contract);
  } else {
    run = await prepareReportRunInternal(rest, runDir, installedBundle);
    await autoEvidenceRunInternal(run);
  }

  const snapshot = run.manifest.artifacts.skillSnapshot
    ? await readRunArtifact(run.runDir, "skillSnapshot") as SkillSnapshotArtifact
    : null;
  const snapshotId = snapshot?.snapshotId;

  const tickets: Record<ReportLane, LaneTicket> = {} as Record<ReportLane, LaneTicket>;
  for (const lane of REPORT_LANES) {
    if (run.manifest.laneStatus[lane].attempts === 0) {
      tickets[lane] = await startLaneInternal(run, lane);
    } else {
      tickets[lane] = buildLaneTicket(run, lane, lane === "skill-insights" ? snapshotId : undefined);
    }
  }

  if (run.manifest.status === "prepared" || run.manifest.status === "evidence-ready") {
    await setReportRunStatus(run, "awaiting-ai");
  }

  process.stdout.write(JSON.stringify({
    status: "lanes-ready",
    runId: run.manifest.runId,
    runDir: run.runDir,
    auditFingerprint: run.manifest.auditFingerprint,
    bundleVersion: run.manifest.bundleVersion,
    locale: run.manifest.scope.locale,
    tickets,
  }) + "\n");
  return 0;
}

async function reportRunRunAllFinishMain(args: string[]): Promise<number> {
  const { runDir, rest } = extractRunDirectory(args);
  if (!runDir) throw new Error(`report-run run-all finish requires --run-dir <directory>.\n${usage()}`);
  let htmlPath: string | null = null;
  let locale: ReportLocale | null = null;
  let fontPath: string | null = null;
  let fontFamily: string | null = null;
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === "--html") {
      htmlPath = requireValue(rest, index, flag);
      index += 1;
    } else if (flag === "--locale" || flag === "--lang") {
      locale = normalizeLocale(requireValue(rest, index, flag));
      index += 1;
    } else if (flag === "--font") {
      fontPath = requireValue(rest, index, flag);
      index += 1;
    } else if (flag === "--font-family") {
      fontFamily = requireValue(rest, index, flag);
      index += 1;
    } else {
      throw new Error(`Unknown report-run run-all finish argument: ${flag}.\n${usage()}`);
    }
  }
  const installedBundle = await verifyInstalledSkill();
  const run = await openReportRun(requireRunDirectory(runDir));
  assertRunBundleVersion(run, installedBundle.bundleVersion);
  const contract = await resolveRunContractMetadata();
  assertRunContract(run, installedBundle, contract);

  const eligibleLanes = Object.keys(run.manifest.laneStatus) as ReportLane[];
  const pendingLanes = eligibleLanes.filter((lane) => !isLaneTerminal(run.manifest.laneStatus[lane]));

  if (pendingLanes.length > 0) {
    process.stdout.write(JSON.stringify({
      status: "lanes-not-ready",
      ready: false,
      runId: run.manifest.runId,
      runDir: run.runDir,
      pendingLanes,
      laneStatus: run.manifest.laneStatus,
    }) + "\n");
    return 0;
  }

  const effectiveHtmlPath = htmlPath ?? path.join(run.runDir, "report.html");
  const effectiveLocale = locale ?? run.manifest.scope.locale;
  const result = await composeAndRenderRun(run, {
    locale: effectiveLocale,
    htmlPath: effectiveHtmlPath,
    fontPath,
    fontFamily,
  });

  process.stdout.write(JSON.stringify({
    status: "awaiting-ui-dispatch",
    runId: run.manifest.runId,
    runDir: run.runDir,
    htmlPath: result.output,
    reportStatus: result.composition.reportSynthesis ? "ai-enhanced" : "fallback",
    fallback: result.composition.reportSynthesis === null,
  }) + "\n");
  return 0;
}

async function reportRunRunAllMain(args: string[]): Promise<number> {
  const command = args[0];
  if (command === "start") return reportRunRunAllStartMain(args.slice(1));
  if (command === "finish") return reportRunRunAllFinishMain(args.slice(1));
  throw new Error(`Use report-run run-all start or finish.\n${usage()}`);
}

async function reportRunMain(args: string[]): Promise<number> {
  const command = args[0];
  if (command === "run-all") return reportRunRunAllMain(args.slice(1));
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
  throw new Error(`Use report-run run-all, prepare, evidence, ai-start, ai-accept, ai-fallback, compose, event, status, finalize, or cleanup.\n${usage()}`);
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

function parseReportJson(value: unknown): ReportJson {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.audit) || !isRecord(value.ai) || !isRecord(value.render)) {
    throw new Error("render-report requires a version 1 report.json.");
  }
  const { audit, ai, render } = value;
  const reportSynthesis = ai.reportSynthesis;
  const keySessionAnalyses = ai.keySessionAnalyses;
  const skillInsights = ai.skillInsights;
  const font = render.font;
  const validFallback = (fallback: unknown): boolean => fallback === null || typeof fallback === "string";
  if (!isRecord(audit.scope) || !isRecord(audit.coverage) || !isRecord(audit.summary) || !isRecord(audit.rankings) || !isRecord(audit.report)
    || !Array.isArray(audit.turns) || !Array.isArray(audit.checks)
    || !isRecord(reportSynthesis) || !(reportSynthesis.result === null || isRecord(reportSynthesis.result)) || !validFallback(reportSynthesis.fallbackReason)
    || !isRecord(keySessionAnalyses) || !Array.isArray(keySessionAnalyses.result) || !keySessionAnalyses.result.every(isRecord) || !validFallback(keySessionAnalyses.fallbackReason)
    || !isRecord(skillInsights) || !Array.isArray(skillInsights.result) || !skillInsights.result.every(isRecord) || !validFallback(skillInsights.fallbackReason)
    || (render.locale !== "zh-CN" && render.locale !== "en-US")
    || !(render.projectName === null || typeof render.projectName === "string")
    || !Array.isArray(render.firstUserMessages) || !render.firstUserMessages.every((record) => isRecord(record)
      && typeof record.sessionId === "string" && typeof record.turnId === "string"
      && (record.content === null || typeof record.content === "string")
      && (record.unavailableReason === null || typeof record.unavailableReason === "string"))) {
    throw new Error("render-report received a malformed report.json.");
  }
  if (!isRecord(font) || (font.source !== "bundled" && !(font.source === "custom" && typeof font.filePath === "string" && (font.family === null || typeof font.family === "string")))) {
    throw new Error("render-report received a malformed report.json font setting.");
  }
  return value as unknown as ReportJson;
}

async function renderReportMain(args: string[]): Promise<number> {
  let jsonPath: string | null = null;
  let htmlPath: string | null = null;
  let runDir: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--json") {
      if (jsonPath) throw new Error("render-report accepts --json only once.");
      jsonPath = requireValue(args, index, flag);
      index += 1;
    } else if (flag === "--html") {
      if (htmlPath) throw new Error("render-report accepts --html only once.");
      htmlPath = requireValue(args, index, flag);
      index += 1;
    } else if (flag === "--run-dir") {
      if (runDir) throw new Error("render-report accepts --run-dir only once.");
      runDir = requireValue(args, index, flag);
      index += 1;
    } else {
      throw new Error(`Unknown render-report argument: ${flag}.\n${usage()}`);
    }
  }
  if (!jsonPath || !htmlPath) throw new Error(`render-report requires --json <report.json> and --html <final-path>.\n${usage()}`);
  const run = runDir ? await openReportRun(path.resolve(runDir)) : null;
  try {
    let value: unknown;
    if (run) {
      const installedBundle = await verifyInstalledSkill();
      assertRunBundleVersion(run, installedBundle.bundleVersion);
      const reportJsonArtifact = run.manifest.artifacts.reportJson;
      if (!reportJsonArtifact || path.resolve(jsonPath) !== path.resolve(run.runDir, reportJsonArtifact.file)) {
        throw new Error("REPORT_JSON_RUN_MISMATCH: render-report must consume this Report Run's registered report.json.");
      }
      value = await readRunArtifact(run.runDir, "reportJson");
    } else {
      value = JSON.parse(await fs.readFile(jsonPath, "utf8"));
    }
    const report = parseReportJson(value);
    if (run && (!run.manifest.auditFingerprint || auditFingerprint(report.audit) !== run.manifest.auditFingerprint)) {
      throw new Error("REPORT_JSON_RUN_FINGERPRINT_MISMATCH: report.json does not match this Report Run.");
    }
    const rendered = run
      ? await withRunSpan(run, { phase: "render", operation: "render-report-json", source: "runner" }, async () => renderReportJson(report))
      : renderReportJson(report);
    const html = run
      ? await withRunSpan(run, { phase: "font-subset", operation: "subset-report-fonts", source: "runner" }, async () => subsetReportFonts(rendered))
      : await subsetReportFonts(rendered);
    const output = run
      ? await withRunSpan(run, { phase: "html-write", operation: "write-final-html", source: "filesystem" }, async () => {
        await writeRunTextArtifact(run, "html", html);
        return writeAtomicLocal(htmlPath, html);
      })
      : await writeAtomicLocal(htmlPath, html);
    if (run) {
      outputRunSummary(run, {
        reportStatus: report.ai.reportSynthesis.result ? "ai-enhanced" : "fallback",
        htmlPath: output,
        next: ["record codex-open", "finalize"],
      });
    } else {
      process.stdout.write("Output: final HTML report written to " + output + ".\n");
    }
    return 0;
  } catch (error) {
    if (run) await setReportRunStatus(run, "failed").catch(() => undefined);
    throw error;
  }
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    if (args[0] === "report-run") return await reportRunMain(args.slice(1));
    if (args[0] === "render-report") return await renderReportMain(args.slice(1));
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
