const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, mkdir, readFile, rm, writeFile, stat } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { readProjection, v2Synthesis } = require('./fixtures/lane-contract-v2-fixtures');

const cliPath = path.resolve(__dirname, '..', 'dist', 'src', 'cli.js');

function runCli(args, env, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

test('run-all start and finish checkpoints orchestrate a complete Report Run with single-lane retry', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-run-all-test-'));
  const project = path.join(root, 'project');
  const codexHome = path.join(root, 'codex-home');
  const sessions = path.join(codexHome, 'sessions', '2026', '09', '20');
  const runDir = path.join(root, 'run');
  const htmlPath = path.join(root, 'report.html');
  const env = { CODEX_HOME: codexHome, TEMP: root, TMP: root };

  try {
    await mkdir(project, { recursive: true });
    await mkdir(sessions, { recursive: true });
    const timestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await writeFile(path.join(sessions, 'rollout-run-all.jsonl'), [
      { timestamp, type: 'session_meta', payload: { id: 'lane-session', cwd: project, originator: 'Codex CLI', cli_version: '0.1.0', model_provider: 'openai' } },
      { timestamp, type: 'turn_context', payload: { turn_id: 'lane-turn', cwd: project } },
      { timestamp, type: 'event_msg', payload: { type: 'token_usage_record', response_id: 'lane-response', turn_id: 'lane-turn', usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 }, turn_token_usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 } } },
      { timestamp, type: 'response_item', payload: { type: 'message', role: 'user', turn_id: 'lane-turn', content: 'Fixture user message for run-all test.' } },
      { timestamp, type: 'turn_context', payload: { turn_id: 'fail-turn', cwd: project } },
      { timestamp, type: 'event_msg', payload: { type: 'stream_error', turn_id: 'fail-turn', error: 'simulated model stream failure' } },
      { timestamp, type: 'event_msg', payload: { type: 'task_complete', turn_id: 'fail-turn', status: 'error', error: 'simulated model stream failure' } },
    ].map((record) => JSON.stringify(record)).join('\n') + '\n');

    // 1. run-all start prepares once and issues three compact tickets without full audit/evidence in stdout
    const start1 = await runCli([
      'report-run', 'run-all', 'start',
      '--harness', 'codex',
      '--cwd', project,
      '--since', '10000d',
      '--locale', 'en-US',
      '--run-dir', runDir,
    ], env);
    assert.equal(start1.code, 0, start1.stderr);
    const start1Result = JSON.parse(start1.stdout);
    assert.equal(start1Result.status, 'lanes-ready');
    assert.ok(start1Result.runId);
    assert.equal(start1Result.runDir, runDir);
    assert.ok(start1Result.auditFingerprint);

    // stdout must be compact (no full Audit or Evidence)
    assert.ok(!start1.stdout.includes('"modelCalls"'));
    assert.ok(!start1.stdout.includes('"turns"'));
    assert.ok(!start1.stdout.includes('"packets"'));

    // Verify 3 compact tickets are issued before waiting for any lane result
    assert.ok(start1Result.tickets['report-synthesis']);
    assert.ok(start1Result.tickets['key-session-analysis']);
    assert.ok(start1Result.tickets['skill-insights']);
    for (const lane of ['report-synthesis', 'key-session-analysis', 'skill-insights']) {
      const ticket = start1Result.tickets[lane];
      assert.equal(ticket.lane, lane);
      assert.equal(ticket.attempt, 1);
      assert.ok(ticket.spanId);
      assert.ok(ticket.inputArtifact);
      assert.ok(ticket.promptArtifact);
    }

    const manifest1 = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest1.stageStatus['history-read'].attempt, 1);
    assert.equal(manifest1.stageStatus['content-read'].attempt, 1);
    assert.equal(manifest1.stageStatus['skill-snapshot'].attempt, 1);

    // 2. Duplicate start idempotently restores the same frozen Run and tickets
    const start2 = await runCli([
      'report-run', 'run-all', 'start',
      '--run-dir', runDir,
    ], env);
    assert.equal(start2.code, 0, start2.stderr);
    const start2Result = JSON.parse(start2.stdout);
    assert.equal(start2Result.status, 'lanes-ready');
    assert.equal(start2Result.runId, start1Result.runId);
    assert.equal(start2Result.auditFingerprint, start1Result.auditFingerprint);
    for (const lane of ['report-synthesis', 'key-session-analysis', 'skill-insights']) {
      assert.deepEqual(start2Result.tickets[lane], start1Result.tickets[lane]);
    }
    // Verify history and evidence were NOT re-read
    const manifest2 = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest2.stageStatus['history-read'].attempt, 1);
    assert.equal(manifest2.stageStatus['content-read'].attempt, 1);
    assert.equal(manifest2.stageStatus['skill-snapshot'].attempt, 1);

    // 3. finish returns structured not-ready status when lanes are not completed
    const finishUnready = await runCli([
      'report-run', 'run-all', 'finish',
      '--run-dir', runDir,
      '--html', htmlPath,
    ], env);
    assert.equal(finishUnready.code, 0, finishUnready.stderr);
    const finishUnreadyResult = JSON.parse(finishUnready.stdout);
    assert.equal(finishUnreadyResult.status, 'lanes-not-ready');
    assert.equal(finishUnreadyResult.ready, false);
    assert.equal(finishUnreadyResult.runId, start1Result.runId);
    assert.deepEqual(finishUnreadyResult.pendingLanes.sort(), ['key-session-analysis', 'report-synthesis', 'skill-insights'].sort());
    await assert.rejects(readFile(htmlPath), { code: 'ENOENT' });

    // 4. Accept report-synthesis (attempt 1 succeeds)
    const synthesis = v2Synthesis(await readProjection(runDir, 'report-synthesis'), {
      summary: 'The fixture records a bounded activity period.',
    });
    const acceptSynthesis = await runCli([
      'report-run', 'ai-accept',
      '--run-dir', runDir,
      '--lane', 'report-synthesis',
      '--attempt', String(start1Result.tickets['report-synthesis'].attempt),
      '--span-id', start1Result.tickets['report-synthesis'].spanId,
    ], env, JSON.stringify(synthesis));
    assert.equal(acceptSynthesis.code, 0, acceptSynthesis.stderr);
    const synthesisAcceptedFile = path.join(runDir, 'lanes', 'report-synthesis', 'accepted.json');
    const synthesisArtifactHash = createHash('sha256').update(await readFile(synthesisAcceptedFile)).digest('hex');

    // Close skill-insights via explicit host failure receipt (unavailable)
    await writeFile(path.join(runDir, 'lanes', 'skill-insights', 'host-failure.json'), JSON.stringify({
      kind: 'host-agent-failure',
      source: 'codex-host-agent',
      runId: start1Result.runId,
      lane: 'skill-insights',
      attempt: start1Result.tickets['skill-insights'].attempt,
      spanId: start1Result.tickets['skill-insights'].spanId,
      reasonCode: 'HOST_GENERATION_FAILED',
      provenance: {
        harness: 'codex',
        status: 'failed',
        rolloutPath: path.join(sessions, 'rollout-run-all.jsonl'),
        sessionId: 'lane-session',
        turnId: 'fail-turn',
        error: 'simulated model stream failure',
      },
    }));
    const fallbackSkills = await runCli([
      'report-run', 'ai-fallback',
      '--run-dir', runDir,
      '--lane', 'skill-insights',
      '--status', 'unavailable',
      '--reason-code', 'HOST_GENERATION_FAILED',
    ], env);
    assert.equal(fallbackSkills.code, 0, fallbackSkills.stderr);

    // Fail key-session-analysis attempt 1 with output that echoes a code-owned field
    const invalidAnalysisAttempt1 = [{
      sessionHandle: 's1',
      auditFingerprint: 'wrong-fingerprint-attempt-1',
      taskContext: 'Fixture task context.',
      primaryFinding: null,
      recommendation: null,
      limitations: ['fixture limitation'],
    }];
    const acceptKeyInvalid1 = await runCli([
      'report-run', 'ai-accept',
      '--run-dir', runDir,
      '--lane', 'key-session-analysis',
      '--attempt', String(start1Result.tickets['key-session-analysis'].attempt),
      '--span-id', start1Result.tickets['key-session-analysis'].spanId,
    ], env, JSON.stringify(invalidAnalysisAttempt1));
    assert.equal(acceptKeyInvalid1.code, 0, acceptKeyInvalid1.stderr);
    const acceptKey1Result = JSON.parse(acceptKeyInvalid1.stdout);
    assert.equal(acceptKey1Result.validationStatus, 'rejected');
    assert.equal(acceptKey1Result.status, 'retrying');
    const keyTicket2 = acceptKey1Result.retryTicket;
    assert.ok(keyTicket2);
    assert.equal(keyTicket2.attempt, 2);

    // Only key-session-analysis can be retried:
    // Retrying report-synthesis (accepted) must fail with RUN_LANE_TERMINAL
    const retryAccepted = await runCli([
      'report-run', 'ai-start',
      '--run-dir', runDir,
      '--lane', 'report-synthesis',
    ], env);
    assert.equal(retryAccepted.code, 2);
    assert.match(retryAccepted.stderr, /already has terminal status accepted/i);

    // Retrying skill-insights (unavailable) must fail with terminal status error
    const retryUnavailable = await runCli([
      'report-run', 'ai-start',
      '--run-dir', runDir,
      '--lane', 'skill-insights',
    ], env);
    assert.equal(retryUnavailable.code, 2);
    assert.match(retryUnavailable.stderr, /already has terminal status unavailable/i);

    // Starting key-session-analysis when attempt 2 is already issued must fail with RUN_LANE_ALREADY_RUNNING
    const duplicateStart = await runCli([
      'report-run', 'ai-start',
      '--run-dir', runDir,
      '--lane', 'key-session-analysis',
    ], env);
    assert.equal(duplicateStart.code, 2);
    assert.match(duplicateStart.stderr, /already has a running attempt/i);

    // finish while attempt 2 is running still returns not-ready
    const finishUnready2 = await runCli([
      'report-run', 'run-all', 'finish',
      '--run-dir', runDir,
      '--html', htmlPath,
    ], env);
    assert.equal(finishUnready2.code, 0, finishUnready2.stderr);
    assert.equal(JSON.parse(finishUnready2.stdout).status, 'lanes-not-ready');

    // 5. Fail attempt 2 for key-session-analysis -> uses fallback
    const invalidAnalysisAttempt2 = [{
      sessionHandle: 's99',
      taskContext: 'Fixture task context.',
      primaryFinding: null,
      recommendation: null,
      limitations: ['fixture limitation'],
    }];
    const acceptKeyInvalid2 = await runCli([
      'report-run', 'ai-accept',
      '--run-dir', runDir,
      '--lane', 'key-session-analysis',
      '--attempt', String(keyTicket2.attempt),
      '--span-id', keyTicket2.spanId,
    ], env, JSON.stringify(invalidAnalysisAttempt2));
    assert.equal(acceptKeyInvalid2.code, 0, acceptKeyInvalid2.stderr);
    assert.equal(JSON.parse(acceptKeyInvalid2.stdout).validationStatus, 'rejected');

    // Attempt 3 must be blocked (max attempts reached / terminal)
    const retryKeyAttempt3 = await runCli([
      'report-run', 'ai-start',
      '--run-dir', runDir,
      '--lane', 'key-session-analysis',
    ], env);
    assert.equal(retryKeyAttempt3.code, 2);
    assert.match(retryKeyAttempt3.stderr, /already has terminal status fallback|has reached the maximum of 2 attempts/i);

    // 6. Other accepted lane artifact hash, canonical audit, evidence, and scope remain unchanged
    const currentSynthesisHash = createHash('sha256').update(await readFile(synthesisAcceptedFile)).digest('hex');
    assert.equal(currentSynthesisHash, synthesisArtifactHash);

    const manifestFinal = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifestFinal.scope, manifest1.scope);
    assert.equal(manifestFinal.artifacts.audit.sha256, manifest1.artifacts.audit.sha256);
    assert.equal(manifestFinal.artifacts.evidence.sha256, manifest1.artifacts.evidence.sha256);

    // 7. finish generates final HTML once all lanes are terminal
    const finish = await runCli([
      'report-run', 'run-all', 'finish',
      '--run-dir', runDir,
      '--html', htmlPath,
    ], env);
    assert.equal(finish.code, 0, finish.stderr);
    const finishResult = JSON.parse(finish.stdout);
    assert.equal(finishResult.status, 'awaiting-ui-dispatch');
    assert.equal(finishResult.runId, start1Result.runId);
    assert.equal(finishResult.htmlPath, htmlPath);

    const html = await readFile(htmlPath, 'utf8');
    assert.ok(html.length > 0);
    assert.match(html, /The fixture records a bounded activity period/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
