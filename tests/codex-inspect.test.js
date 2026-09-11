const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, mkdir, writeFile, readFile, access, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { analyseAudit } = require('../dist/src/analysis.js');
const { resolveApiPricing } = require('../dist/src/rates.js');
const { renderHtml, renderText } = require('../dist/src/report.js');

const execFileAsync = promisify(execFile);
const cliPath = path.resolve(__dirname, '..', 'dist', 'src', 'cli.js');
const bundledCodexPath = path.resolve(__dirname, '..', 'skills', 'where-tokens-went-codex', 'scripts', 'where-tokens-went.js');
const { parseArgs } = require('../dist/src/cli.js');

function isoHoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function runAudit(args, env) {
  return execFileAsync(process.execPath, [cliPath, ...args], {
    env: { ...process.env, ...env },
    maxBuffer: 1024 * 1024,
  });
}

async function runBundledCodex(args, env) {
  return execFileAsync(process.execPath, [bundledCodexPath, ...args], {
    env: { ...process.env, ...env },
    maxBuffer: 1024 * 1024,
  });
}

test('CLI uses LiteLLM pricing by default and accepts the explicit pricing flag', () => {
  assert.equal(parseArgs(['inspect', '--harness', 'codex', '--cwd', 'D:\\project']).pricing, 'litellm');
  assert.equal(parseArgs(['inspect', '--harness', 'codex', '--cwd', 'D:\\project', '--pricing', 'litellm']).pricing, 'litellm');
  assert.throws(() => parseArgs(['inspect', '--harness', 'codex', '--cwd', 'D:\\project', '--pricing', 'local']), /must be litellm/);
});

test('Codex Skill makes report delivery an atomic HTML-and-diagnosis workflow', async () => {
  const skill = await readFile(path.resolve(__dirname, '..', 'skills', 'where-tokens-went-codex', 'SKILL.md'), 'utf8');
  assert.match(skill, /complete only after both steps occur in the same conversation turn/i);
  assert.match(skill, /generate and open the deterministic local HTML, then give one explicit Host Agent Finding/i);
  assert.match(skill, /The HTML is deterministic evidence and diagnostic signals, not the Finding itself/i);
  assert.match(skill, /Do not end the turn after returning a report path or opening the HTML/i);
  assert.match(skill, /do not return a diagnosis without the requested report/i);
});

test('Claude Code Skill preserves the same atomic report and evidence contract', async () => {
  for (const [name, harness] of [['claude', 'claude']]) {
    const skill = await readFile(path.resolve(__dirname, '..', 'skills', 'where-tokens-went-' + name, 'SKILL.md'), 'utf8');
    assert.match(skill, new RegExp('--harness ' + harness));
    assert.match(skill, /Current Project versus Global Audit/);
    assert.match(skill, /Finding, Evidence, mechanism, action when justified, and material uncertainty/);
    assert.match(skill, /complete only after both steps occur in the same conversation turn/i);
    assert.match(skill, /one explicit Host Agent Finding/i);
    assert.match(skill, /Do not end the turn after returning a report path or opening the HTML/i);
    assert.match(skill, /rather than manufacture a verdict/i);
  }
});

test('native Skill installation exposes one fixed Harness entry per platform', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-skills-'));
  const installer = path.resolve(__dirname, '..', 'scripts', 'install-skills.js');
  const expected = [
    ['codex', '.agents', 'skills', 'where-tokens-went-codex'],
    ['claude', '.claude', 'skills', 'where-tokens-went-claude'],
  ];
  try {
    await execFileAsync(process.execPath, [installer, root]);
    for (const [harness, ...relative] of expected) {
      const skillPath = path.join(root, ...relative, 'SKILL.md');
      const skill = await require('node:fs/promises').readFile(skillPath, 'utf8');
      const source = await require('node:fs/promises').readFile(path.resolve(__dirname, '..', 'skills', 'where-tokens-went-' + harness, 'SKILL.md'), 'utf8');
      assert.equal(skill, source);
      assert.match(skill, new RegExp(`--harness ${harness}`));
      assert.match(skill, /--cwd <absolute-current-project-path>/);
      assert.match(skill, /--since <duration>/);
      assert.match(skill, /--format json/);
      assert.match(skill, /Natural language is the primary interface/);
      assert.match(skill, /same bundled inspect command/);
      assert.match(skill, /An arbitrary question is interpreted by the Host Agent/);
      await require('node:fs/promises').access(path.join(root, ...relative, 'scripts', 'where-tokens-went.js'));
      await require('node:fs/promises').access(path.join(root, ...relative, 'scripts', 'runtime', 'cli.js'));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('each copied Skill runs its bundled deterministic tool without the source checkout', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-bundled-skill-'));
  const project = path.join(root, 'project');
  const installer = path.resolve(__dirname, '..', 'scripts', 'install-skills.js');
  const installed = {
    codex: path.join(root, '.agents', 'skills', 'where-tokens-went-codex', 'scripts', 'where-tokens-went.js'),
    claude: path.join(root, '.claude', 'skills', 'where-tokens-went-claude', 'scripts', 'where-tokens-went.js'),
  };
  const envByHarness = {
    codex: { CODEX_HOME: path.join(root, 'missing-codex') },
    claude: { CLAUDE_CONFIG_DIR: path.join(root, 'missing-claude') },
  };
  await mkdir(project, { recursive: true });
  try {
    await execFileAsync(process.execPath, [installer, root]);
    for (const harness of Object.keys(installed)) {
      const { stdout } = await execFileAsync(process.execPath, [
        installed[harness],
        'inspect', '--harness', harness, '--cwd', project, '--since', '7d', '--format', 'json',
      ], {
        env: { ...process.env, ...envByHarness[harness] },
        maxBuffer: 1024 * 1024,
      });
      const result = JSON.parse(stdout);
      assert.equal(result.scope.harness, harness);
      assert.equal(result.summary.sessionCount.value, 0);
      assert.equal(result.summary.totalTokens.value, null);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('packaged Codex and Claude runtimes preserve new evidence facts outside the checkout', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-packaged-evidence-'));
  const project = path.join(root, 'project');
  const installer = path.resolve(__dirname, '..', 'scripts', 'install-skills.js');
  const codexHome = path.join(root, 'codex-home');
  const claudeHome = path.join(root, 'claude-home');
  const timestamp = isoHoursAgo(1);
  await mkdir(project, { recursive: true });
  await mkdir(path.join(codexHome, 'sessions', '2026', '09', '10'), { recursive: true });
  await mkdir(path.join(claudeHome, 'projects', 'project'), { recursive: true });
  await writeFile(path.join(codexHome, 'sessions', '2026', '09', '10', 'rollout-packaged.jsonl'), [
    { timestamp, type: 'session_meta', payload: { id: 'packaged-codex', cwd: project, source: 'user' } },
    { timestamp, type: 'turn_context', payload: { turn_id: 'packaged-turn', cwd: project, model: 'gpt-4.1', model_provider: 'openai' } },
    { timestamp, type: 'event_msg', payload: { type: 'skill_listing', skills: [{ name: 'packaged-skill' }] } },
    { timestamp, type: 'event_msg', payload: { type: 'skill_input', id: 'packaged-skill-input', skill_name: 'packaged-skill' } },
    { timestamp, type: 'event_msg', payload: { type: 'raw_response_completed', response_id: 'packaged-response', usage: { input_tokens: 100, cached_input_tokens: 20, cache_write_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 110 } } },
  ].map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
  await writeFile(path.join(claudeHome, 'projects', 'project', 'packaged-claude.jsonl'), [
    { type: 'user', session_id: 'packaged-claude', cwd: project, timestamp },
    { type: 'system', session_id: 'packaged-claude', cwd: project, timestamp, available_skills: ['packaged-skill'] },
    { type: 'assistant', session_id: 'packaged-claude', cwd: project, provider: 'anthropic', attributionSkill: 'packaged-skill', timestamp, message: { id: 'packaged-claude-call', role: 'assistant', model: 'claude-sonnet-5', usage: { input_tokens: 20, cache_read_input_tokens: 10, cache_creation_input_tokens: 5, cache_creation: { ephemeral_5m_input_tokens: 5 }, output_tokens: 5, total_tokens: 40 } } },
  ].map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
  try {
    await execFileAsync(process.execPath, [installer, root]);
    const installed = {
      codex: path.join(root, '.agents', 'skills', 'where-tokens-went-codex', 'scripts', 'where-tokens-went.js'),
      claude: path.join(root, '.claude', 'skills', 'where-tokens-went-claude', 'scripts', 'where-tokens-went.js'),
    };
    const cases = [
      ['codex', { CODEX_HOME: codexHome }],
      ['claude', { CLAUDE_CONFIG_DIR: claudeHome }],
    ];
    for (const [harness, env] of cases) {
      const args = ['inspect', '--harness', harness, '--cwd', project, '--since', '7d', '--format', 'json'];
      const [{ stdout: sourceOutput }, { stdout: packagedOutput }] = await Promise.all([
        runAudit(args, env),
        execFileAsync(process.execPath, [installed[harness], ...args], { env: { ...process.env, ...env }, maxBuffer: 1024 * 1024 }),
      ]);
      const source = JSON.parse(sourceOutput);
      const packaged = JSON.parse(packagedOutput);
      assert.deepEqual(packaged.summary, source.summary);
      assert.deepEqual(packaged.coverage, source.coverage);
      assert.deepEqual(packaged.report.dailyUsage, source.report.dailyUsage);
      assert.deepEqual(packaged.report.cacheEconomics, source.report.cacheEconomics);
      assert.deepEqual(packaged.report.firstRequestBurden, source.report.firstRequestBurden);
      assert.deepEqual(packaged.report.skills, source.report.skills);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI rejects suspended Pi and DeepSeek Harness values', async () => {
  for (const harness of ['pi', 'deepseek']) {
    await assert.rejects(
      runAudit(['inspect', '--harness', harness, '--cwd', os.tmpdir(), '--since', '7d', '--format', 'json']),
      (error) => {
        assert.equal(error.code, 2);
        assert.match(error.stderr, /supported Harnesses are claude and codex/i);
        return true;
      },
    );
  }
});

test('suspended Harnesses are absent from the packaged source and installed layout', async () => {
  for (const skill of ['where-tokens-went-claude', 'where-tokens-went-codex']) {
    for (const file of ['pi-reader.js', 'deepseek-reader.js', 'fzstd.js', 'fzstd.LICENSE']) {
      await assert.rejects(access(path.resolve(__dirname, '..', 'skills', skill, 'scripts', 'runtime', file)));
    }
  }
  await assert.rejects(access(path.resolve(__dirname, '..', 'skills', 'where-tokens-went-pi')));
  await assert.rejects(access(path.resolve(__dirname, '..', 'skills', 'where-tokens-went-deepseek')));
});

test('Codex Skill path reports a deterministic long-session check without raw content', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-codex-'));
  const project = path.join(root, 'project');
  const codexHome = path.join(root, 'codex-home');
  const sessions = path.join(codexHome, 'sessions', '2026', '09', '07');
  await mkdir(project, { recursive: true });
  await mkdir(sessions, { recursive: true });

  const records = [
    {
      timestamp: isoHoursAgo(3),
      type: 'session_meta',
      payload: {
        id: 'thread-codex-1',
        cwd: project,
        cli_version: '0.1-fixture',
      },
    },
    {
      timestamp: isoHoursAgo(2.9),
      type: 'turn_context',
      payload: { turn_id: 'turn-1', cwd: project, model: 'gpt-5.6-sol', model_provider: 'openai' },
    },
    {
      timestamp: isoHoursAgo(2.8),
      type: 'event_msg',
      payload: {
        type: 'raw_response_completed',
        response_id: 'response-1',
        usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 40, reasoning_output_tokens: 10, total_tokens: 150 },
      },
    },
    {
      timestamp: isoHoursAgo(1.8),
      type: 'turn_context',
      payload: { turn_id: 'turn-2', cwd: project, model: 'gpt-5.6-luna', model_provider: 'openai' },
    },
    {
      timestamp: isoHoursAgo(1.7),
      type: 'event_msg',
      payload: {
        type: 'raw_response_completed',
        response_id: 'response-2',
        usage: { input_tokens: 200, cached_input_tokens: 40, output_tokens: 60, reasoning_output_tokens: 20, total_tokens: 280 },
      },
    },
    {
      type: 'event_msg',
      payload: {
        type: 'raw_response_completed',
        response_id: 'response-without-time',
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      },
    },
    {
      timestamp: isoHoursAgo(1.6),
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: 'PRIVATE_PROMPT should never be returned' },
    },
    {
      timestamp: isoHoursAgo(1.5),
      type: 'response_item',
      payload: { type: 'function_call_output', output: 'secret-source.js and terminal-secret' },
    },
  ];
  await writeFile(
    path.join(sessions, 'rollout-fixture.jsonl'),
    records.map((record) => JSON.stringify(record)).join('\n') + '\n',
    'utf8',
  );
  await writeFile(
    path.join(codexHome, 'session_index.jsonl'),
    [
      { id: 'thread-codex-1', thread_name: 'Old Codex title', updated_at: isoHoursAgo(4) },
      { id: 'thread-codex-1', thread_name: 'Codex usage deep dive', updated_at: isoHoursAgo(1) },
    ].map((record) => JSON.stringify(record)).join('\n') + '\n',
    'utf8',
  );

  try {
    const { stdout: jsonText } = await runAudit(
      ['inspect', '--harness', 'codex', '--cwd', project, '--since', '7d', '--format', 'json'],
      { CODEX_HOME: codexHome },
    );
    const result = JSON.parse(jsonText);

    assert.equal(result.scope.harness, 'codex');
    assert.equal(result.scope.cwd, '<current-project>');
    assert.equal(result.coverage.filesRead, 1);
    assert.equal(result.coverage.partialSessions, 1);
    assert.match(result.coverage.warnings.join(' '), /timestamp|time/i);
    assert.equal(result.summary.sessionCount.value, 1);
    assert.equal(result.summary.modelCallCount.value, 2);
    assert.equal(result.summary.totalTokens.value, 430);
    assert.equal(result.summary.totalTokens.provenance, 'reported');
    assert.equal(result.summary.topSessionTitle.value, 'Codex usage deep dive');
    assert.equal(result.summary.topSessionSharePercent.value, 100);
    assert.equal(result.rankings.sessions[0].displayName, 'Codex usage deep dive (thread-codex-1)');
    assert.equal(result.rankings.models[0].key, 'gpt-5.6-luna');
    assert.equal(result.rankings.models[0].sharePercent.value, 65.12);
    assert.equal(result.rankings.models[1].sharePercent.value, 34.88);
    assert.equal(result.checks.find((check) => check.id === 'long_session').evidence[0].source.sessionId, 'thread-codex-1');

    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('PRIVATE_PROMPT'), false);
    assert.equal(serialized.includes('secret-source.js'), false);
    assert.equal(serialized.includes('terminal-secret'), false);

    const { stdout: textOutput } = await runAudit(
      ['inspect', '--harness', 'codex', '--cwd', project, '--since', '7d', '--format', 'text'],
      { CODEX_HOME: codexHome },
    );
    assert.match(textOutput, /One Session accounts for/i);
    assert.match(textOutput, /Top Session: Codex usage deep dive \(thread-codex-1\)/);
    assert.match(textOutput, /share: 100%/);
    assert.match(textOutput, /Models: .*tokens \(65\.12%\).*tokens \(34\.88%\)/);
    assert.equal(textOutput.includes('PRIVATE_PROMPT'), false);
    assert.equal(textOutput.includes('secret-source.js'), false);

    const { stdout: bundledJson } = await runBundledCodex(
      ['inspect', '--harness', 'codex', '--cwd', project, '--since', '7d', '--format', 'json'],
      { CODEX_HOME: codexHome },
    );
    const bundledResult = JSON.parse(bundledJson);
    assert.equal(bundledResult.summary.topSessionTitle.value, 'Codex usage deep dive');
    assert.equal(bundledResult.rankings.models[0].sharePercent.value, 65.12);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Codex scope keeps projects separate and deduplicates repeated response usage', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-codex-scope-'));
  const project = path.join(root, 'current');
  const otherProject = path.join(root, 'other');
  const codexHome = path.join(root, 'codex-home');
  const sessions = path.join(codexHome, 'sessions', '2026', '09', '07');
  await mkdir(project, { recursive: true });
  await mkdir(otherProject, { recursive: true });
  await mkdir(sessions, { recursive: true });

  const currentMeta = {
    timestamp: isoHoursAgo(2),
    type: 'session_meta',
    payload: { id: 'current-session', cwd: project },
  };
  const repeatedResponse = {
    timestamp: isoHoursAgo(1.9),
    type: 'event_msg',
    payload: {
      type: 'raw_response_completed',
      response_id: 'same-response',
      usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140 },
    },
  };
  const otherSession = [
    {
      timestamp: isoHoursAgo(1),
      type: 'session_meta',
      payload: { id: 'other-session', cwd: otherProject },
    },
    {
      timestamp: isoHoursAgo(0.9),
      type: 'event_msg',
      payload: {
        type: 'raw_response_completed',
        response_id: 'other-response',
        usage: { input_tokens: 900, output_tokens: 100, total_tokens: 1000 },
      },
    },
  ];
  await writeFile(
    path.join(sessions, 'rollout-current.jsonl'),
    [currentMeta, repeatedResponse, repeatedResponse].map((record) => JSON.stringify(record)).join('\n') + '\n',
    'utf8',
  );
  await writeFile(
    path.join(sessions, 'rollout-other.jsonl'),
    otherSession.map((record) => JSON.stringify(record)).join('\n') + '\n{"broken":',
    'utf8',
  );

  try {
    const { stdout } = await runAudit(
      ['inspect', '--harness', 'codex', '--cwd', project, '--since', '7d', '--format', 'json'],
      { CODEX_HOME: codexHome },
    );
    const result = JSON.parse(stdout);

    assert.equal(result.summary.sessionCount.value, 1);
    assert.equal(result.summary.modelCallCount.value, 1);
    assert.equal(result.summary.totalTokens.value, 140);
    assert.equal(result.coverage.filesRead, 2);
    assert.equal(result.coverage.recordsSkipped, 1);
    assert.equal(result.coverage.partialSessions, 1);
    assert.equal(result.summary.partialSessionRatePercent.value, null);
    assert.equal(result.summary.partialSessionRatePercent.provenance, 'unavailable');
    assert.equal(result.summary.topSessionId.value, 'current-session');
    assert.equal(result.summary.topSessionTitle.provenance, 'unavailable');
    assert.equal(result.rankings.sessions[0].displayName, 'current-session');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Codex reports source-proven top-level and subagent Session counts separately', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-codex-subagents-'));
  const project = path.join(root, 'project');
  const codexHome = path.join(root, 'codex-home');
  const sessions = path.join(codexHome, 'sessions', '2026', '09', '07');
  await mkdir(project, { recursive: true });
  await mkdir(sessions, { recursive: true });
  const response = (id, total) => ({ timestamp: isoHoursAgo(1), type: 'event_msg', payload: { type: 'raw_response_completed', response_id: id, usage: { input_tokens: total - 10, output_tokens: 10, total_tokens: total } } });
  try {
    await writeFile(path.join(sessions, 'rollout-parent.jsonl'), [
      { timestamp: isoHoursAgo(2), type: 'session_meta', payload: { id: 'parent', cwd: project, source: 'vscode' } },
      response('parent-response', 100),
    ].map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
    await writeFile(path.join(sessions, 'rollout-child.jsonl'), [
      { timestamp: isoHoursAgo(2), type: 'session_meta', payload: { id: 'child', cwd: project, parent_thread_id: 'parent', source: { subagent: {} } } },
      response('child-response', 50),
    ].map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
    const { stdout } = await runAudit(['inspect', '--harness', 'codex', '--cwd', project, '--since', '7d', '--format', 'text'], { CODEX_HOME: codexHome });
    assert.match(stdout, /Sessions: 2; top-level tasks: 1; subagent Sessions: 1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Codex reports source-proven partial Session composition without guessing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-codex-partial-composition-'));
  const project = path.join(root, 'project');
  const codexHome = path.join(root, 'codex-home');
  const sessions = path.join(codexHome, 'sessions', '2026', '09', '07');
  await mkdir(project, { recursive: true });
  await mkdir(sessions, { recursive: true });
  const response = (id, total) => ({ timestamp: isoHoursAgo(1), type: 'event_msg', payload: { type: 'raw_response_completed', response_id: id, usage: { input_tokens: total - 10, output_tokens: 10, total_tokens: total } } });
  try {
    await writeFile(path.join(sessions, 'rollout-parent.jsonl'), [
      { timestamp: isoHoursAgo(2), type: 'session_meta', payload: { id: 'parent-complete', cwd: project, source: 'vscode' } },
      response('parent-complete-response', 100),
    ].map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
    await writeFile(path.join(sessions, 'rollout-child.jsonl'), [
      { timestamp: isoHoursAgo(2), type: 'session_meta', payload: { id: 'child-partial', cwd: project, parent_thread_id: 'parent-complete', source: { subagent: {} } } },
      response('child-partial-response', 50),
      { timestamp: isoHoursAgo(0.8), type: 'future_token_usage', payload: { usage: { total_tokens: 999 } } },
    ].map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');

    const { stdout: jsonText } = await runAudit(
      ['inspect', '--harness', 'codex', '--cwd', project, '--since', '7d', '--format', 'json'],
      { CODEX_HOME: codexHome },
    );
    const result = JSON.parse(jsonText);
    assert.equal(result.coverage.partialSessions, 1);
    assert.equal(result.summary.partialTopLevelSessionCount.value, 0);
    assert.equal(result.summary.partialSubagentSessionCount.value, 1);
    assert.equal(result.summary.partialSessionRatePercent.value, 50);
    assert.equal(result.summary.partialSessionRatePercent.provenance, 'derived');
    assert.match(result.summary.partialSessionRatePercent.method, /partial.*Session count divided by selected Session count/i);

    const { stdout: textOutput } = await runAudit(
      ['inspect', '--harness', 'codex', '--cwd', project, '--since', '7d', '--format', 'text'],
      { CODEX_HOME: codexHome },
    );
    assert.match(textOutput, /1 of 2 Sessions \(50%/);
    assert.match(textOutput, /All partial Sessions are source-proven subagent Sessions/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Codex report attributes repeated tool output and extra lifecycle calls', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-codex-tools-'));
  const project = path.join(root, 'project');
  const codexHome = path.join(root, 'codex-home');
  const sessions = path.join(codexHome, 'sessions', '2026', '09', '07');
  await mkdir(project, { recursive: true });
  await mkdir(sessions, { recursive: true });

  const records = [
    {
      timestamp: isoHoursAgo(3),
      type: 'session_meta',
      payload: { id: 'tool-session', cwd: project },
    },
    {
      timestamp: isoHoursAgo(2.9),
      type: 'turn_context',
      payload: { turn_id: 'turn-1', cwd: project, model: 'gpt-5.6-sol', model_provider: 'openai' },
    },
    {
      timestamp: isoHoursAgo(2.8),
      type: 'response_item',
      payload: { type: 'function_call', call_id: 'tool-1', name: 'Read', arguments: '{"file":"secret.ts"}' },
    },
    {
      timestamp: isoHoursAgo(2.7),
      type: 'response_item',
      payload: { type: 'function_call_output', call_id: 'tool-1', output: 'x'.repeat(1600) },
    },
    {
      timestamp: isoHoursAgo(1.4),
      type: 'response_item',
      payload: { type: 'function_call', call_id: 'tool-2', name: 'Bash', arguments: 'echo secondary' },
    },
    {
      timestamp: isoHoursAgo(1.3),
      type: 'response_item',
      payload: { type: 'function_call_output', call_id: 'tool-2', output: 'y'.repeat(400) },
    },
    {
      timestamp: isoHoursAgo(2.6),
      type: 'event_msg',
      payload: { type: 'raw_response_completed', response_id: 'tool-response-1', usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 } },
    },
    {
      timestamp: isoHoursAgo(1.6),
      type: 'event_msg',
      payload: { type: 'raw_response_completed', response_id: 'tool-response-2', usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 } },
    },
    {
      timestamp: isoHoursAgo(1.5),
      type: 'event_msg',
      payload: { type: 'stream_error', error: 'transient failure' },
    },
    {
      timestamp: isoHoursAgo(0.8),
      type: 'event_msg',
      payload: { type: 'raw_response_completed', response_id: 'tool-response-3', usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 } },
    },
  ];
  await writeFile(
    path.join(sessions, 'rollout-tools.jsonl'),
    records.map((record) => JSON.stringify(record)).join('\n') + '\n',
    'utf8',
  );

  try {
    const { stdout } = await runAudit(
      ['inspect', '--harness', 'codex', '--cwd', project, '--since', '7d', '--format', 'json'],
      { CODEX_HOME: codexHome },
    );
    const result = JSON.parse(stdout);

    assert.equal(result.summary.toolCallCount.value, 2);
    assert.equal(result.summary.pairedToolResultCount.value, 2);
    assert.equal(result.summary.extraLifecycleCount.value, 1);
    assert.equal(result.summary.estimatedToolAmplifiedTokens.value, 1300);
    assert.equal(result.summary.estimatedToolAmplifiedTokens.provenance, 'estimated');
    assert.match(result.report.tools[0].sharePercent.method, /total tool amplification estimate/);
    assert.equal(result.checks.find((check) => check.id === 'tool_amplification').id, 'tool_amplification');
                assert.equal(JSON.stringify(result).includes('secret.ts'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Tare report views stay localized, provenance-safe, and shareable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-tare-report-'));
  const project = path.join(root, 'project');
  const codexHome = path.join(root, 'codex-home');
  const sessions = path.join(codexHome, 'sessions', '2026', '09', '07');
  const htmlPath = path.join(root, 'tare-report.html');
  const sharePath = path.join(root, 'tare-share.md');
  await mkdir(project, { recursive: true });
  await mkdir(sessions, { recursive: true });

  const currentRecords = [
    {
      timestamp: isoHoursAgo(3),
      type: 'session_meta',
      payload: { id: 'tare-current', cwd: project },
    },
    {
      timestamp: isoHoursAgo(2.9),
      type: 'turn_context',
      payload: { turn_id: 'tare-turn', cwd: project, model: 'gpt-5.6-terra', model_provider: 'openai' },
    },
    {
      timestamp: isoHoursAgo(2.8),
      type: 'response_item',
      payload: { type: 'function_call', call_id: 'tare-tool', name: 'rg', arguments: 'PRIVATE_ARGS' },
    },
    {
      timestamp: isoHoursAgo(2.7),
      type: 'response_item',
      payload: { type: 'function_call_output', call_id: 'tare-tool', output: 'PRIVATE_RESULT '.repeat(1000) },
    },
    {
      timestamp: isoHoursAgo(2.6),
      type: 'event_msg',
      payload: {
        type: 'raw_response_completed',
        response_id: 'tare-response',
        usage: {
          input_tokens: 100000000,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 25000000,
          reasoning_output_tokens: 0,
          total_tokens: 125000000,
        },
      },
    },
    {
      timestamp: isoHoursAgo(2.5),
      type: 'future_usage_record',
      payload: { type: 'future_usage_record', accounting: 'PRIVATE_FUTURE_ACCOUNTING' },
    },
  ];
  const untitledRecords = [
    {
      timestamp: isoHoursAgo(1.4),
      type: 'session_meta',
      payload: { id: 'tare-untitled', cwd: project },
    },
    {
      timestamp: isoHoursAgo(1.3),
      type: 'turn_context',
      payload: { turn_id: 'tare-untitled-turn', cwd: project, model: 'gpt-5.6-terra', model_provider: 'openai' },
    },
    {
      timestamp: isoHoursAgo(1.2),
      type: 'event_msg',
      payload: {
        type: 'raw_response_completed',
        response_id: 'tare-untitled-response',
        usage: {
          input_tokens: 800000,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 200000,
          reasoning_output_tokens: 0,
          total_tokens: 1000000,
        },
      },
    },
    {
      timestamp: isoHoursAgo(1.1),
      type: 'future_usage_record',
      payload: { type: 'future_usage_record', accounting: 'PRIVATE_FUTURE_ACCOUNTING' },
    },
  ];
  const previousRecords = [
    {
      timestamp: isoDaysAgo(8),
      type: 'session_meta',
      payload: { id: 'tare-previous', cwd: project },
    },
    {
      timestamp: isoDaysAgo(7.9),
      type: 'turn_context',
      payload: { turn_id: 'tare-old-turn', cwd: project, model: 'gpt-5.6-sol', model_provider: 'openai' },
    },
    {
      timestamp: isoDaysAgo(7.8),
      type: 'event_msg',
      payload: {
        type: 'raw_response_completed',
        response_id: 'tare-old-response',
        usage: { input_tokens: 15000000, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 5000000, reasoning_output_tokens: 0, total_tokens: 20000000 },
      },
    },
  ];
  await writeFile(
    path.join(sessions, 'rollout-tare-current.jsonl'),
    currentRecords.map((record) => JSON.stringify(record)).join('\n') + '\n',
    'utf8',
  );
  await writeFile(
    path.join(sessions, 'rollout-tare-previous.jsonl'),
    previousRecords.map((record) => JSON.stringify(record)).join('\n') + '\n',
    'utf8',
  );
  await writeFile(
    path.join(sessions, 'rollout-tare-untitled.jsonl'),
    untitledRecords.map((record) => JSON.stringify(record)).join('\n') + '\n',
    'utf8',
  );
  await writeFile(
    path.join(codexHome, 'session_index.jsonl'),
    [
      { id: 'tare-current', thread_name: 'Tare current report' },
      { id: 'tare-previous', thread_name: 'Tare previous report' },
    ].map((record) => JSON.stringify(record)).join('\n') + '\n',
    'utf8',
  );

  try {
    const { stdout: jsonText } = await runAudit(
      [
        'inspect', '--harness', 'codex', '--cwd', project, '--since', '7d',
        '--locale', 'zh-CN', '--view', 'report', '--html', htmlPath, '--format', 'json',
      ],
      { CODEX_HOME: codexHome },
    );
    const result = JSON.parse(jsonText);
    const html = await readFile(htmlPath, 'utf8');

    assert.equal(result.view, 'report');
    assert.equal(result.summary.totalTokens.value, 126000000);
    assert.equal(result.report.dailyUsage.reduce((total, row) => total + row.totalTokens.value, 0), 126000000);
    assert.equal(result.report.dailyUsage.some((row) => row.inputTokens.value >= 100000000), true);
    assert.equal(result.report.hourlySupported, true);
    assert.equal(result.report.tools[0].key, 'rg');
    assert.equal(result.report.rollingWindow.providerQuota.value, null);
    assert.equal(result.report.rollingWindow.providerQuota.provenance, 'unavailable');
    assert.equal(result.report.rollingWindow.observedTokens.value, 126000000);
    assert.match(html, /where-tokens-went 诊断报告/);
    assert.match(html, /class="metric-main"[^>]*>1\.26亿</);
    assert.match(html, /title="精确值：126,000,000；证据来源：记录值"/);
    assert.match(html, /id="token-trend" class="echart"/);
    assert.match(html, /renderer:'svg'/);
    assert.match(html, /table class="kami-table compact sortable"/);
    assert.match(html, /class="chart hourly-heatmap"/);
    assert.match(html, /viewBox="0 0 880/);
    assert.equal(html.includes('x="745"'), false);
    assert.match(html, /gpt-5\.6-terra/);
    assert.match(html, /Tare current report/);
    assert.match(html, /未命名 Session · tare-untitled/);
    assert.match(html, /class="percentage"[^>]*>100%</);
    assert.equal(/2026-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}Z/.test(html), false);
    assert.doesNotMatch(html, /证据标识|Evidence markers/);
    assert.match(html, /注入估算表示工具结果被算入上下文的大小；后续暴露估算/);
    assert.match(html, /方法：/);
    assert.equal(html.includes('long_session'), false);
    assert.equal((html.match(/2 个 Codex Session 包含本报告暂时无法解析的用量记录/g) ?? []).length, 1);
    assert.equal(html.includes('A Codex Session contains unsupported accounting records'), false);
    assert.doesNotMatch(html, /Provider 额度|重置时间|没有该工具官方提供的额度数据/);
    assert.equal(html.includes('PRIVATE_ARGS'), false);
    assert.equal(html.includes('PRIVATE_RESULT'), false);
    assert.equal(html.includes('PRIVATE_FUTURE_ACCOUNTING'), false);
    assert.equal(html.includes(project), false);
    assert.match(html, /<script>/);
    assert.equal(/<script[^>]+src=/.test(html), false);
    assert.equal(/<(?:script|link|img)[^>]+https?:/.test(html), false);

    const installedRoot = path.join(root, 'installed');
    const installer = path.resolve(__dirname, '..', 'scripts', 'install-skills.js');
    await execFileAsync(process.execPath, [installer, installedRoot]);
    const installedHtmlPath = path.join(root, 'installed-tare-report.html');
    const installedCodexPath = path.join(installedRoot, '.agents', 'skills', 'where-tokens-went-codex', 'scripts', 'where-tokens-went.js');
    const { stdout: installedJsonText } = await execFileAsync(process.execPath, [
      installedCodexPath,
      'inspect', '--harness', 'codex', '--cwd', project, '--since', '7d',
      '--locale', 'zh-CN', '--view', 'report', '--html', installedHtmlPath, '--format', 'json',
    ], {
      env: { ...process.env, CODEX_HOME: codexHome },
      maxBuffer: 1024 * 1024,
    });
    const installedResult = JSON.parse(installedJsonText);
    const expectedScope = { ...result.scope };
    const actualScope = { ...installedResult.scope };
    delete expectedScope.since;
    delete actualScope.since;
    assert.deepEqual(actualScope, expectedScope);
    assert.equal(installedResult.summary.totalTokens.value, result.summary.totalTokens.value);
    assert.equal(installedResult.summary.totalTokens.provenance, result.summary.totalTokens.provenance);
    assert.equal(installedResult.rankings.models[0].key, result.rankings.models[0].key);
    assert.equal(installedResult.rankings.models[0].sharePercent.value, result.rankings.models[0].sharePercent.value);
    assert.deepEqual(installedResult.checks.map((check) => check.id), result.checks.map((check) => check.id));
    assert.equal(installedResult.report.dailyUsage[0].totalTokens.value, result.report.dailyUsage[0].totalTokens.value);
    const installedHtml = await readFile(installedHtmlPath, 'utf8');
    assert.equal(installedHtml.includes('PRIVATE_ARGS'), false);
    assert.equal(installedHtml.includes('PRIVATE_RESULT'), false);

    const { stdout: windowText } = await runAudit(
      ['inspect', '--harness', 'codex', '--cwd', project, '--since', '7d', '--locale', 'zh-CN', '--view', 'window', '--format', 'text'],
      { CODEX_HOME: codexHome },
    );
    assert.doesNotMatch(windowText, /Provider 额度|重置时间|没有该工具官方提供的额度数据/);
    assert.doesNotMatch(windowText, /不是该工具官方提供的额度/);

    const { stdout: toolsText } = await runAudit(
      ['inspect', '--harness', 'codex', '--cwd', project, '--since', '7d', '--view', 'tools', '--format', 'text'],
      { CODEX_HOME: codexHome },
    );
    assert.match(toolsText, /rg/);
    assert.equal(toolsText.includes('PRIVATE_RESULT'), false);

    await runAudit(
      ['inspect', '--harness', 'codex', '--cwd', project, '--since', '7d', '--locale', 'zh-CN', '--view', 'share', '--share', sharePath, '--format', 'text'],
      { CODEX_HOME: codexHome },
    );
    const share = await readFile(sharePath, 'utf8');
    assert.match(share, /脱敏分享稿/);
    assert.match(share, /gpt-5\.6-terra/);
    assert.equal(share.includes('tare-current'), false);
    assert.equal(share.includes(project), false);
    assert.equal(share.includes('PRIVATE_ARGS'), false);
    assert.equal(share.includes('PRIVATE_RESULT'), false);

    const { stdout: weekJson } = await runAudit(
      ['inspect', '--harness', 'codex', '--cwd', project, '--view', 'week', '--format', 'json'],
      { CODEX_HOME: codexHome },
    );
    const week = JSON.parse(weekJson);
    assert.equal(week.view, 'week');
    assert.equal(week.weekComparison.current.summary.totalTokens.value, 126000000);
    assert.equal(week.weekComparison.previous.summary.totalTokens.value, 20000000);
    assert.equal(week.weekComparison.changes.totalTokens.value, 106000000);
    assert.equal(week.weekComparison.modelChanges.some((entry) => entry.key === 'gpt-5.6-terra'), true);
    assert.equal(week.weekComparison.modelChanges.some((entry) => entry.key === 'gpt-5.6-sol'), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Codex Global Audit widens projects without crossing the Harness boundary', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-codex-global-'));
  const projectA = path.join(root, 'project-a');
  const projectB = path.join(root, 'project-b');
  const codexHome = path.join(root, 'codex-home');
  const sessions = path.join(codexHome, 'sessions', '2026', '09', '07');
  await mkdir(projectA, { recursive: true });
  await mkdir(projectB, { recursive: true });
  await mkdir(sessions, { recursive: true });

  const makeSession = (id, cwd, responseId, totalTokens) => [
    { timestamp: isoHoursAgo(2), type: 'session_meta', payload: { id, cwd } },
    {
      timestamp: isoHoursAgo(1.9),
      type: 'event_msg',
      payload: { type: 'raw_response_completed', response_id: responseId, usage: { input_tokens: totalTokens - 20, output_tokens: 20, total_tokens: totalTokens } },
    },
  ];
  await writeFile(
    path.join(sessions, 'rollout-a.jsonl'),
    makeSession('session-a', projectA, 'response-a', 100).map((record) => JSON.stringify(record)).join('\n') + '\n',
    'utf8',
  );
  await writeFile(
    path.join(sessions, 'rollout-b.jsonl'),
    makeSession('session-b', projectB, 'response-b', 200).map((record) => JSON.stringify(record)).join('\n') + '\n',
    'utf8',
  );

  try {
    const { stdout } = await runAudit(
      ['inspect', '--harness', 'codex', '--all-projects', '--since', '7d', '--format', 'json'],
      { CODEX_HOME: codexHome },
    );
    const result = JSON.parse(stdout);

    assert.equal(result.scope.harness, 'codex');
    assert.equal(result.scope.allProjects, true);
    assert.equal(result.scope.cwd, null);
    assert.equal(result.summary.sessionCount.value, 2);
    assert.equal(result.summary.modelCallCount.value, 2);
    assert.equal(result.summary.totalTokens.value, 300);
    assert.equal(result.summary.topSessionId.value, 'session-b');
    assert.equal(result.rankings.projects.length, 2);
    assert.equal(result.rankings.projects[0].value.value, 200);
    assert.match(result.rankings.projects[0].key, /^project-[0-9a-f]{12}$/);
    assert.equal(result.rankings.models[0].value.value, 300);
    assert.equal(result.rankings.timeBuckets.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Claude Code Skill path deduplicates assistant usage and pairs tool results', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-claude-'));
  const project = path.join(root, 'project');
  const claudeHome = path.join(root, 'claude-home');
  const transcripts = path.join(claudeHome, 'projects', 'encoded-project');
  await mkdir(project, { recursive: true });
  await mkdir(transcripts, { recursive: true });

  const records = [
    { type: 'user', session_id: 'claude-session', cwd: project, timestamp: isoHoursAgo(3), message: { role: 'user', content: 'PRIVATE_PROMPT' } },
    { type: 'assistant', session_id: 'claude-session', cwd: project, timestamp: isoHoursAgo(2.9), message: { id: 'assistant-1', role: 'assistant', model: 'claude-sonnet', usage: { input_tokens: 100, cache_read_input_tokens: 20, output_tokens: 40, total_tokens: 160 }, content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { file: 'secret-source.ts' } }] } },
    { type: 'assistant', session_id: 'claude-session', cwd: project, timestamp: isoHoursAgo(2.8), message: { id: 'assistant-1', role: 'assistant', model: 'claude-sonnet', usage: { input_tokens: 100, cache_read_input_tokens: 20, output_tokens: 40, total_tokens: 160 }, content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { file: 'secret-source.ts' } }] } },
    { type: 'user', session_id: 'claude-session', cwd: project, timestamp: isoHoursAgo(2.7), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'TOOL_SECRET '.repeat(100) }] } },
    { type: 'assistant', session_id: 'claude-session', cwd: project, timestamp: isoHoursAgo(1.8), message: { id: 'assistant-2', role: 'assistant', model: 'claude-sonnet', usage: { input_tokens: 120, output_tokens: 50, total_tokens: 170 } } },
    { type: 'assistant', session_id: 'claude-session', cwd: project, message: { id: 'assistant-without-time', role: 'assistant', model: 'claude-sonnet', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } },
  ];
  await writeFile(path.join(transcripts, 'claude-session.jsonl'), records.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');

  try {
    const { stdout } = await runAudit(
      ['inspect', '--harness', 'claude', '--cwd', project, '--since', '7d', '--format', 'json'],
      { CLAUDE_CONFIG_DIR: claudeHome },
    );
    const result = JSON.parse(stdout);

    assert.equal(result.scope.harness, 'claude');
    assert.equal(result.summary.sessionCount.value, 1);
    assert.equal(result.summary.modelCallCount.value, 2);
    assert.equal(result.summary.totalTokens.value, 330);
    assert.equal(result.summary.toolCallCount.value, 1);
    assert.equal(result.summary.pairedToolResultCount.value, 1);
    assert.equal(result.coverage.partialSessions, 1);
    assert.match(result.coverage.warnings.join(' '), /timestamp|time/i);
    assert.equal(result.checks.find((check) => check.id === 'tool_amplification').id, 'tool_amplification');
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('PRIVATE_PROMPT'), false);
    assert.equal(serialized.includes('TOOL_SECRET'), false);
    assert.equal(serialized.includes('secret-source.ts'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('every supported Harness emits the same safe empty-result contract', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-empty-'));
  const project = path.join(root, 'project');
  await mkdir(project, { recursive: true });
  const envByHarness = {
    codex: { CODEX_HOME: path.join(root, 'missing-codex') },
    claude: { CLAUDE_CONFIG_DIR: path.join(root, 'missing-claude') },
  };

  try {
    for (const [harness, env] of Object.entries(envByHarness)) {
      const args = ['inspect', '--harness', harness, '--cwd', project, '--since', '7d', '--format', 'json'];
      const { stdout: jsonText } = await runAudit(args, env);
      const result = JSON.parse(jsonText);
      assert.equal(result.scope.harness, harness);
      assert.equal(result.summary.sessionCount.value, 0);
      assert.equal(result.summary.totalTokens.value, null);
      assert.equal(result.summary.totalTokens.provenance, 'unavailable');
      assert.ok(result.checks.every((check) => check.id === 'data_quality'));

      const { stdout: textOutput } = await runAudit([...args.slice(0, -1), 'text'], env);
      assert.match(textOutput, new RegExp(`Audit: ${harness}`));
      assert.match(textOutput, /unavailable/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('shared Token composition derives Claude totals without reasoning and splits Codex inclusive input', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-composition-'));
  const project = path.join(root, 'project');
  const claudeHome = path.join(root, 'claude-home');
  const codexHome = path.join(root, 'codex-home');
  await mkdir(project, { recursive: true });
  await mkdir(path.join(claudeHome, 'projects', 'project'), { recursive: true });
  await mkdir(path.join(codexHome, 'sessions', '2026', '09', '10'), { recursive: true });
  const timestamp = isoHoursAgo(1);
  await writeFile(path.join(claudeHome, 'projects', 'project', 'session.jsonl'), [
    { type: 'user', session_id: 'claude-composition', cwd: project, timestamp },
    { type: 'assistant', session_id: 'claude-composition', cwd: project, timestamp, message: { id: 'claude-call', role: 'assistant', model: 'claude-sonnet-5', usage: { input_tokens: 70, cache_read_input_tokens: 20, cache_creation_input_tokens: 10, output_tokens: 30 } } },
    { type: 'assistant', session_id: 'claude-composition', cwd: project, timestamp, message: { id: 'claude-call', role: 'assistant', model: 'claude-sonnet-5', usage: { input_tokens: 70, cache_read_input_tokens: 20, cache_creation_input_tokens: 10, output_tokens: 30 } } },
  ].map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
  await writeFile(path.join(codexHome, 'sessions', '2026', '09', '10', 'rollout-codex-composition.jsonl'), [
    { timestamp, type: 'session_meta', payload: { id: 'codex-composition', cwd: project } },
    { timestamp, type: 'turn_context', payload: { turn_id: 'turn-composition', cwd: project, model: 'gpt-4.1', model_provider: 'openai' } },
    { timestamp, type: 'event_msg', payload: { type: 'raw_response_completed', response_id: 'codex-call', usage: { input_tokens: 100, cached_input_tokens: 20, cache_write_input_tokens: 10, output_tokens: 30, reasoning_output_tokens: 0, total_tokens: 130 } } },
  ].map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');

  try {
    const [{ stdout: claudeOutput }, { stdout: codexOutput }] = await Promise.all([
      runAudit(['inspect', '--harness', 'claude', '--cwd', project, '--since', '7d', '--format', 'json'], { CLAUDE_CONFIG_DIR: claudeHome }),
      runAudit(['inspect', '--harness', 'codex', '--cwd', project, '--since', '7d', '--format', 'json'], { CODEX_HOME: codexHome }),
    ]);
    const claude = JSON.parse(claudeOutput);
    const codex = JSON.parse(codexOutput);
    assert.equal(claude.summary.totalTokens.value, 130);
    assert.equal(claude.summary.totalTokens.provenance, 'derived');
    assert.equal(claude.report.dailyUsage[0].inputTokens.value, 70);
    assert.equal(claude.report.dailyUsage[0].cachedInputTokens.value, 20);
    assert.equal(claude.report.dailyUsage[0].cacheWriteTokens.value, 10);
    assert.equal(claude.report.dailyUsage[0].outputTokens.value, 30);
    assert.equal(claude.report.dailyUsage[0].reasoningTokens.value, null);
    assert.equal(codex.summary.totalTokens.value, 130);
    assert.equal(codex.report.dailyUsage[0].inputTokens.value, 70);
    assert.equal(codex.report.dailyUsage[0].cachedInputTokens.value, 20);
    assert.equal(codex.report.dailyUsage[0].cacheWriteTokens.value, 10);
    assert.equal(codex.report.dailyUsage[0].outputTokens.value, 30);
    assert.equal(codex.report.dailyUsage[0].unclassifiedTokens.value, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cache ratios aggregate compatible Token buckets and report lower composition coverage', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-cache-'));
  const project = path.join(root, 'project');
  const claudeHome = path.join(root, 'claude-home');
  const transcriptRoot = path.join(claudeHome, 'projects', 'project');
  const htmlPath = path.join(root, 'report.html');
  const sharePath = path.join(root, 'share.md');
  await mkdir(project, { recursive: true });
  await mkdir(transcriptRoot, { recursive: true });
  const timestamp = isoHoursAgo(1);
  const records = [
    { type: 'user', session_id: 'cache-session', cwd: project, timestamp },
    { type: 'assistant', session_id: 'cache-session', cwd: project, provider: 'anthropic', timestamp, message: { id: 'cache-call-1', role: 'assistant', model: 'claude-sonnet-5', usage: { input_tokens: 90, cache_read_input_tokens: 10, cache_creation_input_tokens: 0, output_tokens: 10, total_tokens: 110 } } },
    { type: 'assistant', session_id: 'cache-session', cwd: project, provider: 'anthropic', timestamp, message: { id: 'cache-call-2', role: 'assistant', model: 'claude-sonnet-5', usage: { input_tokens: 0, cache_read_input_tokens: 90, cache_creation_input_tokens: 0, output_tokens: 10, total_tokens: 100 } } },
    { type: 'assistant', session_id: 'cache-session', cwd: project, provider: 'anthropic', timestamp, message: { id: 'cache-incomplete', role: 'assistant', model: 'claude-sonnet-5', usage: { input_tokens: 50, output_tokens: 5, total_tokens: 55 } } },
  ];
  await writeFile(path.join(transcriptRoot, 'cache-session.jsonl'), records.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
  try {
    const env = { CLAUDE_CONFIG_DIR: claudeHome };
    const { stdout } = await runAudit(['inspect', '--harness', 'claude', '--cwd', project, '--since', '7d', '--format', 'json'], env);
    const result = JSON.parse(stdout);
    assert.equal(result.report.cacheEconomics.cacheReadRatePercent.value, 52.63);
    assert.equal(result.report.cacheEconomics.cacheWriteRatePercent.value, 0);
    assert.equal(result.report.cacheEconomics.totalInputTokens.value, 190);
    assert.equal(result.report.cacheEconomics.coveragePercent.value, 79.25);
    assert.match(result.report.cacheEconomics.limitations.join(' '), /incompatible|composition/i);

    const { stdout: textOutput } = await runAudit(['inspect', '--harness', 'claude', '--cwd', project, '--since', '7d', '--format', 'text', '--view', 'usage'], env);
    assert.match(textOutput, /cache-read rate|缓存读取率/i);
    assert.match(textOutput, /52\.63/);
    await runAudit(['inspect', '--harness', 'claude', '--cwd', project, '--since', '7d', '--format', 'json', '--html', htmlPath], env);
    await runAudit(['inspect', '--harness', 'claude', '--cwd', project, '--since', '7d', '--format', 'json', '--share', sharePath], env);
    assert.match(await readFile(htmlPath, 'utf8'), /52\.63|cache-read rate|缓存读取率/i);
    assert.match(await readFile(sharePath, 'utf8'), /52\.63|cache-read rate|缓存读取率/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('API-equivalent cache cost uses exact Provider/model/TTL dimensions and exposes an all-uncached counterfactual', async () => {
  const timestamp = isoHoursAgo(1);
  const knownCalls = [{ sessionId: 'cost-session', callId: 'cost-call', timestamp, provider: 'anthropic', model: 'claude-sonnet-5', inputTokens: 70, cachedInputTokens: 20, cacheWriteTokens: 10, cacheWrite5mTokens: 10, cacheWrite1hTokens: 0, cacheWriteTtl: '5m', outputTokens: 30, reasoningTokens: null, totalTokens: 130, reportedCost: null, status: 'ok', tokenProvenance: 'reported' }];
  const response = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
  const fetcher = async (url) => url.endsWith('/claude-sonnet-5')
    ? response({ id: 'claude-sonnet-5', provider: 'anthropic', input_cost_per_token: 0.000002, cache_read_input_token_cost: 0.0000002, cache_creation_input_token_cost: 0.0000025, output_cost_per_token: 0.00001 })
    : response({ data: [] }, 404);
  const readFor = (modelCalls) => ({
    sessions: [{ harness: 'claude', sessionId: 'cost-session', title: null, projectCwd: 'D:\\project', startedAt: timestamp, endedAt: timestamp, parentSessionId: null, isSubagent: false, partial: false, sourceVersion: null }],
    modelCalls,
    toolCalls: [],
    lifecycle: [],
    coverage: { filesRead: 1, recordsRead: modelCalls.length, recordsSkipped: 0, partialSessions: 0, warnings: [] },
  });
  const scope = { cwd: 'D:\\project', allProjects: false, since: new Date('2026-09-01T00:00:00.000Z') };
  const pricing = await resolveApiPricing(knownCalls, 'claude', 'litellm', fetcher, 'https://catalog.test/model_catalog');
  const priced = analyseAudit(scope, readFor(knownCalls), 'claude', pricing);
  assert.equal(priced.report.apiEquivalentCost.total.value, 0.000469);
  assert.equal(priced.report.apiEquivalentCost.allUncachedTotal.value, 0.0005);
  assert.equal(priced.report.apiEquivalentCost.difference.value, 0.000031);
  assert.equal(priced.report.apiEquivalentCost.differencePercent.value, 6.2);
  assert.equal(priced.report.apiEquivalentCost.coveragePercent.value, 100);
  assert.equal(priced.report.apiEquivalentCost.source.effectiveDate, null);
  assert.equal(priced.report.apiEquivalentCost.total.provenance, 'estimated');
  assert.equal(priced.report.cacheEconomics.cacheSavings.value, 0.000031);

  const mixedCalls = knownCalls.map((call) => ({ ...call, provider: null })).concat([{ sessionId: 'cost-session', callId: 'unpriced-call', timestamp, provider: 'other-provider', model: 'claude-sonnet-5-preview', inputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 5, reasoningTokens: null, totalTokens: 15, reportedCost: null, status: 'ok', tokenProvenance: 'reported' }]);
  const mixedPricing = await resolveApiPricing(mixedCalls, 'claude', 'litellm', fetcher, 'https://catalog.test/model_catalog');
  const mixed = analyseAudit(scope, readFor(mixedCalls), 'claude', mixedPricing);
  assert.equal(mixed.report.apiEquivalentCost.total.value, 0.000469);
  assert.equal(mixed.report.apiEquivalentCost.allUncachedTotal.value, 0.0005);
  assert.equal(mixed.report.apiEquivalentCost.difference.value, 0.000031);
  assert.equal(mixed.report.apiEquivalentCost.differencePercent.value, 6.2);
  assert.equal(mixed.report.apiEquivalentCost.total.provenance, 'estimated');
  assert.equal(mixed.report.apiEquivalentCost.coveragePercent.value, 89.66);
  assert.equal(mixed.report.cacheEconomics.cacheReadRatePercent.value, 18.18);
  assert.equal(mixed.report.cacheEconomics.cacheSavings.value, 0.000031);
  assert.equal(mixed.report.cacheEconomics.cacheSavingsPercent.value, 6.2);
  assert.match(mixed.report.apiEquivalentCost.limitations.join(' '), /priced Usage|unpriced.*excluded/i);
  const mixedChineseText = renderText(mixed, 'zh-CN');
  assert.match(mixedChineseText, /定价时根据所选 Harness 推断 Provider：anthropic/);
  assert.match(mixedChineseText, /Provider 与所选 Harness 不匹配：other-provider/);
  assert.match(mixedChineseText, /没有找到 other-provider\/claude-sonnet-5-preview 的价格条目/);
  assert.match(mixedChineseText, /方法：缓存读取 Token 总量除以分母/);
  assert.doesNotMatch(mixedChineseText, /Provider was derived|no resolved price entry|cache-read Token count numerator/);

  const lowCoverageCalls = knownCalls.concat([{ sessionId: 'cost-session', callId: 'low-coverage-unpriced-call', timestamp, provider: 'other-provider', model: 'unknown-model', inputTokens: 1000, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 5, reasoningTokens: null, totalTokens: 1005, reportedCost: null, status: 'ok', tokenProvenance: 'reported' }]);
  const lowCoverage = analyseAudit(scope, readFor(lowCoverageCalls), 'claude', mixedPricing);
  assert.equal(lowCoverage.report.apiEquivalentCost.coveragePercent.value, 11.45);
  const lowCoverageHtml = renderHtml(lowCoverage, 'zh-CN');
  assert.match(lowCoverageHtml, /API 折算/);
  assert.match(lowCoverageHtml, /\$0\.000469/);
  assert.match(lowCoverageHtml, /首次请求 Token 中位数/);
  assert.match(lowCoverageHtml, /costVisible":true/);
});

test('cost remains unavailable when no selected Usage has compatible pricing', async () => {
  const timestamp = isoHoursAgo(1);
  const calls = [{ sessionId: 'unpriced-session', callId: 'unpriced-call', timestamp, provider: 'anthropic', model: 'unknown-model', inputTokens: 100, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 10, reasoningTokens: null, totalTokens: 110, reportedCost: null, status: 'ok', tokenProvenance: 'reported' }];
  const pricing = { source: { kind: 'litellm', endpoint: 'https://catalog.test/model_catalog', retrievedAt: timestamp, effectiveDate: null, currency: 'USD' }, rates: [], limitations: ['LiteLLM price lookup failed'] };
  const result = analyseAudit(
    { cwd: 'D:\\project', allProjects: false, since: new Date('2026-09-01T00:00:00.000Z') },
    { sessions: [{ harness: 'claude', sessionId: 'unpriced-session', title: null, projectCwd: 'D:\\project', startedAt: timestamp, endedAt: timestamp, parentSessionId: null, isSubagent: false, partial: false, sourceVersion: null }], modelCalls: calls, toolCalls: [], lifecycle: [], coverage: { filesRead: 1, recordsRead: 1, recordsSkipped: 0, partialSessions: 0, warnings: [] } },
    'claude',
    pricing,
  );
  assert.equal(result.report.apiEquivalentCost.total.value, null);
  assert.equal(result.report.cacheEconomics.cacheSavings.value, null);
  assert.equal(result.report.apiEquivalentCost.coveragePercent.value, 0);
});

test('Chinese presentation localizes first-request limitations', () => {
  const timestamp = '2026-09-10T08:09:10.000Z';
  const result = analyseAudit(
    { cwd: 'D:\\project', allProjects: false, since: new Date('2026-09-01T00:00:00.000Z') },
    {
      sessions: [{ harness: 'claude', sessionId: 'presentation-session', title: null, projectCwd: 'D:\\project', startedAt: timestamp, endedAt: timestamp, parentSessionId: null, isSubagent: false, partial: false, sourceVersion: null }],
      modelCalls: [],
      toolCalls: [],
      lifecycle: [],
      coverage: { filesRead: 1, recordsRead: 1, recordsSkipped: 0, partialSessions: 0, warnings: [] },
    },
    'claude',
    { source: { kind: 'litellm', version: 'litellm-model-catalog', retrievedAt: timestamp, effectiveDate: null, currency: 'USD', unit: 'USD per 1M tokens' }, rates: [], limitations: [] },
  );
  const text = renderText(result, 'zh-CN');
  assert.match(text, /首次请求 Token 量是观测到的最早请求大小，不是可以精确剥离的启动成本/);
  assert.match(text, /没有有效时间戳的 Session，不计入首次请求完整度/);
  assert.doesNotMatch(text, /Sessions without a timestamped valid ModelCall|is an observed earliest request size/);
});

test('LiteLLM pricing lookup uses exact model/provider fields, cache prices, and long-context overrides', async () => {
  const timestamp = isoHoursAgo(1);
  const calls = [
    { sessionId: 'litellm-session', callId: 'litellm-call', timestamp, provider: null, model: 'gpt-5.6-sol', inputTokens: 1100, cachedInputTokens: 100, cacheWriteTokens: 0, outputTokens: 10, reasoningTokens: 0, totalTokens: 1110, reportedCost: null, status: 'ok', tokenProvenance: 'reported' },
  ];
  const requests = [];
  const response = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
  const fetcher = async (url) => {
    requests.push(url);
    if (url.endsWith('/gpt-5.6-sol')) return response({ id: 'gpt-5.6-sol', provider: 'openai', input_cost_per_token: 0.000002, output_cost_per_token: 0.00001, cache_read_input_token_cost: 0.0000002, cache_creation_input_token_cost: 0.0000025, input_cost_per_token_above_1k_tokens: 0.000004, cache_read_input_token_cost_above_1k_tokens: 0.0000004 });
    return response({ data: [] }, 404);
  };
  const pricing = await resolveApiPricing(calls, 'codex', 'litellm', fetcher, 'https://catalog.test/model_catalog');
  const result = analyseAudit(
    { cwd: 'D:\\project', allProjects: false, since: new Date('2026-09-01T00:00:00.000Z') },
    { sessions: [{ harness: 'codex', sessionId: 'litellm-session', title: null, projectCwd: 'D:\\project', startedAt: timestamp, endedAt: timestamp, parentSessionId: null, isSubagent: false, partial: false, sourceVersion: null }], modelCalls: calls, toolCalls: [], lifecycle: [], coverage: { filesRead: 1, recordsRead: 1, recordsSkipped: 0, partialSessions: 0, warnings: [] } },
    'codex',
    pricing,
  );
  assert.equal(requests.length, 1);
  assert.match(requests[0], /gpt-5\.6-sol$/);
  assert.equal(pricing.source.kind, 'litellm');
  assert.equal(pricing.source.effectiveDate, null);
  assert.equal(result.report.apiEquivalentCost.total.value, 0.00414);
  assert.equal(result.report.apiEquivalentCost.total.provenance, 'estimated');
  assert.equal(result.report.apiEquivalentCost.coveragePercent.value, 100);
  assert.match(result.report.apiEquivalentCost.total.method, /LiteLLM model catalog/);
  assert.match(result.report.apiEquivalentCost.total.method, /Harness-to-Provider mapping/);
});

test('LiteLLM lookup falls back to exact Provider/model search and degrades without network', async () => {
  const calls = [{ sessionId: 'lookup-session', callId: 'lookup-call', timestamp: isoHoursAgo(1), provider: 'openai', model: 'catalog-model', inputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 5, reasoningTokens: 0, totalTokens: 15, reportedCost: null, status: 'ok', tokenProvenance: 'reported' }];
  const requests = [];
  const response = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
  const fetcher = async (url) => {
    requests.push(url);
    if (url.endsWith('/catalog-model')) return response({ error: 'not found' }, 404);
    return response({ data: [
      { id: 'catalog-model-extra', provider: 'openai', input_cost_per_token: 0.000001, output_cost_per_token: 0.000001 },
      { id: 'catalog-model', provider: 'openai', input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 },
    ] });
  };
  const pricing = await resolveApiPricing(calls, 'codex', 'litellm', fetcher, 'https://catalog.test/model_catalog');
  assert.equal(requests.length, 2);
  assert.match(requests[1], /provider=openai/);
  assert.equal(pricing.source.kind, 'litellm');
  assert.equal(pricing.rates[0].model, 'catalog-model');

  const failed = await resolveApiPricing(calls, 'codex', 'litellm', async () => { throw new Error('offline'); }, 'https://catalog.test/model_catalog');
  assert.equal(failed.rates.some((rate) => rate.model === 'catalog-model'), false);
  assert.match(failed.limitations.join(' '), /LiteLLM price lookup failed/);
});

test('first-request burden selects one earliest deduplicated call and separates source-proven Session identities', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-first-request-'));
  const project = path.join(root, 'project');
  const codexHome = path.join(root, 'codex-home');
  const sessionsRoot = path.join(codexHome, 'sessions', '2026', '09', '10');
  const htmlPath = path.join(root, 'first.html');
  const sharePath = path.join(root, 'first.md');
  await mkdir(project, { recursive: true });
  await mkdir(sessionsRoot, { recursive: true });
  const topTime = isoHoursAgo(3);
  const subTime = isoHoursAgo(2.5);
  const topRecords = [
    { timestamp: topTime, type: 'session_meta', payload: { id: 'first-top', cwd: project, source: 'user' } },
    { timestamp: topTime, type: 'turn_context', payload: { turn_id: 'first-top-turn-z', cwd: project, model: 'gpt-4.1', model_provider: 'openai' } },
    { timestamp: topTime, type: 'event_msg', payload: { type: 'raw_response_completed', response_id: 'z-first', usage: { input_tokens: 999, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0, total_tokens: 1000 } } },
    { timestamp: topTime, type: 'event_msg', payload: { type: 'raw_response_completed', response_id: 'a-first', usage: { input_tokens: 100, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 110 } } },
    { timestamp: isoHoursAgo(2), type: 'turn_context', payload: { turn_id: 'first-top-turn-2', cwd: project, model: 'gpt-4.1', model_provider: 'openai' } },
    { timestamp: isoHoursAgo(2), type: 'event_msg', payload: { type: 'raw_response_completed', response_id: 'top-second', usage: { input_tokens: 10, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 } } },
  ];
  const subRecords = [
    { timestamp: subTime, type: 'session_meta', payload: { id: 'first-sub', cwd: project, source: { type: 'subagent' } } },
    { timestamp: subTime, type: 'turn_context', payload: { turn_id: 'first-sub-turn', cwd: project, model: 'gpt-4.1', model_provider: 'openai' } },
    { timestamp: subTime, type: 'event_msg', payload: { type: 'raw_response_completed', response_id: 'sub-first', usage: { input_tokens: 200, cached_input_tokens: 100, cache_write_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 210 } } },
    { timestamp: isoHoursAgo(1.5), type: 'event_msg', payload: { type: 'raw_response_completed', response_id: 'sub-second', usage: { input_tokens: 20, cached_input_tokens: 10, cache_write_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 25 } } },
  ];
  await writeFile(path.join(sessionsRoot, 'rollout-first-top.jsonl'), topRecords.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
  await writeFile(path.join(sessionsRoot, 'rollout-first-sub.jsonl'), subRecords.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
  try {
    const env = { CODEX_HOME: codexHome };
    const { stdout } = await runAudit(['inspect', '--harness', 'codex', '--cwd', project, '--since', '7d', '--format', 'json'], env);
    const result = JSON.parse(stdout);
    const first = result.report.firstRequestBurden;
    assert.equal(first.sessionCount.value, 2);
    assert.equal(first.validFirstRequestCount.value, 2);
    assert.equal(first.coveragePercent.value, 100);
    assert.equal(first.medianTokens.value, 160);
    assert.equal(first.totalTokens.value, 320);
    assert.equal(first.inputTokens.value, 200);
    assert.equal(first.cachedInputTokens.value, 100);
    assert.equal(first.cacheReadRatePercent.value, 33.33);
    assert.equal(first.coldSessionCount.value, 1);
    assert.equal(first.coldSessionRatePercent.value, 50);
    assert.equal(first.topLevel.medianTokens.value, 110);
    assert.equal(first.subagent.medianTokens.value, 210);
    assert.equal(first.identityCoveragePercent.value, 100);

    const { stdout: textOutput } = await runAudit(['inspect', '--harness', 'codex', '--cwd', project, '--since', '7d', '--format', 'text', '--locale', 'zh-CN', '--view', 'usage'], env);
    assert.match(textOutput, /首次请求 Token 量/);
    assert.match(textOutput, /160/);
    await runAudit(['inspect', '--harness', 'codex', '--cwd', project, '--since', '7d', '--format', 'json', '--html', htmlPath], env);
    await runAudit(['inspect', '--harness', 'codex', '--cwd', project, '--since', '7d', '--format', 'json', '--share', sharePath], env);
    assert.match(await readFile(htmlPath, 'utf8'), /首次请求 Token 量|First-request burden/);
    assert.match(await readFile(sharePath, 'utf8'), /首次请求 Token 量|First-request burden/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Claude Code Skill evidence keeps listing, invocation, attribution, and final cost snapshot distinct', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-claude-skills-'));
  const project = path.join(root, 'project');
  const claudeHome = path.join(root, 'claude-home');
  const transcriptRoot = path.join(claudeHome, 'projects', 'project');
  await mkdir(project, { recursive: true });
  await mkdir(transcriptRoot, { recursive: true });
  const timestamp = isoHoursAgo(1);
  const records = [
    { type: 'system', session_id: 'claude-skills', cwd: project, timestamp, available_skills: ['listed-skill', 'attributed-skill'] },
    { type: 'assistant', session_id: 'claude-skills', cwd: project, timestamp, provider: 'anthropic', attributionSkill: 'attributed-skill', message: { id: 'attributed-call', role: 'assistant', model: 'claude-sonnet-5', usage: { input_tokens: 70, cache_read_input_tokens: 20, cache_creation_input_tokens: 10, cache_creation: { ephemeral_5m_input_tokens: 10 }, output_tokens: 30, total_tokens: 130 }, content: [{ type: 'tool_use', id: 'ordinary-tool', name: 'Read', input: { file: 'do-not-return.ts' } }] } },
    { type: 'assistant', session_id: 'claude-skills', cwd: project, timestamp, provider: 'anthropic', attributionSkill: 'attributed-skill', message: { id: 'attributed-call', role: 'assistant', model: 'claude-sonnet-5', usage: { input_tokens: 70, cache_read_input_tokens: 20, cache_creation_input_tokens: 10, cache_creation: { ephemeral_5m_input_tokens: 10 }, output_tokens: 30, total_tokens: 130 } } },
    { type: 'assistant', session_id: 'claude-skills', cwd: project, timestamp, provider: 'anthropic', message: { id: 'fallback-call', role: 'assistant', model: 'claude-sonnet-5', usage: { input_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 5, total_tokens: 25 }, content: [{ type: 'tool_use', id: 'skill-tool-1', name: 'Skill', input: { skill: 'fallback-skill' } }] } },
    { type: 'user', session_id: 'claude-skills', cwd: project, timestamp, message: { role: 'user', content: 'attributed-skill is only a prose marker and must not be inferred as a call' } },
    { type: 'cost-state', session_id: 'claude-skills', cwd: project, timestamp, totalCostUSD: 1.25 },
    { type: 'cost-state', session_id: 'claude-skills', cwd: project, timestamp, totalCostUSD: 2.5 },
  ];
  await writeFile(path.join(transcriptRoot, 'claude-skills.jsonl'), records.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
  try {
    const { stdout } = await runAudit(['inspect', '--harness', 'claude', '--cwd', project, '--since', '7d', '--format', 'json'], { CLAUDE_CONFIG_DIR: claudeHome });
    const result = JSON.parse(stdout);
    const byName = new Map(result.report.skills.map((skill) => [skill.name, skill]));
    assert.equal(result.summary.reportedCost.value, 2.5);
    assert.equal(byName.get('listed-skill').state, 'available');
    assert.equal(byName.get('listed-skill').invocationCount.value, 0);
    assert.equal(byName.get('attributed-skill').state, 'attributed');
    assert.equal(byName.get('attributed-skill').invocationCount.value, 1);
    assert.equal(byName.get('attributed-skill').sessionCount.value, 1);
    assert.equal(byName.get('attributed-skill').attributedTokens.value, 130);
    const attributedCost = byName.get('attributed-skill').attributedApiEquivalentCost;
    assert.equal(attributedCost.value === null || typeof attributedCost.value === 'number', true);
    assert.equal(attributedCost.value === null ? attributedCost.provenance : 'estimated', attributedCost.value === null ? 'unavailable' : 'estimated');
    assert.equal(byName.get('attributed-skill').evidenceCoveragePercent.value, 100);
    assert.equal(byName.get('fallback-skill').state, 'invoked');
    assert.equal(byName.get('fallback-skill').invocationCount.value, 1);
    assert.equal(byName.get('fallback-skill').attributedTokens.value, null);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('do-not-return.ts'), false);
    assert.equal(serialized.includes('attributed-skill is only a prose marker'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Codex Skill evidence recognizes structured input and verifiable resource or script relations without exposing paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-codex-skills-'));
  const project = path.join(root, 'project');
  const codexHome = path.join(root, 'codex-home');
  const sessionsRoot = path.join(codexHome, 'sessions', '2026', '09', '10');
  const htmlPath = path.join(root, 'skills.html');
  const sharePath = path.join(root, 'skills.md');
  await mkdir(project, { recursive: true });
  await mkdir(sessionsRoot, { recursive: true });
  const timestamp = isoHoursAgo(1);
  const records = [
    { timestamp, type: 'session_meta', payload: { id: 'codex-skills', cwd: project, source: 'user' } },
    { timestamp, type: 'event_msg', payload: { type: 'skill_listing', skills: [{ name: 'listing-only-skill' }, { name: 'explicit-skill' }] } },
    { timestamp, type: 'turn_context', payload: { turn_id: 'skill-turn', cwd: project, model: 'gpt-4.1', model_provider: 'openai' } },
    { timestamp, type: 'event_msg', payload: { type: 'skill_input', id: 'explicit-input-1', skill_name: 'explicit-skill' } },
    { timestamp, type: 'event_msg', payload: { type: 'skill_input', id: 'explicit-input-1', skill_name: 'explicit-skill' } },
    { timestamp, type: 'response_item', payload: { type: 'function_call', name: 'read_file', arguments: { path: 'C:\\private\\.agents\\skills\\resource-skill\\SKILL.md' } } },
    { timestamp, type: 'response_item', payload: { type: 'shell_command', command: 'node C:\\private\\.agents\\skills\\script-skill\\scripts\\run.js' } },
    { timestamp, type: 'event_msg', payload: { type: 'raw_response_completed', response_id: 'skill-response', usage: { input_tokens: 100, cached_input_tokens: 20, cache_write_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 110 } } },
  ];
  await writeFile(path.join(sessionsRoot, 'rollout-codex-skills.jsonl'), records.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
  try {
    const env = { CODEX_HOME: codexHome };
    const { stdout } = await runAudit(['inspect', '--harness', 'codex', '--cwd', project, '--since', '7d', '--format', 'json'], env);
    const result = JSON.parse(stdout);
    const byName = new Map(result.report.skills.map((skill) => [skill.name, skill]));
    assert.equal(byName.get('listing-only-skill').state, 'available');
    assert.equal(byName.get('listing-only-skill').invocationCount.value, 0);
    assert.equal(byName.get('explicit-skill').state, 'attributed');
    assert.equal(byName.get('explicit-skill').invocationCount.value, 1);
    assert.equal(byName.get('explicit-skill').attributedTokens.value, 110);
    assert.equal(byName.get('resource-skill').state, 'attributed');
    assert.equal(byName.get('resource-skill').evidenceTypes.includes('resource-read'), true);
    assert.equal(byName.get('script-skill').state, 'attributed');
    assert.equal(byName.get('script-skill').evidenceTypes.includes('script-execution'), true);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('C:\\private'), false);
    assert.equal(serialized.includes('SKILL.md'), false);
    assert.equal(serialized.includes('run.js'), false);

    const { stdout: textOutput } = await runAudit(['inspect', '--harness', 'codex', '--cwd', project, '--since', '7d', '--format', 'text', '--view', 'usage'], env);
    assert.match(textOutput, /Skill evidence/i);
    await runAudit(['inspect', '--harness', 'codex', '--cwd', project, '--since', '7d', '--format', 'json', '--html', htmlPath], env);
    await runAudit(['inspect', '--harness', 'codex', '--cwd', project, '--since', '7d', '--format', 'json', '--share', sharePath], env);
    assert.match(await readFile(htmlPath, 'utf8'), /Skill evidence/);
    assert.match(await readFile(sharePath, 'utf8'), /Skill evidence/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('joint evidence facts stay aligned across JSON, text, share, and standalone HTML', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-joint-'));
  const project = path.join(root, 'project');
  const claudeHome = path.join(root, 'claude-home');
  const transcriptRoot = path.join(claudeHome, 'projects', 'project');
  const htmlPath = path.join(root, 'joint.html');
  const sharePath = path.join(root, 'joint.md');
  await mkdir(project, { recursive: true });
  await mkdir(transcriptRoot, { recursive: true });
  const timestamp = isoHoursAgo(1);
  await writeFile(path.join(transcriptRoot, 'joint-session.jsonl'), [
    { type: 'user', session_id: 'joint-session', cwd: project, timestamp, message: { role: 'user', content: 'PRIVATE_PROMPT_JOINT' } },
    { type: 'system', session_id: 'joint-session', cwd: project, timestamp, available_skills: ['joint-skill'] },
    { type: 'assistant', session_id: 'joint-session', cwd: project, provider: 'anthropic', attributionSkill: 'joint-skill', timestamp, message: { id: 'joint-call', role: 'assistant', model: 'claude-sonnet-5', usage: { input_tokens: 20, cache_read_input_tokens: 10, cache_creation_input_tokens: 5, cache_creation: { ephemeral_5m_input_tokens: 5 }, output_tokens: 5, total_tokens: 40 } } },
  ].map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
  try {
    const env = { CLAUDE_CONFIG_DIR: claudeHome };
    const baseArgs = ['inspect', '--harness', 'claude', '--cwd', project, '--since', '7d'];
    const { stdout: jsonOutput } = await runAudit([...baseArgs, '--locale', 'zh-CN', '--format', 'json', '--html', htmlPath, '--share', sharePath], env);
    const { stdout: textOutput } = await runAudit([...baseArgs, '--format', 'text', '--view', 'full'], env);
    const html = await readFile(htmlPath, 'utf8');
    const share = await readFile(sharePath, 'utf8');
    const result = JSON.parse(jsonOutput);
    assert.equal(result.report.cacheEconomics.cacheReadRatePercent.value, 28.57);
    assert.equal(result.report.cacheEconomics.cacheWriteRatePercent.value, 14.29);
    assert.equal(result.report.cacheEconomics.cacheSavingsPercent.value, 12.92);
    assert.equal(result.report.firstRequestBurden.medianTokens.value, 40);
    assert.equal(result.report.skills.find((skill) => skill.name === 'joint-skill').attributedTokens.value, 40);
    for (const output of [jsonOutput, textOutput, html, share]) {
      assert.match(output, /28\.57/);
      assert.match(output, /14\.29/);
      assert.match(output, /12\.92/);
      assert.match(output, /joint-skill/);
      assert.equal(output.includes('PRIVATE_PROMPT_JOINT'), false);
    }
    assert.match(html, /\d{4}\.\d{2}\.\d{2}/);
    assert.doesNotMatch(html, /\d{4}年\d{1,2}月\d{1,2}日/);
    assert.doesNotMatch(html, /title="精确值：\d{4}-\d{2}-\d{2}T/);
    assert.doesNotMatch(html, /证据标识|Evidence markers|[●◆≈]\s/);
    assert.doesNotMatch(html, /source value|calculated from records|approximation|missing source data|listing 只表示可用/);
    assert.match(html, /<meta name="viewport"/i);
    assert.match(html, /<table/);
    assert.match(html, /aria-/i);
    assert.doesNotMatch(html, /<script\s+src=/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
