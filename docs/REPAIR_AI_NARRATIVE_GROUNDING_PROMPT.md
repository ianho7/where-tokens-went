# Repair Prompt: AI Narrative Grounding

Use the `ponytail` skill in full mode for this task. Implement the smallest shared-boundary fix that rejects parameterized AI narrative templates without adding dependencies, a fuzzy-matching service, embeddings, or a general evaluation framework.

## Objective

Fix the report acceptance path so structurally valid but interchangeable AI prose is not rendered as Session-specific or Finding-specific analysis.

Expected outcome:

- Key Session Analysis is generated only through the authoritative bundled Prompt and parameterized template groups fail closed.
- Report-level Findings cannot pass validation when they differ only by labels, identifiers, ranks, or numbers.
- The Overview cannot be a parameterized restatement of a Finding.
- Honest null/unavailable fallback remains preferable to generic AI prose.

In scope: Prompt packaging, Skill workflow enforcement, deterministic validation, focused regression tests, and directly affected documentation.

Out of scope: fuzzy semantic similarity, embeddings, a second model call, a general rules engine, a formal golden evaluation platform, report redesign, Reader changes, pricing, deployment, and regenerating historical reports.

## Mandatory context before editing

Read these files in full before changing code:

1. `AGENTS.md`
2. `docs/MVP.md`
3. `docs/DESIGN.md`
4. `prompts/report-synthesis.md`
5. `prompts/key-session-analysis.md`
6. the active Harness Skill under `skills/where-tokens-went-*/SKILL.md`
7. `src/key-session-analysis.ts`
8. the relevant tests in `tests/interactive-report-regressions.test.js` and `tests/codex-inspect.test.js`

Treat the two files under `prompts/` as the single sources of truth. Packaged files under each Skill's `references/` are generated copies and must remain byte-for-byte equal to their sources.

## Background and context

The bad report contained three different tasks but rendered a common template whose only meaningful variation was “第 1/2/3 高用量 Session” and deterministic numbers. The renderer correctly displayed already accepted `KeySessionAnalysis` fields.

The current shared validator checks fingerprint, Scope, non-empty fields, same-Session Evidence IDs, selected Turn membership, support enum, and recommendation shape. Its duplicate guard normalizes Unicode, whitespace, and case, then compares the complete `observation + interpretation + action` string exactly. Rank substitution therefore bypasses it.

A deterministic reproduction has confirmed that three analyses with distinct Session IDs, titles, and Evidence IDs are all accepted when their narrative differs only by rank.

## Current state already completed

Do not recreate or fork these decisions:

- `prompts/key-session-analysis.md` is the authoritative generation Prompt for the complete Token-ranked `KeySessionAnalysis[]`.
- `prompts/report-synthesis.md` contains a portability test for parameterized report Findings.
- `scripts/package-skills.js` packages both Prompts into both Harness Skills.
- the shared Harness Skill requires reading both bundled Prompts in full.
- `AGENTS.md`, `docs/MVP.md`, `docs/DESIGN.md`, and `docs/adr/0001-key-session-analysis-in-report.md` record this contract.

First verify these statements in the worktree. Preserve them; fix discrepancies instead of creating parallel documents.

## Current-state risks to fix

### Key Session Analysis

`composeKeySessionAnalyses()` accepts a group of interchangeable analyses when ranks, Session/Turn identifiers, or numeric values differ. It also keeps the first member of an exact-duplicate group, even though the validator cannot know which member is legitimate.

### Report-level Findings

`validateReportSynthesis()` validates structure and Evidence references but does not reject multiple Findings that are the same template with different metric, Session, model, project, rank, identifier, or numeric substitutions.

### Overview versus Finding

The Prompt forbids the Overview from repeating a Finding's wording and Evidence detail, but deterministic validation does not catch an exact or parameterized restatement.

The final conversational Finding is not a separate generated artifact; it reuses validated report output. Do not add a third authoritative Prompt for it.

## Proposed solution

Keep the fix in `src/key-session-analysis.ts`, where both report synthesis and Key Session composition already validate AI-authored structures.

Add one small deterministic narrative canonicalizer that:

- applies NFKC, locale-independent case folding, whitespace collapse, and punctuation normalization;
- replaces exact current-Audit Session IDs, display names, Evidence IDs, and Turn IDs before comparison;
- replaces rank ordinals and numeric spans, including percentages and durations;
- compares prose structure only after those known per-instance values are removed;
- uses no fuzzy threshold, external dependency, model call, or configurable framework.

Use that helper at two existing trust boundaries.

For Key Session Analysis:

- structurally validate candidates first;
- canonicalize the current core fields: `primaryFinding.observation`, `primaryFinding.interpretation`, and `recommendation.action`;
- group matching non-null signatures across different Sessions;
- reject every member of a duplicate group, not only later members, because the validator cannot identify a trustworthy original;
- add one clear unavailable reason instructing Host Agent regeneration with Session-specific Evidence;
- preserve legitimate null analyses and the existing fallback behavior.

For Report Synthesis:

- canonicalize each `title + analysis` pair;
- reject parameterized duplicate Finding groups with explicit validation errors;
- compare the canonical Overview summary with each canonical Finding narrative and reject an interchangeable restatement;
- retain the current structural and Evidence-reference validation unchanged.

Do not attempt to prove broad semantic equivalence. This deterministic guard covers the observed parameter-substitution failure; the authoritative Prompts remain responsible for deeper reasoning quality.

## Alternatives considered

### Remove only “第 N” before the existing comparison

Smallest patch, but it misses Session IDs, Turn ordinals, percentages, durations, and the same failure in Report Synthesis. Reject this alternative.

### Fuzzy text similarity or embeddings

May catch paraphrases but introduces thresholds, dependencies, false-positive tuning, privacy questions, and a new evaluation surface. Defer until real reports demonstrate failures that deterministic known-variable canonicalization cannot catch.

### Prompt-only fix

The authoritative Prompts improve generation, but malformed AI output can still reach composition. Keep Prompt guidance and add the deterministic acceptance guard.

## Implementation plan

### Phase 1: Lock the observed failure

- Goal: create a red test for the exact parameterized-template class.
- Files: `tests/interactive-report-regressions.test.js`.
- Tasks: adapt the existing duplicate test to use three distinct tasks, Evidence IDs, rank labels, and numeric values; assert that every member of the template group is unavailable. Add one compact positive case showing that genuinely different mechanisms remain accepted.
- Expected result: the new regression fails against the current exact-string implementation.

### Phase 2: Fix the shared acceptance boundary

- Goal: reject known-variable template substitution once for all callers.
- Files: `src/key-session-analysis.ts`.
- Tasks: add the minimum canonicalization helper and group detection described above; update Key Session and Report Synthesis validation without changing public types.
- Expected result: the Phase 1 regression passes, exact duplicate behavior remains fail-closed, and distinct analyses still pass.

### Phase 3: Lock Prompt packaging and invocation

- Goal: prevent either Harness from silently losing the authoritative Prompt.
- Files: `tests/codex-inspect.test.js`; generated Skill reference copies only through the packaging script.
- Tasks: extend the existing packaging test to compare both source Prompts byte-for-byte with the shared bundled copies and assert that the shared Skill requires reading each Prompt in full.
- Expected result: one focused packaging test proves Codex and Claude carry the same sources of truth.

### Phase 4: Review documentation consistency

- Goal: ensure no document still describes exact-string duplicate handling as sufficient.
- Files: only the already affected docs and Skills.
- Tasks: search for `exact duplicate`, `normalized core prose`, `report-synthesis.md`, and Key Session generation language; remove stale contradictions while keeping one source of truth for detailed generation rules.
- Expected result: docs point to the authoritative Prompts instead of duplicating their bodies.

## Validation strategy

Use the repository Fast Path. Run only:

1. the focused Key Session/report synthesis regression tests;
2. the focused Prompt packaging/Skill contract test;
3. `npm run typecheck` once because shared TypeScript validation changes;
4. one packaging run only if generated bundled Prompt copies are stale;
5. one final `git diff --check` and scoped diff review.

Do not run the full suite, generate a new usage report, take screenshots, rebuild unrelated assets repeatedly, install dependencies, or perform release/deployment checks unless a focused failure proves they are necessary. Never rerun an already passing check after documentation-only edits.

## Risks and mitigations

- Risk: canonicalization rejects two legitimate analyses with a shared mechanism. Mitigation: compare the mechanism-bearing core, reject the whole ambiguous group to an honest fallback, and keep a positive regression for independently grounded distinct mechanisms.
- Risk: canonicalization becomes an ad hoc NLP framework. Mitigation: replace only known instance variables and basic text formatting; add a `ponytail:` comment naming fuzzy similarity as the upgrade path only if real misses recur.
- Risk: Prompt copies drift. Mitigation: preserve byte-for-byte packaging tests from the two source Prompt files.
- Risk: raw Content Evidence leaks into persistent output. Mitigation: do not add packets or content to the composition envelope, JSON, text, share output, fixtures, or logs.

## Open questions

None are blocking. If a focused test reveals that a known variable cannot be identified from the current Audit, leave that variable unsupported and document the concrete ceiling rather than adding heuristic NLP.

## Recommended next step

Implement Phase 1 first and watch the parameterized three-Session regression fail before editing `src/key-session-analysis.ts`.
