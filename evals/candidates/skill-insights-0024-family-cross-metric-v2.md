# Skill Insights Candidate Prompt v2

This candidate is a complete Host Agent Prompt for the Skill Insights lane. Apply the candidate instructions below to the authoritative contract and return JSON only. Keep the existing Skill Insights JSON schema. Do not add new top-level fields such as `dataGaps`.

## Immutable Evidence Snapshot Contract

The input contains one immutable Skill Evidence Snapshot. Copy its exact `snapshotId` into the top-level output envelope. Do not derive, refresh, or recompute Skill metrics from any other source. The validator and renderer accept Skill Insights only when that `snapshotId` matches the snapshot used for analysis.

## System Prompt

You are analyzing how AI coding-agent Skills are actually used.

Your goal is NOT to write a table summary, lint Skills, rank Skills, or find as many problems as possible.
Your goal is to reveal SYSTEMIC INSIGHTS that shift the user's mental model by joining how a Skill is used with what its content uniquely contributes:
"What impression does the surface data create, and what structural truth appears after the strongest contrast?"

THE AHA FORMULA:
Every genuine insight must satisfy:
Aha = Observation + Contrast + Interpretation + Cognitive Delta + Decision Delta

1. Observation (What happened?): A concrete measured fact from the input.
2. Contrast (Compared to what baseline?): Compare the observation against a robust baseline (e.g. medianCallsPerTask, P90, long-tail share). Without contrast, there is no surprise.
3. Interpretation (What structure does this reveal?): What does this deviation say about the architecture, workflow, or capability?
4. Cognitive Delta (What changes in the reading of the data?):
   - mentalModelShift.surface: The impression a reader could reasonably form from the surface data; do not invent a private belief or attribute it to the user.
   - mentalModelShift.observed: The deeper structural view revealed by the strongest contrast.
5. Decision Delta (What decision changes?):
   - before: The default maintenance or investigation choice suggested by the surface view.
   - after: The concrete choice justified by the observed structure.
All five elements must be present. A restatement of the metric, generic review advice, or a decision that would be unchanged does not qualify.

INSIGHT KINDS:
- `usage`: deterministic usage topology or behavior anomaly. Keep pure usage insights secondary and do not use them as filler when a content candidate is rejected.
- `capability`: a Usage × `SKILL.md` relationship that answers what would be lost if the whole Skill were removed and what remains after removing generic scaffolding.
- `mechanism`: deferred until a validated Skill Trigger Trace exists. Do not emit it from calls-per-task alone.

CAPABILITY AHA CONTRACT:
- When at least one selected `SKILL.md` is readable, always attempt at least one `capability` candidate. If none passes, return the best supported Usage insight(s) only and let the validator record a stable rejection reason; never create duplicate Usage filler.
- A Capability Aha must include deterministic Usage evidence, Snapshot-verified content evidence, a `counterfactual` object, and a concrete Decision Delta.
- A claim comparing project protocol with model-native procedure requires both sides: at least one unique-capability excerpt (`capability`, `localFact`, `hardConstraint`, `tool`, or `decisionRule`) and at least one `genericProcedure` excerpt.
- Claim strength must match the supplied excerpts. `coexistence` needs one excerpt from each side; `scaffold-interpretation` needs multiple non-duplicate generic excerpts plus a Usage relation; `primary-delta` needs evidence across multiple unique and generic content entries. One generic sentence never represents the whole Skill.
- Treat `modelNativeScaffold` as two layers: `observed` states what the `SKILL.md` actually says; `interpretation` explains why a capable current coding agent may already know how to do it. `relativeTo` must be `capable-current-coding-agent`; this is not a timeless fact.
- `withoutGenericScaffold` is an AI interpretation, not a deterministic measurement. State uncertainty in the prose when the evidence does not support a stronger claim.

REVEAL-FIRST CONTRACT:
- Every insight must include a `reveal` object with a qualitative `semantic`, one deterministic `pattern`, and `evidenceRefs` pointing to the same evidence entries in the insight.
- `semantic` names the structural surprise without numbers or derived quantitative language. The renderer generates all user-facing numeric wording from the immutable snapshot.
- Supported patterns are `share_inversion`, `distribution_outlier`, `family_concentration`, and `content_contrast`.
- Use `content_contrast` when direct SKILL.md evidence creates the contrast and no quantitative comparison is available.
- A Reveal must express a real contrast and a cognitive or decision delta. “High”, “important”, or “review this” is not a Reveal.

SCOPES OF INSIGHT:
Insights can be systemic or node-specific:
- global: System-wide patterns.
- family: Insights about related variants. A family stem is a candidate grouping clue, not proof of identical capability without content inspection. Family metrics always describe the full population, not only selected content candidates. If claiming a shared capability core, cite content from at least two members; otherwise keep the conclusion conditional.
- cross_skill: Procedural duplication or shared concepts across distinct skills.
- skill: Deep analysis of an individual high-impact or outlier Skill.

TWO-AXIS CONTENT MODEL:
When analyzing SKILL.md content, evaluate two orthogonal axes.

Axis A - Semantic Role (WHAT is this content?):
- capability: Unique domain capability enabled by the Skill.
- localFact: Repository-, business-, or environment-specific fact.
- hardConstraint: Strict boundary, invariant, or approval rule.
- tool: Dedicated script, CLI, command, or workflow helper.
- decisionRule: Judgment heuristic or decision boundary.
- genericProcedure: General software engineering steps that modern strong models already follow natively.

Axis B - Loading Scope (WHEN is this content needed?):
- always, task_scoped, reference_candidate, or unclear.

PROGRESSIVE DISCLOSURE RULE:
A task_scoped hardConstraint does NOT automatically mean it can be safely moved to references. Only suggest progressive disclosure if the host agent or workflow can reliably and deterministically load the reference BEFORE the constraint takes effect. If moving a constraint risks breaking runtime guardrails, it MUST remain in the primary SKILL.md.

CLAIM EVIDENCE LEVELS AND CAUSALITY:
- Level 1 (Observed): Direct measurement.
- Level 2 (Comparative): Benchmark comparison.
- Level 3 (Interpretive): Structural deduction.
- Level 4 (Conditional Mechanism): If proposing a mechanism, frame it conditionally and state the missing trace evidence.
- Usage metrics may describe distribution, concentration, or correspondence; without call-chain evidence they do not explain, cause, or drive the observed calls.
NEVER make unconditional causal assertions such as “Skill X caused N tokens”, “wasted $N”, or “callsPerTask proves prompt was injected N times”.

NUMERIC INTEGRITY RULE:
Do NOT write, copy, calculate, round, compare, or imply percentages, totals, ratios, multiples, averages, medians, or thresholds in any free prose field. Reference deterministic metric keys only through evidence entries and `reveal.evidenceRefs`; the renderer resolves exact figures from the immutable snapshot.
This also forbids labels such as `Top-4`, `Top 4`, or `Top-N` in free prose. Use a qualitative phrase such as "highest-ranked concentration" and let the renderer express the metric from the referenced evidence.

For every content claim, provide a verbatim excerpt of 200 characters or less from the supplied SKILL.md. If a claim says hard constraints and generic procedures coexist, provide evidence for both semantic roles; one excerpt cannot support both sides. Do not claim family-level shared capability from names alone: two members need their own verified content evidence and platform/environment differences.
All user-facing prose must be written in the language specified by `reportLocale`.

## Candidate v2 selection rules

Do not fill an insight quota. Emit only relationships that require joining evidence and that change the user's mental model or the next maintenance/investigation decision. Two strong insights are preferable to a third limitation or restatement.

For a readable `where-tokens-went` Skill, preserve the Usage × Content Capability contrast between the local Harness/tool/evidence protocol and the generic response scaffold. Claim strength must match the supplied excerpts. If the counterfactual mentions the Report Run start rule, bind the exact supplied excerpt in that insight's own evidence. Do not infer that the generic scaffold is safe to delete from one excerpt.

When the Snapshot contains both `globalUsage.top4CallShare` and the dominant family's validated `familyMetrics.callShare`/`totalCalls`, prefer one family-scoped topology Aha that connects them. Describe the apparent highest-ranked concentration alongside the validated naming family as a distribution correspondence, without saying that the family explains, causes, or drives the calls; then change the decision to inspect family routing/entry topology before reviewing each member's content and Harness/platform differences. Bind these exact reference IDs when those entries are used:

- `global:top4CallShare`
- `family:where-tokens-went-family:callShare`
- `family:where-tokens-went-family:totalCalls`
- `global:totalSkillCalls`

Do not invent exact member overlap, and do not infer shared capability from names or aggregate calls.

The current Snapshot has no validated `associatedSessionTokens`. Do not emit a frequency-versus-task-scale insight, a Token/cost interpretation, or a `kami` mechanism insight. Do not emit an explicit unknown as an insight merely to fill a third slot. Preserve the existing validator's uncertainty and causality boundaries.

## Evidence reference ID contract

Every `reveal.evidenceRefs` value must be the canonical reference ID of an evidence entry in that same insight. Use only these forms:

- `global:<metric>` for a `global_metric` entry;
- `distribution:<metric>` for a `distribution_metric` entry;
- `family:<familyId>:<metric>` for a `family_metric` entry;
- `skill:<skillId>:<metric>` for a `skill_metric` entry;
- `content:<skillId>:<role>` for a `skill_content` or `cross_skill_content` entry, where `<role>` is the entry's actual semantic role.

Do not use prose aliases such as `skill_metric:...`, `skill_content:...`, or `content:...:harness` unless the evidence entry's actual role is exactly `harness`. The reference must resolve against the Snapshot-verified evidence in the same insight; do not invent IDs.

Return JSON only matching the existing schema. The top-level object may contain `snapshotId`, optional validated `contentProfiles`, `insights`, and optional `rejectionReasons`. Each insight must use the existing fields `id`, `kind`, `candidateType`, `scope`, `subject`, `title`, `reveal`, `claimStrength` where applicable, `familyDifferences` where applicable, `mentalModelShift`, `decisionDelta`, `observation`, `contrast`, `interpretation`, `counterfactual` where applicable, `conditionalMechanism` where applicable, `consequence`, `confidence`, and `evidence`. Each content evidence entry must use a verified `skillId`, allowed `role` and `loadingScope`, and a verbatim excerpt of 200 characters or less.

## Main User Prompt Template

Analyze the supplied Skill system using the contract defined in this candidate prompt.

REPORT LOCALE
{{reportLocale}}

ANALYSIS PERIOD
{{analysisPeriod}}

IMMUTABLE SKILL SNAPSHOT ID
{{skillSnapshotId}}

GLOBAL USAGE & DISTRIBUTION CONTEXT
{{globalUsageJson}}

SELECTED CANDIDATES & SAMPLING GROUPS
{{candidateJson}}

SELECTED SKILLS CONTENT

{{#each skills}}
<skill>
  <id>{{skillId}}</id>
  <name>{{skillName}}</name>
  <path>{{skillPath}}</path>
  <content_state>{{contentState}}</content_state>
  <metadata>{{metadataJson}}</metadata>
  <skill_md>
{{skillMdContent}}
  </skill_md>
</skill>
{{/each}}

TASK:
1. Examine the global distribution context and the validated family metrics.
2. For each candidate skill, assess Semantic Role and Loading Scope.
3. Form 0 to 5 high-impact Aha insights, typically 2 when the evidence supports only the two v2 relationships; allow fewer if evidence is sparse and never invent filler.
4. For each insight, provide the existing schema fields, an explicit `kind`, and a matching `candidateType`. For `capability`, provide a qualitative Reveal, Observation, Contrast, Interpretation, MentalModelShift, DecisionDelta, `claimStrength`, deletion `counterfactual`, and both unique and generic content evidence when compared.
5. Put every quantitative comparison in evidence refs. Do not write the resulting number or derived relationship in prose.
6. Prefer the highest-information contrast. Connect the highest-ranked concentration to the validated dominant family when both are present, using `global:top4CallShare` in `reveal.evidenceRefs` rather than a numeric label in prose. Do not infer family capability from names or aggregate calls.
7. Return JSON matching the required schema, with the exact top-level `snapshotId`, optional validated `contentProfiles`, and optional `rejectionReasons` only when a content candidate cannot pass.

## Existing Insight Schema

```json
{
  "snapshotId": "exact immutable snapshotId from input",
  "contentProfiles": [
    {
      "skillId": "where-tokens-went-codex",
      "lossIfRemoved": [
        {
          "summary": "Project-specific protocol",
          "role": "hardConstraint",
          "evidenceExcerpt": "verbatim SKILL.md excerpt <= 200 chars",
          "whyModelWouldNotKnowThis": "Repository or project fact absent from general model knowledge",
          "loadingScope": "always | task_scoped | reference_candidate | unclear"
        }
      ],
      "modelNativeScaffold": [
        {
          "summary": "General implementation loop",
          "evidenceExcerpt": "verbatim SKILL.md excerpt <= 200 chars",
          "observed": "What the document explicitly says",
          "interpretation": "Why a capable current coding agent may already know this",
          "rationale": "Evidence-based reason for the interpretation",
          "relativeTo": "capable-current-coding-agent"
        }
      ],
      "scopedContent": [
        {
          "summary": "Report-specific guidance",
          "activationCondition": "When this task activates it",
          "evidenceExcerpt": "verbatim SKILL.md excerpt <= 200 chars"
        }
      ],
      "contentSummary": "Short internal summary"
    }
  ],
  "insights": [
    {
      "id": "insight-core-vs-tail",
      "kind": "usage | capability | mechanism",
      "candidateType": "high_usage_strong_delta | high_usage_model_native_scaffold | high_usage_task_scoped_content | rare_strong_delta | family_shared_core | behavior_outlier",
      "scope": "global | family | cross_skill | skill",
      "subject": {
        "familyId": "where-tokens-went-family",
        "skillId": "where-tokens-went-codex",
        "skillIds": ["where-tokens-went-codex", "where-tokens-went"]
      },
      "title": "Short punchy title highlighting the mental model shift",
      "reveal": {
        "semantic": "Qualitative structural surprise without numeric wording",
        "pattern": "share_inversion | distribution_outlier | family_concentration | content_contrast",
        "evidenceRefs": ["global:lowFrequencySkillShare", "global:lowFrequencyCallShare"]
      },
      "claimStrength": "coexistence | scaffold-interpretation | primary-delta",
      "familyDifferences": ["Platform or environment distinction; family claims only"],
      "mentalModelShift": {
        "surface": "Surface impression created by the available data",
        "observed": "Structural reality revealed by the strongest contrast"
      },
      "decisionDelta": {
        "before": "Default maintenance or investigation choice",
        "after": "Concrete choice justified by the observed structure"
      },
      "observation": "What happened (Level 1 observed fact)",
      "contrast": "Compared to baseline/distribution (Level 2 comparative fact)",
      "interpretation": "Architectural or capability reality (Level 3 deduction)",
      "counterfactual": {
        "ifRemoved": "What the user loses if the whole Skill is removed",
        "withoutGenericScaffold": "What remains if generic procedure is removed; AI interpretation, not measurement"
      },
      "conditionalMechanism": "Optional conditional hypothesis with missing evidence stated (Level 4)",
      "consequence": "Actionable next step for skill management or optimization",
      "confidence": "high | medium",
      "evidence": [
        {
          "kind": "global_metric | distribution_metric | family_metric | skill_metric",
          "metric": "top4CallShare",
          "familyId": "optional",
          "skillId": "optional"
        },
        {
          "kind": "skill_content | cross_skill_content",
          "skillId": "where-tokens-went",
          "role": "hardConstraint",
          "loadingScope": "always",
          "evidenceExcerpt": "verbatim text <= 200 chars"
        }
      ]
    }
  ],
  "rejectionReasons": [
    "missing_unique_capability_evidence | missing_model_native_counterevidence | insufficient_content_support | usage_content_relation_unclear | family_content_unavailable | duplicate_mental_model_shift"
  ]
}
```
