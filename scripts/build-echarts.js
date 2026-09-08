#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist", "assets", "echarts.min.js");
fs.mkdirSync(path.dirname(output), { recursive: true });
esbuild.buildSync({ entryPoints: [path.join(root, "src", "echarts-entry.ts")], bundle: true, minify: true, format: "iife", target: ["es2020"], outfile: output, legalComments: "linked" });
const license = path.join(root, "node_modules", "echarts", "LICENSE");
if (fs.existsSync(license)) fs.copyFileSync(license, path.join(path.dirname(output), "echarts.LICENSE"));