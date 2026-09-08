#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const compiledRoot = path.join(repoRoot, 'dist', 'src');
const echartsAssets = path.join(repoRoot, 'dist', 'assets');
const dependencyRoot = path.join(repoRoot, 'node_modules', 'fzstd');
const dependencyEntry = path.join(dependencyRoot, 'lib', 'index.js');
const dependencyLicense = path.join(dependencyRoot, 'LICENSE');
const skillNames = [
  'agent-audit-codex',
  'agent-audit-claude',
  'agent-audit-pi',
  'agent-audit-deepseek',
];

if (!fs.existsSync(path.join(compiledRoot, 'cli.js'))) {
  throw new Error('Compiled CLI not found. Run npm run build before packaging Skills.');
}
if (!fs.existsSync(dependencyEntry)) {
  throw new Error('The fzstd dependency is not installed. Run npm install before packaging Skills.');
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
  fs.copyFileSync(dependencyEntry, path.join(runtimeRoot, 'fzstd.js'));
  if (fs.existsSync(dependencyLicense)) fs.copyFileSync(dependencyLicense, path.join(runtimeRoot, 'fzstd.LICENSE'));
  const deepSeekRuntime = path.join(runtimeRoot, 'deepseek-reader.js');
  const deepSeekSource = fs.readFileSync(deepSeekRuntime, 'utf8');
  fs.writeFileSync(deepSeekRuntime, deepSeekSource.replace('require("fzstd")', 'require("./fzstd.js")'), 'utf8');
  fs.writeFileSync(path.join(scriptsRoot, 'agent-audit.js'), launcher, 'utf8');
  console.log(`packaged ${name}`);
}
