# where-tokens-went Eval assets

This directory contains redacted, immutable Eval contracts and fixtures. Real
history packets and model transcripts stay under the local `.scratch/` boundary.

The accepted baseline is a record of the Prompt/runtime identities and the
deterministic contract state at the time it was frozen. Candidate artifacts are
written to a separate experiment directory and never replace the baseline.
