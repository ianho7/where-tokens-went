const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const cliPath = path.resolve(__dirname, '..', 'dist', 'src', 'cli.js');

test('installed Skill documents one Evidence acquisition path and no duplicate stdin pass', async () => {
  const skill = await readFile(path.resolve(__dirname, '..', 'skills', 'where-tokens-went', 'SKILL.md'), 'utf8');
  assert.match(skill, /report-run run-all start/);
  assert.match(skill, /report-run advance/);
  assert.doesNotMatch(skill, /dispatches `report-run evidence --run-dir <run-directory>` through stdin/);
});

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

test('lane-only start/accept and artifact-only compose retain accepted content without an envelope', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-lane-test-'));
  const project = path.join(root, 'project');
  const codexHome = path.join(root, 'codex-home');
  const sessions = path.join(codexHome, 'sessions', '2026', '09', '20');
  const runDir = path.join(root, 'run');
  const htmlPath = path.join(root, 'report.html');
  const fontPath = path.resolve(__dirname, '..', 'skills', 'where-tokens-went', 'scripts', 'runtime', 'assets', 'fonts', 'TsangerJinKai02-W05.ttf');
  try {
    await mkdir(project, { recursive: true });
    await mkdir(sessions, { recursive: true });
    const timestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await writeFile(path.join(sessions, 'rollout-lane.jsonl'), [
      { timestamp, type: 'session_meta', payload: { id: 'lane-session', cwd: project, originator: 'Codex CLI', cli_version: '0.1.0', model_provider: 'openai' } },
      { timestamp, type: 'turn_context', payload: { turn_id: 'lane-turn', cwd: project } },
      { timestamp, type: 'event_msg', payload: { type: 'token_usage_record', response_id: 'lane-response', turn_id: 'lane-turn', usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 }, turn_token_usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 } } },
      { timestamp, type: 'response_item', payload: { type: 'message', role: 'user', turn_id: 'lane-turn', content: 'Recognizable fixture prompt for the final report route.' } },
      { timestamp, type: 'turn_context', payload: { turn_id: 'fail-turn', cwd: project } },
      { timestamp, type: 'event_msg', payload: { type: 'stream_error', turn_id: 'fail-turn', error: 'simulated model stream failure' } },
      { timestamp, type: 'event_msg', payload: { type: 'task_complete', turn_id: 'fail-turn', status: 'error', error: 'simulated model stream failure' } },
    ].map((record) => JSON.stringify(record)).join('\n') + '\n');
    const env = { CODEX_HOME: codexHome, TEMP: root, TMP: root };
    const prepared = await runCli(['report-run', 'prepare', '--harness', 'codex', '--cwd', project, '--since', '10000d', '--locale', 'en-US', '--run-dir', runDir], env);
    assert.equal(prepared.code, 0, prepared.stderr);
    const summary = JSON.parse(prepared.stdout);
    const evidence = await runCli(['report-run', 'evidence', '--run-dir', runDir, '--auto'], env);
    assert.equal(evidence.code, 0, evidence.stderr);
    const start = await runCli(['report-run', 'ai-start', '--run-dir', runDir, '--lane', 'report-synthesis'], env);
    assert.equal(start.code, 0, start.stderr);
    const ticket = JSON.parse(start.stdout);
    assert.equal(ticket.inputArtifact, 'lanes/report-synthesis/input.json');
    const audit = JSON.parse(await readFile(path.join(runDir, 'audit.json'), 'utf8'));
    const evidenceRef = `summary:${Object.keys(audit.summary)[0]}`;
    const synthesis = {
      auditFingerprint: summary.auditFingerprint,
      overview: { summary: 'The fixture records a bounded activity period.', evidenceRefs: [evidenceRef] },
      findings: [],
      noStrongFindingReason: 'The fixture does not contain enough evidence for a distinct report-level finding.',
    };
    const wrongSpan = await runCli(['report-run', 'ai-accept', '--run-dir', runDir, '--lane', 'report-synthesis', '--attempt', String(ticket.attempt), '--span-id', 'wrong-span'], env, JSON.stringify(synthesis));
    assert.equal(wrongSpan.code, 2);
    assert.match(wrongSpan.stderr, /RUN_LANE_SPAN_MISMATCH/);
    const accepted = await runCli(['report-run', 'ai-accept', '--run-dir', runDir, '--lane', 'report-synthesis', '--attempt', String(ticket.attempt), '--span-id', ticket.spanId], env, JSON.stringify(synthesis));
    assert.equal(accepted.code, 0, accepted.stderr);
    for (const lane of ['key-session-analysis', 'skill-insights']) {
      const laneStart = await runCli(['report-run', 'ai-start', '--run-dir', runDir, '--lane', lane], env);
      assert.equal(laneStart.code, 0, laneStart.stderr);
      const laneTicket = JSON.parse(laneStart.stdout);
      await writeFile(path.join(runDir, 'lanes', lane, 'host-failure.json'), JSON.stringify({
        kind: 'host-agent-failure',
        source: 'codex-host-agent',
        runId: summary.runId,
        lane,
        attempt: laneTicket.attempt,
        spanId: laneTicket.spanId,
        reasonCode: 'HOST_GENERATION_FAILED',
        provenance: {
          harness: 'codex',
          status: 'failed',
          rolloutPath: path.join(sessions, 'rollout-lane.jsonl'),
          sessionId: 'lane-session',
          turnId: 'fail-turn',
          error: 'simulated model stream failure',
        },
      }));
      const fallback = await runCli(['report-run', 'ai-fallback', '--run-dir', runDir, '--lane', lane, '--status', 'unavailable', '--reason-code', 'HOST_GENERATION_FAILED'], env);
      assert.equal(fallback.code, 0, fallback.stderr);
    }
    const composed = await runCli(['report-run', 'compose', '--run-dir', runDir, '--locale', 'en-US', '--json', '--font', fontPath, '--font-family', 'ticket-local-font'], env);
    assert.equal(composed.code, 0, composed.stderr);
    const jsonPath = path.join(runDir, 'report.json');
    const reportJson = JSON.parse(await readFile(jsonPath, 'utf8'));
    assert.equal(JSON.parse(composed.stdout).reportJsonPath, jsonPath);
    assert.equal(reportJson.render.projectName, 'project');
    assert.equal(reportJson.render.font.source, 'custom');
    assert.equal(reportJson.render.font.filePath, fontPath);
    assert.equal(reportJson.render.font.family, 'ticket-local-font');
    assert.ok(reportJson.render.firstUserMessages.some((record) => record.content === 'Recognizable fixture prompt for the final report route.'));
    assert.equal(reportJson.ai.reportSynthesis.result.overview.summary, 'The fixture records a bounded activity period.');
    assert.ok(reportJson.ai.keySessionAnalyses.fallbackReason);
    assert.ok(reportJson.ai.skillInsights.fallbackReason);
    await assert.rejects(readFile(htmlPath), { code: 'ENOENT' });

    const blockedCodexHome = path.join(root, 'codex-home-is-a-file');
    await writeFile(blockedCodexHome, 'JSON rendering must not inspect Codex history.', 'utf8');
    const rendered = await runCli(['render-report', '--json', jsonPath, '--html', htmlPath, '--run-dir', runDir], {
      ...env,
      CODEX_HOME: blockedCodexHome,
      FONT_CACHE_DIR: path.join(root, 'font-cache'),
    });
    assert.equal(rendered.code, 0, rendered.stderr);
    const html = await readFile(htmlPath, 'utf8');
    assert.match(html, /The fixture records a bounded activity period/);
    assert.match(html, /ticket-local-font/);
    assert.match(html, /Recognizable fixture prompt for the final report route\./);
    const forgedEnvelope = await runCli(['report-run', 'compose', '--run-dir', runDir, '--locale', 'en-US', '--json'], env, JSON.stringify({ reportSynthesis: {} }));
    assert.equal(forgedEnvelope.code, 2);
    assert.match(forgedEnvelope.stderr, /REPORT_COMPOSE_STDIN_FORBIDDEN/);
    const openSpanId = 'route-html-open';
    const openStarted = await runCli(['report-run', 'event', '--run-dir', runDir], env, JSON.stringify({
      event: 'start', phase: 'codex-open', operation: 'open-final-html', source: 'ui', spanId: openSpanId,
    }));
    assert.equal(openStarted.code, 0, openStarted.stderr);
    const openFinished = await runCli(['report-run', 'event', '--run-dir', runDir], env, JSON.stringify({
      event: 'end', phase: 'codex-open', operation: 'open-final-html', source: 'ui', spanId: openSpanId, status: 'completed', durationMs: 1,
    }));
    assert.equal(openFinished.code, 0, openFinished.stderr);
    const finalized = await runCli(['report-run', 'finalize', '--run-dir', runDir, '--status', 'completed'], env);
    assert.equal(finalized.code, 0, finalized.stderr);
    const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.status, 'completed');
    assert.equal(manifest.laneStatus['report-synthesis'].status, 'accepted');
    assert.equal(manifest.laneStatus['report-synthesis'].lastDurationMs, null);
    assert.equal(manifest.laneStatus['report-synthesis'].totalDurationMs, null);
    assert.equal(manifest.laneStatus['key-session-analysis'].status, 'unavailable');
    assert.equal(manifest.laneStatus['key-session-analysis'].reasonCode, 'HOST_GENERATION_FAILED');
    assert.equal(manifest.laneStatus['key-session-analysis'].lastDurationMs, null);
    assert.equal(manifest.laneStatus['skill-insights'].status, 'unavailable');
    assert.equal(manifest.laneStatus['skill-insights'].reasonCode, 'HOST_GENERATION_FAILED');
    assert.equal(manifest.laneStatus['skill-insights'].lastDurationMs, null);
    assert.equal(manifest.uiDispatch, 'completed');
    assert.ok(manifest.laneArtifacts['report-synthesis/accepted.json']);
    assert.ok(manifest.artifacts.reportJson);
    assert.ok(manifest.artifacts.html);
    assert.equal(manifest.degraded, true);
    const trace = (await readFile(path.join(runDir, 'trace.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    const laneEnds = trace.filter((event) => event.event === 'end' && ['report-synthesis', 'key-session-analysis', 'skill-insights'].includes(event.phase));
    const acceptedEnd = laneEnds.find((event) => event.phase === 'report-synthesis');
    const keyEnd = laneEnds.find((event) => event.phase === 'key-session-analysis');
    const skillEnd = laneEnds.find((event) => event.phase === 'skill-insights');
    assert.equal(acceptedEnd.operation, 'ai-accept');
    assert.equal(acceptedEnd.durationMs, null);
    assert.equal(acceptedEnd.metadata.generationTimingStatus, 'unavailable');
    assert.equal(keyEnd.operation, 'ai-fallback');
    assert.equal(keyEnd.errorCode, 'HOST_GENERATION_FAILED');
    assert.equal(keyEnd.durationMs, null);
    assert.equal(skillEnd.operation, 'ai-fallback');
    assert.equal(skillEnd.errorCode, 'HOST_GENERATION_FAILED');
    assert.equal(skillEnd.durationMs, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
