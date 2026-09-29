const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, mkdir, readFile, rm, writeFile, stat } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

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

test('action/result protocol: single worker repair retry, advance open-html, and advance --ui finalize/cleanup', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-advance-test-'));
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
    await writeFile(path.join(sessions, 'rollout-advance.jsonl'), [
      { timestamp, type: 'session_meta', payload: { id: 'lane-session', cwd: project, originator: 'Codex CLI', cli_version: '0.1.0', model_provider: 'openai' } },
      { timestamp, type: 'turn_context', payload: { turn_id: 'lane-turn', cwd: project } },
      { timestamp, type: 'event_msg', payload: { type: 'token_usage_record', response_id: 'lane-response', turn_id: 'lane-turn', usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 }, turn_token_usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 } } },
      { timestamp, type: 'response_item', payload: { type: 'message', role: 'user', turn_id: 'lane-turn', content: 'Fixture user message for advance test.' } },
      { timestamp, type: 'turn_context', payload: { turn_id: 'fail-turn', cwd: project } },
      { timestamp, type: 'event_msg', payload: { type: 'stream_error', turn_id: 'fail-turn', error: 'simulated model stream failure' } },
      { timestamp, type: 'event_msg', payload: { type: 'task_complete', turn_id: 'fail-turn', status: 'error', error: 'simulated model stream failure' } },
    ].map((record) => JSON.stringify(record)).join('\n') + '\n');

    // 1. run-all start returns 3 compact tickets
    const start = await runCli([
      'report-run', 'run-all', 'start',
      '--harness', 'codex',
      '--cwd', project,
      '--since', '10000d',
      '--locale', 'en-US',
      '--run-dir', runDir,
    ], env);
    assert.equal(start.code, 0, start.stderr);
    const startResult = JSON.parse(start.stdout);
    assert.equal(startResult.status, 'lanes-ready');

    // 2. advance before lanes terminal returns lanes-not-ready
    const advanceBeforeTerminal = await runCli([
      'report-run', 'advance',
      '--run-dir', runDir,
      '--html', htmlPath,
    ], env);
    assert.equal(advanceBeforeTerminal.code, 0);
    const advanceBeforeResult = JSON.parse(advanceBeforeTerminal.stdout);
    assert.equal(advanceBeforeResult.status, 'lanes-not-ready');

    // 3. Worker 1: report-synthesis fails attempt 1, receives retryTicket, repairs in same session
    const badSynthesis1 = {
      auditFingerprint: 'wrong-fingerprint',
      overview: { summary: 'Bad', evidenceRefs: ['summary:totalTokens'] },
      findings: [],
      noStrongFindingReason: null,
    };
    const acceptSynthesis1 = await runCli([
      'report-run', 'ai-accept',
      '--run-dir', runDir,
      '--lane', 'report-synthesis',
      '--attempt', String(startResult.tickets['report-synthesis'].attempt),
      '--span-id', startResult.tickets['report-synthesis'].spanId,
    ], env, JSON.stringify(badSynthesis1));
    assert.equal(acceptSynthesis1.code, 0, acceptSynthesis1.stderr);
    const acceptSynthesis1Result = JSON.parse(acceptSynthesis1.stdout);
    assert.equal(acceptSynthesis1Result.status, 'retrying');
    assert.equal(acceptSynthesis1Result.validationStatus, 'rejected');
    assert.ok(acceptSynthesis1Result.retryTicket, 'ai-accept must issue retryTicket on first failure');
    assert.equal(acceptSynthesis1Result.retryTicket.attempt, 2);

    // Worker 1 repairs using retryTicket in same session
    const goodSynthesis2 = {
      auditFingerprint: startResult.auditFingerprint,
      overview: { summary: 'Valid overview', evidenceRefs: ['summary:totalTokens'] },
      findings: [],
      noStrongFindingReason: 'No strong pattern in fixture.',
    };
    const acceptSynthesis2 = await runCli([
      'report-run', 'ai-accept',
      '--run-dir', runDir,
      '--lane', 'report-synthesis',
      '--attempt', String(acceptSynthesis1Result.retryTicket.attempt),
      '--span-id', acceptSynthesis1Result.retryTicket.spanId,
    ], env, JSON.stringify(goodSynthesis2));
    assert.equal(acceptSynthesis2.code, 0, acceptSynthesis2.stderr);
    const acceptSynthesis2Result = JSON.parse(acceptSynthesis2.stdout);
    assert.equal(acceptSynthesis2Result.status, 'accepted');

    // Worker 2: key-session-analysis accepted
    const goodKeySession = [{
      sessionId: 'lane-session',
      auditFingerprint: startResult.auditFingerprint,
      taskContext: 'Valid task context.',
      primaryFinding: null,
      recommendation: null,
      evidenceRead: { turnIds: ['lane-turn'], selectionReason: 'auto', unreadScope: 'none' },
      limitations: ['fixture limitation'],
    }];
    const acceptKey = await runCli([
      'report-run', 'ai-accept',
      '--run-dir', runDir,
      '--lane', 'key-session-analysis',
      '--attempt', String(startResult.tickets['key-session-analysis'].attempt),
      '--span-id', startResult.tickets['key-session-analysis'].spanId,
    ], env, JSON.stringify(goodKeySession));
    assert.equal(acceptKey.code, 0, acceptKey.stderr);

    // Worker 3: skill-insights fallback via host failure receipt
    await writeFile(path.join(sessions, 'rollout-advance.jsonl'), [
      { timestamp, type: 'session_meta', payload: { id: 'lane-session', cwd: project, originator: 'Codex CLI', cli_version: '0.1.0', model_provider: 'openai' } },
      { timestamp, type: 'turn_context', payload: { turn_id: 'lane-turn', cwd: project } },
      { timestamp, type: 'event_msg', payload: { type: 'token_usage_record', response_id: 'lane-response', turn_id: 'lane-turn', usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 }, turn_token_usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 } } },
      { timestamp, type: 'response_item', payload: { type: 'message', role: 'user', turn_id: 'lane-turn', content: 'Fixture user message for advance test.' } },
      { timestamp, type: 'turn_context', payload: { turn_id: 'fail-turn', cwd: project } },
      { timestamp, type: 'event_msg', payload: { type: 'stream_error', turn_id: 'fail-turn', error: 'simulated model stream failure' } },
      { timestamp, type: 'event_msg', payload: { type: 'task_complete', turn_id: 'fail-turn', status: 'error', error: 'simulated model stream failure' } },
    ].map((record) => JSON.stringify(record)).join('\n') + '\n');

    // ...
    await writeFile(path.join(runDir, 'lanes', 'skill-insights', 'host-failure.json'), JSON.stringify({
      kind: 'host-agent-failure',
      source: 'codex-host-agent',
      runId: startResult.runId,
      lane: 'skill-insights',
      attempt: startResult.tickets['skill-insights'].attempt,
      spanId: startResult.tickets['skill-insights'].spanId,
      reasonCode: 'HOST_GENERATION_FAILED',
      provenance: {
        harness: 'codex',
        status: 'failed',
        rolloutPath: path.join(sessions, 'rollout-advance.jsonl'),
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

    // 4. All lanes terminal -> first advance returns open-html action
    const firstAdvance = await runCli([
      'report-run', 'advance',
      '--run-dir', runDir,
      '--html', htmlPath,
    ], env);
    assert.equal(firstAdvance.code, 0, firstAdvance.stderr);
    const firstAdvanceResult = JSON.parse(firstAdvance.stdout);
    assert.equal(firstAdvanceResult.action, 'open-html');
    assert.equal(firstAdvanceResult.status, 'awaiting-ui-dispatch');
    assert.equal(firstAdvanceResult.htmlPath, htmlPath);
    assert.ok(await stat(htmlPath));

    // 5. Second advance with --ui completed automatically finalizes and cleans up
    const secondAdvance = await runCli([
      'report-run', 'advance',
      '--run-dir', runDir,
      '--ui', 'completed',
    ], env);
    assert.equal(secondAdvance.code, 0, secondAdvance.stderr);
    const secondAdvanceResult = JSON.parse(secondAdvance.stdout);
    assert.equal(secondAdvanceResult.status, 'completed');
    assert.equal(secondAdvanceResult.deliveryStatus, 'completed');
    assert.equal(secondAdvanceResult.cleanedUp, true);

    // Check sensitive artifacts were cleaned up
    await assert.rejects(readFile(path.join(runDir, 'evidence.json')), { code: 'ENOENT' });
    await assert.rejects(readFile(path.join(runDir, 'lanes')), { code: 'ENOENT' });

    // Canonical audit, manifest, trace, and html remain
    assert.ok(await stat(path.join(runDir, 'audit.json')));
    assert.ok(await stat(path.join(runDir, 'manifest.json')));
    assert.ok(await stat(path.join(runDir, 'trace.jsonl')));
    assert.ok(await stat(htmlPath));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('concurrent short lock: compose and render execute outside .run.lock without RUN_LOCK_TIMEOUT and preserve state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-lock-test-'));
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
    await writeFile(path.join(sessions, 'rollout-lock.jsonl'), [
      { timestamp, type: 'session_meta', payload: { id: 'lane-session', cwd: project, originator: 'Codex CLI', cli_version: '0.1.0', model_provider: 'openai' } },
      { timestamp, type: 'turn_context', payload: { turn_id: 'lane-turn', cwd: project } },
      { timestamp, type: 'event_msg', payload: { type: 'token_usage_record', response_id: 'lane-response', turn_id: 'lane-turn', usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 }, turn_token_usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 } } },
      { timestamp, type: 'response_item', payload: { type: 'message', role: 'user', turn_id: 'lane-turn', content: 'Fixture user message for lock test.' } },
      { timestamp, type: 'turn_context', payload: { turn_id: 'fail-turn', cwd: project } },
      { timestamp, type: 'event_msg', payload: { type: 'stream_error', turn_id: 'fail-turn', error: 'simulated model stream failure' } },
      { timestamp, type: 'event_msg', payload: { type: 'task_complete', turn_id: 'fail-turn', status: 'error', error: 'simulated model stream failure' } },
    ].map((record) => JSON.stringify(record)).join('\n') + '\n');

    const start = await runCli([
      'report-run', 'run-all', 'start',
      '--harness', 'codex',
      '--cwd', project,
      '--since', '10000d',
      '--locale', 'en-US',
      '--run-dir', runDir,
    ], env);
    assert.equal(start.code, 0);
    const startResult = JSON.parse(start.stdout);

    const goodSynthesis = {
      auditFingerprint: startResult.auditFingerprint,
      overview: { summary: 'Valid overview', evidenceRefs: ['summary:totalTokens'] },
      findings: [],
      noStrongFindingReason: 'No strong pattern in fixture.',
    };
    const goodKeySession = [{
      sessionId: 'lane-session',
      auditFingerprint: startResult.auditFingerprint,
      taskContext: 'Valid task context.',
      primaryFinding: null,
      recommendation: null,
      evidenceRead: { turnIds: ['lane-turn'], selectionReason: 'auto', unreadScope: 'none' },
      limitations: ['fixture limitation'],
    }];

    // Run 3 concurrent worker ai-accept submissions and an advance call in parallel
    const [resSynth, resKey, resSkills, resAdvance] = await Promise.all([
      runCli([
        'report-run', 'ai-accept',
        '--run-dir', runDir,
        '--lane', 'report-synthesis',
        '--attempt', String(startResult.tickets['report-synthesis'].attempt),
        '--span-id', startResult.tickets['report-synthesis'].spanId,
      ], env, JSON.stringify(goodSynthesis)),
      runCli([
        'report-run', 'ai-accept',
        '--run-dir', runDir,
        '--lane', 'key-session-analysis',
        '--attempt', String(startResult.tickets['key-session-analysis'].attempt),
        '--span-id', startResult.tickets['key-session-analysis'].spanId,
      ], env, JSON.stringify(goodKeySession)),
      (async () => {
        await writeFile(path.join(runDir, 'lanes', 'skill-insights', 'host-failure.json'), JSON.stringify({
          kind: 'host-agent-failure',
          source: 'codex-host-agent',
          runId: startResult.runId,
          lane: 'skill-insights',
          attempt: startResult.tickets['skill-insights'].attempt,
          spanId: startResult.tickets['skill-insights'].spanId,
          reasonCode: 'HOST_GENERATION_FAILED',
          provenance: {
            harness: 'codex',
            status: 'failed',
            rolloutPath: path.join(sessions, 'rollout-lock.jsonl'),
            sessionId: 'lane-session',
            turnId: 'fail-turn',
            error: 'simulated model stream failure',
          },
        }));
        return runCli([
          'report-run', 'ai-fallback',
          '--run-dir', runDir,
          '--lane', 'skill-insights',
          '--status', 'unavailable',
          '--reason-code', 'HOST_GENERATION_FAILED',
        ], env);
      })(),
      // advance may be called concurrently; if lanes not ready yet, it returns lanes-not-ready without error
      runCli([
        'report-run', 'advance',
        '--run-dir', runDir,
        '--html', htmlPath,
      ], env),
    ]);

    // None should crash with RUN_LOCK_TIMEOUT
    assert.ok(!resSynth.stderr.includes('RUN_LOCK_TIMEOUT'), `resSynth stderr: ${resSynth.stderr}`);
    assert.ok(!resKey.stderr.includes('RUN_LOCK_TIMEOUT'), `resKey stderr: ${resKey.stderr}`);
    assert.ok(!resSkills.stderr.includes('RUN_LOCK_TIMEOUT'), `resSkills stderr: ${resSkills.stderr}`);
    assert.ok(!resAdvance.stderr.includes('RUN_LOCK_TIMEOUT'), `resAdvance stderr: ${resAdvance.stderr}`);

    // Call advance after all 3 completed to verify clean composition
    const finalAdvance = await runCli([
      'report-run', 'advance',
      '--run-dir', runDir,
      '--html', htmlPath,
    ], env);
    assert.equal(finalAdvance.code, 0, finalAdvance.stderr);
    const finalAdvanceResult = JSON.parse(finalAdvance.stdout);
    assert.equal(finalAdvanceResult.action, 'open-html');
    assert.equal(finalAdvanceResult.status, 'awaiting-ui-dispatch');
    assert.ok(await stat(htmlPath));

    const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.laneStatus['report-synthesis'].status, 'accepted');
    assert.equal(manifest.laneStatus['key-session-analysis'].status, 'accepted');
    assert.equal(manifest.laneStatus['skill-insights'].status, 'unavailable');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

