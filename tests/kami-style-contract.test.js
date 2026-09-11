const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { analyseAudit } = require('../dist/src/analysis.js');
const { renderHtml } = require('../dist/src/report.js');
const { scoreHtml } = require('../scripts/score-kami-report.js');

test('the bundled ECharts runtime registers the pie series used by model share', () => {
  const entry = readFileSync(path.join(__dirname, '..', 'src', 'echarts-entry.ts'), 'utf8');
  assert.match(entry, /import \{ LineChart, BarChart, HeatmapChart, PieChart \} from "echarts\/charts";/);
  assert.match(entry, /HeatmapChart, PieChart/);
});

function fixture() {
  const timestamp = '2026-09-08T08:00:00.000Z';
  return analyseAudit(
    { cwd: 'D:\\project', allProjects: false, since: new Date('2026-09-01T00:00:00.000Z') },
    {
      sessions: [{ harness: 'codex', sessionId: 'session-1', title: 'Kami style fixture', projectCwd: 'D:\\project', startedAt: timestamp, endedAt: timestamp, parentSessionId: null, sourceVersion: null }],
      modelCalls: [{ sessionId: 'session-1', callId: 'call-1', timestamp, provider: 'openai', model: 'gpt-4.1', inputTokens: 90, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 10, reasoningTokens: 0, totalTokens: 100, reportedCost: null, status: 'ok', tokenProvenance: 'reported' }],
      toolCalls: [], lifecycle: [],
      coverage: { filesRead: 1, recordsRead: 2, recordsSkipped: 0, partialSessions: 0, warnings: [] },
    },
    'codex',
  );
}

test('standalone report exposes the Kami visual contract', () => {
  const html = renderHtml(fixture(), 'zh-CN');
  const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  const boot = scripts.at(-1) ?? '';
  const head = html.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? '';
  const noJsHtml = html.replace(/<script>[\s\S]*?<\/script>/gi, '');
  assert.match(css, /--parchment:#f5f4ed/);
  assert.match(css, /--brand:#1b365d/);
  assert.match(css, /--brand-light:#2d4e7a/);
  assert.doesNotMatch(css, /--chart-mid-blue/);
  assert.match(css, /Source Han Serif SC/);
  assert.match(css, /authorized TsangerJinKai02-W04/);
  assert.match(css, /authorized TsangerJinKai02-W05/);
  assert.match(css, /data:font\/ttf;base64,/);
  for (const font of ['TsangerJinKai02-W04.ttf', 'TsangerJinKai02-W05.ttf']) {
    const marker = font.replace(/\.ttf$/, '');
    const encoded = html.match(new RegExp('authorized ' + marker + '[\\s\\S]*?data:font/ttf;base64,([^\\"]+)'))?.[1];
    assert.ok(encoded, font + ' is embedded');
    const embeddedHash = createHash('sha256').update(Buffer.from(encoded, 'base64')).digest('hex');
    const sourceHash = createHash('sha256').update(readFileSync(path.resolve(__dirname, '..', 'assets', 'fonts', font))).digest('hex');
    assert.equal(embeddedHash, sourceHash, font + ' bytes match the authorized asset');
  }
  assert.match(css, /font-synthesis:none/);
  assert.match(css, /@media\(max-width:880px\)/);
  assert.match(css, /@media\(max-width:480px\)/);
  assert.match(css, /@media print/);
  assert.doesNotMatch(css, /#b76448|#d99a78|#557c70|#8d6a9f/);
  assert.doesNotMatch(boot, /#b76448|#d99a78|#557c70|#8d6a9f/);
  assert.doesNotMatch(css, /linear-gradient|box-shadow:(?!none)|system-ui|font-weight:650|font-weight:700/);
  assert.doesNotMatch(boot, /linear-gradient|system-ui|font-weight:650|font-weight:700/);
  assert.match(boot, /#2d4e7a/);
  assert.match(boot, /getComputedStyle\(document\.documentElement\)\.getPropertyValue\('--serif'\)/);
  assert.match(boot, /lineType,symbol,focus/);
  assert.match(boot, /unclassified.*emptyCircle/);
  assert.match(boot, /areaStyle:\{color,opacity:\.1\}/);
  assert.doesNotMatch(head, /<link\b|src:url\(["']assets\/fonts|https?:\/\//i);
  assert.match(noJsHtml, /审计范围/);
  assert.match(noJsHtml, /覆盖情况/);
  assert.match(noJsHtml, /<table/);
  assert.match(noJsHtml, /限制与缺失/);
  const score = scoreHtml(html);
  assert.equal(score.score, score.max);
  assert.equal(score.browser.status, 'unavailable');
  assert.equal(score.overall.status, 'unavailable');
});

test('report header keeps the primary metric beside the identity and removes the lower divider', () => {
  const html = renderHtml(fixture(), 'zh-CN');
  const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  assert.match(css, /\.report-header__main\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(260px,\.46fr\);gap:32px;align-items:end\}/);
  assert.match(css, /\.report-header__primary\{display:grid;grid-template-columns:minmax\(0,1fr\);justify-items:end;align-content:end;gap:6px/);
  assert.match(css, /\.report-header__primary-label,\.report-header__primary-date\{display:block;white-space:nowrap}/);
  assert.doesNotMatch(css, /\.report-header\{[^}]*border-bottom/);
  assert.match(css, /@media\(max-width:880px\)\{[\s\S]*?\.report-header__main\{display:block;gap:0\}/);
});

test('report title stays intact while adapting its size and wrap boundary', () => {
  const html = renderHtml(fixture(), 'zh-CN');
  const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  assert.match(css, /\.report-header h1\{display:flex;align-items:baseline;flex-wrap:nowrap;gap:10px/);
  assert.match(css, /\.report-header__project\{font-size:clamp\(44px,5vw,64px\);[^}]*white-space:nowrap/);
  assert.match(css, /\.report-header__suffix\{font-size:20px[^}]*white-space:nowrap/);
  assert.match(css, /\.report-header h1\{flex-wrap:wrap;white-space:normal;gap:6px\}/);
});

test('grouped metrics use a shared label and value grid so wrapped labels keep values aligned', () => {
  const html = renderHtml(fixture(), 'zh-CN');
  const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  assert.match(css, /\.metrics--summary,\.metrics--first-request,\.metrics--group\{grid-template-rows:repeat\(2,auto\)\}/);
  assert.match(css, /\.metrics--summary \.metric,\.metrics--first-request \.metric,\.metrics--group \.metric\{display:grid;grid-row:span 2;grid-template-rows:subgrid;align-content:start\}/);
});
