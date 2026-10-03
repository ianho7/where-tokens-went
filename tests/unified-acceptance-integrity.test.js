'use strict';

/**
 * Ticket 0039 owner tests: unified acceptance, composition consistency,
 * truthful degradation reasons, and non-collateral integrity failure.
 *
 * Covers:
 * - AC-1: Unified acceptance pipeline across normal, repair, and explicit v1 adaptation;
 *         idempotent processing; valid=true retains non-empty diagnostics/errors.
 * - AC-2: Batch rules and visibility: duplicate analyses don't annihilate entire groups
 *         in composition; invalid overview falls back deterministically while preserving
 *         valid findings; duplicate reasons recorded at accept time; HTML displays accepted content;
 *         invalid first item does NOT block a subsequent valid same-session item.
 * - AC-3: Dependency and accounting boundaries: invalid recommendation retains legal mechanism;
 *         invalid finding retains legal taskContext as a null-finding with explicit limitations
 *         and original failure reasons; unreconciled Codex token accounting rejects strong causality
 *         without auto-clamp; unrelated reconciled tasks stay unaffected.
 * - AC-4: Truthful artifact integrity failure: tampering with registered accepted file records
 *         locatable artifact-integrity-failed warning and fallbackReason, preserves original accept
 *         record, and does NOT collateralize uncorrupted sibling lanes.
 */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const cliPath = path.resolve(__dirname, '..', 'dist', 'src', 'cli.js');
const { readProjection, readCanonicalAudit } = require('./fixtures/lane-contract-v2-fixtures');
const { parseKeySessionAnalysesV2, acceptKeySessionAnalyses, buildKeySessionDirectory } = require('../dist/src/lane-contract.js');
const { validateKeySessionAnalysis, validateReportSynthesis, auditFingerprint, reportComposition } = require('../dist/src/key-session-analysis.js');
const { analyseAudit } = require('../dist/src/analysis.js');
const { renderHtml } = require('../dist/src/report.js');

// In-memory owner fixture: no Report Run, history scan, pricing or model call.
function metricEvidenceFixture() {
  const timestamp = '2026-10-03T00:00:00.000Z';
  const sessions = ['documents', 'retry-worker'].map((sessionId) => ({
    harness: 'codex', sessionId, title: sessionId, projectCwd: 'D:/fixture',
    startedAt: timestamp, endedAt: timestamp, parentSessionId: null, sourceVersion: 'fixture',
  }));
  const turns = sessions.flatMap(({ sessionId }) => [1, 2].map((ordinal) => ({
    sessionId, turnId: `${sessionId}-${ordinal}`, ordinal, startedAt: timestamp,
    endedAt: timestamp, durationMs: 1000, timeToFirstTokenMs: 200, status: 'ok', timingProvenance: 'reported',
  })));
  const audit = analyseAudit({ cwd: 'D:/fixture', allProjects: false, since: new Date('2026-10-02T00:00:00Z') }, {
    sessions, turns,
    modelCalls: turns.map(({ sessionId, turnId }) => ({
      sessionId, turnId, callId: `${turnId}-call`, timestamp, provider: 'openai', model: 'fixture',
      inputTokens: 90, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 10,
      reasoningTokens: 0, totalTokens: 100, reportedCost: null, status: 'ok', activeBranch: true,
    })),
    toolCalls: turns.map(({ sessionId, turnId }) => ({
      sessionId, turnId, callId: `${turnId}-tool`, timestamp, toolName: 'read_file',
      inputBytes: 20, resultBytes: 4096, isError: false,
    })),
    lifecycle: [], skillEvidence: [],
    tokenAccounting: { responseTotal: 400, turnTotal: 400, threadTotal: 400,
      reconciledSessionIds: sessions.map((s) => s.sessionId), mismatchedSessionIds: [], status: 'reconciled', method: 'fixture' },
    coverage: { filesRead: 0, recordsRead: 0, recordsSkipped: 0, partialSessions: 0, warnings: [] },
  }, 'codex');
  const { directory } = buildKeySessionDirectory({ audit, sessions: audit.rankings.sessions, turns: audit.turns, locale: 'en-US' });
  const packets = sessions.map(({ sessionId }) => ({
    sessionId, scope: audit.scope, turnIds: [`${sessionId}-1`], selectionReason: 'first turn', unreadScope: 'second turn unread',
    items: [{ turnId: `${sessionId}-1`, content: 'Bounded synthetic task context.' }], warnings: [],
  }));
  const handle = (sessionId, ordinal, metric) => {
    const turn = audit.turns.find((t) => t.turnId === `${sessionId}-${ordinal}`);
    return directory.evidence.find((e) => e.canonicalRef === `${turn.evidenceId}${metric === 'totalTokens' ? '' : ':' + metric}`).handle;
  };
  const item = (sessionId = 'documents') => ({
    sessionHandle: directory.sessions.find((s) => s.canonicalId === sessionId).handle,
    taskContext: sessionId === 'documents' ? 'Reconciling interface documents.' : 'Debugging a failing background worker.',
    primaryFinding: {
      observation: sessionId === 'documents' ? 'Document results remain in subsequent context.' : 'Worker retries repeat the failing operation.',
      interpretation: sessionId === 'documents' ? 'Repeated document exposure may explain continued input growth.' : 'Retrying without changing the worker repeats the same work.',
      evidenceIds: [handle(sessionId, 1, 'totalTokens')], support: 'moderate', alternativeExplanations: ['Necessary task complexity remains plausible.'],
    },
    recommendation: {
      action: sessionId === 'documents' ? 'Bound the document excerpts.' : 'Isolate the worker failure.',
      rationale: 'Test the observed behavior before switching models.', applicability: 'Equivalent tasks.', tradeoff: null,
      verification: 'Compare repeated exposure; the user checks completion quality.', targetEvidenceIds: [handle(sessionId, 1, 'toolResultBytes')],
    }, limitations: ['A candidate explanation, not established causality.'],
  });
  const accept = (raw, contractVersion = 2) => acceptKeySessionAnalyses({ audit, directory, packets, locale: 'en-US', raw, contractVersion });
  return { audit, directory, packets, handle, item, accept };
}

test('0042 AC-1: official Turn metrics survive acceptance; unknown, cross-Session and unread evidence remain rejected', () => {
  const f = metricEvidenceFixture();
  for (const metric of ['totalTokens', 'sessionSharePercent', 'modelCallCount', 'toolResultBytes', 'durationMs', 'errorCount']) {
    const input = f.item();
    input.primaryFinding.evidenceIds = [f.handle('documents', 1, metric)];
    input.recommendation.targetEvidenceIds = [f.handle('documents', 1, metric)];
    const rawBefore = JSON.stringify(input);
    const result = f.accept([input]);
    assert.equal(result.validationAccepted, true);
    assert.deepEqual(result.errors, [], metric);
    assert.equal(result.accepted[0].primaryFinding.support, 'moderate');
    assert.notEqual(result.accepted[0].recommendation, null, metric);
    const base = f.audit.turns.find((t) => t.turnId === 'documents-1').evidenceId;
    assert.deepEqual(result.accepted[0].primaryFinding.evidenceIds, [base + (metric === 'totalTokens' ? '' : ':' + metric)]);
    assert.equal(JSON.stringify(input), rawBefore, 'raw input is immutable');
    assert.deepEqual(f.accept([input]), result, 'acceptance is idempotent');
    assert.equal(validateKeySessionAnalysis(f.audit, result.accepted[0], f.packets).valid, true);
    assert.deepEqual(f.accept(result.accepted, 1).accepted, result.accepted, 'explicit v1 preserves canonical metrics');
  }
  for (const [target, error] of [
    ['e999999', 'EVIDENCE_REF_UNKNOWN'],
    [f.handle('retry-worker', 1, 'toolResultBytes'), 'EVIDENCE_REF_CROSS_OBJECT'],
    [f.handle('documents', 2, 'toolResultBytes'), 'was not read'],
  ]) {
    const input = f.item();
    input.recommendation.targetEvidenceIds = [target];
    const result = f.accept([input]);
    assert.notEqual(result.accepted[0].primaryFinding, null, error);
    assert.equal(result.accepted[0].recommendation, null, error);
    assert.ok(result.errors.some((e) => e.code === error || e.message.includes(error)), JSON.stringify(result.errors));
    if (error === 'was not read') assert.ok(!result.errors.some((e) => e.message.includes('unknown or cross-Session')), 'unread is not unknown');
  }
  const canonical = f.accept([f.item()]).accepted[0];
  canonical.recommendation.targetEvidenceIds = [f.audit.turns[0].evidenceId + ':unknownMetric'];
  const unknown = f.accept([canonical], 1);
  assert.equal(unknown.accepted[0].recommendation, null);
  assert.ok(unknown.errors.some((e) => e.message.includes('unknown or cross-Session')));
});

test('0042 AC-2 & AC-3: domain recommendation failure preserves mechanism and sibling; composition/HTML preserve accepted visibility', () => {
  const f = metricEvidenceFixture();
  const legal = f.item();
  const invalidRec = f.item('retry-worker');
  invalidRec.recommendation.targetEvidenceIds = [f.handle('retry-worker', 2, 'totalTokens')];
  const result = f.accept([legal, invalidRec]);
  assert.equal(result.accepted.length, 2);
  assert.deepEqual(result.accepted[0].primaryFinding.observation, legal.primaryFinding.observation);
  assert.notEqual(result.accepted[0].recommendation, null);
  assert.deepEqual(result.accepted[1].primaryFinding.observation, invalidRec.primaryFinding.observation);
  assert.equal(result.accepted[1].recommendation, null);
  assert.ok(result.accepted[1].limitations.some((l) => l.includes('Recommendation')));
  assert.ok(result.errors.some((e) => e.message.startsWith('recommendation Evidence was not read')));
  const composition = reportComposition(f.audit, result.accepted, null, f.packets);
  assert.deepEqual(composition.keySessionAnalyses, result.accepted);
  const html = renderHtml(f.audit, 'en-US', composition);
  assert.ok(html.includes(legal.primaryFinding.observation));
  assert.ok(html.includes(legal.recommendation.action));
  assert.ok(html.includes(invalidRec.primaryFinding.observation));
  assert.ok(!html.includes(invalidRec.recommendation.action));
  assert.ok(!html.includes('Specific mechanism unknown'));

  const invalidFinding = f.item();
  invalidFinding.primaryFinding.evidenceIds = [f.handle('documents', 2, 'toolResultBytes')];
  const findingResult = f.accept([invalidFinding, f.item('retry-worker')]);
  assert.equal(findingResult.accepted[0].primaryFinding, null);
  assert.equal(findingResult.accepted[0].recommendation, null);
  assert.ok(findingResult.errors.some((e) => e.message.startsWith('primaryFinding Evidence was not read')));
  assert.ok(findingResult.accepted[0].limitations.some((l) => l.includes('Primary mechanism')));
  assert.notEqual(findingResult.accepted[1].primaryFinding, null);
  assert.notEqual(findingResult.accepted[1].recommendation, null);
});

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

/**
 * Helper to drive an unused lane through its code-issued retry into terminal fallback.
 */
async function fallbackLane(runDir, lane, initialTicket, env) {
  const f1 = await runCli([
    'report-run', 'ai-accept',
    '--run-dir', runDir,
    '--lane', lane,
    '--attempt', String(initialTicket.attempt),
    '--span-id', initialTicket.spanId,
  ], env, '{}');
  const res1 = JSON.parse(f1.stdout);
  if (res1.status === 'retrying') {
    await runCli([
      'report-run', 'ai-accept',
      '--run-dir', runDir,
      '--lane', lane,
      '--attempt', '2',
    ], env, '{}');
  }
}

/**
 * Helper to build a fixture Codex project with multiple sessions.
 */
async function setupMultiSessionFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-0039-'));
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
  await mkdir(project, { recursive: true });
  await mkdir(sessionsDir, { recursive: true });

  const base = Date.now() - 60 * 60 * 1000;
  const sessionSpecs = [
    { id: 'session-alpha', turns: [500, 200] },
    { id: 'session-beta', turns: [300, 100] },
    { id: 'session-gamma', turns: [80] },
  ];
  for (const spec of sessionSpecs) {
    const records = [{
      timestamp: new Date(base).toISOString(),
      type: 'session_meta',
      payload: { id: spec.id, cwd: project, originator: 'Codex CLI', cli_version: '0.1.0', model_provider: 'openai' },
    }];
    spec.turns.forEach((tokens, index) => {
      const turnId = `${spec.id}-turn-${index + 1}`;
      const sessionTime = new Date(base + index * 1000).toISOString();
      records.push({ timestamp: sessionTime, type: 'turn_context', payload: { turn_id: turnId, cwd: project } });
      records.push({
        timestamp: sessionTime,
        type: 'event_msg',
        payload: {
          type: 'token_usage_record',
          response_id: `${turnId}-response`,
          turn_id: turnId,
          usage: { input_tokens: tokens - 10, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: tokens },
          turn_token_usage: { input_tokens: tokens - 10, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: tokens },
        },
      });
      records.push({
        timestamp: sessionTime,
        type: 'response_item',
        payload: { type: 'message', role: 'user', turn_id: turnId, content: `Task query for ${spec.id} turn ${index + 1}` },
      });
      records.push({
        timestamp: sessionTime,
        type: 'response_item',
        payload: { type: 'message', role: 'assistant', turn_id: turnId, content: `Assistant answer for ${spec.id} turn ${index + 1}` },
      });
    });
    await writeFile(path.join(sessionsDir, `rollout-${spec.id}.jsonl`), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }

  const env = { CODEX_HOME: codexHome, TEMP: root, TMP: root };
  return { root, project, codexHome, runDir, env };
}

test('0039 AC-1 & AC-3: unified acceptance, dependency rules, unreconciled accounting boundaries, and non-empty error retention', async (t) => {
  const { root, project, codexHome, runDir, env } = await setupMultiSessionFixture();
  t.after(async () => { await rm(root, { recursive: true, force: true }); });

  // 1. Start a report run
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

  const projection = await readProjection(runDir, 'key-session-analysis');
  const sessionAlpha = projection.directory.sessions.find((s) => s.canonicalId === 'session-alpha');
  const turnAlpha1 = projection.directory.evidence.find((e) => e.objectKind === 'turn' && e.ownerCanonicalId === 'session-alpha');
  assert.ok(sessionAlpha && turnAlpha1, 'session-alpha and turnAlpha1 handles must be available in directory');

  // Case A: Recommendation has invalid target evidence ('e999999'), but primaryFinding is valid.
  // Expectation: Recommendation invalid retains legal mechanism, recommendation becomes null,
  // limitations records omission, and diagnostics record the dropped recommendation issue.
  const submissionInvalidRec = [
    {
      sessionHandle: sessionAlpha.handle,
      taskContext: 'Reconciling schema specifications.',
      primaryFinding: {
        observation: `Turn carried [[${turnAlpha1.handle}]].`,
        interpretation: 'Heavy context repetition across turns.',
        evidenceIds: [turnAlpha1.handle],
        support: 'moderate',
        alternativeExplanations: ['Task complexity requires multi-turn context.'],
      },
      recommendation: {
        action: 'Bound the input schema context.',
        rationale: 'Avoids multi-turn accumulation.',
        applicability: 'When schema exceeds 500 lines.',
        tradeoff: null,
        verification: 'Check turn 2 input tokens.',
        targetEvidenceIds: ['e999999'], // INVALID target evidence handle
      },
      limitations: ['Observed tool calls directly.'],
    },
  ];

  const acceptRes1 = await runCli([
    'report-run', 'ai-accept',
    '--run-dir', runDir,
    '--lane', 'key-session-analysis',
    '--attempt', String(start.tickets['key-session-analysis'].attempt),
    '--span-id', start.tickets['key-session-analysis'].spanId,
  ], env, JSON.stringify(submissionInvalidRec));
  assert.equal(acceptRes1.code, 0, acceptRes1.stderr);
  const acceptResult1 = JSON.parse(acceptRes1.stdout);

  assert.equal(acceptResult1.validationStatus, 'accepted', 'Submission with valid primaryFinding must be accepted');
  assert.ok(acceptResult1.errors.length > 0, 'valid=true must retain non-empty errors from dropped recommendation');
  assert.ok(acceptResult1.errors.some((err) => err.code === 'EVIDENCE_REF_UNKNOWN'), 'must record EVIDENCE_REF_UNKNOWN for invalid recommendation evidence');

  const acceptedEnvelope1 = JSON.parse(await readFile(path.join(runDir, 'lanes', 'key-session-analysis', 'accepted.json'), 'utf8'));
  assert.equal(acceptedEnvelope1.value.length, 1);
  assert.notEqual(acceptedEnvelope1.value[0].primaryFinding, null, 'primaryFinding must be retained');
  assert.equal(acceptedEnvelope1.value[0].recommendation, null, 'invalid recommendation must be dropped to null');
  assert.ok(acceptedEnvelope1.value[0].limitations.some((lim) => lim.includes('Recommendation')), 'limitation must note recommendation omission');

  // Verify raw artifact was preserved verbatim
  const rawText1 = await readFile(path.join(runDir, 'lanes', 'key-session-analysis', 'attempt-1.raw.json'), 'utf8');
  assert.equal(rawText1.trim(), JSON.stringify(submissionInvalidRec));

  // Case B: Domain parsing idempotency: repeatedly parsing the same candidate produces identical accepted shape and issues
  const audit = await readCanonicalAudit(runDir);
  const parsedRun1 = parseKeySessionAnalysesV2(submissionInvalidRec, {
    directory: projection.directory,
    locale: 'en-US',
    sessions: [{ key: 'session-alpha' }],
    audit,
  });
  const parsedRun2 = parseKeySessionAnalysesV2(submissionInvalidRec, {
    directory: projection.directory,
    locale: 'en-US',
    sessions: [{ key: 'session-alpha' }],
    audit,
  });
  assert.deepEqual(parsedRun1.accepted, parsedRun2.accepted, 'domain parser must be idempotent');
  assert.deepEqual(parsedRun1.issues, parsedRun2.issues, 'domain parser issues must be idempotent without accumulating');

  // Case C: Unreconciled accounting rejection of strong conclusions without clamp
  // If audit keySessionTokenAccounting is mismatched, strong support is blocked.
  const auditWithMismatch = {
    ...audit,
    keySessionTokenAccounting: [{ sessionId: 'session-alpha', status: 'mismatch', method: 'fixture' }],
  };
  const keySessionStrong = {
    sessionId: 'session-alpha',
    auditFingerprint: auditFingerprint(auditWithMismatch),
    taskContext: 'Reconciling schema specifications.',
    primaryFinding: {
      observation: 'Observation.',
      interpretation: 'Interpretation.',
      evidenceIds: [turnAlpha1.canonicalRef],
      support: 'strong', // STRONG support under mismatch
      alternativeExplanations: ['Alternative.'],
    },
    recommendation: {
      action: 'Action.',
      rationale: 'Rationale.',
      applicability: 'Applicability.',
      tradeoff: null,
      verification: 'Verification.',
      targetEvidenceIds: [turnAlpha1.canonicalRef],
    },
    evidenceRead: { turnIds: ['session-alpha-turn-1'], selectionReason: 'test', unreadScope: 'none' },
    limitations: ['Accounting mismatch limitation.'],
  };
  const strongVal = validateKeySessionAnalysis(auditWithMismatch, keySessionStrong);
  assert.equal(strongVal.valid, false, 'Strong conclusion must be rejected under mismatched accounting');
  assert.equal(keySessionStrong.primaryFinding.support, 'strong', 'Validator must not auto-clamp support to moderate to salvage causality');
});

test('0039 AC-2: batch deduplication retains first valid entry without annihilating entire group in composition', async (t) => {
  const { root, project, codexHome, runDir, env } = await setupMultiSessionFixture();
  t.after(async () => { await rm(root, { recursive: true, force: true }); });

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

  // 1. Accept report-synthesis with INVALID overview and 1 VALID finding
  // Proves AC-2: invalid overview doesn't wipe valid finding, and overview falls back deterministically
  const synthProj = await readProjection(runDir, 'report-synthesis');
  const summaryEntry = synthProj.directory.evidence.find((e) => e.objectKind === 'summary' && e.displayPolicy === 'allowed');
  const synthPayload = {
    overview: {
      summary: 'Bad overview citing non-existent handle.',
      evidenceRefs: ['e999999'], // Invalid handle
    },
    findings: [
      {
        title: 'Single Legal Finding',
        analysis: `Valid analysis citing [[${summaryEntry.handle}]].`,
        evidenceRefs: [summaryEntry.handle],
        support: 'strong',
        uncertainty: null,
      },
    ],
    noStrongFindingReason: null,
  };

  const acceptSynth = await runCli([
    'report-run', 'ai-accept',
    '--run-dir', runDir,
    '--lane', 'report-synthesis',
    '--attempt', String(start.tickets['report-synthesis'].attempt),
    '--span-id', start.tickets['report-synthesis'].spanId,
  ], env, JSON.stringify(synthPayload));
  assert.equal(acceptSynth.code, 0, acceptSynth.stderr);
  const synthResult = JSON.parse(acceptSynth.stdout);
  assert.equal(synthResult.validationStatus, 'accepted');
  assert.ok(synthResult.errors.some((err) => err.code === 'EVIDENCE_REF_UNKNOWN'), 'dropped overview issue recorded');

  // 2. Accept key-session-analysis with DUPLICATES:
  // - candidate 0: session-alpha, unique prose
  // - candidate 1: session-alpha again (DUPLICATE_SESSION_ENTRY) -> dropped
  // - candidate 2: session-beta, but identical prose to candidate 0 (DUPLICATE_ANALYSIS_PROSE) -> dropped
  // - candidate 3: session-beta, distinct valid prose -> retained
  const keyProj = await readProjection(runDir, 'key-session-analysis');
  const handleAlpha = keyProj.directory.sessions.find((s) => s.canonicalId === 'session-alpha').handle;
  const handleBeta = keyProj.directory.sessions.find((s) => s.canonicalId === 'session-beta').handle;
  const turnAlpha = keyProj.directory.evidence.find((e) => e.objectKind === 'turn' && e.ownerCanonicalId === 'session-alpha').handle;
  const turnBeta = keyProj.directory.evidence.find((e) => e.objectKind === 'turn' && e.ownerCanonicalId === 'session-beta').handle;

  const keyPayload = [
    // candidate 0: Session Alpha primary
    {
      sessionHandle: handleAlpha,
      taskContext: 'Reconciling interface specification alpha.',
      primaryFinding: {
        observation: `Alpha observed [[${turnAlpha}]].`,
        interpretation: 'Alpha repeated context interpretation.',
        evidenceIds: [turnAlpha],
        support: 'moderate',
        alternativeExplanations: ['Alpha alternative.'],
      },
      recommendation: {
        action: 'Alpha action.',
        rationale: 'Alpha rationale.',
        applicability: 'Alpha applicability.',
        tradeoff: null,
        verification: 'Alpha verification.',
        targetEvidenceIds: [turnAlpha],
      },
      limitations: ['Alpha limitations.'],
    },
    // candidate 1: Session Alpha duplicate (same session)
    {
      sessionHandle: handleAlpha,
      taskContext: 'Reconciling interface specification alpha duplicate.',
      primaryFinding: {
        observation: `Alpha duplicate observed [[${turnAlpha}]].`,
        interpretation: 'Alpha duplicate interpretation.',
        evidenceIds: [turnAlpha],
        support: 'moderate',
        alternativeExplanations: ['Alpha dup alternative.'],
      },
      recommendation: {
        action: 'Alpha dup action.',
        rationale: 'Alpha dup rationale.',
        applicability: 'Alpha dup applicability.',
        tradeoff: null,
        verification: 'Alpha dup verification.',
        targetEvidenceIds: [turnAlpha],
      },
      limitations: ['Alpha dup limitations.'],
    },
    // candidate 2: Session Beta with identical prose to candidate 0 (cross-session duplicate prose)
    {
      sessionHandle: handleBeta,
      taskContext: 'Reconciling interface specification alpha.', // identical prose parts
      primaryFinding: {
        observation: `Alpha observed [[${turnBeta}]].`, // identical narrative
        interpretation: 'Alpha repeated context interpretation.',
        evidenceIds: [turnBeta],
        support: 'moderate',
        alternativeExplanations: ['Alpha alternative.'],
      },
      recommendation: {
        action: 'Alpha action.',
        rationale: 'Alpha rationale.',
        applicability: 'Alpha applicability.',
        tradeoff: null,
        verification: 'Alpha verification.',
        targetEvidenceIds: [turnBeta],
      },
      limitations: ['Alpha limitations.'],
    },
    // candidate 3: Session Beta with distinct prose
    {
      sessionHandle: handleBeta,
      taskContext: 'Testing backend pipeline beta.',
      primaryFinding: {
        observation: `Beta pipeline observed [[${turnBeta}]].`,
        interpretation: 'Beta subagent retry churn mechanism.',
        evidenceIds: [turnBeta],
        support: 'moderate',
        alternativeExplanations: ['Beta alternative complexity.'],
      },
      recommendation: {
        action: 'Beta isolate test worker execution.',
        rationale: 'Beta avoids retry cascading.',
        applicability: 'Beta when tests fail consecutively.',
        tradeoff: null,
        verification: 'Beta confirm pass rate on next run.',
        targetEvidenceIds: [turnBeta],
      },
      limitations: ['Beta limitations.'],
    },
  ];

  const acceptKey = await runCli([
    'report-run', 'ai-accept',
    '--run-dir', runDir,
    '--lane', 'key-session-analysis',
    '--attempt', String(start.tickets['key-session-analysis'].attempt),
    '--span-id', start.tickets['key-session-analysis'].spanId,
  ], env, JSON.stringify(keyPayload));
  assert.equal(acceptKey.code, 0, acceptKey.stderr);
  const keyResult = JSON.parse(acceptKey.stdout);
  assert.equal(keyResult.validationStatus, 'accepted');

  // Verify duplicate reasons recorded at accept time
  assert.ok(keyResult.errors.some((err) => err.code === 'DUPLICATE_SESSION_ENTRY'), 'must record DUPLICATE_SESSION_ENTRY');
  assert.ok(keyResult.errors.some((err) => err.code === 'DUPLICATE_ANALYSIS_PROSE'), 'must record DUPLICATE_ANALYSIS_PROSE');

  const keyAccepted = JSON.parse(await readFile(path.join(runDir, 'lanes', 'key-session-analysis', 'accepted.json'), 'utf8'));
  assert.equal(keyAccepted.value.length, 2, 'accepted items must keep candidate 0 and candidate 3');
  assert.equal(keyAccepted.value[0].sessionId, 'session-alpha');
  assert.equal(keyAccepted.value[1].sessionId, 'session-beta');

  // Mark skill-insights as fallback terminal so compose can run
  await fallbackLane(runDir, 'skill-insights', start.tickets['skill-insights'], env);

  // 3. Compose the report and verify HTML visibility
  const htmlPath = path.join(root, 'report.html');
  const composed = await runCli([
    'report-run', 'compose',
    '--run-dir', runDir,
    '--locale', 'en-US',
    '--html', htmlPath,
  ], env);
  assert.equal(composed.code, 0, composed.stderr);

  // Both accepted key session analyses must be present in HTML (NOT annihilated!)
  const html = await readFile(htmlPath, 'utf8');
  assert.ok(html.includes('Reconciling interface specification alpha'), 'Candidate 0 must be visible in composed HTML');
  assert.ok(html.includes('Testing backend pipeline beta'), 'Candidate 3 must be visible in composed HTML');

  // Finding from Report Synthesis must be visible in HTML, and header overview falls back gracefully
  assert.ok(html.includes('Single Legal Finding'), 'Valid Finding must be visible in composed HTML');
});

test('0039 AC-4: truthful artifact integrity failure records locatable warning and fallbackReason without collateralizing sibling lanes', async (t) => {
  const { root, project, codexHome, runDir, env } = await setupMultiSessionFixture();
  t.after(async () => { await rm(root, { recursive: true, force: true }); });

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

  // 1. Accept valid report-synthesis
  const synthProj = await readProjection(runDir, 'report-synthesis');
  const summaryEntry = synthProj.directory.evidence.find((e) => e.objectKind === 'summary' && e.displayPolicy === 'allowed');
  const synthPayload = {
    overview: {
      summary: `Clean report overview citing [[${summaryEntry.handle}]].`,
      evidenceRefs: [summaryEntry.handle],
    },
    findings: [
      {
        title: 'Authentic Synthesis Finding',
        analysis: `Observation backed by [[${summaryEntry.handle}]].`,
        evidenceRefs: [summaryEntry.handle],
        support: 'strong',
        uncertainty: null,
      },
    ],
    noStrongFindingReason: null,
  };
  const acceptSynth = await runCli([
    'report-run', 'ai-accept',
    '--run-dir', runDir,
    '--lane', 'report-synthesis',
    '--attempt', String(start.tickets['report-synthesis'].attempt),
    '--span-id', start.tickets['report-synthesis'].spanId,
  ], env, JSON.stringify(synthPayload));
  assert.equal(acceptSynth.code, 0, acceptSynth.stderr);

  // 2. Accept valid key-session-analysis
  const keyProj = await readProjection(runDir, 'key-session-analysis');
  const handleAlpha = keyProj.directory.sessions.find((s) => s.canonicalId === 'session-alpha').handle;
  const turnAlpha = keyProj.directory.evidence.find((e) => e.objectKind === 'turn' && e.ownerCanonicalId === 'session-alpha').handle;
  const keyPayload = [
    {
      sessionHandle: handleAlpha,
      taskContext: 'Task Context for uncorrupted sibling lane.',
      primaryFinding: {
        observation: `Turn observation [[${turnAlpha}]].`,
        interpretation: 'Turn interpretation.',
        evidenceIds: [turnAlpha],
        support: 'moderate',
        alternativeExplanations: ['Alt explanation.'],
      },
      recommendation: {
        action: 'Turn action.',
        rationale: 'Turn rationale.',
        applicability: 'Turn applicability.',
        tradeoff: null,
        verification: 'Turn verification.',
        targetEvidenceIds: [turnAlpha],
      },
      limitations: ['Turn limitations.'],
    },
  ];
  const acceptKey = await runCli([
    'report-run', 'ai-accept',
    '--run-dir', runDir,
    '--lane', 'key-session-analysis',
    '--attempt', String(start.tickets['key-session-analysis'].attempt),
    '--span-id', start.tickets['key-session-analysis'].spanId,
  ], env, JSON.stringify(keyPayload));
  assert.equal(acceptKey.code, 0, acceptKey.stderr);

  // Mark skill-insights as fallback terminal
  await fallbackLane(runDir, 'skill-insights', start.tickets['skill-insights'], env);

  // 3. TAMPER with the accepted.json of report-synthesis (modify bytes/sha256)
  const synthAcceptedPath = path.join(runDir, 'lanes', 'report-synthesis', 'accepted.json');
  await writeFile(synthAcceptedPath, JSON.stringify({ corrupted: 'corrupted data that breaks sha256 checksum' }), 'utf8');

  // 4. Run compose
  const htmlPath = path.join(root, 'report-tampered.html');
  const composed = await runCli([
    'report-run', 'compose',
    '--run-dir', runDir,
    '--locale', 'en-US',
    '--html', htmlPath,
  ], env);
  assert.equal(composed.code, 0, `compose must succeed and degrade gracefully; stderr: ${composed.stderr}`);

  // 5. Inspect manifest and report.json outcomes
  const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
  assert.ok(
    manifest.warnings.some((w) => w.includes('Report Run lane artifact integrity verification failed for report-synthesis')),
    'manifest.warnings must record locatable integrity failure for report-synthesis',
  );
  // Original accept status in manifest must NOT be wiped or rewritten as native-no-conclusion
  assert.equal(manifest.laneStatus['report-synthesis'].status, 'accepted', 'original accept status must be preserved');

  const reportJson = JSON.parse(await readFile(path.join(runDir, 'report.json'), 'utf8'));
  // Corrupted lane records ARTIFACT_INTEGRITY_FAILED
  assert.equal(reportJson.ai.reportSynthesis.result, null);
  assert.equal(reportJson.ai.reportSynthesis.fallbackReason, 'ARTIFACT_INTEGRITY_FAILED');

  // UNCORRUPTED sibling lane is NOT collateralized
  assert.notEqual(reportJson.ai.keySessionAnalyses.result, null, 'sibling key-session-analyses must not be collateralized');
  assert.equal(reportJson.ai.keySessionAnalyses.result.length, 1);
  assert.equal(reportJson.ai.keySessionAnalyses.result[0].sessionId, 'session-alpha');
  assert.notEqual(reportJson.ai.keySessionAnalyses.fallbackReason, 'ARTIFACT_INTEGRITY_FAILED', 'sibling lane must not inherit ARTIFACT_INTEGRITY_FAILED');

  // Composed HTML preserves the uncorrupted sibling content
  const html = await readFile(htmlPath, 'utf8');
  assert.ok(html.includes('Task Context for uncorrupted sibling lane'), 'uncorrupted session analysis must remain visible in HTML');
});

test('0039 Reviewer Gap Coverage: invalid first item does not block valid same-session sibling, finding invalidation retains task context as null-finding with raw errors, and v1/v2 acceptance parity', async (t) => {
  const { root, project, codexHome, runDir, env } = await setupMultiSessionFixture();
  t.after(async () => { await rm(root, { recursive: true, force: true }); });

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

  const projection = await readProjection(runDir, 'key-session-analysis');
  const handleAlpha = projection.directory.sessions.find((s) => s.canonicalId === 'session-alpha').handle;
  const audit = await readCanonicalAudit(runDir);

  // 1. AC-2: Invalid first item (unredacted credentials) does NOT block subsequent valid same-session item
  const badCredentialItem = {
    sessionHandle: handleAlpha,
    taskContext: 'Task context contains secret api_key=sk-private-secret-12345.',
    primaryFinding: null,
    recommendation: null,
    limitations: ['The bounded history does not support a mechanism.'],
  };
  const goodSiblingItem = {
    sessionHandle: handleAlpha,
    taskContext: 'Legitimate synthetic task description without secrets.',
    primaryFinding: null,
    recommendation: null,
    limitations: ['The bounded history does not support a mechanism.'],
  };

  const acceptMixed = await runCli([
    'report-run', 'ai-accept',
    '--run-dir', runDir,
    '--lane', 'key-session-analysis',
    '--attempt', String(start.tickets['key-session-analysis'].attempt),
    '--span-id', start.tickets['key-session-analysis'].spanId,
  ], env, JSON.stringify([badCredentialItem, goodSiblingItem]));

  assert.equal(acceptMixed.code, 0, acceptMixed.stderr);
  const mixedResult = JSON.parse(acceptMixed.stdout);
  assert.equal(mixedResult.validationStatus, 'accepted', 'Valid sibling must be accepted even if first item failed validation');
  // Must NOT contain DUPLICATE_SESSION_ENTRY because bad item was rejected, so good item is the first valid entry!
  assert.equal(mixedResult.errors.some((e) => e.code === 'DUPLICATE_SESSION_ENTRY'), false, 'invalid first item must not trigger DUPLICATE_SESSION_ENTRY on valid sibling');
  assert.ok(mixedResult.errors.some((e) => e.message.includes('credentials')), 'rejection reason for first item must be recorded in errors');

  const acceptedEnvelope = JSON.parse(await readFile(path.join(runDir, 'lanes', 'key-session-analysis', 'accepted.json'), 'utf8'));
  assert.equal(acceptedEnvelope.value.length, 1);
  assert.equal(acceptedEnvelope.value[0].taskContext, 'Legitimate synthetic task description without secrets.');

  // 2. AC-3: Finding invalidation retains legal taskContext as null-finding, and records raw error
  const invalidFindingItem = {
    sessionHandle: handleAlpha,
    taskContext: 'Task context for invalid finding test.',
    primaryFinding: {
      observation: 'Observation.',
      interpretation: 'Interpretation.',
      support: 'moderate',
      alternativeExplanations: [],
      evidenceIds: ['e999999'], // invalid handle
    },
    recommendation: {
      action: 'Action.',
      rationale: 'Rationale.',
      applicability: 'Applicability.',
      tradeoff: null,
      verification: 'Verify.',
      targetEvidenceIds: ['e999999'],
    },
    limitations: ['Original limitation.'],
  };

  const parseResult = parseKeySessionAnalysesV2([invalidFindingItem], {
    directory: projection.directory,
    locale: 'en-US',
    sessions: [{ key: 'session-alpha' }],
    audit,
  });

  assert.ok(parseResult.accepted, 'finding invalidation must still produce an accepted null-finding item');
  assert.equal(parseResult.accepted.length, 1);
  assert.equal(parseResult.accepted[0].taskContext, 'Task context for invalid finding test.');
  assert.equal(parseResult.accepted[0].primaryFinding, null, 'invalid primaryFinding must be dropped to null');
  assert.equal(parseResult.accepted[0].recommendation, null, 'dependent recommendation must be dropped to null');
  assert.ok(parseResult.accepted[0].limitations.some((lim) => lim.includes('Primary mechanism was unavailable or failed validation')), 'limitations must state specific unknown');
  assert.ok(parseResult.issues.some((issue) => issue.code === 'EVIDENCE_REF_UNKNOWN'), 'raw failure reason must be recorded in issues');

  // 3. AC-1: v1 and v2 acceptance pipeline parity
  const v1Item = {
    sessionId: 'session-alpha',
    auditFingerprint: auditFingerprint(audit),
    taskContext: 'Task context for invalid finding test.',
    primaryFinding: {
      observation: 'Observation.',
      interpretation: 'Interpretation.',
      support: 'moderate',
      alternativeExplanations: [],
      evidenceIds: ['turn:session-alpha:unknown-turn'], // invalid v1 canonical ID
    },
    recommendation: {
      action: 'Action.',
      rationale: 'Rationale.',
      applicability: 'Applicability.',
      tradeoff: null,
      verification: 'Verify.',
      targetEvidenceIds: ['turn:session-alpha:unknown-turn'],
    },
    limitations: ['Original limitation.'],
  };

  const v1Result = acceptKeySessionAnalyses({
    audit,
    contractVersion: 1,
    raw: [v1Item],
    locale: 'en-US',
  });

  assert.equal(v1Result.validationAccepted, true);
  assert.equal(v1Result.accepted.length, 1);
  assert.equal(v1Result.accepted[0].primaryFinding, null);
  assert.equal(v1Result.accepted[0].recommendation, null);
  assert.equal(v1Result.accepted[0].taskContext, parseResult.accepted[0].taskContext);
  assert.ok(v1Result.errors.some((e) => e.message.includes('unknown or cross-Session')), 'v1 error recorded');
});
