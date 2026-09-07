#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const targetRoot = path.resolve(process.argv[2] || repoRoot);
const installs = [
  ['agent-audit-codex', ['.agents', 'skills']],
  ['agent-audit-claude', ['.claude', 'skills']],
  ['agent-audit-pi', ['.pi', 'skills']],
  ['agent-audit-deepseek', ['.agents', 'skills']],
];

for (const [name, parent] of installs) {
  const source = path.join(repoRoot, 'skills', name);
  const destination = path.join(targetRoot, ...parent, name);
  fs.mkdirSync(destination, { recursive: true });
  fs.copyFileSync(path.join(source, 'SKILL.md'), path.join(destination, 'SKILL.md'));
  console.log(`installed ${name} -> ${path.relative(targetRoot, destination)}`);
}
