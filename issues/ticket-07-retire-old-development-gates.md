# Ticket 07: Retire formal Eval development gates

**Status:** PASS

## Acceptance criteria

- [x] Prompt-only development uses the Fast Loop: one fixed fixture, one selected Prompt, one model call, a thin factual/Evidence check, and human review of the JSON.
- [x] Product runtime, validator, privacy, fallback, composition, rendering, or distribution changes use the relevant deterministic checks and real regressions; HTML or installed-Skill acceptance is required only when the changed boundary calls for it.
- [x] Formal baseline, grading, optimizer, promotion, provenance, and repeated-Run ceremonies are retired from active development guidance and CLI commands.
- [x] Runtime validators, deterministic Audit behavior, privacy boundaries, Report Run delivery, and explicit fallback behavior remain in the active product path.
- [x] Historical Eval artifacts and documents are labeled as historical rather than current acceptance gates.
- [x] `npm run package-skills` and `npm run verify-sync` pass from the updated source.
- [x] Independent review reports no unresolved P0/P1 findings.

## Scope notes

The formal Eval CLI is removed from `src/cli.ts`, and its npm command aliases are removed. Historical Eval implementation and test files remain in the repository but are no longer part of the default targeted test command; some old tests still invoke the removed CLI and are not runnable. Existing Ticket/DAG states are unchanged.

Independent Reviewer: PASS, no unresolved P0/P1 or blocking findings. The reviewer confirmed the product CLI, Report Run, and validator paths remain present and the generated runtime reflects the source CLI.

## Validation

- `npm run package-skills` — passed; bundle version `0.1.0+f7f6d139b4d6fa534a72c0f15a13570a1112f1c75ca7e08190fe01cb58614773`.
- `npm run verify-sync` — passed with the same bundle version.
