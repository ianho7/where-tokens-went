const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { zstdCompressSync } = require('node:zlib');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const cliPath = path.resolve(__dirname, '..', 'dist', 'src', 'cli.js');

function isoHoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

async function runAudit(args, env) {
  return execFileAsync(process.execPath, [cliPath, ...args], {
    env: { ...process.env, ...env },
    maxBuffer: 1024 * 1024,
  });
}

test('Codex Skill path reports a deterministic long-session finding without raw content', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-audit-codex-'));
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
      payload: { turn_id: 'turn-2', cwd: project, model: 'gpt-5.6-sol', model_provider: 'openai' },
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

  try {
    const { stdout: jsonText } = await runAudit(
      ['inspect', '--harness', 'codex', '--cwd', project, '--since', '7d', '--format', 'json'],
      { CODEX_HOME: codexHome },
    );
    const result = JSON.parse(jsonText);

    assert.equal(result.scope.harness, 'codex');
    assert.equal(result.scope.cwd, '<current-project>');
    assert.equal(result.coverage.filesRead, 1);
    assert.equal(result.summary.sessionCount.value, 1);
    assert.equal(result.summary.modelCallCount.value, 2);
    assert.equal(result.summary.totalTokens.value, 430);
    assert.equal(result.summary.totalTokens.provenance, 'reported');
    assert.equal(result.topFinding.kind, 'long_session');
    assert.equal(result.topFinding.evidence[0].source.sessionId, 'thread-codex-1');
    assert.match(result.topFinding.recommendation, /fresh|shorter|narrow/i);

    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('PRIVATE_PROMPT'), false);
    assert.equal(serialized.includes('secret-source.js'), false);
    assert.equal(serialized.includes('terminal-secret'), false);

    const { stdout: textOutput } = await runAudit(
      ['inspect', '--harness', 'codex', '--cwd', project, '--since', '7d', '--format', 'text'],
      { CODEX_HOME: codexHome },
    );
    assert.match(textOutput, /long_session/i);
    assert.equal(textOutput.includes('PRIVATE_PROMPT'), false);
    assert.equal(textOutput.includes('secret-source.js'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Codex scope keeps projects separate and deduplicates repeated response usage', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-audit-codex-scope-'));
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
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Codex report attributes repeated tool output and extra lifecycle calls', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-audit-codex-tools-'));
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

    assert.equal(result.summary.toolCallCount.value, 1);
    assert.equal(result.summary.pairedToolResultCount.value, 1);
    assert.equal(result.summary.extraLifecycleCount.value, 1);
    assert.equal(result.summary.estimatedToolAmplifiedTokens.provenance, 'estimated');
    assert.equal(result.topFinding.kind, 'tool_amplification');
    assert.match(result.topFinding.recommendation, /output|result|summar/i);
    assert.equal(JSON.stringify(result).includes('secret.ts'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Codex Global Audit widens projects without crossing the Harness boundary', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-audit-codex-global-'));
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
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-audit-claude-'));
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
    assert.equal(result.topFinding.kind, 'tool_amplification');
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('PRIVATE_PROMPT'), false);
    assert.equal(serialized.includes('TOOL_SECRET'), false);
    assert.equal(serialized.includes('secret-source.ts'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Pi Skill path reports usage, reported cost, and branch-safe tool evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-audit-pi-'));
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
    assert.equal(result.summary.modelCallCount.value, 2);
    assert.equal(result.summary.totalTokens.value, 300);
    assert.equal(result.summary.reportedCost.value, 0.03);
    assert.equal(result.summary.reportedCost.provenance, 'reported');
    assert.equal(result.summary.toolCallCount.value, 1);
    assert.equal(result.coverage.recordsSkipped, 1);
    assert.equal(result.coverage.partialSessions, 1);
    assert.equal(result.summary.pairedToolResultCount.value, 1);
    assert.equal(result.summary.extraLifecycleCount.value, 0);
    assert.equal(result.topFinding.kind, 'tool_amplification');
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('PI_TOOL_SECRET'), false);
    assert.equal(serialized.includes('secret.ts'), false);
    assert.equal(serialized.includes('inactive-secret.ts'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('DeepSeek Harness Skill path reads zstd Session events without returning content', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-audit-dsh-'));
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
      type: 'assistant/message',
      seq: 4,
      time: isoHoursAgo(1.8),
      data: { stepId: 'step-2', messageId: 'message-2', usage: { inputTokens: 110, outputTokens: 40, totalTokens: 160 }, content: [] },
    },
    {
      type: 'text-chunks',
      seq0: 5,
      time0: Date.now() - 1.75 * 60 * 60 * 1000,
      data: { turn: 1, step: 2, index: 0, dt: [0, 4, 6], texts: ['safe', ' packed', ' delta'] },
    },
    { type: 'retry', seq: 8, time: isoHoursAgo(1.7), data: { attemptId: 'attempt-1' } },
    { type: 'compaction/start', seq: 9, time: isoHoursAgo(1.6), data: {} },
  ];
  const logical = records.map((record) => JSON.stringify(record)).join('\n') + '\n';
  const split = Math.floor(logical.length / 2);
  await writeFile(sessionFile, Buffer.concat([
    zstdCompressSync(Buffer.from(logical.slice(0, split), 'utf8')),
    zstdCompressSync(Buffer.from(logical.slice(split), 'utf8')),
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
    assert.equal(result.summary.toolCallCount.value, 1);
    assert.equal(result.summary.pairedToolResultCount.value, 1);
    assert.equal(result.summary.extraLifecycleCount.value, 1);
    assert.equal(result.coverage.recordsSkipped, 0);
    assert.equal(result.topFinding.kind, 'tool_amplification');
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('DSH_SECRET'), false);
    assert.equal(serialized.includes('secret.ts'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('every supported Harness emits the same safe empty-result contract', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-audit-empty-'));
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
      assert.equal(result.topFinding, null);

      const { stdout: textOutput } = await runAudit([...args.slice(0, -1), 'text'], env);
      assert.match(textOutput, new RegExp(`Audit: ${harness}`));
      assert.match(textOutput, /unavailable/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
