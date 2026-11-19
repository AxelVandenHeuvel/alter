import { readFile } from 'node:fs/promises';
import { ask, expect, test, waitForIdle } from './fixtures';

test('a one-time action downloads a file without changing the page or saving anything', async ({ panel, site }) => {
  const pageBefore = await site.locator('body').innerHTML();
  await ask(panel, 'download this article as a txt file');
  const card = panel.getByTestId('proposal-card');
  await expect(card).toContainText('This runs a script once, on this page only, that:');
  await expect(card).toContainText('Downloads files');

  const download = panel.waitForEvent('download');
  await card.getByRole('button', { name: 'Run once' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('article.txt');
  expect(await readFile((await file.path())!, 'utf8')).toBe(
    'Calm Morning in the City\n\nThe streets were quiet as the sun came up over the river.',
  );

  await waitForIdle(panel);
  await expect(card).toContainText('Done');
  await expect(card.getByTestId('action-outputs')).toContainText('article.txt');
  await expect(card.getByRole('button', { name: 'Save for alter.test' })).toHaveCount(0);
  await expect(panel.getByTestId('saved-row')).toHaveCount(0);
  expect(await site.locator('body').innerHTML()).toBe(pageBefore);

  // "Download again" delivers the same file without re-running anything on the page.
  const again = panel.waitForEvent('download');
  await card.getByRole('button', { name: 'Download again' }).click();
  expect((await again).suggestedFilename()).toBe('article.txt');
});

test('a one-time action copies to the clipboard', async ({ context, panel, site }) => {
  await ask(panel, 'copy the headline');
  await panel.getByRole('button', { name: 'Run once' }).click();
  await waitForIdle(panel);
  await expect(panel.getByTestId('action-outputs')).toContainText('Copied text');
  await expect(panel.getByTestId('action-outputs')).not.toContainText("Couldn't copy");

  // Extension origins can't be granted clipboard-read in tests, so read it back from the site.
  await context.grantPermissions(['clipboard-read'], { origin: new URL(site.url()).origin });
  await site.bringToFront();
  expect(await site.evaluate(() => navigator.clipboard.readText())).toBe('Calm Morning in the City');
});

test('declining an action runs nothing', async ({ panel }) => {
  await ask(panel, 'download this article');
  let downloaded = false;
  panel.on('download', () => (downloaded = true));
  await panel.getByRole('button', { name: "Don't run" }).click();
  await waitForIdle(panel);
  await expect(panel.getByTestId('proposal-card')).toContainText('Not run');
  expect(downloaded).toBe(false);
});
