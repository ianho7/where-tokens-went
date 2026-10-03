"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordedUsageTime = recordedUsageTime;
exports.renderReportLayout = renderReportLayout;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
function recordedUsageTime(audit) {
    const known = audit.turns.filter(turn => typeof turn.durationMs.value === "number" && Number.isFinite(turn.durationMs.value) && turn.durationMs.value >= 0);
    if (known.length === 0)
        return null;
    return {
        totalMs: known.reduce((sum, turn) => sum + turn.durationMs.value, 0),
        knownTurnCount: known.length, totalTurnCount: audit.turns.length,
        knownDurationSessionCount: new Set(known.map(turn => turn.sessionId)).size,
        turnSessionCount: new Set(audit.turns.map(turn => turn.sessionId)).size,
        totalSessionCount: typeof audit.summary.sessionCount.value === "number" ? audit.summary.sessionCount.value : null,
        provenance: "derived",
        method: "sum of recorded Turn durations; missing durations excluded, overlapping Sessions counted separately",
    };
}
let template;
/** Reuse the canonical renderer's facts and accepted prose without executing its scripts. */
function renderReportLayout(sourceHtml, usageTime = null, chartRuntime = "") {
    template ??= (0, node_fs_1.readFileSync)((0, node_path_1.join)(__dirname, "report-template.html"), "utf8");
    const scripts = [...sourceHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
    const chartScript = scripts.find(script => script.includes("const d=") && script.includes("keySessions"));
    let charts = { rows: [], models: [], tools: [], hourly: { dates: [], cells: [] }, keySessions: [], locale: "zh-CN" };
    if (chartScript) {
        const start = chartScript.indexOf("const d=") + "const d=".length;
        let depth = 0, quoted = false, escaped = false, end = -1;
        for (let index = start; index < chartScript.length; index++) {
            const character = chartScript[index];
            if (quoted) {
                if (escaped)
                    escaped = false;
                else if (character === "\\")
                    escaped = true;
                else if (character === '"')
                    quoted = false;
            }
            else if (character === '"')
                quoted = true;
            else if (character === "{" || character === "[")
                depth++;
            else if (character === "}" || character === "]") {
                depth--;
                if (depth === 0) {
                    end = index + 1;
                    break;
                }
            }
        }
        if (end < 0)
            throw new Error("The canonical report chart data is incomplete.");
        charts = JSON.parse(chartScript.slice(start, end));
    }
    const body = sourceHtml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1];
    if (body === undefined)
        throw new Error("The canonical report has no body.");
    const sourceMarkup = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
    const fontFaces = [...sourceHtml.matchAll(/@font-face\s*\{[^}]*\}/g)].map(match => match[0]).join("\n");
    const fontVariables = sourceHtml.match(/:root\{--serif:[^}]*\}html\[lang="zh-CN"\]\{--serif:[^}]*\}/)?.[0] ?? "";
    const runtime = scripts.find(script => script !== chartScript && script.includes("echarts")) ?? chartRuntime;
    const payload = JSON.stringify({ charts, sourceMarkup, sourceHash: (0, node_crypto_1.createHash)("sha256").update(sourceHtml).digest("hex"), usageTime })
        .replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    const title = sourceHtml.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "where-tokens-went · 用量报告";
    return template.replace("{{REPORT_TITLE}}", () => title).replace("{{FONT_FACES}}", () => fontFaces).replace("{{FONT_VARIABLES}}", () => fontVariables)
        .replace("{{REPORT_DATA}}", () => payload).replace("{{ECHARTS_RUNTIME}}", () => runtime);
}
