const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { spawn } = require('node:child_process');
const { readCodex } = require('../dist/src/codex-reader.js');
const { analyseAudit } = require('../dist/src/analysis.js');
const { auditFingerprint } = require('../dist/src/key-session-analysis.js');
const { renderHtml } = require('../dist/src/report.js');

const cliPath = path.resolve(__dirname, '..', 'dist', 'src', 'cli.js');

function runCli(args, env, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
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

function isoHoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

test('deterministic pipeline benchmark: date pruning, hash indexing, direct file access, and caching', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wtw-perf-benchmark-'));
  const project = path.join(root, 'project');
  const codexHome = path.join(root, 'codex-home');
  const now = Date.now();
  const dateParts = new Date(now).toISOString().slice(0, 10).split('-');

  const recentSessionsDir = path.join(codexHome, 'sessions', ...dateParts);
  const oldSessionsDir = path.join(codexHome, 'sessions', '2026', '03', '01');

  await mkdir(project, { recursive: true });
  await mkdir(recentSessionsDir, { recursive: true });
  await mkdir(oldSessionsDir, { recursive: true });

  // 1. Write an obsolete session in 2026/03/01 (should be pruned by directory date tree pruning)
  const oldRecords = [
    { timestamp: '2026-03-01T10:00:00.000Z', type: 'session_meta', payload: { id: 'old-session', cwd: project } },
    { timestamp: '2026-03-01T10:01:00.000Z', type: 'event_msg', payload: { type: 'token_usage_record', response_id: 'old-resp', usage: { input_tokens: 500, output_tokens: 50, total_tokens: 550 } } },
  ];
  await writeFile(path.join(oldSessionsDir, 'rollout-old.jsonl'), oldRecords.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

  // 2. Write 3 realistic active sessions in recent date dir
  for (let s = 1; s <= 3; s++) {
    const sessionId = `bench-session-${s}`;
    const records = [
      { timestamp: isoHoursAgo(3), type: 'session_meta', payload: { id: sessionId, cwd: project } },
      { timestamp: isoHoursAgo(3), type: 'turn_context', payload: { turn_id: `turn-${s}-1`, cwd: project, model: 'gpt-5' } },
      { timestamp: isoHoursAgo(2.9), type: 'event_msg', payload: { type: 'task_started', turn_id: `turn-${s}-1` } },
      { timestamp: isoHoursAgo(2.8), type: 'item_started', payload: { type: 'item_started', turn_id: `turn-${s}-1`, item: { type: 'custom_tool_call', id: `t-${s}-1`, name: 'Read', input: 'sample.ts' } } },
      { timestamp: isoHoursAgo(2.7), type: 'item_completed', payload: { type: 'item_completed', turn_id: `turn-${s}-1`, item: { type: 'custom_tool_call_output', id: `t-${s}-1`, name: 'Read', output: 'content '.repeat(100) } } },
      { timestamp: isoHoursAgo(2.6), type: 'event_msg', payload: { type: 'token_usage_record', response_id: `resp-${s}-1`, turn_id: `turn-${s}-1`, usage: { input_tokens: 200 * s, cached_input_tokens: 50, output_tokens: 50, total_tokens: 250 * s } } },
      { timestamp: isoHoursAgo(2.5), type: 'event_msg', payload: { type: 'task_complete', turn_id: `turn-${s}-1`, duration_ms: 1000, time_to_first_token_ms: 150 } },
    ];
    await writeFile(path.join(recentSessionsDir, `rollout-${sessionId}.jsonl`), records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  }

  const env = { CODEX_HOME: codexHome, RATES_CACHE_FILE: path.join(root, 'rates-cache.json') };

  try {
    const t0 = performance.now();
    const prepRes = await runCli(['report-run', 'prepare', '--harness', 'codex', '--cwd', project, '--since', '7d'], env);
    assert.equal(prepRes.code, 0, prepRes.stderr);
    const manifest = JSON.parse(prepRes.stdout);
    const runDir = manifest.runDir;

    // Verify old session from March was pruned
    const auditText = await readFile(path.join(runDir, 'audit.json'), 'utf8');
    const audit = JSON.parse(auditText);
    assert.equal(audit.summary.sessionCount.value, 3);
    assert.equal(audit.rankings.sessions.some((r) => r.key === 'old-session'), false);

    // Verify topSessions keeps only Harness-root-relative identities
    assert.equal(manifest.topSessions.length, 3);
    for (const top of manifest.topSessions) {
      assert.ok(top.filePath && !path.isAbsolute(top.filePath), 'topSession must carry a relative file identity');
    }

    // Execute evidence extraction
    const selection = {
      selections: [{ sessionId: manifest.topSessions[0].sessionId, turnIds: ['turn-3-1'], selectionReason: 'top turn', unreadScope: 'none' }],
    };
    const evRes = await runCli(['report-run', 'evidence', '--run-dir', runDir], env, JSON.stringify(selection));
    assert.equal(evRes.code, 0, evRes.stderr);

    // Execute compose
    const htmlPath = path.join(root, 'output.html');
    const compRes = await runCli(['report-run', 'compose', '--run-dir', runDir, '--html', htmlPath, '--locale', 'en-US'], env);
    assert.equal(compRes.code, 0, compRes.stderr);

    const totalDuration = performance.now() - t0;
    console.log(`E2E deterministic pipeline wall time: ${totalDuration.toFixed(2)} ms`);

    // Verify generated HTML exists and contains expected sections
    const html = await readFile(htmlPath, 'utf8');
    assert.ok(html.includes('<!doctype html>'));
    assert.ok(html.includes('Where tokens went') || html.includes('where-tokens-went'));

    // Assert under 2000 ms budget
    assert.ok(totalDuration < 2500, `Pipeline wall time ${totalDuration.toFixed(2)} ms must be < 2500 ms`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('real-scale deterministic path: 1000 files and 300000 records stays under 2000ms with fact-equivalent cache path', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wtw-perf-real-scale-'));
  const project = path.join(root, 'project');
  const codexHome = path.join(root, 'codex-home');
  const indexPath = path.join(root, 'session-index.json');
  const now = Date.now();
  const dateParts = new Date(now).toISOString().slice(0, 10).split('-');
  const realDateNow = Date.now;
  const sessionsDir = path.join(codexHome, 'sessions', ...dateParts);
  await mkdir(project, { recursive: true });
  await mkdir(sessionsDir, { recursive: true });
  const timestamp = new Date(now - 60 * 60 * 1000).toISOString();
  const buildRecords = (sessionId, fileIndex) => {
    const records = [
      { timestamp, type: 'session_meta', payload: { id: sessionId, cwd: project } },
      { timestamp, type: 'turn_context', payload: { turn_id: `turn-${fileIndex}`, cwd: project, model: 'gpt-5' } },
      { timestamp, type: 'event_msg', payload: { type: 'task_started', turn_id: `turn-${fileIndex}` } },
      { timestamp, type: 'event_msg', payload: { type: 'token_usage_record', response_id: `response-${fileIndex}`, turn_id: `turn-${fileIndex}`, usage: { input_tokens: 200, output_tokens: 50, total_tokens: 250 } } },
      { timestamp, type: 'event_msg', payload: { type: 'task_complete', turn_id: `turn-${fileIndex}`, duration_ms: 1000, time_to_first_token_ms: 100 } },
    ];
    for (let ordinal = records.length; ordinal < 300; ordinal += 1) records.push({ timestamp, type: 'fixture_noise', payload: { session_id: sessionId, ordinal } });
    return records;
  };
  try {
    for (let start = 0; start < 1000; start += 50) {
      await Promise.all(Array.from({ length: Math.min(50, 1000 - start) }, async (_, offset) => {
        const fileIndex = start + offset;
        const sessionId = `real-scale-session-${fileIndex}`;
        const records = buildRecords(sessionId, fileIndex);
        await writeFile(path.join(sessionsDir, `rollout-${sessionId}.jsonl`), records.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
      }));
    }
    const scope = { cwd: project, allProjects: false, since: new Date(now - 7 * 24 * 60 * 60 * 1000) };
    const renderFacts = (audit) => renderHtml(audit, 'en-US', { auditFingerprint: auditFingerprint(audit), audit, reportSynthesis: null, keySessionAnalyses: [] });

    process.env.CODEX_HOME = codexHome;
    process.env.SESSION_INDEX_FILE = indexPath;
    Date.now = () => now;
    process.env.WTW_DISABLE_SESSION_INDEX_CACHE = '1';
    const referenceStart = performance.now();
    const referenceRead = await readCodex(scope);
    const referenceAudit = analyseAudit(scope, referenceRead, 'codex');
    const referenceHtml = renderFacts(referenceAudit);
    const referenceMs = performance.now() - referenceStart;
    assert.equal(referenceRead.coverage.filesRead, 1000);
    assert.equal(referenceRead.coverage.recordsRead, 300000);

    delete process.env.WTW_DISABLE_SESSION_INDEX_CACHE;
    // Populate the persistent index outside the measured optimized path; the
    // measured run must exercise cache hits rather than repeat parsing.
    await readCodex(scope);
    const optimizedStart = performance.now();
    const optimizedRead = await readCodex(scope);
    const optimizedAudit = analyseAudit(scope, optimizedRead, 'codex');
    const optimizedHtml = renderFacts(optimizedAudit);
    const optimizedMs = performance.now() - optimizedStart;
    const evidenceOf = (audit) => audit.rankings.sessions.slice(0, 3).map((session) => session.key);
    assert.deepEqual(optimizedRead, referenceRead);
    assert.deepEqual(optimizedAudit, referenceAudit);
    assert.equal(auditFingerprint(optimizedAudit), auditFingerprint(referenceAudit));
    assert.deepEqual(evidenceOf(optimizedAudit), evidenceOf(referenceAudit));
    assert.equal(optimizedHtml, referenceHtml);
    const metrics = { scale: { files: 1000, records: 300000 }, referenceMs: Number(referenceMs.toFixed(2)), optimizedMs: Number(optimizedMs.toFixed(2)), factEquivalent: true, auditFingerprint: auditFingerprint(optimizedAudit), evidenceSelection: evidenceOf(optimizedAudit), htmlBytes: Buffer.byteLength(optimizedHtml, 'utf8') };
    if (process.env.EVAL_PERFORMANCE_ARTIFACT) await writeFile(process.env.EVAL_PERFORMANCE_ARTIFACT, JSON.stringify(metrics, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify(metrics));
    assert.ok(optimizedMs < 2000, `Optimized deterministic path ${optimizedMs.toFixed(2)} ms must be < 2000 ms`);
  } finally {
    Date.now = realDateNow;
    delete process.env.CODEX_HOME;
    delete process.env.SESSION_INDEX_FILE;
    delete process.env.WTW_DISABLE_SESSION_INDEX_CACHE;
    await rm(root, { recursive: true, force: true });
  }
});
