#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { auditFingerprint, resolveReportEvidence, validateKeySessionAnalysis } = require("../dist/src/key-session-analysis.js");
const { validateSkillInsights } = require("../dist/src/skill-insights.js");
const { buildLaneDirectory } = require("../dist/src/lane-contract.js");

const root = path.resolve(__dirname, "..");
const auditFixturePath = path.join(root, "tests", "fixtures", "prompt-lab", "report-synthesis-normal.json");
const promptConfigs = {
  "report-synthesis": {
    path: path.join(root, "prompts", "report-synthesis.md"),
    fixture: "normal-synthetic",
  },
  "key-session-analysis": {
    path: path.join(root, "prompts", "key-session-analysis.md"),
    fixture: "partial-key-session",
  },
  "skill-insights": {
    path: path.join(root, "prompts", "skill-insights.md"),
    fixture: "skill-insights-snapshot-v2",
  },
};

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function evidenceNumbers(matches) {
  const numbers = new Set();
  for (const match of matches) {
    for (const item of match.evidence) {
      if (isRecord(item) && item.provenance !== "unavailable" && typeof item.value === "number" && Number.isFinite(item.value)) {
        numbers.add(String(item.value));
      }
    }
  }
  return numbers;
}

function evidenceUnit(match, index) {
  if (match.kind === "summary") {
    if (["modelCallCount", "activeBranchModelCallCount"].includes(match.key)) return "model calls";
    if (match.key.endsWith("Tokens")) return "tokens";
    if (match.key.endsWith("Percent")) return "percent";
    if (["topProject", "topModel", "topTimeBucket"].includes(match.key)) return "tokens";
  }
  if (match.kind === "ranking" || match.kind === "turn") {
    if (match.kind === "ranking") return ["tokens", "percent", "model calls"][index] ?? null;
    return ["tokens", "percent", "model calls"][index] ?? null;
  }
  if (match.kind === "check") {
    const [checkId, evidenceIndex] = match.key.split(":");
    const selectedIndex = evidenceIndex === undefined ? index : Number(evidenceIndex);
    const units = {
      long_session: ["tokens", "model calls", "percent"],
      tool_amplification: [null, "model calls", "tokens"],
      model_concentration: ["tokens", "percent", "model calls"],
    };
    return units[checkId]?.[selectedIndex] ?? null;
  }
  return null;
}

function explicitUnit(text, endIndex, hasPercentSign) {
  if (hasPercentSign) return "percent";
  const rest = text.slice(endIndex);
  if (/^\s*(?:tokens?\b)/iu.test(rest)) return "tokens";
  if (/^\s*(?:percent(?:age)?\b)/iu.test(rest)) return "percent";
  if (/^\s*(?:(?:次\s*)?模型调用|model\s+calls?\b)/iu.test(rest)) return "model calls";
  return null;
}

function evidenceHasUnit(matches, value, unit) {
  return matches.some((match) => match.evidence.some((item, index) =>
    isRecord(item)
    && item.provenance !== "unavailable"
    && typeof item.value === "number"
    && Number.isFinite(item.value)
    && String(item.value) === value
    && evidenceUnit(match, index) === unit));
}

function numberClaims(text) {
  const claims = [];
  const pattern = /(?:(?<![\p{L}\p{N}_])|(?<=\p{Script=Han}))[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:%|％)?(?=$|[\s\p{P}\p{S}]|tokens?\b|percent(?:age)?\b|model\s+calls?\b|次\s*模型调用|模型调用)/gu;
  for (const match of text.matchAll(pattern)) {
    const number = Number(match[0].replace(/[,%％\s]/gu, ""));
    if (Number.isFinite(number)) {
      const raw = match[0].trim();
      claims.push({ raw, value: String(number), unit: explicitUnit(text, match.index + match[0].length, /[%％]/u.test(raw)), index: match.index });
    }
  }
  for (const match of text.matchAll(/(?:为|是)\s*([零〇])(?=$|[\s，。；、,.!?！？])/gu)) {
    const index = match.index + match[0].lastIndexOf(match[1]);
    claims.push({ raw: match[1], value: "0", unit: explicitUnit(text, index + match[1].length, false), index });
  }
  return claims;
}

function hasNumericCostClaim(text) {
  const cost = String.raw`(?:\b(?:cost|price|fee)\b|费用|成本|价格|金额)`;
  const amount = String.raw`(?:[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|[零〇])`;
  const relation = String.raw`(?:is|are|was|of|等于|为|是|约为|[:=])`;
  return new RegExp(`${cost}\\s*(?:${relation}\\s*)?${amount}(?![\\p{L}\\p{N}_])`, "iu").test(text)
    || new RegExp(`(?<![\\p{L}\\p{N}_])${amount}(?![\\p{L}\\p{N}_])\\s*${cost}`, "iu").test(text);
}

function validateReportSynthesisResult(audit, result) {
  const errors = [];
  const expectedFingerprint = auditFingerprint(audit);
  const reportedCost = resolveReportEvidence(audit, "summary:reportedCost");
  const auditCostUnavailable = reportedCost?.kind === "summary" && reportedCost.key === "reportedCost" && reportedCost.evidence.some((item) =>
    isRecord(item) && item.provenance === "unavailable" && item.value === null);
  if (!isRecord(result)) return { valid: false, errors: ["AI output must be a JSON object."] };

  if (result.auditFingerprint !== expectedFingerprint) errors.push("Audit fingerprint does not match the fixed input.");
  if (Object.hasOwn(result, "audit") || Object.hasOwn(result, "auditResult")) errors.push("AI output cannot replace or modify the Audit.");
  if (!isRecord(result.overview)) {
    errors.push("overview must be an object.");
  } else {
    if (!hasText(result.overview.summary)) errors.push("overview.summary must be non-empty.");
    if (!Array.isArray(result.overview.evidenceRefs) || result.overview.evidenceRefs.length === 0 || !result.overview.evidenceRefs.every(hasText)) {
      errors.push("overview.evidenceRefs must contain at least one reference.");
    }
  }
  if (!Array.isArray(result.findings)) errors.push("findings must be an array.");
  if (!Object.hasOwn(result, "noStrongFindingReason") || (result.noStrongFindingReason !== null && !hasText(result.noStrongFindingReason))) {
    errors.push("noStrongFindingReason must be null or non-empty text.");
  }
  if (Array.isArray(result.findings)) {
    for (const [index, finding] of result.findings.entries()) {
      if (!isRecord(finding)) {
        errors.push(`findings[${index}] must be an object.`);
        continue;
      }
      if (!hasText(finding.title)) errors.push(`findings[${index}].title must be non-empty.`);
      if (!hasText(finding.analysis)) errors.push(`findings[${index}].analysis must be non-empty.`);
      if (!Array.isArray(finding.evidenceRefs) || finding.evidenceRefs.length === 0 || !finding.evidenceRefs.every(hasText)) {
        errors.push(`findings[${index}].evidenceRefs must contain at least one reference.`);
      }
      if (!["strong", "moderate", "limited"].includes(finding.support)) errors.push(`findings[${index}].support is invalid.`);
      if (finding.uncertainty !== null && !hasText(finding.uncertainty)) errors.push(`findings[${index}].uncertainty must be null or non-empty text.`);
    }
  }

  const refsFor = (refs, label) => {
    if (!Array.isArray(refs)) return [];
    const matches = [];
    for (const ref of refs) {
      const match = resolveReportEvidence(audit, ref);
      if (!match) errors.push(`${label} cites unknown or cross-Audit Evidence: ${ref}`);
      else matches.push(match);
    }
    return matches;
  };
  const checkNumbers = (text, matches, label) => {
    if (!hasText(text)) return;
    const allowed = evidenceNumbers(matches);
    const identifiers = matches.map((match) => match.key).filter((value) => typeof value === "string" && value.length > 1);
    if (auditCostUnavailable && hasNumericCostClaim(text)) errors.push(`${label} states a numeric cost while Audit cost is unavailable.`);
    for (const claim of numberClaims(text)) {
      const insideIdentifier = identifiers.some((identifier) => {
        const start = text.indexOf(identifier);
        return start >= 0 && claim.index >= start && claim.index < start + identifier.length;
      });
      const supported = claim.unit
        ? evidenceHasUnit(matches, claim.value, claim.unit)
        : allowed.has(claim.value);
      if (!insideIdentifier && !supported) {
        errors.push(`${label} contains a number not supported by its cited Evidence: ${claim.raw}`);
      }
    }
  };

  const overviewMatches = isRecord(result.overview) ? refsFor(result.overview.evidenceRefs, "overview") : [];
  if (isRecord(result.overview)) checkNumbers(result.overview.summary, overviewMatches, "overview.summary");
  if (Array.isArray(result.findings)) {
    for (const [index, finding] of result.findings.entries()) {
      if (!isRecord(finding)) continue;
      const matches = refsFor(finding.evidenceRefs, `findings[${index}]`);
      checkNumbers(finding.title, matches, `findings[${index}].title`);
      checkNumbers(finding.analysis, matches, `findings[${index}].analysis`);
      checkNumbers(finding.uncertainty, matches, `findings[${index}].uncertainty`);
    }
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

function checkSupportedNumbers(text, matches, label) {
  const allowed = evidenceNumbers(matches);
  for (const claim of numberClaims(text)) {
    const supported = claim.unit
      ? evidenceHasUnit(matches, claim.value, claim.unit)
      : allowed.has(claim.value);
    if (!supported) return `${label} contains a number not supported by its cited Evidence: ${claim.raw}`;
  }
  return null;
}

function validateKeySessionResult(prepared, result) {
  const errors = [];
  if (!Array.isArray(result)) return { valid: false, errors: ["Key Session Analysis output must be a JSON array."] };
  for (const [index, analysis] of result.entries()) {
    if (!isRecord(analysis)) {
      errors.push(`analyses[${index}] must be an object.`);
      continue;
    }
    const packets = prepared.contentEvidencePackets.filter((packet) => packet.sessionId === analysis.sessionId);
    let validation;
    try {
      validation = validateKeySessionAnalysis(prepared.audit, analysis, packets);
    } catch {
      errors.push(`analyses[${index}] is malformed.`);
      continue;
    }
    errors.push(...validation.errors.map((error) => `analyses[${index}]: ${error}`));

    if (isRecord(analysis.primaryFinding) && Array.isArray(analysis.primaryFinding.evidenceIds)) {
      const matches = analysis.primaryFinding.evidenceIds
        .map((reference) => resolveReportEvidence(prepared.audit, reference))
        .filter(Boolean);
      for (const [field, text] of [
        ["observation", analysis.primaryFinding.observation],
        ["interpretation", analysis.primaryFinding.interpretation],
        ...((Array.isArray(analysis.primaryFinding.alternativeExplanations)
          ? analysis.primaryFinding.alternativeExplanations
          : []).map((value, alternativeIndex) => [`alternativeExplanations[${alternativeIndex}]`, value])),
      ]) {
        if (!hasText(text)) continue;
        const error = checkSupportedNumbers(text, matches, `analyses[${index}].primaryFinding.${field}`);
        if (error) errors.push(error);
      }
    }
    if (isRecord(analysis.recommendation) && Array.isArray(analysis.recommendation.targetEvidenceIds)) {
      const matches = analysis.recommendation.targetEvidenceIds
        .map((reference) => resolveReportEvidence(prepared.audit, reference))
        .filter(Boolean);
      for (const [field, text] of [
        ["action", analysis.recommendation.action],
        ["rationale", analysis.recommendation.rationale],
        ["applicability", analysis.recommendation.applicability],
        ["tradeoff", analysis.recommendation.tradeoff],
        ["verification", analysis.recommendation.verification],
      ]) {
        if (!hasText(text)) continue;
        const error = checkSupportedNumbers(text, matches, `analyses[${index}].recommendation.${field}`);
        if (error) errors.push(error);
      }
    }
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

function bindSkillInsightsPrompt(source, locale, snapshot) {
  const repeated = /\{\{#each skills\}\}([\s\S]*?)\{\{\/each\}\}/u;
  const loop = source.match(repeated);
  if (!loop) throw new Error("Skill Insights Prompt is missing its skills block.");
  const { directory } = buildLaneDirectory("skill-insights", {
    snapshot,
    hash: (value) => createHash("sha256").update(value).digest("hex"),
    locale,
  });
  const contentHandlesBySkill = new Map();
  for (const entry of directory.content) {
    if (!entry.skillHandle) continue;
    contentHandlesBySkill.set(entry.skillHandle, [...(contentHandlesBySkill.get(entry.skillHandle) ?? []), entry.handle]);
  }
  const skills = snapshot.selectedSkills.map((skill) => {
    const metadata = { ...skill };
    delete metadata.skillMdContent;
    const handle = directory.skills.find((entry) => entry.canonicalId === skill.skillId)?.handle ?? "unavailable";
    return loop[1]
      .replaceAll("{{skillHandle}}", handle)
      .replaceAll("{{contentHandles}}", (contentHandlesBySkill.get(handle) ?? []).join(", ") || "unavailable")
      .replaceAll("{{skillId}}", skill.skillId)
      .replaceAll("{{skillName}}", skill.skillName)
      .replaceAll("{{skillPath}}", skill.skillPath ?? "unavailable")
      .replaceAll("{{contentState}}", skill.contentState)
      .replaceAll("{{metadataJson}}", JSON.stringify(metadata, null, 2))
      .replaceAll("{{skillMdContent}}", skill.skillMdContent ?? "");
  }).join("\n\n");
  return source.replace(repeated, skills)
    .replaceAll("{{reportLocale}}", locale)
    .replaceAll("{{analysisPeriod}}", "fixed Prompt Lab snapshot")
    .replaceAll("{{skillSnapshotId}}", snapshot.snapshotId)
    .replaceAll("{{directoryJson}}", JSON.stringify(directory, null, 2))
    .replaceAll("{{globalUsageJson}}", JSON.stringify(snapshot.globalUsage, null, 2))
    .replaceAll("{{candidateJson}}", JSON.stringify(snapshot.selectedCandidates, null, 2));
}

function bindAuditPrompt(source, promptName, locale, audit, fingerprint, packets = []) {
  // Contract v2: the model receives the frozen Evidence Directory instead of echoing
  // code-owned identity fields. Prompt Lab builds the same directory shape the Run
  // projection carries so the Fast Loop reads the current Prompt truthfully.
  const lane = promptName === "key-session-analysis" ? "key-session-analysis" : "report-synthesis";
  const { directory } = buildLaneDirectory(lane, {
    audit,
    turns: audit.turns ?? [],
    sessions: (audit.rankings?.sessions ?? []).slice(0, 3),
    hash: (value) => createHash("sha256").update(value).digest("hex"),
    locale,
  });
  let prompt = source
    .replaceAll("{{locale}}", locale)
    .replaceAll("{{directoryJson}}", JSON.stringify(directory, null, 2))
    .replaceAll("{{auditResultJson}}", JSON.stringify(audit, null, 2))
    .replaceAll("{{auditFingerprint}}", fingerprint);
  if (promptName === "key-session-analysis") {
    prompt = prompt.replaceAll("{{contentEvidencePacketsJson}}", JSON.stringify(packets, null, 2));
  }
  if (/\{\{(?:locale|auditFingerprint|auditResultJson|directoryJson|contentEvidencePacketsJson)\}\}/u.test(prompt)) {
    throw new Error("Prompt Lab left an unbound runtime value.");
  }
  return prompt;
}

function preparePromptLabInput(promptName = "report-synthesis", fixtureName = null) {
  const config = promptConfigs[promptName];
  if (!config) throw new Error(`Unknown Prompt: ${promptName}`);
  const selectedFixture = fixtureName ?? config.fixture;
  if (selectedFixture !== config.fixture) throw new Error(`This Prompt supports only --fixture ${config.fixture}.`);
  const sourcePrompt = fs.readFileSync(config.path, "utf8");

  if (promptName === "skill-insights") {
    const snapshotPath = path.join(root, "evals", "fixtures", "skill-insights-snapshot-v2.json");
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    if (!isRecord(snapshot) || snapshot.snapshotId !== "fixture-skill-snapshot-v2") {
      throw new Error("Skill Insights Prompt Lab fixture is malformed.");
    }
    const modelInput = bindSkillInsightsPrompt(sourcePrompt, "zh-CN", snapshot);
    if (/\{\{(?:reportLocale|analysisPeriod|skillSnapshotId|globalUsageJson|candidateJson|#each skills|\/each|skillId|skillName|skillPath|contentState|metadataJson|skillMdContent)\}\}/u.test(modelInput)) {
      throw new Error("Prompt Lab left an unbound Skill Insights value.");
    }
    return {
      promptName,
      snapshot,
      inputSummary: {
        prompt: promptName,
        fixture: selectedFixture,
        locale: "zh-CN",
        auditFingerprint: snapshot.auditFingerprint,
        snapshotId: snapshot.snapshotId,
        promptBytes: Buffer.byteLength(sourcePrompt),
        evidenceBytes: Buffer.byteLength(JSON.stringify(snapshot)),
        inputBytes: Buffer.byteLength(modelInput),
      },
      modelInput,
    };
  }

  const fixture = JSON.parse(fs.readFileSync(auditFixturePath, "utf8"));
  if (fixture.id !== "normal-synthetic" || !isRecord(fixture.auditResult) || !hasText(fixture.locale)) {
    throw new Error("Prompt Lab Audit fixture is malformed.");
  }
  const audit = fixture.auditResult;
  const fingerprint = auditFingerprint(audit);
  if (promptName === "key-session-analysis") {
    const caseFixture = JSON.parse(fs.readFileSync(path.join(root, "evals", "fixtures", "partial-key-session.json"), "utf8"));
    const contentEvidencePackets = fixture.contentEvidencePackets;
    if (caseFixture.case !== selectedFixture || caseFixture.lane !== promptName || !Array.isArray(contentEvidencePackets)) {
      throw new Error("Key Session Analysis Prompt Lab fixture is malformed.");
    }
    const modelInput = bindAuditPrompt(sourcePrompt, promptName, fixture.locale, audit, fingerprint, contentEvidencePackets);
    return {
      promptName,
      audit,
      contentEvidencePackets,
      inputSummary: {
        prompt: promptName,
        fixture: selectedFixture,
        locale: fixture.locale,
        auditFingerprint: fingerprint,
        promptBytes: Buffer.byteLength(sourcePrompt),
        auditBytes: Buffer.byteLength(JSON.stringify(audit)),
        evidenceBytes: Buffer.byteLength(JSON.stringify(contentEvidencePackets)),
        inputBytes: Buffer.byteLength(modelInput),
      },
      modelInput,
    };
  }

  const modelInput = bindAuditPrompt(sourcePrompt, promptName, fixture.locale, audit, fingerprint);
  return {
    promptName,
    audit,
    inputSummary: {
      prompt: promptName,
      fixture: selectedFixture,
      locale: fixture.locale,
      auditFingerprint: fingerprint,
      promptBytes: Buffer.byteLength(sourcePrompt),
      auditBytes: Buffer.byteLength(JSON.stringify(audit)),
      inputBytes: Buffer.byteLength(modelInput),
    },
    modelInput,
  };
}

function validatePromptLabResult(prepared, result) {
  if (prepared.promptName === "report-synthesis") return validateReportSynthesisResult(prepared.audit, result);
  if (prepared.promptName === "key-session-analysis") return validateKeySessionResult(prepared, result);
  if (prepared.promptName === "skill-insights") {
    const validation = validateSkillInsights(result, prepared.snapshot);
    return { valid: validation.valid, errors: validation.errors };
  }
  return { valid: false, errors: ["Unknown Prompt."] };
}

function outputReferences(promptName, result) {
  const refs = [];
  if (promptName === "report-synthesis") {
    if (isRecord(result?.overview) && Array.isArray(result.overview.evidenceRefs)) refs.push(...result.overview.evidenceRefs);
    if (Array.isArray(result?.findings)) {
      for (const finding of result.findings) if (isRecord(finding) && Array.isArray(finding.evidenceRefs)) refs.push(...finding.evidenceRefs);
    }
  } else if (promptName === "key-session-analysis" && Array.isArray(result)) {
    for (const analysis of result) {
      if (isRecord(analysis?.primaryFinding) && Array.isArray(analysis.primaryFinding.evidenceIds)) refs.push(...analysis.primaryFinding.evidenceIds);
      if (isRecord(analysis?.recommendation) && Array.isArray(analysis.recommendation.targetEvidenceIds)) refs.push(...analysis.recommendation.targetEvidenceIds);
    }
  } else if (promptName === "skill-insights" && Array.isArray(result?.insights)) {
    for (const insight of result.insights) {
      if (isRecord(insight?.reveal) && Array.isArray(insight.reveal.evidenceRefs)) refs.push(...insight.reveal.evidenceRefs);
    }
  }
  return [...new Set(refs.filter((ref) => typeof ref === "string"))];
}

function parseArgs(args) {
  const options = { prompt: "report-synthesis", fixture: null, result: null, fallback: null, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--help" || flag === "-h") options.help = true;
    else if (flag === "--prompt" || flag === "--fixture" || flag === "--result" || flag === "--fallback") {
      if (!args[index + 1]) throw new Error(`${flag} requires a value.`);
      const name = flag.slice(2);
      options[name] = args[++index];
    } else throw new Error(`Unknown argument: ${flag}`);
  }
  const config = promptConfigs[options.prompt];
  if (!config) throw new Error(`Unknown Prompt: ${options.prompt}`);
  if (options.fixture !== null && options.fixture !== config.fixture) throw new Error(`This Prompt supports only --fixture ${config.fixture}.`);
  if (options.result && options.fallback) throw new Error("Choose either --result or --fallback.");
  if (options.fallback !== null && !hasText(options.fallback)) throw new Error("--fallback requires a non-empty reason.");
  options.fixture ??= config.fixture;
  return options;
}

function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write([
      "Usage: npm run prompt:lab -- --prompt <report-synthesis|key-session-analysis|skill-insights> [--fixture <fixed-fixture>] [--result <model-output.json> | --fallback <reason>]",
      "Fixtures: report-synthesis=normal-synthetic, key-session-analysis=partial-key-session, skill-insights=skill-insights-snapshot-v2",
      "Runs one selected Prompt per invocation; review wording and usefulness manually.",
      "",
    ].join("\n"));
    return 0;
  }

  const prepared = preparePromptLabInput(options.prompt, options.fixture);
  let aiOutput = null;
  let check = { status: "awaiting-model-output", valid: null, errors: [] };
  if (options.result) {
    aiOutput = JSON.parse(fs.readFileSync(path.resolve(options.result), "utf8"));
    const validation = validatePromptLabResult(prepared, aiOutput);
    check = { status: validation.valid ? "pass" : "fail", ...validation };
  } else if (options.fallback) {
    check = { status: "fallback", valid: null, errors: [], reason: options.fallback };
  }
  const needsModelOutput = !options.result && !options.fallback;
  const output = {
    inputSummary: prepared.inputSummary,
    ...(needsModelOutput ? { modelInput: prepared.modelInput } : {}),
    ...(needsModelOutput ? { hostAgentAction: `Send only this ${options.prompt} input to the Host Agent once, then rerun with --prompt ${options.prompt} --fixture ${options.fixture} --result <model-output.json>.` } : {}),
    aiOutput,
    evidenceReferences: outputReferences(options.prompt, aiOutput),
    check,
  };
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  return check.status === "fail" ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  }
}

module.exports = { main, preparePromptLabInput, validatePromptLabResult };
