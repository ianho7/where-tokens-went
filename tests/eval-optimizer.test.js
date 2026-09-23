const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const cliPath = path.resolve(__dirname, '..', 'dist', 'src', 'cli.js');
function runCli(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { cwd: path.resolve(__dirname, '..'), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject); child.once('close', (code) => resolve({ code, stdout, stderr })); child.stdin.end(input);
  });
}

test('review rejects a legacy baseline without Host Agent provenance', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-optimizer-test-'));
  try {
    const baselineDir = path.join(root, 'baseline'); const candidateDir = path.join(root, 'candidate'); const artifactDir = path.join(root, 'review');
    const common = ['eval', 'trial', '--case', 'evals/cases/skill-insights-capability.json', '--bundle-version', '0.1.0+fixture', '--experiment', 'fixture-experiment', '--attempt', '1'];
    const rawBaseline = JSON.stringify({ snapshotId: 'fixture-skill-snapshot-v1', insights: [] });
    const rawCandidate = JSON.stringify({ snapshotId: 'fixture-skill-snapshot-v1', insights: [], contentProfiles: [] });
    const baseline = await runCli([...common, '--artifact-dir', baselineDir, '--prompt-hash', 'a'.repeat(64), '--role', 'baseline', '--model', 'fixture'], rawBaseline);
    const candidate = await runCli([...common, '--artifact-dir', candidateDir, '--prompt-hash', 'b'.repeat(64), '--role', 'candidate', '--model', 'fixture'], rawCandidate);
    assert.equal(baseline.code, 0, baseline.stderr); assert.equal(candidate.code, 0, candidate.stderr);
    const experimentPath = path.join(root, 'experiment.json');
    await writeFile(experimentPath, JSON.stringify({
      version: 1, id: 'fixture-experiment', lane: 'skill-insights', baselinePromptHash: 'a'.repeat(64), candidatePromptHash: 'b'.repeat(64),
      targetFailure: 'fixture', hypothesis: 'bounded content contrast improves grounding', singleChange: 'one bounded change', targetDimension: 'content_contrast', mustNotRegress: [], maxRevisions: 3,
      tokenBudget: 100, timeBudgetMs: 1000, caseIds: ['skill-insights-capability', 'generic-finding'], modelConfig: JSON.parse(baseline.stdout).trial.modelConfig, status: 'review', createdAt: new Date().toISOString(),
    }));
    const reviewed = await runCli(['eval', 'review', '--experiment', experimentPath, '--baseline-dir', baselineDir, '--candidate-dir', candidateDir, '--artifact-dir', artifactDir, '--reviewer', 'maintainer']);
    assert.equal(reviewed.code, 2);
    assert.equal(reviewed.stdout, '');
    assert.match(reviewed.stderr, /EVAL_STATE_REQUIRED:review/);
    assert.equal(require('node:fs').existsSync(path.join(path.resolve(__dirname, '..'), 'prompts', 'skill-insights.md')), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
