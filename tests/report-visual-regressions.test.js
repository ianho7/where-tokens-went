const assert = require('node:assert/strict');
const { test } = require('node:test');

const { renderHtml } = require('../dist/src/report.js');
const { extractReportStyles } = require('../scripts/report-style-helpers.js');
const { makeResult } = require('./fixtures/kami-report-fixture.js');

function report(locale = 'zh-CN') {
  return renderHtml(makeResult(), locale);
}

test('primary answer has a distinct visual level from the chapter marker', () => {
  const html = report();
  const css = extractReportStyles(html);
  const marker = '<div class="section-num">01 · 概览</div>';
  const primaryStart = html.indexOf('<section class="primary-answer"');
  const primaryEnd = html.indexOf('</section>', primaryStart);
  const primary = html.slice(primaryStart, primaryEnd);

  const markerPosition = html.indexOf(marker);
  const stagePosition = html.lastIndexOf('<div class="report-stage report-stage--overview">', markerPosition);
  assert.ok(markerPosition < primaryStart);
  assert.ok(stagePosition >= 0 && stagePosition < markerPosition);
  assert.match(css, /\.section-num\{[^}]*color:var\(--brand\);[^}]*font-size:12px/);
  assert.match(css, /\.primary-answer__kicker\{[^}]*color:var\(--stone\);[^}]*font-size:11px/);
  assert.match(css, /\.primary-answer__head h2\{[^}]*font-size:36px/);
  assert.match(css, /\.primary-answer\{margin:0 0 72px;padding:0 0 30px;border:0/);
  assert.doesNotMatch(css, /\.primary-answer\{[^}]*border-top/);
  assert.doesNotMatch(primary, /primary-answer__item--destination"><h3>/);
  assert.doesNotMatch(primary, /<h3>最大 Token 去向<\/h3>/);
});

test('quiet labels and evidence rows stay quiet instead of becoming competing chrome', () => {
  const css = extractReportStyles(report());

  assert.match(css, /\.tag--quiet\{background:transparent;color:var\(--stone\);padding:0/);
  assert.doesNotMatch(css, /\.fact-line\{[^}]*border-left/);
  assert.doesNotMatch(css, /font-weight:600/);
  assert.match(css, /\.key-session-module-kicker\{[^}]*color:var\(--stone\);[^}]*font-size:11px/);
});

test('small screens and print keep the report readable without decorative leftovers', () => {
  const css = extractReportStyles(report());

  assert.match(css, /@media\(max-width:480px\)[\s\S]*?\.report-header__metric\{flex-direction:column/);
  assert.match(css, /@media\(max-width:480px\)[\s\S]*?\.report-header__metric-label\{white-space:normal/);
  assert.match(css, /@media print\{[\s\S]*?\.report-stage--overview\{break-inside:auto\}\.report-stage--overview>\.section-num\{break-after:avoid\}\.primary-answer\{break-inside:auto\}\.primary-answer__grid\{display:block\}\.primary-answer__item--destination\{break-inside:auto\}/);
  assert.match(css, /@media print\{[\s\S]*?\.chart-ivory\{background:transparent;padding:0\}/);
  assert.match(css, /@media print\{[\s\S]*?main>section:last-of-type\{margin-bottom:0\}footer\{break-inside:avoid;break-before:avoid;margin-top:0/);
});
