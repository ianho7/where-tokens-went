const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdir, mkdtemp, readdir, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const cliPath = path.resolve(__dirname, '..', 'dist', 'src', 'cli.js');

function runCli(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { cwd: path.resolve(__dirname, '..'), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

test('Skill Insights Prompt Lab reuses one frozen Snapshot for baseline and candidate trials', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-eval-lab-test-'));
  try {
    const artifactDir = path.join(root, 'trials');
    const raw = JSON.stringify({ snapshotId: 'fixture-skill-snapshot-v1', insights: [] });
    const common = ['eval', 'trial', '--case', 'evals/cases/skill-insights-capability.json', '--prompt-hash', 'a'.repeat(64), '--bundle-version', '0.1.0+fixture', '--role'];
    const baseline = await runCli([...common, 'baseline', '--artifact-dir', artifactDir, '--model', 'fixture'], raw);
    assert.equal(baseline.code, 2, baseline.stderr);
    const candidate = await runCli([...common, 'candidate', '--artifact-dir', artifactDir, '--model', 'fixture'], raw);
    assert.equal(candidate.code, 2, candidate.stderr);
    const baselineTrial = JSON.parse(baseline.stdout).trial;
    const candidateTrial = JSON.parse(candidate.stdout).trial;
    assert.equal(baselineTrial.inputHash, candidateTrial.inputHash);
    assert.equal(baselineTrial.modelConfig.comparisonKey, candidateTrial.modelConfig.comparisonKey);
    assert.equal(baselineTrial.contractStatus, 'blocked');
    assert.equal(candidateTrial.contractStatus, 'blocked');
    assert.equal((await readdir(root)).includes('report.html'), false);
    const wrong = await runCli([...common, 'candidate', '--artifact-dir', path.join(root, 'wrong')], JSON.stringify({ snapshotId: 'wrong', insights: [] }));
    assert.equal(wrong.code, 2);
    const wrongTrial = JSON.parse(wrong.stdout).trial;
    assert.match(await readFile(wrongTrial.validationArtifact, 'utf8'), /EVAL_SNAPSHOT_MISMATCH/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('promotion-critical trials require a bound Host Agent generation record and ignore self-reported timing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-generation-provenance-test-'));
  const previousCodexHome = process.env.CODEX_HOME;
  try {
    const artifactDir = path.join(root, 'trials');
    const statePath = path.join(root, 'state.json');
    const stateStart = await runCli(['eval', 'state', '--state', statePath, '--experiment', 'provenance-fixture', '--action', 'freeze']);
    assert.equal(stateStart.code, 0, stateStart.stderr);
    const raw = JSON.stringify({ snapshotId: 'fixture-skill-snapshot-v2', insights: [{
      id: 'fixture-insight', kind: 'usage', candidateType: 'high_usage_strong_delta', scope: 'skill', subject: { skillId: 'where-tokens-went' },
      title: 'Usage pattern', reveal: { semantic: 'Usage concentrates in the selected Skill.', pattern: 'share_inversion', evidenceRefs: ['global:top4CallShare', 'global:lowFrequencySkillShare', 'global:lowFrequencyCallShare'] }, claimStrength: 'coexistence',
      mentalModelShift: { surface: 'Usage looks broad.', observed: 'A small core carries most calls.' }, decisionDelta: { before: 'Maintain every Skill equally.', after: 'Prioritize the observed core.' },
      observation: 'The selected Skill has a measured call signal.', contrast: 'The global distribution shows concentration.', interpretation: 'The measured usage is concentrated.',
      counterfactual: { ifRemoved: 'The selected usage signal would be lost.', withoutGenericScaffold: 'The concentration pattern remains.' }, conditionalMechanism: null, consequence: 'Prioritize the core.', confidence: 'high',
      evidence: [{ kind: 'global_metric', metric: 'top4CallShare' }, { kind: 'global_metric', metric: 'lowFrequencySkillShare' }, { kind: 'global_metric', metric: 'lowFrequencyCallShare' }],
    }] });
    const noRecord = await runCli([
      'eval', 'trial', '--case', 'evals/cases/skill-insights-capability-v2.json', '--prompt-hash', 'a'.repeat(64),
      '--bundle-version', '0.1.0+fixture', '--role', 'baseline', '--artifact-dir', artifactDir,
      '--model', 'fixture', '--promotion-critical', 'true', '--duration-ms', '999999', '--token-count', '999999', '--state', statePath, '--experiment', 'provenance-fixture',
    ], raw);
    assert.equal(noRecord.code, 2);
    assert.match(noRecord.stderr, /EVAL_GENERATION_PROVENANCE_REQUIRED/);

    const inputPath = path.resolve('evals/fixtures/skill-insights-snapshot-v2.json');
    const inputHash = crypto.createHash('sha256').update(await readFile(inputPath)).digest('hex');
    const outputHash = crypto.createHash('sha256').update(raw).digest('hex');
    process.env.CODEX_HOME = root;
    const sourcePath = path.join(root, 'sessions', 'host-agent-rollout.jsonl');
    await mkdir(path.dirname(sourcePath), { recursive: true });
    const rolloutRecords = [
      { timestamp: '2026-09-20T00:00:00.000Z', ordinal: 1, type: 'session_meta', payload: { id: 'session-fixture-1', originator: 'Codex Desktop', cli_version: 'fixture', model_provider: 'openai' } },
      { timestamp: '2026-09-20T00:00:00.001Z', ordinal: 2, type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-fixture-1' } },
      { timestamp: '2026-09-20T00:00:00.100Z', ordinal: 3, type: 'response_item', payload: { type: 'message', id: 'response-item-fixture-1', role: 'assistant', content: [{ type: 'output_text', text: raw }], internal_chat_message_metadata_passthrough: { turn_id: 'turn-fixture-1' } } },
      { timestamp: '2026-09-20T00:00:00.110Z', ordinal: 4, type: 'token_usage_record', payload: { session_id: 'session-fixture-1', thread_id: 'thread-fixture-1', turn_id: 'turn-fixture-1', response_id: 'response-fixture-1', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } },
      { timestamp: '2026-09-20T00:00:00.123Z', ordinal: 5, type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { total_tokens: 15 } } } },
    ];
    await writeFile(sourcePath, rolloutRecords.map((record) => JSON.stringify(record)).join('\n') + '\n');
    const sourceReferenceHash = crypto.createHash('sha256').update(await readFile(sourcePath)).digest('hex');
    const generationPath = path.join(root, 'generation-record.json');
    await writeFile(generationPath, JSON.stringify({
      version: 1, kind: 'host-agent-generation', executionId: 'host-execution-1', caseId: 'skill-insights-capability-v2', lane: 'skill-insights', role: 'baseline',
      inputHash, promptHash: 'a'.repeat(64), outputHash, modelComparisonKey: 'host-agent/fixture',
      producerContext: { role: 'generator', contextId: 'generator-context-1', host: 'host-agent-fixture' },
      observed: { startedAt: '2026-09-20T00:00:00.000Z', endedAt: '2026-09-20T00:00:00.123Z', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      codexProvenance: { harness: 'codex', rolloutPath: sourcePath, rolloutHash: sourceReferenceHash, sessionId: 'session-fixture-1', threadId: 'thread-fixture-1', turnId: 'turn-fixture-1', responseItemId: 'response-item-fixture-1', responseItemOrdinal: 3, tokenUsageRecordOrdinal: 4, tokenEventOrdinal: 5, responseId: 'response-fixture-1', startedAt: '2026-09-20T00:00:00.000Z', endedAt: '2026-09-20T00:00:00.123Z', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, tokenMetric: 'total_tokens', tokenValue: 15, outputHash },
      sourceReference: sourcePath, sourceReferenceHash,
    }));
    const withRecord = await runCli([
      'eval', 'trial', '--case', 'evals/cases/skill-insights-capability-v2.json', '--prompt-hash', 'a'.repeat(64),
      '--bundle-version', '0.1.0+fixture', '--role', 'baseline', '--artifact-dir', artifactDir,
      '--provider', 'host-agent', '--model', 'fixture', '--comparison-key', 'host-agent/fixture', '--promotion-critical', 'true',
      '--generation-record', generationPath, '--duration-ms', '999999', '--token-count', '999999', '--state', statePath, '--experiment', 'provenance-fixture',
    ], raw);
    assert.equal(withRecord.code, 0, withRecord.stderr);
    const trial = JSON.parse(withRecord.stdout).trial;
    assert.equal(trial.generationRecord.producerContext.role, 'generator');
    assert.equal(trial.durationMs, 122);
    assert.equal(trial.tokenCount, 15);
  } finally {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previousCodexHome;
    await rm(root, { recursive: true, force: true });
  }
});
