const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  deriveSkillMetrics,
  selectSkillCandidates,
  resolveSkillPath,
  loadSkillSnapshot,
} = require('../dist/src/skill-insights.js');

function mockSkill(name, invocations, sessions, tokens = 1000, cost = 0.05) {
  return {
    name,
    state: 'invoked',
    availableSessions: { value: sessions, provenance: 'derived' },
    invocationCount: { value: invocations, provenance: 'derived' },
    sessionCount: { value: sessions, provenance: 'derived' },
    firstObservedAt: { value: '2026-09-15T00:00:00.000Z', provenance: 'reported' },
    lastObservedAt: { value: '2026-09-18T00:00:00.000Z', provenance: 'reported' },
    attributedTokens: { value: tokens, provenance: 'derived' },
    attributedApiEquivalentCost: { value: cost, provenance: 'derived' },
    evidenceCoveragePercent: { value: 100, provenance: 'derived' },
    tools: [],
    totalToolAmplifiedTokens: { value: 0, provenance: 'derived' },
    apiEquivalentCost: { totalCost: { value: cost, provenance: 'derived' } },
    cacheEconomics: {},
    firstRequestBurden: {},
    skills: [],
  };
}

test('deriveSkillMetrics handles empty data and zero tasks gracefully', () => {
  const empty = deriveSkillMetrics([], 0);
  assert.equal(empty.global.totalSkillsUsed, 0);
  assert.equal(empty.global.totalSkillCalls, 0);
  assert.equal(empty.global.topSkillCallShare, 0);
  assert.equal(empty.perSkill.size, 0);

  const single = deriveSkillMetrics([mockSkill('test-skill', 10, 2)], 0);
  assert.equal(single.global.totalSkillsUsed, 1);
  assert.equal(single.global.totalSkillCalls, 10);
  assert.equal(single.global.topSkillCallShare, 1);
  const derived = single.perSkill.get('test-skill');
  assert.ok(derived);
  assert.equal(derived.calls, 10);
  assert.equal(derived.tasks, 2);
  assert.equal(derived.callsPerTask, 5);
  assert.equal(derived.callShare, 1);
});

test('selectSkillCandidates identifies high frequency, high callsPerTask, and family candidates up to max 5', () => {
  const skills = [
    mockSkill('core-alpha', 100, 10), // callShare = 100/250 = 0.40 -> high_frequency
    mockSkill('core-beta', 80, 8),    // callShare = 80/250 = 0.32 -> high_frequency
    mockSkill('repetitive-tool', 30, 2), // callsPerTask = 15.0 >= 3.0 -> high_calls_per_task
    mockSkill('agent-family-codex', 15, 5), // family
    mockSkill('agent-family-claude', 15, 5), // family
    mockSkill('extra-skill-1', 4, 4),
    mockSkill('extra-skill-2', 3, 3),
    mockSkill('extra-skill-3', 2, 2),
    mockSkill('extra-skill-4', 1, 1),
  ];

  const result = selectSkillCandidates(skills, 20);
  assert.ok(result.candidates.length <= 5, 'Must not exceed 5 unique skills');
  assert.ok(result.candidates.length >= 3, 'Must pick top candidates');

  const names = result.candidates.map(c => c.skillName);
  assert.ok(names.includes('core-alpha'), 'Should include top core skill');
  assert.ok(names.includes('repetitive-tool'), 'Should include high callsPerTask skill');

  // Verify long-tail stats in global
  assert.equal(result.global.lowFrequencyThreshold, 5);
  assert.equal(result.global.lowFrequencySkillCount, 4); // 4, 3, 2, 1 calls
  assert.equal(result.global.singleUseSkillCount, 1);
});

test('resolveSkillPath adheres strictly to deterministic search order', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'skill-loader-test-'));
  try {
    const cwd = path.join(tmp, 'workspace');
    await mkdir(path.join(cwd, '.agents', 'skills', 'my-skill'), { recursive: true });
    await writeFile(path.join(cwd, '.agents', 'skills', 'my-skill', 'SKILL.md'), '# My Skill');

    const resolved = await resolveSkillPath('codex', cwd, 'my-skill');
    assert.ok(resolved);
    assert.equal(path.normalize(resolved), path.normalize(path.join(cwd, '.agents', 'skills', 'my-skill', 'SKILL.md')));

    const nonExistent = await resolveSkillPath('codex', cwd, 'unknown-skill-xyz');
    assert.equal(nonExistent, null, 'Non-existent skill must resolve to null without guessing');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('loadSkillSnapshot produces immutable snapshot with references metadata', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'skill-snapshot-test-'));
  try {
    const cwd = path.join(tmp, 'workspace');
    const skillDir = path.join(cwd, '.codex', 'skills', 'demo-skill');
    const refDir = path.join(skillDir, 'references');
    await mkdir(refDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), '# Demo Skill\nThis is a test capability.');
    await writeFile(path.join(refDir, 'guide.md'), 'Extra guide detail');

    const candidates = [
      {
        skillId: 'demo-skill',
        skillName: 'demo-skill',
        candidateTypes: ['high_frequency'],
        signals: { callShare: 0.5 },
      },
      {
        skillId: 'missing-skill',
        skillName: 'missing-skill',
        candidateTypes: ['high_calls_per_task'],
        signals: { callsPerTask: 5 },
      },
    ];

    const snapshot = await loadSkillSnapshot('codex', cwd, candidates, 'test-fingerprint');
    assert.equal(snapshot.auditFingerprint, 'test-fingerprint');
    assert.equal(snapshot.selectedSkills.length, 2);

    const demo = snapshot.selectedSkills.find(s => s.skillName === 'demo-skill');
    assert.ok(demo);
    assert.equal(demo.contentState, 'available');
    assert.ok(demo.skillMdBytes > 0);
    assert.ok(demo.skillMdHash);
    assert.equal(demo.referenceCount, 1);
    assert.deepEqual(demo.referenceFiles, ['guide.md']);

    const missing = snapshot.selectedSkills.find(s => s.skillName === 'missing-skill');
    assert.ok(missing);
    assert.equal(missing.contentState, 'unavailable');
    assert.equal(missing.skillMdContent, null);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('report-run prepare creates skill-snapshot.json and updates manifest', async () => {
  const { spawn } = require('node:child_process');
  const cliPath = path.resolve(__dirname, '..', 'dist', 'src', 'cli.js');
  function runCli(args, env) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cliPath, ...args], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (c) => { stdout += c; });
      child.stderr.on('data', (c) => { stderr += c; });
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, stdout, stderr }));
      child.stdin.end('');
    });
  }

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'prepare-skill-test-'));
  try {
    const runDir = path.join(tmp, 'run');
    const fakeHistoryDir = path.join(tmp, 'history');
    await mkdir(fakeHistoryDir, { recursive: true });

    const prepared = await runCli([
      'report-run', 'prepare',
      '--harness', 'codex',
      '--cwd', tmp,
      '--since', '7d',
      '--locale', 'zh-CN',
      '--run-dir', runDir
    ], { CODEX_HOME: tmp });

    assert.equal(prepared.code, 0, prepared.stderr);
    const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    assert.ok(manifest.artifacts.skillSnapshot, 'skillSnapshot artifact must be in manifest');
    assert.equal(manifest.stageStatus['skill-candidate-select'].status, 'completed');
    assert.equal(manifest.stageStatus['skill-snapshot'].status, 'completed');

    const snapshot = JSON.parse(await readFile(path.join(runDir, 'skill-snapshot.json'), 'utf8'));
    assert.ok(Array.isArray(snapshot.selectedSkills));
    assert.equal(snapshot.auditFingerprint, manifest.auditFingerprint);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
