import { describe, expect, it } from 'vitest';
import type { Rgba } from '../../src/content/dom-utils';
import {
  blend,
  clippedAway,
  compare,
  contrastRatio,
  graphicPairs,
  hasProblems,
  requiredContrast,
  toneOf,
  type Measurement,
  type TextSample,
  type Unreadable,
} from '../../src/content/visual-check';
import { visualNotes } from '../../src/agent/reports';

const rgb = (r: number, g: number, b: number, a = 1): Rgba => ({ r, g, b, a });
const WHITE = rgb(255, 255, 255);
const BLACK = rgb(0, 0, 0);
const DARK = rgb(32, 33, 36);
const LIGHT_TEXT = rgb(232, 234, 237);

function sample(color: Rgba, background: Rgba, required = 4.5): TextSample {
  return { color, background, ratio: contrastRatio(color, background), required };
}

function measurement(parts: Partial<Measurement> = {}): Measurement {
  return { text: new Map(), unreadable: new Map(), surfaces: new Map(), page: WHITE, overflow: null, clipped: new Set(), graphics: new Map(), ...parts };
}

/** An element in a fixture container, so its selector hint reads "main#t > …". */
function el(html: string): Element {
  let host = document.getElementById('t');
  if (!host) {
    host = document.createElement('main');
    host.id = 't';
    document.body.append(host);
  }
  const template = document.createElement('template');
  template.innerHTML = html;
  const node = template.content.firstElementChild!;
  host.append(node);
  return node;
}

describe('contrast math', () => {
  it('matches the WCAG ratios', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5);
    expect(contrastRatio(WHITE, WHITE)).toBe(1);
    expect(contrastRatio(rgb(118, 118, 118), WHITE)).toBeCloseTo(4.54, 2);
  });

  it('blends translucent colors over what is below', () => {
    expect(blend(rgb(0, 0, 0, 0.5), WHITE)).toEqual(rgb(127.5, 127.5, 127.5));
    expect(blend(rgb(10, 20, 30, 1), WHITE)).toEqual(rgb(10, 20, 30));
  });

  it('asks less of large and bold text', () => {
    expect(requiredContrast(16, 400)).toBe(4.5);
    expect(requiredContrast(24, 400)).toBe(3);
    expect(requiredContrast(19, 700)).toBe(3);
    expect(requiredContrast(19, 400)).toBe(4.5);
  });

  it('sorts colors into light, dark, and in between', () => {
    expect(toneOf(WHITE)).toBe('light');
    expect(toneOf(DARK)).toBe('dark');
    expect(toneOf(rgb(128, 128, 128))).toBe('mid');
  });
});

describe('compare', () => {
  it('reports text the change made unreadable, grouped and worst first', () => {
    const snippet = el('<div class="result"><span class="snippet">You can install it</span></div>').querySelector('.snippet')!;
    const snippet2 = el('<div class="result"><span class="snippet">Another</span></div>').querySelector('.snippet')!;
    const title = el('<h3 class="title">Faint title</h3>');
    const before = measurement({
      page: DARK,
      text: new Map([
        [snippet, sample(LIGHT_TEXT, DARK)],
        [snippet2, sample(LIGHT_TEXT, DARK)],
        [title, sample(rgb(200, 200, 200), DARK)],
      ]),
    });
    const after = measurement({
      text: new Map([
        [snippet, sample(LIGHT_TEXT, WHITE)],
        [snippet2, sample(LIGHT_TEXT, WHITE)],
        [title, sample(rgb(150, 150, 150), WHITE, 3)],
      ]),
    });
    const report = compare(before, after);
    expect(report.checked).toBe(3);
    expect(report.contrastElements).toBe(3);
    expect(report.contrast).toEqual([
      { selector: 'main#t > div.result > span.snippet', text: 'You can install it', color: 'rgb(232, 234, 237)', background: 'rgb(255, 255, 255)', ratio: 1.2, required: 4.5, count: 2 },
      { selector: 'main#t > h3.title', text: 'Faint title', color: 'rgb(150, 150, 150)', background: 'rgb(255, 255, 255)', ratio: 2.9, required: 3, count: 1 },
    ]);
  });

  it('leaves out low contrast the site already had, unless the change made it clearly worse', () => {
    const same = el('<p class="same">Same</p>');
    const worse = el('<p class="worse">Worse</p>');
    const before = measurement({
      text: new Map([
        [same, sample(rgb(150, 150, 150), WHITE)],
        [worse, sample(rgb(150, 150, 150), WHITE)],
      ]),
    });
    const after = measurement({
      text: new Map([
        [same, sample(rgb(152, 152, 152), WHITE)],
        [worse, sample(rgb(220, 220, 220), WHITE)],
      ]),
    });
    expect(compare(before, after).contrast.map((p) => p.selector)).toEqual(['main#t > p.worse']);
  });

  it('reports text that was readable before and now cannot be seen, by why', () => {
    const results = [1, 2, 3].map((i) => el(`<h3 class="result">Result ${i}</h3>`));
    const faded = el('<p class="faded">Faded</p>');
    const overlay = el('<div class="overlay"></div>');
    const alreadyCovered = el('<p class="under-banner">Under the banner</p>');
    const before = measurement({
      text: new Map([...results, faded].map((e) => [e, sample(BLACK, WHITE)])),
      unreadable: new Map([[alreadyCovered, { reason: 'covered', by: overlay }]]),
    });
    const after = measurement({
      unreadable: new Map<Element, Unreadable>([
        ...results.map((e): [Element, Unreadable] => [e, { reason: 'covered', by: overlay }]),
        [faded, { reason: 'invisible' }],
        [alreadyCovered, { reason: 'covered', by: overlay }],
      ]),
    });
    const report = compare(before, after);
    expect(report.lostElements).toBe(4);
    expect(report.lost).toEqual([
      { reason: 'covered', by: 'main#t > div.overlay', selector: 'main#t > h3.result', text: 'Result 1', count: 3 },
      { reason: 'invisible', by: null, selector: 'main#t > p.faded', text: 'Faded', count: 1 },
    ]);
    expect(hasProblems(report)).toBe(true);
  });

  it('counts text that was not on the page before, like text a script added', () => {
    const added = el('<span class="added">New</span>');
    expect(compare(measurement(), measurement({ text: new Map([[added, sample(WHITE, WHITE)]]) })).contrastElements).toBe(1);
  });

  it('finds large surfaces left in the old tone when the page flips', () => {
    const box = el('<div class="composer"><div class="inner">Ask anything</div></div>');
    const inner = box.firstElementChild!;
    const card = el('<div class="card">Card</div>');
    const before = measurement({ page: DARK, surfaces: new Map([[box, DARK], [inner, DARK], [card, DARK]]) });
    const after = measurement({ page: WHITE, surfaces: new Map([[box, DARK], [inner, DARK], [card, rgb(245, 245, 245)]]) });
    const report = compare(before, after);
    expect(report.leftBehind.map((s) => s.selector)).toEqual(['main#t > div.composer']);
    expect(report.leftBehind[0]!.background).toBe('rgb(32, 33, 36)');

    // Without a flip, dark surfaces on a dark page are just the design.
    expect(compare(before, measurement({ page: DARK, surfaces: after.surfaces })).leftBehind).toEqual([]);
  });

  it('reports sideways scrolling and cut-off text only when the change caused them', () => {
    const wide = el('<div class="wide"></div>');
    const clip = el('<div class="clip">Long text</div>');
    const oldClip = el('<div class="old">Was cut</div>');
    const before = measurement({ clipped: new Set([oldClip]) });
    const after = measurement({ overflow: { width: 1500, viewport: 1280, widest: wide }, clipped: new Set([clip, oldClip]) });
    const report = compare(before, after);
    expect(report.horizontalOverflow).toEqual({ width: 1500, viewport: 1280, widest: 'main#t > div.wide' });
    expect(report.clipped).toEqual([{ selector: 'main#t > div.clip', text: 'Long text' }]);
    expect(compare(after, after).horizontalOverflow).toBeNull();
    expect(hasProblems(compare(after, after))).toBe(false);
  });
});

describe('clippedAway', () => {
  const box = { position: 'absolute', clip: 'auto', clipPath: 'none', width: '106px', height: '40px', overflow: 'visible' };
  it('recognizes screen-reader-only text, which is not on screen to read', () => {
    // Google's "Skip to main content" link and hidden "Search Results" heading.
    expect(clippedAway({ ...box, clip: 'rect(1px, 1px, 1px, 1px)', overflow: 'hidden' })).toBe(true);
    expect(clippedAway({ ...box, clip: 'rect(0px, 0px, 0px, 0px)' })).toBe(true);
    expect(clippedAway({ ...box, position: 'static', clipPath: 'inset(50%)' })).toBe(true);
    expect(clippedAway({ ...box, width: '1px', height: '1px', overflow: 'hidden' })).toBe(true);
  });

  it('leaves alone what still shows', () => {
    expect(clippedAway(box)).toBe(false);
    expect(clippedAway({ ...box, clip: 'rect(0px, 200px, 40px, 0px)' })).toBe(false);
    // A static empty box doesn't clip the positioned text inside it.
    expect(clippedAway({ ...box, position: 'static', width: '0px', height: '0px', overflow: 'hidden' })).toBe(false);
  });
});

describe('graphicPairs', () => {
  it('pairs the images and icons on screen both before and after, with a name for each', () => {
    const logo = el('<img class="logo" alt="Google">');
    const gone = el('<svg class="spinner"></svg>');
    const added = el('<img class="new">');
    const box = (top: number) => ({ left: 0, top, width: 20, height: 20 });
    const pairs = graphicPairs(
      measurement({ graphics: new Map([[logo, box(0)], [gone, box(30)]]) }),
      measurement({ graphics: new Map([[logo, box(10)], [added, box(40)]]) }),
    );
    expect(pairs).toEqual([{ selector: 'main#t > img.logo', label: 'Google', before: box(0), after: box(10) }]);
  });
});

describe('visualNotes', () => {
  const clean = compare(null, measurement({ text: new Map([[el('<p>Hi</p>'), sample(BLACK, WHITE)]]) }));

  it('says the check passed, or nothing when it could not run', () => {
    expect(visualNotes(clean, true)).toEqual(['Visual check passed (1 text element on screen): text is readable and nothing overflows.']);
    expect(visualNotes(null, true)).toEqual([]);
  });

  it('lists each problem and what to do', () => {
    const text = visualNotes(
      {
        checked: 40,
        contrast: [{ selector: 'span.snippet', text: 'You can', color: 'rgb(232, 234, 237)', background: 'rgb(255, 255, 255)', ratio: 1.2, required: 4.5, count: 30 }],
        contrastElements: 34,
        lost: [{ reason: 'covered', by: 'div.overlay', selector: 'h3.title', text: 'Result', count: 9 }],
        lostElements: 9,
        leftBehind: [{ selector: 'div.composer', background: 'rgb(48, 49, 52)', size: '680×56' }],
        horizontalOverflow: { width: 1500, viewport: 1280, widest: null },
        clipped: [{ selector: 'h3.title', text: 'Long title' }],
        vanished: [{ selector: 'img.logo', label: 'Google' }],
      },
      true,
    ).join('\n');
    expect(text).toContain('Text that is now hard to read (34 elements):');
    expect(text).toContain('- 30 elements like span.snippet ("You can"): rgb(232, 234, 237) on rgb(255, 255, 255) is 1.2:1, needs 4.5:1');
    expect(text).toContain('- and 4 more elements like these');
    expect(text).toContain('Text that was readable before your change can no longer be seen (9 elements):');
    expect(text).toContain('- 9 elements like h3.title ("Result"): now covered by div.overlay');
    expect(text).toContain('Kept the old look while the page changed tone: div.composer (680×56, background rgb(48, 49, 52))');
    expect(text).toContain('The page now scrolls sideways: it is 1500px wide in a 1280px window.');
    expect(text).toContain('Text is now cut off inside h3.title ("Long title")');
    expect(text).toContain('- img.logo ("Google")');
    expect(text).toMatch(/fill or color for SVG icons/);
    expect(text).toMatch(/Fix these with another propose_patch/);
  });
});
