const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, mkdir, readFile, rm, writeFile, stat } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');

const cliPath = path.resolve(__dirname, '..', 'dist', 'src', 'cli.js');
const {
  projectReportSynthesisInput,
  projectKeySessionAnalysisInput,
  projectSkillInsightsInput,
  computeProjectionHash,
} = require(path.resolve(__dirname, '..', 'dist', 'src', 'report-run.js'));
const { resolveReportEvidence } = require(path.resolve(__dirname, '..', 'dist', 'src', 'key-session-analysis.js'));
const {
  bindSlotText,
  parseReportSynthesisV2,
  buildReportSynthesisDirectory,
  emptyLaneDirectory,
  formatSlotValue,
} = require(path.resolve(__dirname, '..', 'dist', 'src', 'lane-contract.js'));

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

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

test('table-driven Lane Input Projection contracts: identity, canonical resolution, bounded scope, and unavailable preservation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'where-tokens-went-projections-test-'));
  const project = path.join(root, 'project');
  const codexHome = path.join(root, 'codex-home');
  const sessionsDir = path.join(codexHome, 'sessions', '2026', '09', '20');
  const runDir = path.join(root, 'run');
  const env = { CODEX_HOME: codexHome, TEMP: root, TMP: root };

  try {
    await mkdir(project, { recursive: true });
    await mkdir(sessionsDir, { recursive: true });

    // Construct 5 sessions with differing token totals and one unavailable measurement
    // Session 1: 150 tokens (Top 1)
    // Session 2: 100 tokens with one unavailable turn measurement (Top 2)
    // Session 3: 50 tokens (Top 3)
    // Session 4: 20 tokens (Outside Top 3 - must be excluded from key-session-analysis)
    // Session 5: 10 tokens (Outside Top 3 - must be excluded from key-session-analysis)
    const baseTime = Date.now() - 2 * 60 * 60 * 1000;
    const sessionSpecs = [
      { id: 'session-alpha', tokens: 150 },
      { id: 'session-beta', tokens: 100, hasUnavailableTurn: true },
      { id: 'session-gamma', tokens: 50 },
      { id: 'session-delta', tokens: 20 },
      { id: 'session-epsilon', tokens: 10 },
    ];

    for (const spec of sessionSpecs) {
      const records = [];
      const sessionTime = new Date(baseTime + records.length * 1000).toISOString();
      records.push({
        timestamp: sessionTime,
        type: 'session_meta',
        payload: { id: spec.id, cwd: project, originator: 'Codex CLI', cli_version: '0.1.0', model_provider: 'openai' },
      });
      records.push({
        timestamp: sessionTime,
        type: 'turn_context',
        payload: { turn_id: `${spec.id}-turn-1`, cwd: project },
      });
      records.push({
        timestamp: sessionTime,
        type: 'event_msg',
        payload: {
          type: 'token_usage_record',
          response_id: `${spec.id}-resp-1`,
          turn_id: `${spec.id}-turn-1`,
          usage: { input_tokens: spec.tokens - 10, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: spec.tokens },
          turn_token_usage: { input_tokens: spec.tokens - 10, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: spec.tokens },
        },
      });
      records.push({
        timestamp: sessionTime,
        type: 'response_item',
        payload: { type: 'message', role: 'user', turn_id: `${spec.id}-turn-1`, content: `User message for ${spec.id}` },
      });

      if (spec.hasUnavailableTurn) {
        // A second turn that failed without token usage record -> produces unavailable metrics
        const failTime = new Date(baseTime + 60000).toISOString();
        records.push({
          timestamp: failTime,
          type: 'turn_context',
          payload: { turn_id: `${spec.id}-turn-fail`, cwd: project },
        });
        records.push({
          timestamp: failTime,
          type: 'event_msg',
          payload: { type: 'stream_error', turn_id: `${spec.id}-turn-fail`, error: 'simulated model stream failure' },
        });
        records.push({
          timestamp: failTime,
          type: 'event_msg',
          payload: { type: 'task_complete', turn_id: `${spec.id}-turn-fail`, status: 'error', error: 'simulated model stream failure' },
        });
      }

      await writeFile(
        path.join(sessionsDir, `rollout-${spec.id}.jsonl`),
        records.map((record) => JSON.stringify(record)).join('\n') + '\n',
      );
    }

    // Step 1: run-all start to freeze run, generate canonical artifacts and projections
    const startResult = await runCli([
      'report-run', 'run-all', 'start',
      '--harness', 'codex',
      '--cwd', project,
      '--since', '10000d',
      '--locale', 'en-US',
      '--run-dir', runDir,
    ], env);
    assert.equal(startResult.code, 0, startResult.stderr);
    const startJson = JSON.parse(startResult.stdout);
    assert.equal(startJson.status, 'lanes-ready');

    // Read canonical artifacts from disk
    const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    const auditFile = manifest.artifacts.audit ? path.join(runDir, manifest.artifacts.audit.file) : path.join(runDir, 'audit.json');
    const canonicalAudit = JSON.parse(await readFile(auditFile, 'utf8'));
    const canonicalAuditBytes = (await stat(auditFile)).size;
    const canonicalEvidence = manifest.artifacts.evidence
      ? JSON.parse(await readFile(path.join(runDir, manifest.artifacts.evidence.file), 'utf8'))
      : null;
    const canonicalSnapshot = manifest.artifacts.skillSnapshot
      ? JSON.parse(await readFile(path.join(runDir, manifest.artifacts.skillSnapshot.file), 'utf8'))
      : null;

    // Observe bytes
    const observedBytes = {};

    // Table-driven suite defining expectations for the three lanes
    const laneCases = [
      {
        lane: 'report-synthesis',
        promptHash: manifest.promptHashes.reportSynthesis,
        verifyProjection(projection) {
          // Criterion 2: Resolvable references to canonical artifacts
          const summaryKeys = Object.keys(projection.audit.summary);
          assert.ok(summaryKeys.length > 0);
          const sampleSummaryRef = `summary:${summaryKeys[0]}`;
          assert.ok(
            resolveReportEvidence(canonicalAudit, sampleSummaryRef),
            `summary ref ${sampleSummaryRef} must resolve in canonical audit`,
          );

          if (projection.audit.checks && projection.audit.checks.length > 0) {
            const sampleCheckRef = `check:${projection.audit.checks[0].id}`;
            assert.ok(
              resolveReportEvidence(canonicalAudit, sampleCheckRef),
              `check ref ${sampleCheckRef} must resolve in canonical audit`,
            );
          }

          if (projection.audit.rankings.sessions && projection.audit.rankings.sessions.length > 0) {
            const sampleSessionRef = `ranking:sessions:${projection.audit.rankings.sessions[0].key}`;
            assert.ok(
              resolveReportEvidence(canonicalAudit, sampleSessionRef),
              `ranking session ref ${sampleSessionRef} must resolve in canonical audit`,
            );
          }

          if (projection.audit.turns && projection.audit.turns.length > 0) {
            const sampleTurnRef = projection.audit.turns[0].evidenceId;
            assert.ok(
              resolveReportEvidence(canonicalAudit, sampleTurnRef),
              `turn ref ${sampleTurnRef} must resolve in canonical audit`,
            );
          }

          // Criterion 3: Bounded omitted fields
          assert.ok(Array.isArray(projection.omittedFields));
          assert.ok(projection.omittedFields.includes('view'));
          assert.ok(projection.omittedFields.includes('weekComparison'));
          assert.ok(projection.omittedFields.includes('turnCandidates'));
          assert.equal(projection.audit.view, undefined);
          assert.equal(projection.audit.weekComparison, undefined);
          assert.equal(projection.audit.turnCandidates, undefined);
        },
      },
      {
        lane: 'key-session-analysis',
        promptHash: manifest.promptHashes.keySessionAnalysis,
        verifyProjection(projection) {
          // Criterion 2: Single authoritative location in projection.audit, no duplicated root collections
          assert.equal(projection.sessions, undefined, 'root sessions collection must be omitted');
          assert.equal(projection.turns, undefined, 'root turns collection must be omitted');
          assert.equal(projection.keySessionTokenAccounting, undefined, 'root keySessionTokenAccounting collection must be omitted');

          // Source references resolve to canonical artifact
          const canonicalSessionKeys = new Set(canonicalAudit.rankings.sessions.map((s) => s.key));
          const canonicalTurnIds = new Set(canonicalAudit.turns.map((t) => t.turnId));

          for (const session of projection.audit.rankings.sessions) {
            assert.ok(canonicalSessionKeys.has(session.key), `session ${session.key} must exist in canonical audit`);
          }
          for (const turn of projection.audit.turns) {
            assert.ok(canonicalTurnIds.has(turn.turnId), `turn ${turn.turnId} must exist in canonical audit`);
          }
          if (canonicalEvidence && canonicalEvidence.packets) {
            const canonicalPacketIds = new Set(canonicalEvidence.packets.map((p) => p.sessionId));
            for (const packet of projection.contentEvidencePackets) {
              assert.ok(canonicalPacketIds.has(packet.sessionId), `packet ${packet.sessionId} must exist in canonical evidence`);
            }
          }

          // Criterion 3: Scope and Session set is bounded (Top 3 only, cannot expand)
          assert.ok(canonicalAudit.rankings.sessions.length >= 5, 'canonical audit has at least 5 sessions');
          assert.equal(projection.audit.rankings.sessions.length, 3, 'projection must strictly contain Top 3 sessions');
          assert.deepEqual(
            projection.audit.rankings.sessions.map((s) => s.key),
            canonicalAudit.rankings.sessions.slice(0, 3).map((s) => s.key),
          );

          // Sessions 4 and 5 must NOT be in projection
          const projectionSessionKeys = new Set(projection.audit.rankings.sessions.map((s) => s.key));
          assert.ok(!projectionSessionKeys.has('session-delta'), 'session-delta must not be in key-session projection');
          assert.ok(!projectionSessionKeys.has('session-epsilon'), 'session-epsilon must not be in key-session projection');

          // Turns must only belong to top 3 sessions
          for (const turn of projection.audit.turns) {
            assert.ok(projectionSessionKeys.has(turn.sessionId), `turn ${turn.turnId} must belong to top 3 sessions`);
          }

          // Omitted fields are explicit
          assert.ok(projection.omittedFields.includes('sessionsOutsideTop3'));
          assert.ok(projection.omittedFields.includes('turnsOutsideTop3'));
          assert.ok(projection.omittedFields.includes('checks'));
          assert.ok(projection.omittedFields.includes('report'));
          assert.ok(projection.omittedFields.includes('rootSessionsDuplicate'));
          assert.ok(projection.omittedFields.includes('rootTurnsDuplicate'));
          assert.ok(projection.omittedFields.includes('rootTokenAccountingDuplicate'));
        },
      },
      {
        lane: 'skill-insights',
        promptHash: manifest.promptHashes.skillInsights,
        verifyProjection(projection) {
          // Criterion 2: Immutable snapshot identity matches canonical
          if (canonicalSnapshot) {
            assert.equal(projection.snapshotId, canonicalSnapshot.snapshotId);
            assert.equal(projection.snapshot.snapshotId, canonicalSnapshot.snapshotId);
            assert.deepEqual(projection.snapshot.distributionContext, canonicalSnapshot.distributionContext);
          }
          // Criterion 3: Snapshot is bounded and does not duplicate full audit or evidence
          assert.equal(projection.audit, undefined);
          assert.equal(projection.evidence, undefined);
          assert.ok(projection.omittedFields.includes('audit'));
          assert.ok(projection.omittedFields.includes('evidence'));
        },
      },
    ];

    // Execute table-driven assertions for each lane
    for (const testCase of laneCases) {
      const ticket = startJson.tickets[testCase.lane];
      assert.ok(ticket, `ticket for ${testCase.lane} must be issued`);

      // Criterion 6: ticket.inputArtifact points to projection
      assert.equal(ticket.inputArtifact, `lanes/${testCase.lane}/input.json`);

      // Read projection from disk
      const projectionFile = path.join(runDir, ticket.inputArtifact);
      const projectionBytes = (await stat(projectionFile)).size;
      const projectionRaw = await readFile(projectionFile);
      const projection = JSON.parse(projectionRaw.toString('utf8'));
      observedBytes[testCase.lane] = {
        projectionBytes,
        canonicalAuditBytes,
      };

      // Criterion 1: Identity fields
      assert.equal(projection.runId, manifest.runId);
      assert.equal(projection.lane, testCase.lane);
      assert.equal(projection.scope.harness, manifest.scope.harness);
      assert.equal(projection.scope.since, manifest.scope.since);
      assert.equal(projection.locale, manifest.scope.locale);
      assert.equal(projection.auditFingerprint, manifest.auditFingerprint);
      assert.equal(projection.bundleVersion, manifest.bundleVersion);
      assert.equal(projection.promptHash, testCase.promptHash);
      assert.equal(projection.projectionSchemaVersion, 2);
      assert.equal(projection.outputContractVersion, 2);
      assert.ok(/^[0-9a-f]{64}$/i.test(projection.projectionHash), 'projectionHash must be 64-char hex');
      assert.equal(projection.projectionHash, computeProjectionHash(projection));
      // Contract v2: the frozen Evidence Directory travels inside the projection
      // and is covered by projectionHash.
      assert.ok(projection.directory, 'projection must carry the frozen Evidence Directory');
      const handles = projection.directory.evidence.map((entry) => entry.handle);
      assert.ok(handles.length > 0, 'Evidence Directory must expose citable entries');
      assert.ok(handles.every((handle) => /^e[1-9][0-9]*$/.test(handle)), 'Evidence handles use the e namespace');
      assert.equal(new Set(handles).size, handles.length, 'Evidence handles must be unique');
      for (const entry of projection.directory.evidence) {
        // Structural, check and turn entries must address a canonical reference the
        // Audit resolver accepts once a derived metric suffix is removed. Summary
        // entries carry the canonical summary key verbatim.
        if (entry.objectKind === 'summary') {
          assert.ok(canonicalAudit.summary[entry.canonicalRef.slice('summary:'.length)], `summary entry ${entry.handle} must name a canonical summary key`);
        } else if (['check', 'turn', 'session', 'project', 'model', 'timeBucket'].includes(entry.objectKind)) {
          const baseRef = entry.canonicalRef.replace(/:(?:sessionSharePercent|modelCallCount|sharePercent|count|durationMs|errorCount|toolResultBytes)$/, '');
          assert.ok(
            resolveReportEvidence(canonicalAudit, baseRef) !== null,
            `directory entry ${entry.handle} (${entry.canonicalRef}) must map to a resolvable canonical reference`,
          );
        }
        assert.equal(entry.display === null || typeof entry.display === 'string', true);
      }
      for (const session of projection.directory.sessions) {
        assert.ok(/^s[1-9][0-9]*$/.test(session.handle), 'Session handles use the s namespace');
      }

      // Criterion 5: Manifest registers projection hash and bytes
      assert.ok(manifest.projections, 'manifest.projections must be defined');
      const projectionRef = manifest.projections[testCase.lane];
      assert.ok(projectionRef, `manifest.projections must contain entry for ${testCase.lane}`);
      assert.equal(projectionRef.file, `lanes/${testCase.lane}/input.json`);
      assert.equal(projectionRef.bytes, projectionBytes);
      assert.equal(projectionRef.sha256, sha256Hex(projectionRaw));

      // Lane-specific contract checks (Criteria 2 & 3)
      testCase.verifyProjection(projection);
    }

    // Criterion 4: missing and unavailable values remain intact
    // Check session-beta-turn-fail in canonicalAudit vs projection
    const canonicalFailTurn = canonicalAudit.turns.find((t) => t.turnId.includes('fail'));
    assert.ok(canonicalFailTurn, 'canonical audit must have turn with failure');
    assert.equal(canonicalFailTurn.tokens.totalTokens.provenance, 'unavailable');
    assert.equal(canonicalFailTurn.tokens.totalTokens.value, null);

    const reportProj = JSON.parse(await readFile(path.join(runDir, 'lanes/report-synthesis/input.json'), 'utf8'));
    const reportFailTurn = reportProj.audit.turns.find((t) => t.turnId.includes('fail'));
    assert.ok(reportFailTurn, 'report-synthesis projection must retain fail turn');
    assert.equal(reportFailTurn.tokens.totalTokens.provenance, 'unavailable');
    assert.equal(reportFailTurn.tokens.totalTokens.value, null);

    const keyProj = JSON.parse(await readFile(path.join(runDir, 'lanes/key-session-analysis/input.json'), 'utf8'));
    assert.equal(keyProj.sessions, undefined, 'key-session projection must omit duplicate root sessions');
    assert.equal(keyProj.turns, undefined, 'key-session projection must omit duplicate root turns');
    assert.equal(keyProj.keySessionTokenAccounting, undefined, 'key-session projection must omit duplicate root accounting');
    const keyFailTurn = keyProj.audit.turns.find((t) => t.turnId.includes('fail'));
    assert.ok(keyFailTurn, 'key-session-analysis projection must retain fail turn in authoritative audit.turns');
    assert.equal(keyFailTurn.tokens.totalTokens.provenance, 'unavailable');
    assert.equal(keyFailTurn.tokens.totalTokens.value, null);

    // Criterion 7: ai-accept binds v2 handle output to canonical values
    const synthesisProjection = JSON.parse(await readFile(path.join(runDir, 'lanes/report-synthesis/input.json'), 'utf8'));
    const synthesisHandle = synthesisProjection.directory.evidence.find(
      (entry) => entry.objectKind === 'summary' && entry.citable && entry.displayPolicy === 'allowed',
    );
    assert.ok(synthesisHandle, 'fixture audit must expose a printable summary entry');
    const synthesisValid = {
      overview: {
        summary: `The fixture records bounded activity around [[${synthesisHandle.handle}]].`,
        evidenceRefs: [synthesisHandle.handle],
      },
      findings: [],
      noStrongFindingReason: 'Activity was insufficient for multiple distinct findings.',
    };
    const acceptSynthesis = await runCli([
      'report-run', 'ai-accept',
      '--run-dir', runDir,
      '--lane', 'report-synthesis',
      '--attempt', String(startJson.tickets['report-synthesis'].attempt),
      '--span-id', startJson.tickets['report-synthesis'].spanId,
    ], env, JSON.stringify(synthesisValid));
    assert.equal(acceptSynthesis.code, 0, acceptSynthesis.stderr);
    const acceptSynthesisOutput = JSON.parse(acceptSynthesis.stdout);
    assert.equal(acceptSynthesisOutput.status, 'accepted');
    assert.equal(acceptSynthesisOutput.validationStatus, 'accepted');
    const acceptedEnvelope = JSON.parse(await readFile(path.join(runDir, 'lanes/report-synthesis/accepted.json'), 'utf8'));
    assert.equal(acceptedEnvelope.outputContractVersion, 2);
    assert.equal(acceptedEnvelope.version, 2);
    assert.equal(acceptedEnvelope.value.auditFingerprint, manifest.auditFingerprint);
    assert.deepEqual(acceptedEnvelope.value.overview.evidenceRefs, [synthesisHandle.canonicalRef]);
    assert.ok(
      acceptedEnvelope.value.overview.summary.includes(String(synthesisHandle.value.value)),
      'the numeric slot must be replaced by the canonical Audit value, not re-echoed by the model',
    );
    assert.ok(!acceptedEnvelope.value.overview.summary.includes('[['), 'no raw slot may remain in the accepted prose');

    // Criterion 8: Tampered projection identity or reference is rejected
    // 8A: Tamper projection identity (auditFingerprint) in lanes/key-session-analysis/input.json
    // Update manifest.laneArtifacts to bypass raw file-hash check and test projection identity validation
    const keyInputPath = path.join(runDir, 'lanes', 'key-session-analysis', 'input.json');
    const manifestPath = path.join(runDir, 'manifest.json');
    const originalKeyInput = await readFile(keyInputPath, 'utf8');
    const originalManifest = await readFile(manifestPath, 'utf8');

    const tamperedKeyInput = JSON.parse(originalKeyInput);
    tamperedKeyInput.auditFingerprint = 'tampered-fake-fingerprint';
    const tamperedKeyInputText = JSON.stringify(tamperedKeyInput, null, 2) + '\n';
    await writeFile(keyInputPath, tamperedKeyInputText);

    const manifestWithTamperedHash = JSON.parse(originalManifest);
    manifestWithTamperedHash.laneArtifacts['key-session-analysis/input.json'] = {
      file: 'lanes/key-session-analysis/input.json',
      bytes: Buffer.byteLength(tamperedKeyInputText),
      sha256: sha256Hex(Buffer.from(tamperedKeyInputText)),
    };
    await writeFile(manifestPath, JSON.stringify(manifestWithTamperedHash, null, 2) + '\n');

    const acceptTamperedIdentity = await runCli([
      'report-run', 'ai-accept',
      '--run-dir', runDir,
      '--lane', 'key-session-analysis',
      '--attempt', String(startJson.tickets['key-session-analysis'].attempt),
      '--span-id', startJson.tickets['key-session-analysis'].spanId,
    ], env, '[]');
    assert.notEqual(acceptTamperedIdentity.code, 0);
    assert.match(acceptTamperedIdentity.stderr, /LANE_PROJECTION_IDENTITY_TAMPERED/);

    // 8B: Tamper projection content hash mismatch
    const tamperedHashKeyInput = JSON.parse(originalKeyInput);
    tamperedHashKeyInput.projectionHash = '0000000000000000000000000000000000000000000000000000000000000000';
    const tamperedHashKeyInputText = JSON.stringify(tamperedHashKeyInput, null, 2) + '\n';
    await writeFile(keyInputPath, tamperedHashKeyInputText);

    manifestWithTamperedHash.laneArtifacts['key-session-analysis/input.json'] = {
      file: 'lanes/key-session-analysis/input.json',
      bytes: Buffer.byteLength(tamperedHashKeyInputText),
      sha256: sha256Hex(Buffer.from(tamperedHashKeyInputText)),
    };
    await writeFile(manifestPath, JSON.stringify(manifestWithTamperedHash, null, 2) + '\n');

    const acceptTamperedHash = await runCli([
      'report-run', 'ai-accept',
      '--run-dir', runDir,
      '--lane', 'key-session-analysis',
      '--attempt', String(startJson.tickets['key-session-analysis'].attempt),
      '--span-id', startJson.tickets['key-session-analysis'].spanId,
    ], env, '[]');
    assert.notEqual(acceptTamperedHash.code, 0);
    assert.match(acceptTamperedHash.stderr, /LANE_PROJECTION_IDENTITY_TAMPERED/);

    // Restore key input and manifest
    await writeFile(keyInputPath, originalKeyInput);
    await writeFile(manifestPath, originalManifest);

    // 8C: Tamper evidence reference in model output.
    // report-synthesis is already accepted, so bind the v2 parser directly with a
    // fixed independent expectation: an unknown handle must reject, not be guessed.
    const parserDirectory = synthesisProjection.directory;
    const element = parseReportSynthesisV2({
      overview: { summary: 'Activity is distributed across multiple observed sessions.', evidenceRefs: ['e999999'] },
      findings: [],
      noStrongFindingReason: 'Activity was insufficient for multiple distinct findings.',
    }, { directory: parserDirectory, locale: 'en-US' });
    assert.equal(element.accepted, null, 'an unknown handle must not be accepted');
    assert.ok(element.issues.some((issue) => issue.code === 'EVIDENCE_REF_UNKNOWN'), 'unknown handle must be reported explicitly');
    assert.equal(
      resolveReportEvidence(canonicalAudit, 'summary:nonexistent_tampered_metric_999'),
      null,
      'canonical validator must reject forged evidence reference',
    );

    // Criterion 9: Negative case: Projection missing required fields fails at contract boundary
    const dummyContext = {
      runId: 'test-run',
      lane: 'report-synthesis',
      scope: manifest.scope,
      locale: 'en-US',
      auditFingerprint: 'dummy-fp',
      bundleVersion: '0.1.0',
      promptHash: 'dummy-hash',
    };

    assert.throws(
      () => projectReportSynthesisInput(dummyContext, {}, emptyLaneDirectory()),
      /PROJECTION_MISSING_REQUIRED_FIELD/,
      'report-synthesis projection must throw when required fields are missing',
    );

    assert.throws(
      () => projectKeySessionAnalysisInput(dummyContext, {}, null, emptyLaneDirectory()),
      /PROJECTION_MISSING_REQUIRED_FIELD/,
      'key-session-analysis projection must throw when required fields are missing',
    );

    assert.throws(
      () => projectSkillInsightsInput(dummyContext, null, emptyLaneDirectory()),
      /PROJECTION_MISSING_REQUIRED_FIELD/,
      'skill-insights projection must throw when required fields are missing',
    );

    // Criterion 10: Observe and report projection bytes without arbitrary threshold
    console.log('# Observed Projection Sizes vs Canonical Audit:');
    console.log(`# Canonical Audit: ${canonicalAuditBytes} bytes`);
    for (const [lane, sizes] of Object.entries(observedBytes)) {
      console.log(`# Lane [${lane}]: ${sizes.projectionBytes} bytes (canonical audit: ${sizes.canonicalAuditBytes} bytes)`);
      assert.ok(sizes.projectionBytes > 0, `${lane} projection must have non-zero bytes`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
