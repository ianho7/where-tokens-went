#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseArgs = parseArgs;
exports.main = main;
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const analysis_1 = require("./analysis");
const claude_reader_1 = require("./claude-reader");
const codex_reader_1 = require("./codex-reader");
const deepseek_reader_1 = require("./deepseek-reader");
const pi_reader_1 = require("./pi-reader");
const report_1 = require("./report");
function usage() {
    return [
        "Usage: where-tokens-went inspect --harness <claude|codex|pi|deepseek> --cwd <absolute-path> [--since 7d] [--format json|text] [--locale zh-CN|en-US] [--view full|usage|window|report|tools|week|share]",
        "       where-tokens-went inspect --harness <claude|codex|pi|deepseek> --all-projects [--since 7d] [--format json|text] [--locale zh-CN|en-US] [--view full|usage|window|report|tools|week|share]",
    ].join("\n");
}
function parseDuration(value) {
    const match = /^(\d+)([hdwm])$/i.exec(value.trim());
    if (!match)
        throw new Error(`Invalid --since duration: ${value}. Use values such as 7d, 24h, or 2w.`);
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
function requireValue(args, index, flag) {
    const value = args[index + 1];
    if (!value || value.startsWith("--"))
        throw new Error(`${flag} requires a value.\n${usage()}`);
    return value;
}
function parseArgs(args) {
    if (args[0] !== "inspect")
        throw new Error(`Only the inspect command is supported.\n${usage()}`);
    let harness = null;
    let cwd = null;
    let allProjects = false;
    let since = parseDuration("7d");
    let sinceExplicit = false;
    let format = "json";
    let locale = "en-US";
    let view = "full";
    let htmlPath = null;
    let sharePath = null;
    for (let index = 1; index < args.length; index += 1) {
        const flag = args[index];
        if (flag === "--harness") {
            const value = requireValue(args, index, flag);
            index += 1;
            if (value !== "codex" && value !== "claude" && value !== "pi" && value !== "deepseek")
                throw new Error(`Harness ${value} is not implemented yet.\n${usage()}`);
            harness = value;
        }
        else if (flag === "--cwd") {
            cwd = requireValue(args, index, flag);
            index += 1;
            if (!path.isAbsolute(cwd))
                throw new Error("--cwd must be an absolute path.");
        }
        else if (flag === "--all-projects") {
            allProjects = true;
        }
        else if (flag === "--since") {
            since = parseDuration(requireValue(args, index, flag));
            sinceExplicit = true;
            index += 1;
        }
        else if (flag === "--format") {
            const value = requireValue(args, index, flag);
            index += 1;
            if (value !== "json" && value !== "text")
                throw new Error("--format must be json or text.");
            format = value;
        }
        else if (flag === "--locale" || flag === "--lang") {
            locale = (0, report_1.normalizeLocale)(requireValue(args, index, flag));
            index += 1;
        }
        else if (flag === "--view") {
            const value = requireValue(args, index, flag);
            index += 1;
            if (!["full", "usage", "window", "report", "tools", "week", "share", "question"].includes(value)) {
                throw new Error("--view must be full, usage, window, report, tools, week, share, or question.\n" + usage());
            }
            view = value;
        }
        else if (flag === "--html") {
            htmlPath = requireValue(args, index, flag);
            index += 1;
        }
        else if (flag === "--share") {
            sharePath = requireValue(args, index, flag);
            index += 1;
        }
        else {
            throw new Error(`Unknown argument: ${flag}.\n${usage()}`);
        }
    }
    if (!harness)
        throw new Error(`--harness is required.\n${usage()}`);
    if (cwd && allProjects)
        throw new Error("--cwd and --all-projects are mutually exclusive.");
    if (!cwd && !allProjects)
        throw new Error("Provide --cwd or --all-projects.");
    return { harness, cwd, allProjects, since, sinceExplicit, format, locale, view, htmlPath, sharePath };
}
async function readHarness(harness, scope) {
    return harness === "codex"
        ? (0, codex_reader_1.readCodex)(scope)
        : harness === "claude"
            ? (0, claude_reader_1.readClaude)(scope)
            : harness === "pi"
                ? (0, pi_reader_1.readPi)(scope)
                : (0, deepseek_reader_1.readDeepSeek)(scope);
}
function differenceEvidence(left, right, label) {
    if (typeof left.value !== "number" || typeof right.value !== "number") {
        return { value: null, provenance: "unavailable", method: label + " requires complete numeric values in both periods" };
    }
    return { value: left.value - right.value, provenance: "derived", method: "current period minus previous period for " + label };
}
function snapshotOf(result) {
    const { view: _view, weekComparison: _comparison, ...snapshot } = result;
    return snapshot;
}
function inRange(timestamp, from, to) {
    if (!timestamp)
        return false;
    const value = Date.parse(timestamp);
    return !Number.isNaN(value) && value >= from.getTime() && value < to.getTime();
}
function sliceRead(read, from, to) {
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
function missingWeekEvidence(label) {
    return { value: null, provenance: "unavailable", method: label + " was absent from one comparison period" };
}
function structureChanges(currentEntries, previousEntries, label) {
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
function makeWeekComparison(current, previous, currentFrom, currentTo, previousFrom) {
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
        toolChanges: structureChanges(current.report.tools.map((entry) => ({ key: entry.key, value: entry.amplifiedTokens })), previous.report.tools.map((entry) => ({ key: entry.key, value: entry.amplifiedTokens })), "tool amplification"),
    };
}
function defaultOutputPath(harness, kind, extension) {
    return path.join(os.tmpdir(), "where-tokens-went-" + harness + "-" + kind + "-" + Date.now() + extension);
}
async function writeLocalFile(filePath, contents) {
    const absolute = path.resolve(filePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, contents, "utf8");
    return absolute;
}
async function main(args = process.argv.slice(2)) {
    try {
        const options = parseArgs(args);
        let result;
        if (options.view === "week") {
            const currentTo = new Date();
            const currentFrom = new Date(currentTo.getTime() - 7 * 24 * 60 * 60 * 1000);
            const previousFrom = new Date(currentFrom.getTime() - 7 * 24 * 60 * 60 * 1000);
            const sourceScope = { cwd: options.cwd, allProjects: options.allProjects, since: previousFrom };
            const sourceRead = await readHarness(options.harness, sourceScope);
            const currentScope = { cwd: options.cwd, allProjects: options.allProjects, since: currentFrom };
            const previousScope = { cwd: options.cwd, allProjects: options.allProjects, since: previousFrom };
            const current = (0, analysis_1.analyseAudit)(currentScope, sliceRead(sourceRead, currentFrom, currentTo), options.harness);
            const previous = (0, analysis_1.analyseAudit)(previousScope, sliceRead(sourceRead, previousFrom, currentFrom), options.harness);
            result = { ...current, view: "week", weekComparison: makeWeekComparison(current, previous, currentFrom, currentTo, previousFrom) };
        }
        else {
            const since = options.view === "share" && !options.sinceExplicit ? parseDuration("30d") : options.since;
            const scope = { cwd: options.cwd, allProjects: options.allProjects, since };
            const read = await readHarness(options.harness, scope);
            result = { ...(0, analysis_1.analyseAudit)(scope, read, options.harness), view: options.view };
        }
        const outputKinds = [];
        const shouldWriteHtml = options.htmlPath !== null || options.view === "full" || options.view === "report" || options.view === "question";
        if (shouldWriteHtml) {
            const target = options.htmlPath ?? defaultOutputPath(options.harness, "report", ".html");
            await writeLocalFile(target, (0, report_1.renderHtml)(result, options.locale));
            outputKinds.push("local HTML report");
        }
        if (options.sharePath !== null || options.view === "share") {
            const target = options.sharePath ?? defaultOutputPath(options.harness, "share", ".md");
            await writeLocalFile(target, (0, report_1.renderShare)(result, options.locale));
            outputKinds.push("local share Markdown");
        }
        if (options.format === "json") {
            process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        }
        else if (result.weekComparison) {
            process.stdout.write((0, report_1.renderWeekText)(result.weekComparison, options.locale));
        }
        else {
            process.stdout.write((0, report_1.renderText)(result, options.locale, options.view));
        }
        if (options.format === "text" && outputKinds.length > 0) {
            process.stdout.write(outputKinds.map((outputKind) => "Output: " + outputKind + " written.").join("\n") + "\n");
        }
        return 0;
    }
    catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : "where-tokens-went failed."}\n`);
        return 2;
    }
}
if (require.main === module) {
    void main().then((code) => {
        process.exitCode = code;
    });
}
