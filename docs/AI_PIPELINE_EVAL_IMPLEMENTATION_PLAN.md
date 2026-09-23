# AI Pipeline and Eval-Driven Development Implementation Plan

> Planning history. For current acceptance sequencing, use `docs/AI_PIPELINE_EVAL_SPEC.md`, `docs/AI_PIPELINE_EVAL_EXECUTION.md`, and the current 0016/0021 Tickets: current-Prompt report delivery is accepted independently of candidate promotion; post-promotion report regression applies only after a legal promotion.

## Objective

Replace the current Prompt-tuning and report-delivery loop with two explicit engineering loops:

1. a reliable report runtime in which deterministic code owns orchestration, state, validation, artifacts, fallback, composition, and delivery;
2. an Eval-driven AI development loop in which Prompt and Skill candidates reuse frozen inputs, compete against the accepted baseline, receive deterministic and semantic grading, and are promoted only after regression and held-out gates pass.

The expected outcome is that AI analysis quality can improve through short, repeatable experiments without regenerating HTML or rescanning history on every iteration, while a real report remains atomic, observable, and recoverable.

In scope:

- Report Run concurrency, state, artifacts, error classification, composition, and completion semantics.
- Run-scoped AI lane input and acceptance contracts for Report Synthesis, Key Session Analysis, and Skill Insights.
- Frozen-input lane Eval, baseline/candidate comparison, good/bad references, multi-trial grading, and bounded optimization.
- Prompt promotion, regression capture, AGENTS.md guidance, performance tiering, and one final full-report acceptance check.

Out of scope:

- A hosted Eval service, database, daemon, model gateway, generic DAG framework, or cross-project telemetry platform.
- Automatic production Prompt deployment without an explicit promotion gate.
- Replacing the Host Agent with a second Provider client inside the CLI.
- Expanding Harness scope, changing Token accounting, or adding new report product features unrelated to reliability and evaluation.

## Background and Context

`where-tokens-went` is a hybrid system. Deterministic TypeScript code acquires and validates facts, while the Host Agent produces three kinds of interpretation from authoritative version-controlled Prompts:

- `prompts/report-synthesis.md` — Audit Overview and report-level Findings;
- `prompts/key-session-analysis.md` — Session-specific mechanisms, actions, and explicit unknown states;
- `prompts/skill-insights.md` — Usage, Capability, and future Mechanism Aha insights.

The product boundary in `docs/MVP.md` requires one atomic final HTML report. The architectural boundary in `docs/DESIGN.md` requires the CLI to remain model-free and the Host Agent to own interpretation. Those decisions remain valid.

The problem is that the Host Agent currently also owns too much deterministic workflow mechanics. The Skill asks it to coordinate three AI lanes, record events, bind hashes and fingerprints, select Evidence, build a composition envelope, recover failures, open HTML, and finalize the Run. This creates variance in a part of the system that should be repeatable.

The repository already contains three runtime tickets that point in the right direction:

- `issues/0015-concurrent-safe-report-run-updates.md`;
- `issues/0016-envelope-free-ai-report-composition.md`;
- `issues/0017-scoped-inventory-and-shared-cache.md`.

This plan integrates those tickets with a new Eval architecture rather than replacing them.

## Current State Analysis

### Current runtime

```text
User
  → Harness Skill / Host Agent
  → report-run prepare
  → Host Agent manually runs three AI lanes
  → Host Agent records start/end events
  → Host Agent assembles one composition envelope
  → report-run compose validates late and renders HTML
  → Host Agent opens HTML and finalizes
```

Relevant implementation:

- `skills/where-tokens-went/SKILL.md` contains the detailed orchestration protocol.
- `src/report-run.ts` stores one mutable manifest and lets independent processes write their in-memory copy back.
- `src/cli.ts` requires a manually assembled AI envelope at `report-run compose`.
- `src/key-session-analysis.ts` and `src/skill-insights.ts` contain useful deterministic validators that can be reused outside report rendering.
- `package.json` couples its default test command to build, package, install, and one large test file while many other tests are not part of that command.

Known limitations:

- concurrent lane commands can overwrite newer manifest state;
- AI output can be generated but omitted before composition;
- validation failure details are not consistently persisted as durable artifacts;
- Run status, AI degradation, trace completeness, and delivery status are conflated;
- Prompt quality is judged mainly through one-off dogfood reports;
- Prompt-only iteration repeats unrelated acquisition, pricing, packaging, font, render, and UI work;
- there is no accepted-baseline versus candidate benchmark with multi-trial variance;
- repeated real failures are not systematically promoted into an AI regression suite.

### Current tests

The deterministic validators are stronger than the AI quality process. They can reject stale fingerprints, invalid excerpts, unsupported causality, and malformed structures, but they cannot answer whether a valid result is important, specific, surprising, decision-changing, or better than the previous Prompt.

A local targeted run also showed the deterministic report benchmark at roughly 4.2 seconds against a 2.5-second test threshold. Runtime performance and AI iteration latency therefore need separate fixes.

## Proposed Solution

### Target architecture

```text
                         PRODUCT RUNTIME

User → Thin Skill → Report Run Engine → immutable RunSpec/Audit/Snapshots
                              │
                              ├─ lane ticket: report-synthesis
                              ├─ lane ticket: key-session-analysis
                              └─ lane ticket: skill-insights
                                      │
                                 Host Agent generates
                                      │
                           ai-accept validates per lane
                                      │
                         accepted artifact or explicit fallback
                                      │
                         compose → render → write → UI dispatch
                                      │
                       delivery status + lane status + trace status

                         DEVELOPMENT EVAL LAB

Frozen Case + accepted baseline + candidate
               │
               ├─ Generator trials
               ├─ deterministic Contract Grader
               ├─ blind dimensioned Quality Grader
               ├─ failure analysis / transcript inspection
               └─ Optimizer proposes one candidate revision
                              │
                  smoke → regression → held-out gate
                              │
                   explicit promotion to prompts/
                              │
                   one full-report acceptance run
```

### Main design decisions

1. **Deterministic orchestration moves into the CLI.** The Skill retains intent, scope, privacy, interpretation boundaries, and completion criteria. It does not manually bind Run metadata or assemble envelopes.
2. **Every AI lane has its own immutable input, raw attempt, validation result, and accepted artifact.** One invalid lane cannot erase another valid lane.
3. **The file-based Run remains.** A short cross-process lock and atomic mutation are sufficient; a database or daemon is unnecessary.
4. **Report delivery and AI completeness are separate states.** A successfully written fallback report may be delivered successfully while declaring one degraded lane.
5. **AI behavior is evaluated without HTML.** Lane Evals reuse a frozen `AuditResult`, Content Evidence artifact, or Skill Snapshot and invoke only the affected Prompt and validator.
6. **Self-improvement is bounded and independently judged.** Generator, Quality Grader, Optimizer, and Promoter use separate contexts. The Optimizer cannot promote its own work.
7. **The accepted baseline is the previous Prompt or Skill, not “no Skill.”** A candidate must prove improvement over current behavior and preserve regressions.

## Alternatives Considered

### Continue tuning Prompts through complete dogfood reports

- Advantages: no new infrastructure; evaluates the visible product.
- Disadvantages: slow, noisy, non-repeatable, and hard to attribute; report-runtime failures contaminate Prompt-quality judgments.
- Reason rejected: it is the current failure mode.

### Add Evals but leave runtime orchestration in the Skill

- Advantages: faster Prompt work and smaller initial code change.
- Disadvantages: valid AI output can still disappear through manual envelopes, concurrent manifest overwrites, or incomplete finalization.
- Reason rejected: quality measurement cannot compensate for an unreliable delivery path.

### Put model calls directly in the TypeScript CLI

- Advantages: fully automated orchestration and direct timing.
- Disadvantages: adds credentials, Provider coupling, policy surface, and a second AI runtime; conflicts with `docs/DESIGN.md`.
- Reason rejected: the Host Agent is already the intended model runtime.

### Build a general workflow/Eval platform

- Advantages: maximum extensibility.
- Disadvantages: large scope, new abstractions, longer feedback loop, and little current evidence that generic infrastructure is needed.
- Reason rejected: three fixed lanes and file artifacts are sufficient.

## Implementation Plan

Estimated total: **13–21 focused engineering days**, excluding waiting time for multi-trial model runs and human calibration. With two independent implementation lanes, Phases 1/3 and 4/5 can overlap for roughly **10–16 calendar working days**.

### Phase 0: Freeze baseline and approve contracts

- Goal: make later architecture and Prompt changes measurable.
- Estimate: 1–2 days.
- Files:
  - `docs/AI_PIPELINE_EVAL_SPEC.md`
  - `docs/AI_PIPELINE_EVAL_TICKETS.md`
  - future `evals/` contract and redacted Cases
- Tasks:
  - Record the current accepted Prompt hashes and packaged bundle version.
  - Select five initial real failure clusters and create sanitized or local-only frozen inputs.
  - Define deterministic expectations, Quality Rubrics, blocking failures, held-out Cases, and promotion thresholds.
  - Record one current baseline run per Case; use three trials only for high-variance or promotion-critical Cases.
  - Confirm the normal runtime state model and lane artifact formats in the Spec.
- Expected Result: a versioned baseline exists before runtime or Prompt behavior changes.

### Phase 1: Make Report Run mutation concurrency-safe

- Goal: eliminate lost stage, artifact, warning, and attempt updates.
- Estimate: 2–3 days.
- Files:
  - `src/report-run.ts`
  - `src/cli.ts`
  - `tests/report-run.test.js`
- Tasks:
  - Implement ticket 0015 with one Run-scoped short lock.
  - Reload the latest manifest inside every mutation.
  - Commit manifest mutation and corresponding trace/artifact registration atomically.
  - Keep history reads, model waits, validation, and render work outside the lock.
  - Add repeated concurrent tests covering three AI lanes plus Evidence and artifact registration.
- Expected Result: concurrent commands cannot silently erase each other's state.
- Dependency: Phase 0 contract approval.

### Phase 2: Introduce lane tickets and artifact-based composition

- Goal: remove handcrafted envelopes and persist exact AI failure causes.
- Estimate: 3–5 days.
- Files:
  - `src/report-run.ts`
  - `src/cli.ts`
  - `src/key-session-analysis.ts`
  - `src/skill-insights.ts`
  - `skills/where-tokens-went/SKILL.md`
  - `prompts/report-synthesis.md`
  - `prompts/key-session-analysis.md`
  - `prompts/skill-insights.md`
  - related report-run and packaging tests
- Tasks:
  - Implement ticket 0016 as `evidence --auto`, `ai-start`, `ai-accept`, artifact-only `compose`, and stronger `finalize`.
  - Freeze one bounded lane input artifact before each model call.
  - Let `ai-accept` bind Run metadata automatically and persist raw output hash, validator errors with field paths, rejection reasons, attempt, and accepted/fallback status.
  - Compose only from accepted lane artifacts and explicit fallbacks.
  - Separate `deliveryStatus`, per-lane status, and `traceStatus`.
  - Keep compatibility `compose-report` available but outside the normal Skill path.
- Expected Result: an AI result is either durably accepted, durably rejected with a reason, or explicitly unavailable; it cannot vanish between generation and HTML.
- Dependency: Phase 1.

### Phase 3: Build the lane-only Prompt Lab

- Goal: make Prompt/Skill iteration independent from full report generation.
- Estimate: 2–3 days for Skill Insights; 1 additional day for the other two lane adapters.
- Files:
  - new `evals/` contracts, Case manifests, Rubrics, and experiment templates
  - new versioned scripts under `scripts/`
  - existing lane validators
  - `package.json`
- Tasks:
  - Implement ticket 0019 with commands to capture or bind frozen lane inputs, run deterministic validation, and store iteration artifacts.
  - Support all three lanes, beginning with Skill Insights.
  - Keep real local content under `.scratch/`; commit only redacted fixtures.
  - Save accepted baseline Prompt, candidate Prompt, outputs, validation, model identity, timing, Token usage, and transcript reference for each trial.
  - Do not render HTML or run report preparation inside the inner loop.
- Expected Result: Skill Insights can be iterated by reusing one `skill-snapshot.json` and calling only the authoritative Prompt plus `validateSkillInsights()`.
- Dependency: Phase 0; may proceed in parallel with Phases 1–2 if it reads existing artifacts without changing runtime.

### Phase 4: Add bounded Generator–Grader–Optimizer automation

- Goal: automate feedback and candidate revision without letting a model self-approve.
- Estimate: 2–3 days.
- Files:
  - Prompt Lab runner and schemas
  - lane-specific Rubrics and good/bad references
  - benchmark aggregation and static review output
- Tasks:
  - Implement ticket 0020.
  - Run accepted baseline and candidate against identical Cases.
  - Apply deterministic Contract Graders before semantic grading.
  - Use an isolated blind Quality Grader with dimension-level scores and `unknown` support.
  - Give the Optimizer only failed dimensions, relevant transcript evidence, and annotated references; require one falsifiable hypothesis per revision.
  - Stop after three non-improving revisions, any blocking regression, or unresolved variance.
  - Aggregate pass rate, per-dimension results, mean/stddev, time, Tokens, tool calls, and failures; generate a review artifact before promotion.
- Expected Result: the model can iteratively improve a candidate, but promotion remains evidence-backed and independently gated.
- Dependency: Phase 3.

### Phase 5: Remove unrelated deterministic latency

- Goal: keep full-report acceptance fast without weakening correctness.
- Estimate: 1–2 days.
- Files:
  - Readers and source inventory code
  - pricing/font cache code
  - `tests/performance-benchmark.test.js`
- Tasks:
  - Implement ticket 0017.
  - Inventory only files used by the frozen Scope.
  - Move reusable price/font caches to a stable user-level cache with environment override.
  - Add bounded concurrency and positive/negative pricing cache behavior.
  - Verify Audit facts and fingerprint remain unchanged.
- Expected Result: full deterministic report preparation meets the MVP budget, while Prompt Lab iterations remain much faster because they bypass it entirely.
- Dependency: Phase 1; may proceed in parallel with Phase 4.

### Phase 6: Promotion gate, AGENTS.md, and final acceptance

- Goal: make the new workflow the repository default and prevent regression to ad hoc tuning.
- Estimate: 1–2 days.
- Files:
  - `AGENTS.md`
  - `package.json`
  - `docs/MVP.md`
  - `docs/DESIGN.md`
  - `CONTEXT.md` only if terminology changes
  - packaged Skill and verification tests
- Tasks:
  - Implement tickets 0018 and 0021 after the underlying commands exist.
  - Add concise AGENTS.md pointers that distinguish deterministic tests, lane Evals, and full-report acceptance.
  - Define targeted, candidate, and scheduled test commands in `package.json`.
  - Require Prompt promotion records and convert confirmed failures to regression Cases.
  - Package once, verify sync once, then run one complete real report through HTML and UI dispatch.
  - Confirm accepted AI artifacts are visible, per-lane fallback reasons are accurate, and Run completion is not conflated with AI degradation.
- Expected Result: future agents follow the fast loop by default and pay for the full workflow only at the promotion boundary.
- Dependencies: Phases 2–5.

## Validation Strategy

### Deterministic validation

- Run focused unit tests for Run mutation, lane input binding, validators, artifact integrity, privacy, and renderer projection.
- Add a concurrency stress test that repeats simultaneous mutations and proves no missing stage, attempt, warning, or artifact.
- Add corruption tests for stale fingerprint, wrong Snapshot ID, malformed AI JSON, invalid Evidence refs, damaged HTML artifact, and bundle-version drift.

### AI behavior validation

- Start with five failure clusters:
  - accepted analysis missing from the final projection;
  - opaque unavailable/fallback state;
  - invalid or cross-Scope Evidence reference;
  - generic Finding or metric restatement;
  - partial Key Session or Capability analysis without an explicit grounded reason.
- Use deterministic gates first, then dimensioned semantic grading.
- Run baseline and candidate in isolated contexts over the same input.
- Use one trial for smoke; use three trials for promotion-critical and unstable Cases.
- Keep a held-out subset to detect Prompt overfitting.

### Full-report acceptance

- Run installed-bundle preflight.
- Create one frozen Report Run.
- Exercise all eligible AI lanes through `ai-start` and `ai-accept`.
- Compose and write one final HTML.
- Verify each accepted lane is visible in HTML and each fallback exposes the correct stable reason.
- Open the final HTML, record `completed` or `queued`, and finalize the Run.

Expected commands will be finalized by the tickets; do not invent temporary bridge commands in implementation sessions.

## Risks and Mitigations

| Risk | Impact | Mitigation | Fallback |
| --- | --- | --- | --- |
| Eval overfits a few familiar reports | Prompt improves examples but regresses real use | Hold out Cases, use annotated principles rather than ideal prose, rotate new real failures into regression | Reject candidate and keep accepted baseline |
| Same model edits and grades its own Prompt | Self-confirming loop | Isolated blind Grader, deterministic gates, optional human calibration | Mark result inconclusive |
| Run locking adds deadlocks or latency | Reports stall | Short lock only around reload/mutate/atomic write; bounded wait; no long work under lock | Fail safely without deleting uncertain lock |
| New lane contracts duplicate Prompt schemas | Sources drift | Prompts remain authoritative; TypeScript validators and input projection are single code authorities | Stop on hash/version mismatch |
| Local Eval Cases expose private history | Privacy breach | Store real packets under `.scratch/`; commit only redacted fixtures and hashes | Remove Case from shared suite and retain local-only manifest |
| Fast lane Eval misses renderer defects | AI quality passes but HTML is broken | One full-report acceptance after promotion plus deterministic projection tests | Roll back Prompt/runtime candidate |
| Automated optimization consumes excessive time or Tokens | Loop becomes another slow workflow | Smoke first, deterministic failure short-circuit, three-revision cap, per-experiment budget | Stop as inconclusive |

## Open Questions

No question blocks Phase 0. Two decisions should be calibrated with the first baseline rather than guessed now:

- exact dimension thresholds for promotion;
- which model/context combination should serve as the independent Quality Grader.

## Recommended Next Step

Execute Phase 0 through proposed ticket 0018: approve the Spec, freeze the current Skill Insights Prompt and five representative Cases, and record the first accepted baseline before changing runtime or Prompt behavior.
