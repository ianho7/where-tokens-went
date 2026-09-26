const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { main, preparePromptLabInput, validatePromptLabResult } = require("../scripts/prompt-lab.js");

function synthesisFor(audit, findings = []) {
  const { auditFingerprint } = require("../dist/src/key-session-analysis.js");
  return {
    auditFingerprint: auditFingerprint(audit),
    overview: { summary: "整体用量集中在一个 Session。", evidenceRefs: ["summary:totalTokens"] },
    findings,
    noStrongFindingReason: findings.length === 0 ? "当前固定案例只支持一个明显模式。" : null,
  };
}

test("Prompt Lab binds the selected source Prompt and only its fixed input", () => {
  const prepared = preparePromptLabInput("report-synthesis");
  assert.equal(prepared.inputSummary.prompt, "report-synthesis");
  assert.equal(prepared.inputSummary.fixture, "normal-synthetic");
  assert.match(prepared.modelInput, /auditFingerprint/);
  assert.match(prepared.modelInput, new RegExp(prepared.inputSummary.auditFingerprint));
  assert.doesNotMatch(prepared.modelInput, /\{\{(?:locale|auditFingerprint|auditResultJson)\}\}/u);

  const keySession = preparePromptLabInput("key-session-analysis");
  assert.equal(keySession.inputSummary.fixture, "partial-key-session");
  assert.match(keySession.modelInput, /# Key Session Analysis Prompt/u);
  assert.match(keySession.modelInput, new RegExp(keySession.inputSummary.auditFingerprint));
  assert.match(keySession.modelInput, /contentEvidencePackets/u);
  assert.doesNotMatch(keySession.modelInput, /# Report Synthesis Prompt/u);

  const skillInsights = preparePromptLabInput("skill-insights");
  assert.equal(skillInsights.inputSummary.fixture, "skill-insights-snapshot-v2");
  assert.match(skillInsights.modelInput, /# Skill Insights Prompts/u);
  assert.match(skillInsights.modelInput, /fixture-skill-snapshot-v2/u);
  assert.doesNotMatch(skillInsights.modelInput, /\{\{[^}]+\}\}/u);
  assert.doesNotMatch(skillInsights.modelInput, /# Key Session Analysis Prompt/u);
});

test("thin Prompt Lab check leaves Finding count and prose semantics to review", () => {
  const prepared = preparePromptLabInput();
  const { audit } = prepared;
  const oneFinding = { title: "长任务占据了大部分用量", analysis: "该 Session 使用了 1000 Tokens。", evidenceRefs: ["summary:totalTokens"], support: "strong", uncertainty: null };
  for (const findings of [[], [oneFinding], [oneFinding, oneFinding]]) {
    assert.deepEqual(validatePromptLabResult(prepared, synthesisFor(audit, findings)), { valid: true, errors: [] });
  }
});

test("thin Prompt Lab check matches explicit units to cited Evidence fields", () => {
  const prepared = preparePromptLabInput();
  const { audit } = prepared;
  const cases = [
    ["3 Tokens", "summary:modelCallCount", false],
    ["3 model calls", "summary:modelCallCount", true],
    ["3 model calls", "summary:activeBranchModelCallCount", true],
    ["3 次模型调用", "summary:modelCallCount", true],
    ["3次模型调用", "summary:modelCallCount", true],
    ["3模型调用", "summary:modelCallCount", true],
    ["2 model calls", "ranking:sessions:large", true],
    ["3 model calls", "ranking:projects:<current-project>", true],
    ["2 model calls", "check:long_session:1", true],
    ["2 model calls", "check:model_concentration:2", true],
    ["3%", "summary:modelCallCount", false],
    ["99%", "ranking:sessions:large", true],
    ["1000 Tokens", "summary:totalTokens", true],
    ["1000次模型调用", "summary:totalTokens", false],
    ["1000模型调用", "summary:totalTokens", false],
  ];
  for (const [summary, evidenceRef, valid] of cases) {
    const output = synthesisFor(audit);
    output.overview.summary = summary;
    output.overview.evidenceRefs = [evidenceRef];
    const checked = validatePromptLabResult(prepared, output);
    assert.equal(checked.valid, valid, summary);
  }
});

test("thin Prompt Lab check blocks stale Audit, invented references, and unsupported numbers", () => {
  const prepared = preparePromptLabInput();
  const { audit } = prepared;
  const output = synthesisFor(audit, [{
    title: "长任务占据了大部分用量",
    analysis: "该 Session 使用了 12345 Tokens。",
    evidenceRefs: ["summary:totalTokens", "summary:madeUp"],
    support: "strong",
    uncertainty: null,
  }]);
  output.audit = { ...audit, summary: { ...audit.summary, totalTokens: { value: 0, provenance: "reported" } } };
  output.auditFingerprint = "stale";
  const checked = validatePromptLabResult(prepared, output);
  assert.equal(checked.valid, false);
  assert.ok(checked.errors.some((error) => error.includes("fingerprint")));
  assert.ok(checked.errors.some((error) => error.includes("modify the Audit")));
  assert.ok(checked.errors.some((error) => error.includes("unknown or cross-Audit Evidence")));
  assert.ok(checked.errors.some((error) => error.includes("not supported by its cited Evidence")));
});

test("thin Prompt Lab check rejects unsupported Chinese zero numerals in cited overview prose", () => {
  const prepared = preparePromptLabInput();
  const { audit } = prepared;
  for (const summary of ["工具结果放大值是零。", "工具结果放大值是〇。"]) {
    const output = synthesisFor(audit);
    output.overview.summary = summary;
    output.overview.evidenceRefs = ["ranking:sessions:large"];
    const checked = validatePromptLabResult(prepared, output);
    assert.equal(checked.valid, false);
    assert.ok(checked.errors.some((error) => error.includes("not supported by its cited Evidence")));
  }
});

test("thin Prompt Lab check rejects numeric cost claims when cost is unavailable", () => {
  const prepared = preparePromptLabInput();
  const { audit } = prepared;
  for (const [summary, evidenceRefs] of [
    ["费用为 0。", ["check:data_quality"]],
    ["费用为 3。", ["summary:modelCallCount"]],
    ["费用为零。", ["check:data_quality"]],
    ["费用为〇。", ["summary:modelCallCount"]],
  ]) {
    const output = synthesisFor(audit);
    output.overview.summary = summary;
    output.overview.evidenceRefs = evidenceRefs;
    const checked = validatePromptLabResult(prepared, output);
    assert.equal(checked.valid, false);
    assert.ok(checked.errors.some((error) => error.includes("numeric cost while Audit cost is unavailable")));
  }
});

test("thin Prompt Lab check treats an unrelated zero as unsupported rather than a cost claim", () => {
  const prepared = preparePromptLabInput();
  const { audit } = prepared;
  const output = synthesisFor(audit);
  output.overview.summary = "费用不可用，但工具结果放大值为零。";
  output.overview.evidenceRefs = [];
  const checked = validatePromptLabResult(prepared, output);
  assert.equal(checked.valid, false);
  assert.ok(!checked.errors.some((error) => error.includes("numeric cost while Audit cost is unavailable")));
  assert.ok(checked.errors.some((error) => error.includes("overview.summary contains a number not supported by its cited Evidence")));
});

test("Key Session Prompt checks its selected Session, packet, and cited numeric facts", () => {
  const prepared = preparePromptLabInput("key-session-analysis");
  const valid = prepared.contentEvidencePackets.map((packet) => ({
    sessionId: packet.sessionId,
    auditFingerprint: prepared.inputSummary.auditFingerprint,
    taskContext: "当前固定样本未提供可识别任务的内容。",
    primaryFinding: null,
    recommendation: null,
    evidenceRead: {
      turnIds: packet.turnIds,
      selectionReason: packet.selectionReason,
      unreadScope: packet.unreadScope,
    },
    limitations: ["当前固定样本没有可读的 Session 内容，无法识别具体机制。"],
  }));
  assert.deepEqual(validatePromptLabResult(prepared, valid), { valid: true, errors: [] });

  const unsupported = structuredClone(valid);
  unsupported[0].primaryFinding = {
    observation: "该任务使用了 9999 Tokens。",
    interpretation: "这个数值说明了具体机制。",
    evidenceIds: ["turn:large:large-turn"],
    support: "strong",
    alternativeExplanations: [],
  };
  unsupported[0].recommendation = {
    action: "复查该任务。",
    rationale: "该数字值得核对。",
    applicability: "下一次同类任务。",
    tradeoff: null,
    verification: "比较后续同类任务。",
    targetEvidenceIds: ["turn:large:large-turn"],
  };
  const checked = validatePromptLabResult(prepared, unsupported);
  assert.equal(checked.valid, false);
  assert.ok(checked.errors.some((error) => error.includes("number not supported by its cited Evidence")));

  for (const field of ["action", "rationale", "applicability", "tradeoff", "verification"]) {
    const unsupportedRecommendation = structuredClone(valid);
    unsupportedRecommendation[0].recommendation = {
      action: "复查该任务。",
      rationale: "复查该任务。",
      applicability: "下一次同类任务。",
      tradeoff: "无需增加额外步骤。",
      verification: "比较后续同类任务。",
      targetEvidenceIds: ["turn:large:large-turn"],
    };
    unsupportedRecommendation[0].recommendation[field] = "减少9999 Tokens。";
    const recommendationCheck = validatePromptLabResult(prepared, unsupportedRecommendation);
    assert.ok(recommendationCheck.errors.some((error) => error.includes(`recommendation.${field} contains a number not supported by its cited Evidence`)));
  }

  const supportedRecommendation = structuredClone(valid);
  supportedRecommendation[0].recommendation = {
    action: "基于990 Tokens调整。",
    rationale: "复查该任务。",
    applicability: "下一次同类任务。",
    tradeoff: null,
    verification: "比较后续同类任务。",
    targetEvidenceIds: ["turn:large:large-turn"],
  };
  const supportedRecommendationCheck = validatePromptLabResult(prepared, supportedRecommendation);
  assert.ok(!supportedRecommendationCheck.errors.some((error) => error.includes("recommendation.action contains a number not supported by its cited Evidence")));
});

test("Skill Insights Prompt uses the bound Snapshot and its existing validator", () => {
  const prepared = preparePromptLabInput("skill-insights");
  const checked = validatePromptLabResult(prepared, { snapshotId: "stale-snapshot", insights: [] });
  assert.equal(checked.valid, false);
  assert.ok(checked.errors.some((error) => error.includes("snapshotId")));
});

test("one lane can declare fallback and replace a failed result without running sibling Prompts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-lab-"));
  const resultPath = path.join(dir, "result.json");
  const originalWrite = process.stdout.write;
  const run = (args) => {
    const chunks = [];
    process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };
    try {
      const code = main(args);
      return { code, output: JSON.parse(chunks.join("")) };
    } finally {
      process.stdout.write = originalWrite;
    }
  };
  try {
    const fallback = run(["--prompt", "key-session-analysis", "--fallback", "No model response was available."]);
    assert.equal(fallback.code, 0);
    assert.equal(fallback.output.inputSummary.prompt, "key-session-analysis");
    assert.deepEqual(fallback.output.check, {
      status: "fallback",
      valid: null,
      errors: [],
      reason: "No model response was available.",
    });
    assert.equal(Object.hasOwn(fallback.output, "modelInput"), false);

    const prepared = preparePromptLabInput("key-session-analysis");
    const replacement = prepared.contentEvidencePackets.map((packet) => ({
      sessionId: packet.sessionId,
      auditFingerprint: prepared.inputSummary.auditFingerprint,
      taskContext: "当前固定样本未提供可识别任务的内容。",
      primaryFinding: null,
      recommendation: null,
      evidenceRead: { turnIds: packet.turnIds, selectionReason: packet.selectionReason, unreadScope: packet.unreadScope },
      limitations: ["当前固定样本没有可读的 Session 内容。"],
    }));
    fs.writeFileSync(resultPath, JSON.stringify({ invalid: true }));
    const failed = run(["--prompt", "key-session-analysis", "--fixture", "partial-key-session", "--result", resultPath]);
    assert.equal(failed.code, 1);
    fs.writeFileSync(resultPath, JSON.stringify(replacement));
    const replaced = run(["--prompt", "key-session-analysis", "--fixture", "partial-key-session", "--result", resultPath]);
    assert.equal(replaced.code, 0);
    assert.equal(replaced.output.check.status, "pass");
    assert.deepEqual(replaced.output.aiOutput, replacement);
  } finally {
    process.stdout.write = originalWrite;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
