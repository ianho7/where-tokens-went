#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const source = path.join(repoRoot, "src", "report.css");
const destination = path.join(repoRoot, "dist", "src", "report.css");

if (!fs.existsSync(source)) {
  throw new Error(`Report stylesheet not found at ${source}.`);
}

fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.copyFileSync(source, destination);
