// Checks in an installed Google Chrome that saved changes keep working, and can
// still be turned off, on pages that stay open while Alter is reloaded or updated.
// Before this was handled, the old copy of Alter's page code kept its styles on the
// page and nothing could remove them. Chrome for Testing closes on extension
// reloads under automation, so this uses the installed Chrome.
//
// Usage: ALTER_E2E=1 npx wxt build && npm run verify:reload
//   (the E2E build has host access pre-granted; CHROME_PATH overrides the browser)
import path from 'node:path';
import { checker, launchChrome, pause, waitFor } from './lib/chrome.mjs';

const extension = path.resolve(process.env.ALTER_BUILD ?? '.output-e2e/chrome-mv3');
const { check, fail, exitCode } = checker();
const chrome = await launchChrome(9342);
const saved = (enabled) => ({
  id: 'p1',
  hostname: 'example.com',
  title: 'Yellow',
  summary: '',
  intent: 'yellow',
  css: 'body { background: rgb(255, 240, 150) !important; }',
  darkMode: { enabled: false, brightness: 100, contrast: 100, sepia: 0 },
  js: '',
  enabled,
  model: 'm',
  createdAt: 0,
});

try {
  const { id } = await chrome.send('Extensions.loadUnpacked', { path: extension });
  // Any extension page can write storage, the way the panel's Save and toggle do.
  const openAlterPage = async () => {
    const { targetId } = await chrome.send('Target.createTarget', { url: `chrome-extension://${id}/panel.html` });
    const session = await chrome.attach(targetId);
    await waitFor(() => chrome.evaluate(session, "typeof chrome !== 'undefined' && Boolean(chrome.storage)"), true);
    return session;
  };
  const setSaved = (session, enabled) =>
    chrome.evaluate(session, `chrome.storage.local.set({ 'patches:example.com': [${JSON.stringify(saved(enabled))}] })`);

  const alterPage = await openAlterPage();
  await setSaved(alterPage, true);
  // Saving registers the page code for example.com in the background; wait for that before loading the page.
  const registered = () =>
    chrome.evaluate(
      alterPage,
      "chrome.scripting.getRegisteredContentScripts({ ids: ['alter-saved-patches'] }).then((scripts) => scripts.some((s) => s.matches.some((m) => m.includes('example.com'))))",
    );
  await waitFor(registered, true);
  const { targetId } = await chrome.send('Target.createTarget', { url: 'https://example.com/' });
  const page = await chrome.attach(targetId);
  const background = () => chrome.evaluate(page, 'document.body ? getComputedStyle(document.body).backgroundColor : null');
  const layers = () => chrome.evaluate(page, "document.querySelectorAll('style.alter-style').length");
  const yellow = 'rgb(255, 240, 150)';
  check('the saved change applies', await waitFor(background, yellow), yellow);

  // Load the same folder again: what the reload button in chrome://extensions does.
  const reloaded = await chrome.send('Extensions.loadUnpacked', { path: extension });
  check('the extension reloads with the same id', reloaded.id, id);
  // Give the old copy time to notice it was cut off and the new one time to take over.
  await pause(3000);
  check('after the reload the change is still on the page', await waitFor(background, yellow), yellow);
  check('with exactly one copy of its styles', await waitFor(layers, 1), 1);

  const alter = await openAlterPage();
  await setSaved(alter, false);
  check('turning it off removes it', await waitFor(layers, 0), 0);
  await setSaved(alter, true);
  check('turning it back on restores it', await waitFor(background, yellow), yellow);
} catch (error) {
  fail(error.message);
} finally {
  await chrome.close();
}
process.exit(exitCode());
