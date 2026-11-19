// Checks Alter's floating panel in an installed Google Chrome (throwaway profile),
// as a set-up user would see it (API key saved), on a local page with a strict
// Content Security Policy like GitHub's:
// the icon opens the panel over the page without moving the layout, the message box
// is ready to type into, it can screenshot the page for selected areas, minimize and the
// pill work, the permission prompt can open from inside the panel, the icon closes it
// again, and other tabs are unaffected.
//
// Usage: npm run build && npm run verify:widget   (CHROME_PATH overrides the browser)
import http from 'node:http';
import path from 'node:path';
import { checker, launchChrome, pause, waitFor } from './lib/chrome.mjs';

const extension = path.resolve(process.env.ALTER_BUILD ?? '.output/chrome-mv3');
const { check, fail, exitCode } = checker();

const PAGE = `<!doctype html><title>Strict site</title>
<style>body { margin: 0; font: 16px system-ui } main { max-width: 900px; margin: 0 auto; padding: 24px }</style>
<main><h1>Strict site</h1><p>${'Content. '.repeat(200)}</p></main>`;
const server = http
  .createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.setHeader('content-security-policy', "default-src 'self'; frame-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'");
    res.end(PAGE);
  })
  .listen(8790);
const chrome = await launchChrome(9344);

try {
  const { id } = await chrome.send('Extensions.loadUnpacked', { path: extension });
  // Set up like a user who has saved their API key, so the panel opens straight to the message box.
  const { targetId: setupTarget } = await chrome.send('Target.createTarget', { url: `chrome-extension://${id}/panel.html` });
  const setup = await chrome.attach(setupTarget);
  await waitFor(() => chrome.evaluate(setup, "typeof indexedDB !== 'undefined'"), true);
  await chrome.evaluate(
    setup,
    `new Promise((resolve) => { const open = indexedDB.open('alter-secrets'); open.onupgradeneeded = () => open.result.createObjectStore('secrets'); open.onsuccess = () => { const tx = open.result.transaction('secrets', 'readwrite'); tx.objectStore('secrets').put('sk-ant-test', 'anthropic-api-key'); tx.oncomplete = () => resolve(true); }; })`,
  );
  await chrome.send('Target.closeTarget', { targetId: setupTarget });

  const { targetId: pageA } = await chrome.send('Target.createTarget', { url: 'http://127.0.0.1:8790/a' });
  const { targetId: pageB } = await chrome.send('Target.createTarget', { url: 'http://127.0.0.1:8790/b' });
  let tabA = null;
  await waitFor(async () => Boolean((tabA = (await chrome.targets()).find((t) => t.type === 'tab' && t.url.endsWith('/a') && t.title)?.targetId)), true);
  await chrome.send('Target.activateTarget', { targetId: pageA });
  const page = await chrome.attach(pageA);
  const layout = () => chrome.evaluate(page, "JSON.stringify([document.documentElement.clientWidth, document.querySelector('main').getBoundingClientRect().left])");
  const before = await layout();

  const panelFrames = async () => (await chrome.targets()).filter((t) => t.type === 'iframe' && t.url.includes('/panel.html'));
  await chrome.send('Extensions.triggerAction', { id, targetId: tabA });
  check('clicking the icon opens the panel on the page', await waitFor(async () => (await panelFrames()).length, 1), 1);
  check('the page layout does not move', await layout(), before);

  const frame = await chrome.attach((await panelFrames())[0].targetId);
  const evaluate = (expression, options = {}) =>
    chrome.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, ...options }, frame).then((r) => r.result.value);
  check('the panel loads under a strict Content Security Policy', await waitFor(() => evaluate("Boolean(document.querySelector('.app .header'))"), true), true);
  const ready = () =>
    evaluate(`document.hasFocus() && document.activeElement?.getAttribute('aria-label') === 'Describe a change' ? 'ready' : 'focus: ' + (document.hasFocus() ? document.activeElement?.tagName : 'elsewhere')`);
  check('the message box is ready to type into', await waitFor(ready, 'ready'), 'ready');

  // Opening Alter from the icon lets it screenshot the page (activeTab), for selected areas.
  const capture = () =>
    evaluate(`(async () => {
      const tab = await chrome.tabs.get(Number(new URLSearchParams(location.search).get('tabId')));
      return chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }).then((url) => url.startsWith('data:image/png') ? 'captured' : 'no image', (e) => 'error: ' + e.message);
    })()`);
  check('after opening from the icon, the panel can screenshot the page', await capture(), 'captured');
  await chrome.evaluate(page, "history.pushState({}, '', '/a/next')");
  await pause(300);
  check('still after in-page navigation', await capture(), 'captured');

  // Host permission is asked for inside the panel, on the user's click.
  const prompt = await evaluate(
    `Promise.race([
      chrome.permissions.request({ origins: ['*://127.0.0.1/*'] }).then((granted) => 'answered: ' + granted, (error) => 'error: ' + error.message),
      new Promise((resolve) => setTimeout(() => resolve('prompt shown'), 1500)),
    ])`,
    { userGesture: true },
  );
  check('the site access prompt can open from the panel', prompt, 'prompt shown');
  // Dismiss the prompt the way a user would, so it doesn't sit over the window.
  await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, frame);

  await evaluate("document.querySelector('[aria-label=\"Minimize\"]').click()");
  // The panel's card is hidden and the pill shown (both in the page's closed shadow root).
  const pillVisible = () =>
    chrome.send('DOM.getDocument', { depth: -1, pierce: true }, page).then(({ root }) => {
      const find = (node) =>
        node.nodeName === 'BUTTON' && (node.attributes ?? []).join(' ').includes('pill') && !(node.attributes ?? []).join(' ').includes('hidden')
          ? node
          : [...(node.shadowRoots ?? []), ...(node.children ?? [])].map(find).find(Boolean) ?? null;
      return find(root);
    });
  const pill = await waitFor(async () => Boolean(await pillVisible()), true);
  check('minimizing shrinks the panel to a button', pill, true);
  const { model } = await chrome.send('DOM.getBoxModel', { nodeId: (await pillVisible()).nodeId }, page);
  const [x1, y1, , , x3, y3] = model.content;
  for (const type of ['mousePressed', 'mouseReleased']) {
    await chrome.send('Input.dispatchMouseEvent', { type, x: (x1 + x3) / 2, y: (y1 + y3) / 2, button: 'left', clickCount: 1 }, page);
  }
  check('the button opens it again, ready to type', await waitFor(ready, 'ready'), 'ready');

  await chrome.send('Target.activateTarget', { targetId: pageB });
  await pause(500);
  check('other tabs have no panel', (await panelFrames()).length, 1);
  await chrome.send('Target.activateTarget', { targetId: pageA });
  await pause(300);
  await chrome.send('Extensions.triggerAction', { id, targetId: tabA });
  check('clicking the icon again closes it', await waitFor(async () => (await panelFrames()).length, 0), 0);
} catch (error) {
  fail(error.message);
} finally {
  await chrome.close();
  server.close();
}
process.exit(exitCode());
