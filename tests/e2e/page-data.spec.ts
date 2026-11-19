import { ask, expect, test } from './fixtures';

test('a script can show data the site loaded but never displayed', async ({ panel, site }) => {
  await site.goto('https://alter.test/feed');
  await expect(site.locator('.post')).toHaveCount(3);

  await ask(panel, 'show follower counts next to each name');
  await panel.getByRole('button', { name: 'Run preview' }).click();
  await expect(panel.getByText('Follower counts are showing next to each name.')).toBeVisible();

  // From the first response (fetch) and the one that loaded later (XMLHttpRequest).
  const badge = (handle: string) => site.locator(`.author[data-handle="${handle}"] + alter-badge`);
  await expect(badge('ana')).toHaveText('1,520 followers');
  await expect(badge('bo')).toHaveText('87 followers');
  await expect(badge('cy')).toHaveText('1,250,000 followers');

  // Saved, it works from the start of the next page load too.
  const card = panel.getByTestId('proposal-card');
  await card.getByRole('button', { name: 'Save for alter.test' }).click();
  // Once it says saved, pages that load get it, even straight away.
  await expect(card).toContainText('Saved');
  await site.reload();
  await expect(badge('ana')).toHaveText('1,520 followers');
  await expect(badge('cy')).toHaveText('1,250,000 followers');
});
