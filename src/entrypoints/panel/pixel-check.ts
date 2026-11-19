import type { Box, VisualReport } from '../../content/visual-check';
import type { GraphicsLayout } from '../../lib/messages';

/**
 * Finds images and icons a change made disappear without hiding them: a logo drawn for a
 * dark page, left on a page that is now light. Their colors can't be read from styles
 * (they are pixels, or SVG fills), so this compares screenshots of the page from before
 * the first preview and after each one. An image that had visible detail before and is
 * now nearly flat has blended into what is behind it.
 *
 * Screenshots need Chrome's permission (Alter opened from its icon, menu, or shortcut, or
 * host access); without it, or when the tab isn't showing, the check quietly does nothing.
 */

/** RGBA pixels, like ImageData. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Standard deviation of brightness (0-255) above which an image clearly shows. */
const VISIBLE_DETAIL = 12;
/** An image is gone when it keeps less than this share of its detail, and little in absolute terms. */
const KEPT_SHARE = 0.3;
const FAINT_DETAIL = 16;
const MAX_SAMPLES = 4096;
const MAX_LISTED = 6;
/** Chrome allows two screenshots a second. */
const CAPTURE_SPACING_MS = 600;
/** A screenshot can stall (a busy machine, a window being moved); the check is skipped rather than holding up the preview. */
const CAPTURE_TIMEOUT_MS = 2500;

let lastCapture = 0;

/** The tab as it looks now, or null when it can't be captured (not showing, no permission, or too slow). */
export function captureTab(tabId: number): Promise<Pixels | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), CAPTURE_TIMEOUT_MS)));
  return Promise.race([capture(tabId), timeout]).finally(() => clearTimeout(timer));
}

async function capture(tabId: number): Promise<Pixels | null> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active) return null;
    const wait = lastCapture + CAPTURE_SPACING_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastCapture = Date.now();
    const url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
  } catch {
    return null;
  }
}

/** How much a box's brightness varies: about 0 for a flat area, tens for a visible image. */
export function detail(pixels: Pixels, box: Box, scale: number): number {
  const left = Math.max(0, Math.floor(box.left * scale));
  const top = Math.max(0, Math.floor(box.top * scale));
  const right = Math.min(pixels.width, Math.ceil((box.left + box.width) * scale));
  const bottom = Math.min(pixels.height, Math.ceil((box.top + box.height) * scale));
  if (right <= left || bottom <= top) return 0;
  // Sample on a grid, so big images cost the same as small ones.
  const step = Math.max(1, Math.floor(Math.sqrt(((right - left) * (bottom - top)) / MAX_SAMPLES)));
  let count = 0;
  let sum = 0;
  let squares = 0;
  for (let y = top; y < bottom; y += step) {
    for (let x = left; x < right; x += step) {
      const i = (y * pixels.width + x) * 4;
      const brightness = 0.2126 * pixels.data[i]! + 0.7152 * pixels.data[i + 1]! + 0.0722 * pixels.data[i + 2]!;
      sum += brightness;
      squares += brightness * brightness;
      count++;
    }
  }
  const mean = sum / count;
  return Math.sqrt(Math.max(0, squares / count - mean * mean));
}

const overlaps = (a: Box, b: Box) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

/** The images and icons that showed in `before` and have blended in by `after`. */
export function vanishedGraphics(before: Pixels, after: Pixels, layout: GraphicsLayout): VisualReport['vanished'] {
  const vanished: VisualReport['vanished'] = [];
  for (const pair of layout.pairs) {
    if (layout.covered.some((box) => overlaps(box, pair.before) || overlaps(box, pair.after))) continue;
    const was = detail(before, pair.before, layout.scale);
    if (was < VISIBLE_DETAIL) continue;
    const now = detail(after, pair.after, layout.scale);
    if (now < was * KEPT_SHARE && now < FAINT_DETAIL) vanished.push({ selector: pair.selector, label: pair.label });
  }
  return vanished.slice(0, MAX_LISTED);
}
