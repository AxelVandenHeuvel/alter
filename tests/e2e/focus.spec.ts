import { ask, expect, focusView, openDetails, openFloatingPanel, test, waitForIdle } from './fixtures';

test('reader view shows just the article', async ({ panel, site }) => {
  await site.goto('https://alter.test/article');
  await ask(panel, 'reader mode please');
  const card = panel.getByTestId('proposal-card');
  await openDetails(card);
  await expect(card).toContainText('Reader view');

  await expect.poll(async () => (await focusView(site)).text).toContain('Story paragraph 8');
  const view = await focusView(site);
  // The real headline, shown once (not the tab title "River Path Opens | Daily Paper" plus the headline).
  expect(view.text.match(/River Path Opens to Walkers and Cyclists/g)).toHaveLength(1);
  expect(view.text).not.toContain('| Daily Paper');
  expect(view.text).toContain('Story paragraph 8');
  expect(view.text).toContain('The new path at dawn.');
  // Site chrome is gone, and nothing executable came along.
  expect(view.text).not.toContain('Sign up for our newsletter');
  expect(view.text).not.toContain('Most read');
  expect(view.text).not.toContain('window.tracker');
  // The page underneath doesn't scroll while the view is open.
  expect(await site.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe('hidden');
});

test('recipe view shows the ingredients and steps from the recipe data', async ({ panel, site }) => {
  await site.goto('https://alter.test/recipe');
  await ask(panel, 'just show me the recipe');
  await openDetails(panel.getByTestId('proposal-card'));
  await expect(panel.getByTestId('proposal-card')).toContainText('Recipe view');

  await expect.poll(async () => (await focusView(site)).text).toContain('Lemon Pasta');
  const { text } = await focusView(site);
  for (const expected of ['Lemon Pasta', 'By Sam Lee', 'Prep 10 min', 'Cook 15 min', 'Serves 4 servings', '200 g spaghetti', 'Salt & pepper', 'Pasta', 'Boil the spaghetti in salted water.', 'Sauce']) {
    expect(text).toContain(expected);
  }
  expect(text).not.toContain('Life story');
  expect(text).not.toContain('ADVERTISEMENT');
});

test('asking for a recipe on a page without one falls back to the reader view', async ({ panel, site }) => {
  await site.goto('https://alter.test/article');
  await ask(panel, 'just the recipe');
  await expect.poll(async () => (await focusView(site)).text).toContain("This page has no recipe data, so here's the reader view instead.");
  expect((await focusView(site)).text).toContain('River Path Opens to Walkers and Cyclists');
});

test('the view can be closed and reopened on the page', async ({ panel, site }) => {
  await site.goto('https://alter.test/recipe');
  await ask(panel, 'just the recipe');
  await expect.poll(async () => (await focusView(site)).text).toContain('Lemon Pasta');

  await (await focusView(site)).click('Show original');
  await expect.poll(async () => (await focusView(site)).text).toBe('Recipe view');
  expect(await site.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe('hidden');

  await (await focusView(site)).click('Recipe view');
  await expect.poll(async () => (await focusView(site)).text).toContain('200 g spaghetti');
});

test('a saved recipe view comes back on reload and turns off with its switch', async ({ panel, site }) => {
  await site.goto('https://alter.test/recipe');
  await ask(panel, 'just the recipe');
  await waitForIdle(panel);
  await panel.getByRole('button', { name: 'Save for alter.test' }).click();
  await expect(panel.getByTestId('saved-row')).toHaveCount(1);

  await site.reload();
  await expect.poll(async () => (await focusView(site)).text).toContain('200 g spaghetti');

  await panel.getByRole('switch', { name: 'Turn off Just the recipe' }).click();
  await expect.poll(async () => (await focusView(site)).count).toBe(0);
  expect(await site.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe('hidden');
});

test('suggestions fit the page: the article or recipe view where there is one', async ({ site, serviceWorker }) => {
  await site.goto('https://alter.test/article');
  const panel = await openFloatingPanel(site, serviceWorker);
  await expect(panel.locator('.suggestion').first()).toHaveText('Show just the article');
  await expect(panel.getByRole('button', { name: 'Hide the sidebar' })).toBeVisible();

  await site.goto('https://alter.test/recipe');
  const recipePanel = await openFloatingPanel(site, serviceWorker);
  await expect(recipePanel.locator('.suggestion').first()).toHaveText('Show just the recipe');
});
