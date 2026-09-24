# Claude Code support pause and recovery

**Status:** paused since 2026-09-24. Codex is the only active Harness for `where-tokens-went`.

The shared Skill must stop with a paused-support message when invoked from Claude Code. The CLI rejects `--harness claude` before reading any history; it must never substitute Codex history for a Claude Code request.

## Frozen assets

- Reader: `src/claude-reader.ts`.
- Reader and data-behavior coverage: the Claude-specific cases in `tests/codex-inspect.test.js`; these remain runnable against `readClaude()` directly.
- Source notes: `docs/HARNESS_DATA_SOURCES.md`, section “Claude Code”.
- Skill entry and CLI boundary: `skills/where-tokens-went/SKILL.md` and `src/cli.ts`.

The Reader and notes are retained as recovery material, not a compatibility promise. No Claude real-history end-to-end run is required while support is paused.

## Conditions to resume

Before reactivating Claude Code, verify the current official data-source documentation and observed transcript shape, review a minimal redacted real sample, and run the focused Claude Reader tests. Then reconnect the Claude Skill and CLI entry explicitly, regenerate the packaged Skill, and verify the Codex path still selects only Codex history. Do not infer that the frozen Reader remained compatible during the pause.
