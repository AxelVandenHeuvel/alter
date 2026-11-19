import {
  directText,
  isHidden,
  isStableId,
  redact,
  stableClasses,
  truncate,
} from './dom-utils';

/**
 * Compressed, outline-style view of the visible DOM that a model can read and
 * write CSS selectors against. Wrapper elements without any identifying signal
 * are flattened away, runs of similar siblings are collapsed, and elements that
 * match the user's focus terms are always expanded.
 */

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'HEAD', 'BASE', 'TITLE']);
const LEAF_TAGS = new Set(['SVG', 'svg', 'IFRAME', 'VIDEO', 'CANVAS', 'IMG', 'PICTURE', 'INPUT', 'SELECT', 'TEXTAREA']);
const SIGNAL_TAGS = new Set([
  'HEADER', 'NAV', 'MAIN', 'ASIDE', 'FOOTER', 'SECTION', 'ARTICLE', 'FORM', 'DIALOG',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL',
  'IMG', 'VIDEO', 'IFRAME', 'TABLE', 'UL', 'OL',
]);
const KEPT_ATTRIBUTES = ['role', 'aria-label', 'data-testid', 'data-test-id', 'name', 'type', 'title', 'alt', 'href', 'src'];
/** Never shown: presentational noise, or form state the user typed. */
const OMITTED_ATTRIBUTES = new Set(['id', 'class', 'style', 'value', 'nonce', 'integrity', 'autocomplete']);
const MAX_EXTRA_ATTRIBUTES = 3;
const MAX_VISITED = 25_000;
const TEXT_LIMIT = 80;

interface SNode {
  label: string;
  signature: string;
  children: SNode[];
  /** This element matches a focus term. */
  focus: boolean;
  /** Something in this subtree matches a focus term. */
  containsFocus: boolean;
}

export interface SnapshotOptions {
  focusTerms: string[];
  maxChars: number;
}

export interface Snapshot {
  text: string;
  truncated: boolean;
  matchedFocus: number;
}

function shortenUrl(value: string, doc: Document): string {
  try {
    const url = new URL(value, doc.baseURI);
    const sameHost = url.host === doc.location?.host;
    if (url.protocol === 'data:') return 'data:…';
    return truncate(sameHost ? url.pathname + url.search : url.host + url.pathname, 60);
  } catch {
    return truncate(value, 60);
  }
}

function describeAttributes(el: Element): string[] {
  const out: string[] = [];
  for (const name of KEPT_ATTRIBUTES) {
    const value = el.getAttribute(name);
    if (value === null) continue;
    const shown = name === 'href' || name === 'src' ? shortenUrl(value, el.ownerDocument) : redact(truncate(value, 50));
    out.push(`${name}="${shown}"`);
  }
  // Short custom attributes are often the most stable hooks (e.g. YouTube's is-shorts, page-subtype).
  let extras = 0;
  for (const attr of el.attributes) {
    if (extras >= MAX_EXTRA_ATTRIBUTES) break;
    const name = attr.name;
    if (OMITTED_ATTRIBUTES.has(name) || name.startsWith('on') || name.startsWith('aria-')) continue;
    if (KEPT_ATTRIBUTES.includes(name)) continue;
    if (name.length > 30 || attr.value.length > 30) continue;
    out.push(attr.value === '' ? name : `${name}="${redact(attr.value)}"`);
    extras++;
  }
  return out;
}

function isSignalElement(el: Element, text: string): boolean {
  return (
    SIGNAL_TAGS.has(el.tagName) ||
    el.tagName.includes('-') ||
    (el.id !== '' && isStableId(el.id)) ||
    el.hasAttribute('role') ||
    el.hasAttribute('aria-label') ||
    el.hasAttribute('data-testid') ||
    stableClasses(el, 1).length > 0 ||
    text !== ''
  );
}

function matchesFocus(el: Element, text: string, terms: string[]): boolean {
  if (terms.length === 0) return false;
  const haystack = [el.tagName, text, el.id, el.getAttribute('class') ?? '']
    .concat(Array.from(el.attributes, (a) => `${a.name} ${a.value}`))
    .join(' ')
    .toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

class Builder {
  visited = 0;
  matched = 0;

  constructor(private readonly terms: string[]) {}

  /** Returns the nodes this element contributes: itself, or its children if it is a plain wrapper. */
  build(el: Element): SNode[] {
    if (this.visited++ > MAX_VISITED) return [];
    if (SKIP_TAGS.has(el.tagName) || isHidden(el)) return [];

    const text = redact(directText(el));
    const isLeaf = LEAF_TAGS.has(el.tagName);
    const childRoots: Element[] = isLeaf ? [] : Array.from(el.children);
    if (el.shadowRoot) childRoots.push(...Array.from(el.shadowRoot.children));
    const children = childRoots.flatMap((child) => this.build(child));

    const focus = matchesFocus(el, text, this.terms);
    if (focus) this.matched++;
    const containsFocus = focus || children.some((c) => c.containsFocus);

    if (!isSignalElement(el, text) && !focus) return children;

    const tag = el.tagName.toLowerCase();
    const id = el.id && isStableId(el.id) ? `#${el.id}` : '';
    const classes = stableClasses(el).map((c) => `.${c}`).join('');
    const attributes = describeAttributes(el);
    const shadow = el.shadowRoot ? ' [shadow-root]' : '';
    let label = `${tag}${id}${classes}${attributes.length ? ` [${attributes.join(' ')}]` : ''}${shadow}`;
    if (text) label += ` "${truncate(text, TEXT_LIMIT)}"`;
    return [{ label, signature: `${tag}${classes}`, children, focus, containsFocus }];
  }
}

function render(nodes: SNode[], maxDepth: number): string {
  const lines: string[] = [];

  const visit = (list: SNode[], depth: number, focusBudget: number) => {
    let i = 0;
    while (i < list.length) {
      const node = list[i]!;
      // Collapse long runs of look-alike siblings (feed items, list rows) unless they matter for focus.
      let run = 1;
      while (
        i + run < list.length &&
        list[i + run]!.signature === node.signature &&
        !list[i + run]!.containsFocus
      ) {
        run++;
      }
      const shownInRun = node.containsFocus ? 1 : Math.min(run, 2);
      for (let k = 0; k < shownInRun; k++) emit(list[i + k]!, depth, focusBudget);
      if (run > shownInRun) {
        lines.push(`${'  '.repeat(depth)}- … ${run - shownInRun} more ${node.signature}`);
      }
      i += run;
    }
  };

  const emit = (node: SNode, depth: number, focusBudget: number) => {
    const marker = node.focus ? ' ⟵ match' : '';
    lines.push(`${'  '.repeat(depth)}- ${node.label}${marker}`);
    if (node.children.length === 0) return;
    // Focused subtrees get a few extra levels below the depth limit.
    const budget = node.focus ? 4 : focusBudget - 1;
    if (depth + 1 < maxDepth || node.containsFocus || budget > 0) {
      visit(node.children, depth + 1, budget);
    } else {
      lines.push(`${'  '.repeat(depth + 1)}- …`);
    }
  };

  visit(nodes, 0, 0);
  return lines.join('\n');
}

export function takeSnapshot(doc: Document, options: SnapshotOptions): Snapshot {
  const terms = options.focusTerms.map((t) => t.toLowerCase().trim()).filter((t) => t.length >= 3);
  const builder = new Builder(terms);
  const roots = doc.body ? builder.build(doc.body) : [];

  for (let depth = 40; depth >= 2; depth = depth > 12 ? depth - 6 : depth - 2) {
    const text = render(roots, depth);
    if (text.length <= options.maxChars) return { text, truncated: depth < 40, matchedFocus: builder.matched };
  }
  const text = render(roots, 2);
  return {
    text: `${text.slice(0, options.maxChars)}\n- … (snapshot truncated)`,
    truncated: true,
    matchedFocus: builder.matched,
  };
}
