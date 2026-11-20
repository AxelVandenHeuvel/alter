import { chromium, test as base, type BrowserContext, type Locator, type Page, type Worker } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.output-e2e/chrome-mv3');

export const SITE = 'https://alter.test/';

export const SITE_HTML = `<!doctype html>
<html><head><title>Alter Test Site</title>
<style>
  body { margin: 0; font: 16px/1.5 Georgia, serif; background: #ffffff; color: #222; }
  header { display: flex; gap: 16px; padding: 16px 24px; background: #f2f2f2; border-bottom: 1px solid #ddd; }
  main { max-width: 640px; margin: 24px auto; padding: 0 24px; }
  .promo { padding: 16px; background: #ffe9a8; border-radius: 8px; }
</style></head>
<body>
  <header><strong>Daily Paper</strong><nav><a href="/">Home</a> <a href="/world">World</a></nav></header>
  <main>
    <section class="promo" data-testid="promo">Subscribe today and save 50%!</section>
    <article><h1>Calm Morning in the City</h1><p>The streets were quiet as the sun came up over the river.</p></article>
    <!-- Fields named "id" take over their form's id property, as on many real sites. -->
    <form class="signup" action="/subscribe"><input type="hidden" name="id" value="41"><input type="hidden" name="id" value="42"><button>Subscribe</button></form>
    <form class="region" action="/region"><select name="id"><option>Europe</option><option>Asia</option></select></form>
  </main>
</body></html>`;

/** Flip Chrome's per-extension "Allow User Scripts" switch, as a user would. */
export async function setUserScripts(context: BrowserContext, extensionId: string, on: boolean): Promise<void> {
  const page = await context.newPage();
  await page.goto(`chrome://extensions/?id=${extensionId}`);
  const toggle = page.locator('#allow-user-scripts');
  if ((await toggle.getAttribute('aria-pressed')) !== String(on)) await toggle.click();
  await page.close();
}

const paragraphs = (topic: string, n: number) =>
  Array.from(
    { length: n },
    (_, i) =>
      `<p>${topic} paragraph ${i + 1}. The council met on Tuesday to discuss the river path, and residents described how the quiet mornings had changed the way they move through the city, walking and cycling where they used to drive.</p>`,
  ).join('');

/** A news article buried in site chrome, like most news pages. */
export const ARTICLE_HTML = `<!doctype html>
<html><head><title>River Path Opens | Daily Paper</title><meta property="og:site_name" content="Daily Paper"></head>
<body style="margin:0;font:16px Georgia,serif;background:#fff;color:#222">
  <header><nav><a href="/">Home</a> <a href="/world">World</a> <a href="/sport">Sport</a></nav></header>
  <aside class="newsletter">Sign up for our newsletter! Get the best stories every morning.</aside>
  <main><article>
    <h1>River Path Opens to Walkers and Cyclists</h1>
    <p class="byline">By Ana Ruiz</p>
    ${paragraphs('Story', 8)}
    <figure><img src="/photo.jpg" alt="The new path"><figcaption>The new path at dawn.</figcaption></figure>
    <script>window.tracker = true;</script>
    <p>Officials said the <a href="javascript:alert(1)" onclick="steal()">full plan</a> will be published next month.</p>
  </article></main>
  <aside class="related"><h3>Most read</h3><ul><li><a href="/a">Celebrity news</a></li><li><a href="/b">Sport scores</a></li></ul></aside>
  <footer>Copyright Daily Paper</footer>
</body></html>`;

/** A recipe page: a life story and ads around schema.org Recipe data. */
export const RECIPE_HTML = `<!doctype html>
<html><head><title>The Best Lemon Pasta (You Will Ever Make) - Kitchen Blog</title>
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', name: 'Kitchen Blog' },
    {
      '@type': ['Recipe'],
      name: 'Lemon Pasta',
      author: { '@type': 'Person', name: 'Sam Lee' },
      description: 'Bright, quick, and creamy without cream.',
      prepTime: 'PT10M',
      cookTime: 'PT15M',
      totalTime: 'PT25M',
      recipeYield: ['4', '4 servings'],
      recipeIngredient: ['200 g spaghetti', '1 lemon, zested and juiced', '40 g parmesan', 'Salt &amp; pepper'],
      recipeInstructions: [
        { '@type': 'HowToSection', name: 'Pasta', itemListElement: [{ '@type': 'HowToStep', text: 'Boil the spaghetti in salted water.' }] },
        { '@type': 'HowToSection', name: 'Sauce', itemListElement: [{ '@type': 'HowToStep', text: 'Toss with lemon, parmesan, and pasta water.' }] },
      ],
    },
  ],
})}</script></head>
<body style="margin:0;font:16px Georgia,serif;background:#fff;color:#222">
  <div class="ad">ADVERTISEMENT: Buy pans!</div>
  <h1>The Best Lemon Pasta (You Will Ever Make)</h1>
  ${paragraphs('Life story', 6)}
  <div class="ad">ADVERTISEMENT: More pans!</div>
</body></html>`;

/**
 * A grocery listing: mixed units, and more products that load like infinite scroll when the test
 * calls loadMore() (on cue rather than on a timer, which Chrome holds back in background pages).
 */
export const GROCERY_HTML = `<!doctype html>
<html><head><title>Fresh Market - Breakfast</title>
<style>
  body { margin: 0; font: 15px system-ui, sans-serif; background: #fff; color: #222; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; padding: 24px; }
  .product { border: 1px solid #ddd; border-radius: 8px; padding: 12px; }
  .price { font-weight: 700; display: inline; }
</style></head>
<body>
  <h1>Breakfast</h1>
  <div class="grid">
    <div class="product" data-testid="oats"><p class="name">Old Fashioned Oats, 18 oz</p><p class="price">$4.29</p></div>
    <div class="product" data-testid="coffee"><p class="name">Ground Coffee, 1.5 lb</p><p class="price">$12.00</p></div>
    <div class="product" data-testid="juice"><p class="name">Orange Juice, 52 fl oz</p><p class="price">$3.99</p></div>
  </div>
  <script>
    window.loadMore = () => {
      document.querySelector('.grid').insertAdjacentHTML('beforeend',
        '<div class="product" data-testid="granola"><p class="name">Honey Granola, 12 oz</p><p class="price">$5.40</p></div>');
    };
  </script>
</body></html>`;

/** A store with a sign-in dialog that's in the page but closed, like most shopping sites. */
export const SHOP_HTML = `<!doctype html>
<html><head><title>Polo Shop</title>
<style>
  body { margin: 0; font: 15px system-ui, sans-serif; background: #fff; color: #222; }
  header { display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; border-bottom: 1px solid #ddd; }
  main { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; padding: 24px; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 12px; }
  .price { font-weight: 700; }
  dialog label { display: block; margin-bottom: 8px; }
</style></head>
<body>
  <header><h1>Polo Shop</h1><button id="sign-in">Sign in</button></header>
  <main>
    <article class="card"><h2>Oxford shirt</h2><p class="price" data-testid="shirt">$129.00</p></article>
    <article class="card"><h2>Cable sweater</h2><p class="price" data-testid="sweater">$298.00</p></article>
  </main>
  <dialog id="login">
    <form method="dialog">
      <label>Email <input type="email" name="email"></label>
      <label>Password <input type="password" name="password"></label>
      <button>Sign in</button>
    </form>
  </dialog>
  <script>document.getElementById('sign-in').addEventListener('click', () => document.getElementById('login').showModal());</script>
</body></html>`;

/** Exchange rates the tests serve instead of the real ones: a dollar is 150 yen. */
export const RATES_RESPONSE = ['USD', 'JPY', 'GBP', 'CAD', 'AUD', 'CHF', 'CNY', 'SEK', 'NOK', 'DKK', 'PLN', 'KRW'].map((quote, i) => ({
  date: '2026-11-06',
  base: 'EUR',
  quote,
  rate: quote === 'USD' ? 1 : quote === 'JPY' ? 150 : 1 + i / 10,
}));

/** A dark search page, like Google in dark mode, with a white logo. Its "Sponsored" chip is faint before any change. */
export const DARK_HTML = `<!doctype html>
<html><head><title>Night Search</title>
<style>
  body { margin: 0; font: 16px/1.5 Arial, sans-serif; background: #202124; color: #e8eaed; }
  main { max-width: 640px; margin: 24px auto; padding: 0 24px; }
  .result p { color: #bdc1c6; }
  .chip { display: inline-block; padding: 2px 8px; background: #3c4043; color: #5f6368; }
  .composer { margin-top: 24px; padding: 16px; border-radius: 24px; background: #303134; color: #e8eaed; }
</style></head>
<body><main>
  <svg class="logo" role="img" aria-label="Night Search" width="96" height="24" viewBox="0 0 96 24">
    <rect x="0" y="0" width="16" height="24" fill="#fff"/><rect x="24" y="0" width="16" height="24" fill="#fff"/><rect x="48" y="0" width="16" height="24" fill="#fff"/><rect x="72" y="0" width="16" height="24" fill="#fff"/>
  </svg>
  <h1>Search results</h1>
  <div class="result"><h3>Install Ollama</h3><p>You can install and run Ollama locally on macOS.</p></div>
  <span class="chip">Sponsored</span>
  <div class="composer" data-testid="composer">Ask anything</div>
</main></body></html>`;

/**
 * A social feed shaped like X: posts are rendered from JSON the page loads (with fetch, then
 * more with XMLHttpRequest), and each author's follower count is in that data but never shown.
 */
export const FEED_HTML = `<!doctype html>
<html><head><title>Feed</title></head>
<body style="margin:0;font:16px Arial,sans-serif">
  <main id="feed"></main>
  <script>
    const render = (json) => {
      for (const post of json.data.posts) {
        document.getElementById('feed').insertAdjacentHTML('beforeend',
          '<article class="post"><span class="author" data-handle="' + post.author.handle + '">' + post.author.name + '</span><p>' + post.text + '</p></article>');
      }
    };
    // More posts load once the first ones show. Chained rather than on a timer: Chrome holds back
    // timers in background pages (the site sits behind Alter's window in tests), which made it flaky.
    fetch('/api/feed.json').then((r) => r.json()).then((json) => {
      render(json);
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/api/more.json');
      xhr.onload = () => render(JSON.parse(xhr.responseText));
      xhr.send();
    });
  </script>
</body></html>`;

const FEED_DATA: Record<string, unknown> = {
  '/api/feed.json': {
    data: {
      posts: [
        { text: 'Morning run done', author: { handle: 'ana', name: 'Ana', followers_count: 1520 } },
        { text: 'New blog post is up', author: { handle: 'bo', name: 'Bo', followers_count: 87 } },
      ],
    },
  },
  '/api/more.json': { data: { posts: [{ text: 'Hello from later', author: { handle: 'cy', name: 'Cy', followers_count: 1250000 } }] } },
};

interface Fixtures {
  scriptsEnabled: boolean;
  /** The version GitHub says is the latest release, or null for none published. */
  latestRelease: string | null;
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
  site: Page;
  panel: Page;
  /** Open Alter for the site tab again (after closing it), like clicking the icon. */
  openPanel: () => Promise<Page>;
}

export const test = base.extend<Fixtures>({
  scriptsEnabled: [true, { option: true }],
  latestRelease: [null, { option: true }],
  context: async ({ latestRelease }, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    // Alter downloads exchange rates when a script converts prices; tests never reach the real service.
    await context.route('https://api.frankfurter.dev/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(RATES_RESPONSE) }),
    );
    // The panel asks GitHub for the latest release; tests never reach the real service either.
    await context.route('https://api.github.com/repos/AxelVandenHeuvel/alter/releases/latest', (route) =>
      latestRelease
        ? route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ tag_name: `v${latestRelease}` }) })
        : route.fulfill({ status: 404, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"message":"Not Found"}' }),
    );
    await context.route('https://alter.test/**', (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname.endsWith('.jpg')) return route.fulfill({ status: 404 });
      if (FEED_DATA[pathname]) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FEED_DATA[pathname]) });
      const pages: Record<string, string> = { '/article': ARTICLE_HTML, '/recipe': RECIPE_HTML, '/grocery': GROCERY_HTML, '/dark': DARK_HTML, '/feed': FEED_HTML, '/shop': SHOP_HTML };
      const body = pages[pathname] ?? SITE_HTML;
      return route.fulfill({ status: 200, contentType: 'text/html', body });
    });
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
  site: async ({ context, serviceWorker }, use) => {
    // Pages load once Alter has finished installing, as they would for someone who just added it:
    // before that, nothing keeps copies of the data sites load.
    await test.expect
      .poll(() => serviceWorker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts({ ids: ['alter-page-data'] })).length))
      .toBe(1);
    const page = await context.newPage();
    await page.goto(SITE);
    await use(page);
  },
  openPanel: async ({ context, serviceWorker, extensionId, site }, use) => {
    const tabId = await serviceWorker.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      return tab!.id!;
    }, site.url());
    await use(async () => {
      // The panel page in its own small window, next to the site tab; tests of the floating panel itself use openFloatingPanel.
      const pagePromise = context.waitForEvent('page');
      await serviceWorker.evaluate(
        ({ id, tab }) => chrome.windows.create({ url: `chrome-extension://${id}/panel.html?tabId=${tab}`, type: 'popup', width: 380, height: 720 }),
        { id: extensionId, tab: tabId },
      );
      const panel = await pagePromise;
      await panel.setViewportSize({ width: 380, height: 720 });
      await panel.waitForLoadState();
      return panel;
    });
  },
  panel: async ({ context, extensionId, scriptsEnabled, openPanel }, use) => {
    if (scriptsEnabled) await setUserScripts(context, extensionId, true);
    await use(await openPanel());
  },
});

export const expect = test.expect;

/** Send a request from the composer. Does not wait for the run to finish (cards may need approval). */
export async function ask(panel: Page, text: string): Promise<void> {
  await panel.getByLabel('Describe a change').fill(text);
  await panel.getByLabel('Describe a change').press('Enter');
}

/** Open a proposal card's details (its summary, live status, and code), which start collapsed. */
export async function openDetails(card: Locator): Promise<void> {
  const toggle = card.getByRole('heading').getByRole('button');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

/** Wait until the agent run is over; the composer ignores new requests while one is running. */
export async function waitForIdle(panel: Page): Promise<void> {
  await expect(panel.getByRole('button', { name: 'Stop' })).toHaveCount(0);
}

interface DomNode {
  nodeId: number;
  nodeType: number;
  nodeName: string;
  nodeValue: string;
  attributes?: string[];
  children?: DomNode[];
  shadowRoots?: DomNode[];
}

/**
 * Reads Alter's reader/recipe view, which lives in a closed shadow root that page
 * code (and Playwright locators) can't reach, through the DevTools protocol.
 */
export async function focusView(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const { root } = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: DomNode };
  const hosts: DomNode[] = [];
  const walk = (node: DomNode) => {
    const attrs = node.attributes ?? [];
    if (attrs.includes('data-alter-focus')) hosts.push(node);
    node.children?.forEach(walk);
    node.shadowRoots?.forEach(walk);
  };
  walk(root);
  const textOf = (node: DomNode): string =>
    node.nodeName === 'STYLE'
      ? ''
      : node.nodeType === 3
        ? node.nodeValue
        : [...(node.shadowRoots ?? []), ...(node.children ?? [])].map(textOf).join(' ');
  const findButton = (node: DomNode, label: string): DomNode | null => {
    if (node.nodeName === 'BUTTON' && textOf(node).trim() === label) return node;
    for (const child of [...(node.shadowRoots ?? []), ...(node.children ?? [])]) {
      const found = findButton(child, label);
      if (found) return found;
    }
    return null;
  };
  return {
    /** All text in the view (overlay or reopen button), whitespace collapsed. */
    text: hosts.map(textOf).join(' ').replace(/\s+/g, ' ').trim(),
    count: hosts.length,
    async click(label: string) {
      const button = hosts.map((h) => findButton(h, label)).find(Boolean);
      if (!button) throw new Error(`No "${label}" button in the focus view`);
      const { model } = (await cdp.send('DOM.getBoxModel', { nodeId: button.nodeId })) as { model: { content: number[] } };
      const [x1, y1, , , x3, y3] = model.content as [number, number, number, number, number, number];
      await page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2);
    },
  };
}

/**
 * Open Alter's floating panel on the site, the way the toolbar icon does, and return its frame.
 * (Automation can't click the toolbar icon; this does what its handler does: load the page
 * code only if it isn't running yet, then ask it to open the panel.)
 */
export async function openFloatingPanel(site: Page, serviceWorker: Worker) {
  await serviceWorker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    const tabId = tab!.id!;
    const running = await chrome.tabs.sendMessage(tabId, { type: 'alter:ping' }).catch(() => undefined);
    if (!running) await chrome.scripting.executeScript({ target: { tabId }, files: ['/content-scripts/page.js'] });
    await chrome.tabs.sendMessage(tabId, { type: 'alter:widget', action: 'open', tabId });
  }, site.url());
  await expect.poll(() => site.frames().some((f) => f.url().includes('/panel.html'))).toBe(true);
  const frame = site.frames().find((f) => f.url().includes('/panel.html'))!;
  await frame.waitForSelector('.app .header');
  return frame;
}

/** Where the minimized "Alter" button is on the page (it lives in a closed shadow root), or null. */
export async function pillBox(page: Page): Promise<{ x: number; y: number; width: number; height: number } | null> {
  const cdp = await page.context().newCDPSession(page);
  const { root } = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: DomNode };
  const find = (node: DomNode): DomNode | null => {
    const classes = (node.attributes ?? []).join(' ');
    if (node.nodeName === 'BUTTON' && /\bpill\b/.test(classes) && !/\bhidden\b/.test(classes)) return node;
    for (const child of [...(node.shadowRoots ?? []), ...(node.children ?? [])]) {
      const found = find(child);
      if (found) return found;
    }
    return null;
  };
  const pill = find(root);
  if (!pill) return null;
  const { model } = (await cdp.send('DOM.getBoxModel', { nodeId: pill.nodeId })) as { model: { border: number[] } };
  const [x1, y1, , , x3, y3] = model.border as [number, number, number, number, number, number];
  return { x: x1, y: y1, width: x3 - x1, height: y3 - y1 };
}

