import type { Worker } from '@playwright/test';
import { ask, expect, test } from './fixtures';

/** The yen rate Alter has stored, or undefined when it hasn't downloaded any. */
const storedYen = (serviceWorker: Worker) =>
  serviceWorker.evaluate(async () => {
    const stored = (await chrome.storage.local.get('exchange-rates'))['exchange-rates'] as { perEuro: Record<string, number> } | undefined;
    return stored?.perEuro.JPY;
  });

test('converts prices with downloaded rates on a store with a hidden sign-in dialog, and stops when it opens', async ({ panel, site, serviceWorker }) => {
  await site.goto('https://alter.test/shop');
  // Nothing is downloaded until a script needs rates.
  expect(await storedYen(serviceWorker)).toBeUndefined();

  await ask(panel, 'convert all the prices to yen');
  const card = panel.getByTestId('proposal-card');
  await card.getByRole('button', { name: 'Run preview' }).click();
  await expect(card).toContainText('Previewing');
  // The rates are the ones the test served, so the request was intercepted.
  expect(await storedYen(serviceWorker)).toBe(150);
  await expect(site.getByTestId('shirt')).toHaveText('¥19,350');
  await expect(site.getByTestId('sweater')).toHaveText('¥44,700');
  await expect(site.getByTestId('shirt')).toHaveAttribute('title', '$129.00');

  // Signing in: the script stops before the password field can be used, and the prices go back.
  await site.getByRole('button', { name: 'Sign in' }).click();
  await expect(site.getByTestId('shirt')).toHaveText('$129.00');
  await expect(card.getByTestId('health')).toHaveText('A password field is showing, so the script stopped until the page reloads.');
});

test('a script’s plain listeners stop the moment a password field is used', async ({ panel, site, serviceWorker }) => {
  await site.goto('https://alter.test/shop');
  await ask(panel, 'log keys');
  await panel.getByRole('button', { name: 'Run preview' }).click();
  await expect(panel.getByTestId('proposal-card')).toContainText('Previewing');
  // A script that doesn't convert prices downloads nothing.
  expect(await storedYen(serviceWorker)).toBeUndefined();

  await site.locator('h1').click();
  await site.keyboard.press('x');
  await expect(site.locator('body')).toHaveAttribute('data-keys', 'x');

  await site.getByRole('button', { name: 'Sign in' }).click();
  await site.getByLabel('Password').pressSequentially('hunter2');
  await expect(site.getByLabel('Password')).toHaveValue('hunter2');
  // The listener wasn't made with alter's helpers, and it still got nothing.
  await expect(site.locator('body')).toHaveAttribute('data-keys', 'x');
});
