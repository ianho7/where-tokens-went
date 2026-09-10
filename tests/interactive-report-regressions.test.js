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

function findingsResult() {
  const read = evidenceRead();
  read.modelCalls[0] = { ...read.modelCalls[0], timestamp: '2026-09-08T08:00:00.000Z' };
  read.modelCalls[1] = { ...read.modelCalls[1], timestamp: '2026-09-08T09:00:00.000Z' };
  read.toolCalls[0] = { ...read.toolCalls[0], timestamp: '2026-09-08T08:30:00.000Z' };
  return analyseAudit({ cwd: 'D:\\project', allProjects: false, since: new Date('2026-09-01T00:00:00.000Z') }, read, 'codex');
}

function injectedChartResult() {
  const read = evidenceRead();
  read.modelCalls[0] = { ...read.modelCalls[0], timestamp: '2026-09-08T08:00:00.000Z' };
  read.modelCalls[1] = { ...read.modelCalls[1], timestamp: '2026-09-08T09:00:00.000Z' };
  read.modelCalls.push({
    ...read.modelCalls[1],
    callId: 'large-call-3',
    timestamp: '2026-09-08T10:00:00.000Z',
    totalTokens: 80,
    inputTokens: 70,
    outputTokens: 10,
  });
  read.toolCalls[0] = { ...read.toolCalls[0], timestamp: '2026-09-08T07:30:00.000Z', resultChars: 40 };
  return analyseAudit({ cwd: 'D:\\project', allProjects: false, since: new Date('2026-09-01T00:00:00.000Z') }, read, 'codex');
}

function partialCoverageResult(sourceProof = true) {
  const read = evidenceRead();
  read.coverage.partialSessions = 1;
  if (sourceProof) {
    read.sessions[0] = { ...read.sessions[0], isSubagent: false, partial: false };
    read.sessions[1] = { ...read.sessions[1], isSubagent: true, partial: true };
  }
  return analyseAudit({ cwd: 'D:\\project', allProjects: false, since: new Date('2026-09-01T00:00:00.000Z') }, read, 'codex');
}

test('every inline report script parses', () => {
  const html = renderHtml(result(), 'en-US');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length >= 2);
  scripts.forEach((script) => new vm.Script(script));
  assert.match(scripts.at(-1), /DOMContentLoaded/);
});

test('analysis returns deterministic automated checks', () => {
  assert.deepEqual(result().checks, result().checks);
  assert.ok(result().checks.length >= 2);
});

test('tool error column is hidden when every value is unavailable', () => {
  const html = renderHtml(result(), 'en-US');
  const toolTable = html.match(/<section(?: class="tool-impact")?><h2>Tool context impact<\/h2>[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.doesNotMatch(toolTable, /<th>errors<\/th>/);
});


test('tool error column remains when any value is available', () => {
  const html = renderHtml(result(true), 'en-US');
  const toolTable = html.match(/<section(?: class="tool-impact")?><h2>Tool context impact<\/h2>[\s\S]*?<\/section>/)?.[0] ?? '';
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
  const text = require('../dist/src/report.js').renderText(result(), 'zh-CN');
  assert.doesNotMatch(html, /class="metric-exact"/);
  assert.match(html, /title="精确值：/);
  assert.equal((html.match(/估算值仅作参考，不代表实际账单；“—”表示数据不可用。/g) ?? []).length, 1);
  assert.match(text, /^估算值仅作参考，不代表实际账单；“—”表示数据不可用。/);
  assert.match(html, /data-provenance="reported"/);
  assert.match(html, /data-provenance="derived"/);
  assert.match(html, /data-provenance="estimated"/);
  assert.match(html, /data-provenance="unavailable"/);
  assert.match(html, /class="unavailable"[^>]*>—<\/span>/);
  assert.doesNotMatch(html, />[●◆≈]\s/);
  const bootScript = html.split('<script>').at(-1).split('</script>')[0];
  assert.equal(bootScript.includes('exact.format(v)'), false);
});

test('automated checks use a quiet editorial list', () => {
  const html = renderHtml(result(), 'zh-CN');
  assert.match(html, /class="editorial-item"/);
  assert.match(html, /class="tag tag--quiet"/);
  assert.doesNotMatch(html, /▲/);
  assert.equal(html.includes('.supporting-findings ul{'), true);
});

test('Findings keep values quiet and describe estimates naturally', () => {
  const finding = findingsResult();
  const html = renderHtml(finding, 'en-US');
  const text = require('../dist/src/report.js').renderText(finding, 'en-US');
  assert.match(html, /One Session accounts for[\s\S]*?99%/);
  assert.match(html, /class="finding-evidence" data-provenance="derived"[\s\S]*?99%/);
  assert.doesNotMatch(html, /One Session accounts for 99 \(derived\)/);
  assert.match(text, /One Session accounts for 99% of observed tokens/);
  assert.match(text, /One tool result may be carried forward/);
  const toolFinding = text.split('\n').find((line) => line.includes('One tool result may be carried forward')) ?? '';
  assert.match(toolFinding, /about 10/);
  assert.doesNotMatch(toolFinding, /[●◆≈]/);
  assert.match(toolFinding, /characters/);
  const chineseText = require('../dist/src/report.js').renderText(finding, 'zh-CN');
  assert.match(chineseText, /暴露估算约 10/);
  assert.doesNotMatch(chineseText, /[●◆≈]|证据标识/);
  assert.doesNotMatch(html, /complete tokens/i);
  assert.doesNotMatch(text, /complete tokens/i);
  assert.doesNotMatch(text, /adds an estimated.*estimated/);
});

test('Coverage narrative proves partial subagent overlap or stays unavailable', () => {
  const proven = partialCoverageResult(true);
  const provenHtml = renderHtml(proven, 'en-US');
  const { renderText, renderShare } = require('../dist/src/report.js');
  assert.match(provenHtml, /class="quiet-callout"/);
  assert.doesNotMatch(provenHtml, /coverage-alert|border-left/);
  const provenCoverageText = provenHtml.replace(/<[^>]+>/g, '');
  assert.match(provenCoverageText, /1 of 2 Sessions[\s\S]*50%/);
  assert.match(provenCoverageText, /All partial Sessions are source-proven subagent Sessions/);
  assert.match(renderText(proven, 'en-US'), /Coverage: 1 of 2 Sessions \(50%\)/);
  assert.match(renderShare(proven, 'en-US'), /- Coverage: 1 of 2 Sessions \(50%\)/);
  assert.doesNotMatch(provenHtml, /[●◆≈]\s|Evidence markers/);

  const unknown = partialCoverageResult(false);
  const unknownText = renderText(unknown, 'en-US');
  assert.match(unknownText, /partial Session composition is unavailable/);
  assert.doesNotMatch(unknownText, /\(50%/);
});

test('tool chart uses injected estimate and labels carry-forward as uncapped', () => {
  const report = injectedChartResult();
  const html = renderHtml(report, 'en-US');
  assert.equal(report.report.tools[0].injectedTokens.value, 10);
  assert.equal(report.report.tools[0].amplifiedTokens.value, 30);
  assert.match(html, /"tools":\[\{"name":"read","value":10\}\]/);
  assert.match(html, /Estimated tool-result injection by tool/);
  assert.match(html, /carry-forward estimate \(uncapped\)/);
  assert.match(html, /data-provenance="estimated"/);
  assert.doesNotMatch(html, /\.tool-impact \.metric-stack\[data-provenance="estimated"\]/);
});

test('rolling activity distinguishes latest window from historical peak', () => {
  const report = result();
  const html = renderHtml(report, 'en-US');
  const { renderText } = require('../dist/src/report.js');
  assert.match(html, /Latest 5h tokens/);
  assert.match(html, /Highest rolling 5h in selected range/);
  const text = renderText(report, 'en-US', 'window');
  assert.match(text, /Latest 5h tokens/);
  assert.match(text, /Highest rolling 5h in selected range/);
});

test('time presentation uses numeric editorial dates and yearless chart labels', () => {
  const report = result();
  const { renderText } = require('../dist/src/report.js');
  const chineseHtml = renderHtml(report, 'zh-CN');
  const englishHtml = renderHtml(report, 'en-US');
  assert.match(chineseHtml, /2026\.09\.01 \d{2}:\d{2}/);
  assert.match(chineseHtml, /<text[^>]*class="chart-label">09\.08<\/text>/);
  assert.match(chineseHtml, /"time":"09\.08"/);
  assert.match(chineseHtml, /2026\.09\.08 \d{2}:\d{2}/);
  assert.doesNotMatch(chineseHtml, /GMT|\d{4}年\d{1,2}月\d{1,2}日/);
  assert.match(englishHtml, /2026\.09\.01 \d{2}:\d{2}/);
  assert.doesNotMatch(englishHtml, /GMT|Sep \d/);
  assert.match(renderText(report, 'zh-CN'), /2026\.09\.01 \d{2}:\d{2}/);
});

test('daily token trend uses the Kami contrast ladder and redundant line encodings', () => {
  const html = renderHtml(result(), 'zh-CN');
  assert.doesNotMatch(html, /stack:'tokens'/);
  assert.match(html, /#2d5a8a/);
  assert.match(html, /getComputedStyle\(document\.documentElement\)\.getPropertyValue\('--serif'\)/);
  assert.match(html, /lineType,symbol,focus/);
  assert.match(html, /lineStyle:\{color,width:focus\?2\.5:2,opacity:focus\?1:\.92,type:lineType\}/);
  assert.match(html, /symbol,showSymbol:d.rows.length<=14/);
  assert.match(html, /areaStyle:\{color,opacity:\.1\}/);
  assert.match(html, /areaStyle:\{color,opacity:\.12\}/);
  assert.doesNotMatch(html, /areaStyle:\{color,opacity:\.18\}/);
});
test('automated checks are stable, evidence-backed, private, and shared by formatters', () => {
  const first = result();
  const second = result();
  assert.deepEqual(first.checks, second.checks);
  assert.ok(first.checks.length > 0);
  for (const check of first.checks) {
    assert.match(check.id, /^(long_session|tool_amplification|extra_calls|model_concentration|data_quality)$/);
    assert.match(check.outcome, /^(pass|notice|warning)$/);
    assert.match(check.method, /.+/);
    assert.ok(check.evidence.length > 0);
  }
  assert.ok(first.checks.some((check) => check.outcome === 'pass'));
  const html = renderHtml(first, 'en-US');
  const { renderText, renderShare } = require('../dist/src/report.js');
  const text = renderText(first, 'en-US');
  const share = renderShare(first, 'en-US');
  for (const output of [html, text, share]) {
    assert.match(output, /History parsed without coverage warnings/);
    assert.match(output, /One Session accounts for/);
    assert.match(output, /Method:/);
    assert.doesNotMatch(output, /long_session|tool_amplification|extra_calls|model_concentration|data_quality/);
  }
  assert.match(renderText(first, 'zh-CN'), /发现:/);
  assert.doesNotMatch(renderHtml(first, 'zh-CN'), /class="tag[^"]*"[^>]*>自动<\/span>/);
  assert.equal(JSON.stringify(first).includes('PRIVATE_PROMPT'), false);
});
