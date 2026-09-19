const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  validateSkillInsights,
  calculateSkillSnapshotBudget,
  SKILL_CONTENT_BUDGET_TOKENS,
} = require('../dist/src/skill-insights.js');

const mockSnapshot = {
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
    insights: [
      {
        id: 'systemic-1',
        scope: 'global',
        title: '表面有 35 个 Skill，实际工作流高度收敛于小核心',
        mentalModelShift: {
          surface: '我正在同时重度使用 35 种不同的能力工具',
          observed: '前 4 个核心承担了 70% 的调用，超过一半是低频偶发项'
        },
        decisionDelta: {
          before: '所有 Skill 按同一优先级维护',
          after: '核心 Skill 优先维护，长尾 Skill 按需维护',
        },
        observation: '35 个 Skill 中前 4 个高频项占 70.07% 调用，20 个 Skill 处于低频长尾。',
        contrast: '长尾中 20 个 Skill 合计仅贡献 9.11% 调用，与核心层呈现极强的幂律分化。',
        interpretation: 'Skill 数量虚高了系统复杂度，实际日常工作流已经自然收敛。',
        consequence: '优先维护核心层，长尾偶发项保持按需查阅即可。',
        confidence: 'high',
        evidence: [
          { kind: 'global_metric', metric: 'top4CallShare' },
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
  assert.equal(res.insights[0].evidence[1].value, 0.0911, 'Should resolve deterministic metric value');
});

test('Evidence Gate accepts valid 2-axis content insight with verbatim excerpt', () => {
  const raw = {
    insights: [
      {
        id: 'node-1',
        scope: 'skill',
        subject: { skillId: 'core-skill' },
        title: '核心指导提供关键环境硬约束',
        mentalModelShift: {
          surface: '它只是一次性的普通入口',
          observed: '它的调用行为明显偏离普通 Skill，需要单独核查',
        },
        decisionDelta: {
          before: '按普通说明处理',
          after: '先保留硬约束，再单独检查其高频行为',
        },
        observation: '该 Skill 在相关任务中频次高，提供了必须保持前置检查的具体约束。',
        contrast: '全系统 callsPerTask 中位数为 1.0，该 Skill 达到 10.28，属于显著离群值。',
        interpretation: '它并非单次任务入口，而是贯穿任务生命周期的伴随型约束。',
        consequence: '保留前置检查协议，精简时只裁剪通用流程脚手架。',
        confidence: 'high',
        evidence: [
          { kind: 'distribution_metric', metric: 'median' },
          { kind: 'skill_metric', skillId: 'core-skill', metric: 'calls' },
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
  assert.equal(res.insights[0].evidence[1].value, 120, 'Should resolve candidate call count');
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
    insights: [{
      id: 'missing-decision-delta',
      scope: 'global',
      title: '结构完整但没有决策变化',
      mentalModelShift: { surface: '看起来很分散', observed: '调用集中在少数 Skill' },
      observation: '调用集中在少数 Skill。',
      contrast: '前四项占据大部分调用。',
      interpretation: '系统呈现核心加长尾结构。',
      consequence: '继续观察。',
      confidence: 'high',
      evidence: [{ kind: 'global_metric', metric: 'top4CallShare' }],
    }],
  }, mockSnapshot);

  assert.equal(result.insights.length, 0);
  assert.match(result.errors.join('\n'), /decision delta/i);
});

test('Evidence Gate requires two content members for a direct family-semantic claim', () => {
  const result = validateSkillInsights({
    insights: [{
      id: 'family-semantic-without-content',
      scope: 'family',
      subject: { familyId: 'where-tokens-went' },
      title: '多个变体共享同一能力核心',
      mentalModelShift: { surface: '四个名字代表四种能力', observed: '它们可能共享一个能力核心' },
      decisionDelta: { before: '按四个独立 Skill 维护', after: '先按一个能力家族审计' },
      observation: '多个变体共享同一能力核心。',
      contrast: '家族调用占比高于其他命名组。',
      interpretation: '这些变体共享同一能力核心。',
      consequence: '合并审计范围。',
      confidence: 'high',
      evidence: [{ kind: 'family_metric', familyId: 'where-tokens-went', metric: 'callShare' }],
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
    mentalModelShift: { surface: '每张卡都代表独立能力', observed: '同一家族的卡片解释了同一结构' },
    decisionDelta: { before: '分别维护每张卡', after: '只保留一条家族级行动' },
    observation: '同一家族出现高频调用。',
    contrast: '它高于全体中位数。',
    interpretation: '这揭示了家族层面的集中。',
    consequence: '按家族优先维护。',
    confidence: 'high',
    evidence: [{ kind: 'family_metric', familyId: 'where-tokens-went', metric: 'callShare' }],
  });
  const result = validateSkillInsights({
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
    insights: [{
      id: 'mixed-role-with-one-side',
      scope: 'skill',
      subject: { skillId: 'core-skill' },
      title: '严格硬约束与通用流程放在同一层',
      mentalModelShift: { surface: '整份内容都同样关键', observed: '硬约束与通用流程承担不同角色' },
      decisionDelta: { before: '整份内容一起维护', after: '先保留硬约束，再单独治理通用流程' },
      observation: '该 Skill 同时包含严格硬约束与通用流程。',
      contrast: '硬约束必须前置，而通用流程不需要同样的加载范围。',
      interpretation: '两类内容不能用同一加载策略治理。',
      consequence: '先分别核对两类内容。',
      confidence: 'high',
      evidence: [{
        kind: 'skill_content',
        skillId: 'core-skill',
        role: 'hardConstraint',
        loadingScope: 'always',
        evidenceExcerpt: 'Always check repository state before running commands.',
      }],
    }],
  }, mockSnapshot);

  assert.equal(result.insights.length, 0);
  assert.match(result.errors.join('\n'), /both roles/i);
});

test('Evidence Gate blocks unconditional causality, but allows conditional hypothesis with missing evidence stated', () => {
  // 1. Unconditional causal claim -> REJECT
  const directCausal = {
    insights: [
      {
        id: 'direct-causal',
        scope: 'skill',
        title: '导致严重浪费',
        observation: 'Skill 调用频繁。',
        contrast: '相比中位数偏高。',
        interpretation: '这个 Skill 导致了大量的 Token 消耗与成本浪费。',
        consequence: '立即整改。',
        confidence: 'high',
        evidence: [{ kind: 'distribution_metric', metric: 'median' }]
      }
    ]
  };
  const res1 = validateSkillInsights(directCausal, mockSnapshot);
  assert.equal(res1.insights.length, 0, 'Unconditional causal assertion must be rejected');

  // 2. Conditional hypothesis with missing evidence stated -> ACCEPT
  const conditionalCausal = {
    insights: [
      {
        id: 'conditional-causal',
        scope: 'skill',
        title: '高频调用具备潜在上下文放大风险',
        mentalModelShift: {
          surface: '高频 Skill 应该就是重复注入了正文',
          observed: '当前只能确认它是调用次数离群，注入机制仍未知',
        },
        decisionDelta: {
          before: '先改 Prompt',
          after: '先检查真实触发序列',
        },
        observation: '该 Skill 平均每任务出现 10.28 次。',
        contrast: '全系统中位数为 1.0，P90 为 2.5。',
        interpretation: '如果每次调用伴随完整正文注入，则可能放大上下文成本；当前缺少直接注入 trace 证据，下一步建议核查真实加载机制。',
        consequence: '核查任务内的加载行为。',
        confidence: 'high',
        evidence: [{ kind: 'distribution_metric', metric: 'median' }]
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
