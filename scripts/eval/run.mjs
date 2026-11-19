/* global chrome, indexedDB, window -- functions passed to evaluate() run in the browser */
// Runs Alter against real sites with the real model, and grades the results.
//
// Each case opens a page in an installed Google Chrome (with its own profile, kept in
// .eval-profile so sign-ins and cookie choices stick), types the request into Alter's
// panel, approves scripts, saves the change, reloads the page, and has a judge model
// grade before and after screenshots. Results go to eval-results/<time>/report.html.
//
// Usage:
//   npm run eval                       every case
//   npm run eval -- hn-dark x-*        only these cases (* matches anything)
//   npm run eval -- --skip x-*         every case but these
//   npm run eval -- --model opus       Alter uses this model: sonnet (default), haiku, or opus
//   npm run eval -- --concurrency 2    cases at once (default 3)
//   npm run eval -- --repeat 3         run each case 3 times (results vary from run to run)
//   npm run eval -- --login            open the eval profile to sign in and accept cookie banners
//
// Needs ANTHROPIC_API_KEY in .env.local. Every run costs real money: Alter's requests
// plus the judge (about $0.05 per case).
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { cases as allCases } from './cases.mjs';
import { judge } from './judge.mjs';
import { writeReport } from './report.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const EXTENSION = path.join(ROOT, '.output-eval/chrome-mv3');
const PROFILE = path.join(ROOT, '.eval-profile');
const RESULTS = path.join(ROOT, 'eval-results');
const PORT = 9350;
const CASE_TIMEOUT_MS = Number(process.env.EVAL_CASE_TIMEOUT_MS ?? 6 * 60_000);
/** Pages keep loading things after the load event; give them a moment before measuring. */
const SETTLE_MS = 3000;
const MODELS = { sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5', opus: 'claude-opus-5-5' };

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const options = { model: 'sonnet', concurrency: 3, repeat: 1, login: false, patterns: [], skip: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--model') options.model = argv[++i];
    else if (arg === '--concurrency') options.concurrency = Number(argv[++i]);
    else if (arg === '--repeat') options.repeat = Number(argv[++i]);
    else if (arg === '--login') options.login = true;
    else if (arg === '--skip') options.skip.push(argv[++i]);
    else options.patterns.push(arg);
  }
  if (!MODELS[options.model]) throw new Error(`Unknown model "${options.model}". Use ${Object.keys(MODELS).join(', ')}.`);
  if (!(options.concurrency >= 1)) throw new Error('--concurrency needs a number of 1 or more.');
  if (!(options.repeat >= 1)) throw new Error('--repeat needs a number of 1 or more.');
  return options;
}

const matcher = (pattern) => new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);

function selectCases(patterns, skip) {
  const wanted = patterns.map(matcher);
  const skipped = skip.map(matcher);
  const selected = allCases.filter((c) => (!wanted.length || wanted.some((m) => m.test(c.id))) && !skipped.some((m) => m.test(c.id)));
  if (!selected.length) throw new Error(`No case matches ${patterns.join(' ')}. Cases: ${allCases.map((c) => c.id).join(', ')}`);
  return selected;
}

async function launchChrome(extraArgs = []) {
  const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const chrome = spawn(
    chromePath,
    [
      `--user-data-dir=${PROFILE}`,
      `--remote-debugging-port=${PORT}`,
      '--enable-unsafe-extension-debugging',
      '--no-first-run',
      '--no-default-browser-check',
      // Several cases run side by side in their own windows, which may cover each other.
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      ...extraArgs,
    ],
    { stdio: 'ignore' },
  );
  const exited = new Promise((resolve) => chrome.once('exit', resolve));
  return { chrome, exited };
}

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    } catch {
      await pause(500);
    }
  }
  throw new Error('Could not reach Chrome. Is another eval (or Chrome with the eval profile) still open?');
}

/** Open the eval profile to sign in to sites and accept cookie banners; ends when Chrome is closed. */
async function login() {
  const sites = [...new Set(allCases.map((c) => new URL(c.url).origin))];
  const { exited } = await launchChrome(sites);
  console.log('Chrome is open with the eval profile, one tab per site the eval visits.');
  console.log('Sign in where you want to (X needs it), accept or reject cookie banners, and solve any captcha.');
  console.log('Quit Chrome (⌘Q) when you are done.');
  await exited;
  console.log('Saved. Run `npm run eval` next.');
}

/** An extension page used as a control room: it can use the chrome.* APIs Alter uses. */
async function openControl(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/panel.html`);
  await page.waitForFunction(() => typeof chrome !== 'undefined' && Boolean(chrome.storage));
  return page;
}

async function setUp(browser, model) {
  const cdp = await browser.newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: EXTENSION });
  const context = browser.contexts()[0];

  const control = await openControl(context, id);
  // "Allow User Scripts", turned on as a user would. The profile remembers it, so only
  // flip it when scripts are really off (the switch's markup doesn't say reliably).
  // Chrome leaves chrome.userScripts out entirely while the switch is off.
  const scriptsOn = () =>
    control.evaluate(async () => {
      try {
        await chrome.userScripts.getScripts();
        return true;
      } catch {
        return false;
      }
    });
  if (!(await scriptsOn())) {
    const extensions = await context.newPage();
    await extensions.goto(`chrome://extensions/?id=${id}`);
    await extensions.locator('#allow-user-scripts').click();
    await extensions.close();
    for (let i = 0; i < 20 && !(await scriptsOn()); i++) await pause(250);
    if (!(await scriptsOn())) throw new Error('Could not turn on "Allow User Scripts" for Alter.');
  }
  await control.evaluate(
    async ({ key, model }) => {
      // Where the panel keeps the key (src/lib/secrets.ts, through idb-keyval).
      await new Promise((resolve, reject) => {
        const open = indexedDB.open('alter-secrets');
        open.onupgradeneeded = () => open.result.createObjectStore('secrets');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('secrets', 'readwrite');
          tx.objectStore('secrets').put(key, 'anthropic-api-key');
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        };
      });
      const { settings = {} } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, provider: 'anthropic', model, monthlyLimit: null, paused: false } });
      // Start from nothing saved, so earlier runs can't affect this one.
      const all = await chrome.storage.local.get(null);
      await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('patches:')));
    },
    { key: process.env.ANTHROPIC_API_KEY, model },
  );
  return { cdp, context, id, control };
}

const PANEL_WIDTH = 400;
/**
 * Where each case's windows go: the site on the left, its panel on the right, every
 * window fully on screen (Chrome refuses windows that are mostly off screen). Cases
 * running at once are offset a little so each stays visible enough to render.
 */
async function windowLayout(control, concurrency) {
  const screen = await control.evaluate(() => ({ left: window.screen.availLeft, top: window.screen.availTop, width: window.screen.availWidth, height: window.screen.availHeight }));
  const step = 30;
  const spread = (concurrency - 1) * step;
  const width = Math.min(1280, screen.width - PANEL_WIDTH - spread);
  const height = Math.min(900, screen.height - spread);
  return {
    site: (slot) => ({ left: screen.left + slot * step, top: screen.top + slot * step, width, height }),
    panel: (slot) => ({ left: screen.left + width + slot * step, top: screen.top + slot * step, width: PANEL_WIDTH, height }),
  };
}

/** Downloads (from one-time actions) land in the run's folder, so they can be graded. */
function watchDownloads(cdp, folder) {
  const downloads = new Map();
  void cdp.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: folder, eventsEnabled: true });
  cdp.on('Browser.downloadWillBegin', (event) => downloads.set(event.guid, { name: event.suggestedFilename, done: false }));
  cdp.on('Browser.downloadProgress', (event) => {
    const download = downloads.get(event.guid);
    if (download && event.state === 'completed') download.done = true;
  });
  return (since = new Set()) =>
    [...downloads.entries()]
      .filter(([guid, d]) => d.done && !since.has(guid))
      .map(([guid, d]) => {
        const file = path.join(folder, guid);
        return { guid, name: d.name, preview: existsSync(file) ? readFileSync(file, 'utf8').slice(0, 1500) : '' };
      });
}

/**
 * The page as a user sees it: the top, then after scrolling down most of a screen with the
 * mouse wheel (which scrolls a full-page view like the recipe view, not the page under it).
 * Scrolls back to the top afterwards. Returns the files' names.
 */
async function snap(page, file) {
  const files = [file, file.replace(/\.png$/, '-scrolled.png')];
  await page.screenshot({ path: files[0], scale: 'css' });
  const { width, height } = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const distance = Math.round(height * 0.8);
  await page.mouse.move(width / 2, height / 2);
  await page.mouse.wheel(0, distance);
  await pause(700);
  await page.screenshot({ path: files[1], scale: 'css' });
  await page.mouse.wheel(0, -distance);
  await page.evaluate(() => window.scrollTo(0, 0));
  await pause(300);
  return files.map((f) => path.basename(f));
}

function summarizeVisual(report) {
  if (!report) return 'not available';
  if (!report.checked) return 'nothing was measured';
  const parts = [];
  if (report.contrast?.length) parts.push(`${report.contrastElements} elements below readable contrast`);
  if (report.lost?.length) parts.push(`${report.lostElements} elements with text that was readable and no longer is`);
  if (report.leftBehind?.length) parts.push(`${report.leftBehind.length} large areas kept the old light or dark look`);
  if (report.horizontalOverflow) parts.push('the page now scrolls sideways');
  if (report.clipped?.length) parts.push(`${report.clipped.length} elements newly cut off`);
  return parts.length ? parts.join('; ') : `clean (${report.checked} text elements on screen)`;
}

/** What a case records, before anything has happened. */
function emptyResult(testCase) {
  return {
    id: testCase.id,
    run: testCase.run,
    /** Names this run's files (screenshots, transcript): the case id, plus the run number when repeating. */
    file: testCase.key,
    request: testCase.request,
    url: testCase.url,
    expect: testCase.expect,
    asked: false,
    outcome: 'error',
    error: null,
    reply: '',
    visual: null,
    visualSummary: 'not available',
    scriptErrors: [],
    downloads: [],
    cost: 0,
    modelCalls: 0,
    toolCalls: {},
    screenshots: {},
    durationMs: 0,
    verdict: null,
  };
}

async function runCase(testCase, env) {
  const { context, control, folder, downloadsSince, slot, layout } = env;
  const hostname = new URL(testCase.url).hostname;
  const shot = (name) => path.join(folder, `${testCase.key}-${name}.png`);
  const started = Date.now();
  const result = emptyResult(testCase);
  let site = null;
  let panel = null;

  let downloadsBefore;
  try {
    downloadsBefore = new Set(downloadsSince().map((d) => d.guid));
    // A window of its own, so it is visible (and screenshots work) while other cases run.
    const marker = `about:blank#${testCase.key}`;
    const opened = context.waitForEvent('page', { predicate: (p) => p.url() === marker, timeout: 15_000 });
    opened.catch(() => undefined);
    const tabId = await control.evaluate(
      async ({ url, bounds }) => (await chrome.windows.create({ url, ...bounds, focused: true })).tabs[0].id,
      { url: marker, bounds: layout.site(slot) },
    );
    site = await opened;
    const colorScheme = testCase.colorScheme ?? 'light';
    await site.emulateMedia({ colorScheme });
    // Some sites (Google) choose their theme on the server, from this header, which Chrome fills in from the computer's setting.
    await site.route('**/*', (route) =>
      route.request().resourceType() === 'document'
        ? route.continue({ headers: { ...route.request().headers(), 'sec-ch-prefers-color-scheme': colorScheme } })
        : route.fallback(),
    );
    await site.goto(testCase.url, { waitUntil: 'load', timeout: 45_000 }).catch((error) => {
      // Busy pages sometimes never fire load; what is on screen is still worth testing.
      if (!/Timeout/.test(error.message)) throw error;
    });
    await pause(SETTLE_MS);
    result.screenshots.before = await snap(site, shot('before'));

    const panelOpened = context.waitForEvent('page', { predicate: (p) => p.url().includes(`panel.html?tabId=${tabId}`), timeout: 15_000 });
    panelOpened.catch(() => undefined);
    await control.evaluate(
      ({ tabId, bounds }) => chrome.windows.create({ url: `panel.html?tabId=${tabId}`, type: 'popup', ...bounds }),
      { tabId, bounds: layout.panel(slot) },
    );
    panel = await panelOpened;
    const box = panel.getByLabel('Describe a change');
    await box.waitFor({ timeout: 15_000 });
    await box.fill(testCase.request);
    await box.press('Enter');
    result.asked = true;

    // What the panel keeps in session storage: { conversation, agent } (src/entrypoints/panel/conversations.ts).
    const stored = () => control.evaluate(async (key) => (await chrome.storage.session.get(key))[key] ?? null, `conversation:${tabId}`);
    const deadline = Date.now() + CASE_TIMEOUT_MS;
    let saved = null;
    let state = null;
    for (;;) {
      if (Date.now() > deadline) {
        const keys = await control.evaluate(async () => Object.keys(await chrome.storage.session.get(null)));
        throw new Error(`Still working after ${CASE_TIMEOUT_MS / 60_000} minutes (tab ${tabId}; session has ${keys.join(', ')}; running ${state?.running})`);
      }
      if (await panel.getByText('Turn on scripts for Alter').isVisible()) throw new Error('Scripts are off for Alter in the eval browser');
      // Approve what Alter asks to run, as a user who wants the change would.
      const approve = panel.getByRole('button', { name: /^(Run preview|Run once)$/ });
      if (await approve.first().isEnabled().catch(() => false)) await approve.first().click().catch(() => undefined);
      saved = await stored();
      state = saved?.conversation ?? null;
      // Done once Alter has answered and stopped working (the stored running flag can lag behind).
      const answered = state?.items.some((item) => item.kind === 'assistant' || item.kind === 'error');
      if (answered && !state.running) break;
      await pause(700);
    }

    const items = state.items;
    const replies = items.filter((item) => item.kind === 'assistant' || item.kind === 'error');
    const last = replies[replies.length - 1];
    result.reply = last?.text ?? '';
    result.cost = replies.reduce((sum, item) => sum + (item.usage?.cost ?? 0), 0);
    const transcript = saved.agent?.session ?? [];
    for (const message of transcript) {
      if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;
      result.modelCalls++;
      for (const block of message.content) if (block.type === 'tool_use') result.toolCalls[block.name] = (result.toolCalls[block.name] ?? 0) + 1;
    }
    writeFileSync(path.join(folder, `${testCase.key}-transcript.json`), JSON.stringify(saved, null, 2));

    const proposals = Object.values(state.proposals);
    const previewed = state.previewId ? state.proposals[state.previewId] : null;
    if (last?.kind === 'error') {
      result.outcome = 'error';
      result.error = last.text;
    } else if (previewed?.kind === 'change') {
      result.outcome = 'saved';
    } else if (proposals.some((p) => p.kind === 'action' && p.state === 'ran')) {
      result.outcome = 'action';
    } else {
      result.outcome = 'no change';
    }

    // Wait for downloads from actions to finish.
    if (result.outcome === 'action') await pause(1500);
    // Only one-time actions save files, and no two of them run at once (see runAll), so these are this case's.
    if (result.outcome === 'action') result.downloads = downloadsSince(downloadsBefore).map(({ name, preview }) => ({ name, preview }));

    if (result.outcome === 'saved') {
      const envelope = await control.evaluate((tabId) => chrome.tabs.sendMessage(tabId, { type: 'alter:visualCheck' }), tabId).catch(() => null);
      result.visual = envelope?.ok ? envelope.value : null;
      result.visualSummary = summarizeVisual(result.visual);
      result.screenshots.preview = await snap(site, shot('preview'));

      await panel.getByRole('button', { name: `Save for ${hostname}` }).click();
      await panel.getByTestId('saved-row').first().waitFor({ timeout: 10_000 });
      await site.reload({ waitUntil: 'load', timeout: 45_000 }).catch((error) => {
        if (!/Timeout/.test(error.message)) throw error;
      });
      await pause(SETTLE_MS + 1000);
      result.screenshots.after = await snap(site, shot('after'));
      // The saved list shows each change's health on this page, including script errors.
      const panelText = await panel.locator('body').innerText();
      result.scriptErrors = [...panelText.matchAll(/Script error: ([^\n]+)/g)].map((m) => m[1]);
    } else {
      result.screenshots.after = await snap(site, shot('after'));
    }
  } catch (error) {
    result.outcome = 'error';
    result.error = error instanceof Error ? error.message.split('\n')[0] : String(error);
  } finally {
    result.durationMs = Date.now() - started;
    if (panel) await panel.screenshot({ path: shot('panel') }).catch(() => undefined);
    if (existsSync(shot('panel'))) result.screenshots.panel = [path.basename(shot('panel'))];
    await panel?.close().catch(() => undefined);
    await site?.close().catch(() => undefined);
    await control
      .evaluate((key) => chrome.storage.local.remove(key), `patches:${hostname}`)
      .catch(() => undefined);
  }

  // Grade only what Alter did; when the eval itself failed before asking, there is nothing to grade.
  if (result.asked && result.screenshots.before) {
    try {
      const read = (name) => (result.screenshots[name] ? result.screenshots[name].map((file) => readFileSync(path.join(folder, file))) : null);
      const saved = result.outcome === 'saved';
      result.verdict = await judge({
        testCase,
        before: read('before'),
        preview: saved ? read('preview') : null,
        after: read('after'),
        result,
      });
    } catch (error) {
      result.judgeError = error instanceof Error ? error.message : String(error);
    }
  }
  result.pass = passed(testCase, result);
  return result;
}

/** A case passes when the outcome is the expected kind, nothing errored, and the judge is happy. */
function passed(testCase, result) {
  const expected = { change: 'saved', action: 'action', decline: 'no change' }[testCase.expect];
  return result.outcome === expected && result.scriptErrors.length === 0 && result.verdict?.pass === true;
}

/** What a case needs to itself while it runs: its site (saved changes are per site), and the downloads folder for actions. */
const claims = (testCase) => [new URL(testCase.url).hostname, ...(testCase.expect === 'action' ? ['downloads'] : [])];

/** Run cases a few at a time, never two that claim the same thing at once. */
async function runAll(selected, concurrency, env) {
  const queue = [...selected];
  const busy = new Set();
  const results = [];
  const freeSlots = Array.from({ length: concurrency }, (_, i) => i);
  await new Promise((resolve) => {
    let running = 0;
    const next = () => {
      if (!queue.length && !running) return resolve();
      while (running < concurrency) {
        const index = queue.findIndex((c) => !claims(c).some((claim) => busy.has(claim)));
        if (index === -1) return;
        const [testCase] = queue.splice(index, 1);
        const slot = freeSlots.shift();
        for (const claim of claims(testCase)) busy.add(claim);
        running++;
        console.log(`▶ ${testCase.key}: "${testCase.request}"`);
        // A bug in the runner fails the case rather than the whole run (and leaves no Chrome behind).
        const run = runCase(testCase, { ...env, slot }).catch((error) => ({
          ...emptyResult(testCase),
          error: `The eval itself failed: ${error instanceof Error ? error.message : String(error)}`,
          pass: false,
        }));
        void run.then((result) => {
          results.push(result);
          printLine(result);
          for (const claim of claims(testCase)) busy.delete(claim);
          freeSlots.push(slot);
          running--;
          next();
        });
      }
    };
    next();
  });
  const order = new Map(selected.map((c, i) => [c.key, i]));
  return results.sort((a, b) => order.get(a.file) - order.get(b.file));
}

function printLine(result) {
  const v = result.verdict;
  const scores = v ? ` asked ${v.did_what_was_asked} looks ${v.looks_good} intact ${v.nothing_broken} honest ${v.reply_honest}` : '';
  console.log(
    `${result.pass ? '✓' : '✗'} ${result.file}: ${result.outcome}${scores}, $${result.cost.toFixed(2)}, ${Math.round(result.durationMs / 1000)}s` +
      (result.error ? `\n    error: ${result.error}` : '') +
      (result.judgeError ? `\n    judge error: ${result.judgeError}` : '') +
      (v && !result.pass ? `\n    ${v.summary}` : ''),
  );
}

/** For each case, the share of its runs that passed. */
export function passRates(results) {
  const counts = new Map();
  for (const r of results) {
    const c = counts.get(r.id) ?? { passed: 0, runs: 0 };
    c.runs++;
    if (r.pass) c.passed++;
    counts.set(r.id, c);
  }
  return new Map([...counts].map(([id, c]) => [id, c.passed / c.runs]));
}

function previousRun() {
  if (!existsSync(RESULTS)) return null;
  const runs = readdirSync(RESULTS)
    .filter((name) => existsSync(path.join(RESULTS, name, 'results.json')))
    .sort();
  const latest = runs[runs.length - 1];
  return latest ? { name: latest, ...JSON.parse(readFileSync(path.join(RESULTS, latest, 'results.json'), 'utf8')) } : null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.login) return login();
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Put ANTHROPIC_API_KEY in .env.local first.');
  if (!existsSync(EXTENSION)) throw new Error('Build first: npm run eval builds it (or ALTER_EVAL=1 npx wxt build).');

  // Each case once, or several times with numbered runs.
  const selected = selectCases(options.patterns, options.skip).flatMap((c) =>
    Array.from({ length: options.repeat }, (_, i) => ({ ...c, run: i + 1, key: options.repeat > 1 ? `${c.id}-${i + 1}` : c.id })),
  );
  const previous = previousRun();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const folder = path.join(RESULTS, stamp);
  mkdirSync(path.join(folder, 'downloads'), { recursive: true });

  const { chrome, exited } = await launchChrome();
  const browser = await connect();
  const quit = async () => {
    // Ask Chrome to close (a plain kill can leave it running, holding the profile), then make sure.
    await browser.newBrowserCDPSession().then((session) => session.send('Browser.close')).catch(() => undefined);
    if (!(await Promise.race([exited.then(() => true), pause(5000).then(() => false)]))) chrome.kill('SIGKILL');
  };
  const started = Date.now();
  let results;
  try {
    const { cdp, context, id, control } = await setUp(browser, MODELS[options.model]);
    const downloadsSince = watchDownloads(cdp, path.join(folder, 'downloads'));
    console.log(`Running ${selected.length} case${selected.length === 1 ? '' : 's'} with ${options.model}, ${options.concurrency} at a time.\n`);
    const layout = await windowLayout(control, options.concurrency);
    results = await runAll(selected, options.concurrency, { context, control, id, folder, downloadsSince, layout });
  } finally {
    await quit();
  }

  const run = {
    model: MODELS[options.model],
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    cost: results.reduce((sum, r) => sum + r.cost + (r.verdict?.cost ?? 0), 0),
    passed: results.filter((r) => r.pass).length,
    total: results.length,
    results,
  };
  writeFileSync(path.join(folder, 'results.json'), JSON.stringify(run, null, 2));
  const report = writeReport(folder, run, previous);

  console.log(`\n${run.passed}/${run.total} passed, $${run.cost.toFixed(2)} (Alter and judge), ${Math.round(run.durationMs / 60_000)} min.`);
  if (previous) {
    const before = passRates(previous.results);
    for (const [id, now] of passRates(results)) {
      const was = before.get(id);
      if (was !== undefined && was !== now) console.log(`  ${id}: passed ${Math.round(was * 100)}% of runs before, ${Math.round(now * 100)}% now`);
    }
  }
  console.log(`Report: ${report}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
