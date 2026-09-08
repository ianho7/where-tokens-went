#!/usr/bin/env node

const { main } = require('./runtime/cli.js');

void main().then((code) => {
  process.exitCode = code;
});
