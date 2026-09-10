# Working on where-tokens-went

The formal external project name and current CLI/Skill/plugin namespace is `where-tokens-went`. Keep this namespace consistent across user-facing text, executable names, Skill IDs, plugin IDs, paths, and generated artifacts.

Build the smallest end-to-end path that improves the Aha moment in [docs/MVP.md](docs/MVP.md).

- Before changing product scope or acceptance behavior, read `docs/MVP.md`.
- Before changing CLI, shared records, analysis, or privacy behavior, read `docs/DESIGN.md`.
- Before changing a Harness Reader, read that Harness section in `docs/HARNESS_DATA_SOURCES.md` and verify assumptions against the cited primary source.
- Use the domain terms in `CONTEXT.md`; update the glossary only when the meaning changes.
- Treat the invoking Harness as a hard boundary. Project and time range may widen only when the request says so.
- Keep raw prompts, source code, and tool output local. Default output contains metadata, sizes, hashes, and source locations, not content.
- Preserve unknown and missing values. Attach `reported`, `derived`, `estimated`, or `unavailable` to every diagnostic value that could be mistaken for an exact measurement.
- Add the smallest runnable check for each non-trivial parser or counting rule, preferably using a minimal redacted sample from the user's real history.
- Prefer one Reader function and one shared analysis path over registries, factories, services, databases, or extension frameworks.

Repository scripts and configuration are the source of truth for commands and dependencies; keep this file focused on behavior that is not obvious from the tree.
