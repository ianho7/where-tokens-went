const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const {
  validateReportSynthesis,
  validateKeySessionAnalysis,
  sanitizeKeySessionAnalysis,
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

test('0037: partial history privacy boundary (AC-1 to AC-4)', () => {
  const audit = makeFixtureAudit();
  const fingerprint = auditFingerprint(audit);
  const turn1EvidenceId = audit.turns[0].evidenceId;
  const turn2EvidenceId = audit.turns[1].evidenceId;

  // --- AC-1: Partial match (80 chars in 450 chars evidence), CRLF/whitespace variants, and full replacement ---
  const excerpt80 = 'SELECT users.id, users.email, users.password_hash FROM production_orders_cluster;'; // 81 chars
  assert.ok(excerpt80.length >= 40, 'excerpt80 must be at least 40 code units');
  const content450 = 'PRE_PADDING_'.repeat(15) + excerpt80 + '_POST_PADDING_'.repeat(15) + '…';
  assert.ok(content450.length >= 450, 'content450 must be at least 450 chars');

  const packetSession1 = {
    sessionId: 'session-1',
    turnIds: ['turn-1'],
    selectionReason: 'top-token turn',
    unreadScope: 'none',
    scope: audit.scope,
    items: [
      { kind: 'assistant', content: content450 },
    ],
  };

  // Candidate with 80-char partial excerpt with CRLF and multiple spaces in observation, and verbatim in action
  const candidatePartial = {
    sessionId: 'session-1',
    auditFingerprint: fingerprint,
    taskContext: 'Paraphrased investigation of query execution in turn 1.',
    primaryFinding: {
      observation: `Observed query execution:\r\n  SELECT users.id,   users.email,\r\n  users.password_hash FROM production_orders_cluster;\r\nin execution log.`,
      interpretation: 'Database queries in turn 1 kept input context footprint high.',
      evidenceIds: [turn1EvidenceId],
      support: 'moderate',
      alternativeExplanations: ['Query complexity requires database schema context.'],
    },
    recommendation: {
      action: `Avoid embedding verbatim query ${excerpt80} across subsequent calls.`,
      rationale: 'Reduces prompt token growth across subsequent turns.',
      applicability: 'Database inspection tasks.',
      tradeoff: null,
      verification: 'Check turn 2 input tokens on next query.',
      targetEvidenceIds: [turn1EvidenceId],
    },
    evidenceRead: { turnIds: ['turn-1'], selectionReason: 'top-token turn', unreadScope: 'none' },
    limitations: ['Token accounting was not reconciled for this session; conclusions are based on observed tool and turn behavior.'],
  };

  // 1. Validator rejects unredacted partial citation
  const valBefore = validateKeySessionAnalysis(audit, candidatePartial, [packetSession1]);
  assert.equal(valBefore.valid, false, 'Unredacted partial excerpt must be rejected by validator');
  assert.ok(valBefore.errors.some((e) => e.includes('repeats raw historical content')));

  // 2. Sanitizer replaces CRLF/whitespace variant and verbatim action
  const { sanitized: sanitized1, redactions: redactions1 } = sanitizeKeySessionAnalysis(candidatePartial, [packetSession1]);
  assert.equal(redactions1.length, 2, 'Must record 2 redactions for observation and action');
  assert.equal(sanitized1.primaryFinding.observation.includes(excerpt80), false, 'Observation must not contain excerpt80');
  assert.equal(sanitized1.primaryFinding.observation.includes('SELECT users.id'), false, 'Observation must not contain variant query');
  assert.ok(sanitized1.primaryFinding.observation.includes('[已移除直接引用的历史内容]'), 'Observation must include redaction placeholder');
  assert.ok(sanitized1.primaryFinding.observation.includes('Observed query execution:'), 'Observation structure outside excerpt must be preserved');
  assert.ok(sanitized1.recommendation.action.includes('[已移除直接引用的历史内容]'), 'Action must include redaction placeholder');

  // 3. Validator accepts sanitized object
  const valAfter = validateKeySessionAnalysis(audit, sanitized1, [packetSession1]);
  assert.equal(valAfter.valid, true, `Sanitized candidate must be accepted: ${valAfter.errors.join('; ')}`);

  // --- AC-2: Field isolation, no kind exemption, and short credential boundary ---
  // Field isolation: 25 chars in taskContext, 25 chars in observation - cannot concatenate across fields
  const boundaryText = 'BOUNDARY_PIECE_ALPHA_12345_BOUNDARY_PIECE_BETA_67890'; // 52 chars
  const packetBoundary = {
    sessionId: 'session-1',
    turnIds: ['turn-1'],
    selectionReason: 'top-token turn',
    unreadScope: 'none',
    scope: audit.scope,
    items: [{ kind: 'tool', content: boundaryText }],
  };
  const candidateIsolatedFields = {
    ...sanitized1,
    taskContext: `Investigating ${boundaryText.slice(0, 25)}.`, // 25 chars < 40
    primaryFinding: {
      ...sanitized1.primaryFinding,
      observation: `${boundaryText.slice(25)} appeared in tool output.`, // 27 chars < 40
    },
  };
  const { sanitized: sanitizedIso, redactions: redIso } = sanitizeKeySessionAnalysis(candidateIsolatedFields, [packetBoundary]);
  assert.equal(redIso.length, 0, 'Must NOT create false match by concatenating adjacent fields');
  assert.equal(sanitizedIso.taskContext, candidateIsolatedFields.taskContext);

  // Kind exemption check: user and tool kinds are equally redacted
  const userText = 'USER_INTENT_COMMAND_STRING_REPEATED_OVER_FORTY_UNITS_TEST';
  const toolText = 'TOOL_OUTPUT_BUFFER_RAW_DATA_STREAM_EXCEEDING_FORTY_UNITS';
  const packetKinds = {
    sessionId: 'session-1',
    turnIds: ['turn-1'],
    selectionReason: 'top-token turn',
    unreadScope: 'none',
    scope: audit.scope,
    items: [
      { kind: 'user', content: userText },
      { kind: 'tool', content: toolText },
    ],
  };
  const candidateKinds = {
    ...sanitized1,
    primaryFinding: {
      ...sanitized1.primaryFinding,
      observation: `User entered ${userText} and received ${toolText}.`,
    },
  };
  const { sanitized: sanitizedKinds, redactions: redKinds } = sanitizeKeySessionAnalysis(candidateKinds, [packetKinds]);
  assert.equal(redKinds.length, 1);
  assert.equal(redKinds[0].count, 2, 'Both user and tool historical contents must be redacted without kind exemption');
  assert.equal(sanitizedKinds.primaryFinding.observation.includes(userText), false);
  assert.equal(sanitizedKinds.primaryFinding.observation.includes(toolText), false);

  // Short credential rule (< 40 chars not exempt)
  const candidateWithShortCred = {
    ...sanitized1,
    recommendation: {
      ...sanitized1.recommendation,
      action: 'Run command with api_key=sk-secret-12345.', // 28 chars < 40
    },
  };
  const valCred = validateKeySessionAnalysis(audit, candidateWithShortCred, [packetSession1]);
  assert.equal(valCred.valid, false, 'Unredacted credential must be rejected even when under 40 chars');
  assert.ok(valCred.errors.some((e) => e.includes('contains unredacted credentials')));

  // Legitimate redactions (<redacted> or [已移除直接引用的历史内容]) do not trip credential rule
  const candidateSafeCred = {
    ...sanitized1,
    recommendation: {
      ...sanitized1.recommendation,
      action: 'Run command with api_key=<redacted>.',
    },
  };
  const valSafeCred = validateKeySessionAnalysis(audit, candidateSafeCred, [packetSession1]);
  assert.equal(valSafeCred.valid, true, 'Legitimate placeholder must not be rejected as unredacted credential');

  // --- AC-3: Deliverability: only placeholder remaining results in null finding and removed dependent recommendation ---
  // Session 1 copies entire 80-char evidence as observation: sanitized observation is only placeholder
  const candidateOnlyPlaceholder = {
    ...candidatePartial,
    primaryFinding: {
      ...candidatePartial.primaryFinding,
      observation: excerpt80, // Entire observation is the raw evidence
    },
  };
  const { sanitized: sanitizedS1, redactions: redS1 } = sanitizeKeySessionAnalysis(candidateOnlyPlaceholder, [packetSession1]);
  assert.equal(sanitizedS1.primaryFinding, null, 'primaryFinding must be null when observation has only placeholder and punctuation');
  assert.equal(sanitizedS1.recommendation, null, 'recommendation must be null when dependent primaryFinding becomes null');
  assert.ok(sanitizedS1.limitations.some((l) => l.includes('mechanism is unavailable')), 'limitations must state explicit unknown mechanism');
  // Sanitized Session 1 alone is valid as an explicit unknown finding
  const valS1 = validateKeySessionAnalysis(audit, sanitizedS1, [packetSession1]);
  assert.equal(valS1.valid, true, `Session 1 with null finding must be valid as explicit unknown: ${valS1.errors.join('; ')}`);

  // Session 2 is an independent legitimate session
  const candidateSession2 = {
    sessionId: 'session-2',
    auditFingerprint: fingerprint,
    taskContext: 'Independent legitimate task context.',
    primaryFinding: {
      observation: 'Independent valid observation in session 2.',
      interpretation: 'Independent valid interpretation in session 2.',
      evidenceIds: [turn2EvidenceId],
      support: 'strong',
      alternativeExplanations: ['Alternative legitimate reason.'],
    },
    recommendation: {
      action: 'Independent valid action.',
      rationale: 'Independent valid rationale.',
      applicability: 'All tasks.',
      tradeoff: null,
      verification: 'Independent verification check.',
      targetEvidenceIds: [turn2EvidenceId],
    },
    evidenceRead: { turnIds: ['turn-2'], selectionReason: 'top-token turn', unreadScope: 'none' },
    limitations: ['Independent limitation.'],
  };
  const packetSession2 = {
    sessionId: 'session-2',
    turnIds: ['turn-2'],
    selectionReason: 'top-token turn',
    unreadScope: 'none',
    scope: audit.scope,
    items: [{ kind: 'assistant', content: 'Short assistant text without overlap.' }],
  };
  const { sanitized: sanitizedS2 } = sanitizeKeySessionAnalysis(candidateSession2, [packetSession2]);
  assert.ok(sanitizedS2.primaryFinding !== null, 'Session 2 primaryFinding must be preserved');
  assert.ok(sanitizedS2.recommendation !== null, 'Session 2 recommendation must be preserved');
  const valS2 = validateKeySessionAnalysis(audit, sanitizedS2, [packetSession2]);
  assert.equal(valS2.valid, true, `Session 2 must remain valid: ${valS2.errors.join('; ')}`);

  // --- AC-4: Raw/hash/diagnostics, idempotence, and single HTML rendering proof ---
  // Diagnostics check: diagnostics only contain code, fieldPath, count; NEVER verbatim excerpt
  const diagString = JSON.stringify(redactions1);
  assert.equal(diagString.includes(excerpt80), false, 'Diagnostics must not contain raw sensitive excerpt');
  for (const diag of redactions1) {
    assert.equal(diag.code, 'RAW_EVIDENCE_REDACTED');
    assert.equal(typeof diag.fieldPath, 'string');
    assert.equal(typeof diag.count, 'number');
  }

  // Idempotence check: repeating sanitize on already sanitized produces identical result with 0 redactions
  const { sanitized: idempotentSanitized, redactions: idempotentRedactions } = sanitizeKeySessionAnalysis(sanitized1, [packetSession1]);
  assert.equal(idempotentRedactions.length, 0, 'Re-sanitizing already sanitized analysis must produce 0 redactions');
  assert.deepEqual(idempotentSanitized, sanitized1, 'Re-sanitizing must be idempotent');

  // HTML rendering proof: verify HTML does NOT reproduce sensitive excerpt and DOES contain redaction placeholder
  const htmlOutput = renderHtml(
    audit,
    'en-US',
    {
      auditFingerprint: fingerprint,
      audit,
      reportSynthesis: null,
      keySessionAnalyses: [sanitized1, sanitizedS2],
    },
  );
  assert.equal(htmlOutput.includes(excerpt80), false, 'Rendered HTML must NOT contain sensitive excerpt');
  assert.ok(htmlOutput.includes('[已移除直接引用的历史内容]'), 'Rendered HTML must contain redaction placeholder');
  assert.ok(htmlOutput.includes('Independent legitimate task context'), 'Rendered HTML must contain preserved session 2 content');
});
