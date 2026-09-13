const assert = require('node:assert/strict');
const { test } = require('node:test');

const { analyseAudit } = require('../dist/src/analysis.js');
const { formatCompact, renderHtml, renderShare, renderText } = require('../dist/src/report.js');
const { REPORT_MESSAGES } = require('../dist/src/report-messages.js');

function auditResult() {
  const timestamp = '2026-09-01T08:00:00.000Z';
  return analyseAudit(
    { cwd: 'D:\\project', allProjects: false, since: new Date('2026-09-01T00:00:00.000Z') },
    {
      sessions: [{ harness: 'codex', sessionId: 'session-1', title: 'Contract', projectCwd: 'D:\\project', startedAt: timestamp, endedAt: timestamp, parentSessionId: null, sourceVersion: 'fixture' }],
      turns: [],
      modelCalls: [{
        sessionId: 'session-1', callId: 'call-1', timestamp, provider: 'openai', model: 'gpt-5',
        inputTokens: 9990, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 10,
        reasoningTokens: 0, totalTokens: 10000, reportedCost: null, status: 'ok', tokenProvenance: 'reported',
      }],
      toolCalls: [],
      lifecycle: [],
      coverage: { filesRead: 1, recordsRead: 2, recordsSkipped: 0, partialSessions: 0, warnings: [] },
    },
    'codex',
  );
}

test('typed report messages render every supported report format', () => {
  const result = auditResult();
  for (const locale of Object.keys(REPORT_MESSAGES)) {
    const messages = REPORT_MESSAGES[locale];
    const html = renderHtml(result, locale);
    const text = renderText(result, locale);
    const share = renderShare(result, locale);

    assert.match(html, new RegExp('<html lang="' + messages.htmlLang + '">'));
    assert.ok(html.includes(messages.title));
    assert.ok(html.includes(messages.header.asOf('2026.09.01')));
    assert.ok(text.length > 0);
    assert.ok(share.includes(messages.redactedShare));
    assert.equal(formatCompact(10000, locale), locale === 'zh-CN' ? '1万' : '10K');
  }
});
