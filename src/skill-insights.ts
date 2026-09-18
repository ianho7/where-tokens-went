import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  CallsPerTaskDistribution,
  DominantFamilyCandidate,
  GlobalSkillUsage,
  Harness,
  SkillAnalysisEntry,
  SkillCandidate,
  SkillCandidatesResult,
  SkillCandidateType,
  SkillContentSnapshot,
  SkillDerivedMetrics,
  SkillSnapshotArtifact,
  SkillInsightType,
  SkillInsightEvidence,
  ValidatedSkillInsight,
} from "./types";

function skillCalls(skill: SkillAnalysisEntry): number {
  return typeof skill.invocationCount?.value === "number" ? skill.invocationCount.value : 0;
}

function skillTasks(skill: SkillAnalysisEntry): number {
  return typeof skill.sessionCount?.value === "number" ? skill.sessionCount.value : 0;
}

export function calculatePercentileLinear(values: number[], p: number): number {
  if (!values || values.length === 0) return 0;
  if (values.length === 1) return Math.round(values[0] * 100) / 100;
  const clampedP = Math.max(0, Math.min(1, p));
  const index = clampedP * (values.length - 1);
  const lower = Math.floor(index);
  const fraction = index - lower;
  if (lower >= values.length - 1) {
    return Math.round(values[values.length - 1] * 100) / 100;
  }
  const val = values[lower] + fraction * (values[lower + 1] - values[lower]);
  return Math.round(val * 100) / 100;
}

export function deriveSkillMetrics(
  skills: SkillAnalysisEntry[],
  totalTasks: number,
): { global: GlobalSkillUsage; perSkill: Map<string, SkillDerivedMetrics> } {
  const perSkill = new Map<string, SkillDerivedMetrics>();

  const activeSkills = (skills || []).filter((s) => skillCalls(s) > 0);
  const totalSkillCalls = activeSkills.reduce((sum, s) => sum + skillCalls(s), 0);
  const totalSkillsUsed = activeSkills.length;
  const effectiveTotalTasks = totalTasks > 0 ? totalTasks : Math.max(1, ...skills.map(skillTasks));

  if (activeSkills.length === 0) {
    return {
      global: {
        totalSkillsUsed: 0,
        totalSkillCalls: 0,
        totalTasks: Math.max(0, totalTasks),
        callsPerTaskDistribution: { median: 0, p75: 0, p90: 0, max: 0 },
        top4CallShare: 0,
        lowFrequencySkillShare: 0,
        lowFrequencyCallShare: 0,
        singleUseSkillShare: 0,
        dominantFamily: null,
      },
      perSkill,
    };
  }

  const sortedByCalls = [...activeSkills].sort((a, b) => skillCalls(b) - skillCalls(a));
  const sortedByTasks = [...activeSkills].sort((a, b) => skillTasks(b) - skillTasks(a));

  const callRanks = new Map<string, number>();
  sortedByCalls.forEach((s, idx) => callRanks.set(s.name, idx + 1));
  const taskRanks = new Map<string, number>();
  sortedByTasks.forEach((s, idx) => taskRanks.set(s.name, idx + 1));

  for (const skill of skills) {
    const calls = skillCalls(skill);
    const tasks = skillTasks(skill);
    const callShare = totalSkillCalls > 0 ? calls / totalSkillCalls : 0;
    const callsPerTask = tasks > 0 ? calls / tasks : (calls > 0 ? calls : 0);
    const taskCoverage = effectiveTotalTasks > 0 ? Math.min(1, tasks / effectiveTotalTasks) : 0;

    perSkill.set(skill.name, {
      calls,
      tasks,
      callShare,
      callsPerTask,
      taskCoverage,
      rankByCalls: callRanks.get(skill.name) ?? skills.length,
      rankByTasks: taskRanks.get(skill.name) ?? skills.length,
      associatedTokens: typeof skill.attributedTokens?.value === "number" ? skill.attributedTokens.value : null,
      associatedCost: typeof skill.attributedApiEquivalentCost?.value === "number" ? skill.attributedApiEquivalentCost.value : null,
    });
  }

  // Distribution Context: only for skills with tasks > 0 and calls > 0
  const validCallsPerTask = activeSkills
    .filter((s) => skillTasks(s) > 0)
    .map((s) => skillCalls(s) / skillTasks(s))
    .sort((a, b) => a - b);

  const callsPerTaskDistribution: CallsPerTaskDistribution = {
    median: calculatePercentileLinear(validCallsPerTask, 0.5),
    p75: calculatePercentileLinear(validCallsPerTask, 0.75),
    p90: calculatePercentileLinear(validCallsPerTask, 0.9),
    max: validCallsPerTask.length > 0 ? Math.round(validCallsPerTask[validCallsPerTask.length - 1] * 100) / 100 : 0,
  };

  // Global topology metrics
  const top4Count = Math.min(4, totalSkillsUsed);
  const top4Calls = sortedByCalls.slice(0, top4Count).reduce((sum, s) => sum + skillCalls(s), 0);
  const top4CallShare = totalSkillCalls > 0 ? Math.round((top4Calls / totalSkillCalls) * 10000) / 10000 : 0;

  const lowFrequencySkills = activeSkills.filter((s) => skillCalls(s) <= 5);
  const lowFrequencySkillShare = totalSkillsUsed > 0 ? Math.round((lowFrequencySkills.length / totalSkillsUsed) * 10000) / 10000 : 0;
  const lowFrequencyCalls = lowFrequencySkills.reduce((sum, s) => sum + skillCalls(s), 0);
  const lowFrequencyCallShare = totalSkillCalls > 0 ? Math.round((lowFrequencyCalls / totalSkillCalls) * 10000) / 10000 : 0;

  const singleUseSkills = activeSkills.filter((s) => skillCalls(s) === 1);
  const singleUseSkillShare = totalSkillsUsed > 0 ? Math.round((singleUseSkills.length / totalSkillsUsed) * 10000) / 10000 : 0;

  // Sampling Group / Family candidate grouping
  const samplingGroups = detectSamplingGroups(activeSkills);
  let dominantFamily: DominantFamilyCandidate | null = null;
  let highestFamilyCalls = 0;

  for (const [stem, members] of samplingGroups.entries()) {
    const familyCalls = members.reduce((sum, name) => sum + (perSkill.get(name)?.calls ?? 0), 0);
    if (familyCalls > highestFamilyCalls && familyCalls > 0) {
      highestFamilyCalls = familyCalls;
      dominantFamily = {
        groupId: stem,
        memberSkillIds: members,
        callShare: totalSkillCalls > 0 ? Math.round((familyCalls / totalSkillCalls) * 10000) / 10000 : 0,
      };
    }
  }

  const global: GlobalSkillUsage = {
    totalSkillsUsed,
    totalSkillCalls,
    totalTasks: Math.max(0, totalTasks),
    callsPerTaskDistribution,
    top4CallShare,
    lowFrequencySkillShare,
    lowFrequencyCallShare,
    singleUseSkillShare,
    dominantFamily,
  };

  return { global, perSkill };
}

function detectSamplingGroups(skills: SkillAnalysisEntry[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const skill of skills) {
    const name = skill.name;
    if (!name || name === "<unknown-skill>") continue;
    const parts = name.split(/[-_]/);
    if (parts.length >= 2) {
      const stem = parts.slice(0, -1).join("-");
      if (stem.length >= 3) {
        const list = groups.get(stem) ?? [];
        list.push(name);
        groups.set(stem, list);
      }
    }
  }

  const result = new Map<string, string[]>();
  for (const [stem, members] of groups.entries()) {
    if (members.length >= 2) {
      result.set(stem, [...new Set(members)]);
    }
  }
  return result;
}

export function selectSkillCandidates(
  skills: SkillAnalysisEntry[],
  totalTasks: number,
): SkillCandidatesResult {
  const { global, perSkill } = deriveSkillMetrics(skills, totalTasks);
  const selectedMap = new Map<string, SkillCandidate>();

  function addCandidate(skillName: string, type: SkillCandidateType, signals: SkillCandidate["signals"]) {
    if (selectedMap.size >= 5 && !selectedMap.has(skillName)) return false;
    let existing = selectedMap.get(skillName);
    if (!existing) {
      existing = {
        skillId: skillName,
        skillName,
        candidateTypes: [type],
        signals: { ...signals },
      };
      selectedMap.set(skillName, existing);
    } else {
      if (!existing.candidateTypes.includes(type)) {
        existing.candidateTypes.push(type);
      }
      existing.signals = { ...existing.signals, ...signals };
    }
    return true;
  }

  const activeSkills = (skills || []).filter((s) => skillCalls(s) > 0);
  const sortedByCalls = [...activeSkills].sort((a, b) => skillCalls(b) - skillCalls(a));
  const dominantMembers = new Set(global.dominantFamily?.memberSkillIds ?? []);

  // 1. Dominant family slots: at most 2 documents from dominant family
  if (global.dominantFamily) {
    const sortedFamilyMembers = [...global.dominantFamily.memberSkillIds]
      .sort((a, b) => (perSkill.get(b)?.calls ?? 0) - (perSkill.get(a)?.calls ?? 0));

    for (const member of sortedFamilyMembers.slice(0, 2)) {
      const m = perSkill.get(member);
      if (!m || m.calls <= 0) continue;
      addCandidate(member, "skill_family", {
        familyGroup: global.dominantFamily.groupId,
        callShare: m.callShare,
        callsPerTask: m.callsPerTask,
        rankByCalls: m.rankByCalls,
      });
    }
  }

  // 2. Non-dominant high-frequency skill: priority 1 slot (if exists)
  const nonDominantByCalls = sortedByCalls.filter((s) => !dominantMembers.has(s.name));
  if (nonDominantByCalls.length > 0) {
    const topNonDom = nonDominantByCalls[0];
    const m = perSkill.get(topNonDom.name)!;
    addCandidate(topNonDom.name, "high_frequency", {
      callShare: m.callShare,
      callsPerTask: m.callsPerTask,
      rankByCalls: m.rankByCalls,
    });
  }

  // 3. Non-dominant callsPerTask outlier: priority 1 slot (if exists, calls >= 3, callsPerTask >= p75)
  const outlierCandidates = nonDominantByCalls
    .filter((s) => {
      const m = perSkill.get(s.name);
      return (
        m &&
        m.calls >= 3 &&
        m.callsPerTask >= global.callsPerTaskDistribution.p75 &&
        !selectedMap.has(s.name)
      );
    })
    .sort((a, b) => (perSkill.get(b.name)?.callsPerTask ?? 0) - (perSkill.get(a.name)?.callsPerTask ?? 0));

  if (outlierCandidates.length > 0) {
    const topOutlier = outlierCandidates[0];
    const m = perSkill.get(topOutlier.name)!;
    addCandidate(topOutlier.name, "high_calls_per_task", {
      callsPerTask: m.callsPerTask,
      isOutlier: true,
      rankByCalls: m.rankByCalls,
    });
  }

  // 4. Optional diversity slot 5 (only if valid candidate exists, do NOT force fill)
  if (selectedMap.size < 5) {
    const remainingCandidates = nonDominantByCalls.filter((s) => !selectedMap.has(s.name));
    if (remainingCandidates.length > 0) {
      const extra = remainingCandidates[0];
      const m = perSkill.get(extra.name)!;
      addCandidate(extra.name, "high_frequency", {
        callShare: m.callShare,
        callsPerTask: m.callsPerTask,
        rankByCalls: m.rankByCalls,
      });
    }
  }

  return { global, candidates: [...selectedMap.values()] };
}

export async function resolveSkillPath(
  harness: Harness,
  cwd: string | null,
  skillName: string,
): Promise<string | null> {
  if (!skillName || typeof skillName !== "string") return null;
  const sanitized = skillName.trim();
  if (!sanitized || sanitized.includes("..") || sanitized.includes("/") || sanitized.includes("\\")) {
    return null;
  }

  const searchPaths: string[] = [];
  if (cwd) {
    searchPaths.push(path.join(cwd, "." + harness, "skills", sanitized, "SKILL.md"));
    searchPaths.push(path.join(cwd, ".agents", "skills", sanitized, "SKILL.md"));
  }
  searchPaths.push(path.join(os.homedir(), "." + harness, "skills", sanitized, "SKILL.md"));
  searchPaths.push(path.join(os.homedir(), ".agents", "skills", sanitized, "SKILL.md"));

  for (const candidatePath of searchPaths) {
    try {
      const stats = await stat(candidatePath);
      if (stats.isFile()) {
        return candidatePath;
      }
    } catch {
      // Continue to next candidate
    }
  }

  return null;
}

export async function loadSkillSnapshot(
  harness: Harness,
  cwd: string | null,
  candidates: SkillCandidate[],
  auditFingerprint: string,
  globalUsage: GlobalSkillUsage,
): Promise<SkillSnapshotArtifact> {
  const selectedSkills: SkillContentSnapshot[] = [];

  for (const candidate of candidates) {
    const resolvedPath = await resolveSkillPath(harness, cwd, candidate.skillName);
    if (!resolvedPath) {
      selectedSkills.push({
        skillId: candidate.skillId,
        skillName: candidate.skillName,
        skillPath: null,
        contentState: "unavailable",
        skillMdBytes: 0,
        skillMdEstimatedTokens: 0,
        skillMdHash: null,
        skillMdContent: null,
        referenceCount: 0,
        referenceBytes: 0,
        referenceFiles: [],
      });
      continue;
    }

    try {
      const skillMdContent = await readFile(resolvedPath, "utf8");
      const skillMdBytes = Buffer.byteLength(skillMdContent, "utf8");
      const skillMdEstimatedTokens = Math.ceil(skillMdBytes / 3.6);
      const skillMdHash = createHash("sha256").update(skillMdContent).digest("hex");

      const skillDir = path.dirname(resolvedPath);
      const refDir = path.join(skillDir, "references");
      let referenceCount = 0;
      let referenceBytes = 0;
      const referenceFiles: string[] = [];

      try {
        const refStats = await stat(refDir);
        if (refStats.isDirectory()) {
          const entries = await readdir(refDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isFile()) {
              referenceFiles.push(entry.name);
              const fileStats = await stat(path.join(refDir, entry.name));
              referenceBytes += fileStats.size;
            }
          }
          referenceCount = referenceFiles.length;
          referenceFiles.sort();
        }
      } catch {
        // No references directory or unreadable
      }

      selectedSkills.push({
        skillId: candidate.skillId,
        skillName: candidate.skillName,
        skillPath: resolvedPath,
        contentState: "available",
        skillMdBytes,
        skillMdEstimatedTokens,
        skillMdHash,
        skillMdContent,
        referenceCount,
        referenceBytes,
        referenceFiles,
      });
    } catch {
      selectedSkills.push({
        skillId: candidate.skillId,
        skillName: candidate.skillName,
        skillPath: resolvedPath,
        contentState: "unavailable",
        skillMdBytes: 0,
        skillMdEstimatedTokens: 0,
        skillMdHash: null,
        skillMdContent: null,
        referenceCount: 0,
        referenceBytes: 0,
        referenceFiles: [],
      });
    }
  }

  return {
    auditFingerprint,
    createdAt: new Date().toISOString(),
    distributionContext: globalUsage.callsPerTaskDistribution,
    globalUsage,
    selectedCandidates: candidates,
    selectedSkills,
  };
}

export const SKILL_CONTENT_BUDGET_TOKENS = 24000;

export function calculateSkillSnapshotBudget(snapshot: SkillSnapshotArtifact): {
  totalEstimatedTokens: number;
  isOversized: boolean;
} {
  const total = snapshot.selectedSkills.reduce((sum, s) => sum + (s.skillMdEstimatedTokens || 0), 0);
  return {
    totalEstimatedTokens: total,
    isOversized: total > SKILL_CONTENT_BUDGET_TOKENS,
  };
}

const CAUSAL_REGEX = /\b(cause|caused|causing|causes|responsible for|waste|wasted|wasting|cost you)\b|导致|造成|浪费|花掉了|因为这个\s*Skill\s*消耗/i;
const REPEATED_INJECTION_REGEX = /repeatedly inject|重复注入|完整.*注入/i;

const ALLOWED_INSIGHT_TYPES = new Set<SkillInsightType>([
  "core_skill_concentration",
  "long_tail_usage",
  "high_frequency_generic_procedure",
  "high_frequency_strong_capability_delta",
  "rare_thick_skill",
  "skill_family_overlap",
  "cross_skill_generic_duplication",
  "progressive_disclosure_opportunity",
]);

const ALLOWED_METRICS = new Set<string>([
  "totalSkillsUsed",
  "totalSkillCalls",
  "totalTasks",
  "topSkillCallShare",
  "topSkillCountForShare",
  "lowFrequencyThreshold",
  "lowFrequencySkillCount",
  "lowFrequencyCallShare",
  "singleUseSkillCount",
  "calls",
  "tasks",
  "callShare",
  "callsPerTask",
  "taskCoverage",
  "rankByCalls",
  "rankByTasks",
  "associatedTokens",
  "associatedCost",
  "skillMdBytes",
  "skillMdEstimatedTokens",
  "referenceCount",
  "referenceBytes",
]);

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
}

export interface SkillInsightsValidationResult {
  valid: boolean;
  insights: ValidatedSkillInsight[];
  errors: string[];
  unsupportedClaimsDropped: number;
}

export function validateSkillInsights(
  raw: unknown,
  snapshot: SkillSnapshotArtifact,
  globalUsage?: GlobalSkillUsage,
): SkillInsightsValidationResult {
  const errors: string[] = [];
  let unsupportedClaimsDropped = 0;

  if (!raw || typeof raw !== "object") {
    return {
      valid: false,
      insights: [],
      errors: ["Raw response must be an object or array."],
      unsupportedClaimsDropped: 0,
    };
  }

  const rawList = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as Record<string, unknown>).insights)
      ? ((raw as Record<string, unknown>).insights as unknown[])
      : null;

  if (!rawList) {
    return {
      valid: false,
      insights: [],
      errors: ["Raw response does not contain an insights array."],
      unsupportedClaimsDropped: 0,
    };
  }

  const snapshotSkillsMap = new Map<string, SkillContentSnapshot>();
  for (const s of snapshot.selectedSkills) {
    snapshotSkillsMap.set(s.skillId, s);
    snapshotSkillsMap.set(s.skillName, s);
  }

  const acceptedInsights: ValidatedSkillInsight[] = [];

  for (const item of rawList) {
    if (!item || typeof item !== "object") {
      unsupportedClaimsDropped++;
      continue;
    }

    const c = item as Record<string, unknown>;
    const id = typeof c.id === "string" ? c.id.trim() : "";
    const type = c.type as SkillInsightType;
    const title = typeof c.title === "string" ? c.title.trim() : "";
    const claim = typeof c.claim === "string" ? c.claim.trim() : "";
    const interpretation = typeof c.interpretation === "string" ? c.interpretation.trim() : "";
    const action = typeof c.action === "string" ? c.action.trim() : "";
    const confidence = typeof c.confidence === "string" ? c.confidence.toLowerCase().trim() : "";
    const skillIds = Array.isArray(c.skillIds)
      ? (c.skillIds.filter((id) => typeof id === "string") as string[])
      : [];
    const rawEvidence = Array.isArray(c.evidence) ? c.evidence : [];

    if (!id || !title || !claim || !interpretation || !action) {
      errors.push(`Insight ${id || "unnamed"} missing required prose fields.`);
      unsupportedClaimsDropped++;
      continue;
    }

    if (!ALLOWED_INSIGHT_TYPES.has(type)) {
      errors.push(`Insight ${id} has invalid type: ${type}`);
      unsupportedClaimsDropped++;
      continue;
    }

    // Causal wording check
    const fullText = [title, claim, interpretation, action].join(" ");
    if (CAUSAL_REGEX.test(fullText)) {
      errors.push(`Insight ${id} rejected: contains forbidden causal wording.`);
      unsupportedClaimsDropped++;
      continue;
    }

    // Repeated prompt injection check
    if (REPEATED_INJECTION_REGEX.test(fullText)) {
      errors.push(`Insight ${id} rejected: falsely claims repeated prompt injection.`);
      unsupportedClaimsDropped++;
      continue;
    }

    // Confidence filtering: drop low confidence
    if (confidence === "low") {
      unsupportedClaimsDropped++;
      continue;
    }
    if (confidence !== "high" && confidence !== "medium") {
      errors.push(`Insight ${id} has invalid confidence: ${confidence}`);
      unsupportedClaimsDropped++;
      continue;
    }

    // Family overlap check
    if (type === "skill_family_overlap" && skillIds.length < 2) {
      errors.push(`Insight ${id} of type skill_family_overlap requires at least 2 skillIds.`);
      unsupportedClaimsDropped++;
      continue;
    }

    // Evidence validation
    const validEvidence: SkillInsightEvidence[] = [];
    let hasValidContentEvidence = false;

    for (const ev of rawEvidence) {
      if (!ev || typeof ev !== "object") continue;
      const evObj = ev as Record<string, unknown>;
      const kind = evObj.kind;

      if (kind === "usage_metric") {
        const metric = typeof evObj.metric === "string" ? evObj.metric.trim() : "";
        if (ALLOWED_METRICS.has(metric)) {
          validEvidence.push({
            kind: "usage_metric",
            metric,
            value: typeof evObj.value === "number" || typeof evObj.value === "string" ? evObj.value : undefined,
          });
        }
      } else if (kind === "skill_content") {
        const skillId = typeof evObj.skillId === "string" ? evObj.skillId.trim() : "";
        const excerpt = typeof evObj.evidenceExcerpt === "string" ? evObj.evidenceExcerpt.trim() : "";
        const category = typeof evObj.category === "string" ? evObj.category.trim() : undefined;

        if (!skillId || !excerpt || excerpt.length > 200) {
          continue;
        }

        const skillSnapshot = snapshotSkillsMap.get(skillId);
        if (!skillSnapshot || skillSnapshot.contentState !== "available" || !skillSnapshot.skillMdContent) {
          continue;
        }

        const normalizedDoc = normalizeText(skillSnapshot.skillMdContent);
        const normalizedExcerpt = normalizeText(excerpt);

        if (normalizedDoc.includes(normalizedExcerpt)) {
          validEvidence.push({
            kind: "skill_content",
            skillId,
            category,
            evidenceExcerpt: excerpt,
          });
          hasValidContentEvidence = true;
        }
      }
    }

    if (validEvidence.length === 0) {
      errors.push(`Insight ${id} rejected: no valid evidence passed verification.`);
      unsupportedClaimsDropped++;
      continue;
    }

    // Types that require content analysis must have at least one valid content evidence
    const requiresContent = [
      "high_frequency_generic_procedure",
      "high_frequency_strong_capability_delta",
      "rare_thick_skill",
      "cross_skill_generic_duplication",
      "progressive_disclosure_opportunity",
    ].includes(type);

    if (requiresContent && !hasValidContentEvidence) {
      errors.push(`Insight ${id} rejected: requires verified skill_content excerpt.`);
      unsupportedClaimsDropped++;
      continue;
    }

    acceptedInsights.push({
      id,
      type,
      title,
      claim,
      interpretation,
      action,
      confidence: confidence as "high" | "medium",
      skillIds,
      evidence: validEvidence,
    });
  }

  // Deduplicate by type and primary skillId
  const dedupedMap = new Map<string, ValidatedSkillInsight>();
  for (const item of acceptedInsights) {
    const key = item.type + ":" + (item.skillIds[0] || "global");
    const existing = dedupedMap.get(key);
    if (!existing || (existing.confidence === "medium" && item.confidence === "high")) {
      dedupedMap.set(key, item);
    }
  }

  const finalInsights = [...dedupedMap.values()].sort((a, b) => {
    if (a.confidence === "high" && b.confidence === "medium") return -1;
    if (a.confidence === "medium" && b.confidence === "high") return 1;
    return 0;
  }).slice(0, 5);

  return {
    valid: true,
    insights: finalInsights,
    errors,
    unsupportedClaimsDropped,
  };
}
