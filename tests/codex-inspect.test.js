const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, mkdir, writeFile, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { zstdCompressSync } = require('node:zlib');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const cliPath = path.resolve(__dirname, '..', 'dist', 'src', 'cli.js');
const bundledCodexPath = path.resolve(__dirname, '..', 'skills', 'where-tokens-went-codex', 'scripts', 'where-tokens-went.js');

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

test('Codex Skill makes report delivery an atomic HTML-and-diagnosis workflow', async () => {
  const skill = await readFile(path.resolve(__dirname, '..', 'skills', 'where-tokens-went-codex', 'SKILL.md'), 'utf8');
  assert.match(skill, /complete only after both steps occur in the same conversation turn/i);
  assert.match(skill, /generate and open the deterministic local HTML, then give one explicit Host Agent Finding/i);
  assert.match(skill, /The HTML is deterministic evidence and diagnostic signals, not the Finding itself/i);
  assert.match(skill, /Do not end the turn after returning a report path or opening the HTML/i);
  assert.match(skill, /do not return a diagnosis without the requested report/i);
});

test('other Harness Skills preserve the same atomic report and evidence contract', async () => {
  for (const [name, harness] of [['claude', 'claude'], ['pi', 'pi'], ['deepseek', 'deepseek']]) {
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
    ['pi', '.pi', 'skills', 'where-tokens-went-pi'],
    ['deepseek', '.agents', 'skills', 'where-tokens-went-deepseek'],
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
    pi: path.join(root, '.pi', 'skills', 'where-tokens-went-pi', 'scripts', 'where-tokens-went.js'),
    deepseek: path.join(root, '.agents', 'skills', 'where-tokens-went-deepseek', 'scripts', 'where-tokens-went.js'),
  };
  const envByHarness = {
    codex: { CODEX_HOME: path.join(root, 'missing-codex') },
    claude: { CLAUDE_CONFIG_DIR: path.join(root, 'missing-claude') },
    pi: { PI_SESSIONS_DIR: path.join(root, 'missing-pi') },
    deepseek: { DSH_JSONL_ROOT: path.join(root, 'missing-deepseek') },
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
    assert.match(stdout, /Sessions: 2 \(derived\); top-level tasks: 1 \(derived\); subagent Sessions: 1 \(derived\)/);
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
    assert.match(html, /title="精确值：126,000,000"/);
    assert.match(html, /id="token-trend" class="echart"/);
    assert.match(html, /renderer:'svg'/);
    assert.match(html, /table class="sortable"/);
    assert.match(html, /class="chart hourly-heatmap"/);
    assert.match(html, /viewBox="0 0 880/);
    assert.equal(html.includes('x="745"'), false);
    assert.match(html, /gpt-5\.6-terra/);
    assert.match(html, /Tare current report/);
    assert.match(html, /未命名 Session · tare-untitled/);
    assert.match(html, /class="percentage"[^>]*>100%</);
    assert.equal(/2026-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}Z/.test(html), false);
    assert.equal((html.match(/已报告/g) ?? []).length <= 1, true);
    assert.match(html, /一个工具结果估算重复进入上下文/);
    assert.match(html, /方法：/);
    assert.equal(html.includes('long_session'), false);
    assert.equal((html.match(/2 个 Codex Session 包含尚未支持的计量记录/g) ?? []).length, 1);
    assert.equal(html.includes('A Codex Session contains unsupported accounting records'), false);
    assert.match(html, /Provider 额度/);
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
    assert.match(windowText, /Provider 额度/);
    assert.match(windowText, /不可用/);
    assert.match(windowText, /不是 Provider 额度/);

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

test('Pi Skill path reports usage, reported cost, and branch-safe tool evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-pi-'));
  const project = path.join(root, 'project');
  const sessions = path.join(root, 'pi-sessions');
  await mkdir(project, { recursive: true });
  await mkdir(sessions, { recursive: true });

  const records = [
    { type: 'session', version: 3, id: 'pi-session', timestamp: isoHoursAgo(3), cwd: project },
    {
      type: 'message',
      id: 'pi-entry-1',
      parentId: null,
      timestamp: isoHoursAgo(2.9),
      message: {
        role: 'assistant',
        provider: 'openai',
        model: 'gpt-5.6-sol',
        usage: { input: 100, output: 40, cacheRead: 20, cacheWrite: 5, totalTokens: 140, cost: { total: 0.01 } },
        content: [{ type: 'toolCall', id: 'pi-tool-1', name: 'read', arguments: { file: 'secret.ts' } }],
      },
    },
    {
      type: 'message',
      id: 'pi-entry-2',
      parentId: 'pi-entry-1',
      timestamp: isoHoursAgo(2.8),
      message: { role: 'toolResult', toolCallId: 'pi-tool-1', toolName: 'read', content: 'PI_TOOL_SECRET '.repeat(100), isError: false },
    },
    {
      type: 'message',
      id: 'pi-entry-3',
      parentId: 'pi-entry-2',
      timestamp: isoHoursAgo(1.8),
      message: {
        role: 'assistant',
        provider: 'openai',
        model: 'gpt-5.6-sol',
        usage: { input: 110, output: 50, cacheRead: 10, cacheWrite: 5, totalTokens: 160, cost: { total: 0.02 } },
        content: [{ type: 'text', text: 'safe summary' }],
      },
    },
    {
      type: 'message',
      id: 'pi-without-time',
      parentId: 'pi-entry-3',
      message: { role: 'assistant', usage: { input: 10, output: 5, totalTokens: 15 }, content: [] },
    },
    { type: 'unknown_usage_event', id: 'pi-unknown', parentId: 'pi-entry-3', timestamp: isoHoursAgo(1.75), payload: { usage: { total: 9999 } } },
    {
      type: 'message',
      id: 'pi-inactive-branch',
      parentId: 'pi-entry-1',
      timestamp: isoHoursAgo(1.72),
      message: { role: 'assistant', usage: { input: 900, output: 100, cacheRead: 10, cacheWrite: 5, totalTokens: 1015, cost: { total: 0.5 } }, content: [{ type: 'toolCall', id: 'pi-inactive-tool', name: 'read', arguments: { file: 'inactive-secret.ts' } }] },
    },
    {
      type: 'message',
      id: 'pi-inactive-result',
      parentId: 'pi-inactive-branch',
      timestamp: isoHoursAgo(1.71),
      message: { role: 'toolResult', toolCallId: 'pi-inactive-tool', content: 'INACTIVE_SECRET '.repeat(500), isError: false },
    },
    { type: 'compaction', id: 'pi-entry-4', parentId: 'pi-entry-3', timestamp: isoHoursAgo(1.7), tokensBefore: 500 },
  ];
  await writeFile(path.join(sessions, 'pi-session.jsonl'), records.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');

  try {
    const { stdout } = await runAudit(
      ['inspect', '--harness', 'pi', '--cwd', project, '--since', '7d', '--format', 'json'],
      { PI_SESSIONS_DIR: sessions },
    );
    const result = JSON.parse(stdout);

    assert.equal(result.scope.harness, 'pi');
    assert.equal(result.summary.sessionCount.value, 1);
    assert.equal(result.summary.modelCallCount.value, 3);
    assert.equal(result.summary.totalTokens.value, 1315);
    assert.equal(result.summary.topSessionId.value, 'pi-session');
    assert.equal(result.summary.topSessionTokens.value, 1315);
    assert.equal(result.rankings.sessions[0].key, 'pi-session');
    assert.equal(result.rankings.sessions[0].value.value, 1315);
    assert.equal(result.summary.activeBranchModelCallCount.value, 2);
    assert.equal(result.summary.activeBranchTokens.value, 300);
    assert.equal(result.summary.reportedCost.value, 0.53);
    assert.equal(result.summary.reportedCost.provenance, 'reported');
    assert.equal(result.summary.toolCallCount.value, 1);
    assert.equal(result.coverage.recordsSkipped, 1);
    assert.equal(result.coverage.partialSessions, 1);
    assert.match(result.coverage.warnings.join(' '), /timestamp|time/i);
    assert.match(result.coverage.warnings.join(' '), /unsupported accounting/i);
    assert.equal(result.summary.pairedToolResultCount.value, 1);
    assert.equal(result.summary.estimatedToolAmplifiedTokens.value, 375);
    assert.equal(result.summary.extraLifecycleCount.value, 0);
                const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('PI_TOOL_SECRET'), false);
    assert.equal(serialized.includes('secret.ts'), false);
    assert.equal(serialized.includes('inactive-secret.ts'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('DeepSeek Harness Skill path reads zstd Session events without returning content', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-dsh-'));
  const project = path.join(root, 'project');
  const sessionFile = path.join(root, 'session.jsonl.zstd');
  await mkdir(project, { recursive: true });

  const records = [
    { type: 'header', sessionId: 'dsh-session', cwd: project, version: 1, time: isoHoursAgo(3) },
    { type: 'request/header', seq: 1, time: isoHoursAgo(2.9), data: { provider: 'deepseek', model: 'deepseek-chat' } },
    {
      type: 'assistant/message',
      seq: 2,
      time: isoHoursAgo(2.8),
      data: {
        stepId: 'step-1',
        messageId: 'message-1',
        usage: { inputTokens: 100, outputTokens: 30, cacheReadTokens: 20, cacheWriteTokens: 5, reasoningTokens: 10, totalTokens: 140 },
        content: [{ type: 'tool_call', callId: 'dsh-tool-1', name: 'read', arguments: { file: 'secret.ts' } }],
      },
    },
    { type: 'tool/result', seq: 3, time: isoHoursAgo(2.7), data: { callId: 'dsh-tool-1', name: 'read', result: 'DSH_SECRET '.repeat(200) } },
    {
      type: 'assistant/chunk',
      seq: 4,
      time: isoHoursAgo(2.5),
      data: { turn: 1, step: 2, chunk: { type: 'tool-call-delta', index: 0, id: 'dsh-packed-tool', name: 'read', argumentsDelta: '{"file":"' } },
    },
    {
      type: 'tool-call-chunks',
      seq0: 5,
      time0: Date.now() - 2.45 * 60 * 60 * 1000,
      data: { turn: 1, step: 2, index: 0, dt: [0, 2], id: 'packed-row-id', name: '', args: ['packed-secret.ts', '"}'] },
    },
    { type: 'tool/result', seq: 7, time: isoHoursAgo(2.3), data: { callId: 'dsh-packed-tool', name: 'read', result: 'PACKED_SECRET '.repeat(100) } },
    {
      type: 'assistant/message',
      seq: 8,
      time: isoHoursAgo(1.8),
      data: { stepId: 'step-2', messageId: 'message-2', usage: { inputTokens: 110, outputTokens: 40, totalTokens: 160 }, content: [] },
    },
    {
      type: 'text-chunks',
      seq0: 9,
      time0: Date.now() - 1.75 * 60 * 60 * 1000,
      data: { turn: 1, step: 2, index: 0, dt: [0, 4, 6], texts: ['safe', ' packed', ' delta'] },
    },
    {
      type: 'tool-call-chunks',
      seq0: 12,
      time0: Date.now() - 1.72 * 60 * 60 * 1000,
      data: { id: 'ambiguous-packed-row', args: ['not-enough-position-data'] },
    },
    { type: 'retry', seq: 13, time: isoHoursAgo(1.7), data: { attemptId: 'attempt-1' } },
    { type: 'assistant/message', seq: 14, data: { messageId: 'message-without-time', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, content: [] } },
    { type: 'compaction/start', seq: 15, time: isoHoursAgo(1.6), data: {} },
  ];
  const logical = records.map((record) => JSON.stringify(record)).join('\n') + '\n';
  const split = Math.floor(logical.length / 2);
  const tornTail = zstdCompressSync(Buffer.from(JSON.stringify({ type: 'assistant/message', seq: 15, data: { usage: { inputTokens: 999, outputTokens: 1, totalTokens: 1000 } } }) + '\n', 'utf8'));
  await writeFile(sessionFile, Buffer.concat([
    zstdCompressSync(Buffer.from(logical.slice(0, split), 'utf8')),
    zstdCompressSync(Buffer.from(logical.slice(split), 'utf8')),
    tornTail.subarray(0, Math.max(1, Math.floor(tornTail.length / 2))),
  ]));

  try {
    const { stdout } = await runAudit(
      ['inspect', '--harness', 'deepseek', '--cwd', project, '--since', '7d', '--format', 'json'],
      { DSH_SESSION_JSONL: sessionFile },
    );
    const result = JSON.parse(stdout);
    assert.equal(result.scope.harness, 'deepseek');
    assert.equal(result.summary.sessionCount.value, 1);
    assert.equal(result.summary.modelCallCount.value, 2);
    assert.equal(result.summary.totalTokens.value, 300);
    assert.equal(result.summary.toolCallCount.value, 2);
    assert.equal(result.summary.pairedToolResultCount.value, 2);
    assert.equal(result.summary.extraLifecycleCount.value, 1);
    assert.equal(result.coverage.partialSessions, 1);
    assert.match(result.coverage.warnings.join(' '), /durable|decode|partial/i);
    assert.match(result.coverage.warnings.join(' '), /timestamp|time/i);
    assert.match(result.coverage.warnings.join(' '), /unsupported/i);
    assert.equal(result.checks.find((check) => check.id === 'tool_amplification').id, 'tool_amplification');
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('DSH_SECRET'), false);
    assert.equal(serialized.includes('secret.ts'), false);
    assert.equal(serialized.includes('PACKED_SECRET'), false);
    assert.equal(serialized.includes('packed-secret.ts'), false);
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
    pi: { PI_SESSIONS_DIR: path.join(root, 'missing-pi') },
    deepseek: { DSH_JSONL_ROOT: path.join(root, 'missing-deepseek') },
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
