const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  validateSkillInsights,
  calculateSkillSnapshotBudget,
  SKILL_CONTENT_BUDGET_TOKENS,
} = require('../dist/src/skill-insights.js');

const mockSnapshot = {
  snapshotId: 'test-snapshot',
  auditFingerprint: 'test-fingerprint',
  createdAt: '2026-09-18T00:00:00.000Z',
  distributionContext: { median: 1.0, p75: 1.5, p90: 2.5, max: 10.28 },
  globalUsage: {
    totalSkillsUsed: 35,
    totalSkillCalls: 461,
    totalTasks: 128,
    callsPerTaskDistribution: { median: 1.0, p75: 1.5, p90: 2.5, max: 10.28 },
    top4CallShare: 0.7007,
    lowFrequencySkillCount: 20,
    lowFrequencyCallCount: 42,
    lowFrequencySkillShare: 0.5714,
    lowFrequencyCallShare: 0.0911,
    singleUseSkillShare: 0.3429,
    dominantFamily: {
      groupId: 'where-tokens-went',
      memberSkillIds: ['where-tokens-went-codex', 'where-tokens-went-claude'],
      callShare: 0.423
    },
    familyMetrics: [
      {
        groupId: 'where-tokens-went',
        memberSkillIds: ['where-tokens-went', 'where-tokens-went-codex', 'where-tokens-went-claude'],
        totalCalls: 193,
        totalTasks: 30,
        callShare: 0.423,
        memberCount: 3,
      }
    ],
  },
  selectedCandidates: [
    {
      skillId: 'core-skill',
      skillName: 'core-skill',
      candidateTypes: ['high_frequency'],
      signals: { calls: 120, tasks: 12, callShare: 0.4, callsPerTask: 10.28, familyGroup: 'where-tokens-went' }
    }
  ],
  selectedSkills: [
    {
      skillId: 'core-skill',
      skillName: 'core-skill',
      skillPath: '/path/core-skill/SKILL.md',
      contentState: 'available',
      skillMdBytes: 1000,
      skillMdEstimatedTokens: 278,
      skillMdHash: 'abc',
      skillMdContent: '# Core Skill\nAlways check repository state before running commands.\nFollow repo conventions.\nGeneric procedure: summarize the task before editing.',
      referenceCount: 0,
      referenceBytes: 0,
      referenceFiles: [],
    }
  ]
};

test('Evidence Gate accepts Systemic Insight with mentalModelShift and resolved global metric', () => {
  const raw = {
    snapshotId: mockSnapshot.snapshotId,
    insights: [
      {
        id: 'systemic-1',
        scope: 'global',
        title: '表面分散，实际工作流高度收敛于小核心',
        reveal: {
          semantic: '长尾的数量印象与实际调用重心并不一致',
          pattern: 'share_inversion',
          evidenceRefs: ['global:top4CallShare', 'global:lowFrequencySkillShare', 'global:lowFrequencyCallShare'],
        },
        mentalModelShift: {
          surface: '我正在同时重度使用一组不同的能力工具',
          observed: '调用集中在少数核心，剩余部分主要是低频偶发项'
        },
        decisionDelta: {
          before: '所有 Skill 按同一优先级维护',
          after: '核心 Skill 优先维护，长尾 Skill 按需维护',
        },
        observation: '少数高频项承担了主要调用，低频项形成明显长尾。',
        contrast: '低频项的数量占比与调用贡献并不匹配。',
        interpretation: 'Skill 数量虚高了系统复杂度，实际日常工作流已经自然收敛。',
        consequence: '优先维护核心层，长尾偶发项保持按需查阅即可。',
        confidence: 'high',
        evidence: [
          { kind: 'global_metric', metric: 'top4CallShare' },
          { kind: 'global_metric', metric: 'lowFrequencySkillShare' },
          { kind: 'global_metric', metric: 'lowFrequencyCallShare' }
        ]
      }
    ]
  };

  const res = validateSkillInsights(raw, mockSnapshot);
  assert.equal(res.valid, true);
  assert.equal(res.insights.length, 1);
  assert.equal(res.insights[0].id, 'systemic-1');
  assert.equal(res.insights[0].scope, 'global');
  assert.equal(res.insights[0].evidence[0].value, 0.7007, 'Should resolve deterministic metric value');
  assert.equal(res.insights[0].evidence[1].value, 0.5714, 'Should resolve deterministic metric value');
  assert.equal(res.insights[0].evidence[2].value, 0.0911, 'Should resolve deterministic metric value');
});

test('Evidence Gate rejects Skill Insights from a different immutable snapshot', () => {
  const result = validateSkillInsights({
    snapshotId: 'different-snapshot',
    insights: [],
  }, mockSnapshot);

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /snapshotId/i);
});

test('Evidence Gate rejects quantitative relationships copied into free prose', () => {
  const result = validateSkillInsights({
    snapshotId: mockSnapshot.snapshotId,
    insights: [{
      id: 'numeric-prose',
      scope: 'global',
      title: '调用集中',
      reveal: {
        semantic: '调用集中在少数核心',
        pattern: 'share_inversion',
        evidenceRefs: ['global:lowFrequencySkillShare', 'global:lowFrequencyCallShare'],
      },
      mentalModelShift: { surface: '能力看起来均匀', observed: '实际调用集中' },
      decisionDelta: { before: '统一维护', after: '核心优先维护' },
      observation: '超过一半的 Skill 只承担少量调用。',
      contrast: '低频调用占比很小。',
      interpretation: '系统形成核心加长尾结构。',
      confidence: 'high',
      evidence: [
        { kind: 'global_metric', metric: 'lowFrequencySkillShare' },
        { kind: 'global_metric', metric: 'lowFrequencyCallShare' },
      ],
    }],
  }, mockSnapshot);

  assert.equal(result.insights.length, 0);
  assert.match(result.errors.join('\n'), /free prose/i);
});

test('Evidence Gate accepts a content contrast without quantitative metrics', () => {
  const result = validateSkillInsights({
    snapshotId: mockSnapshot.snapshotId,
    insights: [{
      id: 'content-only',
      kind: 'capability',
      scope: 'skill',
      subject: { skillId: 'core-skill' },
      title: '执行边界与流程需要分开治理',
      reveal: {
        semantic: '执行边界与项目事实承担不同加载角色',
        pattern: 'content_contrast',
        evidenceRefs: ['skill:core-skill:calls', 'content:core-skill:localFact', 'content:core-skill:genericProcedure'],
      },
      mentalModelShift: { surface: '整份文档都需要同样加载', observed: '不同内容承担不同加载角色' },
      decisionDelta: { before: '整份文档一起治理', after: '先保留边界，再单独审查流程' },
      observation: '文档同时包含执行边界与项目事实。',
      contrast: '直接内容证据显示两类内容承担不同角色。',
      interpretation: '加载策略应区分内容角色。',
      counterfactual: { ifRemoved: '删除整个 Skill 会失去项目事实。', withoutGenericScaffold: '删除通用脚手架后仍保留项目事实。' },
      confidence: 'high',
      evidence: [{
        kind: 'skill_metric',
        skillId: 'core-skill',
        metric: 'calls',
      }, {
        kind: 'skill_content',
        skillId: 'core-skill',
        role: 'localFact',
        loadingScope: 'always',
        evidenceExcerpt: 'Always check repository state before running commands.',
      }, {
        kind: 'skill_content',
        skillId: 'core-skill',
        role: 'genericProcedure',
        loadingScope: 'task_scoped',
        evidenceExcerpt: 'Generic procedure: summarize the task before editing.',
      }],
    }],
  }, mockSnapshot);

  assert.equal(result.insights.length, 1);
});

test('Evidence Gate accepts valid 2-axis content insight with verbatim excerpt', () => {
  const raw = {
    snapshotId: mockSnapshot.snapshotId,
    insights: [
      {
        id: 'node-1',
        scope: 'skill',
        subject: { skillId: 'core-skill' },
        title: '核心指导提供关键环境硬约束',
        reveal: {
          semantic: '这个 Skill 的任务调用形态明显偏离普通 Skill',
          pattern: 'distribution_outlier',
          evidenceRefs: ['distribution:median', 'skill:core-skill:callsPerTask'],
        },
        mentalModelShift: {
          surface: '它只是一次性的普通入口',
          observed: '它的调用行为明显偏离普通 Skill，需要单独核查',
        },
        decisionDelta: {
          before: '按普通说明处理',
          after: '先保留硬约束，再单独检查其高频行为',
        },
        observation: '该 Skill 在相关任务中频次高，提供了必须保持前置检查的具体约束。',
        contrast: '它的任务调用形态明显偏离全体分布基线。',
        interpretation: '它并非单次任务入口，而是贯穿任务生命周期的伴随型约束。',
        consequence: '保留前置检查协议，精简时只裁剪通用流程脚手架。',
        confidence: 'high',
        evidence: [
          { kind: 'distribution_metric', metric: 'median' },
          { kind: 'skill_metric', skillId: 'core-skill', metric: 'callsPerTask' },
          {
            kind: 'skill_content',
            skillId: 'core-skill',
            role: 'hardConstraint',
            loadingScope: 'always',
            evidenceExcerpt: 'Always check repository state before running commands.',
          }
        ]
      }
    ]
  };

  const res = validateSkillInsights(raw, mockSnapshot);
  assert.equal(res.valid, true);
  assert.equal(res.insights.length, 1);
  assert.equal(res.insights[0].evidence[0].value, 1.0, 'Should resolve distribution metric');
  assert.equal(res.insights[0].evidence[1].value, 10.28, 'Should resolve candidate calls-per-task metric');
});

test('Evidence Gate rejects insights missing required core elements', () => {
  const missingContrast = {
    insights: [
      {
        id: 'incomplete-1',
        scope: 'skill',
        title: '缺失对比',
        observation: '调用了很多次。',
        contrast: '', // Missing!
        interpretation: '这很重要。',
        consequence: '需要优化。',
        confidence: 'high',
        evidence: [{ kind: 'distribution_metric', metric: 'median' }]
      }
    ]
  };

  const res = validateSkillInsights(missingContrast, mockSnapshot);
  assert.equal(res.insights.length, 0, 'Must reject insight with missing contrast');
});

test('Evidence Gate rejects a structurally complete insight without a decision delta', () => {
  const result = validateSkillInsights({
    snapshotId: mockSnapshot.snapshotId,
    insights: [{
      id: 'missing-decision-delta',
      scope: 'global',
      title: '结构完整但没有决策变化',
      reveal: {
        semantic: '调用结构集中在少数核心',
        pattern: 'share_inversion',
        evidenceRefs: ['global:top4CallShare', 'global:lowFrequencyCallShare'],
      },
      mentalModelShift: { surface: '看起来很分散', observed: '调用集中在少数 Skill' },
      observation: '调用集中在少数 Skill。',
      contrast: '前四项承担了主要调用。',
      interpretation: '系统呈现核心加长尾结构。',
      consequence: '继续观察。',
      confidence: 'high',
      evidence: [
        { kind: 'global_metric', metric: 'top4CallShare' },
        { kind: 'global_metric', metric: 'lowFrequencyCallShare' },
      ],
    }],
  }, mockSnapshot);

  assert.equal(result.insights.length, 0);
  assert.match(result.errors.join('\n'), /decision delta/i);
});

test('Evidence Gate requires two content members for a direct family-semantic claim', () => {
  const result = validateSkillInsights({
    snapshotId: mockSnapshot.snapshotId,
    insights: [{
      id: 'family-semantic-without-content',
      scope: 'family',
      subject: { familyId: 'where-tokens-went' },
      title: '多个变体共享同一能力核心',
      reveal: {
        semantic: '多个名字变体可能围绕同一个能力核心',
        pattern: 'family_concentration',
        evidenceRefs: ['family:where-tokens-went:callShare', 'family:where-tokens-went:totalCalls', 'global:totalSkillCalls'],
      },
      mentalModelShift: { surface: '四个名字代表四种能力', observed: '它们可能共享一个能力核心' },
      decisionDelta: { before: '按四个独立 Skill 维护', after: '先按一个能力家族审计' },
      observation: '多个变体共享同一能力核心。',
      contrast: '家族与其他命名组呈现不同分布。',
      interpretation: '这些变体共享同一能力核心。',
      consequence: '合并审计范围。',
      confidence: 'high',
      evidence: [
        { kind: 'family_metric', familyId: 'where-tokens-went', metric: 'callShare' },
        { kind: 'family_metric', familyId: 'where-tokens-went', metric: 'totalCalls' },
        { kind: 'global_metric', metric: 'totalSkillCalls' },
      ],
    }],
  }, mockSnapshot);

  assert.equal(result.insights.length, 0);
  assert.match(result.errors.join('\n'), /at least two Skills/i);
});

test('Evidence Gate keeps only one redundant family or Skill insight', () => {
  const makeInsight = (id, scope, title) => ({
    id,
    scope,
    subject: scope === 'family' ? { familyId: 'where-tokens-went' } : { skillId: 'core-skill' },
    title,
    reveal: {
      semantic: '同一家族的调用结构值得单独理解',
      pattern: 'family_concentration',
      evidenceRefs: ['family:where-tokens-went:callShare', 'family:where-tokens-went:totalCalls', 'global:totalSkillCalls'],
    },
    mentalModelShift: { surface: '每张卡都代表独立能力', observed: '同一家族的卡片解释了同一结构' },
    decisionDelta: { before: '分别维护每张卡', after: '只保留一条家族级行动' },
    observation: '同一家族出现高频调用。',
    contrast: '它与全体调用结构呈现明显差异。',
    interpretation: '这揭示了家族层面的集中。',
    consequence: '按家族优先维护。',
    confidence: 'high',
    evidence: [
      { kind: 'family_metric', familyId: 'where-tokens-went', metric: 'callShare' },
      { kind: 'family_metric', familyId: 'where-tokens-went', metric: 'totalCalls' },
      { kind: 'global_metric', metric: 'totalSkillCalls' },
    ],
  });
  const result = validateSkillInsights({
    snapshotId: mockSnapshot.snapshotId,
    insights: [
      makeInsight('family-one', 'family', '家族调用集中'),
      makeInsight('skill-one', 'skill', '成员调用集中'),
    ],
  }, mockSnapshot);

  assert.equal(result.insights.length, 1);
  assert.ok(result.unsupportedClaimsDropped >= 1);
});

test('Evidence Gate requires both semantic-role excerpts for a mixed claim', () => {
  const result = validateSkillInsights({
    snapshotId: mockSnapshot.snapshotId,
    insights: [{
      id: 'mixed-role-with-one-side',
      kind: 'capability',
      scope: 'skill',
      subject: { skillId: 'core-skill' },
      title: '严格硬约束与通用流程放在同一层',
      reveal: {
        semantic: '严格约束与通用流程承担不同加载角色',
        pattern: 'content_contrast',
        evidenceRefs: ['content:core-skill'],
      },
      mentalModelShift: { surface: '整份内容都同样关键', observed: '硬约束与通用流程承担不同角色' },
      decisionDelta: { before: '整份内容一起维护', after: '先保留硬约束，再单独治理通用流程' },
      observation: '该 Skill 同时包含严格硬约束与通用流程。',
      contrast: '硬约束必须前置，而通用流程不需要同样的加载范围。',
      interpretation: '两类内容不能用同一加载策略治理。',
      consequence: '先分别核对两类内容。',
      counterfactual: { ifRemoved: '删除会失去硬约束。', withoutGenericScaffold: '未知。' },
      confidence: 'high',
      evidence: [{
        kind: 'skill_metric',
        skillId: 'core-skill',
        metric: 'calls',
      }, {
        kind: 'skill_content',
        skillId: 'core-skill',
        role: 'hardConstraint',
        loadingScope: 'always',
        evidenceExcerpt: 'Always check repository state before running commands.',
      }],
    }],
  }, mockSnapshot);

  assert.equal(result.insights.length, 0);
  assert.match(result.errors.join('\n'), /both roles|model-native counterevidence/i);
});

test('Evidence Gate blocks unconditional causality, but allows conditional hypothesis with missing evidence stated', () => {
  // 1. Unconditional causal claim -> REJECT
  const directCausal = {
    snapshotId: mockSnapshot.snapshotId,
    insights: [
      {
        id: 'direct-causal',
        scope: 'skill',
        title: '导致严重浪费',
        reveal: {
          semantic: '这个 Skill 的任务调用形态明显偏离普通 Skill',
          pattern: 'distribution_outlier',
          evidenceRefs: ['distribution:median', 'skill:core-skill:callsPerTask'],
        },
        subject: { skillId: 'core-skill' },
        observation: 'Skill 调用频繁。',
        contrast: '它偏离全体任务调用基线。',
        interpretation: '这个 Skill 导致了大量的 Token 消耗与成本浪费。',
        consequence: '立即整改。',
        confidence: 'high',
        evidence: [
          { kind: 'distribution_metric', metric: 'median' },
          { kind: 'skill_metric', skillId: 'core-skill', metric: 'callsPerTask' },
        ]
      }
    ]
  };
  const res1 = validateSkillInsights(directCausal, mockSnapshot);
  assert.equal(res1.insights.length, 0, 'Unconditional causal assertion must be rejected');

  // 2. Conditional hypothesis with missing evidence stated -> ACCEPT
  const conditionalCausal = {
    snapshotId: mockSnapshot.snapshotId,
    insights: [
      {
        id: 'conditional-causal',
        scope: 'skill',
        title: '高频调用具备潜在上下文放大风险',
        reveal: {
          semantic: '这个 Skill 的任务调用形态明显偏离普通 Skill',
          pattern: 'distribution_outlier',
          evidenceRefs: ['distribution:median', 'skill:core-skill:callsPerTask'],
        },
        subject: { skillId: 'core-skill' },
        mentalModelShift: {
          surface: '高频 Skill 应该就是重复注入了正文',
          observed: '当前只能确认它是调用次数离群，注入机制仍未知',
        },
        decisionDelta: {
          before: '先改 Prompt',
          after: '先检查真实触发序列',
        },
        observation: '该 Skill 在相关任务中反复出现。',
        contrast: '它明显偏离全体任务调用分布。',
        interpretation: '如果每次调用伴随完整正文注入，则可能放大上下文成本；当前缺少直接注入 trace 证据，下一步建议核查真实加载机制。',
        consequence: '核查任务内的加载行为。',
        confidence: 'high',
        evidence: [
          { kind: 'distribution_metric', metric: 'median' },
          { kind: 'skill_metric', skillId: 'core-skill', metric: 'callsPerTask' },
        ]
      }
    ]
  };
  const res2 = validateSkillInsights(conditionalCausal, mockSnapshot);
  assert.equal(res2.insights.length, 1, 'Conditional hypothesis acknowledging missing trace should pass');
});

test('Evidence Gate rejects unknown metrics and unsupported mechanism assertions', () => {
  const cases = [
    {
      id: 'unknown-metric',
      interpretation: 'This metric is not present in the candidate snapshot.',
      evidence: [{ kind: 'skill_metric', skillId: 'core-skill', metric: 'notARealMetric' }],
    },
    {
      id: 'mixed-causal',
      interpretation: 'This Skill caused 10M tokens.',
      consequence: 'If the trace is absent, current evidence cannot confirm another detail.',
      evidence: [{ kind: 'distribution_metric', metric: 'median' }],
    },
    {
      id: 'repeated-injection',
      interpretation: 'The complete SKILL.md was repeatedly injected on every call.',
      evidence: [{ kind: 'skill_metric', skillId: 'core-skill', metric: 'callsPerTask' }],
    },
  ];

  for (const item of cases) {
    const result = validateSkillInsights({
      insights: [{
        id: item.id,
        scope: 'skill',
        subject: { skillId: 'core-skill' },
        title: item.id,
        observation: 'Observed usage.',
        contrast: 'Compared with the baseline.',
        interpretation: item.interpretation,
        consequence: item.consequence || 'Review the evidence boundary.',
        confidence: 'high',
        evidence: item.evidence,
      }],
    }, mockSnapshot);
    assert.equal(result.insights.length, 0, `${item.id} must be rejected`);
  }
});

test('calculateSkillSnapshotBudget identifies when snapshot exceeds 24k tokens', () => {
  const normal = calculateSkillSnapshotBudget(mockSnapshot);
  assert.equal(normal.isOversized, false);

  const bigSnapshot = {
    ...mockSnapshot,
    selectedSkills: [
      {
        ...mockSnapshot.selectedSkills[0],
        skillMdEstimatedTokens: 25000,
      }
    ]
  };
  const big = calculateSkillSnapshotBudget(bigSnapshot);
  assert.equal(big.isOversized, true);
  assert.equal(SKILL_CONTENT_BUDGET_TOKENS, 24000);
});

test('Capability Aha requires usage, unique content, generic counterevidence, and deletion counterfactuals', () => {
  const result = validateSkillInsights({
    snapshotId: mockSnapshot.snapshotId,
    contentProfiles: [{
      skillId: 'core-skill',
      lossIfRemoved: [{
        summary: '项目执行边界',
        role: 'hardConstraint',
        evidenceExcerpt: 'Always check repository state before running commands.',
        whyModelWouldNotKnowThis: '这是当前项目的执行边界。',
        loadingScope: 'always',
      }],
      modelNativeScaffold: [{
        summary: '通用任务总结',
        evidenceExcerpt: 'Generic procedure: summarize the task before editing.',
        observed: '文档要求先总结任务。',
        interpretation: '相对 capable-current-coding-agent，这通常属于模型已有的通用流程。',
        rationale: '它不依赖本项目的局部事实。',
        relativeTo: 'capable-current-coding-agent',
      }],
      scopedContent: [],
      contentSummary: '同时包含项目边界与通用流程。',
    }],
    insights: [{
      id: 'capability-aha',
      kind: 'capability',
      scope: 'skill',
      subject: { skillId: 'core-skill' },
      title: '项目约束与通用流程应分开保留',
      reveal: {
        semantic: '这个高频 Skill 的专有边界与通用脚手架不是同一种价值',
        pattern: 'content_contrast',
        evidenceRefs: ['skill:core-skill:calls', 'content:core-skill:hardConstraint', 'content:core-skill:genericProcedure'],
      },
      mentalModelShift: { surface: '整份 Skill 都同样不可替代', observed: '专有执行边界提供主要保留理由，通用流程需要单独审查' },
      decisionDelta: { before: '整份 Skill 一起维护', after: '先保留项目边界，再审查通用脚手架' },
      observation: '该 Skill 同时包含项目执行边界与通用编码步骤。',
      contrast: '两类内容的来源与可替代性不同。',
      interpretation: 'Skill 的专有部分与模型原生流程应分开评估。',
      consequence: '优先保护项目边界，避免把通用步骤当成唯一能力。',
      counterfactual: {
        ifRemoved: '删除整个 Skill 会失去项目执行边界。',
        withoutGenericScaffold: '删除通用脚手架后仍保留项目执行边界。',
      },
      claimStrength: 'scaffold-interpretation',
      confidence: 'high',
      evidence: [
        { kind: 'skill_metric', skillId: 'core-skill', metric: 'calls' },
        { kind: 'skill_content', skillId: 'core-skill', role: 'hardConstraint', loadingScope: 'always', evidenceExcerpt: 'Always check repository state before running commands.' },
        { kind: 'skill_content', skillId: 'core-skill', role: 'genericProcedure', loadingScope: 'task_scoped', evidenceExcerpt: 'Follow repo conventions.' },
        { kind: 'skill_content', skillId: 'core-skill', role: 'genericProcedure', loadingScope: 'task_scoped', evidenceExcerpt: 'Generic procedure: summarize the task before editing.' },
      ],
    }],
  }, mockSnapshot);

  assert.equal(result.valid, true);
  assert.equal(result.insights.length, 1);
  assert.equal(result.insights[0].kind, 'capability');
  assert.equal(result.insights[0].claimStrength, 'scaffold-interpretation');
  assert.equal(result.insights[0].counterfactual.withoutGenericScaffold, '删除通用脚手架后仍保留项目执行边界。');
  assert.equal(result.contentProfiles[0].modelNativeScaffold[0].relativeTo, 'capable-current-coding-agent');
});

test('Capability Aha records a stable rejection when one evidence side is missing', () => {
  const result = validateSkillInsights({
    snapshotId: mockSnapshot.snapshotId,
    insights: [{
      id: 'capability-one-sided',
      kind: 'capability',
      scope: 'skill',
      subject: { skillId: 'core-skill' },
      title: '项目边界值得保留',
      reveal: { semantic: '项目边界是这个 Skill 的专有内容', pattern: 'content_contrast', evidenceRefs: ['skill:core-skill:calls', 'content:core-skill:hardConstraint'] },
      mentalModelShift: { surface: '整份内容都一样重要', observed: '项目边界是可单独识别的专有内容' },
      decisionDelta: { before: '整份内容一起维护', after: '优先保留项目边界' },
      observation: '该 Skill 包含明确的项目执行边界。',
      contrast: '项目边界不是普通编码流程。',
      interpretation: '它可能是独特能力来源。',
      counterfactual: { ifRemoved: '删除后会失去项目执行边界。', withoutGenericScaffold: '未知。' },
      confidence: 'high',
      evidence: [
        { kind: 'skill_metric', skillId: 'core-skill', metric: 'calls' },
        { kind: 'skill_content', skillId: 'core-skill', role: 'hardConstraint', loadingScope: 'always', evidenceExcerpt: 'Always check repository state before running commands.' },
      ],
    }],
  }, mockSnapshot);

  assert.equal(result.insights.length, 0);
  assert.ok(result.rejectionReasons.includes('missing_model_native_counterevidence'));
});

test('Capability Aha rejects scaffold interpretation when generic evidence is insufficient', () => {
  const result = validateSkillInsights({
    snapshotId: mockSnapshot.snapshotId,
    insights: [{
      id: 'capability-thin-generic',
      kind: 'capability',
      scope: 'skill',
      subject: { skillId: 'core-skill' },
      title: '项目边界与通用流程并存',
      reveal: { semantic: '项目边界与通用脚手架承担不同角色', pattern: 'content_contrast', evidenceRefs: ['skill:core-skill:calls', 'content:core-skill:hardConstraint', 'content:core-skill:genericProcedure'] },
      mentalModelShift: { surface: '所有内容都需要同样保留', observed: '项目边界与通用脚手架应分开评估' },
      decisionDelta: { before: '整份 Skill 一起维护', after: '先审查项目边界' },
      observation: 'Skill 同时包含项目边界与通用步骤。',
      contrast: '两类内容承担不同角色。',
      interpretation: '通用步骤可能被模型原生能力覆盖。',
      counterfactual: { ifRemoved: '删除整个 Skill 会失去项目边界。', withoutGenericScaffold: '删除通用步骤后仍保留项目边界。' },
      claimStrength: 'scaffold-interpretation',
      confidence: 'high',
      evidence: [
        { kind: 'skill_metric', skillId: 'core-skill', metric: 'calls' },
        { kind: 'skill_content', skillId: 'core-skill', role: 'hardConstraint', loadingScope: 'always', evidenceExcerpt: 'Always check repository state before running commands.' },
        { kind: 'skill_content', skillId: 'core-skill', role: 'genericProcedure', loadingScope: 'task_scoped', evidenceExcerpt: 'Follow repo conventions.' },
      ],
    }],
  }, mockSnapshot);

  assert.equal(result.insights.length, 0);
  assert.ok(result.rejectionReasons.includes('insufficient_content_support'));
});

test('Readable Skill content with only Usage Aha records content downgrade instead of filling a duplicate card', () => {
  const result = validateSkillInsights({
    snapshotId: mockSnapshot.snapshotId,
    insights: [{
      id: 'usage-only',
      kind: 'usage',
      scope: 'global',
      title: '调用结构集中',
      reveal: { semantic: '调用重心集中在少数核心', pattern: 'share_inversion', evidenceRefs: ['global:lowFrequencySkillShare', 'global:lowFrequencyCallShare'] },
      mentalModelShift: { surface: 'Skill 使用较为均匀', observed: '日常工作流集中在少数核心' },
      decisionDelta: { before: '所有 Skill 同优先级维护', after: '核心 Skill 优先维护' },
      observation: '调用集中在少数 Skill。',
      contrast: '低频 Skill 的数量与调用贡献不匹配。',
      interpretation: '系统呈现核心加长尾结构。',
      confidence: 'high',
      evidence: [
        { kind: 'global_metric', metric: 'lowFrequencySkillShare' },
        { kind: 'global_metric', metric: 'lowFrequencyCallShare' },
      ],
    }],
  }, mockSnapshot);

  assert.equal(result.insights.length, 1);
  assert.ok(result.rejectionReasons.includes('usage_content_relation_unclear'));
});
