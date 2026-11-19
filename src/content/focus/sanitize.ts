/**
 * Turn extracted article HTML into a safe, plain fragment for the reader view.
 * Allowlist only: text structure, links, images, and tables. Everything else is
 * either unwrapped (its text kept) or dropped (scripts, embeds, forms, styles).
 * Parsing happens in an inert document, so nothing loads or runs while cleaning.
 */

const KEEP = new Set([
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'em', 'strong', 'b', 'i', 'u', 's',
  'sub', 'sup', 'small', 'mark', 'abbr', 'cite', 'q', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'a', 'img', 'picture', 'source',
  'figure', 'figcaption', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'time',
]);

const DROP = new Set([
  'script', 'style', 'noscript', 'template', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input',
  'button', 'select', 'textarea', 'link', 'meta', 'base', 'svg', 'math', 'canvas', 'video', 'audio', 'dialog',
]);

const ATTRIBUTES: Record<string, string[]> = {
  a: ['href', 'title'],
  img: ['src', 'srcset', 'alt', 'title', 'width', 'height'],
  source: ['srcset', 'type', 'media'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan', 'scope'],
  time: ['datetime'],
  abbr: ['title'],
  ol: ['start'],
};

export function safeUrl(value: string, base: string, images: boolean): string | null {
  try {
    const url = new URL(value.trim(), base);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
    if (images && url.protocol === 'data:' && /^data:image\/(png|jpe?g|gif|webp|avif)/i.test(url.href)) return url.href;
    return null;
  } catch {
    return null;
  }
}

function safeSrcset(value: string, base: string): string | null {
  const candidates = value
    .split(',')
    .map((candidate) => {
      const [url, descriptor] = candidate.trim().split(/\s+/, 2);
      const safe = url ? safeUrl(url, base, true) : null;
      return safe ? `${safe}${descriptor ? ` ${descriptor}` : ''}` : null;
    })
    .filter(Boolean);
  return candidates.length ? candidates.join(', ') : null;
}

function cleanInto(source: Node, target: Node, doc: Document, base: string): void {
  for (const child of Array.from(source.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(doc.createTextNode(child.textContent ?? ''));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    const tag = el.tagName.toLowerCase();
    if (DROP.has(tag)) continue;
    if (!KEEP.has(tag)) {
      // Unknown wrapper (div, span, section, article...): keep its contents, not the element.
      cleanInto(el, target, doc, base);
      continue;
    }

    const copy = doc.createElement(tag);
    for (const name of ATTRIBUTES[tag] ?? []) {
      const value = el.getAttribute(name);
      if (value === null) continue;
      let safe: string | null = value;
      if (name === 'href') safe = safeUrl(value, base, false);
      else if (name === 'src') safe = safeUrl(value, base, true);
      else if (name === 'srcset') safe = safeSrcset(value, base);
      if (safe !== null) copy.setAttribute(name, safe);
    }
    if (tag === 'a' && copy.hasAttribute('href')) {
      copy.setAttribute('target', '_blank');
      copy.setAttribute('rel', 'noopener noreferrer');
    }
    if (tag === 'img') {
      if (!copy.hasAttribute('src') && !copy.hasAttribute('srcset')) continue;
      copy.setAttribute('loading', 'lazy');
      copy.setAttribute('referrerpolicy', 'no-referrer');
    }
    cleanInto(el, copy, doc, base);
    target.appendChild(copy);
  }
}

export function sanitizeArticleHtml(html: string, base: string, doc: Document): DocumentFragment {
  const inert = new DOMParser().parseFromString(html, 'text/html');
  const fragment = doc.createDocumentFragment();
  cleanInto(inert.body, fragment, doc, base);
  return fragment;
}
