function normalizeCss(css) {
  return css
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, ' ')
    .replace(/\s*{\s*/g, '{')
    .replace(/\s*}\s*/g, '}')
    .replace(/\s*;\s*/g, ';')
    .replace(/\s*,\s*/g, ',')
    .replace(/([;{])\s*([-\w]+)\s*:\s*/g, '$1$2:')
    .replace(/@media\s+\(\s*([^:)]+?)\s*:\s*([^)]*?)\s*\)/g, '@media($1:$2)')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
}

function extractReportStyles(html) {
  return normalizeCss(html.match(/<style>([\s\S]*?)<\/style>/i)?.[1] ?? '');
}

module.exports = { extractReportStyles, normalizeCss };
