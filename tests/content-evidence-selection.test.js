const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  readContentEvidence,
  selectSessionTurns,
  selectAutoEvidence,
} = require('../dist/src/content-evidence.js');

function createTurnEntry(sessionId, turnId, ordinal, totalTokensValue, toolBytesValue) {
  return {
    sessionId,
    turnId,
    ordinal: {
      value: ordinal,
      provenance: 'reported',
    },
    tokens: {
      inputTokens: { value: 0, provenance: 'reported' },
      cachedInputTokens: { value: 0, provenance: 'reported' },
      cacheWriteTokens: { value: 0, provenance: 'reported' },
      outputTokens: { value: 0, provenance: 'reported' },
      unclassifiedTokens: { value: 0, provenance: 'reported' },
      reasoningTokens: { value: 0, provenance: 'reported' },
      totalTokens: totalTokensValue !== null
        ? { value: totalTokensValue, provenance: 'reported' }
        : { value: null, provenance: 'unavailable' },
    },
    sessionSharePercent: { value: 0, provenance: 'derived' },
    modelCallCount: { value: 1, provenance: 'reported' },
    startedAt: { value: '2026-09-30T10:00:00.000Z', provenance: 'reported' },
    endedAt: { value: '2026-09-30T10:01:00.000Z', provenance: 'reported' },
    durationMs: { value: 60000, provenance: 'reported' },
    timeToFirstTokenMs: { value: 200, provenance: 'reported' },
    observedSpanMs: { value: 60000, provenance: 'derived' },
    toolCallCount: { value: 1, provenance: 'reported' },
    pairedToolResultCount: { value: 1, provenance: 'reported' },
    toolResultChars: { value: 100, provenance: 'reported' },
    toolResultBytes: toolBytesValue !== null
      ? { value: toolBytesValue, provenance: 'reported' }
      : { value: null, provenance: 'unavailable' },
    errorCount: { value: 0, provenance: 'reported' },
    lifecycleMarkers: [],
    evidenceId: `ev-${turnId}`,
    method: 'test',
    coverage: { value: 100, provenance: 'derived' },
  };
}

function mockAudit(sessionId, turns, toolCalls = []) {
  return {
    scope: {
      harness: 'codex',
      cwd: '<current-project>',
      allProjects: false,
      since: '2026-09-01T00:00:00.000Z',
    },
    coverage: {
      recordsRead: 100,
      recordsSkipped: 0,
      sessionsAudited: 1,
      sessionsExcluded: 0,
    },
    summary: {},
    rankings: {
      sessions: [{ key: sessionId, value: { value: 1000, provenance: 'reported' }, sharePercent: { value: 100, provenance: 'derived' }, count: { value: 1, provenance: 'reported' } }],
      projects: [],
      models: [],
      skills: [],
      timeBuckets: [],
    },
    turns,
    turnCandidates: [],
    report: {},
    checks: [],
    toolCalls,
  };
}

test('AC-1: Native unlabelled content attribution across multiple turns, single-turn isolation, tool classification', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-evidence-ac1-'));
  const project = path.join(root, 'project');
  const codexHome = path.join(root, 'codex-home');
  const sessions = path.join(codexHome, 'sessions', '2026', '09', '30');
  await mkdir(project, { recursive: true });
  await mkdir(sessions, { recursive: true });

  const timestamp = '2026-09-30T10:00:00.000Z';
  const records = [
    { timestamp, type: 'session_meta', payload: { id: 'ten-turns-session', cwd: project } },
  ];

  // 构造 10 轮原生形态记录：每个 turn 以 turn_context 开始，紧随其后的 response_item 无显式 turn_id
  for (let i = 1; i <= 10; i++) {
    const turnId = `turn-${i}`;
    records.push({
      timestamp,
      type: 'turn_context',
      payload: { turn_id: turnId, cwd: project, model: 'gpt-5', model_provider: 'openai' },
    });

    if (i === 1) {
      records.push({
        timestamp,
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: 'User question in turn 1' },
      });
      records.push({
        timestamp,
        type: 'response_item',
        payload: { type: 'message', role: 'assistant', content: 'Assistant reply in turn 1' },
      });
    } else if (i === 2) {
      records.push({
        timestamp,
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: 'User question in turn 2' },
      });
      // 验证 function_call_output 分类为 tool
      records.push({
        timestamp,
        type: 'response_item',
        payload: { type: 'function_call_output', call_id: 'call-2-out', output: 'Function result output in turn 2' },
      });
    } else if (i === 10) {
      records.push({
        timestamp,
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: 'User question in turn 10' },
      });
      records.push({
        timestamp,
        type: 'response_item',
        payload: { type: 'message', role: 'assistant', content: 'Assistant reply in turn 10' },
      });
    } else {
      records.push({
        timestamp,
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: `User question in turn ${i}` },
      });
    }
  }

  await writeFile(
    path.join(sessions, 'rollout-ten-turns.jsonl'),
    records.map((r) => JSON.stringify(r)).join('\n') + '\n',
    'utf8',
  );

  const prevCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;

  try {
    const turns = Array.from({ length: 10 }, (_, idx) => createTurnEntry('ten-turns-session', `turn-${idx + 1}`, idx + 1, 100, 50));
    const audit = mockAudit('ten-turns-session', turns);
    const scope = { harness: 'codex', cwd: project, allProjects: false, since: new Date(audit.scope.since) };

    // Case 1A: 选两轮（turn-1 和 turn-2），继承当前 turn，不漏读未标号正文
    const twoTurnPackets = await readContentEvidence({
      scope,
      audit,
      selections: [
        {
          sessionId: 'ten-turns-session',
          turnIds: ['turn-1', 'turn-2'],
          selectionReason: 'selected 2 turns',
          unreadScope: 'remaining 8 turns',
        },
      ],
    });

    assert.equal(twoTurnPackets.length, 1);
    const items = twoTurnPackets[0].items;
    assert.ok(items.length >= 3, `Expected at least 3 items for turn 1 and turn 2, got ${items.length}`);

    const turn1User = items.find((it) => it.turnId === 'turn-1' && it.kind === 'user');
    assert.ok(turn1User, 'Turn 1 user message must be attributed and present');
    assert.equal(turn1User.content, 'User question in turn 1');

    const turn2Tool = items.find((it) => it.turnId === 'turn-2' && it.kind === 'tool');
    assert.ok(turn2Tool, 'Turn 2 function_call_output must be present and classified as tool');
    assert.equal(turn2Tool.content, 'Function result output in turn 2');
    assert.equal(turn2Tool.kind, 'tool', 'function_call_output must be classified as tool, not assistant');

    // 选两轮绝不包含第 10 轮正文
    const hasTurn10 = items.some((it) => it.turnId === 'turn-10' || it.content.includes('turn 10'));
    assert.equal(hasTurn10, false, 'Reading two turns must not include turn 10 content');

    // Case 1B: 单轮选择隔离测试：仅选 turn-1 时，绝对不能吸收第 10 轮正文
    const singleTurnPackets = await readContentEvidence({
      scope,
      audit,
      selections: [
        {
          sessionId: 'ten-turns-session',
          turnIds: ['turn-1'],
          selectionReason: 'single turn 1',
          unreadScope: 'remaining 9 turns',
        },
      ],
    });

    assert.equal(singleTurnPackets.length, 1);
    const singleItems = singleTurnPackets[0].items;
    assert.ok(singleItems.every((it) => it.turnId === 'turn-1'), 'All items in single turn selection must belong to turn-1');
    assert.equal(
      singleItems.some((it) => it.content.includes('turn 10')),
      false,
      'Single turn 1 selection must not absorb turn 10 unlabelled content',
    );

    // Case 1C: 原生 event_msg 内层 task_started 可靠更新当前 Turn，第二轮未标号正文属于第二轮，单选第一轮不会串读
    const taskStartedRecords = [
      { timestamp, type: 'session_meta', payload: { id: 'task-started-session', cwd: project } },
      { timestamp, type: 'turn_context', payload: { turn_id: 'turn-1', cwd: project } },
      { timestamp, type: 'response_item', payload: { type: 'message', role: 'user', content: 'Turn 1 user message' } },
      { timestamp, type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-2' } },
      { timestamp, type: 'response_item', payload: { type: 'message', role: 'user', content: 'Turn 2 user message' } },
    ];
    await writeFile(
      path.join(sessions, 'rollout-task-started.jsonl'),
      taskStartedRecords.map((r) => JSON.stringify(r)).join('\n') + '\n',
      'utf8',
    );
    const taskAudit = mockAudit('task-started-session', [
      createTurnEntry('task-started-session', 'turn-1', 1, 50, 10),
      createTurnEntry('task-started-session', 'turn-2', 2, 50, 10),
    ]);
    const taskScope = { harness: 'codex', cwd: project, allProjects: false, since: new Date(taskAudit.scope.since) };

    const taskBoth = await readContentEvidence({
      scope: taskScope,
      audit: taskAudit,
      selections: [{ sessionId: 'task-started-session', turnIds: ['turn-1', 'turn-2'], selectionReason: 'both', unreadScope: 'none' }],
    });
    assert.equal(taskBoth[0].items.length, 2);
    assert.equal(taskBoth[0].items[0].turnId, 'turn-1');
    assert.equal(taskBoth[0].items[0].content, 'Turn 1 user message');
    assert.equal(taskBoth[0].items[1].turnId, 'turn-2', 'Turn 2 unlabelled message must belong to turn-2 via event_msg task_started');
    assert.equal(taskBoth[0].items[1].content, 'Turn 2 user message');
    assert.equal(taskBoth[0].warnings.length, 0);

    const taskSingle = await readContentEvidence({
      scope: taskScope,
      audit: taskAudit,
      selections: [{ sessionId: 'task-started-session', turnIds: ['turn-1'], selectionReason: 'single', unreadScope: 'remaining 1' }],
    });
    assert.equal(taskSingle[0].items.length, 1);
    assert.equal(taskSingle[0].items[0].turnId, 'turn-1');
    assert.equal(taskSingle[0].items[0].content, 'Turn 1 user message');
    assert.equal(taskSingle[0].items.some((it) => it.content.includes('Turn 2')), false, 'Single turn 1 must not absorb turn 2 content');
  } finally {
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    await rm(root, { recursive: true, force: true });
  }
});

test('AC-2: Boundaries, unknown attribution handling, empty turn warnings, and scope rejection', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-evidence-ac2-'));
  const project = path.join(root, 'project');
  const otherProject = path.join(root, 'other-project');
  const codexHome = path.join(root, 'codex-home');
  const sessions = path.join(codexHome, 'sessions', '2026', '09', '30');
  await mkdir(project, { recursive: true });
  await mkdir(otherProject, { recursive: true });
  await mkdir(sessions, { recursive: true });

  const timestamp = '2026-09-30T10:00:00.000Z';
  const records = [
    { timestamp, type: 'session_meta', payload: { id: 'scope-session', cwd: project } },
    // 遇到未标号且无 currentTurnId 的孤立消息（未知归属）
    { timestamp, type: 'response_item', payload: { type: 'message', role: 'user', content: 'Unattributed orphan content' } },
    // Turn 1: 正常有正文
    { timestamp, type: 'turn_context', payload: { turn_id: 'turn-1', cwd: project } },
    { timestamp, type: 'response_item', payload: { type: 'message', role: 'user', content: 'Valid user message in turn 1' } },
    // Turn 2: 只有 token usage，没有正文记录
    { timestamp, type: 'turn_context', payload: { turn_id: 'turn-2', cwd: project } },
    { timestamp, type: 'event_msg', payload: { type: 'token_usage_record', turn_id: 'turn-2' } },
  ];

  await writeFile(
    path.join(sessions, 'rollout-scope.jsonl'),
    records.map((r) => JSON.stringify(r)).join('\n') + '\n',
    'utf8',
  );

  const prevCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;

  try {
    const turns = [
      createTurnEntry('scope-session', 'turn-1', 1, 50, 10),
      createTurnEntry('scope-session', 'turn-2', 2, 50, 10),
    ];
    const audit = mockAudit('scope-session', turns);
    const scope = { harness: 'codex', cwd: project, allProjects: false, since: new Date(audit.scope.since) };

    const packets = await readContentEvidence({
      scope,
      audit,
      selections: [
        {
          sessionId: 'scope-session',
          turnIds: ['turn-1', 'turn-2'],
          selectionReason: 'turn 1 and turn 2',
          unreadScope: 'none',
        },
      ],
    });

    assert.equal(packets.length, 1);
    const packet = packets[0];

    // 孤立未归属内容不能被塞入 turn-1 或 turn-2
    assert.equal(packet.items.some((it) => it.content.includes('Unattributed orphan content')), false);

    // warnings 必须明确包含 CONTENT_TURN_UNAVAILABLE 说明
    assert.ok(
      packet.warnings.some((w) => w.includes('CONTENT_TURN_UNAVAILABLE')),
      `Expected CONTENT_TURN_UNAVAILABLE warning, got: ${JSON.stringify(packet.warnings)}`,
    );

    // 选中但无正文的 turn-2 必须有明确 warning 说明
    assert.ok(
      packet.warnings.some((w) => w.includes('turn-2') && w.includes('no recorded content')),
      `Expected turn-2 no recorded content warning, got: ${JSON.stringify(packet.warnings)}`,
    );

    // 跨项目 scope 检查：必须抛出错误拒绝
    await assert.rejects(
      readContentEvidence({
        scope: { ...scope, cwd: otherProject },
        audit,
        selections: [
          {
            sessionId: 'scope-session',
            turnIds: ['turn-1'],
            selectionReason: 'cross-project',
            unreadScope: 'none',
          },
        ],
      }),
      /outside the originating project scope/,
    );
  } finally {
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    await rm(root, { recursive: true, force: true });
  }
});

test('AC-3: Major contributor selection in 12 turns (turn 10 = 905, others = 15) covers turn 10/9 and endpoints with budget <= 8', () => {
  // 固定独立输入：12 轮，第 10 轮为 905，其余各 15。峰值不在首尾。
  const turns = [];
  for (let i = 1; i <= 12; i++) {
    const totalTokens = i === 10 ? 905 : 15;
    turns.push(createTurnEntry('session-12-turns', `turn-${i}`, i, totalTokens, 100));
  }

  // 独立固定预期：
  // 首轮 turn-1、末轮 turn-12 必须保留；
  // 主要贡献轮次 turn-10 (905) 及其紧邻前一轮 turn-9 必须入选；
  // 剩余名额按 ordinal 补足至 8 个；
  // 预算严格等于 8，绝不超过 8。
  const EXPECTED_TURN_IDS = ['turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5', 'turn-9', 'turn-10', 'turn-12'];

  const selection1 = selectSessionTurns(turns);
  assert.equal(selection1.turnIds.length, 8, 'Selected turns must be exactly 8');
  assert.deepEqual(selection1.turnIds, EXPECTED_TURN_IDS);
  assert.ok(selection1.turnIds.includes('turn-10'), 'Must include top contributor turn 10');
  assert.ok(selection1.turnIds.includes('turn-9'), 'Must include context turn 9 for turn 10');
  assert.ok(selection1.turnIds.includes('turn-1'), 'Must include earliest endpoint turn 1');
  assert.ok(selection1.turnIds.includes('turn-12'), 'Must include final endpoint turn 12');

  // 相同输入排序稳定性验证
  const selection2 = selectSessionTurns(turns);
  assert.deepEqual(selection1.turnIds, selection2.turnIds, 'Selection must be deterministic and stable');

  // 同时验证 selectAutoEvidence
  const audit = mockAudit('session-12-turns', turns);
  const autoSelections = selectAutoEvidence(audit, [{ sessionId: 'session-12-turns' }]);
  assert.equal(autoSelections.length, 1);
  assert.deepEqual(autoSelections[0].turnIds, EXPECTED_TURN_IDS);
  assert.match(autoSelections[0].selectionReason, /token-weighted/);
  assert.match(autoSelections[0].unreadScope, /4 remaining Turns/);
});

test('AC-4: Multi-turn round-robin budget allocation, truncation (1200 code units), toolBytes fallback without calling tokens', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-evidence-ac4-'));
  const project = path.join(root, 'project');
  const codexHome = path.join(root, 'codex-home');
  const sessions = path.join(codexHome, 'sessions', '2026', '09', '30');
  await mkdir(project, { recursive: true });
  await mkdir(sessions, { recursive: true });

  const timestamp = '2026-09-30T10:00:00.000Z';
  const records = [
    { timestamp, type: 'session_meta', payload: { id: 'budget-session', cwd: project } },
  ];

  // Turn 1: 包含一条超过 1200 字符的长消息，以及很多条普通消息（试图占满 24 个预算配额）
  records.push({ timestamp, type: 'turn_context', payload: { turn_id: 'turn-1', cwd: project } });
  const longText = 'A'.repeat(1500);
  records.push({ timestamp, type: 'response_item', payload: { type: 'message', role: 'user', content: longText } });
  for (let m = 2; m <= 30; m++) {
    records.push({ timestamp, type: 'response_item', payload: { type: 'message', role: 'assistant', content: `Turn 1 extra message ${m}` } });
  }

  // Turn 2: 包含 user 消息和 tool 结果
  records.push({ timestamp, type: 'turn_context', payload: { turn_id: 'turn-2', cwd: project } });
  records.push({ timestamp, type: 'response_item', payload: { type: 'message', role: 'user', content: 'Turn 2 user message' } });
  records.push({ timestamp, type: 'response_item', payload: { type: 'function_call_output', call_id: 'c2', output: 'Turn 2 tool result' } });

  // Turn 3: 包含 user 消息和 assistant 回复
  records.push({ timestamp, type: 'turn_context', payload: { turn_id: 'turn-3', cwd: project } });
  records.push({ timestamp, type: 'response_item', payload: { type: 'message', role: 'user', content: 'Turn 3 user message' } });
  records.push({ timestamp, type: 'response_item', payload: { type: 'message', role: 'assistant', content: 'Turn 3 assistant reply' } });

  await writeFile(
    path.join(sessions, 'rollout-budget.jsonl'),
    records.map((r) => JSON.stringify(r)).join('\n') + '\n',
    'utf8',
  );

  const prevCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;

  try {
    const turns = [
      createTurnEntry('budget-session', 'turn-1', 1, 100, 10),
      createTurnEntry('budget-session', 'turn-2', 2, 100, 10),
      createTurnEntry('budget-session', 'turn-3', 3, 100, 10),
    ];
    const audit = mockAudit('budget-session', turns);
    const scope = { harness: 'codex', cwd: project, allProjects: false, since: new Date(audit.scope.since) };

    const packets = await readContentEvidence({
      scope,
      audit,
      selections: [
        {
          sessionId: 'budget-session',
          turnIds: ['turn-1', 'turn-2', 'turn-3'],
          selectionReason: 'budget test',
          unreadScope: 'none',
        },
      ],
      maxItemsPerSession: 24,
      maxCharsPerItem: 1200,
    });

    assert.equal(packets.length, 1);
    const packet = packets[0];

    // 预算上限验证：不超过 24 项
    assert.ok(packet.items.length <= 24, `Packet items count ${packet.items.length} must not exceed 24`);

    // 轮流分配验证：Turn 2 和 Turn 3 的 user 消息和响应必须入选，不能让 Turn 1 占满所有 24 个名额
    const turn2User = packet.items.find((it) => it.turnId === 'turn-2' && it.kind === 'user');
    const turn2Tool = packet.items.find((it) => it.turnId === 'turn-2' && it.kind === 'tool');
    const turn3User = packet.items.find((it) => it.turnId === 'turn-3' && it.kind === 'user');
    const turn3Assistant = packet.items.find((it) => it.turnId === 'turn-3' && it.kind === 'assistant');

    assert.ok(turn2User, 'Turn 2 user message must be allocated');
    assert.ok(turn2Tool, 'Turn 2 tool message must be allocated');
    assert.ok(turn3User, 'Turn 3 user message must be allocated');
    assert.ok(turn3Assistant, 'Turn 3 assistant message must be allocated');

    // 截断验证：长消息被截断至 1200 字符且带省略号
    const turn1First = packet.items.find((it) => it.turnId === 'turn-1' && it.kind === 'user');
    assert.ok(turn1First, 'Turn 1 user message must be present');
    assert.equal(turn1First.truncated, true);
    assert.equal(turn1First.content.length, 1200, 'Truncated content length including ellipsis must be exactly 1200 UTF-16 code units');
    assert.ok(turn1First.content.endsWith('…'));

    // warnings 记录了截断和预算遗漏
    assert.ok(packet.warnings.some((w) => w.includes('truncated to 1200 UTF-16 code units')));
    assert.ok(packet.warnings.some((w) => w.includes('omitted due to session budget limit')));

    // Case 4B: Emoji 截断与 UTF-16 预算测试（避免孤立代理项，省略号计入预算）
    const emojiRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-evidence-emoji-'));
    const emojiProject = path.join(emojiRoot, 'project');
    const emojiSessions = path.join(emojiRoot, 'codex-home', 'sessions', '2026', '09', '30');
    await mkdir(emojiProject, { recursive: true });
    await mkdir(emojiSessions, { recursive: true });
    const emojiRecords = [
      { timestamp, type: 'session_meta', payload: { id: 'emoji-session', cwd: emojiProject } },
      { timestamp, type: 'turn_context', payload: { turn_id: 'turn-emoji', cwd: emojiProject } },
      { timestamp, type: 'response_item', payload: { type: 'message', role: 'user', content: '😀'.repeat(1200) } },
    ];
    await writeFile(path.join(emojiSessions, 'rollout-emoji.jsonl'), emojiRecords.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

    const emojiAudit = mockAudit('emoji-session', [createTurnEntry('emoji-session', 'turn-emoji', 1, 100, 10)]);
    const emojiScope = { harness: 'codex', cwd: emojiProject, allProjects: false, since: new Date(emojiAudit.scope.since) };
    process.env.CODEX_HOME = path.join(emojiRoot, 'codex-home');

    const emojiPackets = await readContentEvidence({
      scope: emojiScope,
      audit: emojiAudit,
      selections: [{ sessionId: 'emoji-session', turnIds: ['turn-emoji'], selectionReason: 'emoji test', unreadScope: 'none' }],
      maxItemsPerSession: 24,
      maxCharsPerItem: 1200,
    });

    const emojiItem = emojiPackets[0].items[0];
    assert.equal(emojiItem.truncated, true, 'Emoji content over 1200 UTF-16 units must be truncated');
    assert.ok(emojiItem.content.length <= 1200, 'Truncated emoji length must not exceed 1200 UTF-16 code units');
    assert.equal(emojiItem.content.length, 1199, '599 emoji pairs (1198) + 1 ellipsis = 1199 units (lone surrogate avoided)');
    assert.ok(emojiItem.content.endsWith('…'));
    await rm(emojiRoot, { recursive: true, force: true });
    process.env.CODEX_HOME = codexHome;

    // Case 4C: Usage 不可用时的 fallback 测试
    // 构造 10 轮，Usage unavailable，但 toolResultBytes 可用（第 8 轮 toolResultBytes 最高）
    const fallbackTurns = [];
    for (let i = 1; i <= 10; i++) {
      const toolBytes = i === 8 ? 50000 : 100;
      fallbackTurns.push(createTurnEntry('fallback-session', `turn-${i}`, i, null, toolBytes));
    }
    const toolBytesSelection = selectSessionTurns(fallbackTurns);
    assert.equal(toolBytesSelection.turnIds.length, 8);
    assert.ok(toolBytesSelection.turnIds.includes('turn-8'), 'Must include high tool-bytes turn 8');
    assert.ok(toolBytesSelection.turnIds.includes('turn-7'), 'Must include context turn 7 for turn 8');
    assert.match(toolBytesSelection.selectionReason, /tool-bytes fallback/);
    assert.equal(toolBytesSelection.selectionReason.includes('token-weighted'), false, 'Must not claim token-weighted when tokens are unavailable');

    // 两者都不可用时的顺序 fallback
    const noUsageTurns = [];
    for (let i = 1; i <= 10; i++) {
      noUsageTurns.push(createTurnEntry('no-usage-session', `turn-${i}`, i, null, null));
    }
    const sequentialSelection = selectSessionTurns(noUsageTurns);
    assert.equal(sequentialSelection.turnIds.length, 8);
    assert.ok(sequentialSelection.selectionReason.includes('TURN_SELECTION_USAGE_UNAVAILABLE'));
  } finally {
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    await rm(root, { recursive: true, force: true });
  }
});
