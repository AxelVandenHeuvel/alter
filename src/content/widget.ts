import { BRAND } from '../lib/brand';

/**
 * Alter's floating panel on the page. The panel UI itself is the extension page
 * panel.html, loaded in an iframe: it runs in the extension's origin, so the site
 * can't read the conversation or reach the API key, and the page layout never
 * shifts the way Chrome's side panel makes it. This file only positions that frame,
 * lets the user drag it, and shrinks it to a small button.
 */

const WIDTH = 380;
const MAX_HEIGHT = 640;
const MARGIN = 16;
/** The draggable part of the panel's header: left of the action buttons, right of the back button. */
const DRAG_LEFT = 44;
const DRAG_RIGHT_GAP = 144;
const HEADER_HEIGHT = 48;
const POSITION_KEY = 'widgetPosition';
/** The minimized button always sits in the window's bottom-right corner, wherever the panel was dragged. */
const PILL_INSET = 20;

type Position = { right: number; bottom: number };

const STYLES = `
:host { all: initial; }
.card {
  position: fixed;
  width: ${WIDTH}px;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 16px 48px rgba(16, 16, 20, 0.18), 0 2px 6px rgba(16, 16, 20, 0.08);
  border: 1px solid rgba(16, 16, 20, 0.1);
  background: #fff;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  .card { background: #111113; border-color: rgba(255, 255, 255, 0.1); box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5); color-scheme: dark; }
}
.card.hidden, .pill.hidden { display: none; }
iframe { display: block; width: 100%; height: 100%; border: 0; background: transparent; }
.drag {
  position: absolute;
  top: 0;
  left: ${DRAG_LEFT}px;
  right: ${DRAG_RIGHT_GAP}px;
  height: ${HEADER_HEIGHT}px;
  cursor: grab;
}
.dragging .drag { cursor: grabbing; }
/* While dragging, the frame mustn't swallow pointer events. */
.dragging iframe { pointer-events: none; }
.pill {
  position: fixed;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 38px;
  padding: 0 14px 0 9px;
  border: 1px solid rgba(16, 16, 24, 0.12);
  border-radius: 999px;
  background: #fff;
  color: #17171c;
  font: 600 13px/1 ${BRAND.font};
  box-shadow: 0 6px 20px rgba(16, 16, 24, 0.18);
  cursor: pointer;
}
.pill img { width: 22px; height: 22px; display: block; }
.pill:hover { background: #f4f4f6; }
.pill:focus-visible { outline: 2px solid ${BRAND.accent}; outline-offset: 2px; }
@media (prefers-color-scheme: dark) {
  .pill { background: #1f1f24; color: #ececf1; border-color: rgba(255, 255, 255, 0.14); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45); }
  .pill:hover { background: #2a2a31; }
  .pill:focus-visible { outline-color: ${BRAND.accentOnDark}; }
}
`;

export type WidgetState = 'closed' | 'open' | 'minimized';
export type WidgetAction = 'open' | 'toggle' | 'minimize' | 'close' | 'reveal';

export class Widget {
  private host: HTMLElement | null = null;
  private card: HTMLElement | null = null;
  private frame: HTMLIFrameElement | null = null;
  private pill: HTMLButtonElement | null = null;
  private position: Position = { right: 20, bottom: 20 };
  private stateValue: WidgetState = 'closed';

  constructor(private readonly doc: Document) {}

  get state(): WidgetState {
    return this.stateValue;
  }

  async perform(action: WidgetAction, tabId: number): Promise<void> {
    switch (action) {
      case 'open':
        return this.open(tabId);
      case 'toggle':
        return this.toggle(tabId);
      case 'minimize':
        return this.minimize();
      case 'close':
        return this.close();
      case 'reveal':
        return this.reveal();
    }
  }

  /** Show the panel (creating it on first use) and put the cursor in its message box. */
  async open(tabId: number): Promise<void> {
    if (!this.host) await this.create(tabId);
    this.stateValue = 'open';
    this.card!.classList.remove('hidden');
    this.pill!.classList.add('hidden');
    // The host is never moved after creation: moving an iframe in the DOM reloads it,
    // which would throw away the panel's state (including a request in progress).
    this.place();
    this.focus();
  }

  async toggle(tabId: number): Promise<void> {
    if (this.stateValue === 'open') this.close();
    else await this.open(tabId);
  }

  minimize(): void {
    if (!this.host) return;
    this.stateValue = 'minimized';
    this.card!.classList.add('hidden');
    this.pill!.classList.remove('hidden');
    this.place();
  }

  /** Where the panel (or its button) covers the page, so screenshots of the page can leave those parts out. */
  covered(): DOMRect[] {
    return [this.card, this.pill].filter((el) => el && !el.classList.contains('hidden')).map((el) => el!.getBoundingClientRect());
  }

  /** Remove the panel. The conversation is kept by the extension and comes back on reopen. */
  close(): void {
    this.host?.remove();
    this.host = this.card = this.frame = this.pill = null;
    this.stateValue = 'closed';
    removeEventListener('resize', this.onResize);
  }

  /** Hide the panel without closing it (its frame keeps running), e.g. while taking a screenshot. */
  conceal(): void {
    if (this.card) this.card.style.visibility = 'hidden';
    if (this.pill) this.pill.style.visibility = 'hidden';
  }

  reveal(): void {
    if (this.card) this.card.style.visibility = '';
    if (this.pill) this.pill.style.visibility = '';
    if (this.stateValue === 'open') this.focus();
  }

  /** Give the panel's frame the keyboard; the panel then focuses its message box. */
  focus(): void {
    this.frame?.focus();
    this.frame?.contentWindow?.postMessage({ type: 'alter:focus' }, '*');
  }

  private async create(tabId: number): Promise<void> {
    const stored = (await chrome.storage.local.get(POSITION_KEY))[POSITION_KEY] as Position | undefined;
    if (stored) this.position = stored;

    const host = this.doc.createElement('div');
    host.setAttribute('data-alter-widget', '');
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = this.doc.createElement('style');
    style.textContent = STYLES;

    const card = this.doc.createElement('div');
    card.className = 'card';
    const frame = this.doc.createElement('iframe');
    frame.src = chrome.runtime.getURL(`/panel.html?tabId=${tabId}&embedded=1`);
    frame.title = 'Alter';
    frame.setAttribute('allow', 'clipboard-write');
    const drag = this.doc.createElement('div');
    drag.className = 'drag';
    drag.title = 'Drag to move';
    card.append(frame, drag);

    const pill = this.doc.createElement('button');
    pill.type = 'button';
    pill.className = 'pill hidden';
    const logo = this.doc.createElement('img');
    logo.src = chrome.runtime.getURL('/icon/48.png');
    logo.alt = '';
    const label = this.doc.createElement('span');
    label.textContent = 'Alter';
    pill.append(logo, label);
    pill.addEventListener('click', () => void this.open(tabId));

    root.append(style, card, pill);
    this.doc.documentElement.append(host);
    this.host = host;
    this.card = card;
    this.frame = frame;
    this.pill = pill;
    this.enableDragging(drag, card);
    addEventListener('resize', this.onResize);
  }

  private onResize = () => this.place();

  /** Keep the panel inside the window, at the remembered spot; the button stays in the corner. */
  private place(): void {
    if (!this.card || !this.pill) return;
    const height = Math.min(MAX_HEIGHT, innerHeight - 2 * MARGIN);
    const right = clamp(this.position.right, MARGIN, innerWidth - WIDTH - MARGIN);
    const bottom = clamp(this.position.bottom, MARGIN, innerHeight - height - MARGIN);
    Object.assign(this.card.style, { right: `${right}px`, bottom: `${bottom}px`, height: `${height}px` });
    Object.assign(this.pill.style, { right: `${PILL_INSET}px`, bottom: `${PILL_INSET}px` });
  }

  private enableDragging(handle: HTMLElement, card: HTMLElement): void {
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      card.classList.add('dragging');
      const start = { x: event.clientX, y: event.clientY, ...this.position };
      const move = (e: PointerEvent) => {
        this.position = { right: start.right - (e.clientX - start.x), bottom: start.bottom - (e.clientY - start.y) };
        this.place();
      };
      const end = () => {
        card.classList.remove('dragging');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
        // Remember where it was dropped, kept inside the window.
        const rect = card.getBoundingClientRect();
        this.position = { right: innerWidth - rect.right, bottom: innerHeight - rect.bottom };
        void chrome.storage.local.set({ [POSITION_KEY]: this.position });
        this.focus();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}
