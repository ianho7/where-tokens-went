const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const {
  isAcceptedBaseline,
  isEvalCase,
  isEvalRubric,
  summarizeScores,
  reviewExperiment,
} = require('../dist/src/eval-contract.js');

const repoRoot = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

test('all initial failure-driven Cases and Rubrics satisfy the executable contract', () => {
  const cases = fs.readdirSync(path.join(repoRoot, 'evals', 'cases')).map((name) => readJson(path.join('evals', 'cases', name)));
  assert.equal(cases.length, 12);
  assert.ok(cases.every(isEvalCase));
  assert.ok(cases.some((item) => item.originFailure.includes('final projection')));
  assert.ok(cases.some((item) => item.originFailure.includes('opaque')));
  assert.ok(cases.some((item) => item.originFailure.includes('Evidence')));
  assert.ok(cases.some((item) => item.originFailure.includes('metric')));
  assert.ok(cases.some((item) => item.originFailure.includes('partial')));
  const skillCase = cases.find((item) => item.lane === 'skill-insights');
  assert.equal(skillCase.goodReference, 'evals/references/skill-good-reference.json');
  assert.equal(skillCase.badReference, 'evals/references/skill-bad-reference.json');
  const correctedSkillCase = cases.find((item) => item.id === 'skill-insights-real-aha-v2');
  assert.match(correctedSkillCase.expectedOutcome, /three target Aha roles/);
  assert.ok(correctedSkillCase.deterministicExpectations.some((item) => item.includes('explicit unknown boundary')));
  const rubrics = fs.readdirSync(path.join(repoRoot, 'evals', 'rubrics')).map((name) => readJson(path.join('evals', 'rubrics', name)));
  assert.equal(rubrics.length, 4);
  assert.ok(rubrics.every(isEvalRubric));
});

test('benchmark aggregation preserves unknown quality and variance', () => {
  const makeTrial = (id, quality, contractStatus = 'passed') => ({
    version: 1, id, caseId: id, lane: 'skill-insights', role: 'candidate',
    promptHash: 'a'.repeat(64), bundleVersion: '0.1.0+fixture', inputHash: 'b'.repeat(64),
    modelConfig: { provider: 'fixture', model: 'fixture', temperature: null, comparisonKey: 'fixture' },
    outputHash: null, outputArtifact: null, validationArtifact: `validation/${id}.json`,
    contractStatus, quality, durationMs: 10, tokenCount: 20, toolCallCount: 0,
    transcriptRef: null, privacy: 'redacted', createdAt: new Date().toISOString(),
  });
  const summary = summarizeScores([makeTrial('a', { grounding: 1 }), makeTrial('b', { grounding: 'unknown' })]);
  assert.equal(summary.passRate, 1);
  assert.equal(summary.dimensions.grounding.unknownCount, 1);
  assert.equal(summary.dimensions.grounding.stddev, 0);
  assert.deepEqual(summary.failures, []);
});

test('promotion review refuses a candidate without independent review or improvement', () => {
  const trial = {
    version: 1, id: 'baseline', caseId: 'case', lane: 'skill-insights', role: 'baseline',
    promptHash: 'a'.repeat(64), bundleVersion: '0.1.0+fixture', inputHash: 'b'.repeat(64),
    modelConfig: { provider: 'fixture', model: 'fixture', temperature: null, comparisonKey: 'fixture' },
    outputHash: null, outputArtifact: null, validationArtifact: 'validation/a.json',
    contractStatus: 'passed', quality: { grounding: 1 }, durationMs: 10, tokenCount: 20, toolCallCount: 0,
    transcriptRef: null, privacy: 'redacted', createdAt: new Date().toISOString(),
  };
  const experiment = {
    version: 1, id: 'exp', lane: 'skill-insights', baselinePromptHash: 'a'.repeat(64), candidatePromptHash: 'c'.repeat(64),
    targetFailure: 'fixture', hypothesis: 'fixture', singleChange: 'fixture', targetDimension: 'content_contrast', mustNotRegress: [], maxRevisions: 3,
    tokenBudget: 100, timeBudgetMs: 1000, caseIds: ['case'], modelConfig: trial.modelConfig, status: 'review', createdAt: new Date().toISOString(),
  };
  const review = reviewExperiment(experiment, [trial], [{ ...trial, id: 'candidate', role: 'candidate' }], 'review.json');
  assert.equal(review.approved, false);
  assert.equal(review.conclusion, 'inconclusive');
  assert.equal(review.reviewer, null);
});

test('stale accepted baseline is rejected until current-bundle bootstrap completes', () => {
  const baselinePath = path.join(repoRoot, 'evals', 'baselines', 'accepted-baseline.json');
  assert.equal(fs.existsSync(baselinePath), true);
  const baseline = readJson(path.join('evals', 'baselines', 'accepted-baseline.json'));
  assert.equal(isAcceptedBaseline(baseline), false);
  assert.ok(baseline.trials.every((trial) => trial.generationRecord && trial.outputArtifact));
});

test('held-out Skill Insights input is physically distinct and combined generation reuse is rejected', () => {
  const development = readJson(path.join('evals', 'cases', 'skill-insights-capability-v2.json'));
  const heldOut = readJson(path.join('evals', 'cases', 'skill-insights-heldout-v2.json'));
  assert.notEqual(development.inputHash, heldOut.inputHash);
  assert.notEqual(fs.readFileSync(path.join(repoRoot, development.inputArtifact), 'utf8'), fs.readFileSync(path.join(repoRoot, heldOut.inputArtifact), 'utf8'));
  const record = {
    version: 1, kind: 'host-agent-generation', executionId: 'same-execution', caseId: 'case', lane: 'skill-insights', role: 'baseline',
    inputHash: 'b'.repeat(64), promptHash: 'a'.repeat(64), outputHash: 'c'.repeat(64), modelComparisonKey: 'host-agent',
    producerContext: { role: 'generator', contextId: 'generator-1', host: 'host' },
    observed: { startedAt: '2026-09-20T00:00:00.000Z', endedAt: '2026-09-20T00:00:01.000Z', usage: null },
    sourceReference: 'record.json', sourceReferenceHash: 'd'.repeat(64),
  };
  const trial = {
    version: 1, id: 'trial', caseId: 'case', lane: 'skill-insights', role: 'baseline', promptHash: 'a'.repeat(64), bundleVersion: 'fixture', inputHash: 'b'.repeat(64),
    modelConfig: { provider: 'host-agent', model: 'fixture', temperature: null, comparisonKey: 'host-agent' }, outputHash: 'c'.repeat(64), outputArtifact: 'output.json', validationArtifact: 'validation.json',
    contractStatus: 'passed', quality: {}, qualityEvidence: {}, durationMs: null, tokenCount: null, toolCallCount: 0, transcriptRef: null, privacy: 'redacted', createdAt: new Date().toISOString(), experimentId: 'exp', attempt: 1, generationRecord: record,
  };
  const experiment = { version: 1, id: 'exp', lane: 'skill-insights', baselinePromptHash: 'a'.repeat(64), candidatePromptHash: 'e'.repeat(64), targetFailure: 'fixture', hypothesis: 'fixture', singleChange: 'fixture', targetDimension: 'content_contrast', mustNotRegress: [], maxRevisions: 3, tokenBudget: 100, timeBudgetMs: 1000, caseIds: ['case'], modelConfig: trial.modelConfig, status: 'review', createdAt: new Date().toISOString() };
  const review = reviewExperiment(experiment, [trial], [{ ...trial, id: 'candidate', role: 'candidate' }], 'review.json', 'reviewer', true, {
    acceptedBaseline: { version: 1, id: 'accepted', acceptedAt: new Date().toISOString(), productVersion: 'fixture', bundleVersion: 'fixture', auditSchemaVersion: 1, promptHashes: { 'report-synthesis': 'a'.repeat(64), 'key-session-analysis': 'a'.repeat(64), 'skill-insights': 'a'.repeat(64) }, runtimeHash: 'a'.repeat(64), modelConfig: trial.modelConfig, caseIds: ['case'], trials: [trial], knownVariance: {}, budgetEvidencePolicy: 'required', tokenMetric: 'total_tokens', budgetLimitations: [], privacy: 'redacted' },
    cases: [{ version: 1, id: 'case', lane: 'skill-insights', class: 'capability', split: 'regression', inputArtifact: 'input.json', inputHash: 'b'.repeat(64), expectedOutcome: 'fixture', deterministicExpectations: ['fixture'], rubricId: 'rubric', privacy: 'redacted' }],
    rubrics: [{ version: 1, id: 'rubric', lane: 'skill-insights', dimensions: [{ id: 'snapshot_binding', description: 'fixture' }, { id: 'content_contrast', description: 'fixture' }, { id: 'decision_delta', description: 'fixture' }, { id: 'uncertainty', description: 'fixture' }] }],
    reviewEvidenceHash: 'f'.repeat(64), qualityGraderRecordHash: '1'.repeat(64), optimizerRecordHash: '2'.repeat(64), minimumTrialsPerCase: 1, minimumImprovementDelta: 0,
  });
  assert.ok(review.gateErrors.some((error) => error.startsWith('PROMOTION_COMBINED_GENERATION_RECORD_DUPLICATE')));
});
