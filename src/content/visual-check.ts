import { collapseWhitespace, luminance, parseColor, redact, selectorHint, truncate, type Rgba } from './dom-utils';

/**
 * Checks whether a change left the page readable. The page is measured before the
 * first preview and again after each one; only problems the change caused are
 * reported, so the model doesn't chase issues the site already had.
 *
 * Only what is on screen is checked: the background behind text is read from the
 * elements actually painted under it (elementsFromPoint), which needs the viewport.
 */

/** Enough for a busy page's first screen, while keeping the check to tens of milliseconds. */
const MAX_TEXT_NODES = 1500;
/** Text nodes walked in all, on screen or not; big pages keep much of their DOM off screen. */
const MAX_WALKED_NODES = 40_000;
const MAX_ELEMENTS = 5000;
const MAX_CONTRAST_GROUPS = 6;
const MAX_SURFACES = 4;
const MAX_CLIPPED = 4;
const MAX_LOST_GROUPS = 5;
/** Images and icons followed between measurements, for the pixel check (panel/pixel-check.ts). */
const MAX_GRAPHICS = 300;
const MIN_GRAPHIC_SIZE = 8;
const GRAPHICS = 'img, svg, [role="img"], canvas, video';
/** A surface big enough to read as part of the page's theme, not a small chip or icon. */
const MIN_SURFACE_WIDTH = 120;
const MIN_SURFACE_HEIGHT = 32;
const MIN_SURFACE_SHARE = 0.015;

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
/** Chrome's canvas color for pages with a dark color-scheme and no background. */
const DARK_CANVAS: Rgba = { r: 18, g: 18, b: 18, a: 1 };
/** What paints its own pixels, so the color behind text on it can't be known from styles. */
const MEDIA = new Set(['IMG', 'VIDEO', 'CANVAS', 'IFRAME', 'SVG', 'PICTURE', 'EMBED', 'OBJECT']);
const SKIP_TEXT_IN = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'OPTION', 'TEMPLATE']);

/** WCAG contrast ratio of two opaque colors, from 1 (same) to 21 (black on white). */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Paint a possibly translucent color over an opaque one. */
export function blend(top: Rgba, bottom: Rgba): Rgba {
  const a = Math.max(0, Math.min(1, top.a));
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  };
}

/** WCAG: large text (24px, or 18.66px bold) needs 3:1, everything else 4.5:1. */
export function requiredContrast(fontSize: number, fontWeight: number): number {
  return fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700) ? 3 : 4.5;
}

export type Tone = 'light' | 'dark' | 'mid';

export function toneOf(color: Rgba): Tone {
  const l = luminance(color);
  return l >= 0.4 ? 'light' : l <= 0.12 ? 'dark' : 'mid';
}

export const formatColor = ({ r, g, b }: Rgba) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;

export interface TextSample {
  color: Rgba;
  background: Rgba;
  ratio: number;
  required: number;
}

/** Why text on screen can't be read, or can't be checked. */
export type Unreadable =
  | { reason: 'covered'; by: Element }
  | { reason: 'invisible' }
  | { reason: 'hidden' }
  /** On an image, video, or gradient: the color behind it can't be known from styles. */
  | { reason: 'unmeasurable' };

/** One look at the page. Element keys are only compared between two measurements of the same page. */
export interface Measurement {
  text: Map<Element, TextSample>;
  /** Text on screen that couldn't be sampled, and why. */
  unreadable: Map<Element, Unreadable>;
  /** Large opaque surfaces on screen, by their background color. */
  surfaces: Map<Element, Rgba>;
  /** The background most text sits on. */
  page: Rgba;
  /** How far the page now reaches past the right edge of the window, if it scrolls sideways. */
  overflow: { width: number; viewport: number; widest: Element | null } | null;
  /** Elements that cut off the text inside them. */
  clipped: Set<Element>;
  /** Images and icons on screen, where they are in the window. */
  graphics: Map<Element, Box>;
}

/** A rectangle in the window, in CSS pixels. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** An image or icon on screen before and after a change: where to look for it in each screenshot. */
export interface GraphicPair {
  selector: string;
  /** Alt text, label, or title, to say which one it is. */
  label: string;
  before: Box;
  after: Box;
}

export interface ContrastProblem {
  selector: string;
  text: string;
  color: string;
  background: string;
  ratio: number;
  required: number;
  count: number;
}

export interface VisualReport {
  /** Text elements on screen whose contrast could be measured. */
  checked: number;
  /** Text the change made hard to read, grouped by element and colors, worst first. */
  contrast: ContrastProblem[];
  /** Elements with contrast problems, including those beyond the groups listed. */
  contrastElements: number;
  /** Large surfaces that kept the page's old tone after the change flipped it (light to dark or back). */
  leftBehind: { selector: string; background: string; size: string }[];
  horizontalOverflow: { width: number; viewport: number; widest: string | null } | null;
  clipped: { selector: string; text: string }[];
  /** Text that was readable before the change and now can't be seen (or checked), grouped by why. */
  lost: LostText[];
  /** Elements that lost their text, including those beyond the groups listed. */
  lostElements: number;
  /**
   * Images and icons that showed before and now blend into what is behind them (a logo made for a
   * dark page, on a now light one). Found by comparing screenshots, so filled in by the panel.
   */
  vanished: { selector: string; label: string }[];
}

export interface LostText {
  reason: Unreadable['reason'];
  /** For covered text: what is painted over it. */
  by: string | null;
  selector: string;
  text: string;
  count: number;
}

export function hasProblems(report: VisualReport | null): boolean {
  return (
    report !== null &&
    (report.contrast.length > 0 ||
      report.lost.length > 0 ||
      report.leftBehind.length > 0 ||
      report.horizontalOverflow !== null ||
      report.clipped.length > 0 ||
      report.vanished.length > 0)
  );
}

/**
 * Measure the text and surfaces on screen. With the measurement from before a change, also
 * looks up the text that was readable then, so text the change hid is noticed too.
 */
export function measure(doc: Document, before?: Measurement | null): Measurement {
  const win = doc.defaultView!;
  const styles = new Map<Element, CSSStyleDeclaration>();
  const style = (el: Element) => {
    let s = styles.get(el);
    if (!s) styles.set(el, (s = win.getComputedStyle(el)));
    return s;
  };
  const viewport = { width: doc.documentElement.clientWidth || win.innerWidth, height: win.innerHeight };
  const canvas = canvasColor(doc, style);

  const text = new Map<Element, TextSample>();
  const unreadable = new Map<Element, Unreadable>();
  const clipped = new Set<Element>();
  const textBackgrounds = new Map<string, { color: Rgba; count: number }>();
  const range = doc.createRange();
  /** Where an element's text shows on screen, or null when none of it does. */
  const textRect = (el: Element): DOMRect | null => {
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE || !/\S/.test(node.textContent ?? '')) continue;
      range.selectNodeContents(node);
      const rect = Array.from(range.getClientRects()).find((r) => r.width > 1 && r.height > 1 && onScreen(r, viewport));
      if (rect) return rect;
    }
    return null;
  };
  if (doc.body) {
    // Skip whole subtrees that aren't rendered, so big pages reach the text that is.
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.nodeType === Node.ELEMENT_NODE && (SKIP_TEXT_IN.has((node as Element).tagName) || style(node as Element).display === 'none')
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    const visited = new Set<Element>();
    let sampled = 0;
    let walked = 0;
    for (let node = walker.nextNode(); node && sampled < MAX_TEXT_NODES && walked < MAX_WALKED_NODES; node = walker.nextNode()) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      walked++;
      const el = node.parentElement;
      if (!el || visited.has(el) || !/\S/.test(node.textContent ?? '')) continue;
      visited.add(el);
      const rect = textRect(el);
      if (!rect) continue;
      sampled++;
      if (notShown(el, style)) {
        unreadable.set(el, { reason: 'hidden' });
        continue;
      }
      const sample = sampleText(doc, el, rect, viewport, style, canvas);
      if ('reason' in sample) {
        unreadable.set(el, sample);
        continue;
      }
      text.set(el, sample);
      const key = formatColor(sample.background);
      const entry = textBackgrounds.get(key) ?? { color: sample.background, count: 0 };
      entry.count++;
      textBackgrounds.set(key, entry);
      const clip = clippingAncestor(el, style);
      if (clip) clipped.add(clip);
    }
  }

  // Text that was readable before and wasn't seen this time: hidden, or scrolled away.
  for (const el of before?.text.keys() ?? []) {
    if (text.has(el) || unreadable.has(el) || !el.isConnected) continue;
    if (el.getClientRects().length === 0 || notShown(el, style)) unreadable.set(el, { reason: 'hidden' });
  }

  const page = Array.from(textBackgrounds.values()).sort((a, b) => b.count - a.count)[0]?.color ?? canvas;
  const { surfaces, overflow } = scanBoxes(doc, viewport, style);
  return { text, unreadable, surfaces, page, overflow, clipped, graphics: findGraphics(doc, viewport, style) };
}

/** Images and icons fully on screen: the outermost one where they nest (an svg's own parts, a picture's img). */
function findGraphics(doc: Document, viewport: { width: number; height: number }, style: (el: Element) => CSSStyleDeclaration): Map<Element, Box> {
  const found = new Map<Element, Box>();
  for (const el of doc.querySelectorAll(GRAPHICS)) {
    if (found.size >= MAX_GRAPHICS) break;
    if (el.parentElement?.closest(GRAPHICS)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < MIN_GRAPHIC_SIZE || rect.height < MIN_GRAPHIC_SIZE) continue;
    if (rect.left < 0 || rect.top < 0 || rect.right > viewport.width || rect.bottom > viewport.height) continue;
    // Big pictures carry their own detail whatever is behind them; the check is for logos and icons.
    if (rect.width * rect.height > viewport.width * viewport.height * 0.25) continue;
    if (notShown(el, style)) continue;
    found.set(el, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  }
  return found;
}

/** How many ancestors to look through for screen-reader-only clipping. */
const CLIP_DEPTH = 4;

/**
 * Not painted for the eye: display, visibility, or clipped away like screen-reader-only text
 * ("Skip to main content"). Unlike the page outline's isHidden, aria-hidden doesn't count:
 * decorative logos and icons are usually marked aria-hidden and still show.
 */
function notShown(el: Element, style: (el: Element) => CSSStyleDeclaration): boolean {
  if (typeof el.checkVisibility === 'function') {
    if (!el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: false } as CheckVisibilityOptions)) return true;
  } else {
    const s = style(el);
    if (s.display === 'none' || s.visibility === 'hidden') return true;
  }
  for (let node: Element | null = el, depth = 0; node && depth < CLIP_DEPTH; node = node.parentElement, depth++) {
    if (clippedAway(style(node))) return true;
  }
  return false;
}

/**
 * The screen-reader-only patterns: clip: rect(1px, 1px, 1px, 1px), clip-path: inset(50%), or a
 * positioned 1px box that hides its overflow. (A static box doesn't clip positioned children,
 * so only positioned ones count.)
 */
export function clippedAway(s: Pick<CSSStyleDeclaration, 'position' | 'clip' | 'clipPath' | 'width' | 'height' | 'overflow'>): boolean {
  const positioned = s.position === 'absolute' || s.position === 'fixed';
  if (!positioned) return /^inset\((50|100)%\)$/.test(s.clipPath);
  if (s.clip.startsWith('rect(')) {
    const [top, right, bottom, left] = (s.clip.match(/-?[\d.]+/g) ?? []).map(Number);
    if (right !== undefined && left !== undefined && top !== undefined && bottom !== undefined && right - left <= 1 && bottom - top <= 1) return true;
  }
  if (/^inset\((50|100)%\)$/.test(s.clipPath)) return true;
  return parseFloat(s.width) <= 1 && parseFloat(s.height) <= 1 && s.overflow.includes('hidden');
}

/** Images and icons that showed both before and after a change, for comparing their pixels. */
export function graphicPairs(before: Measurement, after: Measurement): GraphicPair[] {
  const pairs: GraphicPair[] = [];
  for (const [el, box] of after.graphics) {
    const was = before.graphics.get(el);
    if (was) pairs.push({ selector: selectorHint(el), label: graphicLabel(el), before: was, after: box });
  }
  return pairs;
}

function graphicLabel(el: Element): string {
  const named =
    el.getAttribute('alt') || el.getAttribute('aria-label') || el.getAttribute('title') || el.querySelector(':scope > title')?.textContent || '';
  return truncate(collapseWhitespace(named), 40);
}

/** Compare the page after a change with how it was before, keeping only what the change made worse. */
export function compare(before: Measurement | null, after: Measurement): VisualReport {
  const groups = new Map<string, ContrastProblem & { order: number }>();
  let contrastElements = 0;
  for (const [el, sample] of after.text) {
    if (sample.ratio >= sample.required) continue;
    const was = before?.text.get(el);
    // The site's own low-contrast text stays out of it, unless the change made it clearly worse.
    if (was && was.ratio < was.required && sample.ratio > was.ratio * 0.8) continue;
    contrastElements++;
    const selector = selectorHint(el);
    const color = formatColor(sample.color);
    const background = formatColor(sample.background);
    const key = `${selector}|${color}|${background}`;
    const group = groups.get(key);
    if (group) {
      group.count++;
      group.ratio = Math.min(group.ratio, round(sample.ratio));
    } else {
      groups.set(key, {
        selector,
        text: describeText(el),
        color,
        background,
        ratio: round(sample.ratio),
        required: sample.required,
        count: 1,
        order: groups.size,
      });
    }
  }
  // The most widespread problems first, then the hardest to read.
  const contrast = Array.from(groups.values())
    .sort((a, b) => b.count - a.count || a.ratio - b.ratio || a.order - b.order)
    .slice(0, MAX_CONTRAST_GROUPS)
    .map(({ order: _order, ...problem }) => problem);

  const lost = new Map<string, LostText & { order: number }>();
  let lostElements = 0;
  for (const [el, why] of after.unreadable) {
    if (!before?.text.has(el)) continue;
    lostElements++;
    const by = why.reason === 'covered' ? selectorHint(why.by) : null;
    const selector = selectorHint(el);
    const key = `${why.reason}|${by}|${selector}`;
    const group = lost.get(key);
    if (group) group.count++;
    else lost.set(key, { reason: why.reason, by, selector, text: describeText(el), count: 1, order: lost.size });
  }

  return {
    checked: after.text.size,
    contrast,
    contrastElements,
    lost: Array.from(lost.values())
      .sort((a, b) => b.count - a.count || a.order - b.order)
      .slice(0, MAX_LOST_GROUPS)
      .map(({ order: _order, ...group }) => group),
    lostElements,
    leftBehind: before ? leftBehind(before, after) : [],
    horizontalOverflow:
      after.overflow && !before?.overflow
        ? { width: after.overflow.width, viewport: after.overflow.viewport, widest: after.overflow.widest ? selectorHint(after.overflow.widest) : null }
        : null,
    clipped: Array.from(after.clipped)
      .filter((el) => !before?.clipped.has(el))
      .slice(0, MAX_CLIPPED)
      .map((el) => ({ selector: selectorHint(el), text: describeText(el) })),
    vanished: [],
  };
}

/**
 * When a change flips the page between light and dark, large surfaces that matched the old
 * page and still do were probably missed (a search box left dark on a now light page).
 */
function leftBehind(before: Measurement, after: Measurement): VisualReport['leftBehind'] {
  const oldTone = toneOf(before.page);
  const newTone = toneOf(after.page);
  if (oldTone === 'mid' || newTone === 'mid' || oldTone === newTone) return [];
  const found: Element[] = [];
  for (const [el, color] of after.surfaces) {
    const was = before.surfaces.get(el);
    if (!was || toneOf(was) !== oldTone || toneOf(color) !== oldTone) continue;
    // Report the outermost surface; what's inside it goes with it.
    if (found.some((outer) => outer.contains(el))) continue;
    found.push(el);
    if (found.length >= MAX_SURFACES) break;
  }
  return found.map((el) => {
    const rect = el.getBoundingClientRect();
    return { selector: selectorHint(el), background: formatColor(after.surfaces.get(el)!), size: `${Math.round(rect.width)}×${Math.round(rect.height)}` };
  });
}

function sampleText(
  doc: Document,
  el: Element,
  rect: DOMRect,
  viewport: { width: number; height: number },
  style: (el: Element) => CSSStyleDeclaration,
  canvas: Rgba,
): TextSample | Unreadable {
  const s = style(el);
  const fontSize = parseFloat(s.fontSize);
  if (!(fontSize > 0)) return { reason: 'hidden' };
  // Text filled with a gradient or image (background-clip: text) has no single color.
  if (/text/.test(s.getPropertyValue('background-clip') || s.getPropertyValue('-webkit-background-clip'))) return { reason: 'unmeasurable' };
  const fill = parseColor(s.getPropertyValue('-webkit-text-fill-color') || s.color);
  const opacity = inheritedOpacity(el, style);
  if (!fill || fill.a * opacity < 0.05) return { reason: 'invisible' };

  const x = clamp(rect.left + rect.width / 2, 0, viewport.width - 1);
  const y = clamp(rect.top + rect.height / 2, 0, viewport.height - 1);
  const stack = doc.elementsFromPoint(x, y);
  // The text's own element, or (when it ignores the pointer) its nearest ancestor that doesn't.
  const index = stack.findIndex((e) => e === el || e.contains(el));
  // Under a pointer-events: none overlay that spans the page, or outside the stack for other reasons.
  if (index < 0) return { reason: 'unmeasurable' };
  // Something opaque painted over the text hides it.
  for (const over of stack.slice(0, index)) {
    if (el.contains(over)) continue;
    const os = style(over);
    if (MEDIA.has(over.tagName.toUpperCase()) || os.backgroundImage !== 'none' || (parseColor(os.backgroundColor)?.a ?? 0) * opacityOf(os) > 0.9) {
      return { reason: 'covered', by: over };
    }
  }

  const layers: Rgba[] = [];
  for (const under of stack.slice(index)) {
    if (under !== el && !under.contains(el) && MEDIA.has(under.tagName.toUpperCase())) return { reason: 'unmeasurable' };
    const us = style(under);
    if (us.backgroundImage !== 'none') return { reason: 'unmeasurable' };
    const bg = parseColor(us.backgroundColor);
    if (!bg || bg.a < 0.01) continue;
    const layer = { ...bg, a: bg.a * opacityOf(us) };
    layers.push(layer);
    if (layer.a >= 0.99) break;
  }
  const background = layers.reduceRight((below, layer) => blend(layer, below), canvas);
  const color = blend({ ...fill, a: fill.a * opacity }, background);
  return {
    color,
    background,
    ratio: contrastRatio(color, background),
    required: requiredContrast(fontSize, parseInt(s.fontWeight, 10) || 400),
  };
}

/** What shows where nothing is painted: the root's background, else the body's, else the color-scheme's canvas. */
function canvasColor(doc: Document, style: (el: Element) => CSSStyleDeclaration): Rgba {
  for (const el of [doc.documentElement, doc.body]) {
    if (!el) continue;
    const s = style(el);
    const bg = parseColor(s.backgroundColor);
    if (bg && bg.a > 0.01 && s.backgroundImage === 'none') return blend(bg, WHITE);
  }
  return style(doc.documentElement).colorScheme.includes('dark') ? DARK_CANVAS : WHITE;
}

function inheritedOpacity(el: Element, style: (el: Element) => CSSStyleDeclaration): number {
  let opacity = 1;
  for (let e: Element | null = el; e; e = e.parentElement) opacity *= opacityOf(style(e));
  return opacity;
}

function opacityOf(s: CSSStyleDeclaration): number {
  const value = parseFloat(s.opacity);
  return Number.isFinite(value) ? value : 1;
}

/** The nearest container (within a few levels) that hides overflowing text inside it. */
function clippingAncestor(el: Element, style: (el: Element) => CSSStyleDeclaration): Element | null {
  let e: Element | null = el;
  for (let depth = 0; e && depth < 4 && e !== e.ownerDocument.body; depth++, e = e.parentElement) {
    const s = style(e);
    const clipsX = /hidden|clip/.test(s.overflowX);
    const clipsY = /hidden|clip/.test(s.overflowY);
    if ((clipsY && e.scrollHeight > e.clientHeight + 2) || (clipsX && e.scrollWidth > e.clientWidth + 2)) return e;
  }
  return null;
}

/** Large painted surfaces on screen, and whether the page now scrolls sideways. */
function scanBoxes(
  doc: Document,
  viewport: { width: number; height: number },
  style: (el: Element) => CSSStyleDeclaration,
): Pick<Measurement, 'surfaces' | 'overflow'> {
  const root = doc.documentElement;
  const sideways = root.scrollWidth > root.clientWidth + 1 && ![root, doc.body].some((el) => el && /hidden|clip/.test(style(el).overflowX));
  const surfaces = new Map<Element, Rgba>();
  let widest: { el: Element; right: number } | null = null;
  const minArea = viewport.width * viewport.height * MIN_SURFACE_SHARE;
  const all = doc.body ? doc.body.getElementsByTagName('*') : [];
  for (let i = 0; i < Math.min(all.length, MAX_ELEMENTS); i++) {
    const el = all[i]!;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (sideways && rect.right > root.clientWidth + 1 && (!widest || rect.right > widest.right)) widest = { el, right: rect.right };
    if (rect.width < MIN_SURFACE_WIDTH || rect.height < MIN_SURFACE_HEIGHT || !onScreen(rect, viewport)) continue;
    const visibleArea =
      (Math.min(rect.right, viewport.width) - Math.max(rect.left, 0)) * (Math.min(rect.bottom, viewport.height) - Math.max(rect.top, 0));
    if (visibleArea < minArea) continue;
    const s = style(el);
    if (s.backgroundImage !== 'none' || s.visibility === 'hidden') continue;
    const bg = parseColor(s.backgroundColor);
    if (bg && bg.a >= 0.9) surfaces.set(el, { ...bg, a: 1 });
  }
  return {
    surfaces,
    overflow: sideways ? { width: root.scrollWidth, viewport: root.clientWidth, widest: widest?.el ?? null } : null,
  };
}

function onScreen(rect: { left: number; top: number; right: number; bottom: number }, viewport: { width: number; height: number }): boolean {
  return rect.bottom > 0 && rect.right > 0 && rect.top < viewport.height && rect.left < viewport.width;
}

function describeText(el: Element): string {
  return redact(truncate(collapseWhitespace(el.textContent ?? ''), 50));
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
// Rounded down, so a ratio just under the bar never reads as meeting it.
const round = (ratio: number) => Math.floor(ratio * 10) / 10;
