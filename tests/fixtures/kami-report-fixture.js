const { analyseAudit } = require('../../dist/src/analysis.js');

function makeResult() {
  const timestamp = '2026-09-08T08:00:00.000Z';
  const call = (sessionId, model, totalTokens) => ({
    sessionId,
    callId: sessionId + '-call',
    timestamp,
    provider: 'openai',
    model,
    inputTokens: totalTokens - 10,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 10,
    reasoningTokens: 0,
    totalTokens,
    reportedCost: null,
    status: 'ok',
    tokenProvenance: 'reported',
  });
  return analyseAudit({
    cwd: 'D:\\project',
    allProjects: false,
    since: new Date('2026-09-01T00:00:00.000Z'),
  }, {
    sessions: [
      { harness: 'codex', sessionId: 'large', title: 'Large', projectCwd: 'D:\\project', startedAt: timestamp, endedAt: timestamp, parentSessionId: null, sourceVersion: null },
      { harness: 'codex', sessionId: 'small', title: 'Small', projectCwd: 'D:\\project', startedAt: timestamp, endedAt: timestamp, parentSessionId: null, sourceVersion: null },
    ],
    modelCalls: [call('large', 'gpt-4.1', 900), call('large', 'gpt-4.1', 90), call('small', 'other-model', 10)],
    toolCalls: [{ sessionId: 'large', callId: 'tool-1', timestamp, toolName: 'read', inputBytes: null, resultBytes: 40, resultChars: 40, isError: null }],
    lifecycle: [],
    coverage: { filesRead: 1, recordsRead: 4, recordsSkipped: 0, partialSessions: 0, warnings: [] },
  }, 'codex');
}

module.exports = { makeResult };
