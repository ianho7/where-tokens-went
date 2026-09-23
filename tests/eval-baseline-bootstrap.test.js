const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, readFile, writeFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { bootstrapAcceptedBaseline } = require('../dist/src/eval-baseline.js');

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

test('baseline bootstrap atomically replaces invalid baseline and preserves invalidation metadata', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-baseline-bootstrap-'));
  try {
    const baselinePath = path.join(root, 'accepted-baseline.json');
    const previous = JSON.stringify({ version: 1, id: 'legacy-pseudo-baseline', trials: [{ outputHash: 'same-output' }] }) + '\n';
    await writeFile(baselinePath, previous);
    const candidatePrompt = 'candidate prompt must remain outside prompts/';
    const candidatePath = path.join(root, 'candidate.md');
    await writeFile(candidatePath, candidatePrompt);
    const previousHash = sha256(previous);
    const trial = {
      version: 1, id: 'trial-1', caseId: 'case-1', lane: 'skill-insights', role: 'baseline',
      promptHash: 'c'.repeat(64), bundleVersion: '0.1.0+fixture', inputHash: 'e'.repeat(64),
      modelConfig: { provider: 'codex', model: 'fixture', temperature: null, comparisonKey: 'codex/fixture' },
      outputHash: 'f'.repeat(64), outputArtifact: 'trial-1/output.raw.json', validationArtifact: 'trial-1/validation.json',
      contractStatus: 'passed', quality: { snapshot_binding: 1, content_contrast: 1, decision_delta: 1, uncertainty: 1 },
      qualityEvidence: { snapshot_binding: ['fixture'], content_contrast: ['fixture'], decision_delta: ['fixture'], uncertainty: ['fixture'] },
      durationMs: null, tokenCount: null, toolCallCount: null, transcriptRef: null, privacy: 'redacted',
      createdAt: '2026-09-20T14:00:00.000Z', experimentId: 'bootstrap', attempt: 1,
      generationRecord: {
        version: 1, kind: 'host-agent-generation', executionId: 'execution-1', caseId: 'case-1', lane: 'skill-insights', role: 'baseline',
        inputHash: 'e'.repeat(64), promptHash: 'c'.repeat(64), outputHash: 'f'.repeat(64), modelComparisonKey: 'codex/fixture',
        producerContext: { role: 'generator', contextId: 'generator-1', host: 'codex' },
        observed: { startedAt: '2026-09-20T13:00:00.000Z', endedAt: '2026-09-20T13:00:01.000Z', usage: null },
        codexProvenance: { harness: 'codex', rolloutPath: 'C:/Users/admin/.codex/sessions/fixture.jsonl', rolloutHash: '1'.repeat(64), sessionId: 'session-1', threadId: 'thread-1', turnId: 'turn-1', responseItemId: 'item-1', responseItemOrdinal: 1, tokenUsageRecordOrdinal: 2, tokenEventOrdinal: 3, responseId: 'response-1', startedAt: '2026-09-20T13:00:00.000Z', endedAt: '2026-09-20T13:00:01.000Z', usage: null, tokenMetric: 'total_tokens', tokenValue: null, outputHash: 'f'.repeat(64) },
        sourceReference: 'C:/Users/admin/.codex/sessions/fixture.jsonl', sourceReferenceHash: '1'.repeat(64),
      },
    };
    const review = {
      version: 1,
      kind: 'accepted-baseline-bootstrap-review',
      conclusion: 'accepted',
      reviewedTrialIds: ['trial-1'],
      blindMapHash: '1'.repeat(64),
      gradesHash: '2'.repeat(64),
      varianceHash: '3'.repeat(64),
      reviewEvidenceHash: '4'.repeat(64),
      reviewerRecordHash: '5'.repeat(64),
      qualityGraderRecordHash: '6'.repeat(64),
    };
    const result = await bootstrapAcceptedBaseline({
      outputPath: baselinePath,
      previousBaselinePath: baselinePath,
      previousBaselineHash: previousHash,
      invalidationReason: 'legacy baseline used caller-authored output and repeated execution metadata',
      review,
      currentPromptHashes: {
        'report-synthesis': 'a'.repeat(64),
        'key-session-analysis': 'b'.repeat(64),
        'skill-insights': 'c'.repeat(64),
      },
      candidatePromptPath: candidatePath,
      candidatePromptHash: sha256(candidatePrompt),
      baseline: {
        version: 1,
        id: 'accepted-baseline-bootstrap-1',
        acceptedAt: '2026-09-20T14:00:00.000Z',
        productVersion: '0.1.0',
        bundleVersion: '0.1.0+fixture',
        auditSchemaVersion: 1,
        promptHashes: {
          'report-synthesis': 'a'.repeat(64),
          'key-session-analysis': 'b'.repeat(64),
          'skill-insights': 'c'.repeat(64),
        },
        runtimeHash: 'd'.repeat(64),
        modelConfig: { provider: 'codex', model: 'fixture', temperature: null, comparisonKey: 'codex/fixture' },
        caseIds: ['case-1'],
        trials: [trial],
      knownVariance: { 'case-1': 'independent trial variance recorded' },
      budgetEvidencePolicy: 'required', tokenMetric: 'total_tokens', budgetLimitations: [],
      privacy: 'redacted',
      },
    });
    assert.equal(result.bootstrap.previousBaselineHash, previousHash);
    assert.equal(result.bootstrap.invalidationReason, 'legacy baseline used caller-authored output and repeated execution metadata');
    const persisted = JSON.parse(await readFile(baselinePath, 'utf8'));
    assert.equal(persisted.bootstrap.previousBaselineHash, previousHash);
    assert.equal(persisted.bootstrap.reviewHashes.reviewEvidenceHash, review.reviewEvidenceHash);
    assert.equal(await readFile(candidatePath, 'utf8'), candidatePrompt);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('baseline bootstrap refuses candidate Prompt mutation and missing independent review binding', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-baseline-bootstrap-reject-'));
  try {
    const baselinePath = path.join(root, 'accepted-baseline.json');
    const previous = JSON.stringify({ version: 1, id: 'legacy' }) + '\n';
    await writeFile(baselinePath, previous);
    const previousHash = sha256(previous);
    await assert.rejects(
      bootstrapAcceptedBaseline({
        outputPath: baselinePath,
        previousBaselinePath: baselinePath,
        previousBaselineHash: previousHash,
        invalidationReason: 'invalid',
        review: { version: 1, kind: 'accepted-baseline-bootstrap-review', conclusion: 'accepted' },
        currentPromptHashes: { 'report-synthesis': 'a'.repeat(64), 'key-session-analysis': 'b'.repeat(64), 'skill-insights': 'c'.repeat(64) },
        candidatePromptPath: path.join(root, 'candidate.md'),
        candidatePromptHash: 'd'.repeat(64),
        baseline: { version: 1, id: 'new', acceptedAt: '2026-09-20T14:00:00.000Z', productVersion: '0.1.0', bundleVersion: 'fixture', auditSchemaVersion: 1, promptHashes: { 'report-synthesis': 'a'.repeat(64), 'key-session-analysis': 'b'.repeat(64), 'skill-insights': 'c'.repeat(64) }, runtimeHash: 'e'.repeat(64), modelConfig: { provider: 'codex', model: 'fixture', temperature: null, comparisonKey: 'codex/fixture' }, caseIds: ['case-1'], trials: [], knownVariance: {}, privacy: 'redacted' },
      }),
      /EVAL_BASELINE_BOOTSTRAP_REVIEW_INVALID/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
