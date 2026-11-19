import { describe, expect, it } from 'vitest';
import { detail, vanishedGraphics, type Pixels } from '../../src/entrypoints/panel/pixel-check';
import type { GraphicPair } from '../../src/content/visual-check';

type Color = [number, number, number];

/** A 100×60 screenshot of one color, at 2 screenshot pixels per CSS pixel. */
function screenshot(background: Color): Pixels & { paint(box: GraphicPair['before'], color: Color, every?: number): void } {
  const width = 200;
  const height = 120;
  const data = new Uint8ClampedArray(width * height * 4);
  const set = (x: number, y: number, [r, g, b]: Color) => data.set([r, g, b, 255], (y * width + x) * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) set(x, y, background);
  return {
    width,
    height,
    data,
    // Stripes, like the strokes of a logo or icon.
    paint(box, color, every = 2) {
      for (let y = box.top * 2; y < (box.top + box.height) * 2; y++) {
        for (let x = box.left * 2; x < (box.left + box.width) * 2; x++) if (Math.floor(x / every) % 2 === 0) set(x, y, color);
      }
    },
  };
}

const DARK: Color = [32, 33, 36];
const WHITE: Color = [255, 255, 255];
const LIGHT_GREY: Color = [232, 234, 237];
const logo = { left: 10, top: 10, width: 30, height: 12 };
const icon = { left: 60, top: 10, width: 12, height: 12 };
const pair = (selector: string, box: GraphicPair['before']): GraphicPair => ({ selector, label: selector, before: box, after: box });

describe('detail', () => {
  it('is about zero for a flat area and large for a visible image', () => {
    const shot = screenshot(WHITE);
    expect(detail(shot, logo, 2)).toBeCloseTo(0);
    shot.paint(logo, DARK);
    expect(detail(shot, logo, 2)).toBeGreaterThan(80);
    // Boxes partly outside the screenshot are cut to it.
    expect(detail(shot, { left: 90, top: 50, width: 40, height: 40 }, 2)).toBeCloseTo(0);
  });
});

describe('vanishedGraphics', () => {
  it('finds a light logo and a light icon left on a page that turned light, and nothing else', () => {
    const before = screenshot(DARK);
    before.paint(logo, WHITE);
    before.paint(icon, LIGHT_GREY);
    const after = screenshot(WHITE);
    after.paint(logo, WHITE);
    after.paint(icon, LIGHT_GREY);

    const kept = { left: 10, top: 30, width: 20, height: 20 };
    before.paint(kept, [200, 30, 30]);
    after.paint(kept, [200, 30, 30]);
    const empty = { left: 60, top: 30, width: 20, height: 20 };

    const layout = { pairs: [pair('img.logo', logo), pair('svg.gear', icon), pair('img.photo', kept), pair('img.lazy', empty)], scale: 2, covered: [] };
    expect(vanishedGraphics(before, after, layout)).toEqual([
      { selector: 'img.logo', label: 'img.logo' },
      { selector: 'svg.gear', label: 'svg.gear' },
    ]);
  });

  it('follows images that moved, and skips what Alter’s own panel covers', () => {
    const before = screenshot(WHITE);
    before.paint(logo, DARK);
    const after = screenshot(WHITE);
    const moved = { ...logo, top: 40 };
    after.paint(moved, DARK);
    const layout = { pairs: [{ selector: 'img.logo', label: '', before: logo, after: moved }], scale: 2, covered: [] };
    expect(vanishedGraphics(before, after, layout)).toEqual([]);

    const gone = screenshot(WHITE);
    expect(vanishedGraphics(before, gone, { ...layout, covered: [] })).toHaveLength(1);
    expect(vanishedGraphics(before, gone, { ...layout, covered: [{ left: 0, top: 35, width: 100, height: 25 }] })).toEqual([]);
  });
});
