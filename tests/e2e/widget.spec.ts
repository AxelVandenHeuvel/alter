import { expect, openFloatingPanel, pillBox, test } from './fixtures';

test('the floating panel sits over the page without moving it, and works end to end', async ({ site, serviceWorker }) => {
  const layout = () => site.evaluate(() => [document.documentElement.clientWidth, document.querySelector('main')!.getBoundingClientRect().left]);
  const before = await layout();
  const panel = await openFloatingPanel(site, serviceWorker);
  expect(await layout()).toEqual(before);

  await panel.getByLabel('Describe a change').fill('hide promo');
  await panel.getByLabel('Describe a change').press('Enter');
  const card = panel.getByTestId('proposal-card');
  await expect(card).toContainText('Previewing');
  await expect.poll(() => site.locator('[data-testid="promo"]').evaluate((el) => getComputedStyle(el).display)).toBe('none');
  await card.getByRole('button', { name: 'Save for alter.test' }).click();
  await expect(panel.getByTestId('saved-row')).toHaveCount(1);
});

test('the panel can be dragged, and remembers where it was put', async ({ site, serviceWorker }) => {
  await site.setViewportSize({ width: 1200, height: 800 });
  const panel = await openFloatingPanel(site, serviceWorker);
  const box = (await (await panel.frameElement()).boundingBox())!;
  // Starts in the bottom-right corner (the frame sits inside the card's 1px border).
  expect(Math.round(box.x + box.width)).toBe(1200 - 20 - 1);

  // Drag by the title area of the header.
  await site.mouse.move(box.x + 120, box.y + 24);
  await site.mouse.down();
  await site.mouse.move(box.x - 380, box.y - 80, { steps: 8 });
  await site.mouse.up();
  const moved = (await (await panel.frameElement()).boundingBox())!;
  expect(Math.round(moved.x)).toBe(Math.round(box.x - 500));
  // Kept on screen even when dragged past the edge.
  expect(moved.y).toBeGreaterThanOrEqual(16);

  // Closing and reopening puts it back in the same place.
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect.poll(() => site.frames().some((f) => f.url().includes('/panel.html'))).toBe(false);
  const reopened = await openFloatingPanel(site, serviceWorker);
  expect(Math.round((await (await reopened.frameElement()).boundingBox())!.x)).toBe(Math.round(moved.x));
});

test('minimize shrinks the panel without losing the conversation', async ({ site, serviceWorker }) => {
  const panel = await openFloatingPanel(site, serviceWorker);
  await panel.getByLabel('Describe a change').fill('hide promo');
  await panel.getByLabel('Describe a change').press('Enter');
  await expect(panel.getByTestId('proposal-card')).toContainText('Previewing');

  await panel.getByRole('button', { name: 'Minimize' }).click();
  await expect.poll(async () => (await (await panel.frameElement()).boundingBox()) === null).toBe(true);
  // Opening again (icon, menu, shortcut, or the pill) shows the same panel, conversation intact.
  const again = await openFloatingPanel(site, serviceWorker);
  expect(again).toBe(panel);
  await expect(again.getByTestId('proposal-card')).toContainText('Previewing');
});

test('the minimized button stays in the bottom-right corner wherever the panel was moved', async ({ site, serviceWorker }) => {
  await site.setViewportSize({ width: 1200, height: 800 });
  const panel = await openFloatingPanel(site, serviceWorker);
  const box = (await (await panel.frameElement()).boundingBox())!;
  // Drag the panel to the top-left.
  await site.mouse.move(box.x + 120, box.y + 24);
  await site.mouse.down();
  await site.mouse.move(60, 40, { steps: 8 });
  await site.mouse.up();

  await panel.getByRole('button', { name: 'Minimize' }).click();
  await expect.poll(() => pillBox(site)).not.toBeNull();
  const pill = (await pillBox(site))!;
  expect(Math.round(pill.x + pill.width)).toBe(1200 - 20);
  expect(Math.round(pill.y + pill.height)).toBe(800 - 20);

  // Still in the corner after the window is resized.
  await site.setViewportSize({ width: 900, height: 600 });
  await expect.poll(async () => {
    const resized = (await pillBox(site))!;
    return [Math.round(resized.x + resized.width), Math.round(resized.y + resized.height)];
  }).toEqual([900 - 20, 600 - 20]);
});


test('Escape tucks the panel away, and it comes back as it was', async ({ site, serviceWorker }) => {
  const panel = await openFloatingPanel(site, serviceWorker);
  await panel.getByLabel('Describe a change').fill('half-written idea');
  await panel.getByLabel('Describe a change').press('Escape');
  await expect.poll(() => pillBox(site)).not.toBeNull();

  const again = await openFloatingPanel(site, serviceWorker);
  await expect(again.getByLabel('Describe a change')).toHaveValue('half-written idea');
});
