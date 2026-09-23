const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { resolveCodexProvenance } = require('../dist/src/codex-provenance.js');
const { isGenerationRecord } = require('../dist/src/eval-contract.js');

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function codexFixture(rawOutput) {
  const usage = { input_tokens: 12, output_tokens: 34, total_tokens: 46 };
  return [
    {
      timestamp: '2026-09-20T13:00:00.000Z', ordinal: 1, type: 'session_meta',
      payload: { id: 'session-fixture-1', cwd: 'D:/project/agent-audit', originator: 'Codex Desktop', cli_version: 'fixture', model_provider: 'openai' },
    },
    {
      timestamp: '2026-09-20T13:00:01.000Z', ordinal: 2, type: 'event_msg',
      payload: { type: 'task_started', turn_id: 'turn-fixture-1', started_at: 1789909201 },
    },
    {
      timestamp: '2026-09-20T13:00:02.000Z', ordinal: 3, type: 'response_item',
      payload: {
        type: 'message', id: 'response-item-fixture-1', role: 'assistant',
        content: [{ type: 'output_text', text: rawOutput }],
        internal_chat_message_metadata_passthrough: { turn_id: 'turn-fixture-1' },
      },
    },
    {
      timestamp: '2026-09-20T13:00:03.000Z', ordinal: 4, type: 'token_usage_record',
      payload: {
        thread_id: 'thread-fixture-1', turn_id: 'turn-fixture-1', session_id: 'session-fixture-1',
        response_id: 'response-fixture-1', usage,
      },
    },
    {
      timestamp: '2026-09-20T13:00:03.001Z', ordinal: 5, type: 'event_msg',
      payload: { type: 'token_count', info: { last_token_usage: usage, total_token_usage: usage } },
    },
  ];
}

test('Codex provenance resolves real session, turn, response item, terminal token event, and output hash', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-codex-provenance-'));
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = root;
  try {
    const rawOutput = JSON.stringify({ snapshotId: 'fixture', insights: [{ id: 'one' }] });
    const rolloutPath = path.join(root, 'sessions', 'rollout-fixture.jsonl');
    await require('node:fs/promises').mkdir(path.dirname(rolloutPath), { recursive: true });
    await writeFile(rolloutPath, codexFixture(rawOutput).map((item) => JSON.stringify(item)).join('\n') + '\n');
    const result = await resolveCodexProvenance({
      rolloutPath,
      sessionId: 'session-fixture-1',
      threadId: 'thread-fixture-1',
      turnId: 'turn-fixture-1',
      responseItemId: 'response-item-fixture-1',
      rawOutput,
      tokenMetric: 'total_tokens',
    });
    assert.equal(result.sessionId, 'session-fixture-1');
    assert.equal(result.threadId, 'thread-fixture-1');
    assert.equal(result.turnId, 'turn-fixture-1');
    assert.equal(result.responseItemId, 'response-item-fixture-1');
    assert.equal(result.tokenEventOrdinal, 5);
    assert.equal(result.usage.totalTokens, 46);
    assert.equal(result.outputHash, sha256(rawOutput));
  } finally {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previousCodexHome;
    await rm(root, { recursive: true, force: true });
  }
});

test('Codex provenance rejects output mismatch, missing terminal token event, and self-authored generation JSON', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-codex-provenance-reject-'));
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = root;
  try {
    const rawOutput = JSON.stringify({ snapshotId: 'fixture', insights: [{ id: 'one' }] });
    const rolloutPath = path.join(root, 'sessions', 'rollout-fixture.jsonl');
    await require('node:fs/promises').mkdir(path.dirname(rolloutPath), { recursive: true });
    const records = codexFixture(rawOutput);
    await writeFile(rolloutPath, records.map((item) => JSON.stringify(item)).join('\n') + '\n');
    await assert.rejects(
      resolveCodexProvenance({
        rolloutPath,
        sessionId: 'session-fixture-1', threadId: 'thread-fixture-1', turnId: 'turn-fixture-1',
        responseItemId: 'response-item-fixture-1', rawOutput: rawOutput + 'tampered', tokenMetric: 'total_tokens',
      }),
      /CODEX_PROVENANCE_OUTPUT_HASH_MISMATCH/,
    );

    await writeFile(rolloutPath, records.slice(0, 4).map((item) => JSON.stringify(item)).join('\n') + '\n');
    await assert.rejects(
      resolveCodexProvenance({
        rolloutPath,
        sessionId: 'session-fixture-1', threadId: 'thread-fixture-1', turnId: 'turn-fixture-1',
        responseItemId: 'response-item-fixture-1', rawOutput, tokenMetric: 'total_tokens',
      }),
      /CODEX_PROVENANCE_TERMINAL_TOKEN_EVENT_MISSING/,
    );

    const selfAuthored = {
      version: 1, kind: 'host-agent-generation', executionId: 'caller-authored',
      caseId: 'case', lane: 'skill-insights', role: 'baseline', inputHash: 'a'.repeat(64),
      promptHash: 'b'.repeat(64), outputHash: sha256(rawOutput), modelComparisonKey: 'codex/test',
      producerContext: { role: 'generator', contextId: 'caller', host: 'codex' },
      observed: { startedAt: '2026-09-20T13:00:00.000Z', endedAt: '2026-09-20T13:00:01.000Z', usage: null },
      sourceReference: rolloutPath, sourceReferenceHash: sha256('caller-authored-source'),
    };
    assert.equal(isGenerationRecord(selfAuthored), false);
  } finally {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previousCodexHome;
    await rm(root, { recursive: true, force: true });
  }
});
