import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DATA_EVENT, installCapture, readPageData, searchPageData, sourceName, summarizePageData, type DataEntry } from '../../src/content/page-data';
import { buildScript, type ScriptReport } from '../../src/lib/userscripts';

/** A timeline response shaped like X's: the author's follower count is loaded but never shown. */
const timeline = {
  data: {
    entries: [
      { tweet: { text: 'Hello', user: { core: { screen_name: 'ana' }, legacy: { followers_count: 1520, name: 'Ana' } } } },
      { tweet: { text: 'Hi', user: { core: { screen_name: 'bo' }, legacy: { followers_count: 87, name: 'Bo' } } } },
    ],
  },
};

const responses: Record<string, { body: string; type: string }> = {
  'https://x.test/api/timeline?cursor=1': { body: JSON.stringify(timeline), type: 'application/json; charset=utf-8' },
  'https://x.test/api/later': {
    body: JSON.stringify({ user: { core: { screen_name: 'cy' }, legacy: { followers_count: 5, name: 'Cy' } } }),
    type: 'application/json',
  },
  'https://x.test/page.html': { body: '<p>{not data}</p>', type: 'text/html' },
};

const nativeFetch = window.fetch;

beforeAll(() => {
  window.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    // Some sites' own fetch wrappers resolve to something that isn't a Response.
    if (url === 'https://x.test/not-a-response') return { ok: true } as unknown as Response;
    const found = responses[url];
    const response = new Response(found?.body ?? '', { headers: { 'content-type': found?.type ?? 'text/plain' } });
    Object.defineProperty(response, 'url', { value: url });
    return response;
  }) as typeof fetch;
  document.body.innerHTML = '<script type="application/json" id="__NEXT_DATA__">{"props":{"page":"home"}}</script>';
  installCapture(window as Window & typeof globalThis);
});

afterEach(() => {
  (globalThis as { __alter?: { dispose(): void } }).__alter?.dispose();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function run(js: string): Promise<ScriptReport> {
  return (0, eval)(buildScript('test', js, { contain: false }).code) as Promise<ScriptReport>;
}

describe('page data capture', () => {
  it('keeps copies of the JSON the page loads, and nothing else', async () => {
    const response = await window.fetch('https://x.test/api/timeline?cursor=1');
    // The page still gets its response, unread.
    expect(response.bodyUsed).toBe(false);
    await window.fetch('https://x.test/page.html');
    await settle();
    const entries = readPageData(document);
    expect(entries.map((e) => e.url)).toEqual(['page:__NEXT_DATA__', 'https://x.test/api/timeline?cursor=1']);
    expect(JSON.parse(entries[1]!.body)).toEqual(timeline);
    expect(window.fetch).not.toBe(nativeFetch);
  });

  it('leaves alone a fetch that resolves to something other than a Response, without errors', async () => {
    const before = readPageData(document).length;
    expect(await window.fetch('https://x.test/not-a-response')).toEqual({ ok: true });
    await settle();
    expect(readPageData(document)).toHaveLength(before);
  });

  it('installs once, however often it is injected', async () => {
    installCapture(window as Window & typeof globalThis);
    let events = 0;
    const count = () => events++;
    document.addEventListener(DATA_EVENT, count);
    await window.fetch('https://x.test/api/later');
    await settle();
    document.removeEventListener(DATA_EVENT, count);
    expect(events).toBe(1);
  });
});

describe('alter.data', () => {
  it('gives scripts every object the site loaded, then each new one', async () => {
    const report = await run(`
      const followers = {};
      alter.data.each((o) => { if (o.core && o.legacy) followers[o.core.screen_name] = o.legacy.followers_count; });
      let responses = 0;
      alter.data.onLoad(() => responses++);
      globalThis.__followers = () => ({ followers, responses });
    `);
    expect(report.errors).toEqual([]);
    const read = () => (globalThis as unknown as { __followers: () => { followers: Record<string, number>; responses: number } }).__followers();
    expect(read()).toEqual({ followers: { ana: 1520, bo: 87, cy: 5 }, responses: 3 });

    responses['https://x.test/api/more'] = {
      body: JSON.stringify({ user: { core: { screen_name: 'di' }, legacy: { followers_count: 12 } } }),
      type: 'application/json',
    };
    await window.fetch('https://x.test/api/more');
    await settle();
    expect(read().followers.di).toBe(12);
    expect(read().responses).toBe(4);
  });

  it('stops receiving data when the change is turned off', async () => {
    await run(`globalThis.__seen = 0; alter.data.onLoad(() => globalThis.__seen++);`);
    const seen = () => (globalThis as unknown as { __seen: number }).__seen;
    const before = seen();
    (globalThis as { __alter?: { dispose(): void } }).__alter!.dispose();
    await window.fetch('https://x.test/api/later');
    await settle();
    expect(seen()).toBe(before);
  });
});

describe('searchPageData', () => {
  const entries: DataEntry[] = [
    { id: 1, url: 'https://x.test/api/timeline?cursor=1', body: JSON.stringify(timeline) },
    { id: 2, url: 'page:__NEXT_DATA__', body: '{"props":{"page":"home"}}' },
    { id: 3, url: 'https://x.test/broken', body: '{oops' },
  ];

  it('groups matches by the shape of their path, with an example and its surroundings', () => {
    const result = searchPageData(entries, 'followers');
    expect(result.total).toBe(2);
    expect(result.matches).toHaveLength(1);
    const match = result.matches[0]!;
    expect(match.pattern).toBe('data.entries[].tweet.user.legacy.followers_count');
    expect(match.count).toBe(2);
    expect(match.sources).toEqual(['x.test/api/timeline']);
    expect(match.example).toEqual({ path: 'data.entries[0].tweet.user.legacy.followers_count', value: '1520' });
    // A few levels up from the match: the post and its author, so the model sees how the count relates to the name.
    expect(match.context).toBe('{"text": "Hello", "user": {"core": {"screen_name": "ana"}, "legacy": {"followers_count": 1520, "name": "Ana"}}}');
  });

  it('finds text in values too', () => {
    expect(searchPageData(entries, 'home').matches[0]!.example).toEqual({ path: 'props.page', value: '"home"' });
  });

  it('summarizes where the data came from', () => {
    expect(summarizePageData(entries.map((e) => ({ url: e.url, chars: e.body.length })))).toEqual({
      responses: 3,
      sources: [
        { name: 'x.test/api/timeline', responses: 1, chars: entries[0]!.body.length },
        { name: 'embedded in the page (__NEXT_DATA__)', responses: 1, chars: 25 },
        { name: 'x.test/broken', responses: 1, chars: 5 },
      ],
    });
    expect(sourceName('not a url')).toBe('not a url');
  });
});
