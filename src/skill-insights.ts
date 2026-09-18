import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
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

export function deriveSkillMetrics(
  skills: SkillAnalysisEntry[],
  totalTasks: number,
): { global: GlobalSkillUsage; perSkill: Map<string, SkillDerivedMetrics> } {
  const perSkill = new Map<string, SkillDerivedMetrics>();

  if (!skills || skills.length === 0) {
    return {
      global: {
        totalSkillsUsed: 0,
        totalSkillCalls: 0,
        totalTasks: Math.max(0, totalTasks),
        topSkillCallShare: 0,
        topSkillCountForShare: 0,
        lowFrequencyThreshold: 5,
        lowFrequencySkillCount: 0,
        lowFrequencyCallShare: 0,
        singleUseSkillCount: 0,
      },
      perSkill,
    };
  }

  const totalSkillCalls = skills.reduce((sum, s) => sum + skillCalls(s), 0);
  const totalSkillsUsed = skills.filter((s) => skillCalls(s) > 0).length;
  const effectiveTotalTasks = totalTasks > 0 ? totalTasks : Math.max(1, ...skills.map(skillTasks));

  const sortedByCalls = [...skills].sort((a, b) => skillCalls(b) - skillCalls(a));
  const sortedByTasks = [...skills].sort((a, b) => skillTasks(b) - skillTasks(a));

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

  const topN = Math.min(4, sortedByCalls.length);
  const topSkillCallShare = sortedByCalls.slice(0, topN).reduce((sum, s) => sum + (perSkill.get(s.name)?.callShare ?? 0), 0);

  const lowFreqSkills = skills.filter((s) => skillCalls(s) <= 5 && skillCalls(s) > 0);
  const lowFrequencySkillCount = lowFreqSkills.length;
  const lowFrequencyCalls = lowFreqSkills.reduce((sum, s) => sum + skillCalls(s), 0);
  const lowFrequencyCallShare = totalSkillCalls > 0 ? lowFrequencyCalls / totalSkillCalls : 0;
  const singleUseSkillCount = skills.filter((s) => skillCalls(s) === 1).length;

  const global: GlobalSkillUsage = {
    totalSkillsUsed,
    totalSkillCalls,
    totalTasks: Math.max(0, totalTasks),
    topSkillCallShare,
    topSkillCountForShare: topN,
    lowFrequencyThreshold: 5,
    lowFrequencySkillCount,
    lowFrequencyCallShare,
    singleUseSkillCount,
  };

  return { global, perSkill };
}

function detectSkillFamilies(skills: SkillAnalysisEntry[]): Map<string, string[]> {
  const families = new Map<string, string[]>();
  for (const skill of skills) {
    const name = skill.name;
    if (!name || name === "<unknown-skill>") continue;
    const parts = name.split(/[-_]/);
    if (parts.length >= 2) {
      const stem = parts.slice(0, -1).join("-");
      if (stem.length >= 3) {
        const list = families.get(stem) ?? [];
        list.push(name);
        families.set(stem, list);
      }
    }
  }

  const result = new Map<string, string[]>();
  for (const [stem, members] of families.entries()) {
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
  const candidateMap = new Map<string, { candidateTypes: Set<SkillCandidateType>; signals: SkillCandidate["signals"] }>();

  function addCandidate(skillName: string, type: SkillCandidateType, signals: SkillCandidate["signals"]) {
    let existing = candidateMap.get(skillName);
    if (!existing) {
      existing = { candidateTypes: new Set(), signals: {} };
      candidateMap.set(skillName, existing);
    }
    existing.candidateTypes.add(type);
    existing.signals = { ...existing.signals, ...signals };
  }

  const sortedByCalls = [...skills].sort((a, b) => skillCalls(b) - skillCalls(a));

  // 1. High frequency: top 2 or callShare >= 0.20
  for (let i = 0; i < sortedByCalls.length; i++) {
    const skill = sortedByCalls[i];
    const metrics = perSkill.get(skill.name);
    if (!metrics || metrics.calls <= 0) continue;
    if (i < 2 || metrics.callShare >= 0.20) {
      addCandidate(skill.name, "high_frequency", {
        callShare: metrics.callShare,
        rankByCalls: metrics.rankByCalls,
      });
    }
  }

  // 2. High calls per task: callsPerTask >= 3.0 and calls >= 5
  const highCallsPerTask = [...skills]
    .filter((s) => {
      const m = perSkill.get(s.name);
      return m && m.callsPerTask >= 3.0 && m.calls >= 5;
    })
    .sort((a, b) => (perSkill.get(b.name)?.callsPerTask ?? 0) - (perSkill.get(a.name)?.callsPerTask ?? 0));

  for (const skill of highCallsPerTask.slice(0, 2)) {
    const metrics = perSkill.get(skill.name)!;
    addCandidate(skill.name, "high_calls_per_task", {
      callsPerTask: metrics.callsPerTask,
    });
  }

  // 3. Family candidates: pick top family by total calls
  const families = detectSkillFamilies(skills);
  let bestFamily: { stem: string; members: string[]; totalCalls: number } | null = null;
  for (const [stem, members] of families.entries()) {
    const totalCalls = members.reduce((sum, name) => sum + (perSkill.get(name)?.calls ?? 0), 0);
    if (!bestFamily || totalCalls > bestFamily.totalCalls) {
      bestFamily = { stem, members, totalCalls };
    }
  }

  if (bestFamily && bestFamily.totalCalls > 0) {
    const sortedMembers = [...bestFamily.members].sort(
      (a, b) => (perSkill.get(b)?.calls ?? 0) - (perSkill.get(a)?.calls ?? 0),
    );
    for (const member of sortedMembers.slice(0, 2)) {
      addCandidate(member, "skill_family", {
        familyGroup: bestFamily.stem,
      });
    }
  }

  // Convert to candidate list and cap at 5 unique skills
  const candidates: SkillCandidate[] = [];
  const candidateNames = [...candidateMap.keys()].sort((a, b) => {
    const ma = perSkill.get(a);
    const mb = perSkill.get(b);
    return (mb?.calls ?? 0) - (ma?.calls ?? 0);
  });

  for (const name of candidateNames.slice(0, 5)) {
    const entry = candidateMap.get(name)!;
    candidates.push({
      skillId: name,
      skillName: name,
      candidateTypes: [...entry.candidateTypes],
      signals: entry.signals,
    });
  }

  return { global, candidates };
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
