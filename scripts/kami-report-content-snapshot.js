const fs = require('node:fs');
const path = require('node:path');
const { renderHtml } = require('../dist/src/report.js');
const { makeResult } = require('../tests/fixtures/kami-report-fixture.js');

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function textOf(fragment) {
  return normalizeDynamicText(decodeHtml(fragment.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()));
}

function normalizeDynamicText(value) {
  return value.replace(/\d{4}\.\d{2}\.\d{2} \d{2}:\d{2} → \d{4}\.\d{2}\.\d{2} \d{2}:\d{2}/g, '<rolling-window>');
}

function attributesOf(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*"([^"]*)"/g)) attributes[match[1]] = decodeHtml(match[2]);
  return attributes;
}

function keepSemanticAttributes(attributes) {
  return Object.fromEntries(Object.entries(attributes)
    .filter(([name]) => name === 'role' || name === 'scope' || name === 'type' || name === 'id' || name === 'title' || name === 'data-sort' || name === 'data-provenance' || name.startsWith('aria-'))
    .sort(([a], [b]) => a.localeCompare(b)));
}

function collectElements(fragment, tagName) {
  const expression = new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, 'gi');
  return [...fragment.matchAll(expression)].map((match) => {
    const source = match[0];
    const opening = source.match(new RegExp(`^<${tagName}\\b[^>]*>`, 'i'))[0];
    return { source, opening, attributes: attributesOf(opening), text: textOf(source) };
  });
}

function collectSelfClosingElements(fragment, tagName) {
  const expression = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  return [...fragment.matchAll(expression)].map((match) => {
    const opening = match[0];
    return { opening, attributes: attributesOf(opening), text: '' };
  });
}

function tableSnapshot(table) {
  return {
    attributes: keepSemanticAttributes(table.attributes),
    rows: collectElements(table.source, 'tr').map((row) => collectElements(row.source, 'th').concat(collectElements(row.source, 'td')).map((cell) => ({
      tag: cell.opening.slice(1, 3).toLowerCase(),
      text: cell.text,
      attributes: keepSemanticAttributes(cell.attributes),
    }))),
  };
}

function scriptChartData(html) {
  const data = [];
  for (const match of html.matchAll(/const d=(\{[\s\S]*?\});const p=/g)) {
    try { data.push(JSON.parse(match[1])); } catch { data.push({ unavailable: true }); }
  }
  return data;
}

function snapshotHtml(html) {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  const visibleSource = body.replace(/<(?:style|script)\b[\s\S]*?<\/(?:style|script)>/gi, '');
  const sections = collectElements(visibleSource, 'section').map((section) => ({
    headings: collectElements(section.source, 'h2').concat(collectElements(section.source, 'h3')).map((heading) => heading.text),
    text: section.text,
  }));
  const tables = collectElements(visibleSource, 'table').map(tableSnapshot);
  const evidence = collectElements(visibleSource, 'span')
    .filter((element) => element.attributes['data-provenance'] || element.attributes['data-sort'])
    .map((element) => ({
      text: element.text,
      attributes: keepSemanticAttributes(element.attributes),
    }));
  const semanticElements = collectElements(visibleSource, 'button')
    .concat(collectElements(visibleSource, 'summary'))
    .concat(collectElements(visibleSource, 'details'))
    .concat(collectElements(visibleSource, 'svg'))
    .filter((element) => Object.keys(keepSemanticAttributes(element.attributes)).length > 0 || ['button', 'summary', 'details', 'svg'].includes(element.opening.slice(1).split(/[\\s>]/)[0].toLowerCase()))
    .map((element) => ({
      tag: element.opening.slice(1).split(/[\\s>]/)[0].toLowerCase(),
      text: element.text,
      attributes: keepSemanticAttributes(element.attributes),
    }));
  const svgText = collectElements(visibleSource, 'svg').map((svg) => textOf(svg.source));
  return {
    visibleText: textOf(visibleSource),
    sectionOrder: sections,
    tables,
    evidence,
    chartData: scriptChartData(html),
    svgText,
    semantics: semanticElements,
  };
}

function writeBaseline() {
  const result = makeResult();
  const baseline = {
    'en-US': snapshotHtml(renderHtml(result, 'en-US')),
    'zh-CN': snapshotHtml(renderHtml(result, 'zh-CN')),
  };
  const target = path.join(__dirname, '..', 'tests', 'fixtures', 'kami-report-content-baseline.json');
  fs.writeFileSync(target, JSON.stringify(baseline, null, 2) + '\n');
  process.stdout.write(target + '\n');
}

module.exports = { snapshotHtml };

if (require.main === module) writeBaseline();
