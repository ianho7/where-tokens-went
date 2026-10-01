const assert = require('node:assert/strict');
const { test } = require('node:test');

const { renderHtml } = require('../dist/src/report.js');
const { makeResult } = require('./fixtures/kami-report-fixture.js');

test('renderHtml renders skill insights cards when present in composition', () => {
  const audit = makeResult();
  const composition = {
    auditFingerprint: 'test-fingerprint',
    audit,
    skillInsightsSnapshotId: 'test-snapshot',
    reportSynthesis: null,
    keySessionAnalyses: [],
    skillInsights: [
      {
        snapshotId: 'test-snapshot',
        id: 'insight-alpha',
        scope: 'skill',
        subject: { skillId: 'core-skill' },
        title: '核心指导提供关键环境约束',
        reveal: {
          semantic: '这个 Skill 的调用与普通流程承担不同角色',
          pattern: 'content_contrast',
          evidenceRefs: ['skill:core-skill:callShare', 'content:core-skill'],
        },
        mentalModelShift: {
          surface: '这只是一个普通辅助工具',
          observed: '它实际上提供了不可缺失的前置环境约束'
        },
        decisionDelta: {
          before: '按普通说明处理',
          after: '保留为常驻硬约束，并把通用流程延后审查',
        },
        observation: '该 Skill 提供了强制的环境一致性检查。',
        contrast: '它与普通流程承担不同角色。',
        interpretation: '若缺失此类约束，模型易产生无边界的文件变更。',
        consequence: '建议作为核心规则保留。',
        confidence: 'high',
        evidence: [
          { kind: 'skill_metric', skillId: 'core-skill', metric: 'callShare', value: 0.5 },
          { kind: 'skill_content', skillId: 'core-skill', role: 'hardConstraint', loadingScope: 'always', evidenceExcerpt: 'Always check git status before editing.' }
        ]
      }
    ]
  };

  const html = renderHtml(audit, 'zh-CN', composition);
  assert.ok(html.includes('<section class="skill-insights">'), 'Should render skill insights section');
  assert.ok(html.includes('这个 Skill 的调用与普通流程承担不同角色'), 'Should render the Reveal instead of internal title');
  assert.ok(html.includes('调用占比：50%'), 'Should render a human-readable metric badge');
  assert.ok(!html.includes('callShare: 0.5'), 'Should not expose raw metric keys');
  assert.ok(!html.includes('<span class="kami-badge scope-badge">'), 'Should not expose internal scope labels');
  assert.ok(html.includes('Always check git status before editing.'), 'Should render skill excerpt');
  assert.ok(!html.includes('核心观察'), 'Should not expose internal analysis scaffolding');
  assert.ok(!html.includes('核心指导提供关键环境约束'), 'Should not render the internal title');
  assert.ok(html.includes('Skill 使用证据'), 'Skill evidence table must still follow');
  assert.ok(!html.includes('证据：证据：'), 'Must not contain double evidence prefix');
});

test('renderHtml refuses Skill Insights bound to a different snapshot', () => {
  const audit = makeResult();
  const html = renderHtml(audit, 'zh-CN', {
    auditFingerprint: 'test-fingerprint',
    audit,
    skillInsightsSnapshotId: 'current-snapshot',
    reportSynthesis: null,
    keySessionAnalyses: [],
    skillInsights: [{
      snapshotId: 'older-snapshot',
      id: 'stale-insight',
      scope: 'global',
      title: '旧洞察',
      reveal: {
        semantic: '旧快照的结构结论',
        pattern: 'content_contrast',
        evidenceRefs: ['content:core-skill'],
      },
      mentalModelShift: { surface: '旧表面', observed: '旧现实' },
      decisionDelta: { before: '旧决策', after: '旧新决策' },
      observation: '旧观察',
      contrast: '旧对照',
      interpretation: '旧解释',
      confidence: 'high',
      evidence: [{ kind: 'skill_content', skillId: 'core-skill', evidenceExcerpt: 'old' }],
    }],
  });

  assert.ok(!html.includes('<section class="skill-insights">'), 'Stale insights must not render');
});

test('renderHtml renders cleanly without placeholder when skill insights are absent', () => {
  const audit = makeResult();
  const composition = {
    auditFingerprint: 'test-fingerprint',
    audit,
    reportSynthesis: null,
    keySessionAnalyses: [],
  };

  const html = renderHtml(audit, 'zh-CN', composition);
  assert.ok(!html.includes('<section class="skill-insights">'), 'Should not render empty skill insights section');
  assert.ok(html.includes('Skill 使用证据'), 'Skill evidence table must still render');
});

test('report-run compose integrates validated skill insights into HTML report', async () => {
  const { spawn } = require('node:child_process');
  const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const cliPath = path.resolve(__dirname, '..', 'dist', 'src', 'cli.js');

  function runCli(args, env, input = '') {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cliPath, ...args], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (c) => { stdout += c; });
      child.stderr.on('data', (c) => { stderr += c; });
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(input);
    });
  }

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'skill-compose-test-'));
  try {
    const runDir = path.join(tmp, 'run');
    const skillDir = path.join(tmp, '.codex', 'skills', 'verified-skill');
    await mkdir(skillDir, { recursive: true });
    // Long enough that 200/40 chunking produces several frozen fragments, so the
    // two semantic roles can reference distinct approved excerpts.
    const skillPadding = Array.from({ length: 6 }, (_, index) => `Reference note ${index + 1}: environment-specific context that is unrelated to the execution policy.`).join('\n');
    const skillContent = '# Verified Skill\nExecution policy requires explicit approval.\n' + skillPadding + '\nSummarize the task before editing.';
    await writeFile(path.join(skillDir, 'SKILL.md'), skillContent);

    // A Scope-frozen Run needs at least one analyzable Session before a Lane can start.
    const now = new Date();
    const sessionsDir = path.join(
      tmp, 'sessions',
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    );
    await mkdir(sessionsDir, { recursive: true });
    const sessionTimestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await writeFile(path.join(sessionsDir, 'rollout-skill-compose.jsonl'), [
      { timestamp: sessionTimestamp, type: 'session_meta', payload: { id: 'skill-compose-session', cwd: tmp, originator: 'Codex CLI', cli_version: '0.1.0', model_provider: 'openai' } },
      { timestamp: sessionTimestamp, type: 'turn_context', payload: { turn_id: 'skill-compose-turn', cwd: tmp } },
      { timestamp: sessionTimestamp, type: 'event_msg', payload: { type: 'token_usage_record', response_id: 'skill-compose-response', turn_id: 'skill-compose-turn', usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 }, turn_token_usage: { input_tokens: 10, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 } } },
      { timestamp: sessionTimestamp, type: 'response_item', payload: { type: 'message', role: 'user', turn_id: 'skill-compose-turn', content: 'Fixture prompt for Skill Insights composition.' } },
    ].map((record) => JSON.stringify(record)).join('\n') + '\n');

    const prepared = await runCli([
      'report-run', 'prepare',
      '--harness', 'codex',
      '--cwd', tmp,
      '--since', '7d',
      '--locale', 'zh-CN',
      '--run-dir', runDir
    ], { CODEX_HOME: tmp });
    assert.equal(prepared.code, 0, prepared.stderr);

    const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    const htmlPath = path.join(tmp, 'final-report.html');

    const crypto = require('node:crypto');
    const skillHash = crypto.createHash('sha256').update(skillContent).digest('hex');
    const customSnapshot = {
      snapshotId: 'test-snapshot',
      auditFingerprint: manifest.auditFingerprint,
      createdAt: new Date().toISOString(),
      distributionContext: { median: 1, p75: 1.5, p90: 2.5, max: 10 },
      globalUsage: {
        totalSkillsUsed: 1,
        totalSkillCalls: 10,
        totalTasks: 2,
        callsPerTaskDistribution: { median: 1, p75: 1.5, p90: 2.5, max: 10 },
        top4CallShare: 1,
        lowFrequencySkillCount: 0,
        lowFrequencyCallCount: 0,
        lowFrequencySkillShare: 0,
        lowFrequencyCallShare: 0,
        singleUseSkillShare: 0,
        dominantFamily: null,
        familyMetrics: [],
      },
      selectedCandidates: [{
        skillId: 'verified-skill',
        skillName: 'verified-skill',
        candidateTypes: ['high_frequency'],
        signals: { calls: 10, tasks: 2, callShare: 1, callsPerTask: 5 },
      }],
      selectedSkills: [
        {
          skillId: 'verified-skill',
          skillName: 'verified-skill',
          skillPath: path.join(skillDir, 'SKILL.md'),
          contentState: 'available',
          skillMdBytes: Buffer.byteLength(skillContent, 'utf8'),
          skillMdEstimatedTokens: 15,
          skillMdHash: skillHash,
          skillMdContent: skillContent,
          referenceCount: 0,
          referenceBytes: 0,
          referenceFiles: [],
        }
      ]
    };
    const snapJson = JSON.stringify(customSnapshot) + '\n';
    await writeFile(path.join(runDir, 'skill-snapshot.json'), snapJson, 'utf8');
    manifest.artifacts.skillSnapshot = {
      file: 'skill-snapshot.json',
      bytes: Buffer.byteLength(snapJson, 'utf8'),
      sha256: crypto.createHash('sha256').update(snapJson).digest('hex')
    };
    await writeFile(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');


    const aiEnvelope = JSON.stringify({
      runId: manifest.runId,
      auditFingerprint: manifest.auditFingerprint,
      promptHashes: manifest.promptHashes,
      runtimeHash: manifest.runtimeHash,
      reportSynthesis: null,
      keySessionAnalyses: [],
      skillInsights: {
        insights: [{
          id: 'test-insight-1',
          kind: 'capability',
          scope: 'skill',
          subject: { skillHandle: 'k1' },
          title: '执行策略具备强硬约束',
          reveal: {
            semantic: '执行策略的硬约束需要与通用流程分开理解',
            pattern: 'content_contrast',
            evidenceRefs: ['eCALLS', 'cHARD', 'cGENERIC'],
          },
          mentalModelShift: {
            surface: '普通编码流程',
            observed: '执行策略具备严格前置审批硬约束'
          },
          decisionDelta: {
            before: '把它当作一般说明',
            after: '保留审批边界并单独治理通用流程',
          },
          observation: '该 Skill 提供了明确的执行前置审批要求。',
          contrast: '相比于普通任务入口，该约束在执行前必须常驻生效。',
          interpretation: '若缺失此类约束，环境可能发生未经审核的高危操作。',
          consequence: '建议作为核心硬约束保留。',
          counterfactual: {
            ifRemoved: '删除整个 Skill 会失去执行前置审批边界。',
            withoutGenericScaffold: '删除通用脚手架后仍保留执行前置审批边界。',
          },
          claimStrength: 'coexistence',
          confidence: 'high',
          evidence: [
            { ref: 'eCALLS' },
            { contentRef: 'cHARD', role: 'hardConstraint', loadingScope: 'always' },
            { contentRef: 'cGENERIC', role: 'genericProcedure', loadingScope: 'task_scoped' }
          ]
        }]
      }
    });

    const env = { CODEX_HOME: tmp };
    const started = await runCli([
      'report-run', 'ai-start',
      '--run-dir', runDir,
      '--lane', 'skill-insights'
    ], env);
    assert.equal(started.code, 0, started.stderr);
    const ticket = JSON.parse(started.stdout);
    assert.equal(ticket.outputContractVersion, 2);

    // Resolve handles from the frozen Lane projection rather than hardcoding them,
    // then submit model-shaped v2 output that names handles only.
    const projection = JSON.parse(await readFile(path.join(runDir, 'lanes', 'skill-insights', 'input.json'), 'utf8'));
    const skillHandle = projection.directory.skills.find((entry) => entry.canonicalId === 'verified-skill').handle;
    const callsEntry = projection.directory.evidence.find((entry) => entry.objectKind === 'skill' && entry.ownerCanonicalId === 'verified-skill' && entry.metric === 'calls');
    const contentEntries = projection.directory.content.filter((entry) => entry.skillId === 'verified-skill' && entry.available);
    const chunkText = (entry) => skillContent.slice(entry.startOffset, entry.endOffset);
    // Overlapping 200/40 chunks: the first chunk carrying each sentence gives two
    // distinct, individually citable fragments.
    const hardConstraintChunk = contentEntries.find((entry) => chunkText(entry).includes('Execution policy requires explicit approval.'));
    const genericChunk = [...contentEntries].reverse().find((entry) => chunkText(entry).includes('Summarize the task before editing.'));
    assert.ok(callsEntry && hardConstraintChunk && genericChunk, 'projection must expose the metric and both content fragments');
    assert.notEqual(hardConstraintChunk.handle, genericChunk.handle, 'the two roles must bind distinct frozen fragments');

    const modelOutput = JSON.parse(aiEnvelope).skillInsights;
    modelOutput.insights[0].subject = { skillHandle };
    modelOutput.insights[0].reveal.evidenceRefs = [callsEntry.handle, hardConstraintChunk.handle, genericChunk.handle];
    modelOutput.insights[0].evidence = [
      { ref: callsEntry.handle },
      { contentRef: hardConstraintChunk.handle, role: 'hardConstraint', loadingScope: 'always' },
      { contentRef: genericChunk.handle, role: 'genericProcedure', loadingScope: 'task_scoped' },
    ];

    const accepted = await runCli([
      'report-run', 'ai-accept',
      '--run-dir', runDir,
      '--lane', 'skill-insights',
      '--attempt', String(ticket.attempt),
      '--span-id', ticket.spanId
    ], env, JSON.stringify(modelOutput));
    assert.equal(accepted.code, 0, accepted.stderr);

    // Code restores canonical identity, metric value and approved excerpt text.
    const acceptedEnvelope = JSON.parse(await readFile(path.join(runDir, 'lanes', 'skill-insights', 'accepted.json'), 'utf8'));
    assert.equal(acceptedEnvelope.outputContractVersion, 2);
    assert.equal(acceptedEnvelope.snapshotId, 'test-snapshot');
    const acceptedEvidence = acceptedEnvelope.value[0].evidence;
    const metricEvidence = acceptedEvidence.find((entry) => entry.kind === 'skill_metric');
    const contentEvidence = acceptedEvidence.filter((entry) => entry.kind === 'skill_content');
    assert.equal(metricEvidence.skillId, 'verified-skill', 'code must restore the canonical Skill identity behind the handle');
    assert.equal(metricEvidence.metric, 'calls');
    assert.equal(metricEvidence.value, 10, 'code must restore the canonical metric value, not a model-supplied number');
    assert.equal(contentEvidence.length, 2);
    assert.ok(contentEvidence.every((entry) => typeof entry.contentExcerpt === 'string' && entry.contentExcerpt.length > 0), 'code must restore the approved excerpt text');
    assert.ok(!JSON.stringify(acceptedEnvelope.value[0]).includes('evidenceExcerpt'), 'v2 accepted output must not rely on a model-supplied excerpt field');

    const composed = await runCli([
      'report-run', 'compose',
      '--run-dir', runDir,
      '--locale', 'zh-CN',
      '--html', htmlPath
    ], env);

    assert.equal(composed.code, 0, composed.stderr);
    const html = await readFile(htmlPath, 'utf8');
    assert.ok(html.includes('<section class="skill-insights">'), 'Composed HTML must contain skill-insights section');
    assert.ok(html.includes('执行策略的硬约束需要与通用流程分开理解'), 'Composed HTML must contain the Reveal');
    assert.ok(html.includes('Execution policy requires explicit approval.'), 'Composed HTML must contain the code-restored excerpt');
    assert.ok(html.includes('10'), 'Composed HTML must render the canonical metric value bound from the directory');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
