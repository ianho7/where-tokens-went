#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const AUDIT_SCHEMA_VERSION = 1;
const SKILL_NAME = 'where-tokens-went';

const REQUIRED_PACKAGE_FILES = [
  'SKILL.md',
  'scripts/where-tokens-went.js',
  'scripts/runtime/cli.js',
  'references/report-synthesis.md',
  'references/key-session-analysis.md',
  'references/skill-insights.md',
];

function readProductVersion(repoRoot) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new Error('Root package.json must contain a non-empty version.');
  }
  return packageJson.version;
}

function isDescendantOf(parentPath, targetPath) {
  const relative = path.relative(parentPath, targetPath);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function collectBundleFiles(skillRoot) {
  const realSkillRoot = fs.realpathSync(skillRoot);
  const files = [];

  function visit(current, relative) {
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    );
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const entryRelative = relative ? path.join(relative, entry.name) : entry.name;
      const normalizedRelative = entryRelative.replaceAll('\\', '/');

      if (normalizedRelative === 'bundle-version.json') {
        continue;
      }

      if (entry.isSymbolicLink()) {
        let realTarget;
        try {
          realTarget = fs.realpathSync(fullPath);
        } catch {
          throw new Error(`where-tokens-went Skill preflight failed: broken symlink at ${normalizedRelative}`);
        }
        if (!isDescendantOf(realSkillRoot, realTarget) && realTarget !== realSkillRoot) {
          throw new Error(`where-tokens-went Skill preflight failed: symlink ${normalizedRelative} escapes package root`);
        }
      }

      if (entry.isDirectory()) {
        visit(fullPath, entryRelative);
      } else if (entry.isFile()) {
        files.push({ relative: normalizedRelative, path: fullPath });
      }
    }
  }

  visit(skillRoot, '');
  files.sort((left, right) => (left.relative < right.relative ? -1 : left.relative > right.relative ? 1 : 0));

  const presentFiles = new Set(files.map((file) => file.relative));
  for (const required of REQUIRED_PACKAGE_FILES) {
    if (!presentFiles.has(required)) {
      throw new Error(`where-tokens-went Skill preflight failed: missing required package file ${required}`);
    }
  }

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
  const entries = collectBundleFiles(skillRoot);
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
    if (!fs.existsSync(filePath)) continue;
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
  syncPluginVersions(skillRoot, productVersion);
  const bundleVersion = `${productVersion}+${computeBundleDigest(skillRoot)}`;
  const bundle = { productVersion, bundleVersion, auditSchemaVersion: AUDIT_SCHEMA_VERSION };
  writeJsonIfChanged(path.join(skillRoot, 'bundle-version.json'), bundle);
  return bundle;
}

module.exports = {
  AUDIT_SCHEMA_VERSION,
  REQUIRED_PACKAGE_FILES,
  SKILL_NAME,
  collectBundleFiles,
  computeBundleDigest,
  readProductVersion,
  syncPluginVersions,
  writeBundleVersion,
};
