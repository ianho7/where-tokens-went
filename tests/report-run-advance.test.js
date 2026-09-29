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
