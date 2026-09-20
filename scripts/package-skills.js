#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { writeBundleVersion } = require('./bundle-version');

const repoRoot = path.resolve(__dirname, '..');
const compiledRoot = path.join(repoRoot, 'dist', 'src');
const echartsAssets = path.join(repoRoot, 'dist', 'assets');
const reportSynthesisPrompt = path.join(repoRoot, 'prompts', 'report-synthesis.md');
const keySessionAnalysisPrompt = path.join(repoRoot, 'prompts', 'key-session-analysis.md');
const skillInsightsPrompt = path.join(repoRoot, 'prompts', 'skill-insights.md');
const skillNames = ['where-tokens-went'];

function copyIfChanged(source, destination) {
  if (fs.existsSync(destination) && fs.readFileSync(source).equals(fs.readFileSync(destination))) return;
  fs.copyFileSync(source, destination);
}

const runtimeDependencies = [
  ['subset-font', ['index.js', 'package.json', 'LICENSE']],
  ['fontverter', ['index.js', 'package.json', 'LICENSE']],
  ['harfbuzzjs', ['hb-subset.wasm', 'package.json', 'LICENSE']],
  ['p-limit', ['index.js', 'package.json', 'license']],
  ['yocto-queue', ['index.js', 'package.json', 'license']],
  ['wawoff2', ['index.js', 'compress.js', 'decompress.js', 'package.json', 'LICENSE', 'build']],
  ['woff2sfnt-sfnt2woff', ['index.js', 'package.json']],
  ['pako', ['index.js', 'package.json', 'LICENSE', 'lib']],
  ['argparse', ['argparse.js', 'package.json', 'LICENSE', 'lib']],
];

function copyRuntimeDependencies(runtimeRoot) {
  for (const [name, entries] of runtimeDependencies) {
    const sourceRoot = path.join(repoRoot, 'node_modules', name);
    const destinationRoot = path.join(runtimeRoot, 'node_modules', name);
    for (const entry of entries) {
      const source = path.join(sourceRoot, entry);
      if (!fs.existsSync(source)) throw new Error(`Runtime dependency file not found: ${source}`);
      fs.cpSync(source, path.join(destinationRoot, entry), { recursive: true, force: true });
    }
  }
}

if (!fs.existsSync(path.join(compiledRoot, 'cli.js'))) {
  throw new Error('Compiled CLI not found. Run npm run build before packaging Skills.');
}
if (!fs.existsSync(reportSynthesisPrompt)) {
  throw new Error('Report Synthesis Prompt not found at prompts/report-synthesis.md.');
}
if (!fs.existsSync(keySessionAnalysisPrompt)) {
  throw new Error('Key Session Analysis Prompt not found at prompts/key-session-analysis.md.');
}
if (!fs.existsSync(skillInsightsPrompt)) {
  throw new Error('Skill Insights Prompt not found at prompts/skill-insights.md.');
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
  try {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== 'EBUSY') throw error;
    console.warn(`preserving busy generated runtime files for ${name}`);
  }
  fs.mkdirSync(scriptsRoot, { recursive: true });
  fs.cpSync(compiledRoot, runtimeRoot, {
    recursive: true,
    filter: (source) => path.basename(source) !== 'assets',
  });
  copyRuntimeDependencies(runtimeRoot);
  const runtimeAssets = path.join(runtimeRoot, 'assets');
  fs.mkdirSync(runtimeAssets, { recursive: true });
  for (const asset of fs.readdirSync(echartsAssets)) {
    if (asset !== 'fonts') fs.cpSync(path.join(echartsAssets, asset), path.join(runtimeAssets, asset), { recursive: true, force: true });
  }
  const sourceFonts = path.join(echartsAssets, 'fonts');
  if (fs.existsSync(sourceFonts)) {
    fs.mkdirSync(path.join(runtimeAssets, 'fonts'), { recursive: true });
    for (const font of fs.readdirSync(sourceFonts)) {
      const destination = path.join(runtimeAssets, 'fonts', font);
      try {
        fs.copyFileSync(path.join(sourceFonts, font), destination);
      } catch (error) {
        if (!fs.existsSync(destination) || !['EBUSY', 'EPERM', 'UNKNOWN'].includes(error.code)) throw error;
        console.warn(`preserving busy generated font ${destination}`);
      }
    }
  }
  const referencesRoot = path.join(repoRoot, 'skills', name, 'references');
  fs.mkdirSync(referencesRoot, { recursive: true });
  copyIfChanged(reportSynthesisPrompt, path.join(referencesRoot, 'report-synthesis.md'));
  copyIfChanged(keySessionAnalysisPrompt, path.join(referencesRoot, 'key-session-analysis.md'));
  copyIfChanged(skillInsightsPrompt, path.join(referencesRoot, 'skill-insights.md'));
  fs.writeFileSync(path.join(scriptsRoot, 'where-tokens-went.js'), launcher, 'utf8');
  const bundle = writeBundleVersion(repoRoot);
  console.log(`packaged ${name} ${bundle.bundleVersion}`);
}
