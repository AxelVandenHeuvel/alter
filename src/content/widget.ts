import { BRAND } from '../lib/brand';
import { getSettings, SETTINGS_KEY, type Look } from '../lib/settings';

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

/*
 * The other looks (Settings > Look), matching the panel. Textures are gradients only: a page's
 * content security policy can block data: images, and these styles live in the page.
 */
.card[data-look='patchwork'] { background: #2f5e4b; border-color: rgba(0, 0, 0, 0.25); }
.card[data-look='selvedge'] { background: #0e1626; border-color: rgba(0, 0, 0, 0.4); }
.pill[data-look]:focus-visible { outline: 0; box-shadow: 0 0 0 2px #fff, 0 0 0 4px #17171c; }

/* Patchwork: a denim patch, sewn on with gold thread. */
.pill[data-look='patchwork'] {
  height: 40px;
  padding: 0 17px 0 11px;
  border: 0;
  background:
    repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.07) 0 1px, transparent 1px 3px),
    repeating-linear-gradient(45deg, rgba(0, 0, 0, 0.08) 0 1px, transparent 1px 4px),
    #3b5876;
  color: #f5efe3;
  font: 600 14px/1 'American Typewriter', 'Courier Prime', 'Courier New', monospace;
  outline: 1.5px dashed #d9a441;
  outline-offset: -5px;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.2), 0 6px 18px rgba(16, 16, 24, 0.28);
}
.pill[data-look='patchwork']:hover { background-color: #45668a; }
@media (prefers-color-scheme: dark) {
  .card[data-look='patchwork'] { background: #1b3a2e; }
  .pill[data-look='patchwork'] { background-color: #22344a; }
  .pill[data-look='patchwork']:hover { background-color: #2b4160; }
}

/* Selvedge: a cognac leather patch with the name pressed in. */
.pill[data-look='selvedge'] {
  gap: 9px;
  height: 40px;
  padding: 0 16px 0 10px;
  border: 0;
  border-radius: 5px;
  background:
    radial-gradient(ellipse at 30% 15%, rgba(255, 230, 200, 0.12), transparent 65%),
    repeating-linear-gradient(37deg, rgba(0, 0, 0, 0.07) 0 1px, transparent 1px 3px),
    #6b4023;
  color: #f3e2c4;
  font: 700 12px/1 Rockwell, 'Roboto Slab', 'American Typewriter', Georgia, serif;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  text-shadow: 0 -1px 0 rgba(0, 0, 0, 0.45);
  outline: 1px dashed rgba(243, 226, 196, 0.45);
  outline-offset: -4px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25), 0 6px 18px rgba(0, 0, 0, 0.35);
}
.pill[data-look='selvedge']:hover { background-color: #7a4b2a; }
/* Capitals trimmed to their own height, so they sit dead center. */
.pill[data-look='selvedge'] span { text-box: trim-both cap alphabetic; }
/* The safety pin is steel; brighten it on the dark leather and denim. */
.pill[data-look='patchwork'] img,
.pill[data-look='selvedge'] img { filter: brightness(1.7) drop-shadow(0 1px 1px rgba(0, 0, 0, 0.45)); }
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
    chrome.storage.onChanged.removeListener(this.onStorageChanged);
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
    this.applyLook((await getSettings()).look);
    chrome.storage.onChanged.addListener(this.onStorageChanged);
  }

  /** Dress the frame and the minimized button like the panel. Kept inside the closed shadow root, out of the page's sight. */
  private applyLook(look: Look): void {
    for (const el of [this.card, this.pill]) {
      if (!el) continue;
      if (look === 'plain') delete el.dataset.look;
      else el.dataset.look = look;
    }
  }

  private onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes[SETTINGS_KEY] && this.host) void getSettings().then((settings) => this.applyLook(settings.look));
  };

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
