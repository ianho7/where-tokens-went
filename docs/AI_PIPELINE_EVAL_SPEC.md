# AI Pipeline and Eval Architecture Spec

## Status

Approved, reopened after the 2026-09-20 acceptance review. Runtime delivery and formal Prompt promotion have separate acceptance gates; a rejected candidate does not by itself block acceptance of the current authoritative Prompt's report path. The one-time Skill Insights v2 product release has the narrower gate below.

## Purpose

Define the runtime and development contracts needed to make AI-authored report content reliable, observable, fast to iterate, and protected by regression Evals.

This Spec preserves two existing boundaries:

- deterministic TypeScript owns facts, validation, state, artifacts, and rendering;
- the Harness Host Agent owns model inference and interpretation.

## Sources of truth

Skill Insights 当前的产品质量恢复切片见 `docs/SKILL_INSIGHTS_QUALITY_RECOVERY.md`（0022–0025）。它复用本 Spec 的运行与正式晋升边界，不要求为一次产品质量诊断重新验收整套 Eval 基建。

- Product outcome: `docs/MVP.md`.
- Runtime boundaries and records: `docs/DESIGN.md`.
- Domain language: `CONTEXT.md`.
- Runtime Prompt authorities:
  - `prompts/report-synthesis.md`;
  - `prompts/key-session-analysis.md`;
  - `prompts/skill-insights.md`.
- Packaged copies under `skills/where-tokens-went/` are generated artifacts.
- `package.json` remains the product-version and command source of truth.

## Runtime architecture

### Components

#### Thin Skill

Owns:

- invocation and Harness boundary;
- user scope and locale;
- privacy and untrusted-history boundary;
- the requirement to complete all eligible lanes or record explicit fallback;
- calling the next formal Run command and returning the strongest supported result.

Does not own:

- attempt allocation;
- Run metadata binding;
- Evidence selection details;
- hash comparison;
- composition envelope assembly;
- artifact registration;
- Run completion calculation.

#### Report Run Store

A file-backed transactional store scoped to one Run directory.

Properties:

- one bounded cross-process lock per Run;
- reload-before-mutate semantics;
- atomic manifest writes;
- immutable content artifacts;
- trace and manifest update in one short critical section when they represent one event;
- no model wait, history scan, validation, render, or network request under the lock.

#### Report Run Engine

Owns the state machine, eligible lanes, attempts, input preparation, acceptance, composition eligibility, delivery verification, and final status.

#### AI Lane

Exactly three first-class lanes exist:

- `report-synthesis`;
- `key-session-analysis`;
- `skill-insights`.

The design must not introduce a generic plugin or workflow registry. A small explicit mapping is sufficient.

#### Composer and Renderer

Read canonical Audit data and accepted lane artifacts from the same Run. They never accept a second Audit from model output and never infer that a missing artifact was valid.

## Run state model

### Delivery state

```text
started → prepared → ai-pending → composable → rendered → dispatched → completed
                                              ↘ failed
```

`completed` means the final HTML artifact passed integrity checks and UI dispatch is `completed` or `queued`.

### Lane state

```text
pending → running → accepted
                  ↘ fallback
                  ↘ failed → running (next bounded attempt)
                  ↘ unavailable
```

A lane fallback does not automatically make delivery fail. Delivery status, lane status, and trace completeness are separate fields.

### Trace state

`complete | incomplete`, with a stable error code when incomplete.

## Run artifacts

```text
run/
├─ manifest.json
├─ trace.jsonl
├─ run-spec.json
├─ audit.json
├─ first-user-messages.json
├─ evidence.json
├─ skill-snapshot.json
├─ lanes/
│  ├─ report-synthesis/
│  │  ├─ input.json
│  │  ├─ attempt-<n>.raw.json
│  │  ├─ attempt-<n>.validation.json
│  │  └─ accepted.json
│  ├─ key-session-analysis/
│  └─ skill-insights/
├─ composition.json
└─ report.html
```

Raw attempt artifacts contain only structured model output allowed by the lane privacy contract. They do not contain model reasoning, unrelated transcript content, commands, tool output, or credentials.

The Run directory is a local sensitive workspace, not default product output. It may retain the minimum bounded Evidence and structured raw lane response required for validation, retry, and diagnosis. These artifacts must have an explicit retention policy, must not enter default JSON/text/share output, caches, indexes, telemetry, or packaged Skills, and must be removable without changing the final report. `docs/DESIGN.md`, the installed Skill, and runtime tests must use this same boundary.

The formal cleanup entry is `report-run cleanup --run-dir <directory>` after the final HTML artifact exists. It removes bounded Evidence, Skill Snapshot, lane input/raw/validation/accepted/fallback JSON, composition JSON, and first-user-message projections from the local sensitive workspace while retaining the final HTML, canonical Audit, manifest, and trace needed to identify the delivered result.

## Lane ticket contract

`ai-start` returns a small ticket and artifact paths, not the full Prompt or full Audit through stdout.

```ts
interface LaneTicket {
  runId: string;
  lane: "report-synthesis" | "key-session-analysis" | "skill-insights";
  attempt: number;
  spanId: string;
  locale: "zh-CN" | "en-US";
  auditFingerprint: string;
  bundleVersion: string;
  promptHash: string;
  runtimeHash: string;
  inputArtifact: string;
  promptArtifact: string;
  snapshotId?: string;
}
```

The Host Agent reads the referenced local artifacts, generates the lane's documented JSON, and passes only that raw JSON to `ai-accept`.

## AI acceptance contract

`ai-accept`:

1. acquires the current Run and verifies bundle/runtime/Prompt identity;
2. binds Run metadata instead of trusting the model to repeat it;
3. saves the raw output with a hash;
4. invokes the existing lane validator;
5. writes a validation artifact;
6. writes or replaces `accepted.json` only when valid;
7. ends the real model span with the same attempt and span ID;
8. returns structured errors suitable for retrying only that lane.

Validation artifact:

```ts
interface LaneValidationResult {
  lane: LaneTicket["lane"];
  attempt: number;
  status: "accepted" | "rejected" | "fallback" | "unavailable";
  outputHash: string | null;
  errors: Array<{
    code: string;
    fieldPath: string | null;
    message: string;
  }>;
  rejectionReasons: string[];
}
```

User-facing HTML shows a concise localized degradation reason. Full field-level errors remain local development artifacts.

## Composition and finalization

`report-run compose` receives no normal-workflow stdin envelope. It loads:

- the canonical Audit;
- accepted Report Synthesis or explicit fallback;
- accepted Key Session entries and per-entry fallbacks;
- accepted Skill Insights or explicit fallback;
- the local-only first-user-message projection;
- the local-only project display name.

Finalize verifies:

- canonical artifacts and bundle version still match;
- the HTML artifact exists and matches registered size/hash;
- every eligible lane has a terminal status;
- UI dispatch has a terminal observed state.

The manifest exposes:

```ts
interface ReportCompletion {
  deliveryStatus: "completed" | "failed" | "incomplete";
  degraded: boolean;
  lanes: Record<string, {
    finalStatus: "accepted" | "fallback" | "unavailable" | "failed";
    attempts: number;
    totalDurationMs: number | null;
    lastDurationMs: number | null;
    reasonCode: string | null;
  }>;
  traceStatus: "complete" | "incomplete";
  uiDispatch: "completed" | "queued" | "failed" | "unavailable";
}
```

## Eval architecture

### Eval Case

```ts
interface AiEvalCase {
  id: string;
  lane: "report-synthesis" | "key-session-analysis" | "skill-insights";
  class: "capability" | "regression";
  split: "smoke" | "regression" | "held-out";
  inputArtifact: string;
  inputHash: string;
  expectedOutcome: string;
  deterministicExpectations: string[];
  rubricId: string;
  goodReference?: string;
  badReference?: string;
  originFailure?: string;
  privacy: "redacted" | "local-only";
}
```

Good and bad references must include annotations explaining the relevant principle. They are not target prose for string matching.

### Experiment

```ts
interface AiExperiment {
  id: string;
  lane: AiEvalCase["lane"];
  baselinePromptHash: string;
  candidatePromptHash: string;
  targetFailure: string;
  hypothesis: string;
  singleChange: string;
  targetDimension: string;
  mustNotRegress: string[];
  maxRevisions: number;
  tokenBudget: number | null;
  timeBudgetMs: number | null;
  budgetEvidencePolicy: "required" | "advisory";
  tokenMetric: "output_tokens" | "total_tokens";
}
```

### Trial roles

- Generator produces lane output.
- Contract Grader invokes deterministic code.
- Quality Grader scores independent dimensions and may return `unknown`.
- Optimizer proposes one revision from observed failures.
- Promoter applies an eligible candidate to the authoritative Prompt.

Generator, Quality Grader, and Optimizer must use separate contexts. Blind comparisons hide baseline/candidate identity.

### Evidence provenance and trust boundary

Eval evidence is not authenticated merely because it is stored in a typed artifact or carries a hash. A hash proves integrity after capture, not that a model call, duration, Token count, transcript, independent grader, or held-out run actually occurred.

Promotion-critical trials therefore require a resolvable generation record captured by the orchestrator from the actual Host Agent execution boundary. The record binds the Case/input hash, Prompt hash, output hash, model comparison key, producer context, observed start/end, available usage metadata, and a source reference that the reviewer can resolve. Caller-supplied `duration`, `tokenCount`, `transcriptRef`, reviewer name, score, or approval string are descriptive only and cannot satisfy a promotion gate by themselves. Unobservable values remain `unavailable` and cannot be replaced with estimates presented as observations.

A Harness provenance adapter resolves that source reference against Harness-owned persistence. For Codex this means a real rollout/session path plus thread, turn, response-item, and Token-event identities; for another Harness it means its equivalent immutable records. The adapter verifies the model output hash and derives timing/usage from the smallest attributable execution boundary. A locally authored execution JSON is only a normalized index and is never the authority for its own existence. If one trial cannot be isolated from unrelated turns or tool work, its usage and timing remain `unavailable`.

Budget evidence has two independent dimensions:

- observation: `within | exceeded | unavailable`;
- policy: `required | advisory`.

`exceeded` rejects promotion. `unavailable` produces `PROMOTION_TOKEN_USAGE_UNAVAILABLE` or `PROMOTION_TIME_USAGE_UNAVAILABLE`; it makes a `required` experiment `inconclusive`, while an `advisory` experiment may pass the quality gate only with the unavailable limitation preserved in review and baseline records. `unavailable` must never be reported as `exceeded`, and output bytes or wall-clock estimates must not impersonate observed usage. The experiment declares whether its Token metric is output Tokens or total Tokens; baseline and candidate must use the same metric.

Quality grades require a separate grader context and a blind-map artifact created before grading. Review approval requires a reviewer to resolve a sampled generation record and bind the approval to the review artifact hash, blind-map hash, grading artifact hashes, and reviewed Evidence. The local threat model does not claim protection from an operator who can rewrite the repository and all artifacts; it does require internal cross-checks that reject self-attested or internally inconsistent evidence.

Held-out means input-independent, not label-independent. A held-out Case must have a different input hash and non-overlapping scenario content from every regression Case used to develop the candidate. Changing only `split`, ID, expected text, or file path does not create a held-out Case.

### Accepted-baseline bootstrap

For formal Eval promotion, an invalid or placeholder accepted baseline is replaced through an explicit baseline bootstrap, not candidate promotion. Bootstrap uses the current authoritative Prompt only, requires the normal real-generation, contract, blind-grade, variance, privacy, and independent-review evidence, and records why the previous baseline was invalidated. It does not require candidate improvement and cannot change an authoritative Prompt. The replacement is atomic; the prior baseline metadata and invalidation reason remain auditable. Formal candidate review cannot begin until bootstrap produces the accepted baseline for the exact authoritative Prompt hash.

A bootstrap result in a local Eval workspace is evidence, not the authoritative accepted baseline. The checked-in baseline must bind the same current bundle and Prompt hashes before it is used for candidate review or promotion.

### Skill Insights Rubric

Required dimensions:

- useful surprise;
- Usage × Content relationship;
- Evidence sufficiency and Claim strength;
- deletion counterfactual quality;
- decision delta;
- non-duplication;
- calibrated uncertainty;
- efficiency relative to baseline.

Blocking failures:

- wrong Snapshot ID;
- fabricated or unknown metric;
- invalid content excerpt;
- unconditional unsupported causality;
- privacy violation;
- required regression failure.

### Skill Insights card validation boundary

`validateSkillInsights` is the shared source for both Report Run delivery and lane Eval. Its existing `valid`, filtered `insights`, and `errors` have these meanings:

- Snapshot identity, input envelope, Evidence lookup, and deterministic scope violations are hard failures. Privacy remains enforced at the applicable Run/data boundary; the prose validator is not a privacy scanner. A card with an invalid metric, unsupported Token-scale claim, narrowly identifiable direct causal attribution, or unverifiable content excerpt is discarded and never reaches the report.
- A card-level error is diagnostic for that card. If the envelope is valid and at least one card survives, the lane may accept the filtered cards while retaining the discarded-card errors. If none survives, the output is invalid. A valid surviving card proves contract validity only; it does not prove that the candidate meets the Skill Insights quality target.
- Report Run and lane Eval must use the same `valid` and filtered `insights` result. Both accept only a valid, non-empty filtered result, persist card-level errors as diagnostics, and reject an invalid or empty result. Eval must not turn a discarded card into a whole-output failure when the same Run would retain other valid cards.
- Deterministic checks own exact facts: Snapshot ID, known metric names and values, Evidence references, verbatim content excerpts of at most 200 characters, literal numeric prose, the distinction between `attributedTokens` and `associatedSessionTokens`, and the prohibition on aggregating overlapping Session Token totals across Skills.
- Keep the structured family Capability gate: a `capability` claim at `family` scope needs verified content Evidence from at least two members and must name platform/environment differences. Do not infer a shared capability from names or family call totals. General `shared`/`core` wording in open prose is not a whole-output regex veto; independent quality review compares the exact prose with member Evidence.
- Keep the Trigger Trace requirement for `mechanism`. For ordinary prose, reject only a narrow, direct affirmative causal attribution that code can identify as a claim about measured usage/Token/cost. Do not reject isolated words such as `impact`, `explains`, `cause`, or `drives` in arbitrary fields, and do not maintain the rule through growing synonym or negation lists. Ambiguous causal wording is a quality-review question against the raw output and Snapshot Evidence.
- Require non-empty, distinct `mentalModelShift` and `decisionDelta` fields as schema facts. Code cannot reliably decide whether a paraphrase produces a meaningful cognitive or decision change; genericity, attribution of a private belief, and actual usefulness belong in the independent quality review, except for an explicit direct user-belief assertion that can be identified exactly.
- Privacy is enforced at the data boundary: raw outputs and bounded Evidence stay in the local sensitive Run/Eval workspace, are excluded from default projections and packaged Skills, and are cleaned up after delivery. Do not treat a text keyword scan as proof of privacy.

Candidate quality is a separate decision from card validation. The reviewer must inspect the original raw text, filtered cards, discarded-card diagnostics, exact input Snapshot, and bound Evidence before deciding whether the target Ahas are useful and whether held-out quality regresses.

### Skill Insights gate inventory for Ticket 0025

| Gate and code location | Risk protected | Can code decide it accurately? | Known false positive or observed behavior | Decision |
| --- | --- | --- | --- | --- |
| Envelope, `snapshotId`, required insight array; `src/skill-insights.ts` `validateSkillInsights` | Mixing outputs across Snapshots or malformed model output | Yes: exact identity and shape | Wrong Snapshot is rejected; no false positive observed | **KEEP** |
| Metric, Evidence reference, excerpt, scope, and content lookup; `src/skill-insights.ts` Evidence validation | Unsupported numbers/content and fabricated references | Yes for exact IDs, values, exact excerpts, and enum scope; not for prose meaning | Missing Evidence is rejected; no frozen output FP observed | **KEEP** |
| Numeric free prose; `NUMERIC_PROSE_REGEX` and prose validation in `src/skill-insights.ts` | Numbers detached from rendered Evidence | Yes for literal digits, percent/quantifier terms, and metric labels; not for whether a sentence is otherwise meaningful | No frozen-output FP observed; ordinary prose containing terms such as “median” may be rejected by policy | **KEEP** as the existing rendering contract |
| Frequency versus Session Token scale; `hasUnqualifiedTokenScaleRelation` and verified `associatedSessionTokens` plus population baseline in `src/skill-insights.ts` | Treating call frequency or `attributedTokens` as task/session size | Partly: exact evidence and named relation are checkable; open prose remains quality-review territory | Token-like Skill names and family call totals used to trigger the old check; current word-boundary and scale-specific check no longer treats them as Token evidence | **ADJUST** to keep the scale claim tied to verified per-Skill and population Evidence |
| Cross-Skill Token aggregation; `TOKEN_SCALE_MENTION_REGEX`, declared Skill IDs, and aggregation gate in `src/skill-insights.ts` | Adding overlapping Session Token totals across Skills | Yes when Token scale, multiple Skills, and an aggregation operation are all explicit | Family call-count aggregation was previously misread as Token aggregation; it now passes unless the prose also discusses Token scale | **KEEP** with the narrowed trigger |
| Direct causal attribution and repeated-injection assertion; `hasUnsupportedCausalAssertion` in `src/skill-insights.ts` | Unsupported statements that a Skill causes measured calls, Tokens, or cost; fabricated repeated injection | Only for a narrow direct affirmative form; not for varied natural-language causality | Frozen false positives: “family label explains where calls cluster”, “does not identify the cause of repetition”, “high-impact”, and the negated “shared capability or causal routing” phrase. “shared routing or entry topology” also hit the removed family matcher | **ADJUST** to direct affirmative forms; do not extend synonym or negation lists |
| Open family/shared semantics and mixed hard-constraint/generic-role keyword rules; former family/mixed-role matchers in `src/skill-insights.ts` | Unsupported cross-member Capability claims | No: open prose and qualifications are ambiguous | “shared routing or entry topology” was usage topology, not a Capability assertion; the negative member-capability statement was also blocked | **REMOVE** the prose-wide vetoes. **KEEP** the structured family Capability gate requiring verified content from two distinct members and platform/environment differences |
| `mentalModelShift`, `decisionDelta`, generic action wording, and user-belief assertion; `src/skill-insights.ts` schema checks | Missing Aha fields or assigning an unobserved private belief to the user | Code can check non-empty/different fields and a direct belief phrase; it cannot grade a useful cognitive shift or action | The generic-action regex treated exact short phrases as invalid without context; semantic quality was not established by that test | **ADJUST**: keep structural deltas and direct belief guard; review usefulness, genericity, and paraphrases against raw text and Evidence |
| `mechanism` kind and family Capability Evidence; `src/skill-insights.ts` | Unsupported causal mechanism and shared Capability claims | Partly: the Trigger Trace prerequisite, member count, and exact Evidence are deterministic; the factual meaning of `familyDifferences` still needs review | No frozen-output false positive observed for these structured requirements | **KEEP** the structural checks; independently verify the claimed differences |
| Per-card filtering and lane acceptance; `src/cli.ts` `reportRunAiAcceptMain`, `src/eval-lab.ts` `gradeLaneOutput` | A bad card reaching HTML, or Eval disagreeing with runtime | Yes: consume the same `valid`, filtered `insights`, and `errors` | Runtime kept surviving cards while lane Eval blocked on any card error; this contract mismatch was confirmed in current code | **ADJUST**: filtered cards alone may proceed with diagnostics; empty/identity-invalid outputs block in both paths |
| Sensitive raw/Evidence retention; `src/report-run.ts` local-sensitive Run directory and explicit cleanup | Leaking raw transcripts or bounded Evidence outside the local Run | Code can enforce storage location, projection, and cleanup; it cannot identify all private meaning from prose keywords | This boundary is not a text PII scanner and does not claim to be one | **KEEP** the data boundary and cleanup; do not add prose keyword scanning |

### Optimization loop

```text
baseline + candidate on identical frozen Cases
  → deterministic grading
  → blind semantic grading
  → aggregate failure classes and variance
  → Optimizer proposes one hypothesis/revision
  → affected smoke Cases
  → regression Cases
  → held-out Cases
  → promotion eligibility
```

Default maximum is three candidate revisions per experiment. No improvement, conflicting graders, or excessive variance produces `inconclusive`, not promotion.

Before freezing a new experiment, check that its target Cases and rubric leave measurable headroom on the accepted baseline. A dimension already at its maximum cannot carry a positive-delta target; choose a genuinely discriminating Case or dimension before candidate trials. Declare the Token metric, attributable execution boundary, budget policy, and limits before seeing candidate results, using observed baseline/pilot measurements as calibration. Changing these choices after a rejection creates a new versioned experiment and preserves the rejected record; it never retroactively makes that candidate eligible.

`rejected` and `inconclusive` are valid terminal Eval outcomes. The Eval mechanism can be accepted when it records those outcomes correctly and independently rejects ineligible promotion; architecture acceptance does not require inventing a successful Prompt improvement.

The loop is an executable, resumable state machine rather than a set of storage commands. It records the next legal action and refuses skipped transitions. A candidate cannot reach review until the runner has observed Generator executions, contract grades, blind Quality Grader results, and required regression and held-out trials. `optimize` must consume recorded failed dimensions and produce one bounded candidate revision; saving arbitrary caller-provided proposal text is not an optimizer execution.

The deterministic CLI persists this sequence in a small local state artifact: `freeze → generator → contract-grade → blind-quality-grade → optimize → regression → held-out → review → promote`. `eval state` exposes `nextLegalAction`, rejects skips, and reuses a completed phase without writing a second execution. Phase artifact paths are evidence inputs; the state file alone is not a grade or promotion proof.

## Promotion contract

A candidate is eligible only when:

- every blocking deterministic expectation passes;
- the target dimension improves beyond the configured threshold;
- required regression Cases are no worse than baseline;
- held-out Cases are no worse than baseline;
- repeated trials do not show unresolved instability;
- no observed Token/time budget is exceeded, and every unavailable observation follows the experiment's required/advisory policy;
- a review artifact exists.
- every promotion-critical generation and grade has resolvable provenance and passes cross-checking;
- every held-out Case is input-distinct from candidate-development Cases;
- the accepted output demonstrates the experiment's target capability; an empty but schema-valid output cannot prove a capability-improvement claim.

Formal Eval eligibility does not itself modify `prompts/`. Formal promotion is an explicit separate operation that records the experiment and candidate hash, updates the authoritative Prompt, packages once, verifies sync once, and runs one post-promotion full-report acceptance check.

### One-time Skill Insights v2 product release

This release answers a narrower product question: does the user-approved v2 direction produce two evidence-backed, decision-changing Skill Insights in the installed final report? It is not a formal Eval promotion, a replacement accepted baseline, or evidence of statistical improvement. The stale accepted baseline remains unchanged and unusable for formal promotion. This exception applies only to the v2 candidate bound in Ticket 0025 to the reviewed 0024 candidate; future candidates require their own explicit decision.

- Compare the unchanged current Prompt and the Ticket 0025-bound v2 candidate on `skill-insights-real-aha-v2` and the input-distinct `skill-insights-heldout-aha-v1` Case. The latter is the held-out input used by the extant four-output comparison; `skill-insights-heldout-v2` points to a different fixture and is not this release's paired Case. Reuse an existing raw output only when its input, Prompt, model identity, actual Host execution, and current-validator result are directly verifiable; otherwise generate each missing current/candidate output once. Never treat a local sidecar or output hash as Host execution proof or relabel an old execution as a current-bundle trial.
- Run the shared card validator on all four outputs. A discarded card must be absent from filtered results; card-level errors remain diagnostics if other cards survive, while invalid Snapshot identity or an empty filtered result blocks that output. The main Case must retain the supported local-protocol-versus-scaffold Capability Aha and the Top-4-versus-naming-family topology Aha, without a fabricated third card. Both Cases must preserve Evidence binding, claim limits, privacy, and no unsupported direct causal or Token inference. The separate-context reviewer must inspect every card's original prose against its Snapshot and Evidence. Treat unsupported direct causality as a review blocker even in forms the validator does not enumerate (for example, “responsible for” or “driving” calls); check cross-Skill Token prose against the Skills and metrics actually declared in `subject` and Evidence, and reject missing or mismatched bindings. Do not expand the validator's synonym list to replace this comparison. Also check that held-out quality does not materially regress; filtered-card validity alone is not quality acceptance, and the implementer cannot approve the candidate.
- A failing candidate validation, missing execution proof, or unresolved material review finding stops the release. No optimizer, repeated trials, baseline migration, or bootstrap is implied. Record source and candidate Prompt hashes, frozen input hashes, raw output hashes, validation results, reviewer decision, and any unavailable measurements without inventing values.
- After the bounded review passes, update `prompts/skill-insights.md` from the reviewed candidate, package and verify sync, pass installed-Skill preflight, then generate and open one final HTML. An independent reviewer must inspect every Skill Insights card actually displayed in that HTML, one by one, against the accepted lane output, frozen Snapshot, and Evidence. Record each displayed card ID and decision; verify that composition introduced no extra or materially changed claim, that each displayed claim, metric, uncertainty, and Evidence excerpt remains supported, and that privacy and identity boundaries hold. This post-composition review is separate from reviewing the raw candidate cards. Keep the Run Evidence available until this review is complete; record the per-card decisions before cleanup, then clean up the Run directory. Complete only when that review passes, the HTML contains accepted, non-empty v2 Skill Insights with both main-Case Ahas and honest uncertainty, the expected bundle and lane states, observed UI dispatch, and cleanup. A failed final report or card review is an incomplete release, not proof that the Prompt improved.

Runtime delivery, formal Prompt promotion, and the one-time v2 product release have separate acceptance gates:

- **Current-Prompt report acceptance:** package/sync and verify the unchanged authoritative Prompt, then exercise the default installed Skill through a complete Report Run. Prove an accepted, non-empty Skill Insights artifact reaches the opened final HTML on a suitable frozen fixture; separately prove honest fallback and failure reasons. Record HTML integrity, trace, observed UI dispatch, bundle identity, and cleanup. This validates runtime delivery without claiming candidate improvement or promotion. An isolated install proves only the isolated path; a blocked default install remains an explicit delivery gap.
- **Formal candidate promotion:** retain independent trials, blind grading, regression, input-distinct held-out, budget, and review gates. If no candidate is eligible, record the terminal Eval outcome and leave the authoritative Prompt unchanged. Only after a legal promotion, package/sync the new Prompt and repeat installed-path report acceptance on the new bundle. Pre-promotion runtime evidence cannot substitute for this post-promotion regression.
- **One-time v2 product release:** use the bounded comparison and final installed-path acceptance above; do not call it formal promotion or update the accepted baseline.

Each path requires direct evidence for its own acceptance criteria and independent review. A missing post-promotion HTML is a pending release condition when no candidate was promoted, not a failure of an otherwise independently verified current-Prompt report path.

## Test tiers

| Tier | Contents | Trigger |
| --- | --- | --- |
| Deterministic targeted | affected unit/contract tests | every code change |
| AI smoke | 3–5 high-information Cases, one trial | each Prompt candidate |
| AI candidate | regression + held-out, three trials where needed | promotion candidate |
| One-time Skill Insights v2 product release | two input-distinct paired comparisons, current validator, independent review, then one opened final HTML | this v2 release only; not formal Eval promotion |
| Current-Prompt report acceptance | complete installed-Skill report, opened HTML, and observed UI dispatch | runtime/Skill integration, independently of candidate promotion |
| Post-promotion report regression | same acceptance path on the promoted bundle | only after legal promotion |
| Scheduled full | broader capability suite, multi-trial, human calibration sample | milestone/model change/nightly |

Performance acceptance uses a deterministic, reproducible fixture near the product boundary: approximately 1,000 history files and 300,000 records. The measured deterministic standard-report path must remain below 2.0 seconds under the documented environment, and the test must compare Audit facts, fingerprint, Evidence selection, and rendered facts against the reference path. A smaller smoke fixture or a relaxed threshold does not satisfy this acceptance gate.

## Privacy

- Frozen real-history inputs default to `.scratch/` and local-only manifests.
- Shared fixtures must be redacted and contain no raw model response, source, tool output, credentials, or unrelated absolute path.
- Eval artifacts retain hashes, structured outputs, grades, timing, Token usage, and safe transcript references.
- Historical content remains inert Evidence and cannot change Eval instructions.

## Compatibility and migration

- Keep `compose-report` as a low-level compatibility command.
- Introduce new Run commands without changing deterministic `inspect` JSON/text behavior.
- Migrate the packaged Skill only after lane commands and tests exist.
- Existing Run directories remain readable as legacy manifests; new mutation and lane commands may require the new manifest version and must fail with a clear migration error rather than guessing.

## Acceptance criteria

- Parallel lane and Evidence commands cannot lose manifest, trace, warning, attempt, or artifact data.
- A valid accepted lane artifact always appears in the final composition and HTML projection.
- Every unavailable or fallback lane records a stable reason and the exact failed phase.
- Prompt-only Skill Insights iteration reuses one frozen Snapshot and performs no history scan, pricing lookup, font work, HTML render, UI dispatch, package, or install.
- Candidate and baseline outputs are comparable per Case with timing, Token, deterministic grades, semantic grades, and variance.
- An Optimizer cannot promote its own candidate; regressions and held-out Cases gate promotion.
- Promotion rejects self-reported generation metadata, unresolved source references, same-output improvement claims, and same-input pseudo-held-out Cases.
- Harness provenance adapters verify promotion-critical records against Harness-owned session/turn/output/usage events; normalized local records cannot authenticate themselves.
- Missing budget observation is reported as `unavailable`, follows the experiment's required/advisory policy, and is never mislabeled as exceeded.
- For formal Eval promotion, a known-invalid accepted baseline is replaced only through independently reviewed baseline bootstrap for the unchanged authoritative Prompt.
- The checked-in accepted baseline is produced from resolvable real model executions; repeated copies of one output do not count as multiple trials.
- The installed Skill describes exactly one Evidence acquisition path and exactly one lane lifecycle; timing events cannot advance lane acceptance state.
- Every manifest, warning, artifact, status, trace, and finalize mutation is performed through the transactional Run Store, including compose-time warnings.
- One current-Prompt full HTML acceptance is required to prove runtime delivery without a candidate release; a changed Prompt requires one additional full-report acceptance on its new bundle.
- Runtime/Skill integration may be packaged before a Prompt change without packaging a candidate Prompt; final Prompt packaging occurs once after formal promotion or the bounded v2 review passes.
- The final full-report workflow still satisfies the product's atomic delivery and privacy requirements.
