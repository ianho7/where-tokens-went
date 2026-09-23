# Skill Insights Cognitive Delta smoke review

Date: 2026-09-21

## Result

Status: `inconclusive` for lane quality and `blocked` for promotion.

The reusable Case/Rubric contract is now present, and independent smoke Generators exposed real validator failures. No independent blind Quality Grader, multi-trial regression, held-out trial, baseline bootstrap, review gate, Prompt promotion, or candidate HTML delivery was run. The work stops at the smoke stop condition: three bounded Optimizer revisions did not produce Contract-passed candidate output.

## Frozen identities and policy

- Authoritative Prompt: `prompts/skill-insights.md`, SHA-256 `f8753cd72097d6cc31c553bc2f51eb3c4c31c28955246a7f2f0b049663a1df75`.
- Current installed bundle: `0.1.0+3419fc415402052800e77be7906075acdc7fb937b3a1962ba77e6037fe078970`.
- Existing accepted baseline bundle: `0.1.0+d4a42cf6d97d63ff9f6cb718cc39b3953583589835254581d03bf789e4d6beb2`; it is not comparable and was not reused.
- Model comparison key: `codex-current`; Token metric: `total_tokens`.
- Per-trial policy: `total_tokens <= 100000`, wall-clock `<= 300000ms`, missing required usage is inconclusive, exceeded usage is rejected.
- Candidate revisions: maximum 3; the smoke reached revision 3/3.

## Evidence classification

1. The first desired Aha is Prompt-selection quality after the Snapshot supplies usage plus verified unique/local and generic content. The claim must stay narrower than “Run/evidence binding” unless those excerpts are in the same card.
2. The naming-family Aha is supported by the Snapshot when `familyMetrics` exposes family calls/share and global total calls. It proves a usage/name topology, not a capability family.
3. The low-frequency-versus-task-scale Aha is not supported by the current Skill Snapshot contract: `SkillCandidate.signals` has no `associatedTokens`. The HTML table has that associated value, but the Skill Insights validator cannot bind it. No Prompt tuning was attempted for this conclusion.
4. `kami` calls-per-task remains an anomaly-only signal. The current Snapshot has no Trigger Trace, so no mechanism Aha was generated from it.

## Cases and Rubric

- `evals/cases/skill-insights-real-aha-v1.json`: development Case for local Harness capability plus naming-family topology and explicit unsupported-token boundary.
- `evals/cases/skill-insights-token-boundary-v1.json`: regression Case requiring unknown/non-causal handling when per-Skill associated Tokens are absent.
- `evals/cases/skill-insights-heldout-aha-v1.json`: input-distinct held-out Case with different names, values, and content.
- `evals/rubrics/skill-insights-aha-v2.json`: ten dimensions: snapshot binding, useful surprise, content contrast, Usage×Content relation, evidence sufficiency, deletion counterfactual, decision delta, non-duplication, uncertainty, and efficiency.

The references are contrastive rather than string targets: `evals/references/skill-good-reference-v2.json` rewards evidence-backed Cognitive Delta and concrete maintenance decisions; `evals/references/skill-bad-reference-v2.json` names restatement, family overclaim, Token causality, and unsupported mechanism as failures.

## Smoke evidence

All smoke trials used the same redacted development Snapshot and current bundle. They were lane-only and had no history scan, pricing, HTML, UI, install, or package side effects.

| Role/revision | Result | Raw output | Contract evidence |
| --- | --- | --- | --- |
| baseline/current Prompt | blocked | `.scratch/skill-insights-cognitive-delta-smoke-baseline.raw.json`, SHA-256 `815a8a68e528c668d0a32ece4f847c3b258d18c11c0cadfd2422d42e04306f92` | `.scratch/skill-insights-cognitive-delta-smoke/baseline/experiments/skill-insights-cognitive-delta-v1/skill-insights-real-aha-v1/baseline/attempt-1-b89ed7b6-a1d0-4465-ae08-576d69fd9267/validation.json`; invalid content Reveal ref |
| candidate v1 | blocked | `.scratch/skill-insights-cognitive-delta-smoke-candidate.raw.json`, SHA-256 `d6c4262ca410741323f126163b4ecc8a0919c9c45a2c50add587a2c66f913d86` | `.scratch/skill-insights-cognitive-delta-smoke/candidate/experiments/skill-insights-cognitive-delta-v1/skill-insights-real-aha-v1/candidate/attempt-1-989fe0af-c19b-4146-9825-ab0be0a8c34e/validation.json`; invented content refs and incomplete family metric set |
| candidate v2 / revision 1 | blocked | `.scratch/skill-insights-cognitive-delta-smoke-candidate-v2.raw.json`, SHA-256 `171b8e3c25e6e28ad26d0fa1fff68e5149ae7dcf6ed271816e560dc60a8a9459` | `.scratch/skill-insights-cognitive-delta-smoke-v2/candidate/experiments/skill-insights-cognitive-delta-v2/skill-insights-real-aha-v1/candidate/attempt-1-def3f936-a9bb-4709-a15c-9e7bd5c622fb/validation.json`; content prefix fixed, family phrase still triggered stronger gate |
| candidate v3 / revision 2 | blocked | `.scratch/skill-insights-cognitive-delta-smoke-candidate-v3.raw.json`, SHA-256 `998d27f354378f6668dd535e34e7d2c484e4ef4c9ee33dc67fad8c51f3b06b54` | `.scratch/skill-insights-cognitive-delta-smoke-v3/candidate/experiments/skill-insights-cognitive-delta-v3/skill-insights-real-aha-v1/candidate/attempt-1-397233f4-3daa-4d23-a72a-ed944be99f40/validation.json`; family caveat still contained `shared capability` |
| candidate v4 / revision 3 | blocked | `.scratch/skill-insights-cognitive-delta-smoke-candidate-v4.raw.json`, SHA-256 `86ea0576a0eaad1ad141b7e9ef5b58a83bc2f7340827b560bd47f11d1bd8fc04` | `.scratch/skill-insights-cognitive-delta-smoke-v4/candidate/experiments/skill-insights-cognitive-delta-v4/skill-insights-real-aha-v1/candidate/attempt-1-51deaecd-259b-41bb-b6f1-aaaa9ac7b499/validation.json`; Chinese `相同能力/共同能力` still triggered family-semantic gate |

The v1 candidate did produce the intended semantic improvement in independent smoke output: a sharper local-Harness-vs-generic-scaffold Aha and a naming-family topology Aha. That is a qualitative smoke signal only; it is not a passing lane result because the deterministic Contract rejected it.

## Optimizer loop

1. Revision 1: require canonical references and the exact metric set for `family_concentration`. Prediction: remove invalid-ref and missing-family-metric errors. Result: metric errors were removed, but family-semantic wording still blocked.
2. Revision 2: emit literal `content:<skillId>:<role>` examples and avoid `shared/common` family language without two-member content. Prediction: both deterministic errors disappear. Result: literal refs passed, but the model retained `shared capability` in a caveat.
3. Revision 3: use validator-recognized `whether ... remains unconfirmed` wording. Prediction: preserve naming topology while passing the family gate. Result: English/Chinese output still emitted family-semantic equivalents (`相同能力/共同能力`); Contract remained blocked.

## Acceptance boundary

- Proven: Case input hashes, held-out input distinction, Rubric structure, current Prompt/bundle identity check, lane-only side-effect boundary, and deterministic validator failures.
- Smoke-only: semantic direction of the candidate output and the fact that the candidate can express the desired two-Aha structure before validation.
- Not proven: dimension scores, baseline/candidate improvement, variance, regression, held-out generalization, independent blind grading, promotion provenance, or final HTML delivery for the candidate.
- The existing current-prompt HTML was not modified and is not candidate acceptance evidence.

The external `codex exec` Generator path also encountered a certificate/network failure and its escalated data-egress request was rejected. The smoke therefore used separate platform Agent contexts for semantic generation, but those outputs lack the Codex Host provenance required for promotion. This is an additional promotion blocker, not a quality score.

## Independent review gate

The required independent Standards and Spec reviews both blocked acceptance:

- Standards review found P1 gaps in `src/eval-state.ts` (state transitions/evidence are not tamper-checked), `src/eval-baseline.ts` (bootstrap does not independently retain the prior baseline), and `src/cli.ts` promotion ordering (authoritative Prompt mutation can precede durable promotion evidence).
- Spec review found the older active experiment `evals/experiments/real-skill-insights-v1.json` still points at the weaker v1 Rubric/Cases, the old held-out fixture is semantically overlapping, and `src/eval-contract.ts` checks only serialized `inputHash` inequality rather than enforcing non-overlapping scenario content.

These are unresolved P1 findings in shared Eval infrastructure or existing active contracts. They block any honest promotion/completion claim for this Goal. They were not patched in this run because doing so would expand from the bounded Skill Insights smoke into shared state, baseline, promotion, and held-out contract changes; existing changes and rejected experiments remain untouched.
