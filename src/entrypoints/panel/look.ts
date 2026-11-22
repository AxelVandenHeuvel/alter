import { DEFAULT_SETTINGS, LOOKS, type Look } from '../../lib/settings';

/**
 * The panel's look is an attribute on <html> that the look stylesheets (patchwork.css,
 * selvedge.css) key off. Settings load asynchronously, so the last look is also remembered in
 * this page's localStorage and put back before the first paint, so a dressed-up panel doesn't
 * flash Plain while it opens.
 */
const REMEMBERED = 'alter-look';

export function applyLook(look: Look): void {
  document.documentElement.dataset.look = look;
  try {
    localStorage.setItem(REMEMBERED, look);
  } catch {
    // Storage blocked: the panel still gets the look once settings load.
  }
}

export function restoreLook(): void {
  let look: string | null = null;
  try {
    look = localStorage.getItem(REMEMBERED);
  } catch {
    // As above.
  }
  document.documentElement.dataset.look = LOOKS.some((l) => l.id === look) ? look! : DEFAULT_SETTINGS.look;
}
