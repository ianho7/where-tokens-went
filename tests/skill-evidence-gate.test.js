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
    },
    {
      skillId: 'unavailable-skill',
      skillName: 'unavailable-skill',
      skillPath: null,
      contentState: 'unavailable',
      skillMdBytes: 0,
      skillMdEstimatedTokens: 0,
      skillMdHash: null,
      skillMdContent: null,
      referenceCount: 0,
      referenceBytes: 0,
      referenceFiles: [],
    }
  ]
};

test('Evidence Gate accepts valid evidence-backed insight with normalized substring match', () => {
  const raw = {
    insights: [
      {
        id: 'insight-1',
        type: 'high_frequency_strong_capability_delta',
        title: '核心规范有效约束环境行为',
        claim: '该 Skill 在高用量任务中频繁出现，且提供了仓库状态前置检查等具体硬约束。',
        interpretation: '若移除该指导，模型将失去仓库状态前置检查边界。',
        action: '保留当前约束，无需精简。',
        confidence: 'high',
        skillIds: ['core-skill'],
        evidence: [
          { kind: 'usage_metric', metric: 'callShare' },
          {
            kind: 'skill_content',
            skillId: 'core-skill',
            category: 'hardConstraints',
            evidenceExcerpt: 'Always check repository state before running commands.',
          }
        ]
      }
    ]
  };

  const res = validateSkillInsights(raw, mockSnapshot);
  assert.equal(res.valid, true);
  assert.equal(res.insights.length, 1);
  assert.equal(res.insights[0].id, 'insight-1');
  assert.equal(res.unsupportedClaimsDropped, 0);
});

test('Evidence Gate strictly rejects causal statements', () => {
  const causalInputs = [
    'Skill X caused 10M tokens',
    'Skill X wasted $10',
    '这个 Skill 导致了大量的 Token 消耗',
    '因为这个 Skill 消耗了过多资源',
    '这个模块造成了成本浪费'
  ];

  for (const phrase of causalInputs) {
    const raw = {
      insights: [
        {
          id: 'causal-insight',
          type: 'high_frequency_generic_procedure',
          title: phrase,
          claim: '测试事实',
          interpretation: '测试解释',
          action: '测试行动',
          confidence: 'high',
          skillIds: ['core-skill'],
          evidence: [{ kind: 'usage_metric', metric: 'calls' }]
        }
      ]
    };
    const res = validateSkillInsights(raw, mockSnapshot);
    assert.equal(res.insights.length, 0, 'Causal phrase must be rejected: ' + phrase);
  }
});

test('Evidence Gate strictly rejects repeated prompt injection claims from callsPerTask', () => {
  const raw = {
    insights: [
      {
        id: 'fake-injection',
        type: 'high_frequency_generic_procedure',
        title: '重复加载检测',
        claim: 'callsPerTask 达到 5 次，完整 SKILL.md 被重复注入了 5 次。',
        interpretation: '上下文被完全浪费。',
        action: '重构注入机制。',
        confidence: 'high',
        skillIds: ['core-skill'],
        evidence: [{ kind: 'usage_metric', metric: 'callsPerTask' }]
      }
    ]
  };

  const res = validateSkillInsights(raw, mockSnapshot);
  assert.equal(res.insights.length, 0, 'Fake repeated injection claim must be rejected');
});

test('Evidence Gate rejects non-existent excerpts or excerpts > 200 chars', () => {
  const raw = {
    insights: [
      {
        id: 'fake-excerpt',
        type: 'high_frequency_strong_capability_delta',
        title: '虚假引用',
        claim: '引用不存在的内容',
        interpretation: '解释',
        action: '行动',
        confidence: 'high',
        skillIds: ['core-skill'],
        evidence: [
          {
            kind: 'skill_content',
            skillId: 'core-skill',
            category: 'hardConstraints',
            evidenceExcerpt: 'This sentence never existed in SKILL.md at all.',
          }
        ]
      },
      {
        id: 'oversized-excerpt',
        type: 'high_frequency_strong_capability_delta',
        title: '超长引用',
        claim: '引用超长',
        interpretation: '解释',
        action: '行动',
        confidence: 'high',
        skillIds: ['core-skill'],
        evidence: [
          {
            kind: 'skill_content',
            skillId: 'core-skill',
            category: 'hardConstraints',
            evidenceExcerpt: 'A'.repeat(201),
          }
        ]
      }
    ]
  };

  const res = validateSkillInsights(raw, mockSnapshot);
  assert.equal(res.insights.length, 0, 'Non-matching and oversized excerpts must be rejected');
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
