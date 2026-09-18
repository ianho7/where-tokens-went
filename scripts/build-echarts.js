#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");
const root = path.resolve(__dirname, "..");
fs.rmSync(path.join(root, "dist"), { recursive: true, force: true });
const output = path.join(root, "dist", "assets", "echarts.min.js");
fs.mkdirSync(path.dirname(output), { recursive: true });
esbuild.buildSync({ entryPoints: [path.join(root, "src", "echarts-entry.ts")], bundle: true, minify: true, format: "iife", target: ["es2020"], outfile: output, legalComments: "linked" });
const license = path.join(root, "node_modules", "echarts", "LICENSE");
if (fs.existsSync(license)) fs.copyFileSync(license, path.join(path.dirname(output), "echarts.LICENSE"));
const fontOutput = path.join(path.dirname(output), "fonts");
fs.mkdirSync(fontOutput, { recursive: true });
for (const font of ["TsangerJinKai02-W04.ttf", "TsangerJinKai02-W05.ttf"]) {
  const source = path.join(root, "assets", "fonts", font);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(fontOutput, font));
}
