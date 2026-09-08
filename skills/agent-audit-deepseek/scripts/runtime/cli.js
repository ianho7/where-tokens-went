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
const path = __importStar(require("node:path"));
const analysis_1 = require("./analysis");
const claude_reader_1 = require("./claude-reader");
const codex_reader_1 = require("./codex-reader");
const deepseek_reader_1 = require("./deepseek-reader");
const pi_reader_1 = require("./pi-reader");
function usage() {
    return [
        "Usage: agent-audit inspect --harness <claude|codex|pi|deepseek> --cwd <absolute-path> [--since 7d] [--format json|text]",
        "       agent-audit inspect --harness <claude|codex|pi|deepseek> --all-projects [--since 7d] [--format json|text]",
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
    let format = "json";
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
            index += 1;
        }
        else if (flag === "--format") {
            const value = requireValue(args, index, flag);
            index += 1;
            if (value !== "json" && value !== "text")
                throw new Error("--format must be json or text.");
            format = value;
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
    return { harness, cwd, allProjects, since, format };
}
function evidenceText(value) {
    if (value.value === null)
        return "unavailable";
    return `${value.value} (${value.provenance})`;
}
function shareText(value) {
    return value.value === null ? "unavailable" : `${value.value}%`;
}
function textResult(result) {
    const lines = [
        `Audit: ${result.scope.harness}; ${result.scope.allProjects ? "all projects" : "current project"}; since ${result.scope.since}`,
        `Coverage: ${result.coverage.filesRead} files, ${result.coverage.recordsRead} records, ${result.coverage.recordsSkipped} skipped, ${result.coverage.partialSessions} partial Sessions.`,
        `Sessions: ${evidenceText(result.summary.sessionCount)}; model calls: ${evidenceText(result.summary.modelCallCount)}; total tokens: ${evidenceText(result.summary.totalTokens)}.`,
    ];
    const topSession = result.rankings.sessions[0];
    if (topSession)
        lines.push(`Top Session: ${topSession.displayName ?? topSession.key}; ${evidenceText(topSession.value)}; share: ${shareText(topSession.sharePercent)}.`);
    const modelSummary = result.rankings.models.slice(0, 5)
        .map((entry) => `${entry.key}: ${entry.value.value ?? "unavailable"} tokens (${shareText(entry.sharePercent)})`)
        .join(", ");
    if (modelSummary)
        lines.push(`Models: ${modelSummary}.`);
    if (result.topFinding) {
        lines.push(`Top finding: ${result.topFinding.kind} — ${result.topFinding.headline}`);
        lines.push(`Recommendation: ${result.topFinding.recommendation}`);
    }
    else {
        lines.push("Top finding: none supported by the available Evidence.");
    }
    if (result.coverage.warnings.length > 0)
        lines.push(`Limitations: ${result.coverage.warnings.join(" ")}`);
    return `${lines.join("\n")}\n`;
}
async function main(args = process.argv.slice(2)) {
    try {
        const options = parseArgs(args);
        const scope = {
            cwd: options.cwd,
            allProjects: options.allProjects,
            since: options.since,
        };
        const read = options.harness === "codex"
            ? await (0, codex_reader_1.readCodex)(scope)
            : options.harness === "claude"
                ? await (0, claude_reader_1.readClaude)(scope)
                : options.harness === "pi"
                    ? await (0, pi_reader_1.readPi)(scope)
                    : await (0, deepseek_reader_1.readDeepSeek)(scope);
        const result = (0, analysis_1.analyseAudit)(scope, read, options.harness);
        process.stdout.write(options.format === "json" ? `${JSON.stringify(result, null, 2)}\n` : textResult(result));
        return 0;
    }
    catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : "Agent Audit failed."}\n`);
        return 2;
    }
}
if (require.main === module) {
    void main().then((code) => {
        process.exitCode = code;
    });
}
