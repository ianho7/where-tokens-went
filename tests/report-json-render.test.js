const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { makeResult } = require('./fixtures/kami-report-fixture.js');

test('render-report uses only report.json input and renders it repeatably', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-render-report-'));
  try {
    const audit = makeResult();
    const evidence = (value, provenance = 'reported') => ({ value, provenance, method: 'ticket fixture' });
    audit.turns = [{
      sessionId: 'large',
      turnId: 'turn-1',
      ordinal: evidence(1),
      tokens: {
        inputTokens: evidence(990), cachedInputTokens: evidence(0), cacheWriteTokens: evidence(0),
        outputTokens: evidence(10), unclassifiedTokens: evidence(0), reasoningTokens: evidence(0), totalTokens: evidence(1000),
      },
      sessionSharePercent: evidence(100, 'derived'),
      modelCallCount: evidence(2, 'derived'),
      startedAt: evidence('2026-09-08T08:00:00.000Z'),
      endedAt: evidence('2026-09-08T08:00:01.000Z'),
      durationMs: evidence(1000),
      timeToFirstTokenMs: evidence(100),
      observedSpanMs: evidence(1000),
      toolCallCount: evidence(0, 'derived'),
      pairedToolResultCount: evidence(0, 'derived'),
      toolResultChars: evidence(0, 'derived'),
      toolResultBytes: evidence(0, 'derived'),
      errorCount: evidence(0, 'derived'),
      lifecycleMarkers: [],
      evidenceId: 'turn:large:turn-1',
      method: 'ticket fixture',
      coverage: evidence(100, 'derived'),
    }];
    const report = {
      version: 1,
      audit,
      ai: {
        reportSynthesis: {
          result: {
            auditFingerprint: 'accepted-output-fingerprint',
            overview: { summary: 'accepted overview marker', evidenceRefs: [] },
            findings: [{ title: 'accepted Finding marker', analysis: 'accepted analysis marker', evidenceRefs: [], support: 'moderate', uncertainty: null }],
            noStrongFindingReason: null,
          },
          fallbackReason: null,
        },
        keySessionAnalyses: { result: [], fallbackReason: 'not-generated' },
        skillInsights: { result: [], fallbackReason: 'not-generated' },
      },
      render: {
        locale: 'en-US',
        projectName: 'ticket-03-project',
        font: { source: 'bundled' },
        firstUserMessages: [{ sessionId: 'large', turnId: 'turn-1', content: 'local prompt marker <ticket03>', unavailableReason: null }],
      },
    };
    const jsonPath = path.join(root, 'report.json');
    const blockedCodexHome = path.join(root, 'codex-home-is-a-file');
    const firstHtmlPath = path.join(root, 'first.html');
    const secondHtmlPath = path.join(root, 'second.html');
    await writeFile(jsonPath, JSON.stringify(report), 'utf8');
    await writeFile(blockedCodexHome, 'Rendering must not inspect Codex history.', 'utf8');

    const run = (htmlPath) => spawnSync(process.execPath, [
      path.join(__dirname, '..', 'dist', 'src', 'cli.js'),
      'render-report', '--json', jsonPath, '--html', htmlPath,
    ], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, CODEX_HOME: blockedCodexHome, FONT_CACHE_DIR: path.join(root, 'font-cache') },
    });
    const first = run(firstHtmlPath);
    assert.equal(first.status, 0, first.stderr);
    const second = run(secondHtmlPath);
    assert.equal(second.status, 0, second.stderr);

    const firstHtml = await readFile(firstHtmlPath, 'utf8');
    const secondHtml = await readFile(secondHtmlPath, 'utf8');
    assert.equal(firstHtml, secondHtml);
    assert.match(firstHtml, /class="primary-answer"/);
    assert.match(firstHtml, /No specific mechanism is supported by the available task and round evidence\./);
    assert.match(firstHtml, /accepted overview marker/);
    assert.match(firstHtml, /accepted Finding marker/);
    assert.match(firstHtml, /local prompt marker \\u003cticket03\\u003e/);
    assert.match(firstHtml, /1,000/);
    assert.match(firstHtml, /ticket-03-project/);
    assert.equal(JSON.stringify(JSON.parse(await readFile(jsonPath, 'utf8'))), JSON.stringify(report));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
