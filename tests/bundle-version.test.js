const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, mkdir, rm, writeFile, symlink } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const { computeBundleDigest } = require('../scripts/bundle-version');
const { verifyInstalledSkill } = require('../scripts/verify-installed-skill');
const { assertRunBundleVersion } = require('../dist/src/report-run.js');

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve(__dirname, '..', 'dist', 'src', 'cli.js'), ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function makeSkill(root, bundleOverride) {
  const skillRoot = path.join(root, 'skills', 'where-tokens-went');
  await mkdir(path.join(skillRoot, 'scripts', 'runtime'), { recursive: true });
  await mkdir(path.join(skillRoot, 'references'), { recursive: true });
  await writeFile(path.join(skillRoot, 'scripts', 'where-tokens-went.js'), '#!/usr/bin/env node\n');
  await writeFile(path.join(skillRoot, 'scripts', 'runtime', 'cli.js'), 'runtime');
  await writeFile(path.join(skillRoot, 'SKILL.md'), 'skill');
  for (const name of ['report-synthesis.md', 'key-session-analysis.md', 'skill-insights.md']) {
    await writeFile(path.join(skillRoot, 'references', name), name);
  }
  const digest = computeBundleDigest(skillRoot);
  const bundle = bundleOverride ?? { productVersion: '0.1.0', bundleVersion: `0.1.0+${digest}`, auditSchemaVersion: 1 };
  await writeFile(path.join(skillRoot, 'bundle-version.json'), JSON.stringify(bundle) + '\n');
  return skillRoot;
}

test('bundle digest is deterministic and changes for same-SemVer content changes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-bundle-test-'));
  try {
    const skillRoot = await makeSkill(root);
    const first = computeBundleDigest(skillRoot);
    const second = computeBundleDigest(skillRoot);
    assert.equal(first, second);
    for (const relative of [
      'scripts/where-tokens-went.js',
      'scripts/runtime/cli.js',
      'SKILL.md',
      'references/report-synthesis.md',
      'references/key-session-analysis.md',
      'references/skill-insights.md',
    ]) {
      const filePath = path.join(skillRoot, relative);
      const original = require('node:fs').readFileSync(filePath, 'utf8');
      await writeFile(filePath, original + ' changed');
      assert.notEqual(first, computeBundleDigest(skillRoot), relative);
      await writeFile(filePath, original);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bundle digest fails when required files are missing or symlink escapes root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-required-test-'));
  try {
    const skillRoot = await makeSkill(root);
    const launcherPath = path.join(skillRoot, 'scripts', 'where-tokens-went.js');
    await rm(launcherPath);
    assert.throws(() => computeBundleDigest(skillRoot), /missing required package file/);
    await writeFile(launcherPath, '#!/usr/bin/env node\n');

    // Create escaping symlink
    const outsideFile = path.join(root, 'outside.txt');
    await writeFile(outsideFile, 'secret');
    const linkPath = path.join(skillRoot, 'escaped-link');
    try {
      await symlink(outsideFile, linkPath);
      assert.throws(() => computeBundleDigest(skillRoot), /escapes package root/);
    } catch (err) {
      if (err.code !== 'EPERM') throw err;
      // On Windows without Developer Mode, symlink may require admin; skip if EPERM
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('installed bundle preflight rejects stale installs and passes after recovery', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-install-test-'));
  try {
    const skillRoot = await makeSkill(root);
    const validBundle = JSON.parse(require('node:fs').readFileSync(path.join(skillRoot, 'bundle-version.json'), 'utf8'));
    for (const parent of ['.agents', '.claude']) await makeSkill(path.join(root, parent), validBundle);
    await writeFile(path.join(root, '.claude', 'skills', 'where-tokens-went', 'bundle-version.json'), JSON.stringify({ ...validBundle, bundleVersion: '0.1.0+stale' }) + '\n');
    assert.throws(() => verifyInstalledSkill(root), /npm run install-local/);
    await writeFile(path.join(root, '.claude', 'skills', 'where-tokens-went', 'bundle-version.json'), JSON.stringify(validBundle) + '\n');
    assert.deepEqual(verifyInstalledSkill(root), validBundle);
    await writeFile(path.join(root, '.agents', 'skills', 'where-tokens-went', 'SKILL.md'), 'tampered');
    assert.throws(() => verifyInstalledSkill(root), /content differs/);
    const runtimePreflight = await runCli(['report-run', 'prepare', '--harness', 'codex', '--cwd', root, '--since', '7d', '--run-dir', path.join(root, 'run')], { WHERE_TOKENS_WENT_SKILL_ROOT: path.join(root, '.agents', 'skills', 'where-tokens-went') });
    assert.equal(runtimePreflight.code, 2);
    assert.match(runtimePreflight.stderr, /content digest mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stale preflight creates no Run artifact', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-preflight-test-'));
  const runDir = path.join(root, 'run');
  try {
    const skillRoot = await makeSkill(root);
    const validBundle = JSON.parse(require('node:fs').readFileSync(path.join(skillRoot, 'bundle-version.json'), 'utf8'));
    await makeSkill(path.join(root, '.agents'), { ...validBundle, bundleVersion: '0.1.0+stale' });
    const result = await runCli([
      'report-run', 'prepare', '--harness', 'codex', '--cwd', root, '--since', '7d', '--run-dir', runDir,
    ], { WHERE_TOKENS_WENT_SKILL_ROOT: path.join(root, '.agents', 'skills', 'where-tokens-went') });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /content digest mismatch/);
    assert.equal(require('node:fs').existsSync(runDir), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('install-skills recovers both Harness installs and runs the same preflight', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-install-recovery-test-'));
  try {
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '..', 'scripts', 'install-skills.js'), root], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(verifyInstalledSkill(root, path.resolve(__dirname, '..')).bundleVersion, JSON.parse(require('node:fs').readFileSync(path.resolve(__dirname, '..', 'skills', 'where-tokens-went', 'bundle-version.json'), 'utf8')).bundleVersion);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a Run with a changed bundle version is rejected without contract rewriting', () => {
  const run = { manifest: { bundleVersion: '0.1.0+old' } };
  assert.throws(() => assertRunBundleVersion(run, '0.1.0+new'), /cannot continue/);
  assert.equal(run.manifest.bundleVersion, '0.1.0+old');
});
