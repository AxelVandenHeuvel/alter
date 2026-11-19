import { disable as disableDarkReader, enable as enableDarkReader, setFetchMethod } from 'darkreader';
import { FocusView } from './focus/view';
import { cssHealth, type CssHealth } from './health';
import type { PageHealth } from '../lib/messages';
import { effectiveContent, type DarkMode, type Patch, type StyleContent } from '../lib/patches';

/**
 * Renders saved patches plus the live preview into the page.
 *
 * CSS goes into <style> elements appended to <html> (after <head> and <body>,
 * so they win cascade ties against page styles). They carry the `darkreader`
 * class so Dark Reader's engine leaves them untouched instead of re-theming
 * the colors the model chose.
 */

const STYLE_CLASS = 'alter-style';
const STYLE_ATTR = 'data-alter-patch';

/**
 * Dark Reader downloads a site's stylesheets to theme them. Many come from other
 * domains whose CORS rules don't allow it; those stay unthemed. Answer with an
 * empty stylesheet instead of an error so that expected case isn't logged as a failure.
 */
setFetchMethod(async (url) => {
  try {
    return await fetch(url);
  } catch {
    return new Response('', { status: 200, headers: { 'Content-Type': 'text/css' } });
  }
});

export class Applier {
  private saved: Patch[] = [];
  private preview: StyleContent | null = null;
  private replaces: string | null = null;
  private paused = false;
  /** While the user compares, the page shows as it was before the preview; health reports what it was with it. */
  private comparing: { health: PageHealth } | null = null;
  private activeDarkMode: DarkMode | null = null;
  private readonly styles = new Map<string, HTMLStyleElement>();
  private readonly observer: MutationObserver;
  private destroyed = false;
  private readonly focus: FocusView;

  constructor(private readonly doc: Document) {
    // Some apps rewrite <html>'s children; put our styles back if they get removed.
    this.observer = new MutationObserver(() => this.reattach());
    this.focus = new FocusView(doc);
  }

  setSaved(patches: Patch[]): void {
    this.saved = patches;
    this.render();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.render();
  }

  setPreview(content: StyleContent | null, replaces: string | null = null): void {
    this.preview = content;
    this.replaces = content ? replaces : null;
    this.comparing = null;
    this.render();
  }

  /** Temporarily hide the preview (bringing back the saved change it revises), or show it again. */
  setComparing(comparing: boolean): void {
    if (comparing === (this.comparing !== null)) return;
    this.comparing = comparing ? { health: this.health() } : null;
    this.render();
  }

  get state() {
    return {
      savedPatchIds: this.saved.filter((p) => p.enabled).map((p) => p.id),
      previewActive: this.preview !== null,
      darkModeActive: this.activeDarkMode !== null,
      paused: this.paused,
      focus: this.focus.state,
    };
  }

  /** What each change is doing on the page: how much of its CSS applies here, and the built-in engines. */
  health(): PageHealth {
    if (this.comparing) return this.comparing.health;
    const css: Record<string, CssHealth> = {};
    for (const [id, el] of this.styles) css[id] = cssHealth(this.doc, el.sheet);
    return { css, darkModeActive: this.activeDarkMode !== null, paused: this.paused, focus: this.focus.state };
  }

  /**
   * Remove everything this applier put on the page and stop. Called when a newer
   * copy of the page agent takes over, or when this one is cut off from the
   * extension (reloaded or updated), so no styles are left behind that nothing controls.
   */
  destroy(): void {
    this.destroyed = true;
    this.observer.disconnect();
    for (const el of this.styles.values()) el.remove();
    this.styles.clear();
    if (this.activeDarkMode) disableDarkReader();
    this.activeDarkMode = null;
    this.focus.destroy();
  }

  private render(): void {
    if (this.destroyed) return;
    // Pausing hides saved patches but keeps an in-progress preview visible.
    const preview = this.comparing ? null : this.preview;
    const { styles, darkMode, focus } = effectiveContent(this.paused ? [] : this.saved, preview, this.replaces);

    const wanted = new Set(styles.map((s) => s.id));
    for (const [id, el] of this.styles) {
      if (!wanted.has(id)) {
        el.remove();
        this.styles.delete(id);
      }
    }
    for (const { id, css } of styles) {
      let el = this.styles.get(id);
      if (!el) {
        el = this.doc.createElement('style');
        el.className = `darkreader ${STYLE_CLASS}`;
        el.setAttribute(STYLE_ATTR, id);
        this.styles.set(id, el);
      }
      if (el.textContent !== css) el.textContent = css;
    }
    this.reattach();
    this.renderDarkMode(darkMode.enabled ? darkMode : null);
    this.focus.set(focus);

    if (this.styles.size > 0) this.observer.observe(this.doc.documentElement, { childList: true });
    else this.observer.disconnect();
  }

  /** Keep our style elements attached, in patch order, at the end of <html>. */
  private reattach(): void {
    const root = this.doc.documentElement;
    const ordered = Array.from(this.styles.values());
    const tail = Array.from(root.children).slice(-ordered.length);
    const inPlace = ordered.length === tail.length && ordered.every((el, i) => tail[i] === el);
    if (!inPlace) root.append(...ordered);
  }

  private renderDarkMode(next: DarkMode | null): void {
    const current = this.activeDarkMode;
    const same =
      current === next ||
      (current !== null &&
        next !== null &&
        current.brightness === next.brightness &&
        current.contrast === next.contrast &&
        current.sepia === next.sepia);
    if (same) return;
    this.activeDarkMode = next;
    if (next) {
      enableDarkReader(
        { brightness: next.brightness, contrast: next.contrast, sepia: next.sepia },
        { invert: [], css: '', ignoreInlineStyle: [], ignoreImageAnalysis: [], disableStyleSheetsProxy: true, ignoreCSSUrl: [] },
      );
    } else {
      disableDarkReader();
    }
  }
}
