---
name: prompt-lab
description: Run one fixed report-synthesis Prompt Lab case and show its checked output.
disable-model-invocation: true
---

# prompt-lab

Run one development analysis against the fixed `report-synthesis` Prompt and `normal-synthetic` Audit fixture.

1. Create a fresh temporary run directory under `.scratch/prompt-lab/` and run `npm run --silent prompt:lab -- --prompt report-synthesis --fixture normal-synthetic`, redirecting its JSON output to `prepared.json` in that directory. Stop if the command fails.
2. Read `prepared.json`. Confirm `inputSummary.prompt` is `report-synthesis`, `inputSummary.fixture` is `normal-synthetic`, and `check.status` is `awaiting-model-output`. Keep the full `modelInput` local; do not print it in the conversation.
3. Dispatch exactly one fresh analysis subagent. Give it the complete `modelInput` as its sole analysis input and ask it to follow that Prompt once, returning only the resulting JSON object with no fences or commentary. Do not let it use tools or delegate. Do not retry or send a second analysis call if it errors or returns malformed JSON.
4. Capture the subagent's JSON response unchanged as `ai-output.json` in the same run directory. If the response is malformed or the subagent errors, report that result without making another analysis call.
5. Run `npm run --silent prompt:lab -- --prompt report-synthesis --fixture normal-synthetic --result <absolute-path-to-ai-output.json>`, capturing its JSON output. Read and show the `inputSummary`, `aiOutput`, `evidenceReferences`, and `check` fields even when the check command exits nonzero. A `check.status` of `fail` is the result; do not regenerate.
6. Remove the temporary run directory after presenting the result.

The deterministic CLI is model-free. It reads only the selected source Prompt and fixed synthetic fixture; it does not scan history, recompute an Audit, request pricing, render HTML, package or install Skills, or run report orchestration. The single analysis call is the fresh subagent dispatch in step 3.
