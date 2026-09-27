const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  createReportRun,
  finalizeReportRun,
  recordCompletedRunSpan,
  setRunEligibleStages,
  readRunManifest,
} = require('../dist/src/report-run.js');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('P0-B refuses completed finalization without an intact HTML artifact and observed UI dispatch', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-p0-finalize-'));
  try {
    const run = await createReportRun({
      harness: 'codex',
      cwd: null,
      allProjects: true,
      since: new Date('2026-09-19T00:00:00.000Z'),
      until: new Date('2026-09-20T00:00:00.000Z'),
      locale: 'en-US',
    }, root);
    await setRunEligibleStages(run, ['compose']);
    await recordCompletedRunSpan(run, { phase: 'compose', operation: 'fixture-compose', source: 'runner', status: 'completed' });
    await finalizeReportRun(run, 'completed');
    const manifest = await readRunManifest(root);
    assert.notEqual(manifest.status, 'completed');
    assert.notEqual(manifest.deliveryStatus, 'completed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
