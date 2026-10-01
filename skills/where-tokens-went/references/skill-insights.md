# Skill Insights Prompts

This document defines the authoritative Host Agent Prompts, contracts, systemic schemas, two-axis content analysis, and Claim Evidence Levels for Skill Insights in `where-tokens-went`.

## Immutable Evidence Snapshot Contract

The input contains one immutable Skill Evidence Snapshot provided through the Skill Insights Lane Input Projection, plus the frozen `directory` for this Lane. Do not derive, refresh, or recompute Skill metrics from any other source, and do not echo the `snapshotId`; code binds the identity it verified.

Address every fact through `directory` handles:

- `directory.skills` lists the candidate and selected Skills as `k1`, `k2`, …; `directory.families` lists detected families as `f1`, `f2`, ….
- `directory.evidence` lists deterministic metric entries as `e1`, `e2`, … with the canonical metric and value.
- `directory.content` lists frozen `SKILL.md` fragments as `c1`, `c2`, …, each carrying its Skill handle, source offsets, and content hash.

Rules:

- `subject` uses `skillHandle`, `skillHandles`, and `familyHandle`. Never echo a canonical Skill or family ID: it carries no binding, and code restores the identity from the handle you supplied.
- Metric evidence is `{"ref": "e7"}`. Code restores the evidence kind, metric, and owning object behind that handle; do not restate them.
- Content evidence is `{"contentRef": "c12", "role": "hardConstraint", "loadingScope": "always"}`. Code restores the approved excerpt text from the frozen Snapshot; never quote, paraphrase, or re-transcribe the excerpt, and never compute offsets yourself.
- A content citation must belong to the objects the insight itself declares. A `skill` insight may only cite its own Skill; a `family` insight may cite its declared members; a `cross_skill` insight that cites content must declare at least two Skills and cite content from at least two of them. `global` analysis may compare across the population. A citation owned by an undeclared Skill rejects that insight with a located reason, so declare every Skill whose content you cite.
- `reveal.evidenceRefs` must list only `e`/`c` handles already used by that same insight's `evidence`.
- Never echo `snapshotId`, `runId`, `auditFingerprint`, `bundleVersion`, `projectionHash`, or `outputContractVersion`. An output containing a code-owned field is rejected.

---

## 1. Main System Prompt (Batch Analysis)

```text
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
- A Capability Aha should include deterministic Usage evidence, Snapshot-verified content evidence, and a concrete Decision Delta. Providing deletion counterfactuals and both unique protocol and generic procedure excerpts are quality targets for high-value insights.
- Claim strength reflects evidence depth: `coexistence` is supported with content evidence; deeper scaffold interpretations benefit from multiple content citations.
- Treat `modelNativeScaffold` as two layers: `observed` states what the `SKILL.md` actually says; `interpretation` explains why a capable current coding agent may already know how to do it. `relativeTo` must be `capable-current-coding-agent`; this is not a timeless fact.
- `withoutGenericScaffold` is an AI interpretation, not a deterministic measurement. State uncertainty in the prose when the evidence does not support a stronger claim.

REVEAL-FIRST CONTRACT:
- Every insight must include a `reveal` object with a qualitative `semantic`, one deterministic `pattern`, and `evidenceRefs` pointing to `e`/`c` handles already used by that same insight's evidence.
- `semantic` names the structural surprise without numbers or derived quantitative language. The renderer generates all user-facing numeric wording from the bound directory values.
- Supported patterns are `share_inversion`, `distribution_outlier`, `family_concentration`, and `content_contrast`.
- Use `content_contrast` when direct SKILL.md evidence creates the contrast and no quantitative comparison is available.
- A Reveal must express a real contrast and a cognitive or decision delta. “High”, “important”, or “review this” is not a Reveal.

SCOPES OF INSIGHT:
Insights can be systemic or node-specific:
- global: System-wide patterns (e.g. core concentration vs long-tail distribution).
- family: Insights about related variants (e.g. platform adaptations vs core capabilities). Note: Family stem is a candidate grouping clue, not proof of identical capability without content inspection. Family metrics always describe the full population, not only selected content candidates. If claiming a shared capability core, cite content from at least two members; otherwise keep the conclusion conditional.
- cross_skill: Procedural duplication or shared concepts across distinct skills.
- skill: Deep analysis of an individual high-impact or outlier Skill.

TWO-AXIS CONTENT MODEL:
When analyzing SKILL.md content, evaluate two orthogonal axes:

Axis A - Semantic Role (WHAT is this content?):
- capability: Unique domain capability enabled by the Skill.
- localFact: Repository-, business-, or environment-specific fact.
- hardConstraint: Strict boundary, invariant, or approval rule (indicated by MUST / NEVER / REQUIRED / ALWAYS).
- tool: Dedicated script, CLI, command, or workflow helper.
- decisionRule: Judgment heuristic or decision boundary.
- genericProcedure: General software engineering steps that modern strong models already follow natively.

Axis B - Loading Scope (WHEN is this content needed?):
- always: Globally required across all turns and tasks.
- task_scoped: Relevant only when a specific sub-task or tool activates (e.g. "when generating the HTML report").
- reference_candidate: Supplementary documentation, examples, or troubleshooting guides.
- unclear: Indeterminate scope.

PROGRESSIVE DISCLOSURE RULE:
A "task_scoped hardConstraint" does NOT automatically mean it can be safely moved to references.
Only suggest progressive disclosure if the host agent or workflow can reliably and deterministically load the reference BEFORE the constraint takes effect. If moving a constraint risks breaking runtime guardrails, it MUST remain in the primary SKILL.md.

CLAIM EVIDENCE LEVELS & CAUSALITY RULE:
Distinguish these evidence levels:
- Level 1 (Observed): Direct measurement (e.g. "10.28 calls per task").
- Level 2 (Comparative): Benchmark comparison (e.g. "compared to median of 1.0 and P90 of 2.4").
- Level 3 (Interpretive): Structural deduction (e.g. "behaves like a lifecycle companion rather than a one-time entrypoint").
- Level 4 (Conditional Mechanism): If proposing a mechanism (such as repeated prompt injection or cost amplification), it MUST be framed conditionally:
  "IF these invocations re-inject full prompt content, THEN resident context costs are amplified. Direct trace evidence cannot yet confirm injection frequency; checking actual prompt loading is the next verification step."
NEVER make unconditional causal assertions ("Skill X caused N tokens", "wasted $N", "callsPerTask proves prompt was injected N times").

NUMERIC INTEGRITY RULE:
Do NOT write explicit numbers bound to metric units (percentages, token counts, costs, or multipliers) in free prose fields. Select the directory handle in `evidence` and cite it in `reveal.evidenceRefs`; the rendering engine resolves and displays the exact canonical figures from the immutable snapshot. Model names (e.g. GPT-4o, Claude 3.5), tool names, versions (e.g. v2, Python 3), years, and qualitative wording (e.g. "higher", "frequent") are acceptable.

For every content claim, reference a frozen fragment through `contentRef`. If a claim says hard constraints and generic procedures coexist, reference a fragment for each semantic role; one reference cannot support both sides. Do not claim family-level shared capability from names alone: two members need their own verified content evidence; familyDifferences for platform/environment distinction is an optional quality enhancement.
All user-facing prose must be written in the language specified by reportLocale.
Return JSON only.
```

---

## 2. Main User Prompt Template

```text
Analyze the supplied Skill system using the contract defined in the system message.

REPORT LOCALE
{{reportLocale}}

ANALYSIS PERIOD
{{analysisPeriod}}

EVIDENCE DIRECTORY
{{directoryJson}}

GLOBAL USAGE & DISTRIBUTION CONTEXT
{{globalUsageJson}}

SELECTED CANDIDATES & SAMPLING GROUPS
{{candidateJson}}

SELECTED SKILLS CONTENT

{{#each skills}}
<skill>
  <handle>{{skillHandle}}</handle>
  <name>{{skillName}}</name>
  <path>{{skillPath}}</path>
  <content_state>{{contentState}}</content_state>
  <metadata>{{metadataJson}}</metadata>
  <content_handles>{{contentHandles}}</content_handles>
</skill>
{{/each}}

TASK:
1. Examine the global distribution context (median, P75, P90, max callsPerTask, dominant family share, long-tail share) through its directory handles.
2. For each candidate skill, assess Semantic Role and Loading Scope.
3. Form 0 to 5 high-impact Aha insights (typically 2 to 3 when the evidence supports only a few strong deltas; allow fewer if evidence is sparse, NEVER invent filler).
4. For each insight, provide an explicit `kind` and, when applicable, a `candidateType` from `high_usage_strong_delta`, `high_usage_model_native_scaffold`, `high_usage_task_scoped_content`, `rare_strong_delta`, `family_shared_core`, or `behavior_outlier`. For `capability`, provide a qualitative Reveal object, Observation, Contrast, Interpretation, MentalModelShift as the Cognitive Delta, DecisionDelta, and `claimStrength`. Providing a deletion `counterfactual` and referencing both sides of content evidence when comparing unique protocol with generic procedure are quality targets for high-value insights; for family-level capability claims, stating `familyDifferences` is an optional quality enhancement.
5. Put every quantitative comparison in `evidence` handles. Do not write the resulting number or derived relationship in prose.
6. Prefer the highest-information contrast available, such as low-frequency Skill share versus low-frequency call share, or a calls-per-task outlier versus a distribution baseline. Do not let a dominant family crowd out a distinct global or outlier insight.
7. Return JSON matching the required schema: optional validated `contentProfiles`, the insight array, and optional `rejectionReasons` only when a content candidate cannot pass. Do not include a `snapshotId` or any other code-owned identity field.
```

---

## 3. Insight Schema

```json
{
  "contentProfiles": [
    {
      "skillHandle": "k1",
      "lossIfRemoved": [
        {
          "summary": "Project-specific protocol",
          "role": "hardConstraint",
          "contentRef": "c12",
          "whyModelWouldNotKnowThis": "Repository or project fact absent from general model knowledge",
          "loadingScope": "always | task_scoped | reference_candidate | unclear"
        }
      ],
      "modelNativeScaffold": [
        {
          "summary": "General implementation loop",
          "contentRef": "c31",
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
          "contentRef": "c44"
        }
      ],
      "contentSummary": "Short internal summary"
    }
  ],
  "insights": [
    {
      "id": "insight-core-vs-tail",
      "kind": "usage | capability",
      "candidateType": "high_usage_strong_delta | high_usage_model_native_scaffold | high_usage_task_scoped_content | rare_strong_delta | family_shared_core | behavior_outlier",
      "scope": "global | family | cross_skill | skill",
      "subject": {
        "familyHandle": "f1",
        "skillHandle": "k1",
        "skillHandles": ["k1", "k2"]
      },
      "title": "Short punchy title highlighting the mental model shift",
      "reveal": {
        "semantic": "Qualitative structural surprise without any numeric wording",
        "pattern": "share_inversion | distribution_outlier | family_concentration | content_contrast",
        "evidenceRefs": ["e4", "e5"]
      },
      "claimStrength": "coexistence | scaffold-interpretation | primary-delta",
      "familyDifferences": ["Optional platform or environment distinction; quality enhancement for family claims"],
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
        "ifRemoved": "Optional quality target: what the user loses if the whole Skill is removed",
        "withoutGenericScaffold": "Optional quality target: what remains if generic procedure is removed; AI interpretation, not measurement"
      },
      "conditionalMechanism": "Optional conditional hypothesis with missing evidence stated (Level 4)",
      "consequence": "Actionable next step for skill management or optimization",
      "confidence": "high | medium",
      "evidence": [
        { "ref": "e4" },
        { "ref": "e9" },
        { "contentRef": "c12", "role": "hardConstraint", "loadingScope": "always" }
      ]
    }
  ],
  "rejectionReasons": [
    "missing_unique_capability_evidence | missing_model_native_counterevidence | insufficient_content_support | usage_content_relation_unclear | family_content_unavailable | duplicate_mental_model_shift"
  ]
}
```

`kind` no longer accepts `mechanism`: a mechanism insight still requires the deferred Skill Trigger Trace. Every metric evidence entry is exactly `{"ref": "eN"}`; every content evidence entry carries only `contentRef` plus the semantic `role` and `loadingScope` you judged. Code restores the canonical kind, metric, owner, and excerpt text.
