const assert = require('node:assert/strict');
const { test } = require('node:test');

const { analyseAudit } = require('../dist/src/analysis.js');
const { renderHtml } = require('../dist/src/report.js');
const { scoreHtml } = require('../scripts/score-kami-report.js');

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
  assert.match(css, /--brand-light:#2d5a8a/);
  assert.doesNotMatch(css, /--chart-mid-blue/);
  assert.match(css, /Source Han Serif SC/);
  assert.match(css, /font-synthesis:none/);
  assert.match(css, /@media\(max-width:880px\)/);
  assert.match(css, /@media\(max-width:480px\)/);
  assert.match(css, /@media print/);
  assert.doesNotMatch(css, /#b76448|#d99a78|#557c70|#8d6a9f/);
  assert.doesNotMatch(boot, /#b76448|#d99a78|#557c70|#8d6a9f/);
  assert.doesNotMatch(css, /linear-gradient|box-shadow|system-ui|font-weight:650|font-weight:700/);
  assert.doesNotMatch(boot, /linear-gradient|system-ui|font-weight:650|font-weight:700/);
  assert.match(boot, /#2d5a8a/);
  assert.match(boot, /getComputedStyle\(document\.documentElement\)\.getPropertyValue\('--serif'\)/);
  assert.match(boot, /lineType,symbol,focus/);
  assert.match(boot, /areaStyle:\{color,opacity:\.1\}/);
  assert.doesNotMatch(head, /<link\b|@font-face|https?:\/\//i);
  assert.match(noJsHtml, /审计范围/);
  assert.match(noJsHtml, /覆盖情况/);
  assert.match(noJsHtml, /<table/);
  assert.match(noJsHtml, /限制与缺失/);
  const score = scoreHtml(html);
  assert.equal(score.score, score.max);
  assert.equal(score.unavailable.length, 0);
});
