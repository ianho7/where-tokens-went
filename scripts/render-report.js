#!/usr/bin/env node
// Re-layout a retained report; normal report generation calls the same source renderer directly.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { recordedUsageTime, renderReportLayout } = require('../dist/src/report-layout.js');
const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath) throw new Error('Usage: node scripts/render-report.js <existing-report.html> <output.html>');
if (path.resolve(sourcePath) === path.resolve(outputPath)) throw new Error('Choose a separate output file.');
const original = fs.readFileSync(sourcePath, 'utf8');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const sourceHash = hash(original);
const runDirectory = path.dirname(path.resolve(sourcePath));
const auditPath = path.join(runDirectory, 'audit.json'), manifestPath = path.join(runDirectory, 'manifest.json');
let usageTime = null;
if (fs.existsSync(auditPath) && fs.existsSync(manifestPath)) {
  const auditBytes = fs.readFileSync(auditPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.artifacts?.html?.sha256 !== sourceHash || manifest.artifacts?.audit?.sha256 !== hash(auditBytes)) {
    throw new Error('The retained Audit and source report do not match the same Run manifest.');
  }
  usageTime = recordedUsageTime(JSON.parse(auditBytes.toString('utf8')));
}
const output = renderReportLayout(original, usageTime);
fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(outputPath, output, 'utf8');
if (hash(fs.readFileSync(sourcePath)) !== sourceHash) throw new Error('The source report changed during generation.');
console.log(JSON.stringify({ output: path.resolve(outputPath), sourceSha256: sourceHash, bytes: Buffer.byteLength(output) }, null, 2));
