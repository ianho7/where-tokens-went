const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { validateSkillInsights } = require('../dist/src/skill-insights.js');
const { gradeLaneOutput } = require('../dist/src/eval-lab.js');

const snapshot = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '..', 'evals', 'fixtures', 'skill-insights-snapshot-real-aha-v1.json'),
  'utf8',
));

function makeFamilyInsight(interpretation) {
  return {
    snapshotId: snapshot.snapshotId,
    insights: [{
      id: 'family-boundary',
      kind: 'usage',
      candidateType: 'high_usage_strong_delta',
      scope: 'family',
      subject: { familyId: 'where-tokens-went-family' },
      title: '命名家族首先是使用拓扑',
      reveal: {
        semantic: '调用入口呈现命名家族拓扑，而非均匀分散的使用结构',
        pattern: 'family_concentration',
        evidenceRefs: [
          'family:where-tokens-went-family:callShare',
          'family:where-tokens-went-family:totalCalls',
          'global:totalSkillCalls',
        ],
      },
      mentalModelShift: {
        surface: '这些入口可以直接按名称当成同一种东西。',
        observed: '调用拓扑可以按名称聚合观察，但能力关系仍需内容证据。',
      },
      decisionDelta: {
        before: '按名称直接合并成员的维护判断。',
        after: '先观察命名拓扑，再分别核验成员内容。',
      },
      observation: '成员在调用图中形成命名家族结构。',
      contrast: '命名家族的调用集中形态改变了对入口分布的直觉。',
      interpretation,
      consequence: '把命名家族作为拓扑对象观察，不把它直接当成能力结论。',
      confidence: 'high',
      evidence: [
        { kind: 'family_metric', familyId: 'where-tokens-went-family', metric: 'callShare' },
        { kind: 'family_metric', familyId: 'where-tokens-went-family', metric: 'totalCalls' },
        { kind: 'global_metric', metric: 'totalSkillCalls' },
      ],
    }],
  };
}

function makeCapabilityInsight() {
  return {
    id: 'local-harness-contract',
    kind: 'capability',
    candidateType: 'high_usage_strong_delta',
    scope: 'skill',
    subject: { skillId: 'where-tokens-went' },
    title: '本地 Harness 契约是独特价值',
    reveal: {
      semantic: '本地运行约束与通用响应脚手架承担不同角色',
      pattern: 'content_contrast',
      evidenceRefs: [
        'content:where-tokens-went:hardConstraint',
        'content:where-tokens-went:genericProcedure',
        'skill:where-tokens-went:calls',
      ],
    },
    claimStrength: 'coexistence',
    mentalModelShift: {
      surface: '这个入口主要提供通用的分析组织方式。',
      observed: '它还承担当前 Harness 与本地工具边界，通用组织方式只是并存内容。',
    },
    decisionDelta: {
      before: '优先删减整份 Skill 的分析组织内容。',
      after: '先保护本地 Harness 和工具边界，再独立评估通用脚手架。',
    },
    observation: '同一个入口同时包含本地 Harness 约束和通用响应组织。',
    contrast: '内容证据把本地硬约束与通用程序分开。',
    interpretation: '可证明的独特价值集中在本地运行契约。',
    counterfactual: {
      ifRemoved: '移除整个 Skill 会失去本地 Harness 与工具边界。',
      withoutGenericScaffold: '移除通用脚手架后，本地运行契约仍然保留。',
    },
    consequence: '把本地边界作为不可替代内容单独维护。',
    confidence: 'high',
    evidence: [
      { kind: 'skill_metric', metric: 'calls', skillId: 'where-tokens-went' },
      {
        kind: 'skill_content',
        skillId: 'where-tokens-went',
        role: 'hardConstraint',
        loadingScope: 'always',
        evidenceExcerpt: 'The invoking Harness is the current Host: use `codex` when running inside Codex and `claude` when running inside Claude Code. Do not inspect the other Harness in response to a request.',
      },
      {
        kind: 'skill_content',
        skillId: 'where-tokens-went',
        role: 'genericProcedure',
        loadingScope: 'always',
        evidenceExcerpt: 'Structure the response as Finding, Evidence, mechanism, action when justified, and material uncertainty without fixed wording.',
      },
    ],
  };
}

function makeTokenScaleInsight(interpretation) {
  return {
    snapshotId: snapshot.snapshotId,
    insights: [{
      id: 'token-scale-boundary',
      kind: 'usage',
      scope: 'cross_skill',
      title: '使用分布需要保留证据边界',
      reveal: {
        semantic: '调用频率与任务规模不是同一个观察维度',
        pattern: 'share_inversion',
        evidenceRefs: ['global:lowFrequencySkillShare', 'global:lowFrequencyCallShare'],
      },
      mentalModelShift: {
        surface: '使用入口看起来分散在不同 Skill 上。',
        observed: '任务规模相关结论在当前 Snapshot 中保持未知。',
      },
      decisionDelta: {
        before: '只按调用频率排序维护优先级。',
        after: '当前没有关联证据时，把任务规模判断保留为未知。',
      },
      observation: '使用分布提供了一个待核验的方向。',
      contrast: '调用分布本身不能替代任务规模证据。',
      interpretation,
      consequence: '没有关联 Token 证据时保留未知，不把频率当作规模代理。',
      confidence: 'high',
      evidence: [
        { kind: 'global_metric', metric: 'lowFrequencySkillShare' },
        { kind: 'global_metric', metric: 'lowFrequencyCallShare' },
      ],
    }],
  };
}

test('leaves open family and shared-topology wording to quality review', () => {
  for (const interpretation of [
    'The family label explains where calls cluster.',
    'The observed pattern is shared routing or entry topology.',
    'Aggregate usage does not establish shared capability or causal routing.',
  ]) {
    const result = validateSkillInsights(makeFamilyInsight(interpretation), snapshot);
    assert.equal(result.insights.length, 1, `${interpretation}: ${result.errors.join('; ')}`);
  }
});

test('does not treat family call-count aggregation as associated Session Token aggregation', () => {
  const raw = makeFamilyInsight('The family aggregate and total call counts describe routing topology, not member capability.');
  raw.insights[0].subject = {
    familyId: 'where-tokens-went-family',
    skillIds: ['where-tokens-went', 'where-tokens-went-codex', 'where-tokens-went-claude'],
  };

  const result = validateSkillInsights(raw, snapshot);
  assert.equal(result.insights.length, 1, result.errors.join('; '));
  assert.deepEqual(result.errors, []);
});

test('rejects a structured family Capability card without two members of content evidence', () => {
  const raw = {
    snapshotId: snapshot.snapshotId,
    insights: [{
      ...makeCapabilityInsight(),
      scope: 'family',
      subject: { familyId: 'where-tokens-went-family' },
      familyDifferences: [],
    }],
  };
  const result = validateSkillInsights(raw, snapshot);
  assert.equal(result.insights.length, 0);
  assert.match(result.errors.join('\n'), /at least two Skills/);
});

test('keeps distinct capability and family-topology Ahas from the same family', () => {
  const family = makeFamilyInsight('名称本身不足以证明成员具有共同能力。');
  const result = validateSkillInsights({
    snapshotId: snapshot.snapshotId,
    insights: [makeCapabilityInsight(), family.insights[0]],
  }, snapshot);
  assert.deepEqual(result.insights.map((insight) => insight.id), [
    'local-harness-contract',
    'family-boundary',
  ]);
  assert.deepEqual(result.errors, []);
});

test('rejects unsupported frequency-to-task-scale claims without associated-token evidence', () => {
  const result = validateSkillInsights(makeTokenScaleInsight('低频 Skill 也可能出现在大任务中。'), snapshot);
  assert.equal(result.insights.length, 0);
  assert.match(result.errors.join('\n'), /associated-token evidence|unknown boundary/);
});

test('accepts an explicit unknown boundary for missing associated-token evidence', () => {
  for (const interpretation of [
    '当前 Snapshot 缺少关联 Token 证据，不能由调用频率推断任务规模。',
    '低频 Skill 与大任务的关系未知。',
    '低频 Skill 与大任务的关系不确定。',
  ]) {
    const result = validateSkillInsights(makeTokenScaleInsight(interpretation), snapshot);
    assert.equal(result.insights.length, 1, `${interpretation}: ${result.errors.join('; ')}`);
  }
});

test('accepts a qualified frequency-to-Session-scale claim only with the named associatedSessionTokens evidence', () => {
  const qualifiedSnapshot = JSON.parse(JSON.stringify(snapshot));
  const candidate = qualifiedSnapshot.selectedCandidates.find((entry) => entry.skillName === 'where-tokens-went');
  candidate.signals.associatedSessionTokens = 123456;
  qualifiedSnapshot.globalUsage.associatedSessionTokenCount = 2;
  qualifiedSnapshot.globalUsage.associatedSessionTokenP75 = 1000;

  const raw = makeTokenScaleInsight('低频 Skill 也出现在 Token 规模更大的关联 Session 中。');
  raw.insights[0].subject = { skillId: 'where-tokens-went' };
  raw.insights[0].mentalModelShift.observed = '调用频率与关联 Session 的 Token 规模是两个需要分别读取的维度。';
  raw.insights[0].decisionDelta.after = '同时引用关联 Session Token 指标，再判断低频 Skill 所在任务的规模。';
  raw.insights[0].evidence.push({ kind: 'skill_metric', metric: 'associatedSessionTokens', skillId: 'where-tokens-went' });
  raw.insights[0].evidence.push({ kind: 'global_metric', metric: 'associatedSessionTokenP75' });
  raw.insights[0].reveal.evidenceRefs.push('skill:where-tokens-went:associatedSessionTokens');

  const result = validateSkillInsights(raw, qualifiedSnapshot);
  assert.equal(result.insights.length, 1, result.errors.join('; '));
});

test('rejects adding associated Session Tokens across Skills', () => {
  const qualifiedSnapshot = JSON.parse(JSON.stringify(snapshot));
  const first = qualifiedSnapshot.selectedCandidates.find((entry) => entry.skillName === 'where-tokens-went');
  const second = qualifiedSnapshot.selectedCandidates.find((entry) => entry.skillName === 'kami');
  first.signals.associatedSessionTokens = 123456;
  second.signals.associatedSessionTokens = 654321;
  qualifiedSnapshot.globalUsage.associatedSessionTokenCount = 2;
  qualifiedSnapshot.globalUsage.associatedSessionTokenP75 = 1000;

  const raw = makeTokenScaleInsight('两个 Skill 的关联 Session Token 总和代表共同承担的任务规模。');
  raw.insights[0].subject = { skillIds: ['where-tokens-went', 'kami'] };
  raw.insights[0].evidence.push(
    { kind: 'skill_metric', metric: 'associatedSessionTokens', skillId: 'where-tokens-went' },
    { kind: 'skill_metric', metric: 'associatedSessionTokens', skillId: 'kami' },
    { kind: 'global_metric', metric: 'associatedSessionTokenP75' },
  );

  const result = validateSkillInsights(raw, qualifiedSnapshot);
  assert.equal(result.insights.length, 0);
  assert.match(result.errors.join('\n'), /cannot be added or aggregated/);
});

test('rejects cross-Skill Token aggregation when one referenced Skill metric is missing', () => {
  const qualifiedSnapshot = JSON.parse(JSON.stringify(snapshot));
  const first = qualifiedSnapshot.selectedCandidates.find((entry) => entry.skillName === 'where-tokens-went');
  first.signals.associatedSessionTokens = 123456;
  qualifiedSnapshot.globalUsage.associatedSessionTokenCount = 2;
  qualifiedSnapshot.globalUsage.associatedSessionTokenP75 = 1000;

  const raw = makeTokenScaleInsight('两个 Skill 的关联 Session Token 总和代表共同承担的任务规模。');
  raw.insights[0].subject = { skillIds: ['where-tokens-went', 'kami'] };
  raw.insights[0].evidence.push(
    { kind: 'skill_metric', metric: 'associatedSessionTokens', skillId: 'where-tokens-went' },
    { kind: 'global_metric', metric: 'associatedSessionTokenP75' },
  );

  const result = validateSkillInsights(raw, qualifiedSnapshot);
  assert.equal(result.insights.length, 0);
  assert.match(result.errors.join('\n'), /cannot be added or aggregated/);
});

test('rejects causal frequency-to-Session-scale claims even when associatedSessionTokens exists', () => {
  const qualifiedSnapshot = JSON.parse(JSON.stringify(snapshot));
  const candidate = qualifiedSnapshot.selectedCandidates.find((entry) => entry.skillName === 'where-tokens-went');
  candidate.signals.associatedSessionTokens = 123456;
  qualifiedSnapshot.globalUsage.associatedSessionTokenCount = 2;
  qualifiedSnapshot.globalUsage.associatedSessionTokenP75 = 1000;

  const raw = makeTokenScaleInsight('这个低频 Skill 导致了大任务 Token。');
  raw.insights[0].subject = { skillId: 'where-tokens-went' };
  raw.insights[0].evidence.push({ kind: 'skill_metric', metric: 'associatedSessionTokens', skillId: 'where-tokens-went' });
  raw.insights[0].evidence.push({ kind: 'global_metric', metric: 'associatedSessionTokenP75' });
  raw.insights[0].reveal.evidenceRefs.push('skill:where-tokens-went:associatedSessionTokens');

  const result = validateSkillInsights(raw, qualifiedSnapshot);
  assert.equal(result.insights.length, 0);
  assert.match(result.errors.join('\n'), /causal|prompt-injection/i);
});

test('rejects causal frequency-to-Session-scale claims in Reveal and decision prose', () => {
  for (const [index, mutate] of [
    (insight) => { insight.reveal.semantic = '这个低频 Skill 导致了大任务 Token。'; },
    (insight) => { insight.mentalModelShift.observed = '这个低频 Skill 导致了大任务 Token。'; },
    (insight) => { insight.decisionDelta.after = '按这个低频 Skill 导致的大任务 Token 调整优先级。'; },
  ].entries()) {
    const qualifiedSnapshot = JSON.parse(JSON.stringify(snapshot));
    const candidate = qualifiedSnapshot.selectedCandidates.find((entry) => entry.skillName === 'where-tokens-went');
    candidate.signals.associatedSessionTokens = 123456;
    qualifiedSnapshot.globalUsage.associatedSessionTokenCount = 2;
    qualifiedSnapshot.globalUsage.associatedSessionTokenP75 = 1000;

    const raw = makeTokenScaleInsight('调用频率与关联 Session 的 Token 规模是两个需要分别读取的维度。');
    raw.insights[0].subject = { skillId: 'where-tokens-went' };
    mutate(raw.insights[0]);
    raw.insights[0].evidence.push(
      { kind: 'skill_metric', metric: 'associatedSessionTokens', skillId: 'where-tokens-went' },
      { kind: 'global_metric', metric: 'associatedSessionTokenP75' },
    );

    const result = validateSkillInsights(raw, qualifiedSnapshot);
    assert.equal(result.insights.length, 0, `case ${index}: ${result.errors.join('; ')}`);
    assert.match(result.errors.join('\n'), /causal|prompt-injection/i, `case ${index}: ${result.errors.join('; ')}`);
  }
});

test('rejects direct affirmative causal assertions and leaves qualified prose alone', () => {
  const qualifiedSnapshot = JSON.parse(JSON.stringify(snapshot));
  const candidate = qualifiedSnapshot.selectedCandidates.find((entry) => entry.skillName === 'where-tokens-went');
  candidate.signals.associatedSessionTokens = 123456;
  qualifiedSnapshot.globalUsage.associatedSessionTokenCount = 2;
  qualifiedSnapshot.globalUsage.associatedSessionTokenP75 = 1000;

  const makeRaw = (interpretation) => {
    const raw = makeTokenScaleInsight(interpretation);
    raw.insights[0].subject = { skillId: 'where-tokens-went' };
    raw.insights[0].evidence.push(
      { kind: 'skill_metric', metric: 'associatedSessionTokens', skillId: 'where-tokens-went' },
      { kind: 'global_metric', metric: 'associatedSessionTokenP75' },
    );
    raw.insights[0].reveal.evidenceRefs.push('skill:where-tokens-went:associatedSessionTokens');
    return raw;
  };

  const qualified = validateSkillInsights(makeRaw('The snapshot does not establish whether this Skill caused the usage.'), qualifiedSnapshot);
  assert.equal(qualified.insights.length, 1, qualified.errors.join('; '));

  const positive = validateSkillInsights(makeRaw('This Skill causes the observed task-scale Token usage.'), qualifiedSnapshot);
  assert.equal(positive.insights.length, 0);
  assert.match(positive.errors.join('\n'), /causal|prompt-injection/i);

  const injection = validateSkillInsights(makeRaw('The snapshot does not establish whether the complete SKILL.md was repeatedly injected.'), qualifiedSnapshot);
  assert.equal(injection.insights.length, 1, injection.errors.join('; '));

  const directInjection = validateSkillInsights(makeRaw('The complete SKILL.md is repeatedly injected into every task.'), qualifiedSnapshot);
  assert.equal(directInjection.insights.length, 0);
  assert.match(directInjection.errors.join('\n'), /causal|prompt-injection/i);
});

test('does not treat tokens in a Skill name as Session Token scale', () => {
  const raw = makeFamilyInsight('Aggregate usage does not establish shared capability or causal routing.');
  raw.insights[0].subject = {
    familyId: 'where-tokens-went-family',
    skillIds: ['where-tokens-went', 'where-tokens-went-codex', 'where-tokens-went-claude'],
  };
  raw.insights[0].observation = 'The where-tokens-went-family naming family is the observed usage topology.';

  const result = validateSkillInsights(raw, snapshot);
  assert.equal(result.insights.length, 1, result.errors.join('; '));
});

test('Runtime and lane Eval retain the same valid cards and record rejected-card diagnostics', () => {
  const valid = makeCapabilityInsight();
  const invalid = { ...makeCapabilityInsight(), id: 'discarded-card', title: 'Discarded card', evidence: [] };
  const raw = { snapshotId: snapshot.snapshotId, insights: [valid, invalid] };
  const runtimeResult = validateSkillInsights(raw, snapshot);
  const evalResult = gradeLaneOutput({ lane: 'skill-insights', id: 'fixture', inputHash: 'fixture-input' }, snapshot, raw);

  assert.equal(runtimeResult.valid, true);
  assert.deepEqual(runtimeResult.insights.map((insight) => insight.id), ['local-harness-contract']);
  assert.equal(evalResult.status, 'passed');
  assert.equal(evalResult.errors.length, runtimeResult.errors.length);

  const emptyRaw = { snapshotId: snapshot.snapshotId, insights: [invalid] };
  const emptyRuntime = validateSkillInsights(emptyRaw, snapshot);
  const emptyEval = gradeLaneOutput({ lane: 'skill-insights', id: 'fixture', inputHash: 'fixture-input' }, snapshot, emptyRaw);
  assert.equal(emptyRuntime.valid, false);
  assert.equal(emptyEval.status, 'blocked');
});

test('allows ambiguous impact wording to reach quality review but blocks a direct causal claim', () => {
  const ambiguous = validateSkillInsights(makeFamilyInsight('This Skill impacted the observed calls.'), snapshot);
  assert.equal(ambiguous.insights.length, 1, ambiguous.errors.join('; '));

  const direct = validateSkillInsights(makeFamilyInsight('The family causes the calls.'), snapshot);
  assert.equal(direct.insights.length, 0);
  assert.match(direct.errors.join('\n'), /causal|prompt-injection/i);
});

test('does not treat high-impact as an unconditional causal assertion', () => {
  const result = validateSkillInsights(makeFamilyInsight('A high-impact Skill is the observed usage destination.'), snapshot);
  assert.equal(result.insights.length, 1, result.errors.join('; '));
});

test('rejects literal numeric prose in family differences', () => {
  const raw = makeFamilyInsight('The named family is an observed usage topology.');
  raw.insights[0].familyDifferences = ['Member 2 has a different platform environment.'];
  const result = validateSkillInsights(raw, snapshot);
  assert.equal(result.insights.length, 0);
  assert.match(result.errors.join('\n'), /free prose must not contain copied or derived quantitative claims/);
});
