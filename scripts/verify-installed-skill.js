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

function relativeFiles(root) {
  const result = [];
  function visit(current, relative) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      const nextRelative = path.join(relative, entry.name);
      if (entry.isDirectory()) visit(next, nextRelative);
      else result.push(nextRelative);
    }
  }
  visit(root, '');
  return result.sort();
}

function verifyInstalledContent(expectedRoot, actualRoot, label) {
  if (!fs.existsSync(actualRoot)) throw new Error(`${label} is missing. ${INSTALL_HINT}`);
  const expectedFiles = relativeFiles(expectedRoot);
  const actualFiles = relativeFiles(actualRoot);
  if (expectedFiles.join('\n') !== actualFiles.join('\n')) throw new Error(`${label} file set differs from the repository distribution. ${INSTALL_HINT}`);
  for (const relative of expectedFiles) {
    if (!fs.readFileSync(path.join(expectedRoot, relative)).equals(fs.readFileSync(path.join(actualRoot, relative)))) {
      throw new Error(`${label} content differs at ${relative}. ${INSTALL_HINT}`);
    }
  }
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
    verifyInstalledContent(distributionRoot, skillRoot, `The ${label} installed Skill`);
  }
  return expected;
}

if (require.main === module) {
  try {
    const repositoryRoot = path.resolve(__dirname, '..');
    const targetRoot = path.resolve(process.argv[2] || repositoryRoot);
    const bundle = verifyInstalledSkill(targetRoot, repositoryRoot);
    process.stdout.write(JSON.stringify({ kind: 'installed-preflight', status: 'verified', command: 'npm run verify-installed-skill', observedAt: new Date().toISOString(), verified: true, ...bundle }) + '\n');
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 2;
  }
}

module.exports = { INSTALL_HINT, verifyInstalledSkill };
