#!/usr/bin/env node

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { analyseAudit } from "./analysis";
import { readClaude } from "./claude-reader";
import { readCodex } from "./codex-reader";
import { readDeepSeek } from "./deepseek-reader";
import { readPi } from "./pi-reader";
import { normalizeLocale, renderHtml, renderShare, renderText, renderWeekText } from "./report";
import type { AuditResult, AuditSnapshot, AuditView, EvidenceValue, Harness, ReadResult, ReadScope, ReportLocale, WeekComparison, WeekStructureChange } from "./types";

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
}

function usage(): string {
  return [
    "Usage: agent-audit inspect --harness <claude|codex|pi|deepseek> --cwd <absolute-path> [--since 7d] [--format json|text] [--locale zh-CN|en-US] [--view full|usage|window|report|tools|week|share]",
    "       agent-audit inspect --harness <claude|codex|pi|deepseek> --all-projects [--since 7d] [--format json|text] [--locale zh-CN|en-US] [--view full|usage|window|report|tools|week|share]",
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
  if (args[0] !== "inspect") throw new Error(`Only the inspect command is supported.\n${usage()}`);
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

  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--harness") {
      const value = requireValue(args, index, flag);
      index += 1;
      if (value !== "codex" && value !== "claude" && value !== "pi" && value !== "deepseek") throw new Error(`Harness ${value} is not implemented yet.\n${usage()}`);
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
  return { harness, cwd, allProjects, since, sinceExplicit, format, locale, view, htmlPath, sharePath };
}

async function readHarness(harness: Harness, scope: ReadScope): Promise<ReadResult> {
  return harness === "codex"
    ? readCodex(scope)
    : harness === "claude"
      ? readClaude(scope)
      : harness === "pi"
        ? readPi(scope)
        : readDeepSeek(scope);
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
  const sessionIds = new Set([
    ...modelCalls.map((call) => call.sessionId),
    ...toolCalls.map((call) => call.sessionId),
    ...lifecycle.map((event) => event.sessionId),
  ]);
  return {
    ...read,
    sessions: read.sessions.filter((session) => sessionIds.has(session.sessionId)),
    modelCalls,
    toolCalls,
    lifecycle,
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
  return path.join(os.tmpdir(), "agent-audit-" + harness + "-" + kind + "-" + Date.now() + extension);
}

async function writeLocalFile(filePath: string, contents: string): Promise<string> {
  const absolute = path.resolve(filePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, contents, "utf8");
  return absolute;
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const options = parseArgs(args);
    let result: AuditResult;
    if (options.view === "week") {
      const currentTo = new Date();
      const currentFrom = new Date(currentTo.getTime() - 7 * 24 * 60 * 60 * 1000);
      const previousFrom = new Date(currentFrom.getTime() - 7 * 24 * 60 * 60 * 1000);
      const sourceScope: ReadScope = { cwd: options.cwd, allProjects: options.allProjects, since: previousFrom };
      const sourceRead = await readHarness(options.harness, sourceScope);
      const currentScope: ReadScope = { cwd: options.cwd, allProjects: options.allProjects, since: currentFrom };
      const previousScope: ReadScope = { cwd: options.cwd, allProjects: options.allProjects, since: previousFrom };
      const current = analyseAudit(currentScope, sliceRead(sourceRead, currentFrom, currentTo), options.harness);
      const previous = analyseAudit(previousScope, sliceRead(sourceRead, previousFrom, currentFrom), options.harness);
      result = { ...current, view: "week", weekComparison: makeWeekComparison(current, previous, currentFrom, currentTo, previousFrom) };
    } else {
      const since = options.view === "share" && !options.sinceExplicit ? parseDuration("30d") : options.since;
      const scope: ReadScope = { cwd: options.cwd, allProjects: options.allProjects, since };
      const read = await readHarness(options.harness, scope);
      result = { ...analyseAudit(scope, read, options.harness), view: options.view };
    }

    const outputKinds: string[] = [];
    const shouldWriteHtml = options.htmlPath !== null || options.view === "full" || options.view === "report" || options.view === "question";
    if (shouldWriteHtml) {
      const target = options.htmlPath ?? defaultOutputPath(options.harness, "report", ".html");
      await writeLocalFile(target, renderHtml(result, options.locale));
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
    process.stderr.write(`${error instanceof Error ? error.message : "Agent Audit failed."}\n`);
    return 2;
  }
}

if (require.main === module) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
