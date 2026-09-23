# AI Pipeline and Eval Tickets

**Status:** approved, then reopened by the 2026-09-20 evidence-integrity review. The issue files are authoritative for current status and acceptance.

Previous checked boxes and Session completion claims are historical assertions, not acceptance evidence. Tickets 0015–0021 remain reopened until their current issue files are revalidated from tests, resolvable execution records, and final artifacts.

The reopened scope also includes four bootstrap corrections: Harness-owned provenance adapters, three-state budget evidence, independently reviewed accepted-baseline bootstrap, and separate runtime-integration versus post-promotion packaging boundaries. The issue files contain the authoritative acceptance wording.

Delivery and improvement are separate tracks. Ticket 0016 accepts the current authoritative Prompt's installed report path without candidate promotion; Ticket 0021 accepts the promotion gate and, only when a candidate is eligible, the new bundle's post-promotion report regression. A rejected experiment is a valid Eval result, not a reason to hold current-Prompt delivery acceptance open.

## Current product-quality slice: Skill Insights

优先执行 [Skill Insights 质量恢复 Spec](SKILL_INSIGHTS_QUALITY_RECOVERY.md) 的 0022 → 0023 → 0024；只有用户确认真实洞察改善才执行 0025。四个独立验收单元见 [精简 Tickets](SKILL_INSIGHTS_QUALITY_TICKETS.md)。这不是重开 0015–0021 的大 Goal；正式 Prompt 晋升仍遵守现行门禁。

## User stories

- **U1 — Stable analysis quality:** As a maintainer, I can prove a Prompt/Skill candidate improves important AI analysis without relying on one good-looking run.
- **U2 — Fast iteration:** As a maintainer, I can reuse captured data and evaluate one AI lane without rescanning history or generating HTML.
- **U3 — Transparent execution:** As a maintainer, normal report generation uses versioned commands and artifacts rather than model-written bridge code.
- **U4 — Complete, diagnosable reports:** As a user, accepted AI analysis appears in the final report, and unavailable content has an exact reason.
- **U5 — Durable regression protection:** As a maintainer, every confirmed recurring failure becomes a Case that future candidates must continue to pass.

## Dependency map

```text
0018 Eval contract and baseline
 ├─→ 0015 Concurrent-safe Run Store
 │     ├─→ 0016 Lane acceptance and envelope-free composition
 │     └─→ 0017 Scoped inventory and shared cache
 └─→ 0019 Frozen-input Prompt Lab
       └─→ 0020 Generator–Grader–Optimizer automation

0016 + 0017 → current-Prompt installed report acceptance (0016)
0018 + 0019 + 0020 → 0021 promotion gate
0016 + eligible 0021 promotion → post-promotion report regression (0021)
```

Tickets 0015–0017 retain their existing files. Tickets 0018–0021 are published as individual files under `issues/`; this document remains the dependency overview and planning rationale.

## 0018: Eval contract and accepted baseline

**Status:** reopened; see `issues/0018-eval-contract-and-accepted-baseline.md`  
**Depends on:** none  
**Estimate:** 1–2 days
**User stories:** U1, U2, U5

### Outcome

The project has an approved AI Eval contract, five initial failure-driven Cases, an accepted baseline for every affected lane, and explicit promotion rules before runtime or Prompt behavior changes.

### Work

- Approve `docs/AI_PIPELINE_EVAL_SPEC.md`.
- Define Case, experiment, grading, benchmark, and review schemas.
- Capture Prompt hashes and bundle version for the current accepted baseline.
- Create the initial failure clusters:
  - analysis generated but absent from final projection;
  - opaque unavailable/fallback;
  - invalid or cross-Scope Evidence;
  - generic metric restatement;
  - partial Session/Capability analysis without grounded reason.
- Store real packets locally and create the smallest safe redacted regression fixtures.
- Record baseline outputs, validation, timing, Token usage, and known variance.

### Acceptance

- Every Case names its lane, immutable input/hash, expected outcome, deterministic expectations, Rubric, split, and privacy status.
- Baseline artifacts cannot be overwritten by a candidate iteration.
- At least one Skill Insights Case contains annotated good and bad references.
- Promotion thresholds and `inconclusive` conditions are explicit.

## 0015: Concurrent-safe Report Run updates

**Status:** reopened; see `issues/0015-concurrent-safe-report-run-updates.md`  
**Depends on:** 0018 contract approval  
**Estimate:** 2–3 days
**User stories:** U3, U4

### Outcome

Concurrent Report Run commands cannot overwrite each other's manifest, trace, warning, attempt, or artifact changes.

### Required additions to the existing ticket

- Treat accepted AI artifacts and validation artifacts as immutable registrations.
- Expose stable lock timeout/error codes for later Eval and status aggregation.
- Prove repeated concurrency safety, not only one successful schedule.

### Acceptance

Use the acceptance criteria in `issues/0015-concurrent-safe-report-run-updates.md` plus the additions above.

## 0016: Lane acceptance and envelope-free composition

**Status:** reopened; see `issues/0016-envelope-free-ai-report-composition.md`  
**Depends on:** 0015  
**Estimate:** 3–5 days
**User stories:** U3, U4

### Outcome

Normal full reports use `evidence --auto`, `ai-start`, `ai-accept`, artifact-only `compose`, and integrity-based `finalize`. Host Agents no longer assemble a composition envelope or bind Run metadata manually.

Accept the default installed path with the current authoritative Prompt, including opened HTML with non-empty accepted Skill Insights and separately tested fallback. Candidate improvement is not a dependency for this runtime acceptance.

### Required additions to the existing ticket

- Persist per-attempt raw output hash and a structured validation artifact with stable error code and field path.
- Separate delivery, lane, trace, and UI-dispatch states.
- Make accepted lane artifacts the only normal composition input.
- Ensure one invalid lane degrades only that lane.
- Require reading all affected source Prompts before implementation and preserve byte-for-byte packaging.

### Acceptance

Use `issues/0016-envelope-free-ai-report-composition.md` plus:

- valid AI output cannot disappear between acceptance and HTML;
- fallback HTML may be delivery-complete while accurately marked degraded;
- `report-run status` identifies the exact failed lane and reason.

## 0019: Frozen-input Prompt Lab

**Status:** reopened; see `issues/0019-frozen-input-prompt-lab.md`  
**Depends on:** 0018  
**May run in parallel with:** 0015–0016  
**Estimate:** 2–4 days
**User stories:** U1, U2, U5

### Outcome

Developers can evaluate Report Synthesis, Key Session Analysis, or Skill Insights from frozen artifacts without preparing or rendering a report. Skill Insights is the first implemented lane.

### Work

- Add tracked Case/Rubric/experiment directories and local-only workspace conventions.
- Add a command that freezes or binds an existing `skill-snapshot.json` and accepted Prompt baseline.
- Add a command that renders the exact authoritative lane input without HTML.
- Run `validateSkillInsights()` directly on candidate JSON and save structured errors/rejection reasons.
- Record Prompt hash, Snapshot ID, output hash, model/config identity, duration, Tokens, and transcript reference.
- Add equivalent adapters for Report Synthesis and Key Session Analysis after the Skill Insights path proves the contract.

### Acceptance

- Repeated Skill Insights trials reuse the same Snapshot ID and do not scan history, price models, subset fonts, render HTML, open UI, package, or install.
- The current accepted Prompt and every candidate are immutable iteration artifacts.
- Wrong Snapshot binding and invalid Evidence fail before semantic grading.
- A targeted test proves the lane-only path.

## 0020: Generator–Grader–Optimizer loop and benchmark

**Status:** reopened; see `issues/0020-generator-grader-optimizer-loop.md`  
**Depends on:** 0019  
**Estimate:** 2–3 days
**User stories:** U1, U2, U5

### Outcome

An experiment can run baseline and candidate trials, grade them deterministically and semantically, propose bounded revisions, aggregate variance/cost, and stop with `eligible`, `rejected`, or `inconclusive` without modifying the authoritative Prompt.

### Work

- Implement separate Generator, blind Quality Grader, Optimizer, and Promoter roles.
- Use output schemas for Generator and Grader responses.
- Grade one semantic dimension at a time or return `unknown`.
- Feed only failed dimensions, Evidence, annotated references, and the current hypothesis to the Optimizer.
- Enforce one hypothesis/change per revision and a default maximum of three revisions.
- Run deterministic gates before additional model calls.
- Aggregate per-Case results, mean/stddev, time, Tokens, tool calls, failures, and baseline delta.
- Generate a static review artifact with baseline/candidate outputs and grades.

### Acceptance

- Baseline and candidate use identical frozen input and comparable model configuration.
- Candidate identity is hidden from blind grading.
- Any blocking deterministic failure or regression rejects the candidate.
- No improvement or unresolved variance ends as `inconclusive`.
- The loop never writes `prompts/skill-insights.md`.

## 0017: Scoped inventory and shared cache

**Status:** reopened; see `issues/0017-scoped-inventory-and-shared-cache.md`  
**Depends on:** 0015  
**Estimate:** 1–2 days
**User stories:** U2, U4

### Outcome

Full-report deterministic preparation avoids unrelated filesystem and network work while preserving Audit facts and privacy.

### Acceptance

Use `issues/0017-scoped-inventory-and-shared-cache.md`. This ticket is intentionally separate from Prompt Lab speed: Prompt Lab skips preparation entirely, while 0017 optimizes the final acceptance workflow.

## 0021: Promotion gate, repository guidance, and full acceptance

**Status:** reopened; see `issues/0021-promotion-gate-repository-guidance-and-full-acceptance.md`  
**Depends on:** 0016, 0017, 0020  
**Estimate:** 1–2 days
**User stories:** U1, U2, U3, U4, U5

### Outcome

The gate safely rejects ineligible candidates and permits an eligible candidate to be explicitly promoted. `AGENTS.md` and repository commands make the Eval-driven workflow the default. A successful Prompt improvement is not required to close the current-Prompt report-delivery track; when promotion actually occurs, the new bundle receives its own full-report regression.

### Work

- Add concise AGENTS.md rules with a pointer to the detailed Eval protocol.
- Remove stale normal-workflow references to direct `inspect + compose-report` envelope assembly.
- Distinguish deterministic targeted tests, lane Eval, candidate Eval, full-report acceptance, and scheduled full Eval.
- Implement explicit promotion that checks the accepted experiment record and candidate hash before editing the authoritative Prompt.
- Run packaging and sync once after promotion.
- After legal promotion, run one complete report on the new bundle and assert accepted AI artifacts appear in final HTML.
- Record accurate per-lane fallback reasons, HTML integrity, UI dispatch, and final delivery status.
- Convert any failure found during acceptance into a regression Case.

### Acceptance

- An Optimizer or lane Eval cannot silently modify an authoritative Prompt.
- Promotion is refused when regression, held-out, variance, budget, or review gates are missing.
- AGENTS.md no longer forces HTML generation for lane Evals.
- A rejected/inconclusive experiment preserves its evidence and leaves the authoritative Prompt unchanged; current-Prompt installed acceptance proceeds independently under 0016.
- A promoted candidate completes one atomic final report on its new bundle with visible accepted content; fallback is a separately verified path.

## Recommended execution order

1. 0018 — freeze the baseline and approve contracts.
2. 0015 and 0019 — runtime reliability and Prompt Lab can proceed in parallel.
3. 0016 and 0020 — artifact-based runtime and automated Eval loop.
4. 0017 — optimize the remaining full-report path.
5. Complete 0016 current-Prompt installed report acceptance, without waiting for a better candidate.
6. Complete 0021 promotion-gate verification; run post-promotion report regression only for a genuinely eligible candidate.

## Next execution units

1. **Current-Prompt delivery (0015–0017, with 0016 as the user-visible gate):** reconcile the acceptance matrix against current artifacts, resolve the default-install EPERM or retain it as an explicit environment blocker, then run and independently review the installed Skill's accepted-path HTML plus separate fallback path. Stop when current-Prompt delivery has direct evidence or the exact external install condition is documented; do not wait for candidate improvement.
2. **Eval contract and candidate research (0018–0021):** keep the round-3 v1 rejection immutable, reconcile the checked-in baseline with the current bundle, test the promotion gate's positive and negative behavior, and start a new experiment only after headroom and budget calibration are fixed. A correct `rejected`/`inconclusive` outcome completes that experiment without changing `prompts/`; a future eligible candidate triggers promotion and its own post-promotion report regression. Independently review this track's evidence and leave any unrun conditional release criterion pending.

These are separate Goal/session scopes. Neither task may claim the other's acceptance evidence, and neither may turn a rejected candidate into an eligible one by changing the old experiment contract.
