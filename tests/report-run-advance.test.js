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
  const sensitiveExcerpt = 'PRIVATE_API_TOKEN=sk-proj-sensitive-test-secret-value-must-not-leak;';

  try {
    await mkdir(project, { recursive: true });
    await mkdir(sessions, { recursive: true });
    const timestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await writeFile(path.join(sessions, 'rollout-advance.jsonl'), [
      { timestamp, type: 'session_meta', payload: { id: 'lane-session', cwd: project, originator: 'Codex CLI', cli_version: '0.1.0', model_provider: 'openai' } },
      { timestamp, type: 'turn_context', payload: { turn_id: 'lane-turn', cwd: project } },
      { timestamp, type: 'event_msg', payload: { type: 'token_usage_record', response_id: 'lane-response', turn_id: 'lane-turn', usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 }, turn_token_usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 } } },
      { timestamp, type: 'response_item', payload: { type: 'message', role: 'user', turn_id: 'lane-turn', content: 'Execute database query task.' } },
      { timestamp, type: 'response_item', payload: { type: 'message', role: 'assistant', turn_id: 'lane-turn', content: sensitiveExcerpt } },
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

    // Premature --ui submission before awaiting-ui-dispatch must be rejected
    const prematureUi = await runCli([
      'report-run', 'advance',
      '--run-dir', runDir,
      '--ui', 'completed',
    ], env);
    assert.notEqual(prematureUi.code, 0, 'Premature --ui must fail');
    assert.match(prematureUi.stderr, /Cannot submit --ui: Report Run is not awaiting UI dispatch/);

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

    // Worker 2: key-session-analysis accepted with privacy redaction and no-contagion check
    // Session 1 copies verbatim sensitiveExcerpt; Session 2 has invalid structure (primaryFinding null but recommendation non-null)
    const evArtifact = JSON.parse(await readFile(path.join(runDir, 'evidence.json'), 'utf8'));
    const auditArtifact = JSON.parse(await readFile(path.join(runDir, 'audit.json'), 'utf8'));
    const packet = evArtifact.packets.find((p) => p.sessionId === 'lane-session');
    const turn = auditArtifact.turns.find((t) => t.sessionId === 'lane-session');

    const keySessionCandidates = [
      {
        sessionId: 'lane-session',
        auditFingerprint: startResult.auditFingerprint,
        taskContext: 'Valid task context for lane-session.',
        primaryFinding: {
          observation: `Observed query: ${sensitiveExcerpt} in execution log.`,
          interpretation: 'Direct database credentials query increases token footprint.',
          evidenceIds: [turn.evidenceId],
          support: 'moderate',
          alternativeExplanations: ['Query may be required for local integration setup.'],
        },
        recommendation: {
          action: `Avoid logging ${sensitiveExcerpt} directly in transcript.`,
          rationale: 'Reduces prompt token expansion in future turns.',
          applicability: 'All database interaction turns.',
          tradeoff: null,
          verification: 'Verify that next turn masks secret values.',
          targetEvidenceIds: [turn.evidenceId],
        },
        evidenceRead: { turnIds: packet.turnIds, selectionReason: packet.selectionReason, unreadScope: packet.unreadScope },
        limitations: ['fixture limitation'],
      },
      {
        sessionId: 'lane-session-invalid',
        auditFingerprint: startResult.auditFingerprint,
        taskContext: 'Structurally invalid session.',
        primaryFinding: null,
        recommendation: {
          action: 'Invalid action when primaryFinding is null.',
          rationale: 'rationale',
          applicability: 'applicability',
          tradeoff: null,
          verification: 'verification',
          targetEvidenceIds: [turn.evidenceId],
        },
        evidenceRead: { turnIds: packet.turnIds, selectionReason: packet.selectionReason, unreadScope: packet.unreadScope },
        limitations: ['limitation'],
      },
    ];

    const acceptKey = await runCli([
      'report-run', 'ai-accept',
      '--run-dir', runDir,
      '--lane', 'key-session-analysis',
      '--attempt', String(startResult.tickets['key-session-analysis'].attempt),
      '--span-id', startResult.tickets['key-session-analysis'].spanId,
    ], env, JSON.stringify(keySessionCandidates));
    assert.equal(acceptKey.code, 0, acceptKey.stderr);
    const acceptKeyResult = JSON.parse(acceptKey.stdout);
    assert.equal(acceptKeyResult.status, 'accepted');

    // AC 4 privacy check: raw artifact preserves verbatim, accepted artifact redacts
    const rawKeyArtifact = await readFile(path.join(runDir, 'lanes', 'key-session-analysis', 'attempt-1.raw.json'), 'utf8');
    assert.ok(rawKeyArtifact.includes(sensitiveExcerpt), 'raw.json must preserve original verbatim model output');

    const validationKeyArtifact = JSON.parse(await readFile(path.join(runDir, 'lanes', 'key-session-analysis', 'attempt-1.validation.json'), 'utf8'));
    const rawValStr = JSON.stringify(validationKeyArtifact);
    assert.ok(!rawValStr.includes(sensitiveExcerpt), 'validation diagnostics must NOT contain raw sensitive text');
    const redactionDiagnostics = validationKeyArtifact.errors.filter((e) => e.code === 'RAW_EVIDENCE_REDACTED');
    assert.ok(redactionDiagnostics.length >= 2, 'Must record RAW_EVIDENCE_REDACTED diagnostics for observation and action');

    const acceptedKeyArtifact = JSON.parse(await readFile(path.join(runDir, 'lanes', 'key-session-analysis', 'accepted.json'), 'utf8'));
    const acceptedKeyStr = JSON.stringify(acceptedKeyArtifact);
    assert.ok(!acceptedKeyStr.includes(sensitiveExcerpt), 'accepted.json must NOT contain sensitiveExcerpt');
    assert.ok(acceptedKeyStr.includes('[已移除直接引用的历史内容]'), 'accepted.json must contain [已移除直接引用的历史内容]');
    assert.equal(acceptedKeyArtifact.value.length, 1, 'Only valid session accepted; structurally invalid session dropped without rejecting session 1');
    assert.ok(acceptedKeyArtifact.value[0].recommendation !== null, 'Reparable session retains recommendation');

    // Worker 3 crashed: Host passes formal worker observation on advance.
    // 4. All lanes terminal -> concurrent advance calls: exactly ONE claims compose/render and returns open-html
    const advanceArgs = [
      'report-run', 'advance',
      '--run-dir', runDir,
      '--html', htmlPath,
      '--worker-observation', JSON.stringify({
        lane: 'skill-insights',
        outcome: 'crash',
        reason: 'WORKER_CRASHED_OOM',
      }),
    ];

    const [firstAdvance, concurrentAdvance2, concurrentAdvance3] = await Promise.all([
      runCli(advanceArgs, env),
      runCli(advanceArgs, env),
      runCli(advanceArgs, env),
    ]);

    const allAdvanceOutputs = [firstAdvance, concurrentAdvance2, concurrentAdvance3].map((res) => {
      assert.equal(res.code, 0, res.stderr);
      return JSON.parse(res.stdout);
    });

    const openHtmlClaims = allAdvanceOutputs.filter((res) => res.action === 'open-html');
    assert.equal(openHtmlClaims.length, 1, 'Exactly one advance call must claim compose and return open-html action');
    assert.equal(openHtmlClaims[0].status, 'awaiting-ui-dispatch');
    assert.equal(openHtmlClaims[0].htmlPath, htmlPath);
    assert.ok(await stat(htmlPath));

    const nonClaimingAdvances = allAdvanceOutputs.filter((res) => res.action !== 'open-html');
    assert.equal(nonClaimingAdvances.length, 2, 'Non-claiming concurrent advance calls must not return open-html action');
    assert.ok(nonClaimingAdvances.every((res) => res.ready === false));

    const manifestAfterCrash = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    assert.equal(manifestAfterCrash.laneStatus['skill-insights'].status, 'unavailable');
    assert.equal(manifestAfterCrash.laneStatus['skill-insights'].reasonCode, 'WORKER_CRASHED_OOM');

    // AC 4: final HTML does NOT contain sensitiveExcerpt, contains redacted placeholder
    const finalHtmlContent = await readFile(htmlPath, 'utf8');
    assert.ok(!finalHtmlContent.includes(sensitiveExcerpt), 'Rendered HTML must not leak verbatim sensitive excerpt');
    assert.ok(finalHtmlContent.includes('[已移除直接引用的历史内容]'), 'Rendered HTML must contain redacted marker');

    // 5. Advance with --ui failed: does NOT finalize or cleanup sensitive artifacts
    const failedUiAdvance = await runCli([
      'report-run', 'advance',
      '--run-dir', runDir,
      '--ui', 'failed',
    ], env);
    assert.equal(failedUiAdvance.code, 0, failedUiAdvance.stderr);
    const failedUiResult = JSON.parse(failedUiAdvance.stdout);
    assert.equal(failedUiResult.status, 'incomplete');
    assert.equal(failedUiResult.deliveryStatus, 'incomplete');
    assert.equal(failedUiResult.retryable, true);
    assert.equal(failedUiResult.cleanedUp, false);

    // Verify sensitive artifacts are preserved on failed UI
    assert.ok(await stat(path.join(runDir, 'evidence.json')), 'evidence.json must remain on failed UI');
    assert.ok(await stat(path.join(runDir, 'lanes')), 'lanes/ directory must remain on failed UI');

    // Verify unobserved timing is null, never 1ms
    const manifestAfterFailedUi = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    assert.equal(manifestAfterFailedUi.stageStatus['codex-open'].durationMs, null, 'codex-open durationMs must be null, not 1ms');

    const traceLines = (await readFile(path.join(runDir, 'trace.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    const uiDispatchEndSpan = traceLines.find((e) => e.event === 'end' && e.phase === 'ui-dispatch');
    assert.ok(uiDispatchEndSpan, 'ui-dispatch end span must be recorded in trace');
    assert.equal(uiDispatchEndSpan.durationMs, null, 'ui-dispatch durationMs must be null when timing is unobserved');

    // 6. Advance with --ui completed: automatically finalizes and cleans up
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

test('AC 2: Manifest executionMode immutability, reason code validation, and unobserved handling', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wtw-exec-mode-test-'));
  const project = path.join(root, 'project');
  const codexHome = path.join(root, 'codex-home');
  const runDir = path.join(root, 'run');
  const env = { CODEX_HOME: codexHome, TEMP: root, TMP: root };

  try {
    await mkdir(project, { recursive: true });
    await mkdir(path.join(codexHome, 'sessions'), { recursive: true });

    // Prepare run
    const prep = await runCli([
      'report-run', 'prepare',
      '--harness', 'codex',
      '--cwd', project,
      '--since', '1d',
      '--locale', 'en-US',
      '--run-dir', runDir,
    ], env);
    assert.equal(prep.code, 0, prep.stderr);

    // 1. Invalid sequential-fallback reasonCode rejected
    const invalidReason = await runCli([
      'report-run', 'event',
      '--run-dir', runDir,
    ], env, JSON.stringify({
      event: 'start',
      phase: 'lane-workers',
      operation: 'dispatch',
      source: 'host-agent',
      spanId: 'workers-span-1',
      metadata: { executionMode: 'sequential-fallback', reasonCode: 'INVALID_REASON_CODE' },
    }));
    assert.notEqual(invalidReason.code, 0, 'Invalid sequential-fallback reasonCode must be rejected');
    assert.match(invalidReason.stderr, /REPORT_EXECUTION_MODE_REASON_REQUIRED/);

    // 2. Valid sequential-fallback reasonCode accepted
    const validReason = await runCli([
      'report-run', 'event',
      '--run-dir', runDir,
    ], env, JSON.stringify({
      event: 'start',
      phase: 'lane-workers',
      operation: 'dispatch',
      source: 'host-agent',
      spanId: 'workers-span-1',
      metadata: { executionMode: 'sequential-fallback', reasonCode: 'NATIVE_CONCURRENCY_UNAVAILABLE' },
    }));
    assert.equal(validReason.code, 0, validReason.stderr);

    const manifestAfterStart = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    assert.equal(manifestAfterStart.executionMode, 'sequential-fallback');
    assert.equal(manifestAfterStart.executionModeReasonCode, 'NATIVE_CONCURRENCY_UNAVAILABLE');

    // 3. Attempting to change executionMode throws RUN_EXECUTION_MODE_IMMUTABLE
    const mutateAttempt = await runCli([
      'report-run', 'event',
      '--run-dir', runDir,
    ], env, JSON.stringify({
      event: 'start',
      phase: 'lane-workers',
      operation: 'dispatch',
      source: 'host-agent',
      spanId: 'workers-span-2',
      metadata: { executionMode: 'concurrent' },
    }));
    assert.notEqual(mutateAttempt.code, 0, 'Changing executionMode must be rejected');
    assert.match(mutateAttempt.stderr, /Report Run execution mode cannot change after worker dispatch begins/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function findDeadPid() {
  let pid = 999999;
  while (true) {
    try {
      process.kill(pid, 0);
      pid += 1000;
    } catch {
      return pid;
    }
  }
}

test('0034 AC-1: prepared resume supplies missing evidence without rescan, terminal lanes not redispatched, dispatched returns wait-workers', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-0034-ac1-'));
  const project = path.join(root, 'project');
  const codexHome = path.join(root, 'codex-home');
  const d = new Date();
  const year = String(d.getUTCFullYear());
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const sessions = path.join(codexHome, 'sessions', year, month, day);
  const runDir = path.join(root, 'run');
  const env = { CODEX_HOME: codexHome, TEMP: root, TMP: root };

  try {
    await mkdir(project, { recursive: true });
    await mkdir(sessions, { recursive: true });
    const timestamp = d.toISOString();
    await writeFile(path.join(sessions, 'rollout-ac1.jsonl'), [
      { timestamp, type: 'session_meta', payload: { id: 'ac1-session', cwd: project, originator: 'Codex CLI', cli_version: '0.1.0' } },
      { timestamp, type: 'turn_context', payload: { turn_id: 'ac1-turn', cwd: project, model: 'gpt-4o' } },
      { timestamp, type: 'event_msg', payload: { type: 'token_usage_record', response_id: 'ac1-response', turn_id: 'ac1-turn', usage: { input_tokens: 20, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 30 }, turn_token_usage: { input_tokens: 20, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 30 } } },
      { timestamp, type: 'response_item', payload: { type: 'message', role: 'user', turn_id: 'ac1-turn', content: 'Task instruction' } },
    ].map((r) => JSON.stringify(r)).join('\n') + '\n');

    // 1. Run prepare directly to create a prepared run without auto-evidence
    const prep = await runCli([
      'report-run', 'prepare',
      '--harness', 'codex',
      '--cwd', project,
      '--since', '7d',
      '--run-dir', runDir,
    ], env);
    assert.equal(prep.code, 0, prep.stderr);

    const manifestPrepared = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    assert.equal(manifestPrepared.status, 'prepared');
    assert.equal(manifestPrepared.artifacts.evidence, undefined, 'Evidence not yet created');

    // 2. Resume via run-all start: must supply evidence without rescan and issue initial tickets
    const resumeStart = await runCli([
      'report-run', 'run-all', 'start',
      '--harness', 'codex',
      '--cwd', project,
      '--since', '7d',
      '--run-dir', runDir,
    ], env);
    assert.equal(resumeStart.code, 0, resumeStart.stderr);
    const resumeStartResult = JSON.parse(resumeStart.stdout);
    assert.equal(resumeStartResult.status, 'lanes-ready');
    assert.ok(resumeStartResult.tickets['report-synthesis']);
    assert.ok(resumeStartResult.tickets['key-session-analysis']);
    assert.ok(resumeStartResult.tickets['skill-insights']);

    const manifestAfterResume = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    assert.ok(manifestAfterResume.artifacts.evidence, 'Evidence must be supplied on resume');

    // 3. Scenario 1: Zero dispatch. Repeated start retrieves the SAME 3 tickets without increasing attempts or rescanning
    const zeroDispatchStart = await runCli([
      'report-run', 'run-all', 'start',
      '--harness', 'codex',
      '--cwd', project,
      '--since', '7d',
      '--run-dir', runDir,
    ], env);
    assert.equal(zeroDispatchStart.code, 0);
    const zeroDispatchResult = JSON.parse(zeroDispatchStart.stdout);
    assert.equal(zeroDispatchResult.status, 'lanes-ready');
    assert.ok(zeroDispatchResult.tickets['report-synthesis']);
    assert.ok(zeroDispatchResult.tickets['key-session-analysis']);
    assert.ok(zeroDispatchResult.tickets['skill-insights']);
    assert.equal(zeroDispatchResult.tickets['report-synthesis'].attempt, 1, 'Attempt must remain 1 on zero-dispatch resume');
    assert.equal(zeroDispatchResult.tickets['report-synthesis'].spanId, resumeStartResult.tickets['report-synthesis'].spanId, 'SpanId must be identical');

    // 4. Scenario 2: Batch-only start event (executionMode). Cannot prove individual worker dispatch!
    const batchOnlyEvent = await runCli([
      'report-run', 'event',
      '--run-dir', runDir,
    ], env, JSON.stringify({
      event: 'start',
      phase: 'lane-workers',
      operation: 'dispatch',
      source: 'host-agent',
      spanId: 'workers-batch-1',
      metadata: { executionMode: 'concurrent' },
    }));
    assert.equal(batchOnlyEvent.code, 0, batchOnlyEvent.stderr);

    const batchOnlyStart = await runCli([
      'report-run', 'run-all', 'start',
      '--harness', 'codex',
      '--cwd', project,
      '--since', '7d',
      '--run-dir', runDir,
    ], env);
    assert.equal(batchOnlyStart.code, 0);
    const batchOnlyResult = JSON.parse(batchOnlyStart.stdout);
    assert.equal(batchOnlyResult.status, 'lanes-ready', 'Batch-only start must not fake per-lane dispatch');
    assert.ok(batchOnlyResult.tickets['report-synthesis']);
    assert.ok(batchOnlyResult.tickets['key-session-analysis']);
    assert.ok(batchOnlyResult.tickets['skill-insights']);

    // 5. Scenario 3: Partial lane dispatch (only report-synthesis is dispatched)
    const laneDispatchEvent = await runCli([
      'report-run', 'event',
      '--run-dir', runDir,
    ], env, JSON.stringify({
      event: 'start',
      phase: 'report-synthesis',
      operation: 'dispatch',
      source: 'host-agent',
      spanId: resumeStartResult.tickets['report-synthesis'].spanId,
    }));
    assert.equal(laneDispatchEvent.code, 0, laneDispatchEvent.stderr);

    const partialDispatchStart = await runCli([
      'report-run', 'run-all', 'start',
      '--harness', 'codex',
      '--cwd', project,
      '--since', '7d',
      '--run-dir', runDir,
    ], env);
    assert.equal(partialDispatchStart.code, 0);
    const partialDispatchResult = JSON.parse(partialDispatchStart.stdout);
    assert.equal(partialDispatchResult.status, 'lanes-ready');
    assert.equal(partialDispatchResult.tickets['report-synthesis'], undefined, 'Dispatched lane must not be re-issued ticket');
    assert.ok(partialDispatchResult.tickets['key-session-analysis'], 'Undispatched lane must receive ticket');
    assert.ok(partialDispatchResult.tickets['skill-insights'], 'Undispatched lane must receive ticket');

    // 6. Scenario 4: All remaining lanes dispatched
    for (const lane of ['key-session-analysis', 'skill-insights']) {
      const ev = await runCli([
        'report-run', 'event',
        '--run-dir', runDir,
      ], env, JSON.stringify({
        event: 'start',
        phase: lane,
        operation: 'dispatch',
        source: 'host-agent',
        spanId: resumeStartResult.tickets[lane].spanId,
      }));
      assert.equal(ev.code, 0);
    }

    const allDispatchedStart = await runCli([
      'report-run', 'run-all', 'start',
      '--harness', 'codex',
      '--cwd', project,
      '--since', '7d',
      '--run-dir', runDir,
    ], env);
    assert.equal(allDispatchedStart.code, 0);
    const allDispatchedResult = JSON.parse(allDispatchedStart.stdout);
    assert.equal(allDispatchedResult.status, 'wait-workers', 'All dispatched lanes must wait for workers');
    assert.deepEqual(allDispatchedResult.tickets, {});

    // 7. Mark report-synthesis as accepted (terminal)
    const goodSynthesis = {
      auditFingerprint: resumeStartResult.auditFingerprint,
      overview: { summary: 'Valid overview', evidenceRefs: ['summary:totalTokens'] },
      findings: [],
      noStrongFindingReason: 'No pattern.',
    };
    const acceptRes = await runCli([
      'report-run', 'ai-accept',
      '--run-dir', runDir,
      '--lane', 'report-synthesis',
      '--attempt', '1',
      '--span-id', resumeStartResult.tickets['report-synthesis'].spanId,
    ], env, JSON.stringify(goodSynthesis));
    assert.equal(acceptRes.code, 0);

    // 8. Repeated run-all start while other lanes are dispatched: returns wait-workers, terminal lane not re-dispatched
    const repeatedStart = await runCli([
      'report-run', 'run-all', 'start',
      '--harness', 'codex',
      '--cwd', project,
      '--since', '7d',
      '--run-dir', runDir,
    ], env);
    assert.equal(repeatedStart.code, 0);
    const repeatedStartResult = JSON.parse(repeatedStart.stdout);
    assert.equal(repeatedStartResult.status, 'wait-workers');
    assert.deepEqual(repeatedStartResult.tickets, {});

    // Check attempts did not increase for accepted lane
    const manifestFinal = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    assert.equal(manifestFinal.laneStatus['report-synthesis'].attempts, 1, 'Accepted lane attempt must not increase');
    assert.equal(manifestFinal.laneStatus['report-synthesis'].status, 'accepted');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('0034 AC-2: composing owner locks against active process, and dead owner allows resume from incomplete boundary', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-0034-ac2-'));
  const project = path.join(root, 'project');
  const codexHome = path.join(root, 'codex-home');
  const d = new Date();
  const year = String(d.getUTCFullYear());
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const sessions = path.join(codexHome, 'sessions', year, month, day);
  const runDir = path.join(root, 'run');
  const env = { CODEX_HOME: codexHome, TEMP: root, TMP: root };

  try {
    await mkdir(project, { recursive: true });
    await mkdir(sessions, { recursive: true });
    const timestamp = d.toISOString();
    await writeFile(path.join(sessions, 'rollout-ac2.jsonl'), [
      { timestamp, type: 'session_meta', payload: { id: 'ac2-session', cwd: project, originator: 'Codex CLI', cli_version: '0.1.0' } },
      { timestamp, type: 'turn_context', payload: { turn_id: 'ac2-turn', cwd: project } },
      { timestamp, type: 'event_msg', payload: { type: 'token_usage_record', response_id: 'ac2-response', turn_id: 'ac2-turn', usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 }, turn_token_usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 } } },
    ].map((r) => JSON.stringify(r)).join('\n') + '\n');

    const start = await runCli([
      'report-run', 'run-all', 'start',
      '--harness', 'codex',
      '--cwd', project,
      '--since', '7d',
      '--run-dir', runDir,
    ], env);
    assert.equal(start.code, 0);

    // 1. Simulate all lanes terminal and active composing owner: current pid is alive
    const manifestPath = path.join(runDir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    for (const lane of ['report-synthesis', 'key-session-analysis', 'skill-insights']) {
      manifest.laneStatus[lane].status = 'unavailable';
      manifest.laneStatus[lane].attempts = 1;
    }
    manifest.status = 'composing';
    manifest.deliveryStatus = 'composing';
    manifest.composingOwner = {
      pid: process.pid,
      spanId: 'composing:active-test',
      startedAt: new Date().toISOString(),
    };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    // Calling advance while owner is active must return in-progress and not preempt
    const activeAdvance = await runCli([
      'report-run', 'advance',
      '--run-dir', runDir,
    ], env);
    assert.equal(activeAdvance.code, 0);
    const activeAdvanceResult = JSON.parse(activeAdvance.stdout);
    assert.equal(activeAdvanceResult.status, 'in-progress');
    assert.equal(activeAdvanceResult.ready, false);

    // 2. Unknown owner does NOT equal confirmed exit: preserve in-progress protection
    manifest.composingOwner = null;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    const unknownOwnerAdvance = await runCli([
      'report-run', 'advance',
      '--run-dir', runDir,
    ], env);
    assert.equal(unknownOwnerAdvance.code, 0);
    const unknownOwnerResult = JSON.parse(unknownOwnerAdvance.stdout);
    assert.equal(unknownOwnerResult.status, 'in-progress', 'Unknown owner must preserve in-progress');
    assert.equal(unknownOwnerResult.ready, false);

    // 3. Simulate dead composing owner: dead PID allows recovery from incomplete boundary
    const deadPid = findDeadPid();
    manifest.composingOwner = {
      pid: deadPid,
      spanId: 'composing:dead-test',
      startedAt: new Date().toISOString(),
    };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    const deadAdvance = await runCli([
      'report-run', 'advance',
      '--run-dir', runDir,
    ], env);
    assert.equal(deadAdvance.code, 0, deadAdvance.stderr);
    const deadAdvanceResult = JSON.parse(deadAdvance.stdout);
    assert.equal(deadAdvanceResult.action, 'open-html');
    assert.equal(deadAdvanceResult.status, 'awaiting-ui-dispatch');
    assert.ok(deadAdvanceResult.htmlPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('0034 AC-3: awaiting-ui and incomplete return identical open-html, completed is idempotent, changing delivery target is rejected', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-0034-ac3-'));
  const project = path.join(root, 'project');
  const codexHome = path.join(root, 'codex-home');
  const d = new Date();
  const year = String(d.getUTCFullYear());
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const sessions = path.join(codexHome, 'sessions', year, month, day);
  const runDir = path.join(root, 'run');
  const htmlPath = path.join(root, 'custom-report.html');
  const env = { CODEX_HOME: codexHome, TEMP: root, TMP: root };

  try {
    await mkdir(project, { recursive: true });
    await mkdir(sessions, { recursive: true });
    const timestamp = d.toISOString();
    await writeFile(path.join(sessions, 'rollout-ac3.jsonl'), [
      { timestamp, type: 'session_meta', payload: { id: 'ac3-session', cwd: project, originator: 'Codex CLI', cli_version: '0.1.0' } },
      { timestamp, type: 'turn_context', payload: { turn_id: 'ac3-turn', cwd: project } },
      { timestamp, type: 'event_msg', payload: { type: 'token_usage_record', response_id: 'ac3-response', turn_id: 'ac3-turn', usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 }, turn_token_usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 } } },
    ].map((r) => JSON.stringify(r)).join('\n') + '\n');

    await runCli([
      'report-run', 'run-all', 'start',
      '--harness', 'codex',
      '--cwd', project,
      '--since', '7d',
      '--run-dir', runDir,
    ], env);

    // 1. Initial advance with worker observations generates HTML at htmlPath and enters awaiting-ui-dispatch
    const firstAdvance = await runCli([
      'report-run', 'advance',
      '--run-dir', runDir,
      '--html', htmlPath,
      '--worker-observation', JSON.stringify([
        { lane: 'report-synthesis', outcome: 'unavailable' },
        { lane: 'key-session-analysis', outcome: 'unavailable' },
        { lane: 'skill-insights', outcome: 'unavailable' },
      ]),
    ], env);
    assert.equal(firstAdvance.code, 0);
    const firstResult = JSON.parse(firstAdvance.stdout);
    assert.equal(firstResult.action, 'open-html');
    assert.equal(firstResult.status, 'awaiting-ui-dispatch');
    assert.equal(firstResult.htmlPath, htmlPath);

    // 2. Repeating advance without --ui returns identical open-html action and target
    const repeatAdvance = await runCli([
      'report-run', 'advance',
      '--run-dir', runDir,
    ], env);
    assert.equal(repeatAdvance.code, 0);
    const repeatResult = JSON.parse(repeatAdvance.stdout);
    assert.equal(repeatResult.action, 'open-html');
    assert.equal(repeatResult.htmlPath, htmlPath);

    // 3. Repeating run-all start returns identical open-html action
    const repeatStart = await runCli([
      'report-run', 'run-all', 'start',
      '--harness', 'codex',
      '--cwd', project,
      '--since', '7d',
      '--run-dir', runDir,
    ], env);
    assert.equal(repeatStart.code, 0);
    const repeatStartResult = JSON.parse(repeatStart.stdout);
    assert.equal(repeatStartResult.action, 'open-html');
    assert.equal(repeatStartResult.htmlPath, htmlPath);

    // 4. Changing delivery target is rejected
    const diffHtmlPath = path.join(root, 'different-report.html');
    const changeAttempt = await runCli([
      'report-run', 'compose',
      '--run-dir', runDir,
      '--locale', 'en-US',
      '--html', diffHtmlPath,
    ], env);
    assert.notEqual(changeAttempt.code, 0);
    assert.match(changeAttempt.stderr, /Cannot change --html delivery target/);

    // 5. Submit UI failed: moves to incomplete
    const failedUi = await runCli([
      'report-run', 'advance',
      '--run-dir', runDir,
      '--ui', 'failed',
    ], env);
    assert.equal(failedUi.code, 0, failedUi.stderr);
    const failedUiResult = JSON.parse(failedUi.stdout);
    assert.equal(failedUiResult.status, 'incomplete');

    // Repeated advance in incomplete status re-issues same open-html action for retry
    const incompleteAdvance = await runCli([
      'report-run', 'advance',
      '--run-dir', runDir,
    ], env);
    assert.equal(incompleteAdvance.code, 0);
    const incompleteResult = JSON.parse(incompleteAdvance.stdout);
    assert.equal(incompleteResult.action, 'open-html');
    assert.equal(incompleteResult.htmlPath, htmlPath);

    // 6. Finalize with completed UI: moves to completed
    const successUi = await runCli([
      'report-run', 'advance',
      '--run-dir', runDir,
      '--ui', 'completed',
    ], env);
    assert.equal(successUi.code, 0);
    assert.equal(JSON.parse(successUi.stdout).status, 'completed');

    // Repeated advance and repeated UI completed are idempotent
    const repeatDoneAdvance = await runCli([
      'report-run', 'advance',
      '--run-dir', runDir,
    ], env);
    assert.equal(repeatDoneAdvance.code, 0);
    assert.equal(JSON.parse(repeatDoneAdvance.stdout).status, 'completed');

    const repeatDoneUi = await runCli([
      'report-run', 'advance',
      '--run-dir', runDir,
      '--ui', 'completed',
    ], env);
    assert.equal(repeatDoneUi.code, 0);
    assert.equal(JSON.parse(repeatDoneUi.stdout).status, 'completed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('0034 AC-4: external delivery target modification/deletion blocks completed finalization and prevents cleanup', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-0034-ac4-'));
  const project = path.join(root, 'project');
  const codexHome = path.join(root, 'codex-home');
  const d = new Date();
  const year = String(d.getUTCFullYear());
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const sessions = path.join(codexHome, 'sessions', year, month, day);
  const runDir = path.join(root, 'run');
  const externalHtml = path.join(root, 'external-delivery.html');
  const env = { CODEX_HOME: codexHome, TEMP: root, TMP: root };

  try {
    await mkdir(project, { recursive: true });
    await mkdir(sessions, { recursive: true });
    const timestamp = d.toISOString();
    await writeFile(path.join(sessions, 'rollout-ac4.jsonl'), [
      { timestamp, type: 'session_meta', payload: { id: 'ac4-session', cwd: project, originator: 'Codex CLI', cli_version: '0.1.0' } },
      { timestamp, type: 'turn_context', payload: { turn_id: 'ac4-turn', cwd: project } },
      { timestamp, type: 'event_msg', payload: { type: 'token_usage_record', response_id: 'ac4-response', turn_id: 'ac4-turn', usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 }, turn_token_usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 } } },
    ].map((r) => JSON.stringify(r)).join('\n') + '\n');

    await runCli([
      'report-run', 'run-all', 'start',
      '--harness', 'codex',
      '--cwd', project,
      '--since', '7d',
      '--run-dir', runDir,
    ], env);

    // Advance with worker observations to write HTML to external path
    const advanceRes = await runCli([
      'report-run', 'advance',
      '--run-dir', runDir,
      '--html', externalHtml,
      '--worker-observation', JSON.stringify([
        { lane: 'report-synthesis', outcome: 'unavailable' },
        { lane: 'key-session-analysis', outcome: 'unavailable' },
        { lane: 'skill-insights', outcome: 'unavailable' },
      ]),
    ], env);
    assert.equal(advanceRes.code, 0);

    const originalContent = await readFile(externalHtml, 'utf8');

    // 1. Tamper external HTML while internal artifact remains intact
    await writeFile(externalHtml, 'tampered external html content');

    // Attempt to submit UI completed: must fail integrity and remain incomplete, not cleaned up
    const tamperedUi = await runCli([
      'report-run', 'advance',
      '--run-dir', runDir,
      '--ui', 'completed',
    ], env);
    assert.equal(tamperedUi.code, 0);
    const tamperedUiResult = JSON.parse(tamperedUi.stdout);
    assert.equal(tamperedUiResult.status, 'incomplete');
    assert.equal(tamperedUiResult.deliveryStatus, 'incomplete');
    assert.equal(tamperedUiResult.error, 'DELIVERY_TARGET_INTEGRITY_FAILED');
    assert.equal(tamperedUiResult.cleanedUp, false);

    const manifestTampered = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    assert.notEqual(manifestTampered.status, 'completed', 'Run must not be completed on tampered target');
    assert.ok(manifestTampered.warnings.some((w) => w.includes('Actual delivery target file is missing, modified, or has bundle version drift.') || w.includes('Final HTML artifact integrity verification failed.')));

    // 2. Delete external HTML entirely
    await rm(externalHtml);
    const deletedUi = await runCli([
      'report-run', 'advance',
      '--run-dir', runDir,
      '--ui', 'completed',
    ], env);
    assert.equal(deletedUi.code, 0);
    const deletedUiResult = JSON.parse(deletedUi.stdout);
    assert.equal(deletedUiResult.status, 'incomplete');
    assert.equal(deletedUiResult.cleanedUp, false);

    // 3. Restore external HTML to exact content and retry: finalizes as completed and cleans up
    await writeFile(externalHtml, originalContent, 'utf8');
    const restoredUi = await runCli([
      'report-run', 'advance',
      '--run-dir', runDir,
      '--ui', 'completed',
    ], env);
    assert.equal(restoredUi.code, 0);
    const restoredUiResult = JSON.parse(restoredUi.stdout);
    assert.equal(restoredUiResult.status, 'completed');
    assert.equal(restoredUiResult.deliveryStatus, 'completed');
    assert.equal(restoredUiResult.cleanedUp, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('0035 AC-1 to AC-4: truthful cleanup failure preserves files and refs, recovery cleans remaining items without recompose, idempotent completion', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-0035-cleanup-'));
  const project = path.join(root, 'project');
  const codexHome = path.join(root, 'codex-home');
  const d = new Date();
  const year = String(d.getUTCFullYear());
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const sessions = path.join(codexHome, 'sessions', year, month, day);
  const runDir = path.join(root, 'run');
  const externalHtml = path.join(root, 'external-report.html');
  const faultScript = path.join(root, 'fault-inject.js');
  const sensitiveExcerpt = 'TOKEN_0035_HIGHLY_SENSITIVE_SECRET_XYZ987';
  const env = { CODEX_HOME: codexHome, TEMP: root, TMP: root };

  try {
    // 0. Setup fault injection script:
    // - INJECT_TAMPER_AFTER_FIRST_READ=1: allows first delivery check to pass, then tampers external file before finalize recheck
    // - INJECT_CLEANUP_EPERM=1: simulates FS refusing fs.rm for evidence and lanes
    await writeFile(faultScript, `
      const fs = require('node:fs/promises');
      const origRm = fs.rm;
      const origReadFile = fs.readFile;
      let htmlReadCount = 0;

      fs.readFile = async function(targetPath, opts) {
        const str = String(targetPath);
        if (str.includes('external-report.html') && process.env.INJECT_TAMPER_AFTER_FIRST_READ === '1') {
          htmlReadCount += 1;
          if (htmlReadCount === 1) {
            const result = await origReadFile.call(this, targetPath, opts);
            require('node:fs').writeFileSync(targetPath, '<html>tampered after first read</html>', 'utf8');
            return result;
          }
        }
        return origReadFile.call(this, targetPath, opts);
      };

      fs.rm = async function(targetPath, opts) {
        if (process.env.INJECT_CLEANUP_EPERM === '1') {
          const str = String(targetPath);
          if (str.includes('evidence.json') || str.includes('lanes')) {
            const err = new Error('EPERM: operation not permitted, unlink');
            err.code = 'EPERM';
            throw err;
          }
        }
        return origRm.call(this, targetPath, opts);
      };
    `, 'utf8');

    // 1. Setup session with sensitive content and run preflight
    await mkdir(project, { recursive: true });
    await mkdir(sessions, { recursive: true });
    const timestamp = d.toISOString();
    await writeFile(path.join(sessions, 'rollout-0035.jsonl'), [
      { timestamp, type: 'session_meta', payload: { id: 'session-0035', cwd: project, originator: 'Codex CLI', cli_version: '0.1.0' } },
      { timestamp, type: 'turn_context', payload: { turn_id: 'turn-0035', cwd: project } },
      { timestamp, type: 'event_msg', payload: { type: 'token_usage_record', response_id: 'resp-0035', turn_id: 'turn-0035', usage: { input_tokens: 20, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 30 }, turn_token_usage: { input_tokens: 20, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 30 } } },
      { timestamp, type: 'response_item', payload: { type: 'message', role: 'user', turn_id: 'turn-0035', content: 'Audit database secret access.' } },
      { timestamp, type: 'response_item', payload: { type: 'message', role: 'assistant', turn_id: 'turn-0035', content: sensitiveExcerpt } },
    ].map((r) => JSON.stringify(r)).join('\n') + '\n');

    const preflight = await runCli(['report-run', 'preflight'], env);
    assert.equal(preflight.code, 0, preflight.stderr);

    const start = await runCli([
      'report-run', 'run-all', 'start',
      '--harness', 'codex',
      '--cwd', project,
      '--since', '7d',
      '--run-dir', runDir,
    ], env);
    assert.equal(start.code, 0, start.stderr);

    // Initial advance claims compose, renders external HTML, enters awaiting-ui-dispatch
    const firstAdvance = await runCli([
      'report-run', 'advance',
      '--run-dir', runDir,
      '--html', externalHtml,
      '--worker-observation', JSON.stringify([
        { lane: 'report-synthesis', outcome: 'unavailable' },
        { lane: 'key-session-analysis', outcome: 'unavailable' },
        { lane: 'skill-insights', outcome: 'unavailable' },
      ]),
    ], env);
    assert.equal(firstAdvance.code, 0, firstAdvance.stderr);
    const firstAdvanceResult = JSON.parse(firstAdvance.stdout);
    assert.equal(firstAdvanceResult.action, 'open-html');
    assert.equal(firstAdvanceResult.status, 'awaiting-ui-dispatch');
    const originalHtmlContent = await readFile(externalHtml, 'utf8');

    // AC-1 Part A: UI dispatch failure -> does NOT cleanup sensitive artifacts, retention.cleanedAt remains null, returns incomplete
    const failedUi = await runCli([
      'report-run', 'advance',
      '--run-dir', runDir,
      '--ui', 'failed',
    ], env);
    assert.equal(failedUi.code, 0, failedUi.stderr);
    const failedUiResult = JSON.parse(failedUi.stdout);
    assert.equal(failedUiResult.status, 'incomplete');
    assert.equal(failedUiResult.deliveryStatus, 'incomplete');
    assert.equal(failedUiResult.cleanedUp, false);

    // Verify sensitive files and refs are preserved under AC-1 Part A
    assert.ok(await stat(path.join(runDir, 'evidence.json')), 'evidence.json must be preserved on UI failure');
    assert.ok(await stat(path.join(runDir, 'lanes')), 'lanes/ must be preserved on UI failure');
    const manifestAfterFailedUi = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    assert.equal(manifestAfterFailedUi.retention.cleanedAt, null, 'cleanedAt must remain null on UI failure');
    assert.ok(manifestAfterFailedUi.artifacts.evidence, 'evidence artifact ref must be preserved');
    assert.ok(Object.keys(manifestAfterFailedUi.laneArtifacts).length > 0, 'laneArtifacts must be preserved');

    // AC-1 Part B: Finalize failure (external HTML modified after first check, before finalize recheck)
    // First check passes, but finalize recheck fails integrity -> advance must NOT cleanup, evidence must remain!
    const tamperEnv = {
      ...env,
      NODE_OPTIONS: `-r ${faultScript.replace(/\\/g, '/')}`,
      INJECT_TAMPER_AFTER_FIRST_READ: '1',
    };
    const finalizeFailedUi = await runCli([
      'report-run', 'advance',
      '--run-dir', runDir,
      '--ui', 'completed',
    ], tamperEnv);
    assert.equal(finalizeFailedUi.code, 0, finalizeFailedUi.stderr);
    const finalizeFailedResult = JSON.parse(finalizeFailedUi.stdout);
    assert.equal(finalizeFailedResult.status, 'incomplete', 'Run status must be incomplete on finalization failure');
    assert.equal(finalizeFailedResult.deliveryStatus, 'incomplete', 'deliveryStatus must be incomplete on finalization failure');
    assert.equal(finalizeFailedResult.cleanedUp, false, 'cleanedUp must be false when finalization fails');
    assert.equal(finalizeFailedResult.error, 'FINALIZATION_FAILED');

    // Crucial AC-1 assertion: evidence and lanes MUST physically remain and retain refs, cleanedAt MUST be null!
    assert.ok(await stat(path.join(runDir, 'evidence.json')), 'evidence.json must remain when finalization fails');
    assert.ok(await stat(path.join(runDir, 'lanes')), 'lanes/ must remain when finalization fails');
    const manifestAfterFinalizeFail = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    assert.equal(manifestAfterFinalizeFail.status, 'incomplete');
    assert.equal(manifestAfterFinalizeFail.deliveryStatus, 'incomplete');
    assert.equal(manifestAfterFinalizeFail.cleanupStatus, 'pending');
    assert.equal(manifestAfterFinalizeFail.retention.cleanedAt, null, 'cleanedAt must NOT be written on finalization failure');
    assert.ok(manifestAfterFinalizeFail.artifacts.evidence, 'evidence ref must be retained on finalization failure');
    assert.ok(manifestAfterFinalizeFail.warnings.some((w) => w.includes('Final HTML artifact integrity verification failed.')), 'warning must record actual failure reason');

    // Restore valid external HTML content for AC-2 onwards
    await writeFile(externalHtml, originalHtmlContent, 'utf8');

    // AC-2: UI completed with simulated FS refusal (EPERM) -> files and refs retained, cleanupStatus failed, cleanedUp=false, diagnostics have no verbatim content
    const faultEnv = {
      ...env,
      NODE_OPTIONS: `-r ${faultScript.replace(/\\/g, '/')}`,
      INJECT_CLEANUP_EPERM: '1',
    };
    const completedUiWithFault = await runCli([
      'report-run', 'advance',
      '--run-dir', runDir,
      '--ui', 'completed',
    ], faultEnv);
    assert.equal(completedUiWithFault.code, 0, completedUiWithFault.stderr);
    const faultResult = JSON.parse(completedUiWithFault.stdout);
    assert.equal(faultResult.status, 'incomplete', 'Run must be incomplete when cleanup fails');
    assert.equal(faultResult.deliveryStatus, 'completed', 'Delivery itself succeeded');
    assert.equal(faultResult.cleanedUp, false, 'cleanedUp must be false on deletion failure');
    assert.equal(faultResult.retryable, true, 'Advance must remain retryable');

    // Verify physical files remain on disk
    assert.ok(await stat(path.join(runDir, 'evidence.json')), 'evidence.json must physically remain after EPERM');
    assert.ok(await stat(path.join(runDir, 'lanes')), 'lanes directory must physically remain after EPERM');

    // Verify manifest state after AC-2 failure
    const manifestAfterFault = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    assert.equal(manifestAfterFault.status, 'incomplete');
    assert.equal(manifestAfterFault.deliveryStatus, 'completed');
    assert.ok(manifestAfterFault.cleanupStatus === 'failed' || manifestAfterFault.cleanupStatus === 'partial');
    assert.equal(manifestAfterFault.retention.cleanedAt, null, 'cleanedAt must be null on cleanup failure');
    assert.ok(manifestAfterFault.artifacts.evidence, 'evidence artifact ref must remain');
    assert.ok(manifestAfterFault.laneArtifacts['report-synthesis/input.json'], 'lane artifact ref must remain');

    // AC-2 diagnostics verification: errors report code and relative path, NOT verbatim content
    const manifestStr = JSON.stringify(manifestAfterFault);
    assert.ok(!manifestStr.includes(sensitiveExcerpt), 'Manifest diagnostics must NOT contain sensitive verbatim content');
    const cleanupWarning = manifestAfterFault.warnings.find((w) => w.includes('Cleanup failed:'));
    assert.ok(cleanupWarning, 'Warning must record cleanup failure');
    assert.match(cleanupWarning, /EPERM/);
    assert.match(cleanupWarning, /evidence\.json/);

    // AC-3: Fault cleared -> advance without --ui retries remaining cleanup ONLY, does not recompose or re-open HTML, becomes completed
    const externalHtmlStatBefore = await stat(externalHtml);
    const recoveryAdvance = await runCli([
      'report-run', 'advance',
      '--run-dir', runDir,
    ], env);
    assert.equal(recoveryAdvance.code, 0, recoveryAdvance.stderr);
    const recoveryResult = JSON.parse(recoveryAdvance.stdout);
    assert.equal(recoveryResult.status, 'completed');
    assert.equal(recoveryResult.deliveryStatus, 'completed');
    assert.equal(recoveryResult.cleanedUp, true);
    assert.equal(recoveryResult.action, undefined, 'Advance recovery must NOT return open-html action');

    // Physical files actually deleted
    await assert.rejects(readFile(path.join(runDir, 'evidence.json')), { code: 'ENOENT' });
    await assert.rejects(readFile(path.join(runDir, 'lanes')), { code: 'ENOENT' });

    // Canonical Audit, manifest, trace, and external HTML retained
    assert.ok(await stat(path.join(runDir, 'audit.json')), 'canonical audit must be retained');
    assert.ok(await stat(path.join(runDir, 'manifest.json')), 'manifest must be retained');
    assert.ok(await stat(path.join(runDir, 'trace.jsonl')), 'trace must be retained');
    const externalHtmlStatAfter = await stat(externalHtml);
    assert.equal(externalHtmlStatAfter.mtimeMs, externalHtmlStatBefore.mtimeMs, 'External delivery HTML must not be rewritten');

    // Manifest after successful recovery
    const manifestAfterRecovery = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    assert.equal(manifestAfterRecovery.status, 'completed');
    assert.equal(manifestAfterRecovery.deliveryStatus, 'completed');
    assert.equal(manifestAfterRecovery.cleanupStatus, 'completed');
    assert.ok(manifestAfterRecovery.retention.cleanedAt, 'cleanedAt must be recorded on successful cleanup');
    assert.equal(manifestAfterRecovery.artifacts.evidence, undefined, 'evidence ref must be cleared');
    assert.deepEqual(manifestAfterRecovery.laneArtifacts, {}, 'laneArtifacts must be cleared');
    assert.ok(manifestAfterRecovery.artifacts.audit, 'audit ref retained');
    assert.ok(manifestAfterRecovery.artifacts.trace, 'trace ref retained');

    // Trace records cleanup events reflecting both failure and successful recovery
    const traceLines = (await readFile(path.join(runDir, 'trace.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    const cleanupTraceEvents = traceLines.filter((e) => e.event === 'cleanup');
    assert.equal(cleanupTraceEvents.length, 2, 'trace must record both cleanup attempts');
    assert.ok(cleanupTraceEvents[0].status === 'failed' || cleanupTraceEvents[0].status === 'partial');
    assert.ok(cleanupTraceEvents[0].errors.some((err) => err.code === 'EPERM'), 'first cleanup trace must record EPERM failure');
    assert.equal(cleanupTraceEvents[1].status, 'completed');
    assert.equal(cleanupTraceEvents[1].errors.length, 0);

    // AC-4: Repeated advance and repeated --ui completed are idempotent
    const repeatAdvance = await runCli([
      'report-run', 'advance',
      '--run-dir', runDir,
    ], env);
    assert.equal(repeatAdvance.code, 0, repeatAdvance.stderr);
    const repeatAdvanceResult = JSON.parse(repeatAdvance.stdout);
    assert.equal(repeatAdvanceResult.status, 'completed');
    assert.equal(repeatAdvanceResult.deliveryStatus, 'completed');
    assert.equal(repeatAdvanceResult.cleanedUp, true);
    assert.equal(repeatAdvanceResult.action, undefined);

    const repeatUi = await runCli([
      'report-run', 'advance',
      '--run-dir', runDir,
      '--ui', 'completed',
    ], env);
    assert.equal(repeatUi.code, 0, repeatUi.stderr);
    const repeatUiResult = JSON.parse(repeatUi.stdout);
    assert.equal(repeatUiResult.status, 'completed');
    assert.equal(repeatUiResult.deliveryStatus, 'completed');
    assert.equal(repeatUiResult.cleanedUp, true);

    // Final verification: external delivery file remains completely intact
    const finalHtmlStat = await stat(externalHtml);
    assert.equal(finalHtmlStat.size, externalHtmlStatBefore.size);
    assert.equal(finalHtmlStat.mtimeMs, externalHtmlStatBefore.mtimeMs);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

