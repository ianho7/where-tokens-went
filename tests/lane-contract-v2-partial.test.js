'use strict';

// Ticket 0038 owner test: v2 partial acceptance and privacy boundary against a real Run.
//
// Expectations come from the fixture the Run itself froze (independent canonical
// audit.json / skill-snapshot.json) and from hand-written model output.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const cliPath = path.resolve(__dirname, '..', 'dist', 'src', 'cli.js');
const { readProjection } = require('./fixtures/lane-contract-v2-fixtures');

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

test('v2 partial acceptance keeps legal items, records every rejection, and never backfills private history', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-v2-partial-'));
  const project = path.join(root, 'project');
  const codexHome = path.join(root, 'codex-home');
  const now = new Date();
  const sessionsDir = path.join(
    codexHome, 'sessions',
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  );
  const runDir = path.join(root, 'run');
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  await mkdir(project, { recursive: true });
  await mkdir(sessionsDir, { recursive: true });

  // Fixture prompt contains a distinctive 80-character sentence used by the privacy check.
  const sensitiveSentence = 'PRIVATE_HISTORY_SENTENCE_SHOULD_NEVER_SURFACE=the-user-typed-this-secret-value-into-the-transcript;';
  const base = Date.now() - 60 * 60 * 1000;
  await writeFile(path.join(sessionsDir, 'rollout-v2-partial.jsonl'), [
    { timestamp: new Date(base).toISOString(), type: 'session_meta', payload: { id: 'v2-partial-session', cwd: project, originator: 'Codex CLI', cli_version: '0.1.0', model_provider: 'openai' } },
    { timestamp: new Date(base).toISOString(), type: 'turn_context', payload: { turn_id: 'v2-partial-turn', cwd: project } },
    { timestamp: new Date(base).toISOString(), type: 'event_msg', payload: { type: 'token_usage_record', response_id: 'v2-partial-response', turn_id: 'v2-partial-turn', usage: { input_tokens: 95, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 100 }, turn_token_usage: { input_tokens: 95, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 100 } } },
    { timestamp: new Date(base).toISOString(), type: 'response_item', payload: { type: 'message', role: 'user', turn_id: 'v2-partial-turn', content: 'Fixture task for the v2 partial acceptance check.' } },
    { timestamp: new Date(base).toISOString(), type: 'response_item', payload: { type: 'message', role: 'assistant', turn_id: 'v2-partial-turn', content: sensitiveSentence } },
  ].map((record) => JSON.stringify(record)).join('\n') + '\n');

  const env = { CODEX_HOME: codexHome, TEMP: root, TMP: root };
  const started = await runCli([
    'report-run', 'run-all', 'start',
    '--harness', 'codex',
    '--cwd', project,
    '--since', '10000d',
    '--locale', 'en-US',
    '--run-dir', runDir,
  ], env);
  assert.equal(started.code, 0, started.stderr);
  const start = JSON.parse(started.stdout);
  assert.notEqual(start.reason, 'NO_HISTORY_IN_SCOPE');

  const projection = await readProjection(runDir, 'report-synthesis');
  const printable = projection.directory.evidence.filter((entry) => entry.displayPolicy === 'allowed' && entry.citable);
  const synthesis = {
    overview: { summary: `Bounded fixture activity around [[${printable[0].handle}]].`, evidenceRefs: [printable[0].handle] },
    findings: [
      {
        title: 'Legal first Finding',
        analysis: 'The legal Finding cites an entry that exists in this Run.',
        evidenceRefs: [printable[0].handle],
        support: 'moderate',
        uncertainty: null,
      },
      {
        title: 'Rejected second Finding',
        analysis: 'This Finding cites an unknown handle and must be dropped without rejecting the first.',
        evidenceRefs: ['e424242'],
        support: 'strong',
        uncertainty: null,
      },
    ],
    noStrongFindingReason: null,
  };
  const accepted = await runCli([
    'report-run', 'ai-accept',
    '--run-dir', runDir,
    '--lane', 'report-synthesis',
    '--attempt', String(start.tickets['report-synthesis'].attempt),
    '--span-id', start.tickets['report-synthesis'].spanId,
  ], env, JSON.stringify(synthesis));
  assert.equal(accepted.code, 0, accepted.stderr);
  const result = JSON.parse(accepted.stdout);
  assert.equal(result.validationStatus, 'accepted');
  assert.ok(result.errors.some((error) => error.code === 'EVIDENCE_REF_UNKNOWN'), 'the dropped Finding reason must be recorded');

  const acceptedEnvelope = JSON.parse(await readFile(path.join(runDir, 'lanes', 'report-synthesis', 'accepted.json'), 'utf8'));
  assert.equal(acceptedEnvelope.value.findings.length, 1, 'a legal Finding survives an invalid sibling');
  assert.equal(acceptedEnvelope.value.findings[0].title, 'Legal first Finding');
  assert.equal(acceptedEnvelope.value.findings[0].evidenceRefs.length, 1);

  const validation = JSON.parse(await readFile(path.join(runDir, 'lanes', 'report-synthesis', 'attempt-1.validation.json'), 'utf8'));
  assert.equal(validation.outputContractVersion, 2);
  assert.equal(typeof validation.projectionHash, 'string');
  assert.equal(typeof validation.inputArtifactSha256, 'string', 'the validation record must bind the input artifact it read');

  // Raw bytes are preserved verbatim; accepted output must not contain the raw
  // slot syntax or any code-owned field the model never supplied.
  const rawText = await readFile(path.join(runDir, 'lanes', 'report-synthesis', 'attempt-1.raw.json'), 'utf8');
  assert.equal(rawText.trim(), JSON.stringify(synthesis));
  assert.equal(rawText.includes('auditFingerprint'), false);
  assert.equal(JSON.stringify(acceptedEnvelope.value).includes('[['), false, 'no unbound slot may remain in accepted output');
  assert.equal(JSON.stringify(acceptedEnvelope.value).includes('e424242'), false, 'a rejected handle must not leak into accepted output');

  // Privacy: the private history sentence must not appear in any accepted or validation artifact.
  for (const file of ['accepted.json', 'attempt-1.validation.json']) {
    const contents = await readFile(path.join(runDir, 'lanes', 'report-synthesis', file), 'utf8');
    assert.equal(contents.includes(sensitiveSentence), false, `${file} must not contain the private history sentence`);
  }
  const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
  assert.equal(JSON.stringify(manifest).includes(sensitiveSentence), false, 'the manifest must not contain the private history sentence');
  assert.equal(manifest.outputContractVersion, 2);
});
