import { expect, openDetails, openFloatingPanel, test } from './fixtures';

const promoDisplay = (site: import('@playwright/test').Page) =>
  site.locator('[data-testid="promo"]').evaluate((el) => getComputedStyle(el).display);

test('selecting an area attaches its screenshot and tells the AI exactly what is in it', async ({ site, serviceWorker }) => {
  // Note: keep the default viewport. Emulating one taller than the real window breaks mouse
  // input to the panel's frame below the window's real height (an automation artifact).
  const panel = await openFloatingPanel(site, serviceWorker);
  const promo = (await site.locator('[data-testid="promo"]').boundingBox())!;

  await panel.getByRole('button', { name: 'Select an area of the page' }).click();
  // The crosshair is up: drag a box around the promo banner on the page.
  await expect.poll(() => site.locator('[data-alter-select]').count()).toBe(1);
  await site.mouse.move(promo.x - 4, promo.y - 4);
  await site.mouse.down();
  await site.mouse.move(promo.x + promo.width + 4, promo.y + promo.height + 4, { steps: 6 });
  await site.mouse.up();

  const thumbnail = panel.getByTestId('attachment').locator('img');
  await expect(thumbnail).toBeVisible();
  // A real, cropped image of the selected area (plus a small margin), not the whole page.
  const size = await thumbnail.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
  expect(size[0]).toBeLessThan(1200);
  expect(size[1]).toBeLessThan(200);

  await panel.getByLabel('Describe a change').fill('hide this');
  await panel.getByLabel('Describe a change').press('Enter');
  const card = panel.getByTestId('proposal-card');
  await openDetails(card);
  await expect(card).toContainText('Hid what you selected (from 1 screenshot)');
  await expect.poll(() => promoDisplay(site)).toBe('none');
  // The screenshot stays visible in the conversation.
  await expect(panel.locator('.bubble.user .bubble-image')).toBeVisible();
});

test('pressing Escape cancels a selection and brings the panel back', async ({ site, serviceWorker }) => {
  const panel = await openFloatingPanel(site, serviceWorker);
  await panel.getByRole('button', { name: 'Select an area of the page' }).click();
  await expect(panel.getByLabel('Describe a change')).toHaveAttribute('placeholder', 'Select an area on the page…');
  await expect.poll(() => site.locator('[data-alter-select]').count()).toBe(1);
  // Real key press, straight after clicking the button: the keyboard must already be on the selection.
  await site.keyboard.press('Escape');
  await expect(panel.getByLabel('Describe a change')).not.toHaveAttribute('placeholder', 'Select an area on the page…');
  await expect(panel.getByTestId('attachment')).toHaveCount(0);
  // The panel is visible again and usable.
  expect(await (await panel.frameElement()).evaluate((frame) => getComputedStyle(frame.parentElement!).visibility)).toBe('visible');
});

test('a pasted screenshot attaches to the message', async ({ site, serviceWorker }) => {
  const panel = await openFloatingPanel(site, serviceWorker);
  await panel.getByLabel('Describe a change').evaluate(async (box) => {
    // A tiny PNG on the clipboard, as after a ⌘⇧⌃4 screenshot.
    const canvas = new OffscreenCanvas(40, 20);
    canvas.getContext('2d')!.fillRect(0, 0, 40, 20);
    const file = new File([await canvas.convertToBlob({ type: 'image/png' })], 'shot.png', { type: 'image/png' });
    const data = new DataTransfer();
    data.items.add(file);
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(panel.getByTestId('attachment')).toHaveCount(1);
  await panel.getByRole('button', { name: 'Remove screenshot' }).click();
  await expect(panel.getByTestId('attachment')).toHaveCount(0);
});
