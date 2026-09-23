# Candidate Prompt Delta: evidence-first Cognitive Delta selection, revision 1

Read the current authoritative `prompts/skill-insights.md` and apply the evidence-first selection policy in `evals/candidates/skill-insights-cognitive-delta-v1.md`. This file adds exactly one revision to that candidate: evidence references must be generated from the validator contract, never invented as semantic aliases.

Use only these canonical `Reveal.evidenceRefs` forms, matching an evidence entry that actually appears in the same insight:

- content: `<skillId>:<role>` for `skill_content` or `cross_skill_content` evidence, where role is the supplied semantic role;
- skill: `<skillId>:<metric>` for `skill_metric` evidence;
- family: `<familyId>:<metric>` for `family_metric` evidence;
- global: `<metric>` and distribution: `<metric>` for their corresponding metric evidence.

For `family_concentration`, include and reference `family:...:callShare`, `family:...:totalCalls`, and `global:totalSkillCalls`. Do not use aliases such as `content:harness-host`, `global:dominantFamily`, or `global:top4CallShare` unless they are canonical evidence references accepted by the validator.
