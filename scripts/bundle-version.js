#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const AUDIT_SCHEMA_VERSION = 1;
const SKILL_NAME = 'where-tokens-went';

function readProductVersion(repoRoot) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new Error('Root package.json must contain a non-empty version.');
  }
  return packageJson.version;
}

function collectFiles(root) {
  const files = [];
  function visit(current, relative) {
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const entryRelative = relative ? path.join(relative, entry.name) : entry.name;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) visit(fullPath, entryRelative);
      else if (entry.isFile()) files.push({ relative: entryRelative.replaceAll('\\', '/'), path: fullPath });
    }
  }
  visit(root, '');
  return files;
}

function hashFiles(entries) {
  const digest = createHash('sha256');
  for (const entry of entries) {
    const contents = fs.readFileSync(entry.path);
    digest.update(entry.relative, 'utf8');
    digest.update('\0', 'utf8');
    digest.update(String(contents.byteLength), 'utf8');
    digest.update('\0', 'utf8');
    digest.update(contents);
    digest.update('\0', 'utf8');
  }
  return digest.digest('hex');
}

function computeBundleDigest(skillRoot) {
  const runtimeRoot = path.join(skillRoot, 'scripts', 'runtime');
  const runtimeEntries = collectFiles(runtimeRoot).map((entry) => ({
    relative: 'runtime/' + entry.relative,
    path: entry.path,
  }));
  const entries = [
    ...runtimeEntries,
    { relative: 'SKILL.md', path: path.join(skillRoot, 'SKILL.md') },
    { relative: 'references/report-synthesis.md', path: path.join(skillRoot, 'references', 'report-synthesis.md') },
    { relative: 'references/key-session-analysis.md', path: path.join(skillRoot, 'references', 'key-session-analysis.md') },
    { relative: 'references/skill-insights.md', path: path.join(skillRoot, 'references', 'skill-insights.md') },
  ];
  return hashFiles(entries);
}

function writeJsonIfChanged(filePath, value) {
  const contents = JSON.stringify(value, null, 2) + '\n';
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === contents) return;
  fs.writeFileSync(filePath, contents, 'utf8');
}

function syncPluginVersions(skillRoot, productVersion) {
  for (const pluginDirectory of ['.codex-plugin', '.claude-plugin']) {
    const filePath = path.join(skillRoot, pluginDirectory, 'plugin.json');
    const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (manifest.version !== productVersion) {
      manifest.version = productVersion;
      writeJsonIfChanged(filePath, manifest);
    }
  }
}

function writeBundleVersion(repoRoot) {
  const skillRoot = path.join(repoRoot, 'skills', SKILL_NAME);
  const productVersion = readProductVersion(repoRoot);
  const bundleVersion = `${productVersion}+${computeBundleDigest(skillRoot)}`;
  const bundle = { productVersion, bundleVersion, auditSchemaVersion: AUDIT_SCHEMA_VERSION };
  writeJsonIfChanged(path.join(skillRoot, 'bundle-version.json'), bundle);
  syncPluginVersions(skillRoot, productVersion);
  return bundle;
}

module.exports = {
  AUDIT_SCHEMA_VERSION,
  SKILL_NAME,
  computeBundleDigest,
  readProductVersion,
  syncPluginVersions,
  writeBundleVersion,
};
