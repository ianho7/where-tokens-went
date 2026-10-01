'use strict';

/**
 * Ticket 0038 owner tests: Evidence Directory, v2 model semantic output and code
 * binding.
 *
 * Expectations are fixed from the independent canonical `audit.json` /
 * `skill-snapshot.json` artifacts and from hand-written fixtures. They are never
 * produced by calling the resolver under test.
 */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const cliPath = path.resolve(__dirname, '..', 'dist', 'src', 'cli.js');
const { readProjection, v2Synthesis } = require('./fixtures/lane-contract-v2-fixtures');
const {
  bindSlotText,
  buildReportSynthesisDirectory,
  chunkSkillContent,
  formatSlotValue,
  parseReportSynthesisV2,
  parseKeySessionAnalysesV2,
  parseSkillInsightsV2,
  computeProjectionHash,
} = (() => {
  const reportRun = require(path.resolve(__dirname, '..', 'dist', 'src', 'report-run.js'));
  const laneContract = require(path.resolve(__dirname, '..', 'dist', 'src', 'lane-contract.js'));
  return { ...laneContract, computeProjectionHash: reportRun.computeProjectionHash };
})();

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

/**
 * Fixed independent input: two Sessions with hand-chosen Token totals, two Turns
 * each, one unavailable Turn measurement, one failed Turn, and a Skill snapshot
 * built from a hand-written SKILL.md.
 */
async function setupFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-v2-test-'));
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
    { id: 'v2-session-large', turns: [400, 100] },
    { id: 'v2-session-small', turns: [60] },
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
      if (spec.id === 'v2-session-large' && index === 0) {
        // Explicit Skill invocation evidence so the Skill Insights Lane has a candidate.
        records.push({ timestamp: sessionTime, type: 'event_msg', payload: { type: 'skill_listing', skills: [{ name: 'v2-skill' }] } });
        records.push({ timestamp: sessionTime, type: 'event_msg', payload: { type: 'skill_input', id: 'v2-skill-input', skill_name: 'v2-skill' } });
      }
      records.push({
        timestamp: sessionTime,
        type: 'event_msg',
        payload: {
          type: 'token_usage_record',
          response_id: `${turnId}-response`,
          turn_id: turnId,
          usage: { input_tokens: tokens - 5, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: tokens },
          turn_token_usage: { input_tokens: tokens - 5, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: tokens },
        },
      });
      records.push({
        timestamp: sessionTime,
        type: 'response_item',
        payload: { type: 'message', role: 'user', turn_id: turnId, content: `Fixture prompt for ${turnId}.` },
      });
    });
    // A failed Turn without a usage record produces an unavailable measurement.
    const failTurn = `${spec.id}-turn-fail`;
    const failTimestamp = new Date(base + 90000).toISOString();
    records.push({ timestamp: failTimestamp, type: 'turn_context', payload: { turn_id: failTurn, cwd: project } });
    records.push({ timestamp: failTimestamp, type: 'event_msg', payload: { type: 'stream_error', turn_id: failTurn, error: 'simulated model stream failure' } });
    records.push({ timestamp: failTimestamp, type: 'event_msg', payload: { type: 'task_complete', turn_id: failTurn, status: 'error', error: 'simulated model stream failure' } });
    await writeFile(path.join(sessionsDir, `rollout-${spec.id}.jsonl`), records.map((record) => JSON.stringify(record)).join('\n') + '\n');
  }

  // A Skill snapshot with a hand-written SKILL.md long enough to chunk twice.
  // `resolveSkillPath` searches `<invoking cwd>/.codex/skills/<name>/SKILL.md`, so the
  // fixture project (not the Harness home) owns the readable Skill.
  const skillDir = path.join(project, '.codex', 'skills', 'v2-skill');
  await mkdir(skillDir, { recursive: true });
  const skillContent = [
    '# V2 Skill',
    'MUST run the approval step before any write.',
    ...Array.from({ length: 12 }, (_, index) => `General note ${index + 1}: follow the usual editing loop and summarize changes for the reviewer before continuing.`),
  ].join('\n');
  await writeFile(path.join(skillDir, 'SKILL.md'), skillContent);

  return { root, project, codexHome, runDir, skillContent, env: { CODEX_HOME: codexHome, TEMP: root, TMP: root } };
}

async function startRun(fixture) {
  const started = await runCli([
    'report-run', 'run-all', 'start',
    '--harness', 'codex',
    '--cwd', fixture.project,
    '--since', '10000d',
    '--locale', 'en-US',
    '--run-dir', fixture.runDir,
  ], fixture.env);
  assert.equal(started.code, 0, started.stderr);
  const parsed = JSON.parse(started.stdout);
  assert.notEqual(parsed.reason, 'NO_HISTORY_IN_SCOPE', `fixture history was not discovered: ${started.stdout}`);
  return parsed;
}

// ---------------------------------------------------------------------------
// Unit-level owner checks with hand-written directories
// ---------------------------------------------------------------------------

test('numeric slots bind canonical values, units and locale formatting; private and unavailable slots reject', () => {
  const directory = {
    sessions: [], skills: [], families: [], content: [],
    evidence: [
      {
        handle: 'e1', objectKind: 'summary', canonicalRef: 'summary:totalTokens', ownerHandle: null, ownerCanonicalId: null,
        metric: 'totalTokens', label: 'total Tokens', value: { value: 12345, provenance: 'reported' }, unit: 'tokens',
        slotKind: 'tokens', allowedSlotKinds: ['tokens'], displayPolicy: 'allowed', display: null, citable: true,
      },
      {
        handle: 'e2', objectKind: 'summary', canonicalRef: 'summary:topSessionSharePercent', ownerHandle: null, ownerCanonicalId: null,
        metric: 'topSessionSharePercent', label: 'primary destination share', value: { value: 87.5, provenance: 'derived' }, unit: 'percent',
        slotKind: 'percentage', allowedSlotKinds: ['percentage'], displayPolicy: 'allowed', display: null, citable: true,
      },
      {
        handle: 'e3', objectKind: 'turn', canonicalRef: 'turn:abc', ownerHandle: 's1', ownerCanonicalId: 'session-a',
        metric: 'totalTokens', label: 'Turn Tokens', value: { value: null, provenance: 'unavailable' }, unit: 'tokens',
        slotKind: 'tokens', allowedSlotKinds: [], displayPolicy: 'unavailable', display: null, citable: true,
      },
      {
        handle: 'e4', objectKind: 'metric', canonicalRef: 'private:content', ownerHandle: null, ownerCanonicalId: null,
        metric: 'privatePlaceholder', label: 'private', value: null, unit: null,
        slotKind: null, allowedSlotKinds: [], displayPolicy: 'private', display: null, citable: true,
      },
      {
        handle: 'e5', objectKind: 'summary', canonicalRef: 'summary:reportedCost', ownerHandle: null, ownerCanonicalId: null,
        metric: 'reportedCost', label: 'reported cost', value: { value: 1500.5, provenance: 'estimated' }, unit: 'usd',
        slotKind: 'currency', allowedSlotKinds: ['currency'], displayPolicy: 'allowed', display: null, citable: true,
      },
    ],
  };

  const bound = bindSlotText('Observed [[e1]] total and [[percentage:e2]] of the destination.', directory, 'en-US', { fieldPath: 'x' });
  assert.equal(bound.ok, true, JSON.stringify(bound.issues));
  // Fixed literals, not values produced by the formatter under test.
  assert.equal(bound.text, 'Observed 12,345 total and 87.5% of the destination.');
  assert.equal(bound.bindings.length, 2);
  assert.equal(bound.bindings[0].canonicalRef, 'summary:totalTokens');
  assert.equal(bound.bindings[1].slotKind, 'percentage');

  // Locale and provenance formatting, pinned independently.
  assert.equal(bindSlotText('[[e1]]', directory, 'de-DE', { fieldPath: 'x' }).text, '12.345');
  assert.equal(bindSlotText('[[e2]]', directory, 'de-DE', { fieldPath: 'x' }).text, '87,5%');
  assert.equal(bindSlotText('[[e5]]', directory, 'en-US', { fieldPath: 'x' }).text, '$1,500.50');
  assert.equal(bindSlotText('[[e5]]', directory, 'de-DE', { fieldPath: 'x' }).text, '$1.500,50');
  assert.equal(bindSlotText('[[e5]]', directory, 'en-US', { fieldPath: 'x' }).bindings[0].value.provenance, 'estimated');

  const unavailable = bindSlotText('Observed [[e3]].', directory, 'en-US', { fieldPath: 'x' });
  assert.equal(unavailable.ok, false);
  assert.ok(unavailable.issues.some((issue) => issue.code === 'EVIDENCE_SLOT_INVALID' && /private or unavailable/.test(issue.message)));

  const privateSlot = bindSlotText('Observed [[e4]].', directory, 'en-US', { fieldPath: 'x' });
  assert.equal(privateSlot.ok, false);

  const unknown = bindSlotText('Observed [[e999]].', directory, 'en-US', { fieldPath: 'x' });
  assert.equal(unknown.ok, false);
  assert.ok(unknown.issues.some((issue) => /not in the current Lane directory/.test(issue.message)));

  const wrongKind = bindSlotText('Observed [[currency:e1]].', directory, 'en-US', { fieldPath: 'x' });
  assert.equal(wrongKind.ok, false, 'a slot must not relabel a Token count as currency');

  const malformed = bindSlotText('Observed [[nonsense]].', directory, 'en-US', { fieldPath: 'x' });
  assert.equal(malformed.ok, false);

  const crossObject = bindSlotText('Observed [[e3]].', directory, 'en-US', { fieldPath: 'x', ownerCanonicalId: 'session-b' });
  assert.equal(crossObject.ok, false, 'an entry owned by another Session must not bind');
});

test('Skill content chunking covers the frozen text with at most 200 code units and 40 overlap', () => {
  const content = 'A'.repeat(300) + 'B'.repeat(150);
  const chunks = chunkSkillContent('skill-x', content, (value) => `hash-${value.length}-${value.slice(0, 3)}`);
  assert.ok(chunks.length >= 2, 'content longer than one chunk must be split');
  for (const chunk of chunks) {
    assert.ok(chunk.endOffset - chunk.startOffset <= 200, 'each chunk stays within 200 code units');
    assert.ok(chunk.endOffset > chunk.startOffset);
    assert.equal(content.slice(chunk.startOffset, chunk.endOffset), chunk.text);
    assert.ok(typeof chunk.contentHash === 'string' && chunk.contentHash.length > 0);
  }
  const covered = new Set();
  for (const chunk of chunks) {
    for (let index = chunk.startOffset; index < chunk.endOffset; index += 1) covered.add(index);
  }
  assert.equal(covered.size, content.length, 'chunking must cover every code unit of the frozen content');
  for (let index = 1; index < chunks.length; index += 1) {
    assert.ok(chunks[index].startOffset < chunks[index - 1].endOffset, 'adjacent chunks overlap');
  }
});

test('v2 parsers reject code-owned fields, unknown handles, and wrong-typed required fields', () => {
  const directory = {
    sessions: [{
      handle: 's1', kind: 'session', canonicalId: 'session-a', label: 'session-a', displayPolicy: 'allowed',
    }],
    skills: [{ handle: 'k1', kind: 'skill', canonicalId: 'skill-a', label: 'skill-a', displayPolicy: 'allowed' }],
    families: [],
    content: [{
      handle: 'c1', canonicalRef: 'content:skill-a:0-200', skillHandle: 'k1', skillId: 'skill-a',
      contentHash: 'deadbeef', startOffset: 0, endOffset: 10, displayPolicy: 'allowed', available: true,
    }],
    evidence: [{
      handle: 'e1', objectKind: 'turn', canonicalRef: 'turn:one', ownerHandle: 's1', ownerCanonicalId: 'session-a',
      metric: 'totalTokens', label: 'Turn Tokens', value: { value: 400, provenance: 'reported' }, unit: 'tokens',
      slotKind: 'tokens', allowedSlotKinds: ['tokens'], displayPolicy: 'allowed', display: null, citable: true,
    }, {
      handle: 'e2', objectKind: 'metric', canonicalRef: 'global:totalSkillCalls', ownerHandle: null, ownerCanonicalId: null,
      metric: 'totalSkillCalls', label: 'Skill calls', value: { value: 10, provenance: 'derived' }, unit: 'calls',
      slotKind: 'count', allowedSlotKinds: ['count'], displayPolicy: 'allowed', display: null, citable: true,
    }],
  };

  const echoFingerprint = parseReportSynthesisV2({
    auditFingerprint: 'x',
    overview: { summary: 'Text', evidenceRefs: ['e1'] },
    findings: [],
    noStrongFindingReason: 'reason',
  }, { directory, locale: 'en-US' });
  assert.equal(echoFingerprint.accepted, null);
  assert.equal(echoFingerprint.issues[0].code, 'OUTPUT_CONTRACT_CODE_FIELD');

  const unknownHandle = parseReportSynthesisV2({
    overview: { summary: 'Text', evidenceRefs: ['e999'] },
    findings: [],
    noStrongFindingReason: 'reason',
  }, { directory, locale: 'en-US' });
  assert.equal(unknownHandle.accepted, null);
  assert.ok(unknownHandle.issues.some((issue) => issue.code === 'EVIDENCE_REF_UNKNOWN'));

  const wrongType = parseReportSynthesisV2({
    overview: { summary: 42, evidenceRefs: ['e1'] },
    findings: [],
    noStrongFindingReason: 'reason',
  }, { directory, locale: 'en-US' });
  assert.equal(wrongType.accepted, null);
  assert.ok(wrongType.issues.some((issue) => issue.code === 'REPORT_SYNTHESIS_INVALID'));

  const extraKeyOrder = parseReportSynthesisV2({
    noStrongFindingReason: 'reason',
    findings: [],
    overview: { evidenceRefs: ['e1'], summary: 'Text' },
    unrelatedExtra: { note: 'ignored' },
  }, { directory, locale: 'en-US' });
  assert.ok(extraKeyOrder.accepted, 'key order and unrelated extras must not change the result');
  assert.deepEqual(extraKeyOrder.accepted.overview.evidenceRefs, ['turn:one']);
  assert.equal(extraKeyOrder.accepted.overview.summary, 'Text');
  assert.equal(extraKeyOrder.accepted.noStrongFindingReason, 'reason');
  assert.equal(JSON.stringify(extraKeyOrder.accepted).includes('unrelatedExtra'), false, 'unrelated extras must not enter accepted');

  const forbiddenSessionId = parseKeySessionAnalysesV2([{
    sessionId: 'session-a',
    taskContext: 'Text',
    primaryFinding: null,
    recommendation: null,
    limitations: ['x'],
  }], { directory, locale: 'en-US', sessions: [{ key: 'session-a' }] });
  assert.equal(forbiddenSessionId.accepted, null);
  assert.ok(forbiddenSessionId.issues.some((issue) => /sessionHandle/.test(issue.message)), 'a canonical Session ID must not stand in for the Session handle');

  // Native zero-Finding synthesis: the enumerated no-conclusion reason is required.
  const zeroFinding = parseReportSynthesisV2({
    overview: { summary: 'Activity is too sparse for a stable first impression.', evidenceRefs: ['e1'] },
    findings: [],
    noStrongFindingReason: 'The fixture contains one measured Turn only.',
  }, { directory, locale: 'en-US' });
  assert.ok(zeroFinding.accepted, JSON.stringify(zeroFinding.issues));
  assert.equal(zeroFinding.accepted.findings.length, 0);
  assert.equal(zeroFinding.accepted.noStrongFindingReason, 'The fixture contains one measured Turn only.');

  const zeroFindingWithoutReason = parseReportSynthesisV2({
    overview: { summary: 'Activity is too sparse for a stable first impression.', evidenceRefs: ['e1'] },
    findings: [],
    noStrongFindingReason: null,
  }, { directory, locale: 'en-US' });
  assert.equal(zeroFindingWithoutReason.accepted, null, 'zero Findings need a concrete no-conclusion reason');

  // A legal Skill content relation: content evidence bound by this insight's own handle.
  const emptySkillInsights = parseSkillInsightsV2({ insights: [] }, { directory, contentByHandle: new Map([['c1', 'Verified text']]), snapshotId: 'expected' });
  assert.equal(emptySkillInsights.accepted, null, 'an empty array must not masquerade as a completed Capability analysis');

  const skillContentRelation = parseSkillInsightsV2({
    insights: [{
      id: 'i2', kind: 'capability', scope: 'skill', claimStrength: 'coexistence',
      subject: { skillHandle: 'k1' },
      title: 'The approval boundary is not scaffold',
      reveal: { semantic: 'The mandate and the loop differ in role', pattern: 'content_contrast', evidenceRefs: ['e2', 'c1'] },
      mentalModelShift: { surface: 'generic loop', observed: 'a mandatory approval boundary' },
      decisionDelta: { before: 'treat as generic', after: 'keep the boundary' },
      observation: 'obs', contrast: 'con', interpretation: 'int',
      confidence: 'high',
      evidence: [
        { ref: 'e2' },
        { contentRef: 'c1', role: 'hardConstraint', loadingScope: 'always' },
        { contentRef: 'c1', role: 'genericProcedure', loadingScope: 'task_scoped' },
      ],
    }],
  }, { directory, contentByHandle: new Map([['c1', 'Verified text']]), snapshotId: 'expected' });
  assert.ok(skillContentRelation.accepted, JSON.stringify(skillContentRelation.issues));
  assert.equal(skillContentRelation.accepted.insights[0].evidence.length, 3);
  assert.equal(skillContentRelation.accepted.insights[0].evidence[1].contentExcerpt, 'Verified text');
  assert.equal(skillContentRelation.accepted.insights[0].subject.skillId, 'skill-a', 'code restores the canonical Skill identity');

  // A content handle that is not used by the same insight must not satisfy the Reveal.
  const unboundReveal = parseSkillInsightsV2({
    insights: [{
      id: 'i3', kind: 'usage', scope: 'global',
      title: 'T',
      reveal: { semantic: 'semantic', pattern: 'share_inversion', evidenceRefs: ['e2', 'c1'] },
      mentalModelShift: { surface: 's', observed: 'o' },
      decisionDelta: { before: 'b', after: 'a' },
      observation: 'obs', contrast: 'con', interpretation: 'int',
      confidence: 'high',
      evidence: [{ ref: 'e2' }],
    }],
  }, { directory, contentByHandle: new Map([['c1', 'Verified text']]), snapshotId: 'expected' });
  assert.equal(unboundReveal.accepted, null, 'a Reveal reference outside this insight evidence must reject the insight');
  assert.ok(unboundReveal.issues.some((issue) => issue.code === 'REVEAL_EVIDENCE_UNBOUND'));

  const evidenceReadEcho = parseKeySessionAnalysesV2([{
    sessionHandle: 's1',
    taskContext: 'Text',
    primaryFinding: null,
    recommendation: null,
    runId: 'foreign-run',
    limitations: ['x'],
  }], { directory, locale: 'en-US', sessions: [{ key: 'session-a' }] });
  assert.equal(evidenceReadEcho.accepted, null);
  assert.equal(evidenceReadEcho.issues[0].code, 'OUTPUT_CONTRACT_CODE_FIELD');

  const unknownSession = parseKeySessionAnalysesV2([{
    sessionHandle: 's9',
    taskContext: 'Text',
    primaryFinding: null,
    recommendation: null,
    limitations: ['x'],
  }], { directory, locale: 'en-US', sessions: [{ key: 'session-a' }] });
  assert.equal(unknownSession.accepted, null);
  assert.ok(unknownSession.issues.some((issue) => issue.code === 'EVIDENCE_REF_UNKNOWN'));

  const nullFindingDelivered = parseKeySessionAnalysesV2([{
    sessionHandle: 's1',
    taskContext: 'Text',
    primaryFinding: null,
    recommendation: null,
    limitations: ['accounting was not reconciled'],
  }], { directory, locale: 'en-US', sessions: [{ key: 'session-a' }] });
  assert.ok(nullFindingDelivered.accepted, JSON.stringify(nullFindingDelivered.issues));
  assert.equal(nullFindingDelivered.accepted[0].sessionId, 'session-a');
  assert.equal(nullFindingDelivered.accepted[0].primaryFinding, null);
  assert.equal(nullFindingDelivered.accepted[0].evidenceRead.turnIds.length, 0, 'code restores evidenceRead, not the model');

  const crossSessionEvidence = parseKeySessionAnalysesV2([{
    sessionHandle: 's1',
    taskContext: 'Text',
    primaryFinding: {
      observation: 'Observed [[e1]].',
      interpretation: 'Interpretation.',
      evidenceIds: ['e2'],
      support: 'moderate',
      alternativeExplanations: ['alternative'],
    },
    recommendation: {
      action: 'Act.',
      rationale: 'Because.',
      applicability: 'Here.',
      tradeoff: null,
      verification: 'Verify.',
      targetEvidenceIds: ['e2'],
    },
    limitations: ['x'],
  }], { directory, locale: 'en-US', sessions: [{ key: 'session-a' }] });
  assert.equal(crossSessionEvidence.accepted[0].primaryFinding, null, 'a non-turn, cross-object reference must not bind as Session evidence');
  assert.equal(crossSessionEvidence.accepted[0].recommendation, null);
  assert.ok(crossSessionEvidence.issues.some((issue) => issue.code === 'EVIDENCE_REF_INCOMPATIBLE'));

  const snapshotIdEcho = parseSkillInsightsV2({
    snapshotId: 'x',
    insights: [],
  }, { directory, contentByHandle: new Map([['c1', 'Verified text']]), snapshotId: 'expected' });
  assert.equal(snapshotIdEcho.accepted, null);
  assert.equal(snapshotIdEcho.issues[0].code, 'OUTPUT_CONTRACT_CODE_FIELD');

  const excerptEcho = parseSkillInsightsV2({
    insights: [{
      id: 'i1', kind: 'usage', scope: 'global', title: 'T',
      reveal: { semantic: 'semantic', pattern: 'share_inversion', evidenceRefs: ['e2'] },
      mentalModelShift: { surface: 's', observed: 'o' },
      decisionDelta: { before: 'b', after: 'a' },
      observation: 'obs', contrast: 'con', interpretation: 'int',
      confidence: 'high',
      evidence: [{ ref: 'e2', metric: 'totalSkillCalls', value: 999 }],
    }],
  }, { directory, contentByHandle: new Map([['c1', 'Verified text']]), snapshotId: 'expected' });
  assert.ok(excerptEcho.accepted, JSON.stringify(excerptEcho.issues));
  assert.equal(excerptEcho.accepted.insights[0].evidence[0].value, 10, 'a model-supplied measurement must be replaced by the canonical value');
  assert.equal(excerptEcho.accepted.insights[0].evidence[0].metric, 'totalSkillCalls');
});

// ---------------------------------------------------------------------------
// Object compatibility: a content citation must belong to the objects the
// insight itself declares (0038 AC-3). Fixed two/three-Skill input.
// ---------------------------------------------------------------------------

function fixedOwnerDirectory() {
  return {
    sessions: [],
    skills: ['a', 'b', 'c'].map((id, index) => ({
      handle: `k${index + 1}`,
      kind: 'skill',
      canonicalId: `skill-${id}`,
      label: `skill-${id}`,
      displayPolicy: 'allowed',
    })),
    families: [{ handle: 'f1', kind: 'family', canonicalId: 'fam-ab', label: 'fam-ab', displayPolicy: 'allowed' }],
    content: [
      { handle: 'c1', canonicalRef: 'content:skill-a:0-60', skillHandle: 'k1', skillId: 'skill-a', contentHash: 'h1', startOffset: 0, endOffset: 60, displayPolicy: 'allowed', available: true },
      { handle: 'c2', canonicalRef: 'content:skill-b:0-60', skillHandle: 'k2', skillId: 'skill-b', contentHash: 'h2', startOffset: 0, endOffset: 60, displayPolicy: 'allowed', available: true },
      { handle: 'c3', canonicalRef: 'content:skill-c:0-60', skillHandle: 'k3', skillId: 'skill-c', contentHash: 'h3', startOffset: 0, endOffset: 60, displayPolicy: 'allowed', available: true },
    ],
    evidence: [
      { handle: 'e1', objectKind: 'metric', canonicalRef: 'global:totalSkillCalls', ownerHandle: null, ownerCanonicalId: null, metric: 'totalSkillCalls', label: 'Skill calls', value: { value: 10, provenance: 'derived' }, unit: 'calls', slotKind: 'count', allowedSlotKinds: ['count'], displayPolicy: 'allowed', display: null, citable: true },
      { handle: 'e2', objectKind: 'skill', canonicalRef: 'skill:skill-a:calls', ownerHandle: 'k1', ownerCanonicalId: 'skill-a', metric: 'calls', label: 'Skill A calls', value: { value: 6, provenance: 'derived' }, unit: 'calls', slotKind: 'count', allowedSlotKinds: ['count'], displayPolicy: 'allowed', display: null, citable: true },
      { handle: 'e3', objectKind: 'skill', canonicalRef: 'skill:skill-b:calls', ownerHandle: 'k2', ownerCanonicalId: 'skill-b', metric: 'calls', label: 'Skill B calls', value: { value: 4, provenance: 'derived' }, unit: 'calls', slotKind: 'count', allowedSlotKinds: ['count'], displayPolicy: 'allowed', display: null, citable: true },
    ],
  };
}

const FIXED_CONTENT = new Map([['c1', 'Skill A requires approval before writing.'], ['c2', 'Skill B follows an editing loop.'], ['c3', 'Skill C text.']]);

function fixedOwnerInput(overrides) {
  return {
    insights: [{
      id: 'owner-card',
      kind: 'capability',
      claimStrength: 'coexistence',
      title: 'Fixed owner card',
      mentalModelShift: { surface: 's', observed: 'o' },
      decisionDelta: { before: 'b', after: 'a' },
      observation: 'obs',
      contrast: 'con',
      interpretation: 'int',
      confidence: 'high',
      ...overrides,
    }],
  };
}

function parseOwnerInput(overrides) {
  return parseSkillInsightsV2(fixedOwnerInput(overrides), {
    directory: fixedOwnerDirectory(),
    contentByHandle: FIXED_CONTENT,
    snapshotId: 'fixed-snapshot',
  });
}

test('content ownership: a skill insight may not cite another Skill, while legal same-owner, family, cross_skill and global relations stay deliverable', () => {
  const reject = (result, contentRef, expectedMessage) => {
    assert.equal(result.accepted, null, `must reject: ${JSON.stringify(result.issues)}`);
    const issue = result.issues.find((candidate) =>
      candidate.code === 'CONTENT_REF_INCOMPATIBLE'
      && typeof candidate.fieldPath === 'string'
      && candidate.fieldPath.endsWith('contentRef')
      && candidate.message.includes(`reference '${contentRef}'`));
    assert.ok(issue, `must record a locatable CONTENT_REF_INCOMPATIBLE for ${contentRef}: ${JSON.stringify(result.issues)}`);
    assert.match(issue.message, expectedMessage);
  };

  // 1. The reproduced gap: subject Skill A, content owned by Skill B.
  reject(parseOwnerInput({
    scope: 'skill',
    subject: { skillHandle: 'k1' },
    reveal: { semantic: 's', pattern: 'content_contrast', evidenceRefs: ['e1', 'c2'] },
    evidence: [
      { ref: 'e1' },
      { contentRef: 'c2', role: 'hardConstraint', loadingScope: 'always' },
      { contentRef: 'c2', role: 'genericProcedure', loadingScope: 'task_scoped' },
    ],
  }), 'c2', /owned by 'skill-b'.*not compatible with this 'skill' insight subject 'skill-a'/);

  // 2. Legal same-owner skill insight.
  const legalSkill = parseOwnerInput({
    scope: 'skill',
    subject: { skillHandle: 'k1' },
    reveal: { semantic: 's', pattern: 'content_contrast', evidenceRefs: ['e1', 'c1'] },
    evidence: [
      { ref: 'e1' },
      { contentRef: 'c1', role: 'hardConstraint', loadingScope: 'always' },
      { contentRef: 'c1', role: 'genericProcedure', loadingScope: 'task_scoped' },
    ],
  });
  assert.ok(legalSkill.accepted, JSON.stringify(legalSkill.issues));
  assert.equal(legalSkill.accepted.insights[0].subject.skillId, 'skill-a');
  assert.deepEqual(
    legalSkill.accepted.insights[0].evidence.filter((entry) => entry.contentExcerpt).map((entry) => entry.skillId),
    ['skill-a', 'skill-a'],
  );

  // 3. Legal family relation over two declared members (two unique roles, two Skills).
  const legalFamily = parseOwnerInput({
    scope: 'family',
    subject: { familyHandle: 'f1', skillHandles: ['k1', 'k2'] },
    reveal: { semantic: 's', pattern: 'content_contrast', evidenceRefs: ['e1', 'c1', 'c2'] },
    evidence: [
      { ref: 'e1' },
      { contentRef: 'c1', role: 'hardConstraint', loadingScope: 'always' },
      { contentRef: 'c2', role: 'decisionRule', loadingScope: 'always' },
      { contentRef: 'c1', role: 'genericProcedure', loadingScope: 'task_scoped' },
    ],
  });
  assert.ok(legalFamily.accepted, JSON.stringify(legalFamily.issues));
  assert.deepEqual(legalFamily.accepted.insights[0].subject, { familyId: 'fam-ab', skillIds: ['skill-a', 'skill-b'] });

  // 4. Family relation citing an undeclared third Skill must reject.
  reject(parseOwnerInput({
    scope: 'family',
    subject: { familyHandle: 'f1', skillHandles: ['k1', 'k2'] },
    reveal: { semantic: 's', pattern: 'content_contrast', evidenceRefs: ['e1', 'c1', 'c3'] },
    evidence: [
      { ref: 'e1' },
      { contentRef: 'c1', role: 'hardConstraint', loadingScope: 'always' },
      { contentRef: 'c3', role: 'decisionRule', loadingScope: 'always' },
      { contentRef: 'c1', role: 'genericProcedure', loadingScope: 'task_scoped' },
    ],
  }), 'c3', /not a declared member of this family insight/);

  // 5. Legal cross_skill comparison across two declared Skills.
  const legalCross = parseOwnerInput({
    scope: 'cross_skill',
    subject: { skillHandles: ['k1', 'k2'] },
    reveal: { semantic: 's', pattern: 'content_contrast', evidenceRefs: ['e2', 'c1', 'c2'] },
    evidence: [
      { ref: 'e2' },
      { contentRef: 'c1', role: 'hardConstraint', loadingScope: 'always' },
      { contentRef: 'c2', role: 'decisionRule', loadingScope: 'always' },
      { contentRef: 'c1', role: 'genericProcedure', loadingScope: 'task_scoped' },
    ],
  });
  assert.ok(legalCross.accepted, JSON.stringify(legalCross.issues));
  assert.deepEqual(legalCross.accepted.insights[0].subject, { skillIds: ['skill-a', 'skill-b'] });
  assert.deepEqual(
    [...new Set(legalCross.accepted.insights[0].evidence.filter((entry) => entry.contentExcerpt).map((entry) => entry.skillId))],
    ['skill-a', 'skill-b'],
  );

  // 6. cross_skill that only cites one Skill's content is not a shared-concept claim.
  const singleSkillCross = parseOwnerInput({
    scope: 'cross_skill',
    subject: { skillHandles: ['k1', 'k2'] },
    reveal: { semantic: 's', pattern: 'content_contrast', evidenceRefs: ['e2', 'c1'] },
    evidence: [
      { ref: 'e2' },
      { contentRef: 'c1', role: 'hardConstraint', loadingScope: 'always' },
      { contentRef: 'c1', role: 'genericProcedure', loadingScope: 'task_scoped' },
    ],
  });
  assert.equal(singleSkillCross.accepted, null);
  assert.ok(singleSkillCross.issues.some((issue) => /at least two distinct declared Skills/.test(issue.message)));

  // 7. cross_skill with the explicit cross_skill_content kind stays deliverable.
  const crossKind = parseOwnerInput({
    scope: 'cross_skill',
    subject: { skillHandles: ['k1', 'k2'] },
    reveal: { semantic: 's', pattern: 'content_contrast', evidenceRefs: ['e2', 'c1', 'c2'] },
    evidence: [
      { ref: 'e2' },
      { contentRef: 'c1', kind: 'cross_skill_content', role: 'hardConstraint', loadingScope: 'always' },
      { contentRef: 'c2', kind: 'cross_skill_content', role: 'decisionRule', loadingScope: 'always' },
      { contentRef: 'c1', kind: 'cross_skill_content', role: 'genericProcedure', loadingScope: 'task_scoped' },
    ],
  });
  assert.ok(crossKind.accepted, JSON.stringify(crossKind.issues));

  // 8. A usage-only cross_skill insight is not forced to cite content.
  const usageCross = parseSkillInsightsV2(fixedOwnerInput({
    kind: 'usage',
    scope: 'cross_skill',
    subject: { skillHandles: ['k1', 'k2'] },
    reveal: { semantic: 's', pattern: 'share_inversion', evidenceRefs: ['e2', 'e3'] },
    evidence: [{ ref: 'e2' }, { ref: 'e3' }],
  }), { directory: fixedOwnerDirectory(), contentByHandle: FIXED_CONTENT, snapshotId: 'fixed-snapshot' });
  assert.ok(usageCross.accepted, JSON.stringify(usageCross.issues));

  // 9. Global scope may still compare content across the population.
  const globalCompare = parseOwnerInput({
    scope: 'global',
    subject: { skillHandles: ['k1', 'k2'] },
    reveal: { semantic: 's', pattern: 'content_contrast', evidenceRefs: ['e1', 'c1', 'c2'] },
    evidence: [
      { ref: 'e1' },
      { contentRef: 'c1', role: 'hardConstraint', loadingScope: 'always' },
      { contentRef: 'c2', role: 'decisionRule', loadingScope: 'always' },
      { contentRef: 'c1', role: 'genericProcedure', loadingScope: 'task_scoped' },
    ],
  });
  assert.ok(globalCompare.accepted, JSON.stringify(globalCompare.issues));
});


test('directory build is deterministic and the Skill content hash is derived from the frozen text', async () => {
  const content = 'Frozen Skill content used for the hash check.';
  const hash = (value) => require('node:crypto').createHash('sha256').update(value).digest('hex');
  const [first] = chunkSkillContent('s', content, hash);
  assert.equal(first.contentHash, hash(content));
  assert.equal(first.startOffset, 0);
  assert.equal(first.endOffset, content.length);

  const audit = {
    scope: { harness: 'codex', cwd: null, allProjects: false, since: '2026-09-20T00:00:00.000Z', until: '2026-10-01T00:00:00.000Z' },
    coverage: { filesRead: 1, recordsRead: 1, recordsSkipped: 0, partialSessions: 0, warnings: [] },
    summary: { totalTokens: { value: 500, provenance: 'reported' } },
    rankings: {
      sessions: [{ key: 'session-a', value: { value: 400, provenance: 'reported' }, sharePercent: { value: 80, provenance: 'derived' }, count: { value: 2, provenance: 'reported' } }],
      projects: [], models: [], timeBuckets: [],
    },
    turns: [{
      sessionId: 'session-a', turnId: 'turn-1', ordinal: { value: 1, provenance: 'reported' },
      tokens: { inputTokens: { value: 1, provenance: 'reported' }, cachedInputTokens: { value: 0, provenance: 'reported' }, cacheWriteTokens: { value: 0, provenance: 'reported' }, outputTokens: { value: 1, provenance: 'reported' }, unclassifiedTokens: { value: 0, provenance: 'reported' }, reasoningTokens: { value: 0, provenance: 'reported' }, totalTokens: { value: 400, provenance: 'reported' } },
      sessionSharePercent: { value: 80, provenance: 'derived' }, modelCallCount: { value: 2, provenance: 'reported' },
      startedAt: { value: null, provenance: 'unavailable' }, endedAt: { value: null, provenance: 'unavailable' },
      durationMs: { value: 1000, provenance: 'reported' }, timeToFirstTokenMs: { value: null, provenance: 'unavailable' },
      observedSpanMs: { value: 1000, provenance: 'reported' }, toolCallCount: { value: 0, provenance: 'reported' },
      pairedToolResultCount: { value: 0, provenance: 'reported' }, toolResultChars: { value: 0, provenance: 'reported' },
      toolResultBytes: { value: 0, provenance: 'reported' }, errorCount: { value: 0, provenance: 'reported' },
      lifecycleMarkers: [], evidenceId: 'turn:one', method: 'fixture', coverage: { value: 100, provenance: 'derived' },
    }],
    turnCandidates: [], report: { checks: [] }, checks: [],
  };

  const firstBuild = buildReportSynthesisDirectory({ audit, turns: audit.turns, locale: 'en-US' });
  const secondBuild = buildReportSynthesisDirectory({ audit, turns: audit.turns, locale: 'en-US' });
  assert.deepEqual(firstBuild.directory, secondBuild.directory, 'the same frozen inputs must produce the same directory');
  const handles = firstBuild.directory.evidence.map((entry) => entry.handle);
  assert.equal(new Set(handles).size, handles.length);
  const totalTokens = firstBuild.directory.evidence.find((entry) => entry.canonicalRef === 'summary:totalTokens');
  assert.equal(totalTokens.value.value, 500, 'the directory must carry the canonical Audit value, not a derived copy');
  const turnTokens = firstBuild.directory.evidence.find((entry) => entry.canonicalRef === 'turn:one');
  assert.equal(turnTokens.value.value, 400);
  const projection = { lane: 'x', directory: firstBuild.directory };
  assert.equal(computeProjectionHash(projection), computeProjectionHash({ lane: 'x', directory: secondBuild.directory }));
  const changed = buildReportSynthesisDirectory({
    audit: { ...audit, summary: { totalTokens: { value: 501, provenance: 'reported' } } },
    turns: audit.turns,
    locale: 'en-US',
  });
  assert.notEqual(
    computeProjectionHash({ lane: 'x', directory: firstBuild.directory }),
    computeProjectionHash({ lane: 'x', directory: changed.directory }),
    'projectionHash must cover the Evidence Directory content',
  );
});

// ---------------------------------------------------------------------------
// End-to-end owner checks against a real Run
// ---------------------------------------------------------------------------

test('current Run binding: v2 output without identity echo binds canonical values from independent expectations', async (t) => {
  const fixture = await setupFixture();
  t.after(async () => { await rm(fixture.root, { recursive: true, force: true }); });
  const start = await startRun(fixture);
  assert.equal(start.tickets['report-synthesis'].outputContractVersion, 2);

  const projection = await readProjection(fixture.runDir, 'report-synthesis');
  const canonicalAudit = JSON.parse(await readFile(path.join(fixture.runDir, 'audit.json'), 'utf8'));
  const sessionEntry = projection.directory.evidence.find((entry) => entry.canonicalRef === 'ranking:sessions:v2-session-large');
  assert.ok(sessionEntry, 'the fixture must expose the large Session ranking entry');
  assert.equal(sessionEntry.value.value, 500, 'hand-computed Session total');
  const largeSessionTurns = canonicalAudit.turns.filter((turn) => turn.sessionId === 'v2-session-large');
  assert.equal(largeSessionTurns.length, 3, 'the large Session must record two measured Turns and one failed Turn');
  const measuredTurn = largeSessionTurns.find((turn) => turn.tokens.totalTokens.value === 400);
  assert.ok(measuredTurn, 'independent canonical expectation: the first Turn recorded 400 Tokens');
  const turnEntry = projection.directory.evidence.find((entry) => entry.canonicalRef === measuredTurn.evidenceId);
  assert.equal(turnEntry.value.value, 400, 'the directory must carry the canonical Turn value');
  assert.equal(String(canonicalAudit.summary.totalTokens.value), '560', 'independent canonical expectation');

  const synthesis = {
    overview: {
      summary: `The fixture concentrates usage in one Session reaching [[${sessionEntry.handle}]] Tokens.`,
      evidenceRefs: [sessionEntry.handle],
    },
    findings: [],
    noStrongFindingReason: 'The fixture is too small for a distinct report-level finding.',
  };
  const accepted = await runCli([
    'report-run', 'ai-accept',
    '--run-dir', fixture.runDir,
    '--lane', 'report-synthesis',
    '--attempt', String(start.tickets['report-synthesis'].attempt),
    '--span-id', start.tickets['report-synthesis'].spanId,
  ], fixture.env, JSON.stringify(synthesis));
  assert.equal(accepted.code, 0, accepted.stderr);

  const envelope = JSON.parse(await readFile(path.join(fixture.runDir, 'lanes', 'report-synthesis', 'accepted.json'), 'utf8'));
  assert.equal(envelope.outputContractVersion, 2);
  assert.equal(envelope.projectionHash, projection.projectionHash);
  assert.equal(typeof envelope.inputArtifactSha256, 'string');
  assert.equal(envelope.value.auditFingerprint, start.auditFingerprint);
  assert.deepEqual(envelope.value.overview.evidenceRefs, ['ranking:sessions:v2-session-large']);
  assert.ok(envelope.value.overview.summary.includes('500'), 'the slot must render the canonical ranking value');
  assert.equal(envelope.value.overview.summary.includes('[['), false);

  const rawArtifact = await readFile(path.join(fixture.runDir, 'lanes', 'report-synthesis', 'attempt-1.raw.json'), 'utf8');
  assert.equal(rawArtifact.includes('auditFingerprint'), false, 'raw bytes must preserve the model output verbatim, without injected identity');
  assert.equal(rawArtifact.trim(), JSON.stringify(synthesis), 'raw bytes must be the exact submitted text');
});

test('v2 is the default contract and v1 stays an explicit, identity-checking diagnostic entry', async (t) => {
  const fixture = await setupFixture();
  t.after(async () => { await rm(fixture.root, { recursive: true, force: true }); });
  const start = await startRun(fixture);
  const projection = await readProjection(fixture.runDir, 'report-synthesis');
  const good = v2Synthesis(projection, { summary: 'Valid overview for the fixture.' });

  const wrongAttempt = await runCli([
    'report-run', 'ai-accept',
    '--run-dir', fixture.runDir,
    '--lane', 'report-synthesis',
    '--attempt', '2',
    '--span-id', start.tickets['report-synthesis'].spanId,
  ], fixture.env, JSON.stringify(good));
  assert.notEqual(wrongAttempt.code, 0, 'an attempt that is not the current attempt must be refused');
  assert.match(wrongAttempt.stderr, /attempt does not match/);

  const wrongSpan = await runCli([
    'report-run', 'ai-accept',
    '--run-dir', fixture.runDir,
    '--lane', 'report-synthesis',
    '--attempt', String(start.tickets['report-synthesis'].attempt),
    '--span-id', 'foreign-span',
  ], fixture.env, JSON.stringify(good));
  assert.notEqual(wrongSpan.code, 0);
  assert.match(wrongSpan.stderr, /RUN_LANE_SPAN_MISMATCH/);

  // A v1-shaped submission under the default v2 contract is refused as a contract
  // violation instead of being silently read as v2.
  const v1Shape = {
    auditFingerprint: start.auditFingerprint,
    overview: { summary: 'Valid overview for the fixture.', evidenceRefs: ['summary:totalTokens'] },
    findings: [],
    noStrongFindingReason: 'No distinct finding.',
  };
  const v1OnV2 = await runCli([
    'report-run', 'ai-accept',
    '--run-dir', fixture.runDir,
    '--lane', 'report-synthesis',
    '--attempt', String(start.tickets['report-synthesis'].attempt),
    '--span-id', start.tickets['report-synthesis'].spanId,
  ], fixture.env, JSON.stringify(v1Shape));
  assert.equal(v1OnV2.code, 0, v1OnV2.stderr);
  const v1OnV2Result = JSON.parse(v1OnV2.stdout);
  assert.equal(v1OnV2Result.validationStatus, 'rejected');
  assert.match(JSON.stringify(v1OnV2Result.errors), /OUTPUT_CONTRACT_CODE_FIELD/);

  // v1 is explicit only: v2 handle output (here also carrying an identity echo) must
  // never be read as v1, and the refusal must be the contract guard, not a guess.
  const v2UnderV1 = await runCli([
    'report-run', 'ai-accept',
    '--run-dir', fixture.runDir,
    '--lane', 'report-synthesis',
    '--attempt', String(v1OnV2Result.retryTicket.attempt),
    '--span-id', v1OnV2Result.retryTicket.spanId,
    '--output-contract', '1',
  ], fixture.env, JSON.stringify({ ...good, sessionHandle: 's1', auditFingerprint: start.auditFingerprint }));
  assert.equal(v2UnderV1.code, 0, v2UnderV1.stderr);
  const v2UnderV1Result = JSON.parse(v2UnderV1.stdout);
  assert.equal(v2UnderV1Result.validationStatus, 'rejected', 'v2 handle output must never be read as v1');
  assert.match(JSON.stringify(v2UnderV1Result.errors), /LEGACY_CONTRACT_VIOLATION|OUTPUT_CONTRACT_CODE_FIELD/);

  // The v1 diagnostic entry still refuses a wrong identity and then binds a correct one.
  const keyProjection = await readProjection(fixture.runDir, 'key-session-analysis');
  const keyAudit = JSON.parse(await readFile(path.join(fixture.runDir, 'audit.json'), 'utf8'));
  const selectedSessionId = keyProjection.directory.sessions[0].canonicalId;
  const selectedTurn = keyAudit.turns.find((turn) => turn.sessionId === selectedSessionId && turn.tokens.totalTokens.value !== null);
  const selectedPacket = JSON.parse(await readFile(path.join(fixture.runDir, 'evidence.json'), 'utf8')).packets.find((packet) => packet.sessionId === selectedSessionId);
  const v1KeyEntry = (fingerprint) => [{
    sessionId: selectedSessionId,
    auditFingerprint: fingerprint,
    taskContext: 'Task context for the selected Session.',
    primaryFinding: null,
    recommendation: null,
    evidenceRead: {
      turnIds: [selectedTurn.turnId],
      selectionReason: selectedPacket.selectionReason,
      unreadScope: selectedPacket.unreadScope,
    },
    limitations: ['accounting was not reconciled'],
  }];
  const wrongIdentityV1 = await runCli([
    'report-run', 'ai-accept',
    '--run-dir', fixture.runDir,
    '--lane', 'key-session-analysis',
    '--attempt', String(start.tickets['key-session-analysis'].attempt),
    '--span-id', start.tickets['key-session-analysis'].spanId,
    '--output-contract', '1',
  ], fixture.env, JSON.stringify(v1KeyEntry('stale-fingerprint')));
  assert.equal(wrongIdentityV1.code, 0, wrongIdentityV1.stderr);
  const wrongIdentityV1Result = JSON.parse(wrongIdentityV1.stdout);
  assert.equal(wrongIdentityV1Result.validationStatus, 'rejected', 'v1 must still reject a wrong identity');
  assert.match(JSON.stringify(wrongIdentityV1Result.errors), /fingerprint is stale/);

  const v1KeyExplicit = await runCli([
    'report-run', 'ai-accept',
    '--run-dir', fixture.runDir,
    '--lane', 'key-session-analysis',
    '--attempt', String(wrongIdentityV1Result.retryTicket.attempt),
    '--span-id', wrongIdentityV1Result.retryTicket.spanId,
    '--output-contract', '1',
  ], fixture.env, JSON.stringify(v1KeyEntry(start.auditFingerprint)));
  assert.equal(v1KeyExplicit.code, 0, v1KeyExplicit.stderr);
  assert.equal(JSON.parse(v1KeyExplicit.stdout).validationStatus, 'accepted', 'the explicit v1 entry still binds canonical v1 output');
  const v1KeyEnvelope = JSON.parse(await readFile(path.join(fixture.runDir, 'lanes', 'key-session-analysis', 'accepted.json'), 'utf8'));
  assert.equal(v1KeyEnvelope.value[0].auditFingerprint, start.auditFingerprint, 'v1 binds the fingerprint it verified');
  assert.equal(v1KeyEnvelope.value[0].sessionId, selectedSessionId);

  // The Run itself records the code-owned contract version.
  const manifest = JSON.parse(await readFile(path.join(fixture.runDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.outputContractVersion, 2);
});

test('consumer paths: canonical refs, private slots and all three Lanes survive v2 binding', async (t) => {
  const fixture = await setupFixture();
  t.after(async () => { await rm(fixture.root, { recursive: true, force: true }); });
  const start = await startRun(fixture);
  const canonicalAudit = JSON.parse(await readFile(path.join(fixture.runDir, 'audit.json'), 'utf8'));

  // Report synthesis: a valid Finding survives an invalid Overview.
  const projection = await readProjection(fixture.runDir, 'report-synthesis');
  const printable = projection.directory.evidence.filter((entry) => entry.displayPolicy === 'allowed' && entry.citable);
  const unavailable = projection.directory.evidence.filter((entry) => entry.displayPolicy === 'unavailable');
  assert.ok(unavailable.length > 0, 'the failed Turn must expose an unavailable measurement');
  const synthesis = {
    overview: { summary: 'Overview citing a foreign handle [[e999]].', evidenceRefs: ['e999'] },
    findings: [{
      title: 'Concentration in one fixture Session',
      analysis: 'Most of the fixture usage sits in a single Session.',
      evidenceRefs: [printable[0].handle],
      support: 'moderate',
      uncertainty: null,
    }],
    noStrongFindingReason: null,
  };
  const acceptedSynthesis = await runCli([
    'report-run', 'ai-accept', '--run-dir', fixture.runDir, '--lane', 'report-synthesis',
    '--attempt', String(start.tickets['report-synthesis'].attempt), '--span-id', start.tickets['report-synthesis'].spanId,
  ], fixture.env, JSON.stringify(synthesis));
  assert.equal(acceptedSynthesis.code, 0, acceptedSynthesis.stderr);
  const synthesisEnvelope = JSON.parse(await readFile(path.join(fixture.runDir, 'lanes', 'report-synthesis', 'accepted.json'), 'utf8'));
  assert.equal(synthesisEnvelope.value.overview, null, 'an invalid Overview must not erase a legal Finding');
  assert.equal(synthesisEnvelope.value.findings.length, 1);
  const synthesisValidation = JSON.parse(await readFile(path.join(fixture.runDir, 'lanes', 'report-synthesis', 'attempt-1.validation.json'), 'utf8'));
  assert.ok(synthesisValidation.errors.some((error) => error.code === 'EVIDENCE_REF_UNKNOWN'), 'partial acceptance must keep its reasons');

  // Key Session: one legal entry, one structurally invalid entry in the same submission.
  const keyProjection = await readProjection(fixture.runDir, 'key-session-analysis');
  const sessionHandleValue = keyProjection.directory.sessions[0].handle;
  const sessionId = keyProjection.directory.sessions[0].canonicalId;
  const turnEntry = keyProjection.directory.evidence.find((entry) => entry.objectKind === 'turn' && entry.ownerCanonicalId === sessionId && entry.metric === 'totalTokens' && entry.displayPolicy === 'allowed');
  const unavailableTurnEntry = keyProjection.directory.evidence.find((entry) => entry.objectKind === 'turn' && entry.ownerCanonicalId === sessionId && entry.displayPolicy === 'unavailable');
  assert.ok(turnEntry, 'the selected Session must expose a printable Turn measurement');
  assert.ok(unavailableTurnEntry, 'the failed Turn must expose an unavailable measurement in the same Lane');

  const keyAccepted = await runCli([
    'report-run', 'ai-accept', '--run-dir', fixture.runDir, '--lane', 'key-session-analysis',
    '--attempt', String(start.tickets['key-session-analysis'].attempt), '--span-id', start.tickets['key-session-analysis'].spanId,
  ], fixture.env, JSON.stringify([{
    sessionHandle: sessionHandleValue,
    taskContext: `Task context for the selected Session, where the largest Turn carried [[${turnEntry.handle}]].`,
    primaryFinding: {
      observation: `The selected Turn carried [[${turnEntry.handle}]] Tokens.`,
      interpretation: 'A single Turn concentrated the Session workload.',
      evidenceIds: [turnEntry.handle],
      support: 'moderate',
      alternativeExplanations: ['Task complexity may explain the concentration.'],
    },
    recommendation: {
      action: 'Split the long document into bounded sections.',
      rationale: 'Reduces repeated context exposure in later Turns.',
      applicability: 'When one document dominates the task.',
      tradeoff: null,
      verification: 'Compare the next equivalent task and confirm quality stays acceptable.',
      targetEvidenceIds: [turnEntry.handle],
    },
    limitations: ['accounting not reconciled'],
  }, {
    sessionHandle: sessionHandleValue,
    taskContext: 'Structurally invalid entry.',
    primaryFinding: null,
    recommendation: {
      action: 'Act.', rationale: 'Because.', applicability: 'Here.', tradeoff: null, verification: 'Verify.',
      targetEvidenceIds: [turnEntry.handle],
    },
    limitations: ['x'],
  }]));
  assert.equal(keyAccepted.code, 0, keyAccepted.stderr);
  const keyResult = JSON.parse(keyAccepted.stdout);
  assert.equal(keyResult.validationStatus, 'accepted', JSON.stringify(keyResult.errors));
  assert.ok(keyResult.errors.length > 0, 'partial acceptance must still record the rejected item reason');
  const keyValidationArtifact = JSON.parse(await readFile(path.join(fixture.runDir, 'lanes', 'key-session-analysis', 'attempt-1.validation.json'), 'utf8'));
  assert.equal(keyValidationArtifact.status, 'accepted');
  assert.ok(keyValidationArtifact.errors.length > 0, 'the validation record must keep the dropped item reason');
  assert.ok(!keyValidationArtifact.rejectionReasons.includes('KEY_SESSION_INVALID') || keyValidationArtifact.errors.length > 0);
  assert.equal(
    keyValidationArtifact.errors.some((error) => /did not pass the lane output contract/.test(error.message)),
    false,
    'an accepted submission must not carry the fallback rejection message',
  );
  const keyEnvelope = JSON.parse(await readFile(path.join(fixture.runDir, 'lanes', 'key-session-analysis', 'accepted.json'), 'utf8'));
  assert.equal(keyEnvelope.value.length, 1, 'only the legal entry is accepted');
  assert.equal(keyEnvelope.value[0].sessionId, sessionId, 'code restores the canonical Session identity');
  assert.ok(keyEnvelope.value[0].recommendation, 'a legal Finding keeps its recommendation');
  assert.equal(typeof keyEnvelope.value[0].evidenceRead.selectionReason, 'string');
  assert.notEqual(keyEnvelope.value[0].evidenceRead.selectionReason, '', 'code restores evidenceRead from the supplied packet');
  assert.ok(Array.isArray(keyEnvelope.value[0].evidenceRead.turnIds) && keyEnvelope.value[0].evidenceRead.turnIds.length > 0);
  assert.ok(keyEnvelope.value[0].primaryFinding.observation.includes(String(turnEntry.value.value)));
  assert.equal(keyEnvelope.value[0].primaryFinding.observation.includes('[['), false);

  // An unavailable directory value can never become a printed number: the real Lane
  // parser must refuse the dependent item instead of rendering a digit.
  const unavailableSlot = parseKeySessionAnalysesV2([{
    sessionHandle: sessionHandleValue,
    taskContext: `The failed Turn reported [[${unavailableTurnEntry.handle}]] Tokens.`,
    primaryFinding: null,
    recommendation: null,
    limitations: ['accounting not reconciled'],
  }], { directory: keyProjection.directory, locale: 'en-US', sessions: [{ key: sessionId }] });
  assert.equal(unavailableSlot.accepted, null, 'an unavailable value must not become a printed number');
  assert.ok(unavailableSlot.issues.some((issue) => issue.code === 'EVIDENCE_SLOT_INVALID'));
  assert.ok(unavailableSlot.issues.some((issue) => /private or unavailable/.test(issue.message)));

  // A fully valid v2 accepted submission must not record the fallback rejection message.
  const cleanKeyProjection = await readProjection(fixture.runDir, 'key-session-analysis');
  const cleanRestore = parseKeySessionAnalysesV2([{
    sessionHandle: cleanKeyProjection.directory.sessions[0].handle,
    taskContext: 'Task context for the selected Session.',
    primaryFinding: null,
    recommendation: null,
    limitations: ['accounting not reconciled'],
  }], { directory: cleanKeyProjection.directory, locale: 'en-US', sessions: [{ key: cleanKeyProjection.directory.sessions[0].canonicalId }] });
  assert.ok(cleanRestore.accepted, JSON.stringify(cleanRestore.issues));
  assert.deepEqual(cleanRestore.issues, [], 'a fully valid submission reports no contract issues');

  // Unrelated extras must not enter the canonical accepted value.
  const extrasIgnored = parseKeySessionAnalysesV2([{
    sessionHandle: sessionHandleValue,
    taskContext: 'Task context for the selected Session.',
    primaryFinding: null,
    recommendation: null,
    limitations: ['accounting not reconciled'],
    unrelatedExtra: { note: 'ignored' },
  }], { directory: keyProjection.directory, locale: 'en-US', sessions: [{ key: sessionId }] });
  assert.ok(extrasIgnored.accepted, JSON.stringify(extrasIgnored.issues));
  assert.equal(JSON.stringify(extrasIgnored.accepted).includes('unrelatedExtra'), false);

  // Skill Insights: capability content relation with code-restored excerpts. The
  // run-all start already issued this Lane's attempt, so reuse its ticket.
  const skillTicket = start.tickets['skill-insights'];
  assert.ok(skillTicket, 'run-all start must issue the Skill Insights ticket');
  const skillProjection = await readProjection(fixture.runDir, 'skill-insights');
  const skill = skillProjection.directory.skills[0];
  if (skill) {
    const chunks = skillProjection.directory.content.filter((entry) => entry.available && entry.skillHandle === skill.handle);
    const usageEntry = skillProjection.directory.evidence.find((entry) => entry.objectKind === 'skill' && entry.ownerCanonicalId === skill.canonicalId);
    assert.ok(chunks.length >= 2, 'the frozen SKILL.md must be split into overlapping fragments');
    assert.ok(usageEntry, 'the Skill candidate must expose a deterministic usage metric');
    const skillOutput = {
      insights: [{
        id: 'v2-capability',
        kind: 'capability',
        scope: 'skill',
        claimStrength: 'coexistence',
        subject: { skillHandle: skill.handle },
        title: 'Approval boundary differs from the generic loop',
        reveal: { semantic: 'The approval boundary and the generic loop play different roles', pattern: 'content_contrast', evidenceRefs: [usageEntry.handle, chunks[0].handle, chunks[chunks.length - 1].handle] },
        mentalModelShift: { surface: 'A generic editing helper', observed: 'A workflow with a mandatory approval boundary' },
        decisionDelta: { before: 'Treat it as generic guidance', after: 'Keep the approval boundary and review the generic loop separately' },
        observation: 'The Skill states a mandatory approval step before any write.',
        contrast: 'That step is absent from the generic editing loop.',
        interpretation: 'Removing the Skill would drop the approval boundary.',
        counterfactual: { ifRemoved: 'The approval boundary disappears.', withoutGenericScaffold: 'The approval boundary remains.' },
        confidence: 'high',
        evidence: [
          { ref: usageEntry.handle },
          { contentRef: chunks[0].handle, role: 'hardConstraint', loadingScope: 'always' },
          { contentRef: chunks[chunks.length - 1].handle, role: 'genericProcedure', loadingScope: 'task_scoped' },
        ],
      }],
    };
    const skillAccepted = await runCli([
      'report-run', 'ai-accept', '--run-dir', fixture.runDir, '--lane', 'skill-insights',
      '--attempt', String(skillTicket.attempt), '--span-id', skillTicket.spanId,
    ], fixture.env, JSON.stringify(skillOutput));
    assert.equal(skillAccepted.code, 0, skillAccepted.stderr);
    const skillEnvelope = JSON.parse(await readFile(path.join(fixture.runDir, 'lanes', 'skill-insights', 'accepted.json'), 'utf8'));
    assert.equal(skillEnvelope.outputContractVersion, 2);
    assert.equal(skillEnvelope.value[0].snapshotId.length > 0, true);
    const contentEvidence = skillEnvelope.value[0].evidence.filter((entry) => entry.kind === 'skill_content');
    assert.equal(contentEvidence.length, 2);
    assert.ok(contentEvidence.every((entry) => typeof entry.contentExcerpt === 'string' && entry.contentExcerpt.length > 0));
    assert.equal(JSON.stringify(skillEnvelope.value).includes('"contentRef"'), false, 'the accepted envelope carries restored text, not fragment addresses');
    assert.ok(skillEnvelope.value[0].subject.skillId === skill.canonicalId, 'code restores the canonical Skill identity');
  }

  // Every Lane records the code-owned contract version and projection binding.
  for (const lane of ['report-synthesis', 'key-session-analysis', 'skill-insights']) {
    const envelope = JSON.parse(await readFile(path.join(fixture.runDir, 'lanes', lane, 'accepted.json'), 'utf8'));
    assert.equal(envelope.outputContractVersion, 2, `${lane} must record the contract version`);
    assert.equal(envelope.projectionHash, (await readProjection(fixture.runDir, lane)).projectionHash, `${lane} must bind the current projection`);
  }
  assert.equal(canonicalAudit.scope.harness, 'codex');
});
