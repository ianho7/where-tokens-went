const assert = require('node:assert/strict');
const { test } = require('node:test');

const { renderHtml } = require('../dist/src/report.js');
const { makeResult } = require('./fixtures/kami-report-fixture.js');

test('renderHtml renders skill insights cards when present in composition', () => {
  const audit = makeResult();
  const composition = {
    auditFingerprint: 'test-fingerprint',
    audit,
    reportSynthesis: null,
    keySessionAnalyses: [],
    skillInsights: [
      {
        id: 'insight-alpha',
        scope: 'skill',
        subject: { skillId: 'core-skill' },
        title: '核心指导提供关键环境约束',
        mentalModelShift: {
          surface: '这只是一个普通辅助工具',
          observed: '它实际上提供了不可缺失的前置环境约束'
        },
        decisionDelta: {
          before: '按普通说明处理',
          after: '保留为常驻硬约束，并把通用流程延后审查',
        },
        observation: '该 Skill 涉及约 50% 的用量，提供了强制的环境一致性检查。',
        contrast: '全系统中位数为 1.0 calls/task，该 Skill 显著高于基准。',
        interpretation: '若缺失此类约束，模型易产生无边界的文件变更。',
        consequence: '建议作为核心规则保留。',
        confidence: 'high',
        evidence: [
          { kind: 'skill_metric', metric: 'callShare', value: 0.5 },
          { kind: 'skill_content', skillId: 'core-skill', role: 'hardConstraint', loadingScope: 'always', evidenceExcerpt: 'Always check git status before editing.' }
        ]
      }
    ]
  };

  const html = renderHtml(audit, 'zh-CN', composition);
  assert.ok(html.includes('<section class="skill-insights">'), 'Should render skill insights section');
  assert.ok(html.includes('核心指导提供关键环境约束'), 'Should render insight title');
  assert.ok(html.includes('调用占比：50%'), 'Should render a human-readable metric badge');
  assert.ok(!html.includes('callShare: 0.5'), 'Should not expose raw metric keys');
  assert.ok(!html.includes('<span class="kami-badge scope-badge">'), 'Should not expose internal scope labels');
  assert.ok(html.includes('Always check git status before editing.'), 'Should render skill excerpt');
  assert.ok(html.includes('Skill 使用证据'), 'Skill evidence table must still follow');
  assert.ok(!html.includes('证据：证据：'), 'Must not contain double evidence prefix');
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
    await writeFile(path.join(skillDir, 'SKILL.md'), '# Verified Skill\nExecution policy requires explicit approval.');

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
    const skillContent = '# Verified Skill\nExecution policy requires explicit approval.';
    const skillHash = crypto.createHash('sha256').update(skillContent).digest('hex');
    const customSnapshot = {
      auditFingerprint: manifest.auditFingerprint,
      createdAt: new Date().toISOString(),
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
      skillInsights: [
        {
          id: 'test-insight-1',
          scope: 'skill',
          subject: { skillId: 'verified-skill' },
          title: '执行策略具备强硬约束',
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
          confidence: 'high',
          evidence: [
            { kind: 'skill_metric', metric: 'calls' },
            { kind: 'skill_content', skillId: 'verified-skill', role: 'hardConstraint', loadingScope: 'always', evidenceExcerpt: 'Execution policy requires explicit approval.' }
          ]
        }
      ]
    });

    const composed = await runCli([
      'report-run', 'compose',
      '--run-dir', runDir,
      '--locale', 'zh-CN',
      '--html', htmlPath
    ], { CODEX_HOME: tmp }, aiEnvelope);

    assert.equal(composed.code, 0, composed.stderr);
    const html = await readFile(htmlPath, 'utf8');
    assert.ok(html.includes('<section class="skill-insights">'), 'Composed HTML must contain skill-insights section');
    assert.ok(html.includes('执行策略具备强硬约束'), 'Composed HTML must contain insight title');
    assert.ok(html.includes('Execution policy requires explicit approval.'), 'Composed HTML must contain verified excerpt');
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
