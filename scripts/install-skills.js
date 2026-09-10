#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const targetRoot = path.resolve(process.argv[2] || repoRoot);
const installs = [
  ['where-tokens-went-codex', ['.agents', 'skills']],
  ['where-tokens-went-claude', ['.claude', 'skills']],
  ['where-tokens-went-pi', ['.pi', 'skills']],
  ['where-tokens-went-deepseek', ['.agents', 'skills']],
];

for (const [name, parent] of installs) {
  const source = path.join(repoRoot, 'skills', name);
  const destination = path.join(targetRoot, ...parent, name);
  if (!fs.existsSync(path.join(source, 'SKILL.md')) || !fs.existsSync(path.join(source, 'scripts', 'where-tokens-went.js'))) {
    throw new Error(`Skill ${name} is not packaged. Run npm run package-skills first.`);
  }
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
  console.log(`installed ${name} -> ${path.relative(targetRoot, destination)} (SKILL.md + bundled runtime)`);
}
