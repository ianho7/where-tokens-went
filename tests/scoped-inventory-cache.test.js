const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { resolveApiPricing } = require('../dist/src/rates.js');
const { readCodex } = require('../dist/src/codex-reader.js');

test('scoped source inventory ignores unrelated history files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-inventory-test-'));
  try {
    const selected = path.join(root, 'sessions', '2026', '09', '20', 'rollout-selected.jsonl');
    const unrelated = path.join(root, 'sessions', '2025', '01', '01', 'rollout-unrelated.jsonl');
    await mkdir(path.dirname(selected), { recursive: true });
    await mkdir(path.dirname(unrelated), { recursive: true });
    await writeFile(selected, 'selected');
    await writeFile(unrelated, 'unrelated');
    const script = `const { captureSourceInventory } = require(${JSON.stringify(path.resolve(__dirname, '..', 'dist', 'src', 'report-run.js'))}); (async()=>{const a=await captureSourceInventory('codex', [${JSON.stringify(selected)}]); const b=await captureSourceInventory('codex', [${JSON.stringify(selected)}]); console.log(JSON.stringify({a,b}));})().catch((e)=>{console.error(e);process.exit(1);});`;
    const firstRun = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, CODEX_HOME: root }, encoding: 'utf8' });
    assert.equal(firstRun.status, 0, firstRun.stderr);
    const first = JSON.parse(firstRun.stdout).a;
    await writeFile(unrelated, 'unrelated changed');
    const secondRun = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, CODEX_HOME: root }, encoding: 'utf8' });
    assert.equal(secondRun.status, 0, secondRun.stderr);
    const second = JSON.parse(secondRun.stdout).a;
    assert.deepEqual(second, first);
    assert.equal(second.fileCount, 1);
    assert.doesNotMatch(second.signature, /unrelated/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Codex Reader returns only files containing Sessions selected by the frozen scope', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-reader-scope-test-'));
  const project = path.join(root, 'project');
  const selected = path.join(root, 'sessions', '2026', '09', '20', 'rollout-selected.jsonl');
  const unrelated = path.join(root, 'sessions', '2026', '09', '20', 'rollout-unrelated.jsonl');
  const timestamp = '2026-09-20T12:00:00.000Z';
  const previousCodexHome = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = root;
    await mkdir(project, { recursive: true });
    await mkdir(path.dirname(selected), { recursive: true });
    const records = (id, cwd) => [
      { timestamp, type: 'session_meta', payload: { id, cwd } },
      { timestamp, type: 'turn_context', payload: { turn_id: `${id}-turn`, cwd, model: 'fixture', model_provider: 'openai' } },
      { timestamp, type: 'event_msg', payload: { type: 'token_usage_record', response_id: `${id}-response`, turn_id: `${id}-turn`, usage: { input_tokens: 1, output_tokens: 1, reasoning_output_tokens: 0, total_tokens: 2 }, turn_token_usage: { input_tokens: 1, output_tokens: 1, reasoning_output_tokens: 0, total_tokens: 2 }, thread_token_usage: { input_tokens: 1, output_tokens: 1, reasoning_output_tokens: 0, total_tokens: 2 } } },
    ];
    await writeFile(selected, records('selected', project).map(JSON.stringify).join('\n') + '\n');
    await writeFile(unrelated, records('unrelated', path.join(root, 'other-project')).map(JSON.stringify).join('\n') + '\n');
    const result = await readCodex({ since: new Date('2026-09-20T00:00:00.000Z'), until: new Date('2026-09-21T00:00:00.000Z'), cwd: project, allProjects: false });
    assert.deepEqual(result.sourceFiles, [selected]);
  } finally {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previousCodexHome;
    await rm(root, { recursive: true, force: true });
  }
});

test('pricing cache hits avoid network and cold models use at most three concurrent requests', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-rates-test-'));
  const oldCache = process.env.RATES_CACHE_FILE;
  try {
    process.env.RATES_CACHE_FILE = path.join(root, 'rates-cache.json');
    const calls = ['a', 'b', 'c', 'd', 'e'].map((model, index) => ({ sessionId: `s-${index}`, callId: model, timestamp: null, provider: 'openai', model: `fixture-${model}`, inputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 1, reasoningTokens: 0, totalTokens: 2, reportedCost: null, status: 'ok' }));
    let active = 0;
    let maxActive = 0;
    let requests = 0;
    const fetcher = async (url) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      requests += 1;
      await new Promise((resolve) => setTimeout(resolve, 8));
      active -= 1;
      const model = decodeURIComponent(url.split('/').pop().split('?')[0]);
      return { ok: true, status: 200, json: async () => [{ id: model, model, provider: 'openai', input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 }] };
    };
    const first = await resolveApiPricing(calls, 'codex', 'litellm', fetcher);
    assert.equal(first.rates.length, 5);
    assert.ok(maxActive <= 3);
    const requestCount = requests;
    await resolveApiPricing(calls, 'codex', 'litellm', fetcher);
    assert.equal(requests, requestCount);
  } finally {
    process.env.RATES_CACHE_FILE = oldCache;
    await rm(root, { recursive: true, force: true });
  }
});
