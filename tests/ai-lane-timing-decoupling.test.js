const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { mkdtemp, mkdir, writeFile, readFile, rm } = require('node:fs/promises');
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

async function setupTestFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wtw-timing-decoupling-'));
  const project = path.join(root, 'project');
  const codexHome = path.join(root, 'codex-home');
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const sessions = path.join(codexHome, 'sessions', year, month, day);
  await mkdir(project, { recursive: true });
  await mkdir(sessions, { recursive: true });
  const timestamp = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  // Primary task rollout
  const primaryRolloutPath = path.join(sessions, 'rollout-session-1.jsonl');
  await writeFile(primaryRolloutPath, [
    { timestamp, type: 'session_meta', payload: { id: 'session-1', cwd: project, originator: 'Codex CLI', cli_version: '0.1.0', model_provider: 'openai' } },
    { timestamp, type: 'turn_context', payload: { turn_id: 'turn-1', cwd: project, model: 'gpt-5', model_provider: 'openai' } },
    { timestamp, type: 'event_msg', payload: { type: 'token_usage_record', response_id: 'resp-1', turn_id: 'turn-1', usage: { input_tokens: 100, output_tokens: 20, reasoning_output_tokens: 0, total_tokens: 120 }, turn_token_usage: { input_tokens: 100, output_tokens: 20, reasoning_output_tokens: 0, total_tokens: 120 } } },
    { timestamp, type: 'response_item', payload: { type: 'message', role: 'user', turn_id: 'turn-1', content: 'Synthetic prompt for regression fixture.' } },
  ].map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');

  // Real terminal failed generation rollout in Codex persistence
  const failedRolloutPath = path.join(sessions, 'rollout-failed.jsonl');
  await writeFile(failedRolloutPath, [
    { timestamp, type: 'session_meta', payload: { id: 'session-fail-1', cwd: project, originator: 'Codex CLI', cli_version: '0.1.0', model_provider: 'openai' } },
    { timestamp, type: 'turn_context', payload: { turn_id: 'turn-fail-1', cwd: project, model: 'gpt-5', model_provider: 'openai' } },
    { timestamp, type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-fail-1' } },
    { timestamp, type: 'event_msg', payload: { type: 'stream_error', turn_id: 'turn-fail-1', error: 'Model stream terminated abnormally' } },
    { timestamp, type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-fail-1', status: 'error', error: 'Model stream terminated abnormally' } },
  ].map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');

  // Rollout with transient stream_error but no terminal failure event
  const streamErrorOnlyRolloutPath = path.join(sessions, 'rollout-stream-only.jsonl');
  await writeFile(streamErrorOnlyRolloutPath, [
    { timestamp, type: 'session_meta', payload: { id: 'session-stream-only-1', cwd: project, originator: 'Codex CLI', cli_version: '0.1.0', model_provider: 'openai' } },
    { timestamp, type: 'turn_context', payload: { turn_id: 'turn-stream-only-1', cwd: project, model: 'gpt-5', model_provider: 'openai' } },
    { timestamp, type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-stream-only-1' } },
    { timestamp, type: 'event_msg', payload: { type: 'stream_error', turn_id: 'turn-stream-only-1', error: 'Transient connection drop' } },
  ].map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');

  // Rollout with transient stream_error that recovered and completed successfully
  const streamErrorRecoveredRolloutPath = path.join(sessions, 'rollout-stream-recovered.jsonl');
  await writeFile(streamErrorRecoveredRolloutPath, [
    { timestamp, type: 'session_meta', payload: { id: 'session-recovered-1', cwd: project, originator: 'Codex CLI', cli_version: '0.1.0', model_provider: 'openai' } },
    { timestamp, type: 'turn_context', payload: { turn_id: 'turn-recovered-1', cwd: project, model: 'gpt-5', model_provider: 'openai' } },
    { timestamp, type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-recovered-1' } },
    { timestamp, type: 'event_msg', payload: { type: 'stream_error', turn_id: 'turn-recovered-1', error: 'Transient connection drop' } },
    { timestamp, type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-recovered-1', status: 'ok' } },
  ].map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');

  // Real interrupted generation rollout in Codex persistence
  const interruptedRolloutPath = path.join(sessions, 'rollout-interrupted.jsonl');
  await writeFile(interruptedRolloutPath, [
    { timestamp, type: 'session_meta', payload: { id: 'session-int-1', cwd: project, originator: 'Codex CLI', cli_version: '0.1.0', model_provider: 'openai' } },
    { timestamp, type: 'turn_context', payload: { turn_id: 'turn-int-1', cwd: project, model: 'gpt-5', model_provider: 'openai' } },
    { timestamp, type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-int-1' } },
    { timestamp, type: 'event_msg', payload: { type: 'turn_aborted' } },
  ].map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');

  // Non-failing rollout (completed without errors) in Codex persistence
  const completedRolloutPath = path.join(sessions, 'rollout-completed.jsonl');
  await writeFile(completedRolloutPath, [
    { timestamp, type: 'session_meta', payload: { id: 'session-completed-1', cwd: project, originator: 'Codex CLI', cli_version: '0.1.0', model_provider: 'openai' } },
    { timestamp, type: 'turn_context', payload: { turn_id: 'turn-completed-1', cwd: project, model: 'gpt-5', model_provider: 'openai' } },
    { timestamp, type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-completed-1', status: 'ok' } },
  ].map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');

  const env = { CODEX_HOME: codexHome, TEMP: root, TMP: root };
  return {
    root,
    project,
    codexHome,
    sessions,
    failedRolloutPath,
    streamErrorOnlyRolloutPath,
    streamErrorRecoveredRolloutPath,
    interruptedRolloutPath,
    completedRolloutPath,
    env,
  };
}

async function prepareRun(fixture, runSubdir) {
  const runDir = path.join(fixture.root, runSubdir);
  const prepared = await runCli(['report-run', 'prepare', '--harness', 'codex', '--cwd', fixture.project, '--since', '1d', '--locale', 'en-US', '--run-dir', runDir], fixture.env);
  assert.equal(prepared.code, 0, prepared.stderr);
  const summary = JSON.parse(prepared.stdout);
  return { runDir, summary };
}

function validSynthesis(fingerprint, audit) {
  const metricKey = Object.keys(audit.summary)[0] ?? 'totalTokens';
  return {
    auditFingerprint: fingerprint,
    overview: {
      summary: 'Recorded usage is concentrated in a bounded test task.',
      evidenceRefs: [`summary:${metricKey}`],
    },
    findings: [
      {
        title: 'Primary task accounts for the recorded usage',
        analysis: 'A single task accounts for all observed tokens in the period.',
        evidenceRefs: [`summary:${metricKey}`],
        support: 'strong',
        uncertainty: null,
      },
      {
        title: 'Context composition reflects initial request size',
        analysis: 'Context input reflects initial prompt volume without large tool result growth.',
        evidenceRefs: [`summary:${metricKey}`],
        support: 'moderate',
        uncertainty: 'Limited period history observed.',
      },
    ],
    noStrongFindingReason: null,
  };
}

// ---------------------------------------------------------------------------
// Scenario 1: AC 1 - Missing host-response.json allows accepted with null duration
// ---------------------------------------------------------------------------
test('AC 1: missing host-response.json allows valid output to be accepted with durationMs null and timing unavailable', async () => {
  const fixture = await setupTestFixture();
  try {
    const { runDir, summary } = await prepareRun(fixture, 'run-ac1');
    const audit = JSON.parse(await readFile(path.join(runDir, 'audit.json'), 'utf8'));

    const start = await runCli(['report-run', 'ai-start', '--run-dir', runDir, '--lane', 'report-synthesis'], fixture.env);
    assert.equal(start.code, 0, start.stderr);
    const ticket = JSON.parse(start.stdout);

    // Confirm no host-response.json exists
    const hostResponsePath = path.join(runDir, 'lanes', 'report-synthesis', 'host-response.json');
    await assert.rejects(readFile(hostResponsePath), { code: 'ENOENT' });

    const synthesis = validSynthesis(summary.auditFingerprint, audit);
    const accept = await runCli(
      ['report-run', 'ai-accept', '--run-dir', runDir, '--lane', 'report-synthesis', '--attempt', String(ticket.attempt), '--span-id', ticket.spanId],
      fixture.env,
      JSON.stringify(synthesis),
    );
    assert.equal(accept.code, 0, accept.stderr);
    const result = JSON.parse(accept.stdout);
    assert.equal(result.status, 'accepted');
    assert.equal(result.validationStatus, 'accepted');
    assert.equal(result.generationTiming.status, 'unavailable');
    assert.equal(result.generationTiming.reasonCode, 'HOST_TIMING_UNAVAILABLE');
    assert.ok(result.acceptedArtifact);

    // Manifest check
    const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    const laneStatus = manifest.laneStatus['report-synthesis'];
    assert.equal(laneStatus.status, 'accepted');
    assert.equal(laneStatus.lastDurationMs, null);
    assert.equal(laneStatus.totalDurationMs, null);
    assert.ok(manifest.laneArtifacts['report-synthesis/accepted.json']);

    // Trace check
    const traceLines = (await readFile(path.join(runDir, 'trace.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    const laneEnd = traceLines.find((e) => e.event === 'end' && e.phase === 'report-synthesis');
    assert.ok(laneEnd);
    assert.equal(laneEnd.operation, 'ai-accept');
    assert.equal(laneEnd.status, 'completed');
    assert.equal(laneEnd.durationMs, null);
    assert.equal(laneEnd.metadata.generationTimingStatus, 'unavailable');
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Scenario 2: AC 2 - Table-driven invalid/expired/mismatched host-response.json
// ---------------------------------------------------------------------------
test('AC 2: table-driven invalid, expired, or mismatched host-response.json preserves accepted lane outcome', async () => {
  const invalidTimingCases = [
    {
      name: 'corrupt-json',
      makeContents: () => '{"invalid json: not closed',
    },
    {
      name: 'output-hash-mismatch',
      makeContents: (context) => JSON.stringify({
        kind: 'host-agent-response',
        source: 'codex-host-agent',
        runId: context.runId,
        lane: 'report-synthesis',
        auditFingerprint: context.auditFingerprint,
        bundleVersion: context.bundleVersion,
        promptHash: context.promptHash,
        inputArtifact: 'lanes/report-synthesis/input.json',
        promptArtifact: 'lanes/report-synthesis/prompt.json',
        outputHash: '0000000000000000000000000000000000000000000000000000000000000000',
        provenance: { status: 'completed', threadId: 't1', turnId: 'u1', responseItemId: 'r1', durationMs: 1500 },
      }),
    },
    {
      name: 'run-id-mismatch',
      makeContents: (context) => JSON.stringify({
        kind: 'host-agent-response',
        source: 'codex-host-agent',
        runId: 'foreign-run-id',
        lane: 'report-synthesis',
        auditFingerprint: context.auditFingerprint,
        bundleVersion: context.bundleVersion,
        promptHash: context.promptHash,
        inputArtifact: 'lanes/report-synthesis/input.json',
        promptArtifact: 'lanes/report-synthesis/prompt.json',
        outputHash: context.outputHash,
        provenance: { status: 'completed', threadId: 't1', turnId: 'u1', responseItemId: 'r1', durationMs: 1500 },
      }),
    },
    {
      name: 'lane-mismatch',
      makeContents: (context) => JSON.stringify({
        kind: 'host-agent-response',
        source: 'codex-host-agent',
        runId: context.runId,
        lane: 'skill-insights',
        auditFingerprint: context.auditFingerprint,
        bundleVersion: context.bundleVersion,
        promptHash: context.promptHash,
        inputArtifact: 'lanes/report-synthesis/input.json',
        promptArtifact: 'lanes/report-synthesis/prompt.json',
        outputHash: context.outputHash,
        provenance: { status: 'completed', threadId: 't1', turnId: 'u1', responseItemId: 'r1', durationMs: 1500 },
      }),
    },
    {
      name: 'attempt-mismatch',
      makeContents: (context) => JSON.stringify({
        kind: 'host-agent-response',
        source: 'codex-host-agent',
        runId: context.runId,
        lane: 'report-synthesis',
        attempt: 99,
        auditFingerprint: context.auditFingerprint,
        bundleVersion: context.bundleVersion,
        promptHash: context.promptHash,
        inputArtifact: 'lanes/report-synthesis/input.json',
        promptArtifact: 'lanes/report-synthesis/prompt.json',
        outputHash: context.outputHash,
        provenance: { status: 'completed', threadId: 't1', turnId: 'u1', responseItemId: 'r1', durationMs: 1500 },
      }),
    },
    {
      name: 'expired-ended-at',
      makeContents: (context) => JSON.stringify({
        kind: 'host-agent-response',
        source: 'codex-host-agent',
        runId: context.runId,
        lane: 'report-synthesis',
        auditFingerprint: context.auditFingerprint,
        bundleVersion: context.bundleVersion,
        promptHash: context.promptHash,
        inputArtifact: 'lanes/report-synthesis/input.json',
        promptArtifact: 'lanes/report-synthesis/prompt.json',
        outputHash: context.outputHash,
        provenance: {
          status: 'completed',
          threadId: 't1',
          turnId: 'u1',
          responseItemId: 'r1',
          durationMs: 1500,
          endedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        },
      }),
    },
  ];

  const fixture = await setupTestFixture();
  try {
    for (const [index, tc] of invalidTimingCases.entries()) {
      const { runDir, summary } = await prepareRun(fixture, `run-ac2-${index}`);
      const audit = JSON.parse(await readFile(path.join(runDir, 'audit.json'), 'utf8'));

      const start = await runCli(['report-run', 'ai-start', '--run-dir', runDir, '--lane', 'report-synthesis'], fixture.env);
      assert.equal(start.code, 0, start.stderr);
      const ticket = JSON.parse(start.stdout);

      const synthesis = validSynthesis(summary.auditFingerprint, audit);
      const rawText = JSON.stringify(synthesis);
      const outputHash = require('node:crypto').createHash('sha256').update(rawText).digest('hex');

      const manifestBefore = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
      const contents = tc.makeContents({
        runId: summary.runId,
        auditFingerprint: summary.auditFingerprint,
        bundleVersion: manifestBefore.bundleVersion,
        promptHash: manifestBefore.promptHashes.reportSynthesis,
        outputHash,
      });

      const hostResponsePath = path.join(runDir, 'lanes', 'report-synthesis', 'host-response.json');
      await writeFile(hostResponsePath, contents, 'utf8');

      const accept = await runCli(
        ['report-run', 'ai-accept', '--run-dir', runDir, '--lane', 'report-synthesis', '--attempt', String(ticket.attempt), '--span-id', ticket.spanId],
        fixture.env,
        rawText,
      );
      assert.equal(accept.code, 0, `${tc.name}: ${accept.stderr}`);
      const result = JSON.parse(accept.stdout);
      assert.equal(result.status, 'accepted', `${tc.name} must remain accepted`);
      assert.equal(result.validationStatus, 'accepted', `${tc.name} must be validation accepted`);
      assert.equal(result.generationTiming.status, 'unavailable', `${tc.name} timing must be unavailable`);
      assert.equal(result.generationTiming.reasonCode, 'HOST_TIMING_INVALID', `${tc.name} timing reason must be invalid`);

      const manifestAfter = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
      const laneStatus = manifestAfter.laneStatus['report-synthesis'];
      assert.equal(laneStatus.status, 'accepted');
      assert.equal(laneStatus.lastDurationMs, null);
      assert.equal(laneStatus.totalDurationMs, null);

      const traceLines = (await readFile(path.join(runDir, 'trace.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
      const laneEnd = traceLines.find((e) => e.event === 'end' && e.phase === 'report-synthesis');
      assert.ok(laneEnd);
      assert.equal(laneEnd.durationMs, null);
      assert.equal(laneEnd.status, 'completed');
      assert.equal(laneEnd.metadata.generationTimingStatus, 'unavailable');
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Scenario 3: AC 3 - Illegal unavailable requests are rejected, Run cannot complete
// ---------------------------------------------------------------------------
test('AC 3: table-driven illegal unavailable requests are rejected and Run cannot finalize as completed', async () => {
  const fixture = await setupTestFixture();
  try {
    const { runDir, summary } = await prepareRun(fixture, 'run-ac3');
    const start = await runCli(['report-run', 'ai-start', '--run-dir', runDir, '--lane', 'report-synthesis'], fixture.env);
    assert.equal(start.code, 0, start.stderr);
    const ticket = JSON.parse(start.stdout);
    const receiptPath = path.join(runDir, 'lanes', 'report-synthesis', 'host-failure.json');

    const illegalUnavailableCases = [
      {
        name: 'missing-reason-code',
        args: ['report-run', 'ai-fallback', '--run-dir', runDir, '--lane', 'report-synthesis', '--status', 'unavailable'],
        expectedError: /REASON_CODE_REQUIRED/,
      },
      {
        name: 'timing-unavailable-reason-code',
        args: ['report-run', 'ai-fallback', '--run-dir', runDir, '--lane', 'report-synthesis', '--status', 'unavailable', '--reason-code', 'HOST_TIMING_UNAVAILABLE'],
        expectedError: /TIMING_CANNOT_AUTHORIZE_UNAVAILABLE/,
      },
      {
        name: 'timing-invalid-reason-code',
        args: ['report-run', 'ai-fallback', '--run-dir', runDir, '--lane', 'report-synthesis', '--status', 'unavailable', '--reason-code', 'HOST_TIMING_INVALID'],
        expectedError: /TIMING_CANNOT_AUTHORIZE_UNAVAILABLE/,
      },
      {
        name: 'free-text-reason-code',
        args: ['report-run', 'ai-fallback', '--run-dir', runDir, '--lane', 'report-synthesis', '--status', 'unavailable', '--reason-code', 'UNEXPECTED_MODEL_FAILURE'],
        expectedError: /ILLEGAL_REASON_CODE/,
      },
      {
        name: 'arbitrary-receipt-flag-rejected',
        args: ['report-run', 'ai-fallback', '--run-dir', runDir, '--lane', 'report-synthesis', '--status', 'unavailable', '--reason-code', 'HOST_GENERATION_FAILED', '--receipt', '/tmp/any-receipt.json'],
        expectedError: /Unknown ai-fallback argument/,
      },
      {
        name: 'missing-receipt-file',
        args: ['report-run', 'ai-fallback', '--run-dir', runDir, '--lane', 'report-synthesis', '--status', 'unavailable', '--reason-code', 'HOST_GENERATION_FAILED'],
        expectedError: /HOST_FAILURE_RECEIPT_REQUIRED/,
      },
      {
        name: 'missing-attempt-in-receipt',
        receipt: (ctx) => ({ kind: 'host-agent-failure', source: 'codex-host-agent', runId: ctx.runId, lane: 'report-synthesis', spanId: ctx.spanId, reasonCode: 'HOST_GENERATION_FAILED', provenance: { harness: 'codex', status: 'failed', rolloutPath: fixture.failedRolloutPath, sessionId: 'session-fail-1', turnId: 'turn-fail-1' } }),
        args: ['report-run', 'ai-fallback', '--run-dir', runDir, '--lane', 'report-synthesis', '--status', 'unavailable', '--reason-code', 'HOST_GENERATION_FAILED'],
        expectedError: /attempt mismatch or missing/,
      },
      {
        name: 'missing-span-in-receipt',
        receipt: (ctx) => ({ kind: 'host-agent-failure', source: 'codex-host-agent', runId: ctx.runId, lane: 'report-synthesis', attempt: ctx.attempt, reasonCode: 'HOST_GENERATION_FAILED', provenance: { harness: 'codex', status: 'failed', rolloutPath: fixture.failedRolloutPath, sessionId: 'session-fail-1', turnId: 'turn-fail-1' } }),
        args: ['report-run', 'ai-fallback', '--run-dir', runDir, '--lane', 'report-synthesis', '--status', 'unavailable', '--reason-code', 'HOST_GENERATION_FAILED'],
        expectedError: /spanId mismatch or missing/,
      },
      {
        name: 'missing-reasonCode-in-receipt',
        receipt: (ctx) => ({ kind: 'host-agent-failure', source: 'codex-host-agent', runId: ctx.runId, lane: 'report-synthesis', attempt: ctx.attempt, spanId: ctx.spanId, provenance: { harness: 'codex', status: 'failed', rolloutPath: fixture.failedRolloutPath, sessionId: 'session-fail-1', turnId: 'turn-fail-1' } }),
        args: ['report-run', 'ai-fallback', '--run-dir', runDir, '--lane', 'report-synthesis', '--status', 'unavailable', '--reason-code', 'HOST_GENERATION_FAILED'],
        expectedError: /reasonCode mismatch or missing/,
      },
      {
        name: 'missing-provenance-in-receipt',
        receipt: (ctx) => ({ kind: 'host-agent-failure', source: 'codex-host-agent', runId: ctx.runId, lane: 'report-synthesis', attempt: ctx.attempt, spanId: ctx.spanId, reasonCode: 'HOST_GENERATION_FAILED' }),
        args: ['report-run', 'ai-fallback', '--run-dir', runDir, '--lane', 'report-synthesis', '--status', 'unavailable', '--reason-code', 'HOST_GENERATION_FAILED'],
        expectedError: /provenance is missing or not an object/,
      },
      {
        name: 'provenance-status-missing-or-not-explicit-failure',
        receipt: (ctx) => ({ kind: 'host-agent-failure', source: 'codex-host-agent', runId: ctx.runId, lane: 'report-synthesis', attempt: ctx.attempt, spanId: ctx.spanId, reasonCode: 'HOST_GENERATION_FAILED', provenance: { harness: 'codex', status: 'unknown', rolloutPath: fixture.failedRolloutPath, sessionId: 'session-fail-1', turnId: 'turn-fail-1' } }),
        args: ['report-run', 'ai-fallback', '--run-dir', runDir, '--lane', 'report-synthesis', '--status', 'unavailable', '--reason-code', 'HOST_GENERATION_FAILED'],
        expectedError: /is not an explicit failure or interruption/,
      },
      {
        name: 'caller-created-cannot-verify-from-harness-external-path',
        receipt: (ctx) => ({ kind: 'host-agent-failure', source: 'codex-host-agent', runId: ctx.runId, lane: 'report-synthesis', attempt: ctx.attempt, spanId: ctx.spanId, reasonCode: 'HOST_GENERATION_FAILED', provenance: { harness: 'codex', status: 'failed', rolloutPath: '/tmp/unauthorized/rollout.jsonl', sessionId: 'session-fail-1', turnId: 'turn-fail-1' } }),
        args: ['report-run', 'ai-fallback', '--run-dir', runDir, '--lane', 'report-synthesis', '--status', 'unavailable', '--reason-code', 'HOST_GENERATION_FAILED'],
        expectedError: /CODEX_PROVENANCE_ROLLOUT_NOT_HARNESS_OWNED/,
      },
      {
        name: 'caller-created-rollout-lacks-failure-event',
        receipt: (ctx) => ({ kind: 'host-agent-failure', source: 'codex-host-agent', runId: ctx.runId, lane: 'report-synthesis', attempt: ctx.attempt, spanId: ctx.spanId, reasonCode: 'HOST_GENERATION_FAILED', provenance: { harness: 'codex', status: 'failed', rolloutPath: fixture.completedRolloutPath, sessionId: 'session-completed-1', turnId: 'turn-completed-1' } }),
        args: ['report-run', 'ai-fallback', '--run-dir', runDir, '--lane', 'report-synthesis', '--status', 'unavailable', '--reason-code', 'HOST_GENERATION_FAILED'],
        expectedError: /CODEX_PROVENANCE_TERMINAL_FAILURE_EVENT_MISSING/,
      },
      {
        name: 'stream-error-only-without-terminal-failure',
        receipt: (ctx) => ({ kind: 'host-agent-failure', source: 'codex-host-agent', runId: ctx.runId, lane: 'report-synthesis', attempt: ctx.attempt, spanId: ctx.spanId, reasonCode: 'HOST_GENERATION_FAILED', provenance: { harness: 'codex', status: 'failed', rolloutPath: fixture.streamErrorOnlyRolloutPath, sessionId: 'session-stream-only-1', turnId: 'turn-stream-only-1' } }),
        args: ['report-run', 'ai-fallback', '--run-dir', runDir, '--lane', 'report-synthesis', '--status', 'unavailable', '--reason-code', 'HOST_GENERATION_FAILED'],
        expectedError: /CODEX_PROVENANCE_TERMINAL_FAILURE_EVENT_MISSING/,
      },
      {
        name: 'stream-error-followed-by-successful-complete',
        receipt: (ctx) => ({ kind: 'host-agent-failure', source: 'codex-host-agent', runId: ctx.runId, lane: 'report-synthesis', attempt: ctx.attempt, spanId: ctx.spanId, reasonCode: 'HOST_GENERATION_FAILED', provenance: { harness: 'codex', status: 'failed', rolloutPath: fixture.streamErrorRecoveredRolloutPath, sessionId: 'session-recovered-1', turnId: 'turn-recovered-1' } }),
        args: ['report-run', 'ai-fallback', '--run-dir', runDir, '--lane', 'report-synthesis', '--status', 'unavailable', '--reason-code', 'HOST_GENERATION_FAILED'],
        expectedError: /CODEX_PROVENANCE_TERMINAL_FAILURE_EVENT_MISSING/,
      },
    ];

    for (const tc of illegalUnavailableCases) {
      if (tc.receipt) {
        const receiptData = tc.receipt({
          runId: summary.runId,
          attempt: ticket.attempt,
          spanId: ticket.spanId,
        });
        await writeFile(receiptPath, JSON.stringify(receiptData), 'utf8');
      } else {
        await rm(receiptPath, { force: true });
      }

      const fallback = await runCli(tc.args, fixture.env);
      assert.notEqual(fallback.code, 0, `${tc.name} must fail with non-zero exit`);
      assert.match(fallback.stderr, tc.expectedError, `${tc.name} error message must match expected`);

      // Verify lane remained in "running" state
      const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
      assert.equal(manifest.laneStatus['report-synthesis'].status, 'running', `${tc.name} lane status must remain running`);
    }

    // Verify compose is refused because lane is still running
    const compose = await runCli(['report-run', 'compose', '--run-dir', runDir, '--locale', 'en-US', '--json'], fixture.env);
    assert.notEqual(compose.code, 0, 'compose must fail when lane is unclosed');
    assert.match(compose.stderr, /REPORT_COMPOSE_LANES_INCOMPLETE/);

    // Verify finalize refuses to complete
    const finalize = await runCli(['report-run', 'finalize', '--run-dir', runDir, '--status', 'completed'], fixture.env);
    assert.equal(finalize.code, 2, 'finalize must return exit 2 when lane is incomplete');
    const finalManifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    assert.equal(finalManifest.status, 'incomplete', 'final manifest status must be incomplete');
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Scenario 4: AC 4 - Validation failures produce validator fallback, not AI_UNAVAILABLE
// ---------------------------------------------------------------------------
test('AC 4: model output validation failure creates validator fallback with raw/validation artifacts and never degrades to AI_UNAVAILABLE', async () => {
  const validationFailureCases = [
    {
      name: 'invalid-json',
      rawText: '{"overview": { incomplete json',
      expectedReasonCode: 'MODEL_OUTPUT_INVALID_JSON',
      lane: 'report-synthesis',
    },
    {
      name: 'semantic-failure-report-synthesis',
      rawText: JSON.stringify({
        auditFingerprint: 'wrong-fingerprint',
        overview: { summary: 'Summary text.', evidenceRefs: ['summary:totalTokens'] },
        findings: [],
        noStrongFindingReason: 'No patterns.',
      }),
      expectedReasonCode: 'REPORT_SYNTHESIS_INVALID',
      lane: 'report-synthesis',
    },
  ];

  const fixture = await setupTestFixture();
  try {
    for (const [index, tc] of validationFailureCases.entries()) {
      const { runDir } = await prepareRun(fixture, `run-ac4-${index}`);

      const start = await runCli(['report-run', 'ai-start', '--run-dir', runDir, '--lane', tc.lane], fixture.env);
      assert.equal(start.code, 0, start.stderr);
      const ticket = JSON.parse(start.stdout);

      const accept = await runCli(
        ['report-run', 'ai-accept', '--run-dir', runDir, '--lane', tc.lane, '--attempt', String(ticket.attempt), '--span-id', ticket.spanId],
        fixture.env,
        tc.rawText,
      );
      assert.equal(accept.code, 0, accept.stderr);
      const result = JSON.parse(accept.stdout);

      assert.equal(result.status, 'fallback');
      assert.equal(result.validationStatus, 'rejected');
      assert.equal(result.reasonCode, tc.expectedReasonCode);
      assert.notEqual(result.reasonCode, 'AI_UNAVAILABLE');

      // Check artifacts
      const rawArtifact = await readFile(path.join(runDir, `lanes/${tc.lane}/attempt-${ticket.attempt}.raw.json`), 'utf8');
      assert.equal(rawArtifact, tc.rawText);

      const validationArtifact = JSON.parse(await readFile(path.join(runDir, `lanes/${tc.lane}/attempt-${ticket.attempt}.validation.json`), 'utf8'));
      assert.equal(validationArtifact.status, 'rejected');
      assert.ok(validationArtifact.errors.length > 0);
      assert.equal(validationArtifact.errors[0].code, tc.expectedReasonCode);

      const fallbackArtifact = JSON.parse(await readFile(path.join(runDir, `lanes/${tc.lane}/fallback.json`), 'utf8'));
      assert.equal(fallbackArtifact.status, 'fallback');
      assert.equal(fallbackArtifact.reasonCode, tc.expectedReasonCode);
      assert.notEqual(fallbackArtifact.reasonCode, 'AI_UNAVAILABLE');

      // Manifest check
      const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
      assert.equal(manifest.laneStatus[tc.lane].status, 'fallback');
      assert.equal(manifest.laneStatus[tc.lane].reasonCode, tc.expectedReasonCode);
      assert.notEqual(manifest.laneStatus[tc.lane].reasonCode, 'AI_UNAVAILABLE');

      // Trace check
      const traceLines = (await readFile(path.join(runDir, 'trace.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
      const laneEnd = traceLines.find((e) => e.event === 'end' && e.phase === tc.lane);
      assert.ok(laneEnd);
      assert.equal(laneEnd.operation, 'ai-fallback');
      assert.equal(laneEnd.status, 'fallback');
      assert.equal(laneEnd.errorCode, tc.expectedReasonCode);
      assert.notEqual(laneEnd.errorCode, 'AI_UNAVAILABLE');
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Scenario 5: AC 5 - Bound Host failure receipt verified from Harness persistence
// ---------------------------------------------------------------------------
test('AC 5: bound Host failure receipt verified from Harness persistence closes lane as generation unavailable with durationMs null', async () => {
  const validFailureCases = [
    {
      name: 'explicit-terminal-failure',
      reasonCode: 'HOST_GENERATION_FAILED',
      provenanceStatus: 'failed',
      getRolloutPath: (fixture) => fixture.failedRolloutPath,
      sessionId: 'session-fail-1',
      turnId: 'turn-fail-1',
    },
    {
      name: 'explicit-turn-aborted',
      reasonCode: 'HOST_GENERATION_INTERRUPTED',
      provenanceStatus: 'interrupted',
      getRolloutPath: (fixture) => fixture.interruptedRolloutPath,
      sessionId: 'session-int-1',
      turnId: 'turn-int-1',
    },
  ];

  const fixture = await setupTestFixture();
  try {
    for (const [index, tc] of validFailureCases.entries()) {
      const { runDir, summary } = await prepareRun(fixture, `run-ac5-${index}`);

      const start = await runCli(['report-run', 'ai-start', '--run-dir', runDir, '--lane', 'report-synthesis'], fixture.env);
      assert.equal(start.code, 0, start.stderr);
      const ticket = JSON.parse(start.stdout);

      // Write complete bound failure receipt pointing to real Harness persistence rollout
      const receipt = {
        kind: 'host-agent-failure',
        source: 'codex-host-agent',
        runId: summary.runId,
        lane: 'report-synthesis',
        attempt: ticket.attempt,
        spanId: ticket.spanId,
        reasonCode: tc.reasonCode,
        provenance: {
          harness: 'codex',
          status: tc.provenanceStatus,
          rolloutPath: tc.getRolloutPath(fixture),
          sessionId: tc.sessionId,
          turnId: tc.turnId,
        },
      };
      await writeFile(path.join(runDir, 'lanes', 'report-synthesis', 'host-failure.json'), JSON.stringify(receipt), 'utf8');

      const fallback = await runCli(
        ['report-run', 'ai-fallback', '--run-dir', runDir, '--lane', 'report-synthesis', '--status', 'unavailable', '--reason-code', tc.reasonCode],
        fixture.env,
      );
      assert.equal(fallback.code, 0, fallback.stderr);
      const result = JSON.parse(fallback.stdout);
      assert.equal(result.status, 'unavailable');
      assert.equal(result.reasonCode, tc.reasonCode);

      // Manifest checks: duration must NOT be forged
      const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
      const laneStatus = manifest.laneStatus['report-synthesis'];
      assert.equal(laneStatus.status, 'unavailable');
      assert.equal(laneStatus.reasonCode, tc.reasonCode);
      assert.equal(laneStatus.lastDurationMs, null, 'Must not forge generation duration');
      assert.equal(laneStatus.totalDurationMs, null, 'Must not forge generation duration');

      // Trace checks
      const traceLines = (await readFile(path.join(runDir, 'trace.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
      const laneEnd = traceLines.find((e) => e.event === 'end' && e.phase === 'report-synthesis');
      assert.ok(laneEnd);
      assert.equal(laneEnd.operation, 'ai-fallback');
      assert.equal(laneEnd.status, 'unavailable');
      assert.equal(laneEnd.errorCode, tc.reasonCode);
      assert.equal(laneEnd.durationMs, null, 'Trace must not forge duration');
      assert.equal(laneEnd.metadata.generationTimingStatus, 'unavailable');
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
