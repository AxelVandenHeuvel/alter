import { ask, expect, test, waitForIdle } from './fixtures';

const promoDisplay = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid="promo"]').evaluate((el) => getComputedStyle(el).display);

test('shows the empty state for the current site', async ({ panel }) => {
  await expect(panel.getByRole('heading', { name: 'What should alter.test look like?' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Create a dark mode' })).toBeVisible();
});

test('previews, saves, persists across reloads, toggles, and deletes a change', async ({ panel, site, serviceWorker }) => {
  await ask(panel, 'hide promo');

  const card = panel.getByTestId('proposal-card');
  await expect(card).toContainText('Previewing');
  await expect(card).toContainText('Hide promo');
  await expect.poll(() => promoDisplay(site)).toBe('none');

  await card.getByRole('button', { name: 'Save for alter.test' }).click();
  await expect(card).toContainText('Saved');
  await expect(panel.getByTestId('saved-row')).toHaveCount(1);

  // Saved changes are registered to run at document_start on future visits.
  const registered = () =>
    serviceWorker.evaluate(async () => Object.fromEntries((await chrome.scripting.getRegisteredContentScripts()).map((s) => [s.id, s.matches])));
  await expect.poll(registered).toEqual({
    'alter-saved-patches': ['*://alter.test/*'],
    // The site's data is kept from the start of each load wherever Alter has access (everywhere in test builds).
    'alter-page-data': ['<all_urls>'],
  });
  await site.reload();
  await expect.poll(() => promoDisplay(site)).toBe('none');

  await panel.getByRole('switch', { name: 'Turn off Hide promo' }).click();
  await expect.poll(() => promoDisplay(site)).toBe('block');
  await panel.getByRole('switch', { name: 'Turn on Hide promo' }).click();
  await expect.poll(() => promoDisplay(site)).toBe('none');

  await panel.getByTestId('saved-row').getByRole('button', { name: 'Hide promo' }).click();
  await panel.getByRole('button', { name: 'Delete' }).click();
  await expect(panel.getByTestId('saved-row')).toHaveCount(0);
  await expect.poll(() => promoDisplay(site)).toBe('block');
  // Nothing runs early on the site anymore, apart from keeping its data (which follows site access, not saved changes).
  await expect.poll(registered).toEqual({ 'alter-page-data': ['<all_urls>'] });
});

test('a preview shows its title and decisions, with the details collapsed until asked for', async ({ panel }) => {
  await ask(panel, 'hide promo');
  const card = panel.getByTestId('proposal-card');
  await expect(card).toContainText('Previewing');
  const toggle = card.getByRole('button', { name: 'Hide promo' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(card).not.toContainText('Hid the promo section.');
  await expect(card.getByTestId('health')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Hold to compare' })).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(card).toContainText('Hid the promo section.');
  // A preview that works needs no status line, open or closed.
  await expect(card.getByTestId('health')).toHaveCount(0);
  await card.getByRole('button', { name: '1 line of CSS' }).click();
  await expect(card.locator('.code')).toContainText('display: none');

  await toggle.click();
  await expect(card.getByTestId('health')).toHaveCount(0);
});

test('discarding a preview restores the page', async ({ panel, site }) => {
  await ask(panel, 'hide promo');
  await expect.poll(() => promoDisplay(site)).toBe('none');
  await panel.getByRole('button', { name: 'Discard' }).click();
  await expect(panel.getByTestId('proposal-card')).toContainText('Discarded');
  await expect.poll(() => promoDisplay(site)).toBe('block');
});

test('dark mode runs the dark engine on the page', async ({ panel, site }) => {
  await panel.getByRole('button', { name: 'Create a dark mode' }).click();
  await expect
    .poll(() =>
      site.evaluate(() => {
        const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\d+/g)!.map(Number);
        return r! + g! + b!;
      }),
    )
    .toBeLessThan(150);
});

test('unsafe CSS is rejected and never reaches the page', async ({ panel, site }) => {
  await ask(panel, 'use a remote font');
  await expect(panel.getByText("I couldn't do that safely")).toBeVisible();
  await expect(panel.getByTestId('proposal-card')).toHaveCount(0);
  expect(await site.locator('style.alter-style').count()).toBe(0);
});

test('closing and reopening Alter keeps the conversation and its preview', async ({ panel, site, openPanel }) => {
  await ask(panel, 'hide promo');
  await waitForIdle(panel);
  await panel.close();
  // The unsaved preview stays on the page while Alter is closed.
  await site.waitForTimeout(500);
  expect(await promoDisplay(site)).toBe('none');

  const reopened = await openPanel();
  await expect(reopened.locator('.bubble.user')).toHaveText('hide promo');
  const card = reopened.getByTestId('proposal-card');
  await expect(card).toContainText('Previewing');
  await card.getByRole('button', { name: 'Save for alter.test' }).click();
  await expect(reopened.getByTestId('saved-row')).toHaveCount(1);
});

test('reloading the page ends the conversation and its preview, even with Alter closed', async ({ panel, site, openPanel }) => {
  await ask(panel, 'hide promo');
  await waitForIdle(panel);
  await panel.close();
  await site.reload();
  await expect.poll(() => promoDisplay(site)).toBe('block');

  const reopened = await openPanel();
  await expect(reopened.getByRole('heading', { name: 'What should alter.test look like?' })).toBeVisible();
});

test('in-page navigation keeps the conversation', async ({ panel, site }) => {
  await ask(panel, 'hide promo');
  await waitForIdle(panel);
  // Single-page apps change the URL without loading a new page.
  await site.evaluate(() => history.pushState({}, '', '/next-page'));
  await site.waitForTimeout(500);
  await expect(panel.getByTestId('proposal-card')).toContainText('Previewing');
  expect(await promoDisplay(site)).toBe('none');
});

test('a new change in the same conversation keeps earlier saved changes', async ({ panel, site }) => {
  await ask(panel, 'hide promo');
  await waitForIdle(panel);
  await panel.getByRole('button', { name: 'Save for alter.test' }).click();
  await expect(panel.getByTestId('saved-row')).toHaveCount(1);

  await ask(panel, 'now a dark mode');
  await expect(panel.getByTestId('proposal-card').nth(1)).toContainText('Previewing');
  expect(await promoDisplay(site)).toBe('none');

  await panel.getByRole('button', { name: 'Save for alter.test' }).click();
  await expect(panel.getByTestId('saved-row')).toHaveCount(2);
  expect(await promoDisplay(site)).toBe('none');
});

test('dark mode never injects scripts into the page, even on strict sites', async ({ context, panel, site }) => {
  await context.route('https://strict.test/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      headers: { 'content-security-policy': "script-src 'self'" },
      body: '<!doctype html><title>Strict</title><body style="background:#fff;color:#111"><h1>Strict site</h1><p>Like Gmail.</p></body>',
    }),
  );
  const violations: string[] = [];
  site.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) violations.push(message.text());
  });
  await site.goto('https://strict.test/');
  await expect(panel.getByRole('heading', { name: 'What should strict.test look like?' })).toBeVisible();

  await ask(panel, 'create a dark mode');
  await expect
    .poll(() => site.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .not.toBe('rgb(255, 255, 255)');
  await site.waitForTimeout(500);
  expect(violations).toEqual([]);
});

test('"Alter" is in the right-click menu after install', async ({ serviceWorker }) => {
  // There is no API to list menu items, but updating one that doesn't exist fails.
  await expect
    .poll(() =>
      serviceWorker.evaluate(() =>
        chrome.contextMenus.update('open-alter', { title: 'Alter' }).then(
          () => 'registered',
          (error: Error) => error.message,
        ),
      ),
    )
    .toBe('registered');
});

test('a second copy of the page code takes over cleanly', async ({ panel, site, serviceWorker }) => {
  await ask(panel, 'hide promo');
  await waitForIdle(panel);
  await panel.getByRole('button', { name: 'Save for alter.test' }).click();
  await expect(panel.getByTestId('saved-row')).toHaveCount(1);

  // Load Alter's page code into the page again, as happens after an extension update.
  const tabId = await serviceWorker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]!.id!, site.url());
  await serviceWorker.evaluate((tabId) => chrome.scripting.executeScript({ target: { tabId }, files: ['/content-scripts/page.js'] }), tabId);
  await expect.poll(() => site.locator('style.alter-style').count()).toBe(1);
  await expect.poll(() => promoDisplay(site)).toBe('none');

  // The new copy is the one in control: turning the change off removes it.
  await panel.getByRole('switch', { name: 'Turn off Hide promo' }).click();
  await expect.poll(() => promoDisplay(site)).toBe('block');
  expect(await site.locator('style.alter-style').count()).toBe(0);
});

test('holding "compare" shows the page as it was before the preview', async ({ panel, site }) => {
  await ask(panel, 'hide promo');
  await expect.poll(() => promoDisplay(site)).toBe('none');

  const compare = panel.getByRole('button', { name: 'Hold to compare' });
  await compare.hover();
  await panel.mouse.down();
  await expect.poll(() => promoDisplay(site)).toBe('block');
  await expect(panel.getByRole('button', { name: 'Showing before' })).toBeVisible();
  await panel.mouse.up();
  await expect.poll(() => promoDisplay(site)).toBe('none');

  // The keyboard works too: hold Space.
  await compare.focus();
  await panel.keyboard.down(' ');
  await expect.poll(() => promoDisplay(site)).toBe('block');
  await panel.keyboard.up(' ');
  await expect.poll(() => promoDisplay(site)).toBe('none');
});

test('a deleted change can be brought back with Undo', async ({ panel, site }) => {
  await ask(panel, 'hide promo');
  await waitForIdle(panel);
  await panel.getByRole('button', { name: 'Save for alter.test' }).click();
  await panel.getByTestId('saved-row').getByRole('button', { name: 'Hide promo' }).click();
  await panel.getByRole('button', { name: 'Delete' }).click();
  await expect(panel.getByTestId('saved-row')).toHaveCount(0);
  await expect.poll(() => promoDisplay(site)).toBe('block');

  await expect(panel.getByRole('status')).toContainText('Deleted “Hide promo”');
  await panel.getByRole('button', { name: 'Undo' }).click();
  await expect(panel.getByTestId('saved-row')).toHaveCount(1);
  await expect.poll(() => promoDisplay(site)).toBe('none');
});

test('the up arrow brings back the last message', async ({ panel }) => {
  await ask(panel, 'hide promo');
  await waitForIdle(panel);
  const box = panel.getByLabel('Describe a change');
  await box.press('ArrowUp');
  await expect(box).toHaveValue('hide promo');
});

test('the toolbar icon shows how many saved changes are on for the site', async ({ panel, site, serviceWorker }) => {
  const badge = () =>
    serviceWorker.evaluate(async (url) => chrome.action.getBadgeText({ tabId: (await chrome.tabs.query({ url }))[0]!.id! }), site.url());
  expect(await badge()).toBe('');

  await ask(panel, 'hide promo');
  await waitForIdle(panel);
  await panel.getByRole('button', { name: 'Save for alter.test' }).click();
  await expect.poll(badge).toBe('1');

  await panel.getByRole('switch', { name: 'Turn off Hide promo' }).click();
  await expect.poll(badge).toBe('');
  await panel.getByRole('switch', { name: 'Turn on Hide promo' }).click();
  await expect.poll(badge).toBe('1');
  // Still there after the page reloads.
  await site.reload();
  await expect.poll(badge).toBe('1');
});

test('settings list every site with saved changes, and can clear one', async ({ panel, site }) => {
  await ask(panel, 'hide promo');
  await waitForIdle(panel);
  await panel.getByRole('button', { name: 'Save for alter.test' }).click();

  await panel.getByRole('button', { name: 'Settings' }).click();
  const row = panel.getByTestId('site-row');
  await expect(row).toHaveText(/alter\.test\s*1 change/);
  await row.getByRole('button', { name: 'Remove every change on alter.test' }).click();
  await row.getByRole('button', { name: 'Confirm removing every change on alter.test' }).click();
  await expect(row).toHaveCount(0);
  await expect(panel.getByText('Nothing saved yet.')).toBeVisible();
  await expect.poll(() => promoDisplay(site)).toBe('block');
});

test('⌘↵ saves the change being previewed', async ({ panel }) => {
  await ask(panel, 'hide promo');
  await waitForIdle(panel);
  await panel.getByLabel('Describe a change').press('ControlOrMeta+Enter');
  await expect(panel.getByTestId('saved-row')).toHaveCount(1);
  await expect(panel.getByTestId('proposal-card')).toContainText('Saved');
});
