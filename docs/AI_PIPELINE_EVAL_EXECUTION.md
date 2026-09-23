# AI Pipeline Eval Execution

This is the executable development protocol for `where-tokens-went`. The authoritative runtime Prompts are `prompts/report-synthesis.md`, `prompts/key-session-analysis.md`, and `prompts/skill-insights.md`; packaged copies are generated and must not be edited directly.

## 1. Deterministic checks

Run the smallest relevant checks first:

```powershell
npm run typecheck
npm run build
npm run test:targeted
```

`eval contract` and `eval trial` are lane-only commands. They may read only the frozen Case input and target Prompt output. They must not scan Harness history, request pricing, process fonts, render HTML, open UI, install, or package.

The runner persists the resumable phase sequence `freeze → generator → contract-grade → blind-quality-grade → optimize → regression → held-out → review → promote`. Use `eval state --state <file> --experiment <id> --action <phase>` to advance one legal phase or `--action status` to inspect `nextLegalAction`; skipped phases fail and repeated completed phases are idempotent. Promotion-critical `trial`, `optimize`, `review`, and `promote` commands bind to this state artifact.

```powershell
npm run eval:contract -- --case evals/cases/<case-id>.json
Get-Content .scratch/<output>.json -Raw | npm run eval:trial -- --case evals/cases/<case-id>.json --role baseline --prompt-hash <64-hex> --bundle-version <bundle> --artifact-dir .scratch/<dir> --experiment <id> --attempt 1
```

Each trial must record the frozen input hash, Prompt hash, comparable model key, raw output hash, validation artifact, experiment ID, and immutable attempt directory. Promotion-critical trials must be created from an actual Host Agent execution record captured by the orchestrator. CLI-supplied duration, Token count, transcript reference, reviewer name, score, or approval text are not proof of execution; unavailable observed metadata stays unavailable.

Resolve promotion-critical provenance through the active Harness adapter. For Codex, bind each trial to the real rollout/session, thread, turn, response item, and terminal Token event; verify the output hash and derive the declared Token metric from that platform record. Keep the normalized local generation JSON as an index only. If the adapter cannot isolate one execution, record usage/timing as `unavailable` instead of inventing a value.

Budget results are `within`, `exceeded`, or `unavailable`. `exceeded` rejects. `unavailable` uses the experiment's `budgetEvidencePolicy`: `required` ends as `inconclusive`, while `advisory` preserves the limitation and may proceed through the quality gate. Use distinct unavailable and exceeded error codes.

## 2. Candidate loop

The Host Agent generates raw JSON through a recorded Generator action; deterministic code owns Contract validation, artifact registration, legal state transitions, and gate decisions. A separate-context Quality Grader receives opaque blind IDs and returns a score plus Evidence for every rubric dimension; `unknown` is a blocking result for promotion. Optimizer revisions are recorded executions that consume failed dimensions, are evidence-bound, change one hypothesis at a time, and stop after at most three revisions. A command that merely stores caller-authored output, grades, or proposal text does not satisfy these roles. None of these commands writes `prompts/`.

Regression and held-out inputs must be genuinely distinct. Their input hashes and scenario content cannot be identical; changing only the Case ID or split label is rejected. Baseline and candidate require independent Generator calls for every counted trial. Re-registering one output multiple times does not establish variance.

For formal Eval candidate review, if the checked-in accepted baseline is known invalid, run the baseline-bootstrap path first. Bootstrap uses only the unchanged authoritative Prompt, normal real executions, blind grading, variance checks, and independent review; it atomically replaces the baseline and records the prior baseline's invalidation reason. It does not require or promote a candidate Prompt.

Before starting candidate trials, confirm that the checked-in baseline binds the current bundle/Prompt and that the target dimension has measurable headroom on the selected Cases. Predeclare the Token metric, execution boundary, budget policy, and calibrated limits. If the accepted baseline is already at the target dimension's ceiling, revise the Case or target in a new experiment before running candidates. Preserve an earlier rejected experiment and its artifacts; changing thresholds or policy never reclassifies its result.

Run review only after baseline and candidate trials cover every regression and held-out Case with the same frozen input and model comparison key:

```powershell
npm run eval:review -- --experiment evals/experiments/<experiment>.json --baseline-dir .scratch/<baseline> --candidate-dir .scratch/<candidate> --artifact-dir .scratch/<review> --accepted-baseline evals/baselines/accepted-baseline.json --cases-dir evals/cases --review-evidence .scratch/<reviewer-response>.json --reviewer <reviewer> --grades .scratch/<grader-response>.json --grader-record .scratch/<grader-record>.generation.json --optimizer-record .scratch/<optimizer-record>.generation.json --reviewer-record .scratch/<reviewer-record>.generation.json --optimizer-artifact .scratch/<optimizer-artifact>.json
```

Promotion requires an `eligible` review, valid review-artifact and reviewer-approval hashes, resolvable sampled generation provenance, current accepted-baseline identity, unchanged candidate hash, input-distinct regression and held-out coverage, resolved variance, no exceeded budget, satisfaction of every `required` budget-evidence policy, complete dimension Evidence, and must-not-regress dimensions:

```powershell
npm run eval:promote -- --review .scratch/<review>/<experiment>.review.json --candidate-prompt evals/candidates/<lane>-candidate.md
```

Promotion is the only command in this loop allowed to update the authoritative Prompt, and it does so only after re-running the gate from stored artifacts.

### One-time Skill Insights v2 product release

Ticket 0025 uses the narrower product-release gate in `docs/AI_PIPELINE_EVAL_SPEC.md`, not `eval review`/`eval promote`. Do not migrate, rewrite, or bootstrap the stale accepted baseline for this release; it remains invalid for future formal Eval promotion. The v2 diagnostic pass is useful context, not release approval. The release is bound to the v2 candidate and two Case inputs named in Ticket 0025.

1. Use `skill-insights-real-aha-v2` for the user-reviewed input and `skill-insights-heldout-aha-v1` for the input-distinct held-out input. `skill-insights-heldout-v2` is a different fixture and is not the paired Case for this release. Replay the four frozen current/candidate raw outputs through the current card validator without model calls. A local raw file, sidecar, matching hash, prior Session claim, or `generationRecord: null` is not proof of Host execution. Reuse an output only if its exact output can be resolved in Harness-owned persistence and its input, Prompt, and model identity are directly bound; otherwise generate that missing current/candidate combination once. Codex CLI is one possible Host invocation path, not a release requirement; a Codex Desktop execution is also eligible when the exact assistant response and its usage/token records resolve from that Desktop rollout and bind to the same input, Prompt, and model. Keep raw outputs local.
2. Runtime and lane Eval consume the same `validateSkillInsights` result. Snapshot/envelope identity failures and empty filtered results block the output. Invalid cards are omitted and their errors retained as diagnostics; if a valid card remains, those diagnostics do not block the whole output. This contract result does not grade candidate quality. Independently review each raw current/candidate comparison for the two target Ahas, decision value, Evidence binding, uncertainty, discarded-card diagnostics, unsupported direct causality (including forms such as “responsible for” or “driving”), cross-Skill Token claims against the declared `subject` and Evidence, and held-out regression. Prose/Evidence mismatches are hard review blockers, not a request to grow the validator's synonym list. Record hashes, resolvable Host execution references, validator results, and the independent decision. A failed or unverified check ends this release attempt; do not tune another candidate under this exception.
3. Only after that review passes, copy the reviewed v2 Prompt into `prompts/skill-insights.md` as the source of truth; package, verify sync, verify the default installed Skill, then execute one complete report and open its final HTML. Do not treat a successful `ai-accept` result or locally supplied `host-response.json` fields as Host-execution proof by themselves; verify the final lane output against the actual Codex persistence and retain the resolvable source reference. Confirm that both main-Case Ahas survive card filtering and are visible in non-empty accepted Skill Insights, with the expected bundle identity, lane status, observed UI dispatch, and cleanup. After opening the HTML, an independent reviewer must inspect every displayed Skill Insights card one by one against the accepted lane output, frozen Snapshot, and Evidence; record each displayed card ID and decision, and verify that rendering/composition introduced no extra or materially changed claim and preserved supported metrics, uncertainty, Evidence, privacy, and identity boundaries. This final-page review is required in addition to the earlier blind raw-output review. Keep Run Evidence available until this review is complete, record the per-card decisions before cleanup, and clean up only afterwards. If the installed report or any displayed card fails review, mark delivery incomplete and restore the previous production Prompt/distribution; do not report a successful release.

This path does not alter `eval state`, accepted-baseline metadata, formal promotion evidence, or the other AI lanes. It authorizes one product release only; subsequent Prompt changes return to the formal protocol unless separately approved.

An experiment that ends `rejected` or `inconclusive` is a completed Eval observation, not permission to promote and not a failure of the current-Prompt report architecture. Stop that experiment and retain its review artifact; start a newly identified experiment only when a changed hypothesis, Case, or measurement contract can produce decision-changing evidence.

## 3. Separate report-delivery and Prompt-release acceptance

Do not generate HTML for Prompt iteration. Runtime, Skill workflow, provenance-adapter, and validator changes may package and sync the current authoritative Prompt at a stable integration checkpoint so the installed path can be tested; candidate Prompt files must remain under the Eval workspace and must not enter `prompts/`.

For current-Prompt report acceptance, use the unchanged authoritative Prompt and the default installed Skill after package, sync, installed-content verification, and preflight. Execute one complete Report Run on a suitable frozen input. Verify that accepted non-empty Skill Insights appears in the opened final HTML, and retain HTML hash/size, trace, observed UI dispatch, one bundle identity, lane statuses, and cleanup evidence. Test fallback separately. This track requires no eligible candidate, candidate promotion, or post-promotion artifact. An isolated install is supporting integration evidence only; default-install EPERM remains an environmental delivery blocker until that exact path passes.

After one formal Prompt promotion or the bounded v2 product release, repeat distribution and report acceptance for the new Prompt/bundle. Execute the final distribution steps once:

```powershell
npm run package-skills
npm run verify-sync
npm run verify-installed-skill
```

If the installed preflight fails, the only recovery is `npm run install-local`, followed by `npm run verify-installed-skill`. Do not create a partial Run before preflight passes.

Formal promotion finalization records the three distribution checks as structured local artifacts. Each artifact must include its check `kind` (`package-skills`, `verify-sync`, or `installed-preflight`), successful `status`, exact command, observed time, and the single `bundleVersion` carried by the promotion. Plain command text, a matching version field without content verification, or a caller-authored status is not sufficient.

For current-Prompt acceptance and either post-change release path, use the installed Skill workflow: `report-run prepare` → exactly one `evidence --auto` → one `ai-start` and `ai-accept` or explicit `ai-fallback` per eligible lane → artifact-only `report-run compose` → open the final HTML → record observed UI dispatch → `report-run finalize` → `report-run cleanup`. `ai-start`/`ai-accept` own the lane lifecycle; separate timing events use non-lane phases and cannot mark a lane accepted. The final manifest must contain an intact HTML hash/size, terminal lane states, complete or accurately incomplete trace status, and `completed` or `queued` UI dispatch. Accepted lane content must be visible in the opened HTML; unavailable content must show its lane-specific fallback reason. Earlier report evidence cannot substitute for acceptance of the changed Prompt, and a rejected formal candidate does not invalidate a separately passing current-Prompt report.

## 4. Evidence and privacy

Tracked Cases, Rubrics, Prompt hashes, and accepted-baseline metadata are redacted. Raw model output and review input copies remain local under `.scratch/` and are never default JSON, text, share, cache, index, or database output. A confirmed full-report acceptance failure becomes a new regression Case before the next candidate is reviewed.

Run-scoped bounded Evidence and lane JSON remain only in the local sensitive Run directory until explicit retention cleanup. After final HTML integrity and UI dispatch are recorded, use `report-run cleanup --run-dir <directory>`; do not copy the removed artifacts into default projections or packaged Skills.
