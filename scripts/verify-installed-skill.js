#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { AUDIT_SCHEMA_VERSION, SKILL_NAME } = require('./bundle-version');

const INSTALL_HINT = 'Run npm run install-local.';

function readBundleVersion(skillRoot, label) {
  const filePath = path.join(skillRoot, 'bundle-version.json');
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error(`${label} is missing bundle-version.json. ${INSTALL_HINT}`);
  }
  if (!value || typeof value !== 'object' || typeof value.productVersion !== 'string' || typeof value.bundleVersion !== 'string' || value.auditSchemaVersion !== AUDIT_SCHEMA_VERSION) {
    throw new Error(`${label} has an invalid bundle-version.json. ${INSTALL_HINT}`);
  }
  return value;
}

function verifyInstalledSkill(targetRoot, distributionRootBase = targetRoot) {
  const distributionRoot = path.join(distributionRootBase, 'skills', SKILL_NAME);
  const expected = readBundleVersion(distributionRoot, 'The repository distribution Skill');
  const locations = [
    ['.agents', path.join(targetRoot, '.agents', 'skills', SKILL_NAME)],
    ['.claude', path.join(targetRoot, '.claude', 'skills', SKILL_NAME)],
  ];
  for (const [label, skillRoot] of locations) {
    const actual = readBundleVersion(skillRoot, `The ${label} installed Skill`);
    for (const field of ['productVersion', 'bundleVersion', 'auditSchemaVersion']) {
      if (actual[field] !== expected[field]) {
        throw new Error(`where-tokens-went Skill version preflight failed: ${label} has ${field} ${JSON.stringify(actual[field])}, expected ${JSON.stringify(expected[field])}. ${INSTALL_HINT}`);
      }
    }
  }
  return expected;
}

if (require.main === module) {
  try {
    const repositoryRoot = path.resolve(__dirname, '..');
    const targetRoot = path.resolve(process.argv[2] || repositoryRoot);
    const bundle = verifyInstalledSkill(targetRoot, repositoryRoot);
    process.stdout.write(JSON.stringify({ verified: true, ...bundle }) + '\n');
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 2;
  }
}

module.exports = { INSTALL_HINT, verifyInstalledSkill };
