const assert = require('node:assert/strict');
const { test } = require('node:test');

const { reviewExperiment } = require('../dist/src/eval-contract.js');
const {
  createReportRun,
  finalizeReportRun,
  recordCompletedRunSpan,
  setRunEligibleStages,
  readRunManifest,
} = require('../dist/src/report-run.js');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

function forgedTrial(id, role, score) {
  return {
    version: 1,
    id,
    caseId: 'held-out-case',
    lane: 'skill-insights',
    role,
    promptHash: role === 'baseline' ? '0'.repeat(64) : '1'.repeat(64),
    bundleVersion: '0.1.0+fixture',
    inputHash: '2'.repeat(64),
    modelConfig: { provider: 'fixture', model: 'fixture', temperature: null, comparisonKey: 'fixture' },
    outputHash: null,
    outputArtifact: null,
    validationArtifact: 'hand-written/validation.json',
    contractStatus: 'passed',
    quality: { snapshot_binding: score },
    durationMs: null,
    tokenCount: null,
    toolCallCount: null,
    transcriptRef: null,
    privacy: 'redacted',
    createdAt: new Date().toISOString(),
  };
}

test('P0-A rejects forged promotion evidence: zero baseline hash, same output, missing rubric dimensions, and fake held-out', () => {
  const baseline = forgedTrial('baseline', 'baseline', 0.4);
  const candidate = forgedTrial('candidate', 'candidate', 0.9);
  const experiment = {
    version: 1,
    id: 'forged-promotion',
    lane: 'skill-insights',
    baselinePromptHash: '0'.repeat(64),
    candidatePromptHash: '1'.repeat(64),
    targetFailure: 'fixture',
    hypothesis: 'fixture',
    singleChange: 'fixture',
    targetDimension: 'content_contrast',
    mustNotRegress: ['content_contrast'],
    maxRevisions: 3,
    tokenBudget: 100,
    timeBudgetMs: 1000,
    caseIds: ['held-out-case'],
    modelConfig: baseline.modelConfig,
    status: 'review',
    createdAt: new Date().toISOString(),
  };

  const review = reviewExperiment(experiment, [baseline], [candidate], 'review.json', 'maintainer', true);
  assert.notEqual(review.conclusion, 'eligible');
  assert.equal(review.approved, false);
});

test('P0-B refuses completed finalization without an intact HTML artifact and observed UI dispatch', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-p0-finalize-'));
  try {
    const run = await createReportRun({
      harness: 'codex',
      cwd: null,
      allProjects: true,
      since: new Date('2026-09-19T00:00:00.000Z'),
      until: new Date('2026-09-20T00:00:00.000Z'),
      locale: 'en-US',
    }, root);
    await setRunEligibleStages(run, ['compose']);
    await recordCompletedRunSpan(run, { phase: 'compose', operation: 'fixture-compose', source: 'runner', status: 'completed' });
    await finalizeReportRun(run, 'completed');
    const manifest = await readRunManifest(root);
    assert.notEqual(manifest.status, 'completed');
    assert.notEqual(manifest.deliveryStatus, 'completed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
