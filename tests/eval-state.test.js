const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const cliPath = path.resolve(__dirname, '..', 'dist', 'src', 'cli.js');
function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { cwd: path.resolve(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject); child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('eval state machine rejects skips and resumes completed actions idempotently', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-state-test-'));
  const previousCodexHome = process.env.CODEX_HOME;
  try {
    const state = path.join(root, 'state.json');
    const skipped = await runCli(['eval', 'state', '--state', state, '--experiment', 'exp', '--action', 'generator']);
    assert.equal(skipped.code, 2);
    assert.match(skipped.stderr, /EVAL_STATE_ILLEGAL_ACTION/);
    const freeze = await runCli(['eval', 'state', '--state', state, '--experiment', 'exp', '--action', 'freeze']);
    assert.equal(freeze.code, 0, freeze.stderr);
    const repeated = await runCli(['eval', 'state', '--state', state, '--experiment', 'exp', '--action', 'freeze']);
    assert.equal(repeated.code, 0, repeated.stderr);
    assert.equal(JSON.parse(repeated.stdout).reused, true);
    process.env.CODEX_HOME = root;
    const rawOutput = '{"ok":true}';
    const rolloutPath = path.join(root, 'sessions', 'rollout-generator.jsonl');
    await mkdir(path.dirname(rolloutPath), { recursive: true });
    const rollout = [
      { timestamp: '2026-09-20T13:00:00.000Z', type: 'session_meta', payload: { id: 'session-1', originator: 'Codex Desktop', cli_version: 'fixture', model_provider: 'openai' } },
      { timestamp: '2026-09-20T13:00:00.100Z', type: 'response_item', payload: { type: 'message', id: 'item-1', role: 'assistant', content: [{ type: 'output_text', text: rawOutput }], internal_chat_message_metadata_passthrough: { turn_id: 'turn-1' } } },
      { timestamp: '2026-09-20T13:00:00.110Z', type: 'token_usage_record', payload: { session_id: 'session-1', thread_id: 'thread-1', turn_id: 'turn-1', response_id: 'response-1', usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } } },
      { timestamp: '2026-09-20T13:00:00.120Z', type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { total_tokens: 3 } } } },
    ];
    const rolloutText = rollout.map((record) => JSON.stringify(record)).join('\n') + '\n';
    await writeFile(rolloutPath, rolloutText, 'utf8');
    const evidence = path.join(root, 'generator-record.json');
    const outputHash = crypto.createHash('sha256').update(rawOutput).digest('hex');
    const rolloutHash = crypto.createHash('sha256').update(rolloutText).digest('hex');
    await writeFile(evidence, JSON.stringify({
      version: 1, kind: 'host-agent-generation', executionId: 'execution-1', caseId: 'case-1', lane: 'skill-insights', role: 'baseline',
      inputHash: 'e'.repeat(64), promptHash: 'a'.repeat(64), outputHash, modelComparisonKey: 'host-agent/fixture',
      producerContext: { role: 'generator', contextId: 'session-1', host: 'codex' },
      observed: { startedAt: '2026-09-20T13:00:00.000Z', endedAt: '2026-09-20T13:00:01.000Z', usage: null },
      codexProvenance: { harness: 'codex', rolloutPath, rolloutHash, sessionId: 'session-1', threadId: 'thread-1', turnId: 'turn-1', responseItemId: 'item-1', responseItemOrdinal: 2, tokenUsageRecordOrdinal: 3, tokenEventOrdinal: 4, responseId: 'response-1', startedAt: '2026-09-20T13:00:00.000Z', endedAt: '2026-09-20T13:00:00.120Z', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }, tokenMetric: 'total_tokens', tokenValue: 3, outputHash },
      sourceReference: rolloutPath, sourceReferenceHash: rolloutHash,
    }), 'utf8');
    const generator = await runCli(['eval', 'state', '--state', state, '--experiment', 'exp', '--action', 'generator', '--evidence', evidence]);
    assert.equal(generator.code, 0, generator.stderr);
    const persisted = JSON.parse(await readFile(state, 'utf8'));
    assert.deepEqual(persisted.completed, ['freeze', 'generator']);
    assert.equal(persisted.nextLegalAction, 'contract-grade');
  } finally {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previousCodexHome;
    await rm(root, { recursive: true, force: true });
  }
});
