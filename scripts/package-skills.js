#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const compiledRoot = path.join(repoRoot, 'dist', 'src');
const echartsAssets = path.join(repoRoot, 'dist', 'assets');
const skillNames = [
  'where-tokens-went-codex',
  'where-tokens-went-claude',
];

if (!fs.existsSync(path.join(compiledRoot, 'cli.js'))) {
  throw new Error('Compiled CLI not found. Run npm run build before packaging Skills.');
}
const launcher = `#!/usr/bin/env node

const { main } = require('./runtime/cli.js');

void main().then((code) => {
  process.exitCode = code;
});
`;

for (const name of skillNames) {
  const scriptsRoot = path.join(repoRoot, 'skills', name, 'scripts');
  const runtimeRoot = path.join(scriptsRoot, 'runtime');
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  fs.mkdirSync(scriptsRoot, { recursive: true });
  fs.cpSync(compiledRoot, runtimeRoot, { recursive: true });
  fs.cpSync(echartsAssets, path.join(runtimeRoot, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(scriptsRoot, 'where-tokens-went.js'), launcher, 'utf8');
  console.log(`packaged ${name}`);
}
