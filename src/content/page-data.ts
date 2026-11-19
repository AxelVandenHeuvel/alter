import { isSensitiveHost } from '../lib/sensitive';
import { redact, truncate } from './dom-utils';

/**
 * Data the site has already loaded. Sites like X download far more than they show
 * (a post's author comes with their follower count, for example), so Alter keeps a
 * copy of the JSON the site's own code receives, and lets change scripts read it.
 *
 * Capturing happens in the page's main world, where the site's requests are made,
 * through code Alter ships (never model-written). It only reads responses; it never
 * makes a request. Copies are handed to Alter's isolated worlds through DOM events,
 * as JSON text. The site can see and fake those events, but that only changes what
 * a script displays, and it is the site's own data anyway.
 */

/** Main world to isolated worlds: one captured response, as JSON text of a DataEntry. */
export const DATA_EVENT = 'alter:page-data';
/** Isolated worlds to main world: send every captured response again (dispatched synchronously). */
export const REPLAY_EVENT = 'alter:page-data-replay';
/** Isolated worlds to main world: list what was captured, without the data itself (answered with LIST_EVENT). */
export const LIST_REQUEST_EVENT = 'alter:page-data-list-request';
export const LIST_EVENT = 'alter:page-data-list';

const INSTALLED = Symbol.for('alter.pageData');
/** Bigger responses are rarely what a change needs, and copying them would slow the page. */
const MAX_BODY_CHARS = 4_000_000;
const MAX_TOTAL_CHARS = 24_000_000;
const MAX_ENTRIES = 300;

export interface DataEntry {
  id: number;
  /** Where the data came from: a request URL, or "page:<script id>" for JSON embedded in the page. */
  url: string;
  body: string;
}

const looksLikeJson = (body: string) => /^\s*[[{]/.test(body);
const isJsonType = (type: string | null) => /\bjson\b/i.test(type ?? '');

/** Start keeping copies of the JSON the page receives. Runs in the page's main world, at document start. */
export function installCapture(win: Window & typeof globalThis): void {
  const marked = win as unknown as Record<symbol, boolean>;
  if (marked[INSTALLED] || isSensitiveHost(win.location.hostname)) return;
  marked[INSTALLED] = true;

  const doc = win.document;
  const entries: DataEntry[] = [];
  let total = 0;
  let nextId = 1;
  const publish = (entry: DataEntry) => doc.dispatchEvent(new win.CustomEvent(DATA_EVENT, { detail: JSON.stringify(entry) }));
  const keep = (url: string, body: string) => {
    if (body.length > MAX_BODY_CHARS || !looksLikeJson(body)) return;
    const entry = { id: nextId++, url, body };
    entries.push(entry);
    total += body.length;
    while (entries.length > MAX_ENTRIES || total > MAX_TOTAL_CHARS) total -= entries.shift()!.body.length;
    publish(entry);
  };
  doc.addEventListener(REPLAY_EVENT, () => entries.slice().forEach(publish));
  doc.addEventListener(LIST_REQUEST_EVENT, () => {
    const list = entries.map((e) => ({ url: e.url, chars: e.body.length }));
    doc.dispatchEvent(new win.CustomEvent(LIST_EVENT, { detail: JSON.stringify(list) }));
  });

  const fetch = win.fetch;
  if (typeof fetch === 'function') {
    win.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
      const pending = fetch.apply(this, args);
      // The page's fetch may already be someone else's wrapper that resolves to something that
      // isn't a Response. Whatever it gives back goes to the page untouched, and the copy never throws.
      Promise.resolve(pending)
        .then((response: unknown) => {
          if (!(response instanceof win.Response) || !isJsonType(response.headers.get('content-type'))) return;
          return response
            .clone()
            .text()
            .then((body) => keep(response.url, body));
        })
        .catch(() => undefined);
      return pending;
    } as typeof fetch;
  }

  const xhr = win.XMLHttpRequest?.prototype;
  if (xhr) {
    const send = xhr.send;
    xhr.send = function (this: XMLHttpRequest, ...args: Parameters<typeof send>) {
      this.addEventListener('load', () => {
        try {
          if (!isJsonType(this.getResponseHeader('content-type'))) return;
          if (this.responseType === '' || this.responseType === 'text') keep(this.responseURL, this.responseText);
          else if (this.responseType === 'json' && this.response !== null) keep(this.responseURL, JSON.stringify(this.response));
        } catch {
          // A response the page can't read either.
        }
      });
      return send.apply(this, args);
    };
  }

  // Data the server put into the page itself (Next.js and similar frameworks).
  const embedded = () => {
    doc.querySelectorAll('script[type="application/json"]').forEach((script, i) => {
      keep(`page:${script.id || i}`, script.textContent ?? '');
    });
  };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', embedded, { once: true });
  else embedded();
}

/** Everything captured on this page so far. Synchronous: the main world answers while the event is dispatched. */
export function readPageData(doc: Document): DataEntry[] {
  const found = new Map<number, DataEntry>();
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (typeof detail !== 'string') return;
    try {
      const entry = JSON.parse(detail) as DataEntry;
      if (typeof entry.id === 'number' && typeof entry.body === 'string') found.set(entry.id, entry);
    } catch {
      // Not ours.
    }
  };
  doc.addEventListener(DATA_EVENT, listener);
  doc.dispatchEvent(new CustomEvent(REPLAY_EVENT));
  doc.removeEventListener(DATA_EVENT, listener);
  return Array.from(found.values()).sort((a, b) => a.id - b.id);
}

/** What was captured on this page, without the data: cheap enough for every page summary. Null when nothing is capturing. */
export function listPageData(doc: Document): { url: string; chars: number }[] | null {
  let list: { url: string; chars: number }[] | null = null;
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    try {
      const parsed: unknown = typeof detail === 'string' ? JSON.parse(detail) : null;
      if (Array.isArray(parsed)) list = parsed as { url: string; chars: number }[];
    } catch {
      // Not ours.
    }
  };
  doc.addEventListener(LIST_EVENT, listener);
  doc.dispatchEvent(new CustomEvent(LIST_REQUEST_EVENT));
  doc.removeEventListener(LIST_EVENT, listener);
  return list;
}

/** A short name for where data came from: the URL's path without its query. */
export function sourceName(url: string): string {
  if (url.startsWith('page:')) return `embedded in the page (${url.slice(5)})`;
  try {
    const { host, pathname } = new URL(url);
    return truncate(`${host}${pathname}`, 90);
  } catch {
    return truncate(url, 90);
  }
}

export interface PageDataSummary {
  responses: number;
  /** Distinct sources, most data first. */
  sources: { name: string; responses: number; chars: number }[];
}

export function summarizePageData(entries: { url: string; chars: number }[]): PageDataSummary {
  const sources = new Map<string, { name: string; responses: number; chars: number }>();
  for (const entry of entries) {
    const name = sourceName(entry.url);
    const source = sources.get(name) ?? { name, responses: 0, chars: 0 };
    source.responses++;
    source.chars += entry.chars;
    sources.set(name, source);
  }
  return { responses: entries.length, sources: Array.from(sources.values()).sort((a, b) => b.chars - a.chars).slice(0, 12) };
}

export interface DataMatch {
  /** The path with array positions generalized to [], shared by every match of this shape. */
  pattern: string;
  count: number;
  sources: string[];
  /** One full example path and value. */
  example: { path: string; value: string };
  /** The object a few levels up from the match, abbreviated, to show how it relates to its neighbors. */
  context: string;
}

export interface DataSearch {
  summary: PageDataSummary;
  matches: DataMatch[];
  /** Matches found in all, across every shape. */
  total: number;
}

const MAX_PATTERNS = 8;
const MAX_MATCHES_WALKED = 5000;
/** How many levels above a match the context starts: usually enough to reach the record it belongs to. */
const CONTEXT_LEVELS = 3;

/**
 * Find keys or text in the captured data. A match is a key whose name contains the
 * query, or a string value that does. Matches are grouped by the shape of their path,
 * since a timeline repeats the same record many times.
 */
export function searchPageData(entries: DataEntry[], query: string): DataSearch {
  const needle = query.trim().toLowerCase();
  const patterns = new Map<string, DataMatch & { order: number }>();
  let total = 0;
  for (const entry of entries) {
    let json: unknown;
    try {
      json = JSON.parse(entry.body);
    } catch {
      continue;
    }
    const source = sourceName(entry.url);
    // Depth-first, keeping the chain of values so the context can be cut from it.
    const walk = (value: unknown, path: (string | number)[], chain: unknown[]) => {
      if (total >= MAX_MATCHES_WALKED || value === null || typeof value !== 'object') return;
      const nextChain = [...chain, value];
      for (const [key, child] of Array.isArray(value) ? value.entries() : Object.entries(value)) {
        const childPath = [...path, key];
        const keyMatches = typeof key === 'string' && key.toLowerCase().includes(needle);
        const valueMatches = typeof child === 'string' && child.toLowerCase().includes(needle);
        if (needle && (keyMatches || valueMatches)) {
          total++;
          const pattern = formatPath(childPath, true);
          const group = patterns.get(pattern);
          if (group) {
            group.count++;
            if (!group.sources.includes(source)) group.sources.push(source);
          } else if (patterns.size < 50) {
            patterns.set(pattern, {
              pattern,
              count: 1,
              sources: [source],
              example: { path: formatPath(childPath, false), value: abbreviate(child, 0) },
              context: abbreviate(nextChain[Math.max(0, nextChain.length - CONTEXT_LEVELS)], 0),
              order: patterns.size,
            });
          }
        }
        walk(child, childPath, nextChain);
      }
    };
    walk(json, [], []);
  }
  const matches = Array.from(patterns.values())
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .slice(0, MAX_PATTERNS)
    .map(({ order: _order, ...match }) => match);
  return { summary: summarizePageData(entries.map((e) => ({ url: e.url, chars: e.body.length }))), matches, total };
}

function formatPath(path: (string | number)[], general: boolean): string {
  return path
    .map((part, i) =>
      typeof part === 'number' ? (general ? '[]' : `[${part}]`) : /^[A-Za-z_$][\w$]*$/.test(part) ? `${i ? '.' : ''}${part}` : `[${JSON.stringify(part)}]`,
    )
    .join('');
}

/** Compact JSON for the model: short strings, the first item of arrays, and limited depth. */
function abbreviate(value: unknown, depth: number): string {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' ? JSON.stringify(redact(truncate(value, 60))) : String(value);
  }
  if (depth >= 4) return Array.isArray(value) ? '[…]' : '{…}';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[${abbreviate(value[0], depth + 1)}${value.length > 1 ? `, …${value.length - 1} more` : ''}]`;
  }
  const keys = Object.keys(value);
  const shown = keys.slice(0, 14).map((key) => `${JSON.stringify(key)}: ${abbreviate((value as Record<string, unknown>)[key], depth + 1)}`);
  const text = `{${shown.join(', ')}${keys.length > shown.length ? `, …${keys.length - shown.length} more keys` : ''}}`;
  return depth === 0 ? truncate(text, 1200) : text;
}
