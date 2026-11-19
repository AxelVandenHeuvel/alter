import type { FocusStatus } from '../../lib/messages';
import { FOCUS_OFF, type FocusSettings } from '../../lib/patches';
import { extractArticle, extractRecipe, type Article, type Recipe } from './extract';
import { safeUrl, sanitizeArticleHtml } from './sanitize';
import { FOCUS_STYLES } from './styles';

/** Content often renders after load (single-page apps); look again a few times before giving up. */
const RETRY_DELAYS_MS = [800, 2000, 4000];

type Found = { view: 'recipe'; recipe: Recipe; fellBack: false } | { view: 'reader'; article: Article; fellBack: boolean };

/**
 * The reader and recipe views: a full-page reading layer over the site. It lives
 * in a closed shadow root, so the page's styles and scripts can't reach it and
 * Dark Reader leaves it alone (it has its own themes).
 */
export class FocusView {
  private settings: FocusSettings = FOCUS_OFF;
  private status: FocusStatus = { state: 'off' };
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private reopen: HTMLElement | null = null;
  /** The page URL the user closed the view on; it stays closed there until they reopen it. */
  private closedAt: string | null = null;
  private url: string;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private navigationTimer: ReturnType<typeof setInterval> | undefined;
  private savedOverflow: string | null = null;

  constructor(private readonly doc: Document) {
    this.url = doc.location.href;
  }

  get state(): FocusStatus {
    return this.status;
  }

  set(next: FocusSettings): void {
    const same =
      next.mode === this.settings.mode && next.theme === this.settings.theme && next.textSize === this.settings.textSize;
    if (same) return;
    this.settings = next;
    this.closedAt = null;
    this.refresh();
  }

  destroy(): void {
    this.settings = FOCUS_OFF;
    this.unmount();
    clearTimeout(this.retryTimer);
    clearInterval(this.navigationTimer);
    this.navigationTimer = undefined;
    this.status = { state: 'off' };
  }

  private refresh(attempt = 0): void {
    clearTimeout(this.retryTimer);
    this.unmount();
    const { mode } = this.settings;
    if (mode === 'off') {
      clearInterval(this.navigationTimer);
      this.navigationTimer = undefined;
      this.status = { state: 'off' };
      return;
    }
    this.watchNavigation();

    if (this.doc.readyState === 'loading') {
      this.status = { state: 'looking' };
      this.doc.addEventListener('DOMContentLoaded', () => this.refresh(), { once: true });
      return;
    }

    const found = this.find(mode);
    if (!found) {
      if (attempt < RETRY_DELAYS_MS.length) {
        this.status = { state: 'looking' };
        this.retryTimer = setTimeout(() => this.refresh(attempt + 1), RETRY_DELAYS_MS[attempt]);
      } else {
        this.status = { state: 'not-found', mode };
      }
      return;
    }

    const title = found.view === 'recipe' ? found.recipe.name : found.article.title;
    if (this.closedAt === this.doc.location.href) {
      this.status = { state: 'closed', view: found.view };
      this.showReopenButton(found.view);
      return;
    }
    this.status = { state: 'showing', view: found.view, title, fellBack: found.fellBack };
    this.mount(found);
  }

  private find(mode: 'reader' | 'recipe'): Found | null {
    if (mode === 'recipe') {
      const recipe = extractRecipe(this.doc);
      if (recipe) return { view: 'recipe', recipe, fellBack: false };
    }
    const article = extractArticle(this.doc);
    return article ? { view: 'reader', article, fellBack: mode === 'recipe' } : null;
  }

  /** Single-page apps change pages without reloading; show the view for the new page. */
  private watchNavigation(): void {
    if (this.navigationTimer) return;
    this.navigationTimer = setInterval(() => {
      if (this.doc.location.href === this.url) return;
      this.url = this.doc.location.href;
      this.closedAt = null;
      this.refresh();
    }, 1000);
  }

  private createHost(): { host: HTMLElement; root: ShadowRoot } {
    const host = this.doc.createElement('div');
    host.setAttribute('data-alter-focus', '');
    // Positioned on <html> (not <body>) so page and Dark Reader rules for body descendants don't apply.
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = this.doc.createElement('style');
    style.textContent = FOCUS_STYLES;
    root.append(style);
    // Below Alter's own floating panel when it's open (same z-index, so DOM order decides).
    this.doc.documentElement.insertBefore(host, this.doc.querySelector('[data-alter-widget]'));
    return { host, root };
  }

  private mount(found: Found): void {
    const { host, root } = this.createHost();
    host.style.inset = '0';
    this.host = host;
    this.root = root;

    const theme = this.settings.theme === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : this.settings.theme;
    const frame = this.el('div', `frame theme-${theme} size-${this.settings.textSize}`);
    frame.setAttribute('role', 'dialog');
    frame.setAttribute('aria-label', found.view === 'recipe' ? 'Recipe view' : 'Reader view');

    const bar = this.el('header', 'bar');
    const label = this.el('span', 'bar-label', found.view === 'recipe' ? 'Recipe view' : 'Reader view');
    const site = this.el('span', 'bar-site', found.view === 'reader' && found.article.siteName ? found.article.siteName : this.doc.location.hostname);
    const close = this.el('button', 'bar-close', 'Show original');
    close.setAttribute('type', 'button');
    close.addEventListener('click', () => this.close(found.view));
    bar.append(label, site, close);

    const sheet = this.el('main', 'sheet');
    if (found.view === 'recipe') this.renderRecipe(sheet, found.recipe);
    else this.renderArticle(sheet, found.article, found.fellBack);

    frame.append(bar, sheet);
    root.append(frame);
    this.lockScroll();
    this.doc.addEventListener('keydown', this.onKeyDown, true);
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.status.state === 'showing') {
      event.stopPropagation();
      this.close(this.status.view);
    }
  };

  private close(view: 'reader' | 'recipe'): void {
    this.closedAt = this.doc.location.href;
    this.unmount();
    this.status = { state: 'closed', view };
    this.showReopenButton(view);
  }

  private showReopenButton(view: 'reader' | 'recipe'): void {
    const { host, root } = this.createHost();
    host.style.right = '20px';
    host.style.bottom = '20px';
    this.reopen = host;
    const button = this.el('button', 'reopen', view === 'recipe' ? 'Recipe view' : 'Reader view');
    button.setAttribute('type', 'button');
    button.addEventListener('click', () => {
      this.closedAt = null;
      this.refresh();
    });
    root.append(button);
  }

  private unmount(): void {
    this.host?.remove();
    this.reopen?.remove();
    this.host = null;
    this.root = null;
    this.reopen = null;
    this.doc.removeEventListener('keydown', this.onKeyDown, true);
    this.unlockScroll();
  }

  private lockScroll(): void {
    const html = this.doc.documentElement;
    this.savedOverflow = html.style.getPropertyValue('overflow');
    html.style.setProperty('overflow', 'hidden', 'important');
  }

  private unlockScroll(): void {
    if (this.savedOverflow === null) return;
    const html = this.doc.documentElement;
    if (this.savedOverflow) html.style.setProperty('overflow', this.savedOverflow);
    else html.style.removeProperty('overflow');
    this.savedOverflow = null;
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const el = this.doc.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  private renderArticle(sheet: HTMLElement, article: Article, fellBack: boolean): void {
    if (fellBack) sheet.append(this.el('p', 'notice', "This page has no recipe data, so here's the reader view instead."));
    const body = this.el('div', 'article');
    body.append(sanitizeArticleHtml(article.html, this.doc.baseURI, this.doc));
    sheet.append(this.el('h1', 'title', headlineFor(article, body)));
    if (article.byline) sheet.append(this.el('p', 'byline', article.byline));
    sheet.append(body);
  }

  private renderRecipe(sheet: HTMLElement, recipe: Recipe): void {
    sheet.classList.add('sheet--recipe');
    sheet.append(this.el('h1', 'title', recipe.name));
    if (recipe.author) sheet.append(this.el('p', 'byline', `By ${recipe.author}`));

    const facts = [...recipe.times.map((t) => [t.label, t.value]), ...(recipe.yield ? [['Serves', recipe.yield]] : [])];
    if (facts.length) {
      const row = this.el('dl', 'facts');
      for (const [label, value] of facts) {
        const fact = this.el('div', 'fact');
        fact.append(this.el('dt', undefined, label), this.el('dd', undefined, value));
        row.append(fact);
      }
      sheet.append(row);
    }
    const image = recipe.image ? safeUrl(recipe.image, this.doc.baseURI, true) : null;
    if (image) {
      const img = this.el('img', 'hero');
      img.src = image;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      sheet.append(img);
    }
    if (recipe.description) sheet.append(this.el('p', 'description', recipe.description));

    const columns = this.el('div', 'recipe');
    if (recipe.ingredients.length) {
      const section = this.el('section', 'ingredients');
      section.append(this.el('h2', undefined, 'Ingredients'));
      const list = this.el('ul');
      for (const ingredient of recipe.ingredients) {
        // Tap an ingredient to cross it off while cooking.
        const item = this.el('li');
        const label = this.el('label');
        const box = this.el('input');
        box.type = 'checkbox';
        label.append(box, this.el('span', undefined, ingredient));
        item.append(label);
        list.append(item);
      }
      section.append(list);
      columns.append(section);
    }
    if (recipe.instructions.length) {
      const section = this.el('section', 'steps');
      section.append(this.el('h2', undefined, 'Instructions'));
      for (const group of recipe.instructions) {
        if (group.section) section.append(this.el('h3', undefined, group.section));
        const list = this.el('ol');
        for (const step of group.steps) list.append(this.el('li', undefined, step));
        section.append(list);
      }
      columns.append(section);
    }
    sheet.append(columns);
  }
}

const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

/** "River Path Opens | Daily Paper" -> "River Path Opens" when a part names the site. */
function withoutSiteName(title: string, siteName: string | null, hostname: string): string {
  const parts = title.split(/\s+[|\-\u2013\u2014:\u00b7]\s+/);
  if (parts.length < 2) return title;
  const site = words(`${siteName ?? ''} ${hostname.replace(/^www\./, '').split('.')[0]}`);
  const kept = parts.filter((part) => ![...words(part)].every((word) => site.has(word)));
  return kept.length ? kept.join(' - ') : title;
}

/**
 * The article's headline. Readability's title often comes from the browser tab
 * ("Headline | Site"); when the article's first heading is the same story, use
 * that heading as the title and drop it from the body so it isn't shown twice.
 */
export function headlineFor(article: Article, body: HTMLElement): string {
  const fallback = withoutSiteName(article.title, article.siteName, location.hostname);
  const first = body.querySelector('h1, h2');
  if (!first || body.firstElementChild !== first) return fallback;
  const heading = first.textContent?.trim() ?? '';
  const a = words(heading);
  const b = words(article.title);
  const shared = [...a].filter((word) => b.has(word)).length;
  if (heading && shared / Math.max(1, Math.min(a.size, b.size)) >= 0.6) {
    first.remove();
    return heading;
  }
  return fallback;
}
