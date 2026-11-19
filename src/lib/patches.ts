/** Settings for the bundled Dark Reader engine. */
export interface DarkMode {
  enabled: boolean;
  /** 50-150, 100 is neutral. */
  brightness: number;
  /** 50-150, 100 is neutral. */
  contrast: number;
  /** 0-100. */
  sepia: number;
}

export const DARK_MODE_OFF: DarkMode = { enabled: false, brightness: 100, contrast: 100, sepia: 0 };

/**
 * Built-in focus views that replace the page with a clean reading view:
 * 'reader' shows the main article (Mozilla Readability); 'recipe' shows the
 * page's schema.org recipe, falling back to the reader view when there is none.
 */
export interface FocusSettings {
  mode: 'off' | 'reader' | 'recipe';
  theme: 'auto' | 'light' | 'sepia' | 'dark';
  textSize: 'normal' | 'large';
}

export const FOCUS_OFF: FocusSettings = { mode: 'off', theme: 'auto', textSize: 'normal' };

/** The visual change itself, independent of where it is stored. */
export interface PatchContent {
  css: string;
  darkMode: DarkMode;
  /** Script body run with the alter runtime through chrome.userScripts; empty for CSS-only changes. */
  js: string;
  focus: FocusSettings;
}

/** The parts of a change the page agent renders; scripts run through chrome.userScripts. */
export type StyleContent = Pick<PatchContent, 'css' | 'darkMode' | 'focus'>;

export interface Patch extends PatchContent {
  id: string;
  hostname: string;
  title: string;
  summary: string;
  /** The user's original request, kept so the patch can be regenerated later. */
  intent: string;
  enabled: boolean;
  model: string;
  createdAt: number;
}

const PREFIX = 'patches:';

export function storageKey(hostname: string): string {
  return PREFIX + hostname;
}

export function hostnameFromKey(key: string): string | null {
  return key.startsWith(PREFIX) ? key.slice(PREFIX.length) : null;
}

/** Fill fields added after a patch was saved, so older patches keep working. */
export function normalizePatch(stored: Patch): Patch {
  return { ...stored, js: stored.js ?? '', focus: stored.focus ?? FOCUS_OFF };
}

export async function getPatches(hostname: string): Promise<Patch[]> {
  const key = storageKey(hostname);
  const result = await chrome.storage.local.get(key);
  return ((result[key] as Patch[] | undefined) ?? []).map(normalizePatch);
}

async function setPatches(hostname: string, patches: Patch[]): Promise<void> {
  const key = storageKey(hostname);
  if (patches.length === 0) await chrome.storage.local.remove(key);
  else await chrome.storage.local.set({ [key]: patches });
}

let writes: Promise<unknown> = Promise.resolve();

/**
 * Read, change, and write a hostname's list, one change at a time, so quick
 * successive edits (toggling two changes in a row) can't overwrite each other.
 */
function modifyPatches(hostname: string, change: (patches: Patch[]) => Patch[]): Promise<void> {
  const run = writes.then(async () => setPatches(hostname, change(await getPatches(hostname))));
  writes = run.catch(() => undefined);
  return run;
}

export function addPatch(patch: Patch): Promise<void> {
  return modifyPatches(patch.hostname, (patches) => [...patches, patch]);
}

export function updatePatch(hostname: string, id: string, changes: Partial<Patch>): Promise<void> {
  return modifyPatches(hostname, (patches) => patches.map((p) => (p.id === id ? { ...p, ...changes } : p)));
}

export function deletePatch(hostname: string, id: string): Promise<void> {
  return modifyPatches(hostname, (patches) => patches.filter((p) => p.id !== id));
}

/** Put a deleted patch back where it was in the list (for undo). */
export function restorePatch(patch: Patch, index: number): Promise<void> {
  return modifyPatches(patch.hostname, (patches) =>
    patches.some((p) => p.id === patch.id) ? patches : [...patches.slice(0, index), patch, ...patches.slice(index)],
  );
}

/** Delete every saved patch for the hostname. */
export function deleteAllPatches(hostname: string): Promise<void> {
  return modifyPatches(hostname, () => []);
}

export interface SiteSummary {
  hostname: string;
  total: number;
  enabled: number;
}

/** Every site with saved patches and how many are on, sorted by name. */
export async function getSiteSummaries(): Promise<SiteSummary[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .flatMap(([key, value]) => {
      const hostname = hostnameFromKey(key);
      if (hostname === null || !Array.isArray(value) || value.length === 0) return [];
      const patches = value as Patch[];
      return [{ hostname, total: patches.length, enabled: patches.filter((p) => p.enabled).length }];
    })
    .sort((a, b) => a.hostname.localeCompare(b.hostname));
}

/** Every hostname that has at least one saved patch. */
export async function getPatchedHostnames(): Promise<string[]> {
  return (await getSiteSummaries()).map((site) => site.hostname);
}

/**
 * Collapse the enabled saved patches plus an optional preview into what the page
 * should render. Later entries win for dark mode settings; CSS is layered in order.
 */
export function effectiveContent(
  saved: Patch[],
  preview: StyleContent | null,
  /** A saved patch the preview is a revision of; hidden while the preview shows. */
  replaces: string | null = null,
): { styles: { id: string; css: string }[]; darkMode: DarkMode; focus: FocusSettings } {
  const layers: { id: string; content: StyleContent }[] = saved
    .filter((p) => p.enabled && !(preview && p.id === replaces))
    .map((p) => ({ id: p.id, content: p }));
  if (preview) layers.push({ id: 'preview', content: preview });

  let darkMode = DARK_MODE_OFF;
  let focus = FOCUS_OFF;
  for (const layer of layers) {
    if (layer.content.darkMode.enabled) darkMode = layer.content.darkMode;
    if (layer.content.focus.mode !== 'off') focus = layer.content.focus;
  }
  return {
    styles: layers.filter((l) => l.content.css.trim() !== '').map((l) => ({ id: l.id, css: l.content.css })),
    darkMode,
    focus,
  };
}
