'use strict';

/**
 * Shared fixtures for Lane output contract v2 (`outputContractVersion: 2`).
 *
 * These helpers build model-shaped submissions out of the frozen Evidence
 * Directory the Run itself produced. They deliberately do not call the
 * production resolver to compute expectations: the expected canonical values
 * are read from the independent canonical `audit.json` artifact, so a resolver
 * bug cannot make its own output look correct.
 */

const { readFile } = require('node:fs/promises');
const path = require('node:path');

async function readProjection(runDir, lane) {
  return JSON.parse(await readFile(path.join(runDir, 'lanes', lane, 'input.json'), 'utf8'));
}

async function readCanonicalAudit(runDir) {
  return JSON.parse(await readFile(path.join(runDir, 'audit.json'), 'utf8'));
}

function evidenceEntries(projection) {
  return (projection && projection.directory && projection.directory.evidence) || [];
}

function printableEntry(projection, predicate) {
  return evidenceEntries(projection).find((entry) => entry.displayPolicy === 'allowed' && entry.citable && predicate(entry));
}

/**
 * Minimal valid v2 Report Synthesis object. The measurement that the free-form
 * statistic refers to is chosen by an explicit predicate, so each test states
 * which canonical fact it needs.
 */
function v2Synthesis(projection, options = {}) {
  const entry = options.entry
    || printableEntry(projection, (candidate) => candidate.objectKind === 'summary' && candidate.value && typeof candidate.value.value === 'number')
    || printableEntry(projection, () => true);
  if (!entry) throw new Error('projection has no printable Evidence Directory entry');
  const summary = options.summary
    || `The fixture records a bounded activity period with ${'[['}${entry.handle}${']]'} recorded.`;
  return {
    overview: { summary, evidenceRefs: [entry.handle] },
    findings: options.findings ?? [],
    noStrongFindingReason: options.noStrongFindingReason ?? 'The fixture does not contain enough evidence for a distinct report-level finding.',
  };
}

/**
 * Minimal valid v2 Key Session Analysis array. `handleIndex` selects which
 * selected Session to address; `evidence` selects a citable turn entry.
 */
function v2KeySessionAnalyses(projection, options = {}) {
  const session = projection.directory.sessions[options.sessionIndex ?? 0];
  if (!session) throw new Error('projection has no Session handle');
  const turnEntry = options.evidence
    || evidenceEntries(projection).find((entry) => entry.objectKind === 'turn' && entry.ownerCanonicalId === session.canonicalId && entry.displayPolicy === 'allowed');
  const entry = {
    sessionHandle: session.handle,
    taskContext: options.taskContext ?? 'Fixture task context for the selected Session.',
    primaryFinding: null,
    recommendation: null,
    limitations: options.limitations ?? ['fixture limitation'],
  };
  if (options.finding) {
    entry.primaryFinding = {
      observation: options.finding.observation ?? (turnEntry ? `The selected Turn carried ${'[['}${turnEntry.handle}${']]'}.` : 'The selected Turn carried the dominant share.'),
      interpretation: options.finding.interpretation ?? 'The selected Turn concentrated the Session workload.',
      evidenceIds: [turnEntry.handle],
      support: options.finding.support ?? 'moderate',
      alternativeExplanations: options.finding.alternativeExplanations ?? ['Task complexity could explain the concentration.'],
    };
    entry.recommendation = {
      action: options.finding.action ?? 'Split the long document into bounded sections.',
      rationale: options.finding.rationale ?? 'Reduces repeated context exposure in later Turns.',
      applicability: options.finding.applicability ?? 'When a single document dominates the task.',
      tradeoff: null,
      verification: options.finding.verification ?? 'Check the next equivalent task and confirm quality stays acceptable.',
      targetEvidenceIds: [turnEntry.handle],
    };
  }
  return [entry];
}

module.exports = {
  readProjection,
  readCanonicalAudit,
  evidenceEntries,
  printableEntry,
  v2Synthesis,
  v2KeySessionAnalyses,
};
