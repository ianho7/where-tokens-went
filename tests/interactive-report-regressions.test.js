const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');

const { analyseAudit } = require('../dist/src/analysis.js');
const { renderHtml } = require('../dist/src/report.js');
const { auditFingerprint, validateReportSynthesis } = require('../dist/src/key-session-analysis.js');
const { snapshotHtml } = require('../scripts/kami-report-content-snapshot.js');
const { scoreHtml } = require('../scripts/score-kami-report.js');
const contentBaseline = require('./fixtures/kami-report-content-baseline.json');

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

function keySessionResult() {
  const timestamp = '2026-09-08T08:00:00.000Z';
  const sessions = [
    ['key-s1', '阅读文档并准备 to-spec'],
    ['key-s2', '修复报告渲染'],
    ['key-s3', '检查回归测试'],
  ].map(([sessionId, title]) => ({ harness: 'codex', sessionId, title, projectCwd: 'D:\\project', startedAt: timestamp, endedAt: timestamp, parentSessionId: null, sourceVersion: 'fixture' }));
  const round = (sessionId, ordinal, durationMs) => ({ sessionId, turnId: sessionId + '-r' + ordinal, ordinal, startedAt: timestamp, endedAt: timestamp, durationMs, timeToFirstTokenMs: 400, status: 'ok', timingProvenance: 'reported' });
  const turns = sessions.flatMap(({ sessionId }) => [round(sessionId, 1, 120000), round(sessionId, 2, 60000)]);
  const totals = { 'key-s1': [800, 200], 'key-s2': [500, 100], 'key-s3': [300, 50] };
  const modelCalls = turns.map((turn, index) => {
    const totalTokens = totals[turn.sessionId][turn.ordinal - 1];
    return { sessionId: turn.sessionId, callId: turn.turnId + '-call', timestamp, provider: 'openai', model: 'gpt-5', inputTokens: totalTokens - 20, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 20, reasoningTokens: 0, totalTokens, reportedCost: null, status: 'ok', tokenProvenance: 'reported', turnId: turn.turnId, activeBranch: index < 6 };
  });
  return analyseAudit(
    { cwd: 'D:\\project', allProjects: false, since: new Date('2026-09-01T00:00:00.000Z') },
    {
      sessions,
      turns,
      modelCalls,
      toolCalls: [{ sessionId: 'key-s1', callId: 'key-tool', timestamp, toolName: 'Read', inputBytes: 10, resultBytes: 128, resultChars: 64, turnId: 'key-s1-r2', isError: null }],
      lifecycle: [{ sessionId: 'key-s1', timestamp, kind: 'compaction', relatedId: 'key-compact', turnId: 'key-s1-r2' }],
      skillEvidence: [{ sessionId: 'key-s1', skillName: 'demo-skill', state: 'invoked', evidenceType: 'explicit-input', turnId: 'key-s1-r2', callId: 'key-tool', timestamp, sourceLocation: 'rollout:key', provenance: 'reported' }],
      tokenAccounting: { responseTotal: 1350, turnTotal: 1350, threadTotal: 1350, reconciledSessionIds: ['key-s1', 'key-s2', 'key-s3'], mismatchedSessionIds: [], status: 'reconciled', method: 'fixture' },
      coverage: { filesRead: 1, recordsRead: 12, recordsSkipped: 0, partialSessions: 0, warnings: [] },
    },
    'codex',
  );
}

function findingsResult() {
  const read = evidenceRead();
  read.modelCalls[0] = { ...read.modelCalls[0], timestamp: '2026-09-08T08:00:00.000Z' };
  read.modelCalls[1] = { ...read.modelCalls[1], timestamp: '2026-09-08T09:00:00.000Z' };
  read.toolCalls[0] = { ...read.toolCalls[0], timestamp: '2026-09-08T08:30:00.000Z' };
  return analyseAudit({ cwd: 'D:\\project', allProjects: false, since: new Date('2026-09-01T00:00:00.000Z') }, read, 'codex');
}

function reportSynthesisFor(audit, overrides = {}) {
  const fingerprint = auditFingerprint(audit);
  return {
    auditFingerprint: fingerprint,
    findings: [{
      title: '跨指标关系比单项规则更值得先看',
      analysis: 'Session 集中度与工具结果后续暴露同时出现，优先验证上下文边界是否反复携带结果。',
      evidenceRefs: ['summary:totalTokens', 'ranking:sessions:large', 'check:long_session'],
      support: 'strong',
      uncertainty: '这些指标显示相关模式，但不能单独证明因果。',
    }],
    noStrongFindingReason: null,
    ...overrides,
  };
}

function reportCompositionFor(audit, reportSynthesis) {
  return {
    auditFingerprint: auditFingerprint(audit),
    audit,
    reportSynthesis,
    keySessionAnalyses: [],
  };
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

test('validated report synthesis replaces fixed checks in the original Findings module', () => {
  const audit = findingsResult();
  const synthesis = reportSynthesisFor(audit);
  assert.equal(validateReportSynthesis(audit, synthesis).valid, true);
  const html = renderHtml(audit, 'en-US', reportCompositionFor(audit, synthesis));
  const findings = html.match(/<section class="supporting-findings">[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.equal((html.match(/<h2>Findings<\/h2>/g) ?? []).length, 1);
  assert.equal((html.match(/<section class="supporting-findings"/g) ?? []).length, 1);
  assert.match(findings, /跨指标关系比单项规则更值得先看/);
  assert.match(findings, /Evidence/);
  assert.match(findings, /Strong support/);
  assert.match(findings, /summary:totalTokens/);
  assert.doesNotMatch(findings, /One Session accounts for/);
  assert.doesNotMatch(findings, /automated findings/i);
});

test('invalid report synthesis falls back to Automated Checks in the same Findings module', () => {
  const audit = findingsResult();
  const invalid = reportSynthesisFor(audit, { auditFingerprint: 'stale-audit', findings: [{ ...reportSynthesisFor(audit).findings[0], evidenceRefs: ['summary:not-present'] }] });
  assert.equal(validateReportSynthesis(audit, invalid).valid, false);
  const html = renderHtml(audit, 'en-US', reportCompositionFor(audit, invalid));
  const findings = html.match(/<section class="supporting-findings">[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.match(findings, /Host Agent synthesis is unavailable/);
  assert.match(findings, /deterministic Automated Checks are fallback content/);
  assert.match(findings, /One Session accounts for/);
  assert.equal((html.match(/<h2>Findings<\/h2>/g) ?? []).length, 1);
  assert.doesNotMatch(html, /class="supporting-findings"[\s\S]*class="supporting-findings"/);
});

test('report synthesis renders an explicit no-strong-Finding state', () => {
  const audit = findingsResult();
  const synthesis = reportSynthesisFor(audit, { findings: [], noStrongFindingReason: 'The selected Evidence is too sparse to prioritize a cause.' });
  assert.equal(validateReportSynthesis(audit, synthesis).valid, true);
  const html = renderHtml(audit, 'en-US', reportCompositionFor(audit, synthesis));
  const findings = html.match(/<section>[\s\S]*?<h2>Findings<\/h2>[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.match(findings, /No strong Finding is supported by this Audit/);
  assert.match(findings, /selected Evidence is too sparse/);
});

test('report synthesis enforces the current audit fingerprint, Evidence references, and five-Finding limit', () => {
  const audit = findingsResult();
  const base = reportSynthesisFor(audit);
  for (const candidate of [
    { ...base, auditFingerprint: 'other-audit' },
    { ...base, findings: [{ ...base.findings[0], evidenceRefs: ['summary:missing'] }] },
    { ...base, findings: Array.from({ length: 6 }, (_, index) => ({ ...base.findings[0], title: 'Finding ' + index })) },
    { ...base, findings: [], noStrongFindingReason: null },
    { ...base, findings: [{ ...base.findings[0], title: '' }], noStrongFindingReason: 'contradictory' },
  ]) {
    const validation = validateReportSynthesis(audit, candidate);
    assert.equal(validation.valid, false);
  }
});

test('Key Session analysis keeps the Kami hierarchy, evidence roles, numeric sorting, and deterministic fallback', () => {
  const audit = keySessionResult();
  const evidenceId = audit.turns.find((turn) => turn.sessionId === 'key-s1' && turn.turnId === 'key-s1-r2').evidenceId;
  const fingerprint = auditFingerprint(audit);
  const composition = {
    auditFingerprint: fingerprint,
    audit,
    keySessionAnalyses: [{
      sessionId: 'key-s1',
      auditFingerprint: fingerprint,
      taskContext: '完成规范阅读并整理实现边界。',
      primaryFinding: {
        observation: '第二轮的 Token 使用明显高于第一轮。',
        interpretation: '上下文增长集中发生在第二轮，值得优先检查。',
        evidenceIds: [evidenceId],
        support: 'strong',
        alternativeExplanations: [],
      },
      recommendation: {
        action: '在长流程前拆分任务上下文。',
        rationale: '先验证拆分是否能降低单轮输入规模。',
        applicability: '适用于后续同类文档工作。',
        tradeoff: null,
        verification: '比较下一周相似 Session 的前两轮 Token。',
        targetEvidenceIds: [evidenceId],
      },
      evidenceRead: { turnIds: ['key-s1-r2'], selectionReason: '选择 Token 峰值轮次。', unreadScope: '未读取其他历史内容。' },
      limitations: [],
  }],
  };
  const html = renderHtml(audit, 'zh-CN', composition);
  const sectionStart = html.indexOf('<section class="key-session-analysis-section">');
  const sectionEnd = html.indexOf('<section><h2>限制与缺失</h2>', sectionStart);
  const keySection = html.slice(sectionStart, sectionEnd > sectionStart ? sectionEnd : undefined);
  const visible = keySection.replace(/<[^>]+>/g, '');
  assert.match(keySection, /<h2>关键 Session 分析<\/h2>/);
  assert.match(keySection, /<h3 class="session-title">阅读文档并准备 to-spec<\/h3>/);
  assert.match(keySection, /<p class="session-id">key-s1 · codex<\/p>/);
  assert.equal((keySection.match(/<details class="key-session-entry/g) ?? []).length, 3);
  assert.equal((keySection.match(/<details class="key-session-entry[^>]* open>/g) ?? []).length, 1);
  assert.match(keySection, /key-session-entry key-session-entry--primary" open/);
  assert.match(html, /\.key-session-module-head h2\{[^}]*font-size:32px/);
  assert.match(html, /\.key-session-heading \.session-title\{[^}]*font-size:18px/);
  assert.match(html, /\.key-session-module-head\{[^}]*border-bottom:\.5px solid var\(--border\)/);
  assert.match(html, /\.key-session-list\{margin-top:26px\}/);
  assert.doesNotMatch(html, /\.key-session-list\{[^}]*border-top/);
  assert.match(html, /\.key-session-judgment \.judgment\{border-top:\.5px solid var\(--border\)/);
  assert.match(html, /\.key-session-chart-frame\{margin:0;border-top:\.5px solid var\(--border\)/);
  assert.doesNotMatch(html, /\.key-session-(?:judgment \.judgment|chart-frame)\{[^}]*var\(--near-black\)/);
  assert.match(html, /前 2 轮合计占 100\.00%/);
  assert.match(visible, /核心判断[\s\S]*改善提议[\s\S]*如何验证/);
  const finding = keySection.match(/<article class="finding">[\s\S]*?<\/article>/)?.[0] ?? '';
  const action = keySection.match(/<article class="action">[\s\S]*?<\/article>/)?.[0] ?? '';
  assert.match(finding, /第二轮的 Token 使用明显高于第一轮/);
  assert.doesNotMatch(finding, /拆分任务上下文|比较下一周/);
  assert.match(action, /拆分任务上下文/);
  assert.match(action, /如何验证[\s\S]*比较下一周/);
  assert.match(keySection, /本轮耗时/);
  assert.match(keySection, /分钟/);
  assert.match(keySection, /过程事件/);
  assert.match(keySection, /自动压缩上下文/);
  assert.match(keySection, /demo-skill/);
  assert.match(keySection, /结果大小/);
  assert.match(keySection, /<table class="kami-table compact sortable turn-detail-table">/);
  assert.match(keySection, /查看全部 2 个轮次明细/);
  assert.match(keySection, /data-sort="800"/);
  assert.match(keySection, /data-sort="200"/);
  assert.match(html, /Number\(a\.key\)/);
  assert.match(html, /aria-sort/);
  assert.match(html, /\.turn-detail-table tr\.hot-row\{background:transparent\}/);
  assert.doesNotMatch(html.match(/\.turn-detail-table tr\.hot-row\{[^}]*\}/)?.[0] ?? '', /gradient|box-shadow|border/);
  assert.match(keySection, /<noscript>/);
  for (const forbidden of ['记录值', '计算值', '估算值', '有 Token 轮次', 'Turn', '活跃耗时', 'Lifecycle', 'compaction', 'TTFT']) {
    assert.doesNotMatch(visible, new RegExp(forbidden, 'i'));
  }

  const fallback = renderHtml(audit, 'zh-CN');
  const fallbackStart = fallback.indexOf('<section class="key-session-analysis-section">');
  const fallbackEnd = fallback.indexOf('<section><h2>限制与缺失</h2>', fallbackStart);
  const fallbackSection = fallback.slice(fallbackStart, fallbackEnd > fallbackStart ? fallbackEnd : undefined);
  assert.match(fallbackSection, /分析不可用/);
  assert.match(fallbackSection, /轮次轨迹/);
  assert.match(fallbackSection, /turn-detail-table/);
});

test('Kami restyle preserves the normalized bilingual content contract', () => {
  for (const locale of ['en-US', 'zh-CN']) {
    assert.deepEqual(snapshotHtml(renderHtml(result(), locale)), contentBaseline[locale], locale);
  }
});

test('cache pricing limitations are reduced to one actionable visible explanation while raw text keeps detail', () => {
  const html = renderHtml(result(), 'zh-CN');
  const { renderText } = require('../dist/src/report.js');
  const cacheSection = html.match(/<section class="cache-economics">[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.match(cacheSection, /金额仅按能匹配精确单价的用量估算；仍有部分模型无法匹配价格，因此金额可能低于完整用量对应成本。/);
  assert.doesNotMatch(cacheSection, /LiteLLM 没有找到|没有找到 openai\/|定价时根据所选 Harness/);
  assert.match(renderText(result(), 'zh-CN'), /没有找到 openai\/gpt-4\.1 的价格条目/);
});

test('Skill evidence keeps only actionable usage and cost columns', () => {
  const report = result();
  report.report.skills = [{
    name: 'sample-skill', state: 'attributed',
    availableSessions: { value: 2, provenance: 'derived' },
    invocationCount: { value: 3, provenance: 'derived' },
    sessionCount: { value: 2, provenance: 'derived' },
    firstObservedAt: { value: '2026-09-08T08:00:00.000Z', provenance: 'reported' },
    lastObservedAt: { value: '2026-09-08T09:00:00.000Z', provenance: 'reported' },
    attributedTokens: { value: 12345, provenance: 'derived' },
    attributedApiEquivalentCost: { value: 31.51641688, provenance: 'estimated' },
    evidenceCoveragePercent: { value: 100, provenance: 'derived' },
    directResourceFootprint: { value: 3, provenance: 'derived' },
    observedAssociation: { value: null, provenance: 'unavailable' },
    causalImpact: { value: null, provenance: 'unavailable' },
    evidenceTypes: ['explicit-input'], sourceLocations: [],
  }];
  const html = renderHtml(report, 'zh-CN');
  const skillSection = html.match(/<section class="skill-evidence">[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.match(skillSection, /调用次数/);
  assert.match(skillSection, /调用 Session/);
  assert.match(skillSection, /约 \$31\.52/);
  assert.match(skillSection, /精确值：\$31\.51641688/);
  assert.match(skillSection, /API 折算金额只统计能够明确关联到该 Skill 的用量/);
  assert.doesNotMatch(skillSection, /状态|有据可查比例|首次观察|最近观察|时间上相关|有因果证明/);
});

test('unavailable provider quota fields are omitted while available quota fields remain visible', () => {
  const report = result();
  const unavailableHtml = renderHtml(report, 'zh-CN');
  const unavailableRolling = unavailableHtml.match(/<div class="ivory-group rolling-activity">[\s\S]*?<\/div><\/section>/)?.[0] ?? unavailableHtml;
  assert.doesNotMatch(unavailableRolling, /Provider 额度|重置时间|没有该工具官方提供的额度数据/);

  report.report.rollingWindow.providerQuota = { value: 42, provenance: 'reported' };
  report.report.rollingWindow.resetAt = { value: '2026.09.11T12:00', provenance: 'reported' };
  const availableHtml = renderHtml(report, 'zh-CN');
  assert.match(availableHtml, /Provider 额度/);
  assert.match(availableHtml, /重置时间/);
  assert.match(availableHtml, /42/);
});

test('model distribution adds a donut chart for small model sets without changing the table', () => {
  const html = renderHtml(result(), 'zh-CN');
  assert.match(html, /id="model-share-chart" class="echart"/);
  assert.match(html, /type:'pie'/);
  assert.match(html, /d\.models\.length<=6/);
  assert.match(html, /按模型查看 Token 占比/);
});

test('model distribution keeps the bar-only layout for larger model sets', () => {
  const report = result();
  report.rankings.models = Array.from({ length: 7 }, (_, index) => ({
    ...report.rankings.models[0],
    key: `model-${index}`,
    sharePercent: { value: 100 / 7, provenance: 'derived' },
  }));
  const html = renderHtml(report, 'zh-CN');
  assert.doesNotMatch(html, /id="model-share-chart"/);
});

test('Kami shell embeds the authorized W04/W05 font contract', () => {
  const html = renderHtml(result(), 'zh-CN');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(head, /authorized TsangerJinKai02-W04/);
  assert.match(head, /authorized TsangerJinKai02-W05/);
  assert.match(head, /data:font\/ttf;base64,/);
  assert.doesNotMatch(head, /src:url\(["']assets\/fonts|https?:\/\//i);
  assert.match(html, /main\{padding:88px 64px 120px\}/);
  assert.match(html, /\.report-header__project\{font-size:clamp\(44px,5vw,64px\);font-weight:500/);
  assert.match(html, /\.report-deck\{max-width:820px;font-size:18px/);
  assert.match(html, /@media\(max-width:480px\).*\.report-header__project\{font-size:clamp\(26px,8\.5vw,46px\)/s);
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
  assert.equal((html.match(/估算值仅作参考，不代表实际账单；“—”表示暂时没有数据。/g) ?? []).length, 1);
  assert.match(text, /^估算值仅作参考，不代表实际账单；“—”表示暂时没有数据。/);
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
  assert.match(chineseText, /估算暴露量为 约 10/);
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
  assert.doesNotMatch(provenHtml, /coverage-alert/);
  assert.match(provenHtml, /\.turn-detail-table tr\.hot-row\{background:transparent\}/);
  assert.doesNotMatch(provenHtml, /\.turn-detail-table tr\.hot-row\{[^}]*?(?:gradient|box-shadow|border)/);
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
  const chineseVisible = chineseHtml.replace(/<(?:style|script)\b[\s\S]*?<\/(?:style|script)>/gi, '');
  const englishVisible = englishHtml.replace(/<(?:style|script)\b[\s\S]*?<\/(?:style|script)>/gi, '');
  assert.match(chineseVisible, /2026\.09\.01 \d{2}:\d{2}/);
  assert.match(chineseVisible, /<text[^>]*class="chart-label">09\.08<\/text>/);
  assert.match(chineseHtml, /"time":"09\.08"/);
  assert.match(chineseVisible, /2026\.09\.08 \d{2}:\d{2}/);
  assert.doesNotMatch(chineseVisible, /GMT|\d{4}年\d{1,2}月\d{1,2}日/);
  assert.match(englishVisible, /2026\.09\.01 \d{2}:\d{2}/);
  assert.doesNotMatch(englishVisible, /GMT|Sep \d/);
  assert.match(renderText(report, 'zh-CN'), /2026\.09\.01 \d{2}:\d{2}/);
});

test('daily token trend uses the Kami contrast ladder and redundant line encodings', () => {
  const html = renderHtml(result(), 'zh-CN');
  assert.doesNotMatch(html, /stack:'tokens'/);
  assert.match(html, /#2d4e7a/);
  assert.match(html, /getComputedStyle\(document\.documentElement\)\.getPropertyValue\('--serif'\)/);
  assert.match(html, /lineType,symbol,focus/);
  assert.match(html, /lineStyle:\{color,width:focus\?2\.5:2,opacity:focus\?1:\.92,type:lineType\}/);
  assert.match(html, /symbol,showSymbol:d.rows.length<=14/);
  assert.match(html, /areaStyle:\{color,opacity:\.1\}/);
  assert.match(html, /areaStyle:\{color,opacity:\.12\}/);
  assert.doesNotMatch(html, /areaStyle:\{color,opacity:\.18\}/);
});
test('Kami data surfaces preserve tables, local scrolling, print output, and no-JS details', () => {
  const html = renderHtml(result(), 'zh-CN');
  assert.match(html, /<table class="kami-table sortable"><thead>/);
  assert.match(html, /@media\(scripting:none\)\{details > :not\(summary\)\{display:block\}\}/);
  assert.match(html, /@media print\{\.echart\{display:none\}details > :not\(summary\)\{display:block\}/);
  assert.match(html, /html,body\{overflow-x:clip\}/);
  assert.match(html, /\.kami-table\{display:block;width:max-content;min-width:100%;max-width:100%;overflow-x:auto;white-space:nowrap\}/);
  assert.match(html, /\.kami-table th,\.kami-table td\{padding-top:10px;padding-bottom:10px\}/);
  assert.match(html, /textStyle:\{fontFamily:serifFont/);
  assert.doesNotMatch(html, /brandLight: "#2d5a8a"/);
});
test('Kami fidelity score separates static contract from unavailable browser proof', () => {
  const scored = scoreHtml(renderHtml(result(), 'zh-CN'));
  assert.equal(scored.browser.status, 'unavailable');
  assert.equal(scored.overall.status, 'unavailable');
  assert.ok(scored.automated.checks.every((check) => check.status === 'passed'));
  assert.match(scored.unavailable.join('|'), /actual font|computed style|bounding boxes|page overflow|fixed-viewport screenshots/);
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
