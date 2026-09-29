const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const {
  validateReportSynthesis,
  validateKeySessionAnalysis,
  auditFingerprint,
  resolveReportEvidence,
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

test('AC 3: data contract owner proof: table-driven evidence resolution, metric detection, and skill insight category limits', () => {
  const audit = makeFixtureAudit();

  // 1. Table-driven Evidence ID resolution
  // Add a synthetic check with ambiguous normalized id to audit for the test
  audit.checks.push(
    { id: 'check-foo-bar', category: 'cost', title: 'Check 1', description: 'desc', severity: 'info', status: 'pass', evidence: [{ label: 'e1', value: 1, provenance: 'reported' }] },
    { id: 'check_foo_bar', category: 'cost', title: 'Check 2', description: 'desc', severity: 'info', status: 'pass', evidence: [{ label: 'e2', value: 2, provenance: 'reported' }] },
  );

  const evidenceCases = [
    ['exact summary ID', 'summary:totalTokens', 'summary', true],
    ['unique normalized summary ID (lowercase)', 'summary:totaltokens', 'summary', true],
    ['unique normalized summary ID (hyphens/spaces)', 'summary:total_tokens', 'summary', true],
    ['unknown summary ID', 'summary:unknownMetric', null, false],

    ['exact check ID', 'check:check-foo-bar', 'check', true],
    ['exact check ID with index', 'check:check-foo-bar:0', 'check', true],
    ['ambiguous normalized check ID', 'check:checkfoobar', null, false],
    ['unknown check ID', 'check:non-existent-check', null, false],

    ['exact ranking ID', 'ranking:sessions:session-1', 'ranking', true],
    ['unique normalized ranking ID', 'ranking:sessions:session_1', 'ranking', true],
    ['unknown ranking dimension', 'ranking:invalidDimension:key', null, false],
    ['unknown ranking key', 'ranking:sessions:unknown-session', null, false],

    ['exact turn evidence ID', audit.turns[0].evidenceId, 'turn', true],
    ['unique normalized turn evidence ID', audit.turns[0].evidenceId.toUpperCase().replace('-', '_'), 'turn', true],
    ['unknown turn evidence ID', 'turn:non-existent:0', null, false],
  ];

  for (const [desc, query, expectedKind, shouldMatch] of evidenceCases) {
    const match = resolveReportEvidence(audit, query);
    if (shouldMatch) {
      assert.ok(match !== null, `${desc} (${query}) must match`);
      assert.equal(match.kind, expectedKind, `${desc} must return kind ${expectedKind}`);
    } else {
      assert.equal(match, null, `${desc} (${query}) must return null`);
    }
  }

  // 2. Table-driven Metric Detection in Skill Insights
  const baseCard = {
    id: 'metric-check-card',
    kind: 'usage',
    candidateType: 'high_usage_strong_delta',
    scope: 'skill',
    subject: { skillId: 'where-tokens-went' },
    title: 'Metric check',
    reveal: {
      semantic: 'Structural surprise without numeric wording',
      pattern: 'content_contrast',
      evidenceRefs: ['content:where-tokens-went:hardConstraint'],
    },
    mentalModelShift: { surface: 'Surface impression', observed: 'Observed structure' },
    decisionDelta: { before: 'Default investigation', after: 'Concrete choice' },
    observation: 'Observed baseline context.',
    contrast: 'Compared to baseline.',
    interpretation: 'Architectural interpretation.',
    confidence: 'high',
    evidence: [
      {
        kind: 'skill_content',
        skillId: 'where-tokens-went',
        role: 'hardConstraint',
        evidenceExcerpt: 'The invoking Harness is the current Host: use `codex` when running inside Codex and `claude` when running inside Claude Code.',
      },
    ],
  };

  const metricProseCases = [
    // Disallowed metrics
    ['isolated percentage 50%', '50%', false],
    ['isolated percentage 12.5%', '12.5%', false],
    ['isolated percentage 50 percent', '50 percent', false],
    ['isolated percentage 百分之25', '百分之25', false],
    ['token count 100 tokens', '100 tokens', false],
    ['token count 50k tokens', '50k tokens', false],
    ['currency $50', '$50', false],
    ['currency 50 美元', '50 美元', false],
    ['currency 50 元', '50 元', false],
    ['multiplier 3 倍', '3 倍', false],
    ['multiplier 2.5 times', '2.5 times', false],
    ['quantified 10 次', '10 次', false],
    ['quantified 3 轮', '3 轮', false],
    ['quantified 20 个', '20 个', false],
    ['quantified 5 条', '5 条', false],
    ['quantified 50 行', '50 行', false],
    ['isolated large number 50000', '50000', false],
    ['isolated large number 10,000', '10,000', false],
    ['isolated large number 5000', '5000', false],
    ['isolated large number 1000', '1000', false],

    // Allowed technical names, versions, and years
    ['model name GPT-4o', 'GPT-4o', true],
    ['model name Claude 3.5', 'Claude 3.5', true],
    ['language version Python 3', 'Python 3', true],
    ['release version v2', 'v2', true],
    ['year 2024', '2024', true],
    ['year 2026', '2026', true],
    ['year 1999', '1999', true],
  ];

  for (const [desc, proseFragment, shouldAccept] of metricProseCases) {
    const testPayload = {
      snapshotId: skillSnapshot.snapshotId,
      insights: [
        {
          ...baseCard,
          id: `metric-test-${desc.replace(/[^a-z0-9]/gi, '-')}`,
          observation: `Analysis mentions ${proseFragment} in context.`,
        },
      ],
    };
    const result = validateSkillInsights(testPayload, skillSnapshot);
    if (shouldAccept) {
      assert.equal(result.valid, true, `Allowed fragment '${proseFragment}' in '${desc}' must be accepted, but errors: ${result.errors.join('; ')}`);
      assert.equal(result.insights.length, 1);
    } else {
      assert.equal(result.valid, false, `Disallowed metric '${proseFragment}' in '${desc}' must be rejected`);
    }
  }

  // 3. Skill Insight Category Limits in effect
  // Contract: at most 2 content insights (capability/mechanism), at most 1 behavior anomaly, at most 1 usage topology
  const capabilityExcerpts = [
    [
      'The invoking Harness is the current Host: use `codex` when running inside Codex and `claude` when running inside Claude Code.',
      'Structure the response as Finding, Evidence, mechanism, action when justified, and material uncertainty without fixed wording.',
    ],
    [
      'Do not inspect the other Harness in response to a request.',
      'For a full or report request, start one Report Run before any expensive work.',
    ],
    [
      'The local tool is authoritative. Do not recalculate totals, infer missing values as zero, or expose raw history content.',
      'Structure the response as Finding, Evidence, mechanism, action when justified, and material uncertainty without fixed wording.',
    ],
  ];

  const makeCapabilityCard = (num) => ({
    ...baseCard,
    id: `capability-card-${num}`,
    kind: 'capability',
    scope: num === 2 ? 'cross_skill' : 'skill',
    subject: num === 2 ? { skillId: 'where-tokens-went-alt' } : { skillId: 'where-tokens-went' },
    title: `Capability insight ${num}`,
    reveal: {
      semantic: `Distinct structural capability surprise ${num}`,
      pattern: 'content_contrast',
      evidenceRefs: ['content:where-tokens-went:hardConstraint'],
    },
    mentalModelShift: {
      surface: `Surface impression capability ${num}`,
      observed: `Observed structure capability ${num}`,
    },
    decisionDelta: {
      before: `Before choice capability ${num}`,
      after: `After choice capability ${num}`,
    },
    claimStrength: 'coexistence',
    observation: `Observation capability ${num}.`,
    contrast: `Contrast capability ${num}.`,
    interpretation: `Interpretation capability ${num}.`,
    evidence: [
      {
        kind: 'skill_metric',
        metric: num === 1 ? 'callsPerTask' : num === 2 ? 'callShare' : 'tasks',
        skillId: 'where-tokens-went',
      },
      {
        kind: 'skill_content',
        skillId: 'where-tokens-went',
        role: 'hardConstraint',
        evidenceExcerpt: capabilityExcerpts[num - 1][0],
      },
      {
        kind: 'skill_content',
        skillId: 'where-tokens-went',
        role: 'genericProcedure',
        evidenceExcerpt: capabilityExcerpts[num - 1][1],
      },
    ],
  });

  const makeAnomalyCard = (num) => ({
    ...baseCard,
    id: `anomaly-card-${num}`,
    kind: 'usage',
    scope: 'skill',
    subject: { skillId: num === 1 ? 'where-tokens-went' : 'kami' },
    title: `Anomaly insight ${num}`,
    reveal: {
      semantic: `Distribution outlier surprise ${num}`,
      pattern: 'distribution_outlier',
      evidenceRefs: num === 1
        ? ['distribution:p90', 'skill:where-tokens-went:callsPerTask']
        : ['distribution:median', 'skill:kami:callsPerTask'],
    },
    mentalModelShift: {
      surface: `Surface impression anomaly ${num}`,
      observed: `Observed structure anomaly ${num}`,
    },
    decisionDelta: {
      before: `Before choice anomaly ${num}`,
      after: `After choice anomaly ${num}`,
    },
    observation: `Observation anomaly ${num}.`,
    contrast: `Contrast anomaly ${num}.`,
    interpretation: `Interpretation anomaly ${num}.`,
    evidence: num === 1
      ? [
          { kind: 'distribution_metric', metric: 'p90' },
          { kind: 'skill_metric', metric: 'callsPerTask', skillId: 'where-tokens-went' },
        ]
      : [
          { kind: 'distribution_metric', metric: 'median' },
          { kind: 'skill_metric', metric: 'callsPerTask', skillId: 'kami' },
        ],
  });

  const makeTopologyCard = (num) => ({
    ...baseCard,
    id: `topology-card-${num}`,
    kind: 'usage',
    scope: 'global',
    title: `Topology insight ${num}`,
    reveal: num === 1
      ? {
          semantic: 'Share inversion topology surprise 1',
          pattern: 'share_inversion',
          evidenceRefs: ['global:lowFrequencySkillShare', 'global:lowFrequencyCallShare'],
        }
      : {
          semantic: 'Family concentration topology surprise 2',
          pattern: 'family_concentration',
          evidenceRefs: ['family:where-tokens-went-family:callShare', 'family:where-tokens-went-family:totalCalls', 'global:totalSkillCalls'],
        },
    mentalModelShift: {
      surface: `Surface impression topology ${num}`,
      observed: `Observed structure topology ${num}`,
    },
    decisionDelta: {
      before: `Before choice topology ${num}`,
      after: `After choice topology ${num}`,
    },
    observation: `Observation topology ${num}.`,
    contrast: `Contrast topology ${num}.`,
    interpretation: `Interpretation topology ${num}.`,
    evidence: num === 1
      ? [
          { kind: 'global_metric', metric: 'lowFrequencySkillShare' },
          { kind: 'global_metric', metric: 'lowFrequencyCallShare' },
        ]
      : [
          { kind: 'family_metric', metric: 'callShare', familyId: 'where-tokens-went-family' },
          { kind: 'family_metric', metric: 'totalCalls', familyId: 'where-tokens-went-family' },
          { kind: 'global_metric', metric: 'totalSkillCalls' },
        ],
  });

  const categoryLimitsPayload = {
    snapshotId: skillSnapshot.snapshotId,
    insights: [
      makeCapabilityCard(1),
      makeCapabilityCard(2),
      makeCapabilityCard(3),
      makeAnomalyCard(1),
      makeAnomalyCard(2),
      makeTopologyCard(1),
      makeTopologyCard(2),
    ],
  };

  const limitResult = validateSkillInsights(categoryLimitsPayload, skillSnapshot);
  assert.equal(limitResult.valid, true, `Must be valid; errors: ${limitResult.errors.join('; ')}`);

  const acceptedCapability = limitResult.insights.filter((i) => i.kind === 'capability');
  const acceptedAnomaly = limitResult.insights.filter((i) => i.reveal.pattern === 'distribution_outlier');
  const acceptedTopology = limitResult.insights.filter((i) => i.kind === 'usage' && i.reveal.pattern !== 'distribution_outlier');

  assert.equal(acceptedCapability.length, 2, 'Content insights must be capped at exactly 2');
  assert.equal(acceptedAnomaly.length, 1, 'Behavior anomalies must be capped at exactly 1');
  assert.equal(acceptedTopology.length, 1, 'Usage topologies must be capped at exactly 1');
  assert.equal(limitResult.insights.length, 4, 'Total accepted cards must be exactly 2+1+1=4');
});
