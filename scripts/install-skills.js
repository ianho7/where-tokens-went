#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { verifyInstalledSkill } = require('./verify-installed-skill');

const repoRoot = path.resolve(__dirname, '..');
const targetRoot = path.resolve(process.argv[2] || repoRoot);
const installs = [
  ['where-tokens-went', ['.agents', 'skills']],
  ['where-tokens-went', ['.claude', 'skills']],
];

function copyTree(source, destination) {
  const info = fs.statSync(source);
  if (info.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source)) copyTree(path.join(source, entry), path.join(destination, entry));
    return;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  try {
    if (fs.readFileSync(source).equals(fs.readFileSync(destination))) return;
  } catch {
    // Destination may not exist yet.
  }
  fs.copyFileSync(source, destination);
}

for (const [name, parent] of installs) {
  const source = path.join(repoRoot, 'skills', name);
  const destination = path.join(targetRoot, ...parent, name);
  if (!fs.existsSync(path.join(source, 'SKILL.md')) || !fs.existsSync(path.join(source, 'scripts', 'where-tokens-went.js'))) {
    throw new Error(`Skill ${name} is not packaged. Run npm run package-skills first.`);
  }
  fs.mkdirSync(destination, { recursive: true });
  copyTree(source, destination);
  console.log(`installed ${name} -> ${path.relative(targetRoot, destination)} (SKILL.md + bundled runtime)`);
}

verifyInstalledSkill(targetRoot, repoRoot);
console.log('verified installed where-tokens-went bundle versions');
