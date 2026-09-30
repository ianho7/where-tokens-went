const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, mkdir, rm, writeFile, readFile, cp, symlink } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const sourceSkillDir = path.join(repoRoot, 'skills', 'where-tokens-went');

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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

test('AC-1: independent Skill package preflights successfully in isolation without repository or second harness', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-ac1-'));
  try {
    const isolatedProject = path.join(root, 'isolated-project');
    const skillRoot = path.join(isolatedProject, '.agents', 'skills', 'where-tokens-went');
    await mkdir(path.dirname(skillRoot), { recursive: true });
    await cp(sourceSkillDir, skillRoot, { recursive: true });

    const launcher = path.join(skillRoot, 'scripts', 'where-tokens-went.js');
    const expectedBundle = JSON.parse(await readFile(path.join(sourceSkillDir, 'bundle-version.json'), 'utf8'));

    // 1. Full clean package preflight passes in an isolated project
    const preflight = await runProcess(process.execPath, [launcher, 'report-run', 'preflight'], {
      cwd: isolatedProject,
      env: { WHERE_TOKENS_WENT_REPO_ROOT: '', WHERE_TOKENS_WENT_SKILL_ROOT: '' },
    });
    assert.equal(preflight.code, 0, preflight.stderr);
    const preflightJson = JSON.parse(preflight.stdout);
    assert.equal(preflightJson.status, 'passed');
    assert.equal(preflightJson.productVersion, expectedBundle.productVersion);
    assert.equal(preflightJson.bundleVersion, expectedBundle.bundleVersion);
    assert.equal(preflightJson.auditSchemaVersion, expectedBundle.auditSchemaVersion);

    // 2. Tampering launcher fails preflight with digest mismatch and reinstall hint (not install-local)
    const launcherOriginal = await readFile(launcher, 'utf8');
    await writeFile(launcher, launcherOriginal + '\n// tampered\n');
    const tamperedLauncher = await runProcess(process.execPath, [launcher, 'report-run', 'preflight'], {
      cwd: isolatedProject,
      env: { WHERE_TOKENS_WENT_REPO_ROOT: '', WHERE_TOKENS_WENT_SKILL_ROOT: '' },
    });
    assert.equal(tamperedLauncher.code, 2);
    assert.match(tamperedLauncher.stderr, /content digest mismatch/);
    assert.match(tamperedLauncher.stderr, /Reinstall the where-tokens-went Skill package/);
    assert.doesNotMatch(tamperedLauncher.stderr, /npm run install-local/);
    await writeFile(launcher, launcherOriginal);

    // 3. Missing required file fails preflight
    const promptPath = path.join(skillRoot, 'references', 'report-synthesis.md');
    const promptOriginal = await readFile(promptPath, 'utf8');
    await rm(promptPath);
    const missingPrompt = await runProcess(process.execPath, [launcher, 'report-run', 'preflight'], {
      cwd: isolatedProject,
      env: { WHERE_TOKENS_WENT_REPO_ROOT: '', WHERE_TOKENS_WENT_SKILL_ROOT: '' },
    });
    assert.equal(missingPrompt.code, 2);
    assert.match(missingPrompt.stderr, /missing required package file/);
    await writeFile(promptPath, promptOriginal);

    // 4. Escaping symlink fails preflight
    const outsideFile = path.join(root, 'leak.txt');
    await writeFile(outsideFile, 'secret');
    const linkPath = path.join(skillRoot, 'escape-link');
    try {
      await symlink(outsideFile, linkPath);
      const escapedPreflight = await runProcess(process.execPath, [launcher, 'report-run', 'preflight'], {
        cwd: isolatedProject,
        env: { WHERE_TOKENS_WENT_REPO_ROOT: '', WHERE_TOKENS_WENT_SKILL_ROOT: '' },
      });
      assert.equal(escapedPreflight.code, 2);
      assert.match(escapedPreflight.stderr, /escapes package root/);
    } catch (err) {
      if (err.code !== 'EPERM') throw err;
      // Windows non-admin symlink skip
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('AC-2: preflight failure happens before Run creation, history read, or price resolution', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-ac2-'));
  try {
    const isolatedProject = path.join(root, 'isolated-project');
    const skillRoot = path.join(isolatedProject, '.agents', 'skills', 'where-tokens-went');
    await mkdir(path.dirname(skillRoot), { recursive: true });
    await cp(sourceSkillDir, skillRoot, { recursive: true });

    const launcher = path.join(skillRoot, 'scripts', 'where-tokens-went.js');
    // Tamper launcher so preflight fails
    await writeFile(launcher, (await readFile(launcher, 'utf8')) + '\n// broken\n');

    const runDir = path.join(root, 'run-dir-must-not-exist');
    const result = await runProcess(process.execPath, [
      launcher,
      'report-run', 'run-all', 'start',
      '--harness', 'codex',
      '--cwd', isolatedProject,
      '--since', '7d',
      '--run-dir', runDir,
    ], {
      cwd: isolatedProject,
      env: { WHERE_TOKENS_WENT_REPO_ROOT: '', WHERE_TOKENS_WENT_SKILL_ROOT: '' },
    });

    assert.equal(result.code, 2);
    assert.match(result.stderr, /preflight failed/);
    assert.match(result.stderr, /Reinstall the where-tokens-went Skill package/);
    assert.doesNotMatch(result.stderr, /npm run install-local/);

    // Verify: Run directory was NEVER created
    assert.equal(require('node:fs').existsSync(runDir), false, 'run directory must not exist on preflight failure');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('AC-3: empty scope start does not dispatch workers, advances to clear no-data HTML, and preserves unavailable cost', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-ac3-'));
  try {
    const isolatedProject = path.join(root, 'isolated-project');
    const skillRoot = path.join(isolatedProject, '.agents', 'skills', 'where-tokens-went');
    await mkdir(isolatedProject, { recursive: true });
    await mkdir(path.dirname(skillRoot), { recursive: true });
    await cp(sourceSkillDir, skillRoot, { recursive: true });

    const launcher = path.join(skillRoot, 'scripts', 'where-tokens-went.js');
    const runDir = path.join(root, 'run-empty');
    const emptyCodexHome = path.join(root, 'empty-codex-home');
    await mkdir(emptyCodexHome, { recursive: true });

    // Step 1: run-all start on empty scope
    const startResult = await runProcess(process.execPath, [
      launcher,
      'report-run', 'run-all', 'start',
      '--harness', 'codex',
      '--cwd', isolatedProject,
      '--since', '7d',
      '--run-dir', runDir,
    ], {
      cwd: isolatedProject,
      env: {
        CODEX_HOME: emptyCodexHome,
        WHERE_TOKENS_WENT_REPO_ROOT: '',
        WHERE_TOKENS_WENT_SKILL_ROOT: '',
      },
    });

    assert.equal(startResult.code, 0, startResult.stderr);
    const startJson = JSON.parse(startResult.stdout);
    assert.equal(startJson.action, 'advance');
    assert.equal(startJson.reason, 'NO_HISTORY_IN_SCOPE');
    assert.deepEqual(startJson.tickets, {});

    // Inspect manifest
    const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    for (const lane of ['report-synthesis', 'key-session-analysis', 'skill-insights']) {
      assert.equal(manifest.laneStatus[lane].status, 'unavailable');
      assert.equal(manifest.laneStatus[lane].attempts, 0);
      assert.equal(manifest.laneStatus[lane].reasonCode, 'NO_HISTORY_IN_SCOPE');
    }
    assert.ok(!manifest.artifacts.evidence, 'auto evidence was not run on empty scope');

    // Step 2: advance to render HTML
    const advanceResult = await runProcess(process.execPath, [
      launcher,
      'report-run', 'advance',
      '--run-dir', runDir,
    ], {
      cwd: isolatedProject,
      env: {
        CODEX_HOME: emptyCodexHome,
        WHERE_TOKENS_WENT_REPO_ROOT: '',
        WHERE_TOKENS_WENT_SKILL_ROOT: '',
      },
    });

    assert.equal(advanceResult.code, 0, advanceResult.stderr);
    const advanceJson = JSON.parse(advanceResult.stdout);
    assert.equal(advanceJson.action, 'open-html');
    assert.equal(advanceJson.status, 'awaiting-ui-dispatch');
    assert.equal(advanceJson.fallback, true);

    const htmlPath = path.join(runDir, 'report.html');
    const htmlContent = await readFile(htmlPath, 'utf8');
    assert.match(htmlContent, /No historical records available|本次范围没有可用历史记录/);
    assert.doesNotMatch(htmlContent, /\$0\.00/);

    // Step 3: advance with UI receipt finalizes and cleans up
    const finishResult = await runProcess(process.execPath, [
      launcher,
      'report-run', 'advance',
      '--run-dir', runDir,
      '--ui', 'completed',
    ], {
      cwd: isolatedProject,
      env: {
        CODEX_HOME: emptyCodexHome,
        WHERE_TOKENS_WENT_REPO_ROOT: '',
        WHERE_TOKENS_WENT_SKILL_ROOT: '',
      },
    });

    assert.equal(finishResult.code, 0, finishResult.stderr);
    const finishJson = JSON.parse(finishResult.stdout);
    assert.equal(finishJson.status, 'completed');
    assert.equal(finishJson.deliveryStatus, 'completed');
    assert.equal(finishJson.cleanedUp, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('AC-4: normal data path issues lane tickets, and Claude remains paused', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-ac4-'));
  try {
    const isolatedProject = path.join(root, 'isolated-project');
    const skillRoot = path.join(isolatedProject, '.agents', 'skills', 'where-tokens-went');
    await mkdir(isolatedProject, { recursive: true });
    await mkdir(path.dirname(skillRoot), { recursive: true });
    await cp(sourceSkillDir, skillRoot, { recursive: true });

    const launcher = path.join(skillRoot, 'scripts', 'where-tokens-went.js');

    // 1. Claude harness remains paused
    const claudeResult = await runProcess(process.execPath, [
      launcher,
      'report-run', 'run-all', 'start',
      '--harness', 'claude',
      '--cwd', isolatedProject,
    ]);
    assert.notEqual(claudeResult.code, 0);
    assert.match(claudeResult.stderr, /Claude Code support is paused/);

    // 2. Normal Codex data path (simulate session records)
    const codexHome = path.join(root, 'codex-home');
    const d = new Date();
    const year = String(d.getUTCFullYear());
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const sessionDir = path.join(codexHome, 'sessions', year, month, day);
    await mkdir(sessionDir, { recursive: true });
    const timestamp = d.toISOString();
    const sessionFile = path.join(sessionDir, 'rollout-ac4.jsonl');
    const records = [
      { timestamp, type: 'session_meta', payload: { id: 'ac4-session', cwd: isolatedProject, source: 'user' } },
      { timestamp, type: 'turn_context', payload: { turn_id: 'ac4-turn', cwd: isolatedProject, model: 'gpt-4o', model_provider: 'openai' } },
      { timestamp, type: 'event_msg', payload: { type: 'raw_response_completed', response_id: 'ac4-response', usage: { input_tokens: 100, cached_input_tokens: 20, cache_write_input_tokens: 0, output_tokens: 50, reasoning_output_tokens: 0, total_tokens: 150 } } },
    ];
    await writeFile(sessionFile, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

    const runDir = path.join(root, 'run-normal');
    const normalStart = await runProcess(process.execPath, [
      launcher,
      'report-run', 'run-all', 'start',
      '--harness', 'codex',
      '--all-projects',
      '--since', '7d',
      '--run-dir', runDir,
    ], {
      cwd: isolatedProject,
      env: {
        CODEX_HOME: codexHome,
        WHERE_TOKENS_WENT_REPO_ROOT: '',
        WHERE_TOKENS_WENT_SKILL_ROOT: '',
      },
    });

    assert.equal(normalStart.code, 0, normalStart.stderr);
    const startJson = JSON.parse(normalStart.stdout);
    assert.equal(startJson.status, 'lanes-ready');
    assert.ok(startJson.tickets['report-synthesis']);
    assert.ok(startJson.tickets['key-session-analysis']);
    assert.ok(startJson.tickets['skill-insights']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('AC-1 gap: normal preflight and start check the actual invoking package, not masked by ambient environment variables', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-ac1-gap-'));
  try {
    const cleanSkill = path.join(root, 'clean-skill');
    const damagedProject = path.join(root, 'damaged-project');
    const damagedSkill = path.join(damagedProject, '.agents', 'skills', 'where-tokens-went');

    await mkdir(path.dirname(damagedSkill), { recursive: true });
    await cp(sourceSkillDir, cleanSkill, { recursive: true });
    await cp(sourceSkillDir, damagedSkill, { recursive: true });

    // Tamper the actually invoked package (e.g. append comment to launcher)
    const damagedLauncher = path.join(damagedSkill, 'scripts', 'where-tokens-went.js');
    await writeFile(damagedLauncher, (await readFile(damagedLauncher, 'utf8')) + '\n// damaged launcher\n');

    // Set ambient environment variables pointing to the CLEAN skill package
    const ambientEnv = {
      WHERE_TOKENS_WENT_SKILL_ROOT: cleanSkill,
      WHERE_TOKENS_WENT_REPO_ROOT: root,
    };

    // 1. Normal preflight on damaged package must fail despite clean environment variables
    const preflightResult = await runProcess(process.execPath, [damagedLauncher, 'report-run', 'preflight'], {
      cwd: damagedProject,
      env: ambientEnv,
    });
    assert.equal(preflightResult.code, 2, 'preflight must fail on damaged invoking package');
    assert.match(preflightResult.stderr, /content digest mismatch/);

    // 2. Normal start on damaged package must fail and create NO run directory
    const runDir = path.join(root, 'run-must-not-exist');
    const startResult = await runProcess(process.execPath, [
      damagedLauncher,
      'report-run', 'run-all', 'start',
      '--harness', 'codex',
      '--cwd', damagedProject,
      '--since', '7d',
      '--run-dir', runDir,
    ], {
      cwd: damagedProject,
      env: ambientEnv,
    });
    assert.equal(startResult.code, 2, 'start must fail on damaged invoking package');
    assert.match(startResult.stderr, /content digest mismatch/);
    assert.equal(require('node:fs').existsSync(runDir), false, 'start failure must leave no Run directory');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

