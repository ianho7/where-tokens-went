const assert = require('node:assert/strict');
const { test } = require('node:test');

const { renderHtml } = require('../dist/src/report.js');
const { makeResult } = require('./fixtures/kami-report-fixture.js');

function styles(html) {
  return html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
}

function desktopRepair(css) {
  return css.slice(css.lastIndexOf('/* Kami desktop report repair */'));
}

test('desktop Primary Answer uses a reading-first stack with semantic spacing', () => {
  const html = renderHtml(makeResult(), 'zh-CN');
  const css = styles(html);
  const repair = desktopRepair(css);
  const primaryStart = html.indexOf('<section class="primary-answer"');
  const primaryEnd = html.indexOf('</section>', primaryStart);
  const primary = html.slice(primaryStart, primaryEnd);

  assert.match(primary, /primary-answer__item primary-answer__item--destination"><p/);
  assert.doesNotMatch(primary, /primary-answer__item--destination"><h3>/);
  assert.match(repair, /@media\(min-width:881px\)\{[\s\S]*?\.primary-answer__grid\{display:block\}/);
  assert.match(repair, /\.primary-answer__item--mechanism\{[^}]*border-top:0/);
  assert.match(repair, /\.primary-answer__item--action\{[^}]*border-top:0/);
  assert.match(repair, /\.primary-answer__item--limitation\{[^}]*border-top:0/);
  assert.match(repair, /\.primary-answer__head h2\{font-size:32px/);
  assert.match(repair, /section > h2\{font-size:30px/);
  assert.match(repair, /\.key-session-section-head h4\{font-size:20px/);
  assert.match(repair, /\.finding-lead\{font-size:clamp\(24px,2\.2vw,26px\)/);
});

test('desktop metric occupancy and bar charts follow the Kami visual contract', () => {
  const result = makeResult();
  result.summary.reportedCost = { value: null, provenance: 'unavailable' };
  result.summary.topLevelSessionCount = { value: 1, provenance: 'derived' };
  result.summary.subagentSessionCount = { value: 1, provenance: 'derived' };
  result.report.tools[0].key = 'a-very-long-tool-name-that-needs-truncation';
  const html = renderHtml(result, 'zh-CN');
  const css = styles(html);

  assert.match(html, /class="metrics metrics--summary metrics--count-2"/);
  assert.match(html, /class="metrics metrics--coverage metrics--count-5"/);
  assert.match(css, /\.metrics--count-4\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /\.metrics--count-5\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(css, /--brand-light:#2d5a8a/);
  assert.match(html, /a-very-long-tool-name-that-needs-truncation/);
  assert.match(html, /formatter:value=>\{const name=String\(value\?\?'{2}\);return name.length<=24\?name:name.slice\(0,23\)\+'…'/);
  assert.match(html, /make\('model-chart'[\s\S]*?borderRadius:\[4,4,0,0\]/);
  assert.match(html, /make\('tool-chart'[\s\S]*?borderRadius:\[0,4,4,0\]/);
  assert.match(html, /name:keyUi\.shareAxis,type:'bar'[\s\S]*?itemStyle:\{borderRadius:\[4,4,0,0\]\}/);
});
