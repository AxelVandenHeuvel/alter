// Renders the extension icons from assets/logo-source.jpg: lifts the safety pin off its plain
// dark background (and its shadow) onto transparency, and writes the square PNG sizes the
// manifest uses.
/* global Image, OffscreenCanvas -- the drawing below runs inside a browser page via page.evaluate */
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const SIZES = [16, 32, 48, 128];
/**
 * How each size is drawn: how much of the square the pin takes up, and how much its thin
 * strokes are thickened (their soft edges made more opaque). Small sizes get a bigger, bolder
 * pin, or it fades into whatever is behind it.
 */
const LOOK = {
  16: { fill: 1, gain: 2.4 },
  32: { fill: 0.96, gain: 1.6 },
  48: { fill: 0.94, gain: 1.2 },
  128: { fill: 0.92, gain: 1 },
};
/**
 * How much brighter than the background a pixel must be to be any pin (below is the JPEG's
 * noise), and to be fully pin. Between the two it is partly see-through.
 */
const NOISE = 12;
const SOLID = 60;
const source = (await readFile(new URL('../assets/logo-source.jpg', import.meta.url))).toString('base64');

const browser = await chromium.launch();
const page = await browser.newPage();
const pngs = await page.evaluate(
  async ({ source, sizes, look, SOLID, NOISE }) => {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${source}`;
    await img.decode();
    const full = new OffscreenCanvas(img.width, img.height);
    const fctx = full.getContext('2d');
    fctx.drawImage(img, 0, 0);
    const { data, width, height } = fctx.getImageData(0, 0, img.width, img.height);
    const at = (x, y) => {
      const i = (y * width + x) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    };

    // The pin is what's clearly different from the background (its soft shadow isn't).
    const bg = at(10, 10);
    const isPin = (x, y) => {
      const [r, g, b] = at(x, y);
      return Math.max(Math.abs(r - bg[0]), Math.abs(g - bg[1]), Math.abs(b - bg[2])) > 40;
    };
    let minX = width, minY = height, maxX = 0, maxY = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!isPin(x, y)) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    // Lift the pin off: how far a pixel is brighter than the background says how much of it is
    // pin. The shadow is darker than the background, so it goes. Partly see-through pixels get
    // back the color they had before being blended with the background.
    const lifted = fctx.getImageData(0, 0, width, height);
    const px = lifted.data;
    for (let i = 0; i < px.length; i += 4) {
      const lift = Math.max(px[i] - bg[0], px[i + 1] - bg[1], px[i + 2] - bg[2]);
      const alpha = Math.max(0, Math.min(1, (lift - NOISE) / (SOLID - NOISE)));
      for (let c = 0; c < 3; c++) px[i + c] = alpha === 0 ? 0 : Math.min(255, bg[c] + (px[i + c] - bg[c]) / alpha);
      px[i + 3] = Math.round(alpha * 255);
    }
    fctx.putImageData(lifted, 0, 0);

    const pinSize = Math.max(maxX - minX, maxY - minY);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const render = async (target, { fill, gain }) => {
      // A square centered on the pin.
      const side = Math.round(pinSize / fill);
      const sx = Math.round(cx - side / 2);
      const sy = Math.round(cy - side / 2);
      if (sx < 0 || sy < 0 || sx + side > width || sy + side > height) throw new Error('The pin is too close to the edge of the artwork.');
      let current = new OffscreenCanvas(side, side);
      current.getContext('2d').drawImage(full, sx, sy, side, side, 0, 0, side, side);

      // Scale down by halves for crisp small sizes, then once to the exact size.
      while (current.width / 2 >= target) {
        const half = new OffscreenCanvas(Math.round(current.width / 2), Math.round(current.height / 2));
        const hctx = half.getContext('2d');
        hctx.imageSmoothingQuality = 'high';
        hctx.drawImage(current, 0, 0, half.width, half.height);
        current = half;
      }
      const out = new OffscreenCanvas(target, target);
      const octx = out.getContext('2d');
      octx.imageSmoothingQuality = 'high';
      octx.drawImage(current, 0, 0, target, target);

      // Make the strokes' soft edges more opaque, so thin lines hold up when small.
      if (gain !== 1) {
        const pixels = octx.getImageData(0, 0, target, target);
        for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = Math.min(255, pixels.data[i] * gain);
        octx.putImageData(pixels, 0, 0);
      }

      const bytes = new Uint8Array(await (await out.convertToBlob({ type: 'image/png' })).arrayBuffer());
      let binary = '';
      for (const b of bytes) binary += String.fromCharCode(b);
      return btoa(binary);
    };
    const result = {};
    for (const size of sizes) result[size] = await render(size, look[size]);
    return result;
  },
  { source, sizes: SIZES, look: LOOK, SOLID, NOISE },
);
await browser.close();

for (const size of SIZES) await writeFile(new URL(`../public/icon/${size}.png`, import.meta.url), Buffer.from(pngs[size], 'base64'));
console.log(`Wrote public/icon/{${SIZES.join(',')}}.png`);
