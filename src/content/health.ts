/**
 * Whether a change's CSS is doing anything on the current page: for every
 * selector, does at least one element match it right now?
 */

export interface CssHealth {
  selectors: number;
  matching: number;
  /** A few selectors that match nothing here, for the agent and the panel. */
  unmatched: string[];
}

/** Split a selector list on top-level commas (not those inside :is(), [attr="a,b"], or strings). */
export function splitSelectorList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (let i = 0; i < list.length; i++) {
    const ch = list[i]!;
    if (quote) {
      if (ch === '\\') {
        current += ch + (list[++i] ?? '');
        continue;
      }
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

// Pseudo-elements never match elements, and interaction states only match while interacting,
// so test the element they belong to instead.
const PSEUDO_ELEMENT = /::?(?:before|after|first-line|first-letter)\b|::[\w-]+(?:\([^)]*\))?/gi;
const INTERACTION_STATE = /:(?:hover|active|focus-visible|focus-within|focus|visited|target|placeholder-shown)\b/gi;

export function matchableSelector(selector: string): string {
  const stripped = selector.replace(PSEUDO_ELEMENT, '').replace(INTERACTION_STATE, '').trim();
  // A selector that was only a state (e.g. ":hover") applies to everything.
  return stripped === '' || /[>+~]$/.test(stripped) ? `${stripped}*` : stripped;
}

function collectSelectors(rules: CSSRuleList, out: string[]): void {
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) out.push(...splitSelectorList(rule.selectorText));
    else if ('cssRules' in rule && !(rule instanceof CSSKeyframesRule)) collectSelectors((rule as CSSGroupingRule).cssRules, out);
  }
}

export function cssHealth(doc: Document, sheet: CSSStyleSheet | null): CssHealth {
  const selectors: string[] = [];
  if (sheet) collectSelectors(sheet.cssRules, selectors);
  const unique = Array.from(new Set(selectors));
  let matching = 0;
  const unmatched: string[] = [];
  const matches = (selector: string) => {
    try {
      return doc.querySelector(matchableSelector(selector)) !== null;
    } catch {
      // A selector this browser parses in CSS but not in querySelector; don't count it against the change.
      return true;
    }
  };
  for (const selector of unique) {
    if (matches(selector)) matching++;
    else if (unmatched.length < 5) unmatched.push(selector);
  }
  return { selectors: unique.length, matching, unmatched };
}
