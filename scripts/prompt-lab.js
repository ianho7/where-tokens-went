#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { auditFingerprint, resolveReportEvidence } = require("../dist/src/key-session-analysis.js");

const root = path.resolve(__dirname, "..");
const promptPath = path.join(root, "prompts", "report-synthesis.md");
const fixturePath = path.join(root, "tests", "fixtures", "prompt-lab", "report-synthesis-normal.json");
const promptName = "report-synthesis";
const fixtureName = "normal-synthetic";

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

function numberClaims(text) {
  const claims = [];
  const pattern = /(?<![\p{L}\p{N}_])[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:%|％)?(?![\p{L}\p{N}_])/gu;
  for (const match of text.matchAll(pattern)) {
    const number = Number(match[0].replace(/[,%％\s]/gu, ""));
    if (Number.isFinite(number)) claims.push({ raw: match[0].trim(), value: String(number), index: match.index });
  }
  for (const match of text.matchAll(/(?:为|是)\s*([零〇])(?=$|[\s，。；、,.!?！？])/gu)) {
    claims.push({ raw: match[1], value: "0", index: match.index + match[0].lastIndexOf(match[1]) });
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

function validatePromptLabResult(audit, result) {
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
      if (!insideIdentifier && !allowed.has(claim.value)) errors.push(`${label} contains a number not supported by its cited Evidence: ${claim.raw}`);
    }
  };

  const overviewMatches = isRecord(result.overview) ? refsFor(result.overview.evidenceRefs, "overview") : [];
  if (isRecord(result.overview)) checkNumbers(result.overview.summary, overviewMatches, "overview.summary");
  if (hasText(result.noStrongFindingReason)) checkNumbers(result.noStrongFindingReason, [], "noStrongFindingReason");
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

function preparePromptLabInput() {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  if (fixture.id !== fixtureName || !isRecord(fixture.auditResult) || !hasText(fixture.locale)) throw new Error("Prompt Lab fixture is malformed.");
  const audit = fixture.auditResult;
  const fingerprint = auditFingerprint(audit);
  const prompt = fs.readFileSync(promptPath, "utf8")
    .replaceAll("{{locale}}", fixture.locale)
    .replaceAll("{{auditFingerprint}}", fingerprint)
    .replaceAll("{{auditResultJson}}", JSON.stringify(audit, null, 2));
  if (/\{\{(?:locale|auditFingerprint|auditResultJson)\}\}/u.test(prompt)) throw new Error("Prompt Lab left an unbound runtime value.");
  return {
    audit,
    inputSummary: {
      prompt: promptName,
      fixture: fixture.id,
      locale: fixture.locale,
      auditFingerprint: fingerprint,
      promptBytes: Buffer.byteLength(prompt),
      auditBytes: Buffer.byteLength(JSON.stringify(audit)),
    },
    modelInput: prompt,
  };
}

function outputReferences(result) {
  const refs = [];
  if (isRecord(result?.overview) && Array.isArray(result.overview.evidenceRefs)) refs.push(...result.overview.evidenceRefs);
  if (Array.isArray(result?.findings)) {
    for (const finding of result.findings) if (isRecord(finding) && Array.isArray(finding.evidenceRefs)) refs.push(...finding.evidenceRefs);
  }
  return [...new Set(refs.filter((ref) => typeof ref === "string"))];
}

function parseArgs(args) {
  const options = { prompt: promptName, fixture: fixtureName, result: null, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--help" || flag === "-h") options.help = true;
    else if (flag === "--prompt" || flag === "--fixture" || flag === "--result") {
      if (!args[index + 1]) throw new Error(`${flag} requires a value.`);
      options[flag.slice(2)] = args[++index];
    } else throw new Error(`Unknown argument: ${flag}`);
  }
  if (options.prompt !== promptName) throw new Error(`This Ticket supports only --prompt ${promptName}.`);
  if (options.fixture !== fixtureName) throw new Error(`This Ticket supports only --fixture ${fixtureName}.`);
  return options;
}

function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write("Usage: npm run prompt:lab -- [--prompt report-synthesis] [--fixture normal-synthetic] [--result <model-output.json>]\n");
    return 0;
  }

  const prepared = preparePromptLabInput();
  let aiOutput = null;
  let check = { status: "awaiting-model-output", valid: null, errors: [] };
  if (options.result) {
    aiOutput = JSON.parse(fs.readFileSync(path.resolve(options.result), "utf8"));
    const validation = validatePromptLabResult(prepared.audit, aiOutput);
    check = { status: validation.valid ? "pass" : "fail", ...validation };
  }
  const output = {
    inputSummary: prepared.inputSummary,
    ...(options.result ? {} : { modelInput: prepared.modelInput }),
    ...(!options.result ? { hostAgentAction: "Send modelInput to the Host Agent once, then rerun with --result <model-output.json>." } : {}),
    aiOutput,
    evidenceReferences: outputReferences(aiOutput),
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
