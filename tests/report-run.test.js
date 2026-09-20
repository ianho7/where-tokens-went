const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { createReportRun, withRunSpan, finalizeReportRun, readRunManifest } = require('../dist/src/report-run.js');
const { resolveApiPricing } = require('../dist/src/rates.js');
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

test('Report Run persists successful and failed spans without raw error text', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-run-test-'));
  try {
    const run = await createReportRun({
      harness: 'codex',
      cwd: 'D:\\project\\agent-audit',
      allProjects: false,
      since: new Date('2026-09-15T00:00:00.000Z'),
      until: new Date('2026-09-16T00:00:00.000Z'),
      locale: 'zh-CN',
    }, root);

    await withRunSpan(run, {
      phase: 'history-read',
      source: 'runner',
      operation: 'read-history',
    }, async () => 'ok');

    await assert.rejects(
      withRunSpan(run, {
        phase: 'price-resolution',
        source: 'network',
        operation: 'lookup-price',
      }, async () => {
        const error = new Error('do-not-persist-this-secret');
        error.code = 'EACCES';
        throw error;
      }),
      /do-not-persist-this-secret/,
    );

    await finalizeReportRun(run, 'failed');
    const manifest = await readRunManifest(run.runDir);
    const trace = await readFile(path.join(run.runDir, 'trace.jsonl'), 'utf8');

    assert.equal(manifest.runId, run.runId);
    assert.equal(manifest.scope.until, '2026-09-16T00:00:00.000Z');
    assert.equal(manifest.stageStatus['history-read'].status, 'completed');
    assert.equal(manifest.stageStatus['price-resolution'].status, 'failed');
    assert.equal(manifest.status, 'failed');
    assert.match(trace, /"phase":"history-read"/);
    assert.match(trace, /"status":"failed"/);
    assert.doesNotMatch(trace, /do-not-persist-this-secret/);
    assert.match(trace, /"errorCode":"EACCES"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('pricing resolution exposes one bounded timing event per catalog request', async () => {
  const events = [];
  const result = await resolveApiPricing(
    [{ provider: 'openai', model: 'gpt-run-fixture' }],
    'codex',
    'litellm',
    async (url) => ({
      ok: url.includes('?'),
      status: url.includes('?') ? 200 : 404,
      json: async () => [{ id: 'gpt-run-fixture', provider: 'openai', input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 }],
    }),
    'https://pricing.test/catalog',
    (event) => { events.push(event); },
  );
  assert.equal(result.rates.length, 1);
  assert.deepEqual(events.map((event) => event.kind), ['direct', 'search']);
  assert.ok(events.every((event) => event.durationMs >= 0));
  assert.equal(events[0].status, 404);
  assert.equal(events[1].status, 200);
  assert.equal(events[0].responseBytes, null);
  assert.ok(events[1].responseBytes > 0);
});

test('host-agent AI boundary records wall time separately from downstream phases', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-ai-boundary-test-'));
  try {
    const run = await createReportRun({
      harness: 'codex',
      cwd: 'D:\\project\\agent-audit',
      allProjects: false,
      since: new Date('2026-09-15T00:00:00.000Z'),
      until: new Date('2026-09-16T00:00:00.000Z'),
      locale: 'zh-CN',
    }, root);
    const startedAt = '2026-09-15T00:00:00.000Z';
    const endedAt = '2026-09-15T00:00:01.250Z';
    const start = await runCli(['report-run', 'event', '--run-dir', run.runDir], {}, JSON.stringify({
      event: 'start',
      spanId: 'report-synthesis-1',
      phase: 'report-synthesis',
      operation: 'generate-report-synthesis',
      source: 'host-agent',
      attempt: 1,
      startedAt,
      metadata: { timingScope: 'host-agent-wall' },
    }));
    assert.equal(start.code, 0, start.stderr);
    const end = await runCli(['report-run', 'event', '--run-dir', run.runDir], {}, JSON.stringify({
      event: 'end',
      spanId: 'report-synthesis-1',
      phase: 'report-synthesis',
      operation: 'generate-report-synthesis',
      source: 'host-agent',
      attempt: 1,
      startedAt,
      endedAt,
      status: 'completed',
      metadata: { timingScope: 'host-agent-wall' },
    }));
    assert.equal(end.code, 0, end.stderr);
    const manifest = await readRunManifest(run.runDir);
    const trace = await readFile(path.join(run.runDir, 'trace.jsonl'), 'utf8');
    assert.equal(manifest.stageStatus['report-synthesis'].status, 'completed');
    assert.equal(manifest.stageStatus['report-synthesis'].durationMs, 1250);
    assert.match(trace, /"source":"host-agent"/);
    assert.match(trace, /"timingScope":"host-agent-wall"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('report-run reuses one frozen Audit and completes fallback HTML without large stdout', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-cli-run-test-'));
  const project = path.join(root, 'project');
  const codexHome = path.join(root, 'codex-home');
  const sessions = path.join(codexHome, 'sessions', '2026', '09', '16');
  const runDir = path.join(root, 'run');
  const htmlPath = path.join(root, 'report.html');
  const timestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  try {
    await mkdir(project, { recursive: true });
    await mkdir(sessions, { recursive: true });
    await writeFile(path.join(sessions, 'rollout-fixture.jsonl'), [
      { timestamp, type: 'session_meta', payload: { id: 'run-session', cwd: project } },
      { timestamp, type: 'turn_context', payload: { turn_id: 'run-turn', cwd: project } },
      { timestamp, type: 'event_msg', payload: { type: 'token_usage_record', response_id: 'run-response', turn_id: 'run-turn', usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 }, turn_token_usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 } } },
      { timestamp, type: 'response_item', payload: { type: 'message', role: 'user', turn_id: 'run-turn', content: 'bounded fixture prompt' } },
    ].map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');

    const env = { CODEX_HOME: codexHome, TEMP: root, TMP: root };
    const prepared = await runCli(['report-run', 'prepare', '--harness', 'codex', '--cwd', project, '--since', '10000d', '--locale', 'zh-CN', '--run-dir', runDir], env);
    assert.equal(prepared.code, 0, prepared.stderr);
    const preparedSummary = JSON.parse(prepared.stdout);
    assert.equal(Object.hasOwn(preparedSummary, 'audit'), false);
    assert.match(preparedSummary.bundleVersion, /^0\.1\.0\+/);
    assert.ok(preparedSummary.artifacts.audit);
    assert.equal(JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8')).bundleVersion, preparedSummary.bundleVersion);
    assert.equal(preparedSummary.scope.until, JSON.parse(await readFile(path.join(runDir, 'audit.json'), 'utf8')).scope.until);

    const audit = JSON.parse(await readFile(path.join(runDir, 'audit.json'), 'utf8'));
    const selection = { selections: [{ sessionId: 'run-session', turnIds: ['run-turn'], selectionReason: 'largest fixture Turn', unreadScope: 'remaining fixture Turns' }] };
    const firstEvidence = await runCli(['report-run', 'evidence', '--run-dir', runDir], env, JSON.stringify(selection));
    assert.equal(firstEvidence.code, 0, firstEvidence.stderr);
    assert.equal(JSON.parse(firstEvidence.stdout).reused, false);
    const evidence = JSON.parse(await readFile(path.join(runDir, 'evidence.json'), 'utf8'));
    assert.equal(evidence.packets[0].items.length, 1);
    const secondEvidence = await runCli(['report-run', 'evidence', '--run-dir', runDir], env, JSON.stringify(selection));
    assert.equal(secondEvidence.code, 0, secondEvidence.stderr);
    assert.equal(JSON.parse(secondEvidence.stdout).reused, true);

    const aiOutput = JSON.stringify({ runId: preparedSummary.runId, auditFingerprint: preparedSummary.auditFingerprint, promptHashes: preparedSummary.promptHashes, runtimeHash: preparedSummary.runtimeHash, reportSynthesis: null, keySessionAnalyses: [] });
    const composed = await runCli(['report-run', 'compose', '--run-dir', runDir, '--locale', 'zh-CN', '--html', htmlPath], env, aiOutput);
    assert.equal(composed.code, 0, composed.stderr);
    assert.equal(JSON.parse(composed.stdout).reportStatus, 'fallback');
    assert.match(await readFile(htmlPath, 'utf8'), /直接解释不可用或未通过核对/);
    const composedManifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    assert.ok(composedManifest.artifacts.skillInsights, 'Compose must archive Skill Insights independently');
    const skillInsightsArtifact = JSON.parse(await readFile(path.join(runDir, 'skill-insights.json'), 'utf8'));
    assert.deepEqual(skillInsightsArtifact.value, []);

    const event = async (value) => {
      const result = await runCli(['report-run', 'event', '--run-dir', runDir], env, JSON.stringify(value));
      assert.equal(result.code, 0, result.stderr);
    };
    const timedEvent = async (spanId, phase, operation, source, status) => {
      await event({ event: 'start', spanId, phase, operation, source, startedAt: timestamp });
      await event({ event: 'end', spanId, phase, operation, source, startedAt: timestamp, endedAt: timestamp, durationMs: 0, status });
    };
    await timedEvent('skill-read-1', 'skill-read', 'read-installed-skill', 'skill', 'completed');
    await timedEvent('skill-insights-1', 'skill-insights', 'host-agent-skill-insights', 'host-agent', 'skipped');
    await timedEvent('synthesis-1', 'report-synthesis', 'host-agent-report-synthesis', 'host-agent', 'fallback');
    await timedEvent('key-analysis-1', 'key-session-analysis', 'host-agent-key-session-analysis', 'host-agent', 'skipped');
    await event({ event: 'start', spanId: 'open-1', phase: 'codex-open', operation: 'open-final-html', source: 'ui', startedAt: timestamp });
    await event({ event: 'end', spanId: 'open-1', phase: 'codex-open', operation: 'open-final-html', source: 'ui', startedAt: timestamp, endedAt: timestamp, durationMs: 0, status: 'queued' });
    const finalized = await runCli(['report-run', 'finalize', '--run-dir', runDir, '--status', 'completed'], env);
    assert.equal(finalized.code, 0, finalized.stderr);
    const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.status, 'completed');
    assert.equal(manifest.traceCompleteness, 'complete');
    assert.equal(manifest.stageStatus['price-resolution'].status, 'completed');
    assert.equal(manifest.stageStatus['codex-open'].status, 'queued');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
