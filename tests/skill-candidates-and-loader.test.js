const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  calculatePercentileLinear,
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

test('calculatePercentileLinear matches mathematical definition with linear interpolation', () => {
  const vals = [1.0, 1.0, 1.0, 2.0, 10.0];
  assert.equal(calculatePercentileLinear(vals, 0.5), 1.0);
  assert.equal(calculatePercentileLinear(vals, 0.75), 2.0);
  assert.equal(calculatePercentileLinear(vals, 0.9), 6.8);
  assert.equal(calculatePercentileLinear(vals, 1.0), 10.0);
  assert.equal(calculatePercentileLinear([], 0.5), 0);
  assert.equal(calculatePercentileLinear([5.5], 0.9), 5.5);
});

test('deriveSkillMetrics calculates distribution context and global topology ratios', () => {
  const skills = [
    mockSkill('family-a-codex', 100, 10), // callsPerTask = 10
    mockSkill('family-a-claude', 20, 10), // callsPerTask = 2
    mockSkill('standalone-tool', 8, 8),    // callsPerTask = 1
    mockSkill('low-freq-1', 4, 4),        // callsPerTask = 1
    mockSkill('low-freq-2', 1, 1),        // callsPerTask = 1, single use
  ];

  const { global, perSkill } = deriveSkillMetrics(skills, 20);
  assert.equal(global.totalSkillsUsed, 5);
  assert.equal(global.totalSkillCalls, 133);

  // Distribution of callsPerTask: [1, 1, 1, 2, 10]
  assert.equal(global.callsPerTaskDistribution.median, 1.0);
  assert.equal(global.callsPerTaskDistribution.p75, 2.0);
  assert.equal(global.callsPerTaskDistribution.p90, 6.8);
  assert.equal(global.callsPerTaskDistribution.max, 10.0);

  // Global shares
  // Top 4 calls: 100 + 20 + 8 + 4 = 132 / 133 = 0.9925
  assert.equal(global.top4CallShare, 0.9925);
  // lowFrequency (<=5 calls): low-freq-1 (4) and low-freq-2 (1) = 2 / 5 = 0.4
  assert.equal(global.lowFrequencySkillCount, 2);
  assert.equal(global.lowFrequencyCallCount, 5);
  assert.equal(global.lowFrequencySkillShare, 0.4);
  // lowFrequency calls: (4 + 1) / 133 = 5 / 133 = 0.0376
  assert.equal(global.lowFrequencyCallShare, 0.0376);
  // singleUse: 1 / 5 = 0.2
  assert.equal(global.singleUseSkillShare, 0.2);

  // Dominant family candidate grouping
  assert.ok(global.dominantFamily);
  assert.equal(global.dominantFamily.groupId, 'family-a');
  assert.equal(global.dominantFamily.memberSkillIds.length, 2);
  assert.equal(global.dominantFamily.callShare, Math.round((120 / 133) * 10000) / 10000);
});

test('deriveSkillMetrics computes family metrics from the full population, including the base skill', () => {
  const skills = [
    mockSkill('where-tokens-went', 80, 12),
    mockSkill('where-tokens-went-claude', 10, 4),
    mockSkill('where-tokens-went-codex', 183, 17),
    mockSkill('where-tokens-went-codex-codex', 1, 1),
    mockSkill('unrelated-skill', 189, 30),
  ];

  const { global } = deriveSkillMetrics(skills, 64);
  const family = global.familyMetrics.find((entry) => entry.groupId === 'where-tokens-went');

  assert.ok(family, 'The base Skill name must define the canonical family');
  assert.deepEqual(family.memberSkillIds.sort(), [
    'where-tokens-went',
    'where-tokens-went-claude',
    'where-tokens-went-codex',
    'where-tokens-went-codex-codex',
  ].sort());
  assert.equal(family.totalCalls, 274);
  assert.equal(family.memberCount, 4);
  assert.equal(family.callShare, 0.5918);
  assert.equal(global.dominantFamily.groupId, 'where-tokens-went');
});

test('deriveSkillMetrics leaves callsPerTask unavailable when tasks are zero', () => {
  const { perSkill } = deriveSkillMetrics([mockSkill('zero-task', 10, 0)], 10);
  assert.equal(perSkill.get('zero-task').callsPerTask, null);
});

test('selectSkillCandidates implements family-aware diverse sampling with quotas and max 5 ceiling', () => {
  const skills = [
    mockSkill('family-main-codex', 180, 18),  // dominant group, callsPerTask = 10
    mockSkill('family-main-claude', 50, 20),  // dominant group, callsPerTask = 2.5
    mockSkill('family-main-extra', 10, 10),   // dominant group (3rd member, must be throttled!)
    mockSkill('kami', 39, 8),                 // non-dominant high-frequency, callsPerTask = 4.875
    mockSkill('outlier-helper', 9, 2),        // non-dominant callsPerTask outlier = 4.5
    mockSkill('spare-skill', 3, 3),           // diversity candidate
  ];

  const result = selectSkillCandidates(skills, 30);
  assert.ok(result.candidates.length <= 5, 'Must not exceed 5 unique skills');

  const names = result.candidates.map(c => c.skillName);
  // Dominant group must not occupy more than 2 slots
  const domMembersInCandidates = names.filter(n => n.startsWith('family-main-'));
  assert.equal(domMembersInCandidates.length, 2, 'Dominant family must occupy at most 2 slots');

  // Must include top non-dominant skill
  assert.ok(names.includes('kami'), 'Must include top non-dominant high frequency skill');

  // Must include non-dominant callsPerTask outlier when present
  assert.ok(names.includes('outlier-helper'), 'Must include non-dominant outlier');

  for (const candidate of result.candidates) {
    assert.equal(typeof candidate.signals.calls, 'number', 'Candidate signals must include calls');
    assert.equal(typeof candidate.signals.tasks, 'number', 'Candidate signals must include tasks');
  }
});

test('selectSkillCandidates does not force fill 5 slots when candidates are sparse', () => {
  const skills = [
    mockSkill('solo-skill', 10, 2),
  ];

  const result = selectSkillCandidates(skills, 5);
  assert.equal(result.candidates.length, 1, 'Must not force fill empty slots when only 1 candidate exists');
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

test('loadSkillSnapshot produces immutable snapshot with distributionContext and metadata', async () => {
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
    ];

    const globalUsage = {
      totalSkillsUsed: 1,
      totalSkillCalls: 10,
      totalTasks: 2,
      callsPerTaskDistribution: { median: 5, p75: 5, p90: 5, max: 5 },
      top4CallShare: 1,
      lowFrequencySkillShare: 0,
      lowFrequencyCallShare: 0,
      singleUseSkillShare: 0,
      dominantFamily: null,
    };

    const snapshot = await loadSkillSnapshot('codex', cwd, candidates, 'test-fingerprint', globalUsage);
    assert.equal(snapshot.auditFingerprint, 'test-fingerprint');
    assert.match(snapshot.snapshotId, /^[a-f0-9]{64}$/);
    assert.equal(snapshot.distributionContext.median, 5);
    assert.equal(snapshot.selectedSkills.length, 1);
    assert.equal(snapshot.selectedCandidates.length, 1);

    const demo = snapshot.selectedSkills.find(s => s.skillName === 'demo-skill');
    assert.ok(demo);
    assert.equal(demo.contentState, 'available');
    assert.ok(demo.skillMdBytes > 0);
    assert.equal(demo.referenceCount, 1);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('report-run prepare creates skill-snapshot.json with distributionContext and updates manifest', async () => {
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
    assert.ok(snapshot.distributionContext);
    assert.equal(snapshot.auditFingerprint, manifest.auditFingerprint);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
