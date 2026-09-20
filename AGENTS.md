# Working on where-tokens-went

The formal external project name and current CLI/Skill/plugin namespace is `where-tokens-went`. Keep this namespace consistent across user-facing text, executable names, Skill IDs, plugin IDs, paths, and generated artifacts.

## Product experience boundary

- Treat `where-tokens-went` as an evidence-backed usage explanation, not a demonstration of the Audit pipeline. The user-facing job is to answer: where usage went, what supported mechanism shaped it, and what to try next.
- Optimize the report's first screen for the ten-second Aha test in `docs/MVP.md`: the user can identify the largest meaningful usage destination, the supported mechanism or explicit unknown state, one justified next action, and any limitation that materially changes that answer.
- Let user questions determine the visual hierarchy: Primary Answer first, then supporting Evidence and secondary contributors, then Session drill-down, with methodology and data limitations last. The internal generation order must not become the reading order.
- Keep internal ontology inside code, structured data, developer documentation, and methodology details. User-facing narrative follows the language boundary in `CONTEXT.md` and does not narrate the analysis process or expose raw Evidence identifiers.
- Promote a pattern only when it changes the user's understanding or next decision. Keep accounting, Coverage, pricing, and other trust limitations in the trust layer unless they block or materially qualify the Primary Answer. When Evidence cannot support a mechanism or action, state the known destination and the specific unknown instead of manufacturing a Finding or recommendation.

## Report generation hard boundary

- Treat `src/` and `prompts/` as the sole Source of Truth. Never edit `skills/where-tokens-went/scripts/runtime/` directly; always update `src/` and run `npm run package-skills` to keep the distribution package in sync. Run `npm run verify-sync` before committing.
- When the user asks to generate and show a report or invokes `$where-tokens-went`, treat the Skill as the user-facing entry and run its complete workflow internally. Do not substitute or expose a direct Node command or low-level `inspect --html` invocation.
- For full/report views, use `inspect` only for data acquisition without `--html`; then read both bundled authoritative Prompts—`references/report-synthesis.md` and `references/key-session-analysis.md`—in full, generate and validate their outputs, call `compose-report` once with the validated envelope, and open only that final HTML.
- Any implementation plan that changes report synthesis, Key Session Analysis, Content Evidence, validation, composition, or report fallback must name both source Prompts in `prompts/`, require reading them before edits, and preserve their packaging into both Harness Skills.
- For the final report header, carry a local-only `projectName` outside `AuditResult`, resolved in this order: remote repository name, package/project name, directory basename, then `project`; never derive it from the sanitized `<current-project>` placeholder.
- A report request is complete only after the composed final HTML is opened. A deterministic `inspect --html` file without Host Agent composition is a fallback artifact, not the requested final report.
- Before any real report or test report creates a Report Run, scans history, or requests pricing, run the installed Skill bundle preflight. A failed preflight has one recovery path: run `npm run install-local`, then verify again; do not leave a partial Run artifact behind.
- The `package.json` version is the only `productVersion` source. Every Run manifest must retain one `bundleVersion` from prepare through Evidence, AI acceptance, compose, finalize, and UI dispatch; if it changes, stop the Run and never silently rewrite the contract.
- A real or test report is complete only when the final HTML is written and opened, AI output is valid or an explicit fallback is recorded, and UI dispatch is observed as `completed` or `queued`; version-preflight failure, install recovery, or Run-version drift is reported as a failed/incomplete outcome.

## Simple Task Fast Path

Use this path by default for small, local, low-risk changes, especially UI, copy, formatting, symbol, single-file, and localized logic changes:

`Locate → Edit → Targeted tests → Fix/retest failures → Optional one-time full validation → Diff review → Stop`

- Locate and modify the relevant code directly; avoid unrelated exploration.
- Run only tests directly related to the changed code first.
- After a test failure, rerun only the failed or relevant tests. Do not rerun the full suite after every fix.
- Run the full test suite at most once, during final verification, and only when justified. If targeted tests provide sufficient confidence and project rules do not require it, skip it.
- Run each relevant global validation step such as `typecheck`, `build`, or `lint` at most once. Skip unrelated packaging, release, artifact, cross-platform, and broad integration checks.
- Record unrelated pre-existing test failures and continue. Do not fix unrelated issues or expand task scope.
- Never repeat a validation step that has already passed just “to be safe.”
- Generate reports, screenshots, or artifacts only when explicitly required by the task.
- Finish with one quick `git diff` / changed-files review to catch accidental changes.
- Escalate to full validation only for public APIs, core logic, dependencies, build systems, security, migrations, broad refactors, or similarly high-risk changes.

> Validation must be proportional to change risk, not performed mechanically.  
> Do not turn a small task into a release-level verification cycle.

Build the smallest end-to-end path that improves the Aha moment in [docs/MVP.md](docs/MVP.md).

- Before changing product scope, report narrative, information hierarchy, localization behavior, or acceptance behavior, read `docs/MVP.md`.
- Before changing CLI, shared records, analysis, or privacy behavior, read `docs/DESIGN.md`.
- Before changing a Harness Reader, read that Harness section in `docs/HARNESS_DATA_SOURCES.md` and verify assumptions against the cited primary source.
- Use the domain terms in `CONTEXT.md`; update the glossary only when the meaning changes.
- Treat the invoking Harness as a hard boundary. Project and time range may widen only when the request says so.
- Keep raw prompts, source code, and tool output local. Default output contains metadata, sizes, hashes, and source locations, not content.
- Preserve unknown and missing values. Attach `reported`, `derived`, `estimated`, or `unavailable` to every diagnostic value that could be mistaken for an exact measurement.
- Add the smallest runnable check for each non-trivial parser or counting rule, preferably using a minimal redacted sample from the user's real history.
- Prefer one Reader function and one shared analysis path over registries, factories, services, databases, or extension frameworks.

Repository scripts and configuration are the source of truth for commands and dependencies; keep this file focused on behavior that is not obvious from the tree.

