import { ask, expect, test } from './fixtures';

test('a change that leaves text unreadable is caught and fixed before the reply', async ({ panel, site }) => {
  await site.goto('https://alter.test/dark');
  await ask(panel, 'light mode');

  const reply = panel.getByText(/Light mode is on, and all text is readable/);
  await expect(reply).toBeVisible();
  // The careless first attempt left the headings and text light on white, and the search box dark.
  await expect(reply).toContainText('Text that is now hard to read (3 elements)');
  await expect(reply).toContainText('main > h1 ("Search results"): rgb(232, 234, 237) on rgb(255, 255, 255)');
  await expect(reply).toContainText('Kept the old look while the page changed tone: body > main > div.composer (640×56, background rgb(48, 49, 52))');
  // The white logo, made for the dark page, vanished on the white one: found by comparing screenshots.
  await expect(reply).toContainText('Images or icons that showed before now blend into what is behind them');
  await expect(reply).toContainText('main > svg.logo ("Night Search")');
  // The site's own faint chip was faint before the change, so it isn't blamed on it.
  await expect(reply).not.toContainText('chip');

  // Only the fixed version is on the page.
  await expect(panel.getByTestId('proposal-card')).toHaveCount(1);
  const colors = await site.evaluate(() => ({
    composer: getComputedStyle(document.querySelector('.composer')!).backgroundColor,
    text: getComputedStyle(document.querySelector('.result p')!).color,
    logo: getComputedStyle(document.querySelector('.logo')!).filter,
  }));
  expect(colors).toEqual({ composer: 'rgb(241, 243, 244)', text: 'rgb(77, 81, 86)', logo: 'invert(1)' });
});

test('text a change covers or makes invisible is reported, not skipped', async ({ panel, site }) => {
  await site.goto('https://alter.test/dark');
  await ask(panel, 'cover the results');

  const reply = panel.getByText(/Text that was readable before your change can no longer be seen/);
  await expect(reply).toBeVisible();
  await expect(reply).toContainText('(4 elements)');
  await expect(reply).toContainText('main > h1 ("Search results"): now covered by body > main > div.composer');
  await expect(reply).toContainText('div.result > h3 ("Install Ollama"): now covered by body > main > div.composer');
  await expect(reply).toContainText('div.result > p ("You can install and run Ollama locally on macOS."): now invisible');
});
