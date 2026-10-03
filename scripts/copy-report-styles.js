#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
for (const name of ["report.css", "report-template.html"]) {
  const source = path.join(repoRoot, "src", name);
  const destination = path.join(repoRoot, "dist", "src", name);
  if (!fs.existsSync(source)) throw new Error(`Report asset not found at ${source}.`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}
