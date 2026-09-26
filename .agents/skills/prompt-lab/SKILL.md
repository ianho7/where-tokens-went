---
name: prompt-lab
description: Run one selected Prompt Lab lane with its fixed fixture and inspect its checked output.
disable-model-invocation: true
---

# prompt-lab

## Fast Loop

The Fast Loop is the default for a Prompt-only change: one fixed fixture, one selected Prompt, one model call, the lane's thin factual/Evidence check, and human review of the JSON. Use the Prompt named in the request; if none is named, ask the user which one to run. A Prompt edit does not require packaging, installation, a full Report Run, HTML, repeated trials, an accepted baseline, or promotion.

| Prompt | Fixed fixture |
| --- | --- |
| `report-synthesis` | `normal-synthetic` |
| `key-session-analysis` | `partial-key-session` |
| `skill-insights` | `skill-insights-snapshot-v2` |

1. Create a fresh temporary run directory under `.scratch/prompt-lab/`. Run `npm run --silent prompt:lab -- --prompt <selected-prompt> --fixture <matching-fixture>`, redirecting its JSON output to `prepared.json` in that directory. Stop if the command fails.
2. Read `prepared.json`. Confirm `inputSummary.prompt` and `inputSummary.fixture` match the selected row, and `check.status` is `awaiting-model-output`. Keep the full `modelInput` local; do not print it in the conversation.
3. Dispatch exactly one fresh analysis subagent. Give it the complete selected `modelInput` as its sole analysis input and ask it to follow that Prompt once, returning only the resulting JSON value with no fences or commentary. Do not let it use tools or delegate. Do not run sibling Prompts or retry the analysis call.
4. Capture the response unchanged as `ai-output.json` in the same run directory. If the subagent errors or the response is not valid JSON, run `npm run --silent prompt:lab -- --prompt <selected-prompt> --fixture <matching-fixture> --fallback "<brief reason>"`. Otherwise run `npm run --silent prompt:lab -- --prompt <selected-prompt> --fixture <matching-fixture> --result <absolute-path-to-ai-output.json>`. Save either command's output as `checked.json`.
5. Read and show `inputSummary`, `aiOutput`, `evidenceReferences`, and `check` from `checked.json`. A `check.status` of `fail` is the result; do not regenerate or retry.
6. Remove the temporary run directory after presenting the result.

The deterministic CLI is model-free. It reads only the selected source Prompt and fixed fixture, then runs that lane's existing validator. It does not run sibling Prompts, scan history, recompute an Audit, request pricing, render HTML, package or install Skills, or run report orchestration. The single analysis call is the fresh subagent dispatch in step 3.

`check.pass` means the selected lane's deterministic checks passed; review wording, Evidence fidelity, and recommendation usefulness yourself. A fallback records that no valid model result was available; it is not a validator pass.

## Release Loop

Use the Release Loop when a change affects runtime behavior, validators, privacy, fallback, composition, rendering, or Skill distribution. Run the relevant deterministic tests and real regression cases, then inspect one relevant AI result with the same thin check and human review. Check JSON-to-HTML only when composition or rendering changed. Run installed-Skill acceptance once when the installed delivery path changed or a release explicitly requires it. Do not repeat full Report Runs for Prompt-only edits, and do not use formal Eval promotion, accepted baselines, graders, optimizers, provenance records, or score thresholds as a development gate.
