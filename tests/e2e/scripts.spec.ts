import type { Page } from '@playwright/test';
import { ask, expect, setUserScripts, test } from './fixtures';

const addedButton = (site: Page) => site.getByTestId('alter-button');


test('a script waits for approval, runs, persists, and stops when turned off', async ({ panel, site }) => {
  await ask(panel, 'add button');
  const card = panel.getByTestId('proposal-card');
  await expect(card).toContainText('Needs your OK');
  await expect(card).toContainText('Adds elements to the page');
  await expect(card).toContainText("It can't access the internet");
  // Nothing runs before approval.
  await expect(addedButton(site)).toHaveCount(0);

  await card.getByRole('button', { name: 'Run preview' }).click();
  await expect(card).toContainText('Previewing');
  await expect(addedButton(site)).toHaveCount(1);

  await card.getByRole('button', { name: 'Save for alter.test' }).click();
  await expect(card).toContainText('Saved');
  await expect(addedButton(site)).toHaveCount(1);

  // Registered with chrome.userScripts, so it runs on the next load by itself.
  await site.reload();
  await expect(addedButton(site)).toHaveCount(1);

  await panel.getByRole('switch', { name: 'Turn off Add a button' }).click();
  await expect(addedButton(site)).toHaveCount(0);
  await panel.getByRole('switch', { name: 'Turn on Add a button' }).click();
  await expect(addedButton(site)).toHaveCount(1);

  await panel.getByTestId('saved-row').getByRole('button', { name: 'Add a button' }).click();
  await panel.getByRole('button', { name: 'Delete' }).click();
  await expect(addedButton(site)).toHaveCount(0);
  await site.reload();
  await expect(site.locator('h1')).toBeVisible();
  await expect(addedButton(site)).toHaveCount(0);
});

test('declining a script leaves the page untouched', async ({ panel, site }) => {
  await ask(panel, 'add button');
  await panel.getByRole('button', { name: "Don't run" }).click();
  await expect(panel.getByTestId('proposal-card')).toContainText('Not run');
  await expect(panel.getByText('Okay, I left the page as it was.')).toBeVisible();
  await expect(addedButton(site)).toHaveCount(0);
});

test('unsafe scripts are rejected before the user is ever asked', async ({ panel }) => {
  await ask(panel, 'exfiltrate the page');
  await expect(panel.getByText("I couldn't do that safely")).toBeVisible();
  await expect(panel.getByTestId('proposal-card')).toHaveCount(0);
});

test('a script preview stays after closing Alter, until the page reloads', async ({ panel, site }) => {
  await ask(panel, 'add button');
  await panel.getByRole('button', { name: 'Run preview' }).click();
  await expect(addedButton(site)).toHaveCount(1);
  await panel.close();
  await site.waitForTimeout(500);
  await expect(addedButton(site)).toHaveCount(1);
  await site.reload();
  await expect(site.locator('h1')).toBeVisible();
  await expect(addedButton(site)).toHaveCount(0);
});

test('closing Alter while a script waits for approval stops the request', async ({ panel, site, openPanel }) => {
  await ask(panel, 'add button');
  await expect(panel.getByTestId('proposal-card')).toContainText('Needs your OK');
  await panel.close();
  const reopened = await openPanel();
  await expect(reopened.getByText('Stopped because Alter was closed.')).toBeVisible();
  await expect(reopened.getByTestId('proposal-card')).toContainText('Not run');
  await expect(addedButton(site)).toHaveCount(0);
});

test('script worlds have no network access', async ({ context, panel, site, serviceWorker }) => {
  const hits: string[] = [];
  await context.route('https://evil.test/**', (route) => {
    hits.push(route.request().url());
    return route.fulfill({ status: 200, body: 'x', headers: { 'access-control-allow-origin': '*' } });
  });
  // Run a real preview so the preview world is configured by the extension itself.
  await ask(panel, 'add button');
  await panel.getByRole('button', { name: 'Run preview' }).click();
  await expect(addedButton(site)).toHaveCount(1);

  const tabId = await serviceWorker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]!.id!, site.url());
  const outcome = await serviceWorker.evaluate(async (tabId) => {
    const [result] = await chrome.userScripts.execute({
      target: { tabId },
      worldId: 'alter-preview',
      js: [
        {
          code: `(async () => {
            const img = document.createElement('img');
            img.src = 'https://evil.test/image';
            document.body.append(img);
            try { await fetch('https://evil.test/fetch'); return 'fetch allowed'; } catch { return 'fetch blocked'; }
          })()`,
        },
      ],
    });
    return result!.result;
  }, tabId);
  await site.waitForTimeout(500);
  expect(outcome).toBe('fetch blocked');
  expect(hits).toEqual([]);
});

test.describe('with scripts turned off in Chrome', () => {
  test.use({ scriptsEnabled: false });

  test('the approval card walks through turning them on', async ({ context, extensionId, panel, site }) => {
    await ask(panel, 'add button');
    const card = panel.getByTestId('proposal-card');
    await expect(card.getByTestId('script-setup')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Run preview' })).toHaveCount(0);

    await setUserScripts(context, extensionId, true);
    await expect(card.getByTestId('script-setup')).toHaveCount(0);
    await card.getByRole('button', { name: 'Run preview' }).click();
    await expect(addedButton(site)).toHaveCount(1);
  });
});
