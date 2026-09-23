const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { createReportRun, readRunManifest, writeRunArtifact, appendRunWarnings, recordRunSpan } = require('../dist/src/report-run.js');

function runEvent(runDir, phase, spanId, status = 'completed') {
  const code = [
    "const { recordRunSpan } = require('./dist/src/report-run.js');",
    `const runDir = ${JSON.stringify(runDir)};`,
    `const event = ${JSON.stringify({ event: 'start', phase, operation: `fixture-${phase}`, source: 'host-agent', spanId, attempt: 1, startedAt: '2026-09-20T00:00:00.000Z' })};`,
    `const end = ${JSON.stringify({ event: 'end', phase, operation: `fixture-${phase}`, source: 'host-agent', spanId, attempt: 1, startedAt: '2026-09-20T00:00:00.000Z', endedAt: '2026-09-20T00:00:00.001Z', durationMs: 1, status })};`,
    'recordRunSpan(runDir, event).then(() => recordRunSpan(runDir, end)).then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });',
  ].join('');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', code], { cwd: path.resolve(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (exitCode) => resolve({ exitCode, stderr }));
  });
}

function runWarning(runDir, warning) {
  const code = [
    "const { appendRunWarnings } = require('./dist/src/report-run.js');",
    `appendRunWarnings(${JSON.stringify(runDir)}, [${JSON.stringify(warning)}]).then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });`,
  ].join('');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', code], { cwd: path.resolve(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (exitCode) => resolve({ exitCode, stderr }));
  });
}

test('repeated cross-process Run mutations preserve stages, trace lines, and artifacts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-concurrency-test-'));
  try {
    const run = await createReportRun({
      harness: 'codex', cwd: null, allProjects: true,
      since: new Date('2026-09-19T00:00:00.000Z'), until: new Date('2026-09-20T00:00:00.000Z'), locale: 'en-US',
    }, root);
    const phases = ['report-synthesis', 'key-session-analysis', 'skill-insights', 'content-read', 'validation'];
    for (let round = 0; round < 3; round += 1) {
      const results = await Promise.all(phases.map((phase) => runEvent(run.runDir, phase, `${phase}-${round}`)));
      assert.ok(results.every((result) => result.exitCode === 0), results.map((result) => result.stderr).join('\n'));
    }
    await Promise.all([
      writeRunArtifact(run, 'audit', { fixture: 'audit' }),
      writeRunArtifact(run, 'evidence', { fixture: 'evidence' }),
      writeRunArtifact(run, 'skillSnapshot', { fixture: 'snapshot' }),
      writeRunArtifact(run, 'skillInsights', { fixture: 'skill-insights' }),
    ]);
    const manifest = await readRunManifest(run.runDir);
    for (const phase of phases) {
      assert.equal(manifest.stageStatus[phase].status, 'completed');
      assert.equal(manifest.stageStatus[phase].attempt, 1);
    }
    assert.deepEqual(Object.keys(manifest.artifacts).sort(), ['audit', 'evidence', 'skillInsights', 'skillSnapshot'].sort());
    await assert.rejects(() => writeRunArtifact(run, 'audit', { fixture: 'changed' }), (error) => error && error.code === 'RUN_ARTIFACT_IMMUTABLE');
    const trace = (await readFile(path.join(run.runDir, 'trace.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(trace.length, 1 + phases.length * 3 * 2);
    assert.ok(trace.every((line) => line.endsWith('}') && !line.includes('\n')));
    assert.equal(await readFile(path.join(run.runDir, '.run.lock'), 'utf8').catch(() => null), null);
    await writeFile(path.join(run.runDir, '.run.lock'), JSON.stringify({ pid: 1, token: 'fixture', acquiredAt: new Date().toISOString() }) + '\n');
    await assert.rejects(() => writeRunArtifact(run, 'trace', { fixture: 'lock-timeout' }), (error) => error && error.code === 'RUN_LOCK_TIMEOUT');
    assert.match(await readFile(path.join(run.runDir, '.run.lock'), 'utf8'), /fixture/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('overlapping spans in one phase do not make the trace incomplete', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-overlap-test-'));
  try {
    const run = await createReportRun({
      harness: 'codex', cwd: null, allProjects: true,
      since: new Date('2026-09-19T00:00:00.000Z'), until: new Date('2026-09-20T00:00:00.000Z'), locale: 'en-US',
    }, root);
    const start = (spanId, attempt) => ({ event: 'start', phase: 'price-request', operation: 'fixture-price', source: 'network', spanId, attempt, startedAt: '2026-09-20T00:00:00.000Z' });
    const end = (spanId, attempt) => ({ event: 'end', phase: 'price-request', operation: 'fixture-price', source: 'network', spanId, attempt, startedAt: '2026-09-20T00:00:00.000Z', endedAt: '2026-09-20T00:00:00.001Z', durationMs: 1, status: 'completed' });
    await recordRunSpan(run.runDir, start('price-a', 1));
    await recordRunSpan(run.runDir, start('price-b', 2));
    await recordRunSpan(run.runDir, end('price-a', 1));
    await recordRunSpan(run.runDir, end('price-b', 2));
    const manifest = await readRunManifest(run.runDir);
    assert.equal(manifest.traceCompleteness, 'complete');
    assert.deepEqual(manifest.warnings, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('compose-time warning mutations are transactional under concurrent writers', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-warning-concurrency-test-'));
  try {
    const run = await createReportRun({
      harness: 'codex', cwd: null, allProjects: true,
      since: new Date('2026-09-19T00:00:00.000Z'), until: new Date('2026-09-20T00:00:00.000Z'), locale: 'en-US',
    }, root);
    const warnings = Array.from({ length: 12 }, (_, index) => `compose-warning-${index}`);
    const results = await Promise.all(warnings.map((warning) => runWarning(run.runDir, warning)));
    assert.ok(results.every((result) => result.exitCode === 0), results.map((result) => result.stderr).join('\n'));
    const manifest = await readRunManifest(run.runDir);
    assert.deepEqual(new Set(manifest.warnings), new Set(warnings));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
