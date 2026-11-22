import { expect, test } from './fixtures';

test('the panel is Plain until another look is picked in Settings, and keeps it when reopened', async ({ panel, openPanel }) => {
  const html = panel.locator('html');
  await expect(html).toHaveAttribute('data-look', 'plain');

  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  const looks = panel.getByRole('radiogroup', { name: 'Look' });
  await expect(looks.getByRole('radio', { name: /Plain/ })).toBeChecked();
  await looks.getByText('Patchwork').click();
  await expect(html).toHaveAttribute('data-look', 'patchwork');
  // The header is a scrap of denim, stitched around its edge.
  await expect.poll(() => panel.locator('.header').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('dashed');

  await panel.close();
  const reopened = await openPanel();
  await expect(reopened.locator('html')).toHaveAttribute('data-look', 'patchwork');

  await reopened.getByRole('button', { name: 'Settings', exact: true }).click();
  const reopenedLooks = reopened.getByRole('radiogroup', { name: 'Look' });
  // Selvedge: the name sits on a leather patch.
  await reopenedLooks.getByText('Selvedge').click();
  await expect(reopened.locator('html')).toHaveAttribute('data-look', 'selvedge');
  await expect.poll(() => reopened.locator('.header-name').evaluate((el) => getComputedStyle(el).textTransform)).toBe('uppercase');

  await reopenedLooks.getByText('Plain').click();
  await expect(reopened.locator('html')).toHaveAttribute('data-look', 'plain');
  await expect.poll(() => reopened.locator('.header').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
});
