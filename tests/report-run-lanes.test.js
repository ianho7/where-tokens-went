const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const cliPath = path.resolve(__dirname, '..', 'dist', 'src', 'cli.js');

test('installed Skill documents one Evidence acquisition path and no duplicate stdin pass', async () => {
  const skill = await readFile(path.resolve(__dirname, '..', 'skills', 'where-tokens-went', 'SKILL.md'), 'utf8');
  assert.equal((skill.match(/report-run evidence --run-dir <run-directory> --auto/g) ?? []).length, 1);
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
  try {
    await mkdir(project, { recursive: true });
    await mkdir(sessions, { recursive: true });
    const timestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await writeFile(path.join(sessions, 'rollout-lane.jsonl'), [
      { timestamp, type: 'session_meta', payload: { id: 'lane-session', cwd: project } },
      { timestamp, type: 'turn_context', payload: { turn_id: 'lane-turn', cwd: project } },
      { timestamp, type: 'event_msg', payload: { type: 'token_usage_record', response_id: 'lane-response', turn_id: 'lane-turn', usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 }, turn_token_usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 } } },
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
    const composed = await runCli(['report-run', 'compose', '--run-dir', runDir, '--locale', 'en-US', '--html', htmlPath], env);
    assert.equal(composed.code, 0, composed.stderr);
    assert.match(await readFile(htmlPath, 'utf8'), /The fixture records a bounded activity period/);
    const forgedEnvelope = await runCli(['report-run', 'compose', '--run-dir', runDir, '--locale', 'en-US', '--html', htmlPath], env, JSON.stringify({ reportSynthesis: {} }));
    assert.equal(forgedEnvelope.code, 2);
    assert.match(forgedEnvelope.stderr, /REPORT_COMPOSE_STDIN_FORBIDDEN/);
    const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.laneStatus['report-synthesis'].status, 'accepted');
    assert.ok(manifest.laneArtifacts['report-synthesis/accepted.json']);
    assert.equal(manifest.degraded, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
