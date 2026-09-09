const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');

const { analyseAudit } = require('../dist/src/analysis.js');
const { renderHtml } = require('../dist/src/report.js');

function evidenceRead(isError = null) {
  const timestamp = '2026-09-08T08:00:00.000Z';
  const call = (sessionId, model, totalTokens) => ({
    sessionId, callId: sessionId + '-call', timestamp, provider: 'openai', model,
    inputTokens: totalTokens - 10, cachedInputTokens: 0, cacheWriteTokens: 0,
    outputTokens: 10, reasoningTokens: 0, totalTokens, reportedCost: null,
    status: 'ok', tokenProvenance: 'reported',
  });
  return {
    sessions: [
      { harness: 'codex', sessionId: 'large', title: 'Large', projectCwd: 'D:\\project', startedAt: timestamp, endedAt: timestamp, parentSessionId: null, sourceVersion: null },
      { harness: 'codex', sessionId: 'small', title: 'Small', projectCwd: 'D:\\project', startedAt: timestamp, endedAt: timestamp, parentSessionId: null, sourceVersion: null },
    ],
    modelCalls: [call('large', 'gpt-4.1', 900), call('large', 'gpt-4.1', 90), call('small', 'other-model', 10)],
    toolCalls: [{ sessionId: 'large', callId: 'tool-1', timestamp, toolName: 'read', inputBytes: null, resultBytes: 40, resultChars: 40, isError }],
    lifecycle: [],
    coverage: { filesRead: 1, recordsRead: 4, recordsSkipped: 0, partialSessions: 0, warnings: [] },
  };
}

function result(isError = null) {
  return analyseAudit({ cwd: 'D:\\project', allProjects: false, since: new Date('2026-09-01T00:00:00.000Z') }, evidenceRead(isError), 'codex');
}

test('every inline report script parses', () => {
  const html = renderHtml(result(), 'en-US');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length >= 2);
  scripts.forEach((script) => new vm.Script(script));
  assert.match(scripts.at(-1), /DOMContentLoaded/);
});

test('analysis returns deterministic primary and supporting Findings', () => {
  const first = result().findings;
  const second = result().findings;
  assert.ok(first.length >= 2);
  assert.deepEqual(first, second);
  assert.equal(first[0].severity, 'primary');
  assert.ok(first.slice(1).every((finding) => finding.severity === 'supporting'));
});

test('tool error column is hidden when every value is unavailable', () => {
  const html = renderHtml(result(), 'en-US');
  const toolTable = html.match(/<section><h2>Tool context impact<\/h2>[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.doesNotMatch(toolTable, /<th>errors<\/th>/);
});


test('tool error column remains when any value is available', () => {
  const html = renderHtml(result(true), 'en-US');
  const toolTable = html.match(/<section><h2>Tool context impact<\/h2>[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.match(toolTable, /<th>errors<\/th>/);
});

function overlappingCodexResult() {
  const read = evidenceRead();
  read.sessions = [read.sessions[0]];
  read.modelCalls = [{
    ...read.modelCalls[0],
    model: null,
    inputTokens: 100,
    cachedInputTokens: 40,
    cacheWriteTokens: 10,
    outputTokens: 20,
    reasoningTokens: 5,
    totalTokens: 120,
  }];
  return analyseAudit({ cwd: 'D:/project', allProjects: false, since: new Date('2026-09-01T00:00:00.000Z') }, read, 'codex');
}

test('Codex overlapping usage becomes an exclusive daily composition', () => {
  const daily = overlappingCodexResult().report.dailyUsage[0];
  assert.deepEqual(
    [daily.inputTokens.value, daily.cachedInputTokens.value, daily.cacheWriteTokens.value, daily.outputTokens.value, daily.unclassifiedTokens.value],
    [50, 40, 10, 20, 0],
  );
});

test('unknown model identity is distinct from an unavailable metric', () => {
  const html = renderHtml(overlappingCodexResult(), 'zh-CN');
  const start = html.indexOf('<section><h2>模型分布</h2>');
  const modelSection = html.slice(start, html.indexOf('</section>', start) + 10);
  assert.match(modelSection, /未知模型/);
  assert.doesNotMatch(modelSection, />不可用</);
});

test('exact values are hover titles instead of visible secondary lines', () => {
  const html = renderHtml(result(), 'zh-CN');
  assert.doesNotMatch(html, /class="metric-exact"/);
  assert.match(html, /title="精确值：/);
  const bootScript = html.split('<script>').at(-1).split('</script>')[0];
  assert.equal(bootScript.includes('exact.format(v)'), false);
});

test('supporting Findings use their own compact card layout', () => {
  const html = renderHtml(result(), 'zh-CN');
  assert.match(html, /class="supporting-finding"/);
  assert.equal(html.includes('.supporting-findings ul{'), true);
});