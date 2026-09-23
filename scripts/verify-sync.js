#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const repoRoot = path.resolve(__dirname, '..');
const checks = [
  [path.join(repoRoot, 'dist', 'src'), path.join(repoRoot, 'skills', 'where-tokens-went', 'scripts', 'runtime'), ['assets/', 'node_modules/']],
  [path.join(repoRoot, 'dist', 'assets'), path.join(repoRoot, 'skills', 'where-tokens-went', 'scripts', 'runtime', 'assets')],
  [path.join(repoRoot, 'prompts', 'report-synthesis.md'), path.join(repoRoot, 'skills', 'where-tokens-went', 'references', 'report-synthesis.md')],
  [path.join(repoRoot, 'prompts', 'key-session-analysis.md'), path.join(repoRoot, 'skills', 'where-tokens-went', 'references', 'key-session-analysis.md')],
  [path.join(repoRoot, 'prompts', 'skill-insights.md'), path.join(repoRoot, 'skills', 'where-tokens-went', 'references', 'skill-insights.md')],
];

function digest(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function files(root) {
  if (!fs.existsSync(root)) return [];
  const stat = fs.statSync(root);
  if (stat.isFile()) return [''];
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

function verifyTree(source, destination, allowedDestinationPrefixes = []) {
  const sourceStat = fs.statSync(source);
  const destinationStat = fs.statSync(destination);
  if (sourceStat.isFile() !== destinationStat.isFile()) throw new Error(`type mismatch: ${destination}`);
  if (sourceStat.isFile()) {
    if (digest(source) !== digest(destination)) throw new Error(`content mismatch: ${destination}`);
    return;
  }
  const sourceFiles = files(source);
  const destinationFiles = files(destination);
  const extras = destinationFiles.filter((relative) => !sourceFiles.includes(relative));
  const normalizedPrefixes = allowedDestinationPrefixes.map((prefix) => prefix.replaceAll('\\', '/')
    .replace(/^\\+/, '')
    .replace(/\/$/, '') + '/');
  if (extras.some((relative) => !normalizedPrefixes.some((prefix) => relative.replaceAll('\\', '/').startsWith(prefix)))) throw new Error(`file list mismatch: ${destination}`);
  for (const relative of sourceFiles) {
    if (!destinationFiles.includes(relative)) throw new Error(`missing generated file: ${path.join(destination, relative)}`);
    if (digest(path.join(source, relative)) !== digest(path.join(destination, relative))) throw new Error(`content mismatch: ${path.join(destination, relative)}`);
  }
}

function verifyBuildManifest() {
  const manifestPath = path.join(repoRoot, 'dist', 'src', 'build-manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('missing build manifest: run npm run build');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest || manifest.version !== 1 || !manifest.sourceHashes) throw new Error('invalid build manifest: run npm run build');
  for (const [relative, expected] of Object.entries(manifest.sourceHashes)) {
    const source = path.join(repoRoot, 'src', relative);
    if (!fs.existsSync(source) || digest(source) !== expected) throw new Error(`stale dist: source changed after build (${relative}); run npm run build`);
  }
}

verifyBuildManifest();

for (const [source, destination, allowDestinationExtras] of checks) {
  if (!fs.existsSync(source) || !fs.existsSync(destination)) throw new Error(`missing sync target: ${destination}`);
  verifyTree(source, destination, allowDestinationExtras);
}

const bundle = JSON.parse(fs.readFileSync(path.join(repoRoot, 'skills', 'where-tokens-went', 'bundle-version.json'), 'utf8'));
console.log(JSON.stringify({ kind: 'verify-sync', status: 'passed', command: 'npm run verify-sync', bundleVersion: bundle.bundleVersion, observedAt: new Date().toISOString() }));
