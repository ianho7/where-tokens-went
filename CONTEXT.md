# Agent Audit

Agent Audit is the domain of explaining a coding agent's historical resource usage from evidence already stored by its harness.

## Language

**Host Agent**:
The coding agent in which the user invokes Agent Audit, such as Codex or Claude Code.
_Avoid_: Provider, model, client

**Harness**:
The agent runtime that owns sessions, tools, persistence, and execution behavior. Claude Code, Codex, Pi, and DeepSeek Harness are Harnesses.
_Avoid_: Model, Provider

**Provider**:
The service that executes a model request. A Harness may use more than one Provider.
_Avoid_: Harness, Agent

**Session**:
A persisted unit of interaction owned by one Harness and associated with a project or working directory.
_Avoid_: Request, run

**Subagent Session**:
A persisted execution Session whose Harness metadata explicitly identifies it as a subagent; it is not the same thing as a top-level task shown in a Host Agent sidebar.
_Avoid_: Top-level task

**Current Project**:
The absolute working directory supplied by the invoking Host Agent and used to select matching Sessions.
_Avoid_: Repository, project slug

**Audit Scope**:
The explicit combination of Harness, project selection, and time range included in one Audit.
_Avoid_: Global state

**Global Audit**:
An Audit covering all projects for the invoking Harness within a requested period. It does not combine different Harnesses.
_Avoid_: Cross-Harness audit

**Reader**:
A Harness-specific interpreter that converts persisted Session records into the minimal common records required by Analysis.
_Avoid_: Connector, Adapter, Collector

**Usage**:
The observed model-resource quantities associated with a model call, such as input, cached input, output, reasoning, or reported cost.
_Avoid_: Quota

**Evidence**:
A value plus enough source location and method information for a person or Agent to verify how it was obtained.
_Avoid_: Claim, insight

**Automated Check**:
A deterministic, descriptive diagnostic signal with a stable identity, outcome, Evidence, and method. Its user-facing projection is human-readable, but it does not select a primary cause, prescribe an action, or impersonate a Host Agent Finding.
_Avoid_: Finding, recommendation, verdict

**Finding**:
A Host Agent-owned prioritized explanation of an observed usage pattern supported by Evidence.
_Avoid_: Alert, metric

**Provenance**:
The origin class of a value: `reported`, `derived`, `estimated`, or `unavailable`.
_Avoid_: Confidence

**Context Amplification**:
The repeated inclusion of earlier content, especially tool results, in later model requests within a Session.
_Avoid_: Exact billed tokens
