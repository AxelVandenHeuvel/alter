import { expect, test } from './fixtures';

test('the panel is Plain until Patchwork is picked in Settings, and stays Patchwork when reopened', async ({ panel, openPanel }) => {
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
  await reopened.getByRole('radiogroup', { name: 'Look' }).getByText('Plain').click();
  await expect(reopened.locator('html')).toHaveAttribute('data-look', 'plain');
  await expect.poll(() => reopened.locator('.header').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
});
