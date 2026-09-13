#!/usr/bin/env node

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { analyseAudit } from "./analysis";
import { readClaude } from "./claude-reader";
import { readCodex } from "./codex-reader";
import { auditFingerprint, reportComposition, validateReportSynthesis } from "./key-session-analysis";
import { resolveApiPricing, type PricingMode } from "./rates";
import { normalizeLocale, renderHtml, renderShare, renderText, renderWeekText, resolveReportProjectName } from "./report";
import type { AuditResult, AuditSnapshot, AuditView, EvidenceValue, FirstUserMessageRecord, Harness, KeySessionAnalysis, ReadResult, ReadScope, ReportLocale, WeekComparison, WeekStructureChange } from "./types";

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
  pricing: PricingMode;
}

function usage(): string {
  return [
    "Usage: where-tokens-went inspect --harness <claude|codex> --cwd <absolute-path> [--since 7d] [--format json|text] [--locale zh-CN|en-US] [--pricing litellm] [--view full|usage|window|report|tools|week|share]",
    "       where-tokens-went inspect --harness <claude|codex> --all-projects [--since 7d] [--format json|text] [--locale zh-CN|en-US] [--pricing litellm] [--view full|usage|window|report|tools|week|share]",
    "       where-tokens-went compose-report --locale zh-CN|en-US --html <final-path> < composition JSON envelope",
  ].join("\n");
}

function parseDuration(value: string): Date {
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
  return new Date(Date.now() - milliseconds);
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.\n${usage()}`);
  return value;
}

export function parseArgs(args: string[]): CliOptions {
  if (args[0] !== "inspect") throw new Error(`Use inspect or compose-report.\n${usage()}`);
  let harness: Harness | null = null;
  let cwd: string | null = null;
  let allProjects = false;
  let since = parseDuration("7d");
  let sinceExplicit = false;
  let format: "json" | "text" = "json";
  let locale: ReportLocale = "en-US";
  let view: AuditView = "full";
  let htmlPath: string | null = null;
  let sharePath: string | null = null;
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
      since = parseDuration(requireValue(args, index, flag));
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
    } else {
      throw new Error(`Unknown argument: ${flag}.\n${usage()}`);
    }
  }

  if (!harness) throw new Error(`--harness is required.\n${usage()}`);
  if (cwd && allProjects) throw new Error("--cwd and --all-projects are mutually exclusive.");
  if (!cwd && !allProjects) throw new Error("Provide --cwd or --all-projects.");
  return { harness, cwd, allProjects, since, sinceExplicit, format, locale, view, htmlPath, sharePath, pricing };
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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseComposeArgs(args: string[]): ComposeReportOptions {
  let locale: ReportLocale = "en-US";
  let htmlPath: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--locale" || flag === "--lang") {
      locale = normalizeLocale(requireValue(args, index, flag));
      index += 1;
    } else if (flag === "--html") {
      htmlPath = requireValue(args, index, flag);
      index += 1;
    } else {
      throw new Error(`Unknown compose-report argument: ${flag}.\n${usage()}`);
    }
  }
  if (!htmlPath) throw new Error(`compose-report requires --html.\n${usage()}`);
  return { locale, htmlPath };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
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
  const composition = reportComposition(audit, analyses, validatedSynthesis);
  const firstUserMessages = (Array.isArray(parsed.firstUserMessages) ? parsed.firstUserMessages : []) as FirstUserMessageRecord[];
  const output = await writeLocalFile(options.htmlPath, renderHtml(audit, options.locale, composition, firstUserMessages));
  process.stdout.write("Output: final HTML report written to " + output + ".\n");
  return 0;
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    if (args[0] === "compose-report") return await composeReportMain(args.slice(1));
    const options = parseArgs(args);
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
      await writeLocalFile(target, renderHtml(htmlResult, options.locale, undefined, localFirstUserMessages));
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
