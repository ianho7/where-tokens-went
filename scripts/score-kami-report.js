#!/usr/bin/env node

const fs = require('node:fs');

function extractReportParts(html) {
  const style = html.match(/<style>([\s\S]*?)<\/style>/i)?.[1] ?? '';
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  return { style, boot: scripts.at(-1) ?? '' };
}

function check(dimension, criterion, points, passed, evidence, unavailable = false) {
  return {
    dimension,
    criterion,
    points,
    status: unavailable ? 'unavailable' : passed ? 'passed' : 'failed',
    evidence,
    source: dimension === 'charts' ? 'inline boot script' : 'inline style',
  };
}

function scoreHtml(html) {
  const { style, boot } = extractReportParts(html);
  const hasStyle = style.length > 0;
  const hasBoot = boot.length > 0;
  const checks = [
    check('palette', 'Kami parchment and ink tokens', 8, /--parchment:#f5f4ed/.test(style) && /--brand:#1b365d/.test(style), 'parchment=#f5f4ed, brand=#1b365d', !hasStyle),
    check('palette', 'Warm neutral surface and border tokens', 4, /--ivory:#faf9f5/.test(style) && /--border:#e8e6dc/.test(style), 'ivory=#faf9f5, border=#e8e6dc', !hasStyle),
    check('palette', 'No legacy dashboard palette', 4, !/(#b76448|#d99a78|#557c70|#8d6a9f)/i.test(style + boot), 'legacy colors absent', !hasStyle && !hasBoot),
    check('typography', 'Serif-led Chinese and Latin font stack', 8, /Source Han Serif SC/.test(style) && /font-family:var\(--serif\)/.test(style), 'Source Han Serif SC + serif variable', !hasStyle),
    check('typography', 'Kami weight and synthesis rules', 4, /font-synthesis:none/.test(style) && /font-weight:500/.test(style) && !/font-weight:650|font-weight:700/.test(style), 'synthesis disabled; editorial weights', !hasStyle),
    check('typography', 'Readable body measure and leading', 4, /font-size:15px/.test(style) && /line-height:1\.55/.test(style) && /max-width:1120px/.test(style), '15px body, 1.55 leading, 1120px measure', !hasStyle),
    check('layout', 'Editorial page rhythm and hairlines', 12, /padding:88px 64px 120px/.test(style) && /margin-bottom:48px/.test(style) && /border-bottom:1px solid var\(--border-soft\)/.test(style), 'wide editorial padding, 48px header rhythm, hairline', !hasStyle),
    check('surfaces', 'Quiet Kami surfaces without effects', 6, /\.finding\{[^}]*background:var\(--ivory\);border:0/.test(style) && !/linear-gradient|box-shadow/.test(style), 'ivory findings; no gradients or shadows', !hasStyle),
    check('surfaces', 'Warm table rules and sortable controls', 6, /table\{border-collapse:collapse;width:100%/.test(style) && /\.sortable button/.test(style) && /border-bottom:1px solid var\(--border-soft\)/.test(style), 'hairline tables and visible sort buttons', !hasStyle),
    check('charts', 'Kami contrast ladder and redundant series encoding', 8, /#1b365d/.test(boot) && /#2d4e7a/.test(boot) && /#6b6a64/.test(boot) && /lineType,symbol,focus/.test(boot) && /areaStyle:\{color,opacity:\.1\}/.test(boot) && /areaStyle:\{color,opacity:\.12\}/.test(boot) && !/areaStyle:\{color,opacity:\.18\}/.test(boot) && !/stack:'tokens'/.test(boot), 'official ladder, line/point encodings, focal-only area fill, no token stacking', !hasBoot),
    check('responsive/print', 'Responsive breakpoints', 3, /@media\(max-width:880px\)/.test(style) && /@media\(max-width:480px\)/.test(style), '880px and 480px breakpoints', !hasStyle),
    check('responsive/print', 'Print-safe output', 3, /@media print/.test(style) && /@page\{size:A4;margin:14mm 16mm/.test(style), 'print media and A4 page rule', !hasStyle),
  ];
  const automatedMax = checks.reduce((sum, item) => sum + item.points, 0);
  const automatedScore = checks.reduce((sum, item) => sum + (item.status === 'passed' ? item.points : 0), 0);
  const manualReview = {
    score: null,
    max: 30,
    status: 'unavailable',
    message: 'Requires fixed-viewport blind review and screenshot evidence; browser absence is not a pass.',
    checks: [
      { criterion: 'First-impression Kami atmosphere', points: 8, status: 'unavailable', source: 'fixed viewport screenshot + reviewer' },
      { criterion: 'Information hierarchy and editorial rhythm', points: 8, status: 'unavailable', source: 'fixed viewport screenshot + reviewer' },
      { criterion: 'Restraint, subtraction, and cross-region consistency', points: 14, status: 'unavailable', source: 'fixed viewport screenshot + reviewer' },
    ],
  };
  return {
    score: automatedScore,
    max: automatedMax,
    percentage: automatedMax === 0 ? null : Math.round((automatedScore / automatedMax) * 1000) / 10,
    automated: { score: automatedScore, max: automatedMax, percentage: automatedMax === 0 ? null : Math.round((automatedScore / automatedMax) * 1000) / 10, checks },
    manualReview,
    overall: { score: null, max: 100, status: 'unavailable', message: 'Complete the 30-point fixed-viewport review before assigning an overall fidelity band.' },
    unavailable: checks.filter((item) => item.status === 'unavailable').map((item) => item.criterion),
  };
}

if (require.main === module) {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: node scripts/score-kami-report.js <report.html>');
    process.exitCode = 2;
  } else {
    try {
      const html = fs.readFileSync(input, 'utf8');
      process.stdout.write(JSON.stringify({ file: input, ...scoreHtml(html) }, null, 2) + '\n');
    } catch (error) {
      console.error('Unable to read ' + input + ': ' + error.message);
      process.exitCode = 2;
    }
  }
}

module.exports = { extractReportParts, scoreHtml };
