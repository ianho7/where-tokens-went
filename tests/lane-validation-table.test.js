const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const {
  validateReportSynthesis,
  validateKeySessionAnalysis,
  auditFingerprint,
} = require('../dist/src/key-session-analysis.js');
const { validateSkillInsights } = require('../dist/src/skill-insights.js');
const { renderHtml } = require('../dist/src/report.js');
const { analyseAudit } = require('../dist/src/analysis.js');

const skillSnapshot = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '..', 'evals', 'fixtures', 'skill-insights-snapshot-real-aha-v1.json'),
  'utf8',
));

function makeFixtureAudit() {
  const timestamp = '2026-09-20T10:00:00.000Z';
  const sessions = [
    { harness: 'codex', sessionId: 'session-1', title: 'Task 1', projectCwd: 'D:/project/agent-audit', startedAt: timestamp, endedAt: timestamp, parentSessionId: null, sourceVersion: '0.1.0' },
    { harness: 'codex', sessionId: 'session-2', title: 'Task 2', projectCwd: 'D:/project/agent-audit', startedAt: timestamp, endedAt: timestamp, parentSessionId: null, sourceVersion: '0.1.0' },
    { harness: 'codex', sessionId: 'session-3', title: 'Task 3', projectCwd: 'D:/project/agent-audit', startedAt: timestamp, endedAt: timestamp, parentSessionId: null, sourceVersion: '0.1.0' },
  ];
  const turns = [
    { sessionId: 'session-1', turnId: 'turn-1', ordinal: 1, startedAt: timestamp, endedAt: timestamp, durationMs: 1000, timeToFirstTokenMs: 200, status: 'ok', timingProvenance: 'reported' },
    { sessionId: 'session-2', turnId: 'turn-2', ordinal: 1, startedAt: timestamp, endedAt: timestamp, durationMs: 1000, timeToFirstTokenMs: 200, status: 'ok', timingProvenance: 'reported' },
    { sessionId: 'session-3', turnId: 'turn-3', ordinal: 1, startedAt: timestamp, endedAt: timestamp, durationMs: 1000, timeToFirstTokenMs: 200, status: 'ok', timingProvenance: 'reported' },
  ];
  const modelCalls = [
    { sessionId: 'session-1', callId: 'c1', timestamp, provider: 'openai', model: 'gpt-4o', inputTokens: 500, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 50, reasoningTokens: 0, totalTokens: 550, reportedCost: null, status: 'ok', tokenProvenance: 'reported', turnId: 'turn-1', activeBranch: true },
    { sessionId: 'session-2', callId: 'c2', timestamp, provider: 'openai', model: 'gpt-4o', inputTokens: 300, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 30, reasoningTokens: 0, totalTokens: 330, reportedCost: null, status: 'ok', tokenProvenance: 'reported', turnId: 'turn-2', activeBranch: true },
    { sessionId: 'session-3', callId: 'c3', timestamp, provider: 'openai', model: 'gpt-4o', inputTokens: 200, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 20, reasoningTokens: 0, totalTokens: 220, reportedCost: null, status: 'ok', tokenProvenance: 'reported', turnId: 'turn-3', activeBranch: true },
  ];
  const read = {
    sessions,
    turns,
    modelCalls,
    toolCalls: [],
    lifecycle: [],
    skillEvidence: [],
    tokenAccounting: {
      responseTotal: 1100,
      turnTotal: 1100,
      threadTotal: 1100,
      reconciledSessionIds: ['session-2'],
      mismatchedSessionIds: ['session-1'],
      status: 'mismatch',
      method: 'fixture',
    },
    coverage: { filesRead: 1, recordsRead: 10, recordsSkipped: 0, partialSessions: 0, warnings: [] },
  };
  return analyseAudit(
    { cwd: 'D:/project/agent-audit', allProjects: false, since: new Date('2026-09-19T00:00:00.000Z') },
    read,
    'codex',
  );
}

test('table-driven validation: 3 lanes partial acceptance, relaxation, and hard boundary enforcement', () => {
  const audit = makeFixtureAudit();
  const fingerprint = auditFingerprint(audit);

  // --- 1. Report Synthesis ---
  // Case 1a: Single valid Finding is accepted, and invalid Overview falls back to default without rejecting the Finding
  const synthesisSingleFindingInvalidOverview = {
    auditFingerprint: fingerprint,
    overview: { summary: 'Invalid overview citing bad evidence', evidenceRefs: ['bad:unknown-ref'] },
    findings: [
      {
        title: 'Single Valid Finding',
        analysis: 'This single finding explains the token concentration in session 1.',
        evidenceRefs: ['summary:totalTokens'],
        support: 'strong',
        uncertainty: null,
      },
    ],
    noStrongFindingReason: null,
  };
  const val1a = validateReportSynthesis(audit, synthesisSingleFindingInvalidOverview);
  assert.equal(val1a.valid, true, 'Report Synthesis with 1 valid finding must be accepted even if overview is invalid');
  assert.equal(val1a.synthesis.findings.length, 1);
  assert.equal(val1a.synthesis.overview, null, 'Invalid overview should be null/defaulted');

  // Case 1b: Unknown evidence in Finding rejects that finding, but keeps other valid findings
  const synthesisPartialFindings = {
    auditFingerprint: fingerprint,
    overview: { summary: 'Valid overview', evidenceRefs: ['summary:totalTokens'] },
    findings: [
      {
        title: 'Valid Finding',
        analysis: 'Analysis with valid evidence.',
        evidenceRefs: ['summary:totalTokens'],
        support: 'strong',
        uncertainty: null,
      },
      {
        title: 'Invalid Finding',
        analysis: 'Analysis with invalid evidence.',
        evidenceRefs: ['unknown:fake-ref'],
        support: 'strong',
        uncertainty: null,
      },
    ],
    noStrongFindingReason: null,
  };
  const val1b = validateReportSynthesis(audit, synthesisPartialFindings);
  assert.equal(val1b.valid, true);
  assert.equal(val1b.synthesis.findings.length, 1);
  assert.equal(val1b.synthesis.findings[0].title, 'Valid Finding');

  // Case 1c: All findings invalid and no noStrongFindingReason -> rejected
  const synthesisAllBad = {
    auditFingerprint: fingerprint,
    overview: { summary: 'Valid overview', evidenceRefs: ['summary:totalTokens'] },
    findings: [
      {
        title: 'Invalid Finding',
        analysis: 'Analysis with invalid evidence.',
        evidenceRefs: ['unknown:fake-ref'],
        support: 'strong',
        uncertainty: null,
      },
    ],
    noStrongFindingReason: null,
  };
  const val1c = validateReportSynthesis(audit, synthesisAllBad);
  assert.equal(val1c.valid, false, 'No valid findings and no noStrongFindingReason must be rejected');

  // --- 2. Key Session Analysis ---
  const turnEvidenceId = audit.turns[0].evidenceId;

  // Case 2a: Session with accounting mismatch allows moderate mechanism and non-empty limitations
  const keySessionModerateMismatch = {
    sessionId: 'session-1',
    auditFingerprint: fingerprint,
    taskContext: 'Reconciling interface specification.',
    primaryFinding: {
      observation: 'Repeated tool calls in turn 1 kept input high.',
      interpretation: 'The task re-read document context in later turns.',
      evidenceIds: [turnEvidenceId],
      support: 'moderate',
      alternativeExplanations: ['Task complexity could also require repeated reading.'],
    },
    recommendation: {
      action: 'Split document into bounded sections.',
      rationale: 'Reduces repeated context exposure.',
      applicability: 'When document exceeds 10k words.',
      tradeoff: null,
      verification: 'Check turn 2 input tokens on next task.',
      targetEvidenceIds: [turnEvidenceId],
    },
    evidenceRead: {
      turnIds: ['turn-1'],
      selectionReason: 'top-token turn',
      unreadScope: 'none',
    },
    limitations: ['Token accounting was not reconciled for this session; conclusions are based on observed tool and turn behavior.'],
  };
  const val2a = validateKeySessionAnalysis(audit, keySessionModerateMismatch);
  assert.equal(val2a.valid, true, 'Moderate mechanism with limitations must be accepted under unreconciled accounting');

  // Case 2b: Session with accounting mismatch rejects strong mechanism
  const keySessionStrongMismatch = {
    ...keySessionModerateMismatch,
    primaryFinding: {
      ...keySessionModerateMismatch.primaryFinding,
      support: 'strong',
    },
  };
  const val2b = validateKeySessionAnalysis(audit, keySessionStrongMismatch);
  assert.equal(val2b.valid, false, 'Strong mechanism must be rejected under unreconciled accounting');

  // Case 2c: Unknown Evidence ID is rejected
  const keySessionBadEvidence = {
    ...keySessionModerateMismatch,
    primaryFinding: {
      ...keySessionModerateMismatch.primaryFinding,
      evidenceIds: ['turn:session-1:non-existent'],
    },
  };
  const val2c = validateKeySessionAnalysis(audit, keySessionBadEvidence);
  assert.equal(val2c.valid, false, 'Unknown Evidence ID must be rejected');

  // --- 3. Skill Insights ---
  // Case 3a: Skill Insights allows GPT-4o, Claude 3.5, Python 3, v2 in prose
  const skillInsightsWithTechNames = {
    snapshotId: skillSnapshot.snapshotId,
    insights: [
      {
        id: 'tech-names-insight',
        kind: 'usage',
        candidateType: 'high_usage_strong_delta',
        scope: 'skill',
        subject: { skillId: 'where-tokens-went' },
        title: 'Model versions and tooling context',
        reveal: {
          semantic: 'Usage patterns with GPT-4o and Claude 3.5 in Python 3 v2 environments',
          pattern: 'content_contrast',
          evidenceRefs: ['content:where-tokens-went:hardConstraint'],
        },
        mentalModelShift: {
          surface: 'Surface view with Claude 3.5 and Python 3',
          observed: 'Observed structure across GPT-4o and v2 release',
        },
        decisionDelta: {
          before: 'Default investigation for Python 3',
          after: 'Concrete choice justified by GPT-4o and Claude 3.5 findings',
        },
        observation: 'Observed across GPT-4o and Claude 3.5 with Python 3 v2.',
        contrast: 'Compared to baseline without v2 tools.',
        interpretation: 'Architectural deduction mentioning GPT-4o and Claude 3.5.',
        confidence: 'high',
        evidence: [
          {
            kind: 'skill_content',
            skillId: 'where-tokens-went',
            role: 'hardConstraint',
            evidenceExcerpt: 'The invoking Harness is the current Host: use `codex` when running inside Codex and `claude` when running inside Claude Code.',
          },
        ],
      },
    ],
  };
  const val3a = validateSkillInsights(skillInsightsWithTechNames, skillSnapshot);
  assert.equal(val3a.valid, true, `Tech names like GPT-4o, Claude 3.5, Python 3, v2 must be accepted; errors: ${val3a.errors.join('; ')}`);
  assert.equal(val3a.insights.length, 1);

  // Case 3b: Explicit forged metric numbers (e.g. 50% or 10 tokens in free prose) are rejected
  const skillInsightsWithForgedTokens = {
    snapshotId: skillSnapshot.snapshotId,
    insights: [
      {
        ...skillInsightsWithTechNames.insights[0],
        id: 'forged-metrics-insight',
        observation: 'Observed 1000 tokens consumed by the tool.',
      },
    ],
  };
  const val3b = validateSkillInsights(skillInsightsWithForgedTokens, skillSnapshot);
  assert.equal(val3b.valid, false, 'Explicit forged token counts in prose must be rejected');

  // Case 3c: Wrong snapshotId is rejected
  const skillInsightsWrongSnapshot = {
    ...skillInsightsWithTechNames,
    snapshotId: 'wrong-snapshot-id',
  };
  const val3c = validateSkillInsights(skillInsightsWrongSnapshot, skillSnapshot);
  assert.equal(val3c.valid, false, 'Wrong snapshotId must be rejected');

  // --- 4. HTML Owner Test ---
  // Filtered results can be rendered by renderHtml without error
  const htmlResult = renderHtml(
    audit,
    'en-US',
    {
      auditFingerprint: fingerprint,
      audit,
      reportSynthesis: val1a.synthesis,
      keySessionAnalyses: [val2a.analysis],
      skillInsights: val3a.insights,
      skillInsightsSnapshotId: skillSnapshot.snapshotId,
    },
  );
  assert.ok(htmlResult.includes('skill-insights'), 'Filtered skill insights must render in HTML');
  assert.ok(htmlResult.includes('GPT-4o'), 'Rendered HTML must include the preserved tech names');
});
