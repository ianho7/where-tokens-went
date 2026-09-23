#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const repoRoot = path.resolve(__dirname, '..');
const sourceRoot = path.join(repoRoot, 'src');
const output = path.join(repoRoot, 'dist', 'src', 'build-manifest.json');

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function collect(root, relative = '') {
  const result = [];
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...collect(root, next));
    else if (entry.isFile() && entry.name.endsWith('.ts')) result.push(next.replaceAll('\\', '/'));
  }
  return result.sort();
}

const sourceHashes = Object.fromEntries(collect(sourceRoot).map((relative) => [relative, digest(path.join(sourceRoot, relative))]));
fs.writeFileSync(output, JSON.stringify({ version: 1, sourceHashes }, null, 2) + '\n', 'utf8');
