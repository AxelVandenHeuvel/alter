import { BRAND } from '../lib/brand';
import { collapseWhitespace, isHidden, redact, selectorHint, truncate } from './dom-utils';

/**
 * Letting the user point at part of the page: drag a box, or click an element.
 * The result is the area (for the screenshot) plus the page elements inside it,
 * so the model knows exactly what "this" means.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AreaElement {
  selectorHint: string;
  tag: string;
  text: string;
  attributes: Record<string, string>;
  rect: Rect;
}

export interface AreaSelection {
  /** In CSS pixels, relative to the viewport. */
  rect: Rect;
  devicePixelRatio: number;
  /** The smallest element that contains the whole area. */
  container: AreaElement | null;
  /** The visible elements inside the area, in page order. */
  elements: AreaElement[];
}

const MAX_ELEMENTS = 24;
const MIN_DRAG = 6;
const KEPT_ATTRIBUTES = ['id', 'name', 'type', 'placeholder', 'aria-label', 'role', 'maxlength', 'size', 'data-testid', 'href'];

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
}

function describe(el: Element): AreaElement {
  const attributes: Record<string, string> = {};
  for (const name of KEPT_ATTRIBUTES) {
    const value = el.getAttribute(name);
    if (value !== null) attributes[name] = redact(truncate(value, 60));
  }
  return {
    selectorHint: selectorHint(el),
    tag: el.tagName.toLowerCase(),
    // Never what the user typed into form fields; only the page's own text.
    text: el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? '' : redact(truncate(collapseWhitespace(el.textContent ?? ''), 80)),
    attributes,
    rect: rectOf(el),
  };
}

function overlapRatio(inner: DOMRect, area: Rect): number {
  const width = Math.min(inner.right, area.x + area.width) - Math.max(inner.left, area.x);
  const height = Math.min(inner.bottom, area.y + area.height) - Math.max(inner.top, area.y);
  if (width <= 0 || height <= 0 || inner.width === 0 || inner.height === 0) return 0;
  return (width * height) / (inner.width * inner.height);
}

const isAlterUi = (el: Element) => el.closest('[data-alter-widget], [data-alter-focus], [data-alter-select]') !== null;

/** What's inside an area of the viewport: its container, and the elements mostly within it. */
export function describeArea(doc: Document, rect: Rect): AreaSelection {
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  let container: Element | null =
    doc.elementsFromPoint(center.x, center.y).find((el) => !isAlterUi(el) && el !== doc.documentElement) ?? null;
  while (container && container.parentElement) {
    const r = container.getBoundingClientRect();
    if (r.left <= rect.x + 1 && r.top <= rect.y + 1 && r.right >= rect.x + rect.width - 1 && r.bottom >= rect.y + rect.height - 1) break;
    container = container.parentElement;
  }

  const inside: Element[] = [];
  const root = container ?? doc.body;
  if (root) {
    for (const el of root.querySelectorAll('*')) {
      if (isAlterUi(el) || isHidden(el)) continue;
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|svg|path)$/i.test(el.tagName)) continue;
      if (overlapRatio(el.getBoundingClientRect(), rect) < 0.6) continue;
      inside.push(el);
      if (inside.length > MAX_ELEMENTS * 4) break;
    }
  }
  // Skip wrappers that only hold other selected elements, but keep anything interactive.
  const leaves = inside.filter((el) => !inside.some((other) => other !== el && el.contains(other)) || el.matches('input, select, textarea, button, a, img, label'));
  return {
    rect,
    devicePixelRatio: doc.defaultView?.devicePixelRatio ?? 1,
    container: container && container !== doc.body && container !== doc.documentElement ? describe(container) : null,
    elements: leaves.slice(0, MAX_ELEMENTS).map(describe),
  };
}

const OVERLAY_STYLES = `
:host { all: initial; }
.layer { position: fixed; inset: 0; cursor: crosshair; background: rgba(15, 15, 25, 0.18); }
.box, .hover {
  position: fixed;
  /* A white line with dark edges shows on light and dark pages alike. */
  border: 2px solid #fff;
  outline: 1px solid ${BRAND.accent};
  box-shadow: inset 0 0 0 1px ${BRAND.accent};
  background: rgba(${BRAND.accentRgb}, 0.14);
  border-radius: 4px;
  pointer-events: none;
  box-sizing: border-box;
}
.hover { border-style: dashed; background: rgba(${BRAND.accentRgb}, 0.07); }
.hint {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 14px;
  border-radius: 999px;
  background: #17171c;
  color: #fff;
  font: 500 13px/1.2 ${BRAND.font};
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
  pointer-events: none;
}
`;

/**
 * Show a crosshair over the page and let the user drag a box or click an element.
 * Resolves with the chosen area (viewport CSS pixels), or null if they press Escape.
 * The overlay is gone by the time this resolves, so a screenshot won't include it.
 */
export function pickArea(doc: Document): Promise<Rect | null> {
  return new Promise((resolve) => {
    const host = doc.createElement('div');
    host.setAttribute('data-alter-select', '');
    host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = doc.createElement('style');
    style.textContent = OVERLAY_STYLES;
    const layer = doc.createElement('div');
    layer.className = 'layer';
    const box = doc.createElement('div');
    box.className = 'box';
    box.hidden = true;
    const hover = doc.createElement('div');
    hover.className = 'hover';
    hover.hidden = true;
    const hint = doc.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Drag over what you mean, or click an element. Esc to cancel.';
    root.append(style, layer, hover, box, hint);
    doc.documentElement.append(host);
    // Take the keyboard from Alter's panel (where the click happened) so Escape reaches us.
    layer.tabIndex = -1;
    layer.style.outline = 'none';
    layer.focus();

    let start: { x: number; y: number } | null = null;
    let current: Rect | null = null;

    // The element under the pointer, ignoring the overlay itself.
    const elementAt = (x: number, y: number) =>
      doc.elementsFromPoint(x, y).find((el) => !isAlterUi(el) && el !== doc.documentElement && el !== doc.body) ?? null;
    const show = (el: HTMLElement, r: Rect) => {
      el.hidden = false;
      Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
    };

    const finish = (result: Rect | null) => {
      host.remove();
      doc.removeEventListener('keydown', onKey, true);
      resolve(result);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      finish(null);
    };
    doc.addEventListener('keydown', onKey, true);

    layer.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      layer.setPointerCapture(event.pointerId);
      start = { x: event.clientX, y: event.clientY };
      hover.hidden = true;
    });
    layer.addEventListener('pointermove', (event) => {
      if (!start) {
        const target = elementAt(event.clientX, event.clientY);
        if (target) show(hover, rectOf(target));
        else hover.hidden = true;
        return;
      }
      current = {
        x: Math.min(start.x, event.clientX),
        y: Math.min(start.y, event.clientY),
        width: Math.abs(event.clientX - start.x),
        height: Math.abs(event.clientY - start.y),
      };
      show(box, current);
    });
    layer.addEventListener('pointerup', (event) => {
      if (!start) return;
      const dragged = current && current.width >= MIN_DRAG && current.height >= MIN_DRAG;
      if (dragged) return finish(current);
      // A click picks the element under the pointer.
      const target = elementAt(event.clientX, event.clientY);
      finish(target ? rectOf(target) : null);
    });
  });
}
