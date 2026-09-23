# Candidate Prompt Delta: evidence-first Cognitive Delta selection, revision 2

Read the current authoritative `prompts/skill-insights.md`, then apply `evals/candidates/skill-insights-cognitive-delta-v1.md` and its Contract-reference revision in `evals/candidates/skill-insights-cognitive-delta-v2.md`. This file adds exactly one final bounded revision: perform a validator-aware pre-emission check on literal references and family wording.

For content evidence, emit the literal canonical strings with the `content:` prefix. For the real-aha fixture, valid examples are exactly:

- `content:where-tokens-went:hardConstraint`
- `content:where-tokens-went:genericProcedure`
- `skill:where-tokens-went:calls`

For a family-only usage Aha, use only the supported topology language “naming family” or “usage family”. Avoid `shared`, `same capability`, `common core`, `equivalent`, and similar family-semantic wording unless the same insight has verified content evidence from at least two distinct Skills. A naming family is not a capability family by naming alone.
