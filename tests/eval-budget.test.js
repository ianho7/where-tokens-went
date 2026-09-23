const assert = require('node:assert/strict');
const { test } = require('node:test');

const { evaluateBudget, reviewExperiment } = require('../dist/src/eval-contract.js');

test('budget evaluation distinguishes within, exceeded, and unavailable', () => {
  const within = evaluateBudget({ kind: 'token', value: 80, limit: 100, policy: 'required' });
  assert.equal(within.observation, 'within');
  assert.equal(within.errorCode, null);

  const exceeded = evaluateBudget({ kind: 'token', value: 101, limit: 100, policy: 'required' });
  assert.equal(exceeded.observation, 'exceeded');
  assert.equal(exceeded.errorCode, 'PROMOTION_TOKEN_BUDGET_EXCEEDED');

  const unavailable = evaluateBudget({ kind: 'token', value: null, limit: 100, policy: 'required' });
  assert.equal(unavailable.observation, 'unavailable');
  assert.equal(unavailable.errorCode, 'PROMOTION_TOKEN_USAGE_UNAVAILABLE');
});

test('required and advisory policies preserve unavailable budget semantics', () => {
  const required = evaluateBudget({ kind: 'time', value: null, limit: 2000, policy: 'required' });
  assert.equal(required.observation, 'unavailable');
  assert.equal(required.outcome, 'inconclusive');
  assert.equal(required.errorCode, 'PROMOTION_TIME_USAGE_UNAVAILABLE');

  const advisory = evaluateBudget({ kind: 'time', value: null, limit: 2000, policy: 'advisory' });
  assert.equal(advisory.observation, 'unavailable');
  assert.equal(advisory.outcome, 'advisory');
  assert.equal(advisory.errorCode, 'PROMOTION_TIME_USAGE_UNAVAILABLE');
  assert.notEqual(advisory.errorCode, 'PROMOTION_TIME_BUDGET_EXCEEDED');
});

test('advisory unavailable observations remain limitations instead of gate errors', () => {
  const trial = {
    version: 1, id: 'trial', caseId: 'case', lane: 'skill-insights', role: 'candidate',
    promptHash: 'a'.repeat(64), bundleVersion: 'fixture', inputHash: 'b'.repeat(64),
    modelConfig: { provider: 'fixture', model: 'fixture', temperature: null, comparisonKey: 'fixture' },
    outputHash: null, outputArtifact: null, validationArtifact: 'validation.json', contractStatus: 'passed',
    quality: {}, durationMs: null, tokenCount: null, toolCallCount: null, transcriptRef: null,
    privacy: 'redacted', createdAt: new Date().toISOString(), generationRecord: null,
  };
  const experiment = {
    version: 1, id: 'advisory', lane: 'skill-insights', baselinePromptHash: 'a'.repeat(64), candidatePromptHash: 'c'.repeat(64),
    targetFailure: 'fixture', hypothesis: 'fixture', singleChange: 'fixture', targetDimension: 'content_contrast',
    mustNotRegress: [], maxRevisions: 3, tokenBudget: 100, timeBudgetMs: 1000, budgetEvidencePolicy: 'advisory',
    tokenMetric: 'total_tokens', caseIds: ['case'], modelConfig: trial.modelConfig, status: 'review', createdAt: new Date().toISOString(),
  };
  const review = reviewExperiment(experiment, [trial], [{ ...trial, id: 'candidate', role: 'candidate' }], 'review.json');
  assert.equal(review.tokenBudgetObservation, 'unavailable');
  assert.equal(review.timeBudgetObservation, 'unavailable');
  assert.ok(!review.gateErrors.includes('PROMOTION_TOKEN_USAGE_UNAVAILABLE'));
  assert.ok(!review.gateErrors.includes('PROMOTION_TIME_USAGE_UNAVAILABLE'));
  assert.deepEqual(review.budgetLimitations.sort(), ['PROMOTION_TIME_USAGE_UNAVAILABLE', 'PROMOTION_TOKEN_USAGE_UNAVAILABLE'].sort());
});
