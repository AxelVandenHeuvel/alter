import { ask, expect, test, waitForIdle } from './fixtures';

test('every reply shows its cost, and Settings adds up the month', async ({ panel }) => {
  await ask(panel, 'hide promo');
  await waitForIdle(panel);
  // The scripted model makes three calls at $0.004 each.
  await expect(panel.getByTestId('usage')).toHaveText('Sonnet 5.5 · $0.012');

  await panel.getByRole('button', { name: 'Settings' }).click();
  await expect(panel.getByTestId('usage-summary')).toHaveText(/\$0\.012\s*1 request/);
});

test('a monthly limit stops requests once it is reached', async ({ panel }) => {
  await ask(panel, 'hide promo');
  await waitForIdle(panel);

  await panel.getByRole('button', { name: 'Settings' }).click();
  await panel.getByLabel('Monthly limit in US dollars').fill('0.01');
  await panel.getByLabel('Monthly limit in US dollars').press('Enter');
  await expect(panel.getByTestId('usage-summary')).toContainText('$0.010 limit');
  await panel.getByRole('button', { name: 'Back' }).click();

  await ask(panel, 'make it dark');
  await expect(panel.getByRole('alert')).toHaveText("You've reached your monthly limit of $0.01 for Alter. You can raise it in Settings.");
});
