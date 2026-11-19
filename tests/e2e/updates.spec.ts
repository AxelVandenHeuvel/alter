import { expect, test } from './fixtures';

test.describe('when GitHub has a newer release', () => {
  test.use({ latestRelease: '99.0.0' });

  test('Settings offers it, and its button shows a dot', async ({ panel }) => {
    const settings = panel.getByRole('button', { name: 'Settings (version 99.0.0 is available)' });
    await expect(settings).toBeVisible();
    await settings.click();
    const version = panel.getByTestId('version');
    await expect(version).toContainText('Version 99.0.0 is out.');
    await expect(version.getByRole('link', { name: 'Download' })).toHaveAttribute('href', 'https://github.com/AxelVandenHeuvel/alter/releases/latest');
  });
});

test('with no newer release, Settings just shows the version', async ({ panel }) => {
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  const version = panel.getByTestId('version');
  await expect(version).toContainText(/Version \d+\.\d+\.\d+/);
  await expect(version).toContainText('Alter checks for a newer version once a day.');
  await expect(version.getByRole('link', { name: 'Releases' })).toBeVisible();
});
