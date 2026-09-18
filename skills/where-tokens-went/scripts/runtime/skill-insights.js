"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SKILL_CONTENT_BUDGET_TOKENS = void 0;
exports.calculatePercentileLinear = calculatePercentileLinear;
exports.deriveSkillMetrics = deriveSkillMetrics;
exports.selectSkillCandidates = selectSkillCandidates;
exports.resolveSkillPath = resolveSkillPath;
exports.loadSkillSnapshot = loadSkillSnapshot;
exports.calculateSkillSnapshotBudget = calculateSkillSnapshotBudget;
exports.validateSkillInsights = validateSkillInsights;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
function skillCalls(skill) {
    return typeof skill.invocationCount?.value === "number" ? skill.invocationCount.value : 0;
}
function skillTasks(skill) {
    return typeof skill.sessionCount?.value === "number" ? skill.sessionCount.value : 0;
}
function calculatePercentileLinear(values, p) {
    if (!values || values.length === 0)
        return 0;
    if (values.length === 1)
        return Math.round(values[0] * 100) / 100;
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
function deriveSkillMetrics(skills, totalTasks) {
    const perSkill = new Map();
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
    const callRanks = new Map();
    sortedByCalls.forEach((s, idx) => callRanks.set(s.name, idx + 1));
    const taskRanks = new Map();
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
    const callsPerTaskDistribution = {
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
    let dominantFamily = null;
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
    const global = {
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
function detectSamplingGroups(skills) {
    const groups = new Map();
    for (const skill of skills) {
        const name = skill.name;
        if (!name || name === "<unknown-skill>")
            continue;
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
    const result = new Map();
    for (const [stem, members] of groups.entries()) {
        if (members.length >= 2) {
            result.set(stem, [...new Set(members)]);
        }
    }
    return result;
}
function selectSkillCandidates(skills, totalTasks) {
    const { global, perSkill } = deriveSkillMetrics(skills, totalTasks);
    const selectedMap = new Map();
    function addCandidate(skillName, type, signals) {
        if (selectedMap.size >= 5 && !selectedMap.has(skillName))
            return false;
        let existing = selectedMap.get(skillName);
        if (!existing) {
            existing = {
                skillId: skillName,
                skillName,
                candidateTypes: [type],
                signals: { ...signals },
            };
            selectedMap.set(skillName, existing);
        }
        else {
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
            if (!m || m.calls <= 0)
                continue;
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
        const m = perSkill.get(topNonDom.name);
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
        return (m &&
            m.calls >= 3 &&
            m.callsPerTask >= global.callsPerTaskDistribution.p75 &&
            !selectedMap.has(s.name));
    })
        .sort((a, b) => (perSkill.get(b.name)?.callsPerTask ?? 0) - (perSkill.get(a.name)?.callsPerTask ?? 0));
    if (outlierCandidates.length > 0) {
        const topOutlier = outlierCandidates[0];
        const m = perSkill.get(topOutlier.name);
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
            const m = perSkill.get(extra.name);
            addCandidate(extra.name, "high_frequency", {
                callShare: m.callShare,
                callsPerTask: m.callsPerTask,
                rankByCalls: m.rankByCalls,
            });
        }
    }
    return { global, candidates: [...selectedMap.values()] };
}
async function resolveSkillPath(harness, cwd, skillName) {
    if (!skillName || typeof skillName !== "string")
        return null;
    const sanitized = skillName.trim();
    if (!sanitized || sanitized.includes("..") || sanitized.includes("/") || sanitized.includes("\\")) {
        return null;
    }
    const searchPaths = [];
    if (cwd) {
        searchPaths.push(path.join(cwd, "." + harness, "skills", sanitized, "SKILL.md"));
        searchPaths.push(path.join(cwd, ".agents", "skills", sanitized, "SKILL.md"));
    }
    searchPaths.push(path.join(os.homedir(), "." + harness, "skills", sanitized, "SKILL.md"));
    searchPaths.push(path.join(os.homedir(), ".agents", "skills", sanitized, "SKILL.md"));
    for (const candidatePath of searchPaths) {
        try {
            const stats = await (0, promises_1.stat)(candidatePath);
            if (stats.isFile()) {
                return candidatePath;
            }
        }
        catch {
            // Continue to next candidate
        }
    }
    return null;
}
async function loadSkillSnapshot(harness, cwd, candidates, auditFingerprint, globalUsage) {
    const selectedSkills = [];
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
            const skillMdContent = await (0, promises_1.readFile)(resolvedPath, "utf8");
            const skillMdBytes = Buffer.byteLength(skillMdContent, "utf8");
            const skillMdEstimatedTokens = Math.ceil(skillMdBytes / 3.6);
            const skillMdHash = (0, node_crypto_1.createHash)("sha256").update(skillMdContent).digest("hex");
            const skillDir = path.dirname(resolvedPath);
            const refDir = path.join(skillDir, "references");
            let referenceCount = 0;
            let referenceBytes = 0;
            const referenceFiles = [];
            try {
                const refStats = await (0, promises_1.stat)(refDir);
                if (refStats.isDirectory()) {
                    const entries = await (0, promises_1.readdir)(refDir, { withFileTypes: true });
                    for (const entry of entries) {
                        if (entry.isFile()) {
                            referenceFiles.push(entry.name);
                            const fileStats = await (0, promises_1.stat)(path.join(refDir, entry.name));
                            referenceBytes += fileStats.size;
                        }
                    }
                    referenceCount = referenceFiles.length;
                    referenceFiles.sort();
                }
            }
            catch {
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
        }
        catch {
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
exports.SKILL_CONTENT_BUDGET_TOKENS = 24000;
function calculateSkillSnapshotBudget(snapshot) {
    const total = snapshot.selectedSkills.reduce((sum, s) => sum + (s.skillMdEstimatedTokens || 0), 0);
    return {
        totalEstimatedTokens: total,
        isOversized: total > exports.SKILL_CONTENT_BUDGET_TOKENS,
    };
}
const UNCONDITIONAL_CAUSAL_REGEX = /\b(cause|caused|causing|causes|responsible for|waste|wasted|cost you)\b|导致了|造成了|浪费了|花掉了|因为这个\s*Skill\s*消耗/i;
const CONDITIONAL_INDICATOR_REGEX = /\b(if|assuming|hypothesis|potential|whether)\b|如果|若|假设|视乎|是否/i;
const UNCONFIRMED_INDICATOR_REGEX = /\b(cannot confirm|unconfirmed|missing trace|cannot prove|unverified)\b|当前缺少|尚未证实|尚无法确认|不能证明/i;
const REPEATED_INJECTION_ASSERTION_REGEX = /证明(?:完整)?(?:SKILL\.md|Prompt)被重复注入|proves (?:that )?(?:the )?(?:entire |full )?prompt was repeatedly injected/i;
function normalizeText(text) {
    return text.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
}
const ALLOWED_SCOPES = new Set(["global", "family", "cross_skill", "skill"]);
const ALLOWED_ROLES = new Set([
    "capability",
    "localFact",
    "hardConstraint",
    "tool",
    "decisionRule",
    "genericProcedure",
]);
const ALLOWED_LOADING_SCOPES = new Set([
    "always",
    "task_scoped",
    "reference_candidate",
    "unclear",
]);
function validateSkillInsights(raw, snapshot, globalUsage) {
    const errors = [];
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
        : Array.isArray(raw.insights)
            ? raw.insights
            : null;
    if (!rawList) {
        return {
            valid: false,
            insights: [],
            errors: ["Raw response does not contain an insights array."],
            unsupportedClaimsDropped: 0,
        };
    }
    const snapshotSkillsMap = new Map();
    for (const s of snapshot.selectedSkills) {
        snapshotSkillsMap.set(s.skillId, s);
        snapshotSkillsMap.set(s.skillName, s);
    }
    const candidateMap = new Map();
    for (const c of snapshot.selectedCandidates || []) {
        candidateMap.set(c.skillId, c);
        candidateMap.set(c.skillName, c);
    }
    const activeGlobal = snapshot.globalUsage || globalUsage;
    const activeDist = snapshot.distributionContext || activeGlobal?.callsPerTaskDistribution;
    const acceptedInsights = [];
    for (const item of rawList) {
        if (!item || typeof item !== "object") {
            unsupportedClaimsDropped++;
            continue;
        }
        const c = item;
        const id = typeof c.id === "string" ? c.id.trim() : "";
        const scope = (typeof c.scope === "string" ? c.scope.trim() : "skill");
        const title = typeof c.title === "string" ? c.title.trim() : "";
        // Core 5 elements
        const observation = typeof c.observation === "string" ? c.observation.trim() : (typeof c.claim === "string" ? c.claim.trim() : "");
        const contrast = typeof c.contrast === "string" ? c.contrast.trim() : "";
        const interpretation = typeof c.interpretation === "string" ? c.interpretation.trim() : "";
        const consequence = typeof c.consequence === "string" ? c.consequence.trim() : (typeof c.action === "string" ? c.action.trim() : null);
        const conditionalMechanism = typeof c.conditionalMechanism === "string" ? c.conditionalMechanism.trim() : null;
        let mentalModelShift = undefined;
        if (c.mentalModelShift && typeof c.mentalModelShift === "object") {
            const ms = c.mentalModelShift;
            if (typeof ms.surface === "string" && typeof ms.observed === "string" && ms.surface.trim() && ms.observed.trim()) {
                mentalModelShift = { surface: ms.surface.trim(), observed: ms.observed.trim() };
            }
        }
        const confidence = typeof c.confidence === "string" ? c.confidence.toLowerCase().trim() : "";
        const rawEvidence = Array.isArray(c.evidence) ? c.evidence : [];
        // Validation of mandatory fields: Observation + Contrast + Interpretation
        if (!id || !title || !observation || !contrast || !interpretation) {
            errors.push(`Insight ${id || "unnamed"} missing required core prose (observation, contrast, or interpretation).`);
            unsupportedClaimsDropped++;
            continue;
        }
        // Must have at least one of MentalModelShift or Consequence
        if (!mentalModelShift && !consequence) {
            errors.push(`Insight ${id} must have at least one of mentalModelShift or consequence.`);
            unsupportedClaimsDropped++;
            continue;
        }
        if (!ALLOWED_SCOPES.has(scope)) {
            errors.push(`Insight ${id} has invalid scope: ${scope}`);
            unsupportedClaimsDropped++;
            continue;
        }
        // Fake injection check
        const fullText = [title, observation, contrast, interpretation, consequence ?? "", conditionalMechanism ?? ""].join(" ");
        if (REPEATED_INJECTION_ASSERTION_REGEX.test(fullText)) {
            errors.push(`Insight ${id} rejected: asserts prompt injection without trace evidence.`);
            unsupportedClaimsDropped++;
            continue;
        }
        // Unconditional causality check (Level 4 discipline)
        if (UNCONDITIONAL_CAUSAL_REGEX.test(fullText)) {
            const isConditional = CONDITIONAL_INDICATOR_REGEX.test(fullText) && UNCONFIRMED_INDICATOR_REGEX.test(fullText);
            if (!isConditional) {
                errors.push(`Insight ${id} rejected: contains unconditional causal assertion.`);
                unsupportedClaimsDropped++;
                continue;
            }
        }
        // Confidence filter: drop low
        if (confidence === "low") {
            unsupportedClaimsDropped++;
            continue;
        }
        if (confidence !== "high" && confidence !== "medium") {
            errors.push(`Insight ${id} has invalid confidence: ${confidence}`);
            unsupportedClaimsDropped++;
            continue;
        }
        // Subject resolution
        let subject = undefined;
        if (c.subject && typeof c.subject === "object") {
            const subj = c.subject;
            subject = {
                familyId: typeof subj.familyId === "string" ? subj.familyId.trim() : undefined,
                skillId: typeof subj.skillId === "string" ? subj.skillId.trim() : undefined,
                skillIds: Array.isArray(subj.skillIds) ? subj.skillIds.filter((x) => typeof x === "string") : undefined,
            };
        }
        else if (Array.isArray(c.skillIds)) {
            subject = { skillIds: c.skillIds.filter((x) => typeof x === "string") };
        }
        // Evidence validation and deterministic metric lookup
        const validEvidence = [];
        for (const ev of rawEvidence) {
            if (!ev || typeof ev !== "object")
                continue;
            const evObj = ev;
            const kind = evObj.kind;
            if (kind === "global_metric") {
                const metric = typeof evObj.metric === "string" ? evObj.metric.trim() : "";
                if (activeGlobal && metric in activeGlobal) {
                    const val = activeGlobal[metric];
                    validEvidence.push({
                        kind,
                        metric,
                        value: typeof val === "number" || typeof val === "string" ? val : undefined,
                    });
                }
            }
            else if (kind === "distribution_metric") {
                const metric = typeof evObj.metric === "string" ? evObj.metric.trim() : "";
                if (activeDist && metric in activeDist) {
                    const val = activeDist[metric];
                    validEvidence.push({
                        kind,
                        metric,
                        value: typeof val === "number" || typeof val === "string" ? val : undefined,
                    });
                }
            }
            else if (kind === "family_metric") {
                const metric = typeof evObj.metric === "string" ? evObj.metric.trim() : "";
                const domFam = activeGlobal?.dominantFamily;
                if (domFam && (metric === "callShare" || metric === "dominantFamilyCallShare" || metric === "memberCount")) {
                    const val = metric === "memberCount" ? domFam.memberSkillIds.length : domFam.callShare;
                    validEvidence.push({
                        kind,
                        metric,
                        familyId: domFam.groupId,
                        value: val,
                    });
                }
            }
            else if (kind === "skill_metric" || kind === "usage_metric") {
                const metric = typeof evObj.metric === "string" ? evObj.metric.trim() : "";
                const skillId = typeof evObj.skillId === "string" ? evObj.skillId.trim() : (subject?.skillId || "");
                const cand = candidateMap.get(skillId);
                const sigVal = cand?.signals ? cand.signals[metric] : undefined;
                validEvidence.push({
                    kind: "skill_metric",
                    metric,
                    skillId: skillId || undefined,
                    value: typeof sigVal === "number" || typeof sigVal === "string" ? sigVal : undefined,
                });
            }
            else if (kind === "skill_content" || kind === "cross_skill_content") {
                const skillId = typeof evObj.skillId === "string" ? evObj.skillId.trim() : (subject?.skillId || "");
                const excerpt = typeof evObj.evidenceExcerpt === "string" ? evObj.evidenceExcerpt.trim() : "";
                const role = typeof evObj.role === "string" && ALLOWED_ROLES.has(evObj.role) ? evObj.role : undefined;
                const loadingScope = typeof evObj.loadingScope === "string" && ALLOWED_LOADING_SCOPES.has(evObj.loadingScope) ? evObj.loadingScope : undefined;
                if (!skillId || !excerpt || excerpt.length > 200)
                    continue;
                const skillSnapshot = snapshotSkillsMap.get(skillId);
                if (!skillSnapshot || skillSnapshot.contentState !== "available" || !skillSnapshot.skillMdContent)
                    continue;
                const normalizedDoc = normalizeText(skillSnapshot.skillMdContent);
                const normalizedExcerpt = normalizeText(excerpt);
                if (normalizedDoc.includes(normalizedExcerpt)) {
                    validEvidence.push({
                        kind,
                        skillId,
                        role,
                        loadingScope,
                        evidenceExcerpt: excerpt,
                    });
                }
            }
        }
        if (validEvidence.length === 0) {
            errors.push(`Insight ${id} rejected: no valid evidence passed verification.`);
            unsupportedClaimsDropped++;
            continue;
        }
        acceptedInsights.push({
            id,
            scope,
            subject,
            title,
            mentalModelShift,
            observation,
            contrast,
            interpretation,
            conditionalMechanism,
            consequence,
            confidence: confidence,
            evidence: validEvidence,
        });
    }
    // Deduplicate by scope + title
    const dedupedMap = new Map();
    for (const item of acceptedInsights) {
        const key = item.scope + ":" + item.title;
        const existing = dedupedMap.get(key);
        if (!existing || (existing.confidence === "medium" && item.confidence === "high")) {
            dedupedMap.set(key, item);
        }
    }
    const finalInsights = [...dedupedMap.values()].sort((a, b) => {
        if (a.confidence === "high" && b.confidence === "medium")
            return -1;
        if (a.confidence === "medium" && b.confidence === "high")
            return 1;
        return 0;
    }).slice(0, 5);
    return {
        valid: true,
        insights: finalInsights,
        errors,
        unsupportedClaimsDropped,
    };
}
