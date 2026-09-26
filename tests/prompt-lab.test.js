const assert = require("node:assert/strict");
const test = require("node:test");
const { preparePromptLabInput, validatePromptLabResult } = require("../scripts/prompt-lab.js");

function synthesisFor(audit, findings = []) {
  const { auditFingerprint } = require("../dist/src/key-session-analysis.js");
  return {
    auditFingerprint: auditFingerprint(audit),
    overview: { summary: "整体用量集中在一个 Session。", evidenceRefs: ["summary:totalTokens"] },
    findings,
    noStrongFindingReason: findings.length === 0 ? "当前固定案例只支持一个明显模式。" : null,
  };
}

test("Prompt Lab binds only the source Report Synthesis Prompt and fixed Audit", () => {
  const prepared = preparePromptLabInput();
  assert.equal(prepared.inputSummary.prompt, "report-synthesis");
  assert.equal(prepared.inputSummary.fixture, "normal-synthetic");
  assert.match(prepared.modelInput, /auditFingerprint/);
  assert.match(prepared.modelInput, new RegExp(prepared.inputSummary.auditFingerprint));
  assert.doesNotMatch(prepared.modelInput, /\{\{(?:locale|auditFingerprint|auditResultJson)\}\}/u);
});

test("thin Prompt Lab check leaves Finding count and prose semantics to review", () => {
  const { audit } = preparePromptLabInput();
  const oneFinding = { title: "长任务占据了大部分用量", analysis: "该 Session 使用了 1000 Tokens。", evidenceRefs: ["summary:totalTokens"], support: "strong", uncertainty: null };
  for (const findings of [[], [oneFinding], [oneFinding, oneFinding]]) {
    assert.deepEqual(validatePromptLabResult(audit, synthesisFor(audit, findings)), { valid: true, errors: [] });
  }
});

test("thin Prompt Lab check matches explicit units to cited Evidence fields", () => {
  const { audit } = preparePromptLabInput();
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
    const checked = validatePromptLabResult(audit, output);
    assert.equal(checked.valid, valid, summary);
  }
});

test("thin Prompt Lab check blocks stale Audit, invented references, and unsupported numbers", () => {
  const { audit } = preparePromptLabInput();
  const output = synthesisFor(audit, [{
    title: "长任务占据了大部分用量",
    analysis: "该 Session 使用了 12345 Tokens。",
    evidenceRefs: ["summary:totalTokens", "summary:madeUp"],
    support: "strong",
    uncertainty: null,
  }]);
  output.audit = { ...audit, summary: { ...audit.summary, totalTokens: { value: 0, provenance: "reported" } } };
  output.auditFingerprint = "stale";
  const checked = validatePromptLabResult(audit, output);
  assert.equal(checked.valid, false);
  assert.ok(checked.errors.some((error) => error.includes("fingerprint")));
  assert.ok(checked.errors.some((error) => error.includes("modify the Audit")));
  assert.ok(checked.errors.some((error) => error.includes("unknown or cross-Audit Evidence")));
  assert.ok(checked.errors.some((error) => error.includes("not supported by its cited Evidence")));
});

test("thin Prompt Lab check rejects unsupported Chinese zero numerals in cited overview prose", () => {
  const { audit } = preparePromptLabInput();
  for (const summary of ["工具结果放大值是零。", "工具结果放大值是〇。"]) {
    const output = synthesisFor(audit);
    output.overview.summary = summary;
    output.overview.evidenceRefs = ["ranking:sessions:large"];
    const checked = validatePromptLabResult(audit, output);
    assert.equal(checked.valid, false);
    assert.ok(checked.errors.some((error) => error.includes("not supported by its cited Evidence")));
  }
});

test("thin Prompt Lab check rejects numeric cost claims when cost is unavailable", () => {
  const { audit } = preparePromptLabInput();
  for (const [summary, evidenceRefs] of [
    ["费用为 0。", ["check:data_quality"]],
    ["费用为 3。", ["summary:modelCallCount"]],
    ["费用为零。", ["check:data_quality"]],
    ["费用为〇。", ["summary:modelCallCount"]],
  ]) {
    const output = synthesisFor(audit);
    output.overview.summary = summary;
    output.overview.evidenceRefs = evidenceRefs;
    const checked = validatePromptLabResult(audit, output);
    assert.equal(checked.valid, false);
    assert.ok(checked.errors.some((error) => error.includes("numeric cost while Audit cost is unavailable")));
  }
});

test("thin Prompt Lab check treats an unrelated zero as unsupported rather than a cost claim", () => {
  const { audit } = preparePromptLabInput();
  const output = synthesisFor(audit);
  output.overview.summary = "费用不可用，但工具结果放大值为零。";
  output.overview.evidenceRefs = [];
  const checked = validatePromptLabResult(audit, output);
  assert.equal(checked.valid, false);
  assert.ok(!checked.errors.some((error) => error.includes("numeric cost while Audit cost is unavailable")));
  assert.ok(checked.errors.some((error) => error.includes("overview.summary contains a number not supported by its cited Evidence")));
});
