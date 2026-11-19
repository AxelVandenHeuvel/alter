import { ask, expect, openDetails, test } from './fixtures';

test('previews and saved changes show what they do on the page', async ({ panel }) => {
  await ask(panel, 'hide promo');
  const card = panel.getByTestId('proposal-card');
  await openDetails(card);
  // The preview card has no status line while it works; the saved row does.
  await expect(card.getByTestId('health')).toHaveCount(0);

  await card.getByRole('button', { name: 'Save for alter.test' }).click();
  const row = panel.getByTestId('saved-row');
  await expect(row.getByTestId('health')).toHaveText('1 style rule applies');

  await panel.getByRole('switch', { name: 'Turn off Hide promo' }).click();
  await expect(row.getByTestId('health')).toHaveText('Turned off');
});

test('a change whose target is not on the page says so', async ({ panel }) => {
  await ask(panel, 'hide ghost');
  const card = panel.getByTestId('proposal-card');
  await openDetails(card);
  await expect(card.getByTestId('health')).toContainText('Nothing to change on this page');
  await expect(card.getByTestId('health')).toContainText('Not found here: [data-testid="ghost"]');
});

test('scripts report how many elements they handled', async ({ panel }) => {
  await ask(panel, 'add button');
  await panel.getByRole('button', { name: 'Run preview' }).click();
  const card = panel.getByTestId('proposal-card');
  await openDetails(card);
  await expect(card.getByTestId('health-notes')).toHaveText('Latest note: added the button');

  await card.getByRole('button', { name: 'Save for alter.test' }).click();
  await expect(panel.getByTestId('saved-row').getByTestId('health')).toHaveText('Script handled 1 element');
});

test('scripts that click for the user are rejected', async ({ panel }) => {
  await ask(panel, 'auto click the skip button');
  await expect(panel.getByText("I couldn't do that safely")).toBeVisible();
  await expect(panel.getByText(/clicking things automatically/)).toBeVisible();
  await expect(panel.getByTestId('proposal-card')).toHaveCount(0);
});
