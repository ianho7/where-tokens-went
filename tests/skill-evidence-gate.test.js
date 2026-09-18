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
    lowFrequencySkillShare: 0.5714,
    lowFrequencyCallShare: 0.0911,
    singleUseSkillShare: 0.3429,
    dominantFamily: {
      groupId: 'where-tokens-went',
      memberSkillIds: ['where-tokens-went-codex', 'where-tokens-went-claude'],
      callShare: 0.423
    }
  },
  selectedCandidates: [
    {
      skillId: 'core-skill',
      skillName: 'core-skill',
      candidateTypes: ['high_frequency'],
      signals: { callShare: 0.4, callsPerTask: 10.28 }
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
      skillMdContent: '# Core Skill\nAlways check repository state before running commands.\nFollow repo conventions.',
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
        observation: '该 Skill 在相关任务中频次高，提供了必须保持前置检查的具体约束。',
        contrast: '全系统 callsPerTask 中位数为 1.0，该 Skill 达到 10.28，属于显著离群值。',
        interpretation: '它并非单次任务入口，而是贯穿任务生命周期的伴随型约束。',
        consequence: '保留前置检查协议，精简时只裁剪通用流程脚手架。',
        confidence: 'high',
        evidence: [
          { kind: 'distribution_metric', metric: 'median' },
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
