import type { Page } from '@playwright/test';
import { ask, expect, openDetails, test } from './fixtures';

/** The label text next to a product's price, or null. Labels live in an open shadow root. */
const label = (site: Page, product: string) =>
  site
    .locator(`[data-testid="${product}"] alter-badge`)
    .evaluateAll((badges) => (badges[0] ? badges[0].shadowRoot!.textContent!.replace(/.*}/s, '') : null));

/** Add a product to the page, as infinite scroll would. */
const loadMore = (site: Page) => site.evaluate(() => (window as unknown as { loadMore: () => void }).loadMore());

test('labels every product with its price per ounce, including ones that load later', async ({ panel, site }) => {
  await site.goto('https://alter.test/grocery');
  await ask(panel, 'add the price per ounce');
  const card = panel.getByTestId('proposal-card');
  await openDetails(card);
  await expect(card).toContainText('Adds labels to the page');
  await card.getByRole('button', { name: 'Run preview' }).click();

  await expect.poll(() => label(site, 'oats')).toBe('$0.24/oz');
  await expect.poll(() => label(site, 'coffee')).toBe('$0.50/oz');
  // Fluid ounces measure volume, not weight: no made-up number.
  expect(await label(site, 'juice')).toBeNull();
  // Added to the page after the script ran.
  await loadMore(site);
  await expect.poll(() => label(site, 'granola')).toBe('$0.45/oz');
});

test('labels go away when the change is turned off', async ({ panel, site }) => {
  await site.goto('https://alter.test/grocery');
  await ask(panel, 'add the price per ounce');
  await panel.getByRole('button', { name: 'Run preview' }).click();
  // Three products have weights (the juice is in fluid ounces); one of them loads later.
  await expect.poll(() => site.locator('alter-badge').count()).toBe(2);
  await loadMore(site);
  await expect.poll(() => site.locator('alter-badge').count()).toBe(3);
  await expect.poll(() => label(site, 'granola')).toBe('$0.45/oz');
  await panel.getByRole('button', { name: 'Save for alter.test' }).click();

  await panel.getByRole('switch', { name: 'Turn off Price per ounce' }).click();
  await expect.poll(() => site.locator('alter-badge').count()).toBe(0);
  await panel.getByRole('switch', { name: 'Turn on Price per ounce' }).click();
  await expect.poll(() => site.locator('alter-badge').count()).toBe(3);
});
